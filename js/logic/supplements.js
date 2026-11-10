// Witaminy: { "YYYY-MM-DD": true }  (baza: "supplements_log")

import { addDays, asObject, formatDateKey, startOfDay } from "../lib/util.js";

// dzien tygodnia (0 = niedziela) -> co brac
export const SUPPLEMENT_SCHEDULE = {
  0: { name: "Żelazo", color: "#a9c4d9" },
  2: { name: "Żelazo", color: "#a9c4d9" },
  4: { name: "Żelazo", color: "#a9c4d9" },
  5: { name: "Witamina D", color: "#e8a25f" },
};

export function normalizeSuppLog(raw) {
  const out = {};
  for (const [k, v] of Object.entries(asObject(raw))) if (v === true) out[k] = true;
  return out;
}

export function scheduledFor(date, schedule = SUPPLEMENT_SCHEDULE) {
  return schedule[date.getDay()] || null;
}

/** Ile kolejnych zaplanowanych dawek wzieto, liczac od dzis wstecz.
 *  Dzisiejsza niewzieta dawka nie przerywa passy (dzien jeszcze trwa). */
export function computeStreak(log, today = new Date(), schedule = SUPPLEMENT_SCHEDULE) {
  let streak = 0;
  const start = startOfDay(today);
  for (let i = 0; i < 400; i++) {
    const d = addDays(start, -i);
    if (!schedule[d.getDay()]) continue;
    if (log[formatDateKey(d)]) streak++;
    else if (i !== 0) break;
  }
  return streak;
}

export function isRewardStreak(streak) {
  return streak > 0 && streak % 2 === 1;
}

/** Stan komorki w kalendarzu witamin. */
export function dayState(log, date, today = new Date(), schedule = SUPPLEMENT_SCHEDULE) {
  const t = startOfDay(today).getTime();
  const d = startOfDay(date).getTime();
  const scheduled = scheduledFor(date, schedule);
  const taken = !!log[formatDateKey(date)];
  return {
    scheduled,
    taken,
    isToday: d === t,
    isFuture: d > t,
    missed: !!scheduled && !taken && d < t,
  };
}

/** Co pokazac na ekranie glownym: dzisiejsza dawka do wziecia albo nic. */
export function todayReminder(log, today = new Date(), schedule = SUPPLEMENT_SCHEDULE) {
  const s = scheduledFor(today, schedule);
  if (!s || log[formatDateKey(today)]) return null;
  return s;
}

export function streakLabel(streak) {
  if (streak <= 0) return "Zacznij passę, biorąc dzisiejszą dawkę";
  return `Passa: ${streak} ${streak === 1 ? "dzień" : "dni"} 🔥`;
}

/** Wybierz zdjecie, ktorego jeszcze nie bylo; po przejsciu wszystkich — od nowa. */
export function pickUnseen(photos, shown, random = Math.random) {
  if (!photos.length) return { pick: null, shown };
  let seen = shown.filter((p) => photos.includes(p));
  let available = photos.filter((p) => !seen.includes(p));
  if (!available.length) { seen = []; available = photos; }
  const pick = available[Math.floor(random() * available.length)];
  return { pick, shown: [...seen, pick] };
}
