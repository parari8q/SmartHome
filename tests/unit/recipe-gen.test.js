import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, parseGenerated, toAppRecipe, TAG_GROUPS } from "../../js/logic/recipe-gen.js";
import { pickGeminiModel, extractJson } from "../../js/logic/ai-utils.js";
import { addRecipe, normalizeRecipes, ensureDefaultTarget } from "../../js/logic/recipes.js";

test("zapytanie zawiera kategorie, składniki z domu, wykluczenia i ulubione przepisy", () => {
  const p = buildPrompt({ tags: ["Obiad", "Wege"], have: "cukinia, feta", avoid: "grzyby", servings: 2, count: 3, basedOn: ["Shakshuka", "Leczo"] });
  assert.match(p, /3 różne przepisy, każdy na 2 porcje/);
  assert.match(buildPrompt({ count: 1, servings: 4, extra: "Najszybsze." }), /^Zaproponuj jeden przepis na 4 porcje\.[\s\S]*Najszybsze/);
  assert.doesNotMatch(buildPrompt({ count: 1 }), /wyraźnie różnić/);
  assert.match(p, /Wymagania \(wszystkie naraz\): Obiad, Wege/);
  assert.match(p, /cukinia, feta/);
  assert.match(p, /Nie używaj: grzyby/);
  assert.match(p, /Shakshuka; Leczo.*NIE powtarzaj/s);
  assert.doesNotMatch(buildPrompt({}), /Wymagania|ulubione/);
  assert.ok(TAG_GROUPS.flatMap((g) => g.tags).includes("Do 30 min"));
});

test("odpowiedź AI: odrzuca niepełne, czyści numerację kroków i liczby porcji", () => {
  const out = parseGenerated({ recipes: [
    { name: " Leczo z cukinią ", description: "Szybkie", time: "30 min", servings: "4", ingredients: ["2 cukinie", " ", "1 cebula"], steps: ["1. Pokrój warzywa.", "Krok 2: Duś 15 minut."], tags: ["Obiad"] },
    { name: "Bez kroków", ingredients: ["x"], steps: [] },
    null,
  ] });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { name: "Leczo z cukinią", description: "Szybkie", time: "30 min", servings: 4, ingredients: ["2 cukinie", "1 cebula"], steps: ["Pokrój warzywa.", "Duś 15 minut."], tags: ["Obiad"] });
  assert.deepEqual(parseGenerated("śmieci"), []);
});

test("zapis wygenerowanego przepisu w formacie aplikacji", () => {
  const gen = parseGenerated({ recipes: [{ name: "Leczo", description: "Szybkie", time: "30 min", servings: 4, ingredients: ["2 cukinie"], steps: ["Duś."] }] })[0];
  const fields = toAppRecipe(gen, { tags: ["Obiad", "Wege"] });
  assert.equal(fields.notes, "Szybkie\nKategorie: Obiad, Wege");
  const t = ensureDefaultTarget(normalizeRecipes({}), (() => { let i = 0; return () => "id" + ++i; })());
  const data = normalizeRecipes(addRecipe(t.data, t.catId, t.scId, fields, "r1", 1));
  const r = data.categories[0].subcategories[0].recipes[0];
  assert.equal(r.name, "Leczo");
  assert.deepEqual(r.ingredients, ["2 cukinie"]);
  assert.deepEqual(r.steps, ["Duś."]);
  assert.equal(r.servings, "4");
});

test("wybór najnowszego modelu Gemini Flash", () => {
  const m = (name, methods = ["generateContent"]) => ({ name: "models/" + name, supportedGenerationMethods: methods });
  assert.equal(pickGeminiModel([m("gemini-3.6-flash"), m("gemini-3.8-flash"), m("gemini-3.8-flash-lite"), m("gemini-3.8-flash-live"), m("gemini-4-argon"), m("gemini-3.9-flash", ["embedContent"])]), "gemini-3.8-flash");
  assert.equal(pickGeminiModel([m("gemini-3.8-flash-preview-09"), m("gemini-3.6-flash")]), "gemini-3.8-flash-preview-09");
  assert.equal(pickGeminiModel([m("gemini-pro")]), null);
});

test("wyciąganie JSON z odpowiedzi tekstowej", () => {
  assert.deepEqual(extractJson('Oto:\n```json\n{"recipes":[]}\n```'), { recipes: [] });
  assert.throws(() => extractJson("brak"), /formacie/);
});
