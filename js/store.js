// Wszystkie wspolne dane (synchronizowane miedzy urzadzeniami) w jednym miejscu.

import { DB_PATHS, FIREBASE_DB_URL } from "./config.js";
import { SyncedDoc, combineStatus } from "./lib/firebase-sync.js";
import { normalizeTodoLists } from "./logic/todo.js";
import { normalizeCalendar } from "./logic/calendar.js";
import { normalizeSuppLog } from "./logic/supplements.js";
import { normalizeRecipes, normalizeShopping } from "./logic/recipes.js";

const make = (path, normalize) => new SyncedDoc({ baseUrl: FIREBASE_DB_URL, path, normalize });

export const store = {
  todo: make(DB_PATHS.todo, normalizeTodoLists),
  calendar: make(DB_PATHS.calendar, normalizeCalendar),
  supplements: make(DB_PATHS.supplements, normalizeSuppLog),
  recipes: make(DB_PATHS.recipes, normalizeRecipes),
  shopping: make(DB_PATHS.shopping, normalizeShopping),
};

export function connectAll() {
  for (const doc of Object.values(store)) doc.connect();

  const reconnect = () => { for (const doc of Object.values(store)) doc.ensureConnected(); };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reconnect(); });
  window.addEventListener("online", reconnect);
  window.addEventListener("pageshow", reconnect);
  setInterval(reconnect, 30000);
}

/** fn(status, details) — wywolywane przy kazdej zmianie stanu ktoregokolwiek dokumentu. */
export function onSyncStatus(fn) {
  const states = {};
  for (const [name, doc] of Object.entries(store)) {
    doc.onStatus((s) => {
      states[name] = s;
      if (Object.keys(states).length === Object.keys(store).length) fn(combineStatus(states), states);
    });
  }
}
