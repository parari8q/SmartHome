// Wszystkie dane synchronizowane miedzy urzadzeniami w jednym miejscu.
//
// Zalogowany uzytkownik ma WLASNA przestrzen w bazie: users/<uid>/todo_lists itd.
// Wszystkie urzadzenia zalogowane na to samo konto widza te same dane;
// inne konto = inne dane. Bez logowania (tylko przy otwartej bazie) uzywane
// jest stare, wspolne miejsce w glownym katalogu bazy.

import { DB_PATHS, FIREBASE_DB_URL, FIREBASE_API_KEY } from "./config.js";
import { SyncedDoc, combineStatus } from "./lib/firebase-sync.js";
import { FirebaseAuth } from "./lib/auth.js";
import { migrateLegacyData } from "./lib/migrate.js";
import { createSharedEventSource } from "./lib/shared-stream.js";
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

// jedno polaczenie z cala przestrzenia konta zamiast 5 (limit polaczen przegladarki)
const SharedEventSource = createSharedEventSource({ getBase: () => (activeUid ? `users/${activeUid}` : null) });

const make = (path, normalize) => new SyncedDoc({
  baseUrl: FIREBASE_DB_URL, path, normalize,
  EventSourceImpl: SharedEventSource,
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

export function pathFor(key, uid) {
  return uid ? `users/${uid}/${DB_PATHS[key]}` : DB_PATHS[key];
}

let activeUid; // undefined = jeszcze nie uruchomiono

/** Przelacz dane na przestrzen danego konta (albo stara wspolna, gdy null). */
async function activate(uid) {
  activeUid = uid;
  if (uid && localStorage.getItem("migrated_" + uid) !== "1") {
    try {
      const token = await auth.getToken();
      const r = await migrateLegacyData({ baseUrl: FIREBASE_DB_URL, uid, token, paths: DB_PATHS });
      if (r.status === "done" || r.status === "already") localStorage.setItem("migrated_" + uid, "1");
      if (r.status === "done" && r.copied.length) console.info("Przeniesiono dotychczasowe dane na konto:", r.copied);
    } catch (err) {
      console.warn("Przenoszenie danych nie powiodło się (spróbuję następnym razem):", err);
    }
  }
  if (activeUid !== uid) return; // w miedzyczasie zmienil sie uzytkownik
  for (const [key, doc] of Object.entries(store)) {
    const path = pathFor(key, uid);
    if (doc.path.join("/") === path) { doc.connect(); doc.retryNow(); }
    else doc.setPath(path);
  }
}

export function currentUid() { return activeUid || null; }

export function connectAll() {
  activate(auth.uid);
  auth.onChange((session) => {
    const uid = session?.uid || null;
    if (uid !== activeUid) activate(uid);
  });

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
