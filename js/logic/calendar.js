// Kalendarz: { "YYYY-MM-DD": [wydarzenie] }  (baza: "calendar_events")
// Klucz = dzien rozpoczecia. Wydarzenie:
//   { id, title, time: "18:00" | "" (caly dzien), end?: "19:30", to?: "YYYY-MM-DD" (kilka dni),
//     repeat?: { freq: "week"|"month"|"year", days?: [0-6] (dla tygodnia), until?: "YYYY-MM-DD" },
//     skip?: { "YYYY-MM-DD": true } (pominiete powtorzenia), who?: uid | "all" }

import { addDays, asArray, asObject, formatDateKey, parseDateKey, startOfDay, uid, pad2, capitalize } from "../lib/util.js";
import { parseDate, parseTime } from "./voice-parser.js";

const KEY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

export function normalizeEvent(e) {
  const out = { id: String(e.id || uid("ev_")), time: typeof e.time === "string" && TIME.test(e.time) ? e.time : "", title: String(e.title ?? "") };
  if (out.time && typeof e.end === "string" && TIME.test(e.end)) out.end = e.end;
  if (typeof e.to === "string" && KEY.test(e.to)) out.to = e.to;
  const r = e.repeat;
  if (r && typeof r === "object" && ["week", "month", "year"].includes(r.freq)) {
    out.repeat = { freq: r.freq };
    const days = asArray(r.days).map(Number).filter((d) => d >= 0 && d <= 6);
    if (r.freq === "week" && days.length) out.repeat.days = [...new Set(days)].sort();
    if (typeof r.until === "string" && KEY.test(r.until)) out.repeat.until = r.until;
  }
  const skip = Object.keys(asObject(e.skip)).filter((k) => KEY.test(k));
  if (skip.length) out.skip = Object.fromEntries(skip.map((k) => [k, true]));
  if (typeof e.who === "string" && e.who) out.who = e.who;
  return out;
}

export function normalizeCalendar(raw) {
  const out = {};
  for (const [key, list] of Object.entries(asObject(raw))) {
    if (!KEY.test(key)) continue;
    const events = asArray(list).filter((e) => e && typeof e === "object").map(normalizeEvent);
    if (events.length) out[key] = events;
  }
  return out;
}

export function sortEvents(list) {
  return [...list].sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
}

/** Wydarzenia zapisane pod danym dniem (bez powtorzen) — do edycji. */
export function eventsForDay(cal, dateKey) {
  return sortEvents(cal[dateKey] || []);
}

const dayDiff = (a, b) => Math.round((parseDateKey(b) - parseDateKey(a)) / 86400000);

/** Jesli wydarzenie (zaczynajace sie startKey) trwa w dniu dayKey — data poczatku tego wystapienia, inaczej null. */
export function occurrenceStart(ev, startKey, dayKey) {
  if (dayKey < startKey) return null;
  const span = ev.to && ev.to > startKey ? dayDiff(startKey, ev.to) : 0; // ile dni trwa (0 = jeden dzien)
  const r = ev.repeat;
  if (!r) return dayDiff(startKey, dayKey) <= span ? startKey : null;
  // sprawdzamy kandydatow na poczatek wystapienia: dayKey, dayKey-1, ... dayKey-span
  for (let back = 0; back <= span; back++) {
    const occ = formatDateKey(addDays(parseDateKey(dayKey), -back));
    if (occ < startKey) break;
    if (r.until && occ > r.until) continue;
    if (ev.skip?.[occ]) continue;
    const s = parseDateKey(startKey), o = parseDateKey(occ);
    let hit = false;
    if (r.freq === "week") hit = (r.days?.length ? r.days : [s.getDay()]).includes(o.getDay());
    else if (r.freq === "month") hit = o.getDate() === s.getDate();
    else if (r.freq === "year") hit = o.getDate() === s.getDate() && o.getMonth() === s.getMonth();
    if (hit) return occ;
  }
  return null;
}

/** Wszystko, co dzieje sie danego dnia (z powtorzeniami i wydarzeniami kilkudniowymi). */
export function eventsOnDay(cal, dayKey) {
  const out = [];
  for (const [startKey, list] of Object.entries(cal)) {
    if (startKey > dayKey) continue;
    for (const ev of list) {
      const occ = occurrenceStart(ev, startKey, dayKey);
      if (occ) out.push({ ...ev, startKey, occKey: occ, dateKey: dayKey, multi: !!(ev.to && ev.to > startKey) });
    }
  }
  // najpierw caly dzien / kilka dni, potem wg godziny
  return out.sort((a, b) => (a.time || "00:00").localeCompare(b.time || "00:00") || a.title.localeCompare(b.title, "pl"));
}

/** Ostatni dzien danego wystapienia wydarzenia kilkudniowego (ev z eventsOnDay). */
export function occurrenceEnd(ev) {
  if (!ev.to || !ev.startKey) return ev.occKey || ev.dateKey;
  return formatDateKey(addDays(parseDateKey(ev.occKey), dayDiff(ev.startKey, ev.to)));
}

/** Wystapienia w przedziale dni [fromKey, toKey]; wydarzenie kilkudniowe tylko raz (w dniu poczatku albo fromKey). */
export function occurrences(cal, fromKey, toKey) {
  const out = [];
  const seen = new Set();
  for (let d = parseDateKey(fromKey); formatDateKey(d) <= toKey; d = addDays(d, 1)) {
    const key = formatDateKey(d);
    for (const ev of eventsOnDay(cal, key)) {
      const id = ev.id + "@" + ev.occKey;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(ev);
    }
  }
  return out;
}

/** Usuniecie wystapienia: "one" = tylko ten dzien, "following" = ten i kolejne, "all" = cale wydarzenie.
 *  Zwraca nowa liste dnia startKey (null = pusty dzien). */
export function deleteOccurrence(cal, startKey, eventId, occKey, mode = "all") {
  const list = cal[startKey] || [];
  const ev = list.find((e) => e.id === eventId);
  if (!ev) return list.length ? list : null;
  if (!ev.repeat || mode === "all" || (mode === "following" && occKey <= startKey)) return deleteEvent(cal, startKey, eventId);
  const next = mode === "one"
    ? { ...ev, skip: { ...(ev.skip || {}), [occKey]: true } }
    : { ...ev, repeat: { ...ev.repeat, until: formatDateKey(addDays(parseDateKey(occKey), -1)) } };
  return list.map((e) => (e.id === eventId ? next : e));
}

/** Zapis wydarzenia (nowego albo edytowanego, takze przeniesionego na inny dzien).
 *  Zwraca liste zapisow [[dzien, nowaLista | null], ...]. */
export function saveEvent(cal, { oldKey = null, newKey, event }) {
  const ev = normalizeEvent(event);
  ev.title = ev.title.trim();
  const writes = [];
  if (oldKey && oldKey !== newKey) writes.push([oldKey, deleteEvent(cal, oldKey, ev.id)]);
  const base = (cal[newKey] || []).filter((e) => e.id !== ev.id);
  const idx = (cal[newKey] || []).findIndex((e) => e.id === ev.id);
  const list = [...base];
  if (idx >= 0 && oldKey === newKey) list.splice(idx, 0, ev); else list.push(ev);
  writes.push([newKey, list]);
  return writes;
}

/** Godzina konca dla poczatku i dlugosci w minutach ("18:00", 90 -> "19:30"). */
export function addMinutes(time, minutes) {
  if (!TIME.test(time || "") || !minutes) return "";
  const [h, m] = time.split(":").map(Number);
  const t = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return pad2(Math.floor(t / 60)) + ":" + pad2(t % 60);
}

export function durationMinutes(ev) {
  if (!ev.time || !ev.end) return 0;
  const [a, b] = [ev.time, ev.end].map((t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; });
  return b > a ? b - a : 0;
}

const WEEKDAY_SHORT = ["nd", "pn", "wt", "śr", "cz", "pt", "sb"];
/** "co tydzień (wt, pt)", "co miesiąc", "co rok" albo "". */
export function repeatLabel(ev) {
  const r = ev.repeat;
  if (!r) return "";
  if (r.freq === "week") {
    const days = r.days?.length > 1 ? " (" + r.days.map((d) => WEEKDAY_SHORT[d]).join(", ") + ")" : "";
    return "co tydzień" + days;
  }
  return r.freq === "month" ? "co miesiąc" : "co rok";
}

/** Szybkie dodawanie: "jutro 18 trening", "pt 9:30 dentysta", "trening". */
export function parseQuickAdd(text, now = new Date()) {
  let working = ` ${String(text || "")} `;
  let time = parseTime(working);
  if (time) working = working.replace(time.matched, " ");
  const date = parseDate(working, now);
  if (date) working = working.replace(date.matched, " ");
  if (!time) { // samo "18" albo "o 18"
    const m = working.match(/(?:^|\s)(?:o\s+)?([5-9]|1\d|2[0-3])(?:\s|$)/u); // 5-23: \"2 piwa\" to nie godzina
    if (m && (date || /^\s*(?:o\s+)?\d/.test(working))) { time = { time: pad2(+m[1]) + ":00" }; working = working.replace(m[0], " "); }
  }
  const title = capitalize(working.replace(/\s+/g, " ").replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "").replace(/^(?:o|na|w|we)\s+/iu, ""));
  return { title, dateKey: date ? formatDateKey(date.date) : null, time: time ? time.time : null };
}

/** Zwraca NOWA liste wydarzen dnia (do zapisu pod sciezka dateKey). */
export function addEvent(cal, dateKey, { time = "", title }, id = uid("ev_")) {
  return [...(cal[dateKey] || []), { id, time, title: title.trim() }];
}

export function updateEvent(cal, dateKey, eventId, { time, title }) {
  return (cal[dateKey] || []).map((e) =>
    e.id === eventId ? { ...e, time: time ?? e.time, title: (title ?? e.title).trim() || e.title } : e);
}

/** null => dzien bez wydarzen (usuwamy klucz z bazy). */
export function deleteEvent(cal, dateKey, eventId) {
  const list = (cal[dateKey] || []).filter((e) => e.id !== eventId);
  return list.length ? list : null;
}

/** Najblizsze wydarzenia od dzis (wlacznie, z powtorzeniami), max `limit`. */
export function upcomingEvents(cal, from = new Date(), days = 7, limit = 4) {
  const start = startOfDay(from);
  const fromKey = formatDateKey(start);
  return occurrences(cal, fromKey, formatDateKey(addDays(start, days - 1)))
    .slice(0, limit)
    .map((ev) => {
      const key = ev.occKey < fromKey ? fromKey : ev.occKey;
      return { ...ev, dateKey: key, dayOffset: dayDiff(fromKey, key) };
    });
}

/** Siatka miesiaca od poniedzialku: null = puste pole przed 1. dniem. */
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d));
  return cells;
}

export function dayLabel(dateKey) {
  return parseDateKey(dateKey).toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function relativeDayLabel(offset, dateKey) {
  if (offset === 0) return "Dziś";
  if (offset === 1) return "Jutro";
  return parseDateKey(dateKey).toLocaleDateString("pl-PL", { weekday: "short", day: "numeric", month: "short" });
}
