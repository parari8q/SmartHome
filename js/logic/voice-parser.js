// ==========================================================================
// Rozumienie polecen glosowych (po polsku). Czysta funkcja: tekst -> polecenie.
//
//   "dodaj mleko do listy zakupów"              -> lista zakupow
//   "dodaj umyć podłogę w kategorii dom"        -> zadanie na liscie "dom"
//   "dentysta jutro o 15:30", "w środę o 18 kino" -> kalendarz
//
// UWAGA: \b w JS nie zna polskich liter (dla niego "ś" to nie litera), przez
// co "dziś" albo "w środę" wczesniej NIGDY nie byly rozpoznawane. Tu granice
// slow sa liczone po Unicode.
// ==========================================================================

import { addDays, capitalize, formatDateKey, pad2, startOfDay } from "../lib/util.js";

const W = "\\p{L}\\p{N}";
const B = `(?<![${W}])`; // poczatek slowa
const E = `(?![${W}])`;  // koniec slowa
const rx = (src) => new RegExp(src, "iu");
const rxg = (src) => new RegExp(src, "giu");

export const WEEKDAYS = [
  ["niedziela", "niedzielę", "niedziele"],
  ["poniedziałek", "poniedzialek"],
  ["wtorek"],
  ["środa", "środę", "sroda", "srode"],
  ["czwartek"],
  ["piątek", "piatek"],
  ["sobota", "sobotę", "sobote"],
];

export const MONTHS_GEN = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca",
  "sierpnia", "września", "października", "listopada", "grudnia"];

const NUMBER_WORDS = {
  jeden: 1, jedną: 1, dwa: 2, dwie: 2, trzy: 3, cztery: 4, pięć: 5, sześć: 6, siedem: 7,
  osiem: 8, dziewięć: 9, dziesięć: 10, czternaście: 14,
};

function toNumber(s) {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return NUMBER_WORDS[s.toLowerCase()] ?? null;
}

function validDate(y, m, d) {
  const date = new Date(y, m, d);
  return date.getFullYear() === y && date.getMonth() === m && date.getDate() === d ? date : null;
}

const NUM = `(\\d+|${Object.keys(NUMBER_WORDS).join("|")})`;

export function parseDate(text, now = new Date()) {
  const today = startOfDay(now);
  let m;

  if ((m = text.match(rx(`${B}pojutrze${E}`)))) return { date: addDays(today, 2), matched: m[0] };
  if ((m = text.match(rx(`${B}(?:dzisiaj|dziś|dzis)${E}`)))) return { date: today, matched: m[0] };
  if ((m = text.match(rx(`${B}jutro${E}`)))) return { date: addDays(today, 1), matched: m[0] };

  if ((m = text.match(rx(`${B}za\\s+tydzień${E}`)))) return { date: addDays(today, 7), matched: m[0] };
  if ((m = text.match(rx(`${B}za\\s+${NUM}\\s+(dni|dzień|tygodnie|tygodni)${E}`)))) {
    const n = toNumber(m[1]);
    if (n != null) return { date: addDays(today, /^tyg/i.test(m[2]) ? n * 7 : n), matched: m[0] };
  }

  for (let mi = 0; mi < MONTHS_GEN.length; mi++) {
    m = text.match(rx(`${B}(\\d{1,2})\\s+${MONTHS_GEN[mi]}(?:\\s+(\\d{4}))?${E}`));
    if (m) {
      const day = parseInt(m[1], 10);
      const explicitYear = m[2] ? parseInt(m[2], 10) : null;
      let d = validDate(explicitYear ?? today.getFullYear(), mi, day);
      if (d && !explicitYear && d < today) d = validDate(today.getFullYear() + 1, mi, day);
      if (d) return { date: d, matched: m[0] };
    }
  }

  m = text.match(rx(`${B}(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{2}|\\d{4}))?${E}`));
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const year = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : today.getFullYear();
    let d = validDate(year, month, day);
    if (d && !m[3] && d < today) d = validDate(year + 1, month, day);
    if (d) return { date: d, matched: m[0] };
  }

  for (let wi = 0; wi < WEEKDAYS.length; wi++) {
    const forms = WEEKDAYS[wi].join("|");
    m = text.match(rx(`${B}(?:(?:w|we)\\s+)?(?:(najbliższ[yąa]|najblizsz[yaą]|przyszł[yąa]|przyszl[ya]|następn[yąa]|nastepn[ya])\\s+)?(?:${forms})${E}`));
    if (m) {
      let diff = (wi - today.getDay() + 7) % 7;
      if (diff === 0 && m[1] && /^(przysz|nast)/i.test(m[1])) diff = 7;
      return { date: addDays(today, diff), matched: m[0] };
    }
  }

  return null;
}

export function parseTime(text) {
  let m;
  const finish = (h, min, matched, suffix) => {
    let hour = parseInt(h, 10);
    const minute = min ? parseInt(min, 10) : 0;
    if (suffix && /wiecz|po\s+połud|po\s+polud|w\s+nocy/i.test(suffix) && hour < 12) hour += 12;
    if (hour > 23 || minute > 59) return null;
    return { time: pad2(hour) + ":" + pad2(minute), matched };
  };
  const SUFFIX = `(?:\\s+(rano|wieczorem|wieczór|po\\s+południu|po\\s+poludniu|w\\s+nocy))?`;

  // "o godzinie 15", "o godz. 15:30", "godzina 7 rano"
  m = text.match(rx(`${B}(?:o\\s+)?(?:godzinie|godz\\.?|godzina)\\s+(\\d{1,2})(?:[:.,](\\d{2}))?${SUFFIX}${E}`));
  if (m) return finish(m[1], m[2], m[0], m[3]);
  // "o 15:30", "na 15.30"
  m = text.match(rx(`${B}(?:o|na)\\s+(\\d{1,2})[:.,](\\d{2})${SUFFIX}${E}`));
  if (m) return finish(m[1], m[2], m[0], m[3]);
  // "o 15", "o 7 wieczorem"
  m = text.match(rx(`${B}o\\s+(\\d{1,2})${SUFFIX}${E}`));
  if (m) return finish(m[1], null, m[0], m[2]);
  // samo "15:30"
  m = text.match(rx(`${B}(\\d{1,2}):(\\d{2})${E}`));
  if (m) return finish(m[1], m[2], m[0]);
  return null;
}

function cut(text, part) {
  const i = text.toLowerCase().indexOf(part.toLowerCase());
  return i === -1 ? text : text.slice(0, i) + " " + text.slice(i + part.length);
}

function tidy(s) {
  return s.replace(/\s+/g, " ").replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "").trim();
}

const VERBS = `(?:dodaj|dopisz|wpisz|zapisz|stwórz|stworz|utwórz|utworz|ustaw|umów|umow|zaplanuj|przypomnij(?:\\s+mi)?)`;

export function parseCalendarCommand(text, now = new Date()) {
  let working = ` ${text} `;
  // godzina najpierw — inaczej "15.30" mogloby zostac wziete za date
  const time = parseTime(working);
  if (time) working = cut(working, time.matched);
  const date = parseDate(working, now);
  if (!date) return null;
  working = cut(working, date.matched);

  working = working
    .replace(rxg(`${B}${VERBS}${E}`), " ")
    .replace(rxg(`${B}(?:wydarzenie|przypomnienie)${E}`), " ")
    .replace(rxg(`${B}(?:do\\s+kalendarza|w\\s+kalendarzu|kalendarz)${E}`), " ");
  working = tidy(working).replace(rx(`^(?:na|w|we|dnia|że|ze|o)${E}\\s*`), "");
  working = tidy(working).replace(rx(`\\s+(?:na|w|we|o|dnia)$`), "");
  working = tidy(working);
  if (!working) return null;

  return { type: "calendar", dateKey: formatDateKey(date.date), date: date.date, time: time ? time.time : "", title: capitalize(working) };
}

export function parseShoppingCommand(text) {
  const m = text.match(rx(`^\\s*${VERBS}\\s+(.+?)\\s+(?:do|na)\\s+(?:listy\\s+|liście\\s+)?zakupów${E}`))
    || text.match(rx(`^\\s*(?:kup|kupić|musimy\\s+kupić|trzeba\\s+kupić)\\s+(.+)$`));
  if (!m) return null;
  const items = m[1].split(rx(`\\s*,\\s*|\\s+i\\s+|\\s+oraz\\s+`)).map(tidy).filter(Boolean);
  return items.length ? { type: "shopping", items } : null;
}

export function parseTodoCommand(text) {
  const m = text.match(rx(
    `${VERBS}\\s+(?:do\\s+listy\\s+zada[nń]\\s+)?(?:zadanie\\s+)?(.+?)\\s+(?:w|do|na)\\s+(?:kategorii|kategorię|listy|liście|listę)\\s+(.+)$`));
  if (!m) return null;
  const task = tidy(m[1]);
  const list = tidy(m[2]);
  if (!task || !list) return null;
  return { type: "todo", list, text: task };
}

/** Glowne wejscie: zawsze zwraca obiekt z polem `type`. */
export function parseVoiceCommand(text, now = new Date()) {
  const t = String(text || "").trim();
  if (!t) return { type: "unknown", text: t };
  return parseShoppingCommand(t)
    || parseTodoCommand(t)
    || parseCalendarCommand(t, now)
    || { type: "unknown", text: t };
}
