// Kalendarz: { "YYYY-MM-DD": [{ id, time, title }] }  (baza: "calendar_events")

import { addDays, asArray, asObject, formatDateKey, parseDateKey, startOfDay, uid } from "../lib/util.js";

export function normalizeEvent(e) {
  return { id: String(e.id || uid("ev_")), time: typeof e.time === "string" ? e.time : "", title: String(e.title ?? "") };
}

export function normalizeCalendar(raw) {
  const out = {};
  for (const [key, list] of Object.entries(asObject(raw))) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const events = asArray(list).filter((e) => e && typeof e === "object").map(normalizeEvent);
    if (events.length) out[key] = events;
  }
  return out;
}

export function sortEvents(list) {
  return [...list].sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
}

export function eventsForDay(cal, dateKey) {
  return sortEvents(cal[dateKey] || []);
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

/** Najblizsze wydarzenia od dzis (wlacznie), max `limit`. */
export function upcomingEvents(cal, from = new Date(), days = 7, limit = 4) {
  const out = [];
  const start = startOfDay(from);
  for (let i = 0; i < days && out.length < limit; i++) {
    const d = addDays(start, i);
    const key = formatDateKey(d);
    for (const ev of eventsForDay(cal, key)) {
      out.push({ ...ev, dateKey: key, dayOffset: i });
      if (out.length >= limit) break;
    }
  }
  return out;
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
