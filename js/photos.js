// Zdjecia przepisow — w osobnym miejscu bazy (recipe_photos/<uid>/<id>), nie w
// samym przepisie. Dzieki temu lista przepisow synchronizuje sie szybko, a
// zdjecie pobiera sie tylko wtedy, gdy jest potrzebne.

import { FIREBASE_DB_URL } from "./config.js";
import { auth, currentUid } from "./store.js";

const cache = new Map(); // "<uid>/<id>@<wersja>" -> Promise<dataUrl|null>

async function url(recipeId) {
  const token = await auth.getToken();
  const owner = currentUid() || "shared";
  return `${FIREBASE_DB_URL}/recipe_photos/${encodeURIComponent(owner)}/${encodeURIComponent(recipeId)}.json` +
    (token ? "?auth=" + encodeURIComponent(token) : "");
}

/** recipe: obiekt przepisu. Zwraca dataURL albo null. Stare zdjecia (r.image) dzialaja dalej. */
export function getRecipePhoto(recipe) {
  if (!recipe) return Promise.resolve(null);
  if (!recipe.photo) return Promise.resolve(recipe.image || null);
  const key = `${currentUid()}/${recipe.id}@${recipe.photo}`;
  if (!cache.has(key)) {
    cache.set(key, url(recipe.id)
      .then((u) => fetch(u))
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((v) => { if (v == null) cache.delete(key); return v || recipe.image || null; }));
  }
  return cache.get(key);
}

/** Zapisuje zdjecie; zwraca nowa "wersje" (znacznik czasu) do zapisania w przepisie. */
export async function saveRecipePhoto(recipeId, dataUrl) {
  const res = await fetch(await url(recipeId), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dataUrl) });
  if (!res.ok) {
    throw new Error(res.status === 401 || res.status === 403
      ? "Baza nie pozwala zapisać zdjęcia — dodaj regułę dla recipe_photos (README)."
      : "Nie udało się zapisać zdjęcia (HTTP " + res.status + ").");
  }
  const version = Date.now();
  cache.set(`${currentUid()}/${recipeId}@${version}`, Promise.resolve(dataUrl));
  return version;
}

export async function deleteRecipePhoto(recipeId) {
  try { await fetch(await url(recipeId), { method: "DELETE" }); } catch {}
}

/** Zmniejsza zdjecie przed zapisem (zdjecia z telefonu maja po kilka MB). */
export function compressImage(file, maxDim = 1200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(src);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error("Nie udało się wczytać zdjęcia")); };
    img.src = src;
  });
}
