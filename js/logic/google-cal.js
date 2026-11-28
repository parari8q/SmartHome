// Wydarzenia z Kalendarzy Google czlonkow (tylko do odczytu w aplikacji).
// Zapisuje je skrypt Google Apps Script (tools/google-calendar-sync.gs) pod
// "calendar_google/<uid>": { name, updatedAt, events: [{ id, title, date, to?, time?, end?, link? }] }

import { asArray, asObject } from "../lib/util.js";

const KEY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

/** Kolory osob — wspolne z aplikacja i skryptem: kolejnosc = posortowane uid czlonkow grupy. */
export const PERSON_COLORS = ["#7db2ff", "#f5a3c7", "#f5b65a", "#b39dff", "#6fd6e0", "#e3dc8c"];
export const SHARED_COLOR = "#5fd39a";
export const GOOGLE_COLOR = "#9aa4b2"; // wydarzenia z Google, gdy nie ma grupy

export function normalizeGoogle(raw) {
  const out = {};
  for (const [uid, v] of Object.entries(asObject(raw))) {
    if (!v || typeof v !== "object") continue;
    const events = asArray(v.events).filter((e) => e && typeof e === "object" && KEY.test(e.date || "")).map((e) => {
      const ev = { id: String(e.id ?? ""), title: String(e.title ?? "").slice(0, 200) || "(bez tytułu)", date: e.date };
      if (KEY.test(e.to || "") && e.to > e.date) ev.to = e.to;
      if (TIME.test(e.time || "")) { ev.time = e.time; if (TIME.test(e.end || "")) ev.end = e.end; }
      if (typeof e.link === "string" && /^https:\/\/(www\.)?google\.com\/calendar\//.test(e.link)) ev.link = e.link;
      return ev;
    });
    out[uid] = { name: String(v.name ?? ""), updatedAt: Number(v.updatedAt) || 0, events };
  }
  return out;
}

/** Wydarzenia Google trwajace danego dnia, w ksztalcie jak wydarzenia aplikacji (z flaga google). */
export function googleOnDay(doc, dayKey) {
  const out = [];
  for (const [uid, v] of Object.entries(doc || {})) {
    for (const e of v.events || []) {
      if (dayKey < e.date || dayKey > (e.to || e.date)) continue;
      out.push({
        id: "g:" + uid + ":" + e.id, title: e.title, time: e.time || "", ...(e.end ? { end: e.end } : {}),
        ...(e.to ? { to: e.to } : {}), startKey: e.date, occKey: e.date, dateKey: dayKey, multi: !!e.to,
        google: true, who: uid, link: e.link || null, ownerName: v.name || "",
      });
    }
  }
  return out;
}

/** Wszystkie wydarzenia Google zaczynajace sie (albo trwajace) w przedziale — kazde raz. */
export function googleInRange(doc, fromKey, toKey) {
  const out = [];
  for (const [uid, v] of Object.entries(doc || {})) {
    for (const e of v.events || []) {
      if ((e.to || e.date) < fromKey || e.date > toKey) continue;
      out.push(...googleOnDay({ [uid]: { ...v, events: [e] } }, e.date < fromKey ? fromKey : e.date).map((x) => ({ ...x, occKey: e.date })));
    }
  }
  return out;
}
