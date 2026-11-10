// Przepisy: { categories: [{ id, name, subcategories: [{ id, name, recipes: [
//   { id, name, ingredients: [..], instructions, image, createdAt } ] }] }] }
// (baza: "recipes_data")   Lista zakupow: [{ text, checked }] (baza: "shopping_list")

import { asArray, clone, uid } from "../lib/util.js";

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
              .map((r) => ({
                ...r,
                id: String(r.id || uid()),
                name: String(r.name ?? ""),
                ingredients: asArray(r.ingredients).map(String),
                instructions: r.instructions ? String(r.instructions) : "",
                image: r.image || null,
              })),
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

export function addRecipe(data, catId, scId, { name, ingredients, instructions, image }, id = uid(), now = Date.now()) {
  const next = clone(data);
  const sc = findSubcategory(next, catId, scId);
  if (sc) sc.recipes.push({ id, name: name.trim(), ingredients, instructions: instructions || "", image: image || null, createdAt: now });
  return next;
}

export function updateRecipe(data, catId, scId, recipeId, fields) {
  const next = clone(data);
  const r = findRecipe(next, catId, scId, recipeId);
  if (r) Object.assign(r, fields, { name: (fields.name ?? r.name).trim() });
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
