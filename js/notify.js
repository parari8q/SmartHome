// ==========================================================================
// Powiadomienia dla pozostalych osob z grupy przez ntfy (darmowa aplikacja
// na telefon: Google Play / App Store). Kazda osoba ma WLASNY temat ntfy,
// wiec dostaje powiadomienia o zmianach innych — nie o swoich.
//
// Zmiany sa zbierane przez chwile (np. 5 produktow dodanych pod rzad =
// jedno powiadomienie "Ania dodala do zakupow: mleko, chleb, ...").
// ==========================================================================

import { auth } from "./db.js";
import { currentGroup, refreshGroupIfStale, DEFAULT_NOTIFY } from "./groups.js";

export const NTFY_SERVER = "https://ntfy.sh";

export const CATEGORIES = {
  shopping: { label: "Zakupy", verb: "dodał(a) do zakupów", tag: "shopping_cart" },
  calendar: { label: "Kalendarz", verb: "dodał(a) do kalendarza", tag: "date" },
  todo: { label: "Zadania", verb: "dodał(a) zadanie", tag: "white_check_mark" },
  recipes: { label: "Przepisy", verb: "dodał(a) przepis", tag: "cook" },
};

const BATCH_MS = 2500;
// 4 = "wysoki": na Androidzie powiadomienie wyskakuje u gory ekranu (przy 3 laduje tylko na liscie)
const PRIORITY = 4;
const pending = new Map(); // kategoria -> { items: [], timer }
let sender = (payload) => fetch(NTFY_SERVER + "/", { method: "POST", body: JSON.stringify(payload) }); // text/plain = bez preflight CORS

export function _setSenderForTests(fn) { sender = fn; }

/** Adres otwierany po kliknieciu powiadomienia: od razu wlasciwy widok
 *  (dzien w kalendarzu, lista zadan, przepis). Kilka roznych miejsc w jednym
 *  powiadomieniu -> ogolny widok kategorii. */
export function buildClickUrl(category, targets, base) {
  const p = new URLSearchParams();
  const list = targets.map((t) => t || {});
  const common = (key) => {
    const values = [...new Set(list.map((t) => t[key]))];
    return values.length === 1 && values[0] ? values[0] : null;
  };
  const single = list.length === 1 ? list[0] : null;
  if (category === "shopping") p.set("otworz", "zakupy");
  if (category === "calendar") {
    p.set("otworz", "kalendarz");
    const day = common("day");
    if (day) p.set("dzien", day);
    if (day && single?.eventId) p.set("wpis", single.eventId);
  }
  if (category === "todo") {
    p.set("otworz", "zadania");
    const listId = common("listId");
    if (listId) p.set("lista", listId);
    if (listId && single?.taskId) p.set("wpis", single.taskId);
  }
  if (category === "recipes") {
    p.set("otworz", "przepisy");
    if (single?.recipeId) p.set("przepis", single.recipeId);
  }
  return base + "?" + p.toString();
}

/** Zglos zmiane. text: np. "mleko" albo "Dentysta — jutro 15:30".
 *  target: gdzie to jest, np. { day, eventId } / { listId, taskId } / { recipeId }. */
export function notifyGroup(category, text, target = null) {
  const group = currentGroup();
  if (!group || !CATEGORIES[category] || !text) return;
  const entry = pending.get(category) || { items: [], targets: [], timer: null };
  entry.items.push(String(text));
  entry.targets.push(target);
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => flush(category), BATCH_MS);
  pending.set(category, entry);
}

export function flushAll() {
  for (const c of [...pending.keys()]) flush(c);
}

function myName(group) {
  return group.profiles?.[auth.uid]?.name || (auth.email || "").split("@")[0] || "Ktoś";
}

async function flush(category) {
  const entry = pending.get(category);
  pending.delete(category);
  if (!entry || !entry.items.length) return;
  clearTimeout(entry.timer);
  const group = (await refreshGroupIfStale()) || currentGroup();
  if (!group) return;
  const cat = CATEGORIES[category];
  const items = [...new Set(entry.items)];
  const message = items.length > 6 ? items.slice(0, 6).join(", ") + ` i ${items.length - 6} więcej` : items.join(", ");
  const recipients = Object.entries(group.profiles || {})
    .filter(([uid, p]) => uid !== auth.uid && group.members?.[uid] && p?.ntfyTopic && (p.notify ?? DEFAULT_NOTIFY)[category] !== false);
  await Promise.all(recipients.map(([, p]) => sender({
    topic: p.ntfyTopic,
    title: `${myName(group)} ${cat.verb}`,
    message,
    tags: [cat.tag],
    priority: PRIORITY,
    click: buildClickUrl(category, entry.targets, location.origin + location.pathname),
  }).catch((err) => console.warn("Powiadomienie nie wysłane:", err))));
}

/** Testowe powiadomienie na wlasny telefon (Ustawienia -> Powiadomienia). */
export function sendTestNotification(topic) {
  return sender({ topic, title: "Dashboard domowy", message: "Działa! Tak będą wyglądać powiadomienia o zmianach w grupie.", tags: ["tada"], priority: PRIORITY });
}

export const NTFY_PLAY_URL = "https://play.google.com/store/apps/details?id=io.heckel.ntfy";
export const NTFY_APPSTORE_URL = "https://apps.apple.com/app/ntfy/id1625396347";

/** Na czym dziala strona — od tego zalezy, jak wlaczyc powiadomienia. */
export function detectPlatform(ua = (typeof navigator !== "undefined" ? navigator.userAgent : "")) {
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1)) return "ios";
  return "desktop";
}

/** Link subskrybujacy temat w aplikacji ntfy na Androidzie.
 *  "intent://" zamiast "ntfy://": Chrome i przegladarki w trybie kiosku czesto blokuja
 *  nieznane schematy, a intent dziala zawsze i bez aplikacji otwiera sklep Play. */
export function ntfySubscribeLink(topic, platform = detectPlatform()) {
  const path = `ntfy.sh/${encodeURIComponent(topic)}?display=${encodeURIComponent("Dashboard domowy")}`;
  if (platform === "android") {
    return `intent://${path}#Intent;scheme=ntfy;package=io.heckel.ntfy;S.browser_fallback_url=${encodeURIComponent(NTFY_PLAY_URL)};end`;
  }
  return `ntfy://${path}`;
}

// zanim strona sie zamknie, wyslij zebrane zmiany
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushAll);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushAll(); });
}
