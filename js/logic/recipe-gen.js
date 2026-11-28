// Generator przepisow: kategorie do wyboru, budowa zapytania do AI i
// zamiana odpowiedzi na przepis w formacie aplikacji.

export const TAG_GROUPS = [
  { name: "Posiłek", tags: ["Śniadanie", "Obiad", "Kolacja", "Zupa", "Deser", "Przekąska"] },
  { name: "Dieta", tags: ["Wege", "Wegańskie", "Bez glutenu", "Bez laktozy", "Lekkie / fit", "Dużo białka"] },
  { name: "Czas", tags: ["Do 15 min", "Do 30 min", "Do 1 h"] },
  { name: "Kuchnia", tags: ["Polska", "Włoska", "Azjatycka", "Meksykańska", "Śródziemnomorska"] },
  { name: "Okazja", tags: ["Tanio", "Na imprezę", "Dla dzieci", "Na kilka dni (meal prep)", "Jednogarnkowe"] },
];

export const RECIPE_SCHEMA = {
  type: "OBJECT",
  properties: {
    recipes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          description: { type: "STRING" },
          time: { type: "STRING" },
          servings: { type: "INTEGER" },
          ingredients: { type: "ARRAY", items: { type: "STRING" } },
          steps: { type: "ARRAY", items: { type: "STRING" } },
          tags: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["name", "description", "time", "servings", "ingredients", "steps"],
      },
    },
  },
  required: ["recipes"],
};

export const SYSTEM_PROMPT = [
  "Jesteś doświadczonym kucharzem domowym i piszesz przepisy po polsku, poprawną polszczyzną, bez anglicyzmów.",
  "Przepisy mają być realne do zrobienia w domowej kuchni, ze składników dostępnych w polskim sklepie.",
  "Składniki: każdy osobno, w formacie „ilość jednostka nazwa”, np. „200 g mąki pszennej”, „2 jajka”, „1 łyżka oliwy”, „sól do smaku”.",
  "Kroki: krótkie, konkretne zdania w trybie rozkazującym, bez numerów na początku.",
  "Czas podawaj jak „30 min” albo „1 h 15 min”. Opis: jedno zachęcające zdanie.",
].join(" ");

const clean = (s, max = 300) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Zapytanie do AI na podstawie wybranych opcji. */
export function buildPrompt({ tags = [], have = "", avoid = "", servings = 4, count = 3, basedOn = [], extra = "" } = {}) {
  const lines = [`Zaproponuj ${count} różne przepisy, każdy na ${servings} ${servings === 1 ? "porcję" : servings < 5 ? "porcje" : "porcji"}.`];
  if (tags.length) lines.push(`Wymagania (wszystkie naraz): ${tags.map((t) => clean(t, 60)).join(", ")}.`);
  if (clean(have)) lines.push(`Wykorzystaj przede wszystkim to, co jest w domu: ${clean(have, 500)}. Możesz dodać typowe podstawowe składniki.`);
  if (clean(avoid)) lines.push(`Nie używaj: ${clean(avoid, 300)}.`);
  if (clean(extra)) lines.push(`Dodatkowo: ${clean(extra, 300)}.`);
  if (basedOn.length) {
    const names = basedOn.slice(0, 40).map((r) => clean(r, 80)).join("; ");
    lines.push(`Moje ulubione przepisy, które już mam: ${names}. Zaproponuj coś w podobnym stylu i guście, ale NIE powtarzaj tych dań.`);
  }
  lines.push("Przepisy mają się od siebie wyraźnie różnić.");
  return lines.join("\n");
}

/** Normalizacja odpowiedzi AI (odporna na brakujace pola i smieci). */
export function parseGenerated(json) {
  const list = Array.isArray(json?.recipes) ? json.recipes : Array.isArray(json) ? json : [];
  return list.map((r) => {
    const ingredients = (Array.isArray(r?.ingredients) ? r.ingredients : []).map((x) => clean(x, 160)).filter(Boolean).slice(0, 40);
    const steps = (Array.isArray(r?.steps) ? r.steps : []).map((x) => clean(x, 600).replace(/^(?:krok\s*)?\d+[.):]\s*/i, "")).filter(Boolean).slice(0, 30);
    const servings = Number.parseInt(r?.servings, 10);
    return {
      name: clean(r?.name, 120),
      description: clean(r?.description, 300),
      time: clean(r?.time, 30),
      servings: servings > 0 && servings < 100 ? servings : null,
      ingredients, steps,
      tags: (Array.isArray(r?.tags) ? r.tags : []).map((x) => clean(x, 40)).filter(Boolean).slice(0, 6),
    };
  }).filter((r) => r.name && r.ingredients.length && r.steps.length);
}

/** Przepis w formacie aplikacji (pola jak w formularzu). */
export function toAppRecipe(gen, { tags = [] } = {}) {
  const notes = [gen.description, tags.length ? "Kategorie: " + tags.join(", ") : ""].filter(Boolean).join("\n");
  return {
    name: gen.name,
    ingredients: gen.ingredients,
    steps: gen.steps,
    servings: gen.servings ? String(gen.servings) : "",
    time: gen.time || "",
    notes,
    source: "Wygenerowane przez AI",
  };
}
