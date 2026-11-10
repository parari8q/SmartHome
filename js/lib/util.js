// Drobne, czyste funkcje pomocnicze — bez DOM, wiec da sie je testowac w Node.

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function formatDateKey(d) {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

export function parseDateKey(key) {
  const [y, m, d] = String(key).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Firebase zapisuje tablice jako obiekty z kluczami 0..n i kasuje puste
 *  tablice — po odczycie zawsze sprowadzamy dane do tablicy. */
export function asArray(v) {
  if (Array.isArray(v)) return v.filter((x) => x != null);
  if (v && typeof v === "object") return Object.values(v).filter((x) => x != null);
  return [];
}

export function asObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

export function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

/** Porownanie niezalezne od kolejnosci kluczy w obiektach. */
export function stableStringify(v) {
  if (v === undefined) return "undefined";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
}

export function deepEqual(a, b) {
  return stableStringify(a) === stableStringify(b);
}

export function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

let uidCounter = 0;
export function uid(prefix = "") {
  uidCounter = (uidCounter + 1) % 1296;
  return prefix + Date.now().toString(36) + uidCounter.toString(36).padStart(2, "0") +
    Math.random().toString(36).slice(2, 6);
}

export function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function plural(n, one, few, many) {
  if (n === 1) return one;
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
