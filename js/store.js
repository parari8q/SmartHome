// Wszystkie dane synchronizowane miedzy urzadzeniami w jednym miejscu.
//
// Gdzie sa dane:
//   * uzytkownik w grupie  -> groups/<gid>/data/...  (wspolne dla calej grupy)
//   * uzytkownik bez grupy -> users/<uid>/...        (tylko jego, na wszystkich jego urzadzeniach)
//   * bez logowania        -> stare miejsce w glownym katalogu (tylko przy otwartej bazie)

import { DB_PATHS, FIREBASE_DB_URL } from "./config.js";
import { SyncedDoc, combineStatus } from "./lib/firebase-sync.js";
import { auth } from "./db.js";
import { loadGroup } from "./groups.js";
import { migrateLegacyData } from "./lib/migrate.js";
import { createSharedEventSource } from "./lib/shared-stream.js";
import { normalizeTodoLists } from "./logic/todo.js";
import { normalizeCalendar } from "./logic/calendar.js";
import { normalizeRecipes } from "./logic/recipes.js";
import { normalizeShopping } from "./logic/shopping.js";

export { auth };

let authRequiredListeners = new Set();
let authRequiredTimer = null;
/** fn() — baza odmowila dostepu (trzeba sie zalogowac). */
export function onAuthRequired(fn) { authRequiredListeners.add(fn); }
function authRequired() {
  clearTimeout(authRequiredTimer); // 5 dokumentow naraz -> jedno wywolanie
  authRequiredTimer = setTimeout(() => { for (const fn of authRequiredListeners) fn(); }, 50);
}

// jedno polaczenie z cala przestrzenia konta zamiast 5 (limit polaczen przegladarki)
const SharedEventSource = createSharedEventSource({ getBase: () => space.base });

const make = (path, normalize) => new SyncedDoc({
  baseUrl: FIREBASE_DB_URL, path, normalize,
  EventSourceImpl: SharedEventSource,
  getAuthToken: (opts) => auth.getToken(opts),
  onAuthRequired: authRequired,
});

export const store = {
  todo: make(DB_PATHS.todo, normalizeTodoLists),
  calendar: make(DB_PATHS.calendar, normalizeCalendar),
  recipes: make(DB_PATHS.recipes, normalizeRecipes),
  shopping: make(DB_PATHS.shopping, normalizeShopping),
};

let activeUid; // undefined = jeszcze nie uruchomiono
let space = { kind: "legacy", base: null };
// false, dopoki nie wiadomo, czyje dane wczytac (konto/grupa) — wtedy nic sie nie laczy,
// zeby na chwile nie pokazac danych z niewlasciwego miejsca
let spaceReady = false;
const spaceListeners = new Set();

/** Aktualne miejsce danych: { kind: "legacy" | "personal" | "group", base, gid? } */
export function currentSpace() { return space; }
export function onSpaceChange(fn) { spaceListeners.add(fn); return () => spaceListeners.delete(fn); }

function pathFor(key) {
  return space.base ? `${space.base}/${DB_PATHS[key]}` : DB_PATHS[key];
}

async function resolveSpace(uid) {
  if (!uid) return { kind: "legacy", base: null };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const group = await loadGroup(uid);
      return group ? { kind: "group", gid: group.id, base: `groups/${group.id}/data` } : { kind: "personal", base: `users/${uid}` };
    } catch {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); // brak sieci — chwila i jeszcze raz
    }
  }
  return { kind: "personal", base: `users/${uid}` };
}

/** Przelacz dane na przestrzen danego konta (albo stara wspolna, gdy null). */
async function activate(uid) {
  activeUid = uid;
  spaceReady = false;
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
  const next = await resolveSpace(uid);
  if (activeUid !== uid) return; // w miedzyczasie zmienil sie uzytkownik
  space = next;
  for (const fn of spaceListeners) { try { fn(space); } catch (e) { console.error(e); } }
  for (const [key, doc] of Object.entries(store)) {
    const path = pathFor(key);
    if (doc.path.join("/") === path) { doc.connect(); doc.retryNow(); }
    else doc.setPath(path);
  }
  spaceReady = true;
}

export function currentUid() { return activeUid || null; }

/** Po zalozeniu/dolaczeniu/opuszczeniu grupy: przelacz dane. */
export function refreshSpace() { return activate(activeUid); }

export function connectAll() {
  activate(auth.uid);
  auth.onChange((session) => {
    const uid = session?.uid || null;
    if (uid !== activeUid) activate(uid);
  });

  const reconnect = () => { if (spaceReady) for (const doc of Object.values(store)) doc.ensureConnected(); };
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
