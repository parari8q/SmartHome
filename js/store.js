// Wszystkie wspolne dane (synchronizowane miedzy urzadzeniami) w jednym miejscu.

import { DB_PATHS, FIREBASE_DB_URL, FIREBASE_API_KEY } from "./config.js";
import { SyncedDoc, combineStatus } from "./lib/firebase-sync.js";
import { FirebaseAuth } from "./lib/auth.js";
import { normalizeTodoLists } from "./logic/todo.js";
import { normalizeCalendar } from "./logic/calendar.js";
import { normalizeSuppLog } from "./logic/supplements.js";
import { normalizeRecipes, normalizeShopping } from "./logic/recipes.js";

export const auth = new FirebaseAuth({ apiKey: FIREBASE_API_KEY });

let authRequiredListeners = new Set();
let authRequiredTimer = null;
/** fn() — baza odmowila dostepu (trzeba sie zalogowac). */
export function onAuthRequired(fn) { authRequiredListeners.add(fn); }
function authRequired() {
  clearTimeout(authRequiredTimer); // 5 dokumentow naraz -> jedno wywolanie
  authRequiredTimer = setTimeout(() => { for (const fn of authRequiredListeners) fn(); }, 50);
}

const make = (path, normalize) => new SyncedDoc({
  baseUrl: FIREBASE_DB_URL, path, normalize,
  getAuthToken: (opts) => auth.getToken(opts),
  onAuthRequired: authRequired,
});

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

/** Po zalogowaniu/wylogowaniu: nowe polaczenia z nowym tokenem i ponowienie zapisow. */
export function reconnectAll() {
  for (const doc of Object.values(store)) { doc.connect(); doc.retryNow(); }
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
