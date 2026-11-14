// ==========================================================================
// Lista zakupow: [{ text, checked, recipes?: ["Nalesniki", ...] }]  (baza: "shopping_list")
//
// Laczenie tych samych produktow: "200 g masla" (Ciasto) + "50 g masla" (Nalesniki)
//   -> "250 g masla (Ciasto, Nalesniki)"
// Rozpoznaje odmiane (maslo/masla, jajko/jajka), przelicza dag/kg -> g i l -> ml,
// a gdy jednostek nie da sie dodac, zapisuje obie: "200 g + 2 łyżki masła".
// ==========================================================================

import { asArray } from "../lib/util.js";

const FRACTIONS = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };

// jednostka -> [nazwa podstawowa, mnoznik do podstawowej]
const UNIT_TABLE = [
  [/^(?:g|gr|gram(?:y|ów|a)?)$/i, "g", 1],
  [/^(?:dag|dkg)$/i, "g", 10],
  [/^(?:kg|kilo(?:gram(?:y|ów|a)?)?)$/i, "g", 1000],
  [/^(?:ml|mililitr(?:y|ów|a)?)$/i, "ml", 1],
  [/^(?:l|litr(?:y|ów|a)?)$/i, "ml", 1000],
  [/^(?:łyżk[aięy]|łyżek|łyż\.?|tbsp)$/i, "łyżka", 1],
  [/^(?:łyżeczk[aięy]|łyżeczek|łyżecz\.?|tsp)$/i, "łyżeczka", 1],
  [/^(?:szklank[aięy]|szklanek|szkl\.?|cup|cups)$/i, "szklanka", 1],
  [/^(?:szt\.?|sztuk[aiy]?)$/i, "szt", 1],
  [/^(?:opakowani[ea]|opakowań|opak\.?|op\.?)$/i, "opakowanie", 1],
  [/^(?:puszk[aię]|puszek)$/i, "puszka", 1],
  [/^(?:ząb(?:ek|ki|ków)|ząbki)$/i, "ząbek", 1],
  [/^(?:szczypt[aęy])$/i, "szczypta", 1],
  [/^(?:garść|garści)$/i, "garść", 1],
  [/^(?:pęczek|pęczka|pęczki|pęczków)$/i, "pęczek", 1],
  [/^(?:kostk[aię]|kostek)$/i, "kostka", 1],
  [/^(?:plaster(?:ek|ki|ków)?|plastr(?:y|ów)?)$/i, "plaster", 1],
];

const UNIT_FORMS = {
  łyżka: ["łyżka", "łyżki", "łyżek"],
  łyżeczka: ["łyżeczka", "łyżeczki", "łyżeczek"],
  szklanka: ["szklanka", "szklanki", "szklanek"],
  opakowanie: ["opakowanie", "opakowania", "opakowań"],
  puszka: ["puszka", "puszki", "puszek"],
  ząbek: ["ząbek", "ząbki", "ząbków"],
  szczypta: ["szczypta", "szczypty", "szczypt"],
  garść: ["garść", "garści", "garści"],
  pęczek: ["pęczek", "pęczki", "pęczków"],
  kostka: ["kostka", "kostki", "kostek"],
  plaster: ["plaster", "plastry", "plastrów"],
};

function unitInfo(word) {
  for (const [re, base, mult] of UNIT_TABLE) if (re.test(word)) return { base, mult };
  return null;
}

function parseNumber(s) {
  s = s.trim();
  if (FRACTIONS[s] != null) return FRACTIONS[s];
  let m;
  if ((m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + +m[2] / +m[3];          // 1 1/2
  if ((m = s.match(/^(\d+)\s*([½¼¾⅓⅔])$/))) return +m[1] + FRACTIONS[m[2]];           // 1½
  if ((m = s.match(/^(\d+)\/(\d+)$/))) return +m[1] / +m[2];                           // 1/2
  if (/^\d+(?:[.,]\d+)?$/.test(s)) return parseFloat(s.replace(",", "."));             // 1,5
  if (/^pół$/i.test(s)) return 0.5;
  return null;
}

const NUM = String.raw`(?:\d+\s+\d+\/\d+|\d+\s*[½¼¾⅓⅔]|\d+\/\d+|\d+(?:[.,]\d+)?|[½¼¾⅓⅔]|pół)`;
const LEADING = new RegExp(String.raw`^(${NUM})(?:\s*[-–]\s*${NUM})?\s*([\p{L}.]+)?\s+(.+)$`, "iu");
const TRAILING = new RegExp(String.raw`^(.+?)\s+[–-]\s+(.+)$`, "u");

function plural(n, forms) {
  if (Math.abs(n - 1) < 1e-9) return forms[0];
  const int = Math.round(n);
  if (Math.abs(n - int) > 1e-9) return forms[1]; // ulamki: "1,5 łyżki"
  const mod10 = int % 10, mod100 = int % 100;
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? forms[1] : forms[2];
}

function fmtNumber(n, fractions = true) {
  const r = Math.round(n * 100) / 100;
  if (!fractions) return String(r).replace(".", ",");
  const whole = Math.floor(r + 1e-9);
  const frac = r - whole;
  const nice = { 0.5: "½", 0.25: "¼", 0.75: "¾" }[Math.round(frac * 100) / 100];
  if (frac > 1e-9 && nice) return whole ? `${whole}${nice}` : nice;
  return String(r).replace(".", ",");
}

function fmtAmount(value, base) {
  // jednostki metryczne dziesietnie ("1,25 l"), kuchenne ulamkami ("1½ szklanki")
  if (base === "g" && value >= 1000) return `${fmtNumber(value / 1000, false)} kg`;
  if (base === "ml" && value >= 1000) return `${fmtNumber(value / 1000, false)} l`;
  if (base === "g" || base === "ml") return `${fmtNumber(value, false)} ${base}`;
  if (base === "szt") return fmtNumber(value);
  return `${fmtNumber(value)} ${UNIT_FORMS[base] ? plural(value, UNIT_FORMS[base]) : base}`;
}

/** "200 g masła" -> { amounts: [{value:200, base:"g"}], name: "masła", style: "pre" } */
export function parseIngredient(raw) {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  let m;
  // "masło – 200 g" (tabelki ze stron)
  if ((m = text.match(TRAILING))) {
    const q = parseQty(m[2]);
    if (q) return { name: m[1].trim(), amounts: [q], style: "post" };
  }
  // "200 g masła", "2 jajka", "pół szklanki mleka"
  if ((m = text.match(LEADING))) {
    const value = parseNumber(m[1]);
    const isRange = /[-–]/.test(text.slice(0, text.indexOf(m[3])));
    let unit = m[2] ? unitInfo(m[2].replace(/\.$/, "") ) || unitInfo(m[2]) : null;
    let name = m[3];
    if (!unit && m[2]) name = m[2] + " " + m[3]; // "2 duże jajka" — "duże" to nie jednostka
    if (value != null && !isRange) {
      const u = unit || { base: "szt", mult: 1 };
      return { name: name.trim(), amounts: [{ value: value * u.mult, base: u.base }], style: "pre" };
    }
    return { name: name.trim(), amounts: [{ raw: text.slice(0, text.length - m[3].length).trim() + (unit || !m[2] ? "" : "") }], style: "pre" };
  }
  // "szczypta soli", "sól do smaku"
  if ((m = text.match(/^(szczypt[aęy]|garść|kilka|parę)\s+(.+)$/iu))) {
    const u = unitInfo(m[1]);
    return { name: m[2], amounts: [u ? { value: 1, base: u.base } : { raw: m[1] }], style: "pre" };
  }
  return { name: text, amounts: [], style: "pre" };
}

function parseQty(s) {
  const m = s.trim().match(new RegExp(String.raw`^(${NUM})\s*([\p{L}.]+)?$`, "iu"));
  if (m) {
    const value = parseNumber(m[1]);
    const unit = m[2] ? unitInfo(m[2].replace(/\.$/, "")) || unitInfo(m[2]) : { base: "szt", mult: 1 };
    if (value != null && unit) return { value: value * unit.mult, base: unit.base };
  }
  return s.trim() ? { raw: s.trim() } : null;
}

/** Klucz produktu niezalezny od ilosci i odmiany: "200 g masła" i "masło" -> "masł". */
export function productKey(raw) {
  const { name } = parseIngredient(raw);
  return name
    .toLocaleLowerCase("pl")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^\p{L}\d\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length >= 4 ? w.slice(0, -1) : w))
    .join(" ");
}

function addAmounts(a, b) {
  const out = a.map((x) => ({ ...x }));
  for (const amt of b) {
    const same = amt.base && out.find((x) => x.base === amt.base);
    if (same) same.value += amt.value;
    else if (!amt.base && out.some((x) => x.raw === amt.raw)) continue;
    else out.push({ ...amt });
  }
  return out;
}

function render({ name, amounts, style }) {
  if (!amounts.length) return name;
  const qty = amounts.map((a) => (a.base ? fmtAmount(a.value, a.base) : a.raw)).join(" + ");
  return style === "post" ? `${name} – ${qty}` : `${qty} ${name}`;
}

/** Polacz dwie pozycje w jedna (ilosci zsumowane, przepisy z obu). */
function combine(itemA, itemB) {
  const a = parseIngredient(itemA.text);
  const b = parseIngredient(itemB.text);
  // pozycja bez ilosci ("masło") + z iloscia -> ilosc wystarczy
  // nazwa z tej pozycji, ktora ma ilosc ("500 ml mleka", nie "500 ml mleko")
  const lead = !a.amounts.length && b.amounts.length ? b : a;
  const merged = { name: lead.name, style: lead.style, amounts: addAmounts(a.amounts, b.amounts) };
  const recipes = [...new Set([...(itemA.recipes || []), ...(itemB.recipes || [])])];
  return { text: render(merged), checked: false, ...(recipes.length ? { recipes } : {}) };
}

export function normalizeShopping(raw) {
  return asArray(raw)
    .filter((i) => i && typeof i === "object" && String(i.text ?? "").trim())
    .map((i) => {
      const recipes = asArray(i.recipes).map(String).filter(Boolean);
      return { text: String(i.text), checked: !!i.checked, ...(recipes.length ? { recipes } : {}) };
    });
}

/** Dodaj produkty do listy, laczac je z tymi samymi, jeszcze niekupionymi.
 *  recipeName: z jakiego przepisu (trafia do nawiasu) albo null dla dopisanych recznie. */
export function addToShopping(list, texts, recipeName = null) {
  const next = list.map((i) => ({ ...i }));
  let added = 0;
  for (const raw of texts) {
    const text = String(raw || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const item = { text, checked: false, ...(recipeName ? { recipes: [recipeName] } : {}) };
    const key = productKey(text);
    const idx = next.findIndex((i) => !i.checked && productKey(i.text) === key);
    if (idx === -1) { next.push(item); added++; }
    else next[idx] = combine(next[idx], item);
  }
  return { list: next, added };
}

/** Ile pozycji da sie polaczyc (powtorki wsrod niekupionych). */
export function countDuplicates(list) {
  const seen = new Set();
  let dup = 0;
  for (const i of list) {
    if (i.checked) continue;
    const k = productKey(i.text);
    if (seen.has(k)) dup++;
    else seen.add(k);
  }
  return dup;
}

/** Polacz powtarzajace sie pozycje, ktore juz sa na liscie. */
export function mergeDuplicates(list) {
  const out = [];
  for (const i of list) {
    const idx = i.checked ? -1 : out.findIndex((o) => !o.checked && productKey(o.text) === productKey(i.text));
    if (idx === -1) out.push({ ...i });
    else out[idx] = combine(out[idx], i);
  }
  return out;
}

export function renameItem(list, index, text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return list;
  return list.map((it, i) => (i === index ? { ...it, text: t } : it));
}

export function toggleShoppingItem(list, index) {
  return list.map((it, i) => (i === index ? { ...it, checked: !it.checked } : it));
}

export function removeChecked(list) {
  return list.filter((i) => !i.checked);
}

/** Tekst do wyswietlenia: "250 g masła (Naleśniki, Ciasto)". */
export function displayText(item) {
  return item.recipes?.length ? `${item.text} (${item.recipes.join(", ")})` : item.text;
}
