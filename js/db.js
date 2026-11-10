// Logowanie i proste zapytania REST do bazy (z tokenem zalogowanego uzytkownika).

import { FIREBASE_DB_URL, FIREBASE_API_KEY } from "./config.js";
import { FirebaseAuth } from "./lib/auth.js";

export const auth = new FirebaseAuth({ apiKey: FIREBASE_API_KEY });

async function dbUrl(path) {
  const token = await auth.getToken();
  return `${FIREBASE_DB_URL}/${String(path).split("/").filter(Boolean).map(encodeURIComponent).join("/")}.json` +
    (token ? "?auth=" + encodeURIComponent(token) : "");
}

export class DbError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function call(path, opts = {}) {
  const res = await fetch(await dbUrl(path), opts);
  if (!res.ok) {
    const denied = res.status === 401 || res.status === 403;
    throw new DbError(res.status, denied ? "Brak uprawnień w bazie (sprawdź reguły)" : "Błąd bazy (HTTP " + res.status + ")");
  }
  return res;
}

export const dbGet = async (path) => (await call(path)).json();
export const dbPut = (path, value) => call(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
export const dbDelete = (path) => call(path, { method: "DELETE" });
