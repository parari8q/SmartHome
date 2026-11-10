// Przepisy: { categories: [{ id, name, subcategories: [{ id, name, recipes: [
//   { id, name, ingredients: [..], instructions, image, createdAt } ] }] }] }
// (baza: "recipes_data")   Lista zakupow: [{ text, checked }] (baza: "shopping_list")

import { asArray, clone, uid } from "../lib/util.js";
import { instructionsToSteps, isIngredientHeader } from "./recipe-parser.js";

/** "Na ciasto:" — naglowek grupy skladnikow. */
export const isHeader = isIngredientHeader;

export const DEFAULT_SUBCATEGORIES = ["Śniadanie", "Obiad", "Kolacja", "Deser"];

export function normalizeRecipes(raw) {
  return {
    categories: asArray(raw && raw.categories)
      .filter((c) => c && typeof c === "object")
      .map((cat) => ({
        id: String(cat.id || uid()),
        name: String(cat.name ?? ""),
        subcategories: asArray(cat.subcategories)
          .filter((s) => s && typeof s === "object")
          .map((sc) => ({
            id: String(sc.id || uid()),
            name: String(sc.name ?? ""),
            recipes: asArray(sc.recipes)
              .filter((r) => r && typeof r === "object")
              .map((r) => {
                const steps = asArray(r.steps).map(String).filter(Boolean);
                return {
                  ...r,
                  id: String(r.id || uid()),
                  name: String(r.name ?? ""),
                  ingredients: asArray(r.ingredients).map(String),
                  // stare przepisy mialy jeden tekst "instructions" — pokazujemy go jako kroki
                  steps: steps.length ? steps : instructionsToSteps(r.instructions ? String(r.instructions) : ""),
                  instructions: r.instructions ? String(r.instructions) : "",
                  servings: r.servings ? String(r.servings) : "",
                  time: r.time ? String(r.time) : "",
                  notes: r.notes ? String(r.notes) : "",
                  source: r.source ? String(r.source) : "",
                  photo: r.photo || null,   // znacznik czasu zdjecia w osobnym miejscu bazy
                  image: r.image || null,   // stare zdjecie zapisane w srodku przepisu
                };
              }),
          })),
      })),
  };
}

export function findCategory(data, catId) {
  return data.categories.find((c) => c.id === catId) || null;
}

export function findSubcategory(data, catId, scId) {
  const cat = findCategory(data, catId);
  return (cat && cat.subcategories.find((s) => s.id === scId)) || null;
}

export function findRecipe(data, catId, scId, recipeId) {
  const sc = findSubcategory(data, catId, scId);
  return (sc && sc.recipes.find((r) => r.id === recipeId)) || null;
}

export function countRecipes(cat) {
  return cat.subcategories.reduce((s, sc) => s + sc.recipes.length, 0);
}

export function addCategory(data, name, makeId = uid) {
  const next = clone(data);
  next.categories.push({
    id: makeId(),
    name: name.trim(),
    subcategories: DEFAULT_SUBCATEGORIES.map((n) => ({ id: makeId(), name: n, recipes: [] })),
  });
  return next;
}

export function deleteCategory(data, catId) {
  const next = clone(data);
  next.categories = next.categories.filter((c) => c.id !== catId);
  return next;
}

export function addSubcategory(data, catId, name, id = uid()) {
  const next = clone(data);
  const cat = findCategory(next, catId);
  if (cat) cat.subcategories.push({ id, name: name.trim(), recipes: [] });
  return next;
}

export function deleteSubcategory(data, catId, scId) {
  const next = clone(data);
  const cat = findCategory(next, catId);
  if (cat) cat.subcategories = cat.subcategories.filter((s) => s.id !== scId);
  return next;
}

export function parseIngredients(text) {
  return String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Rozbija wklejony tekst (linie albo przecinki) na skladniki, usuwajac
 *  punktory typu "-", "•", "1." z poczatku linii. */
export function splitIntoIngredients(text) {
  return String(text || "")
    .split(/\n|,|;/)
    .map((l) => l.replace(/^\s*(?:[-–•*·]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

const RECIPE_FIELDS = ["name", "ingredients", "steps", "servings", "time", "notes", "source", "photo"];

function pickFields(fields) {
  const out = {};
  for (const k of RECIPE_FIELDS) if (k in fields) out[k] = fields[k];
  if (typeof out.name === "string") out.name = out.name.trim();
  return out;
}

export function addRecipe(data, catId, scId, fields, id = uid(), now = Date.now()) {
  const next = clone(data);
  const sc = findSubcategory(next, catId, scId);
  if (sc) sc.recipes.push({ id, ingredients: [], steps: [], ...pickFields(fields), createdAt: now, updatedAt: now });
  return next;
}

/** Pierwsza kategoria/podkategoria; gdy nie ma zadnej — tworzy "Moje przepisy",
 *  zeby mozna bylo od razu zapisac przepis bez klikania po kategoriach. */
export function ensureDefaultTarget(data, makeId = uid) {
  let next = data;
  if (!next.categories.length) next = addCategory(next, "Moje przepisy", makeId);
  const cat = next.categories[0];
  if (!cat.subcategories.length) next = addSubcategory(next, cat.id, "Ogólne", makeId());
  const c = next.categories[0];
  return { data: next, catId: c.id, scId: c.subcategories[0].id };
}

export function searchRecipes(data, query) {
  const q = String(query || "").trim().toLocaleLowerCase("pl");
  if (!q) return [];
  const words = q.split(/\s+/);
  return allRecipes(data).filter((r) => {
    const hay = [r.name, ...r.ingredients, r.label].join(" ").toLocaleLowerCase("pl");
    return words.every((w) => hay.includes(w));
  });
}

export function updateRecipe(data, catId, scId, recipeId, fields, now = Date.now()) {
  const next = clone(data);
  const r = findRecipe(next, catId, scId, recipeId);
  if (r) {
    Object.assign(r, pickFields(fields), { updatedAt: now });
    if ("steps" in fields) r.instructions = null; // zastapione przez kroki
    if ("image" in fields) r.image = fields.image || null;
  }
  return next;
}

export function deleteRecipe(data, catId, scId, recipeId) {
  const next = clone(data);
  const sc = findSubcategory(next, catId, scId);
  if (sc) sc.recipes = sc.recipes.filter((r) => r.id !== recipeId);
  return next;
}

export function moveRecipe(data, from, to, recipeId) {
  if (from.catId === to.catId && from.scId === to.scId) return clone(data);
  const next = clone(data);
  const src = findSubcategory(next, from.catId, from.scId);
  const dst = findSubcategory(next, to.catId, to.scId);
  if (!src || !dst) return next;
  const r = src.recipes.find((x) => x.id === recipeId);
  if (!r) return next;
  src.recipes = src.recipes.filter((x) => x.id !== recipeId);
  dst.recipes.push(r);
  return next;
}

export function allRecipes(data) {
  const out = [];
  for (const cat of data.categories)
    for (const sc of cat.subcategories)
      for (const r of sc.recipes)
        out.push({ ...r, catId: cat.id, scId: sc.id, label: cat.name + " / " + sc.name });
  return out;
}

// ----- lista zakupow --------------------------------------------------------

export function normalizeShopping(raw) {
  return asArray(raw)
    .filter((i) => i && typeof i === "object" && String(i.text ?? "").trim())
    .map((i) => ({ text: String(i.text), checked: !!i.checked }));
}

/** Skladniki z wybranych przepisow bez duplikatow (wielkosc liter bez znaczenia). */
export function buildShoppingList(recipes, selectedIds) {
  const seen = new Set();
  const items = [];
  for (const r of recipes) {
    if (!selectedIds.has(r.id)) continue;
    for (const ing of r.ingredients) {
      if (isIngredientHeader(ing)) continue; // "Na ciasto:" to nie produkt
      const key = ing.trim().toLocaleLowerCase("pl");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      items.push({ text: ing.trim(), checked: false });
    }
  }
  return items;
}

/** Dolacz pozycje do istniejacej listy (bez duplikatow). */
export function mergeShopping(list, items) {
  const seen = new Set(list.map((i) => i.text.trim().toLocaleLowerCase("pl")));
  const next = clone(list);
  for (const it of items) {
    const key = it.text.trim().toLocaleLowerCase("pl");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push({ text: it.text.trim(), checked: !!it.checked });
  }
  return next;
}

export function toggleShoppingItem(list, index) {
  return list.map((it, i) => (i === index ? { ...it, checked: !it.checked } : it));
}

export function removeChecked(list) {
  return list.filter((i) => !i.checked);
}
