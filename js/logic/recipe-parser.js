// ==========================================================================
// Rozpoznawanie przepisu z tekstu (ze screena po OCR albo wklejonego).
// Czysta funkcja: tekst -> { name, servings, time, ingredients[], steps[], notes }.
//
// Radzi sobie z typowymi rzeczami ze screenow z telefonu: pasek statusu
// (godzina, bateria), przyciski aplikacji, punktory odczytane jako "e"/"o"/"«",
// zawijane linie, numerowane i nienumerowane kroki, brak naglowkow sekcji.
// ==========================================================================

const L = "\\p{L}";

const ING_HEADER = /^(?:lista\s+)?(?:składniki|skladniki|składników|potrzebne(?:\s+składniki)?|ingredients|co\s+potrzebujesz|zakupy)\b[\s:.\-–]*/iu;
const STEP_HEADER = /^(?:sposób\s+przygotowania|sposob\s+przygotowania|przygotowanie|wykonanie|instrukcje?|instructions|kroki|krok\s+po\s+kroku|jak\s+(?:to\s+)?(?:zrobić|przygotować|zrobic)|metoda|directions|method|preparation|przepis)\b[\s:.\-–]*/iu;
const NOTES_HEADER = /^(?:wskazówk[ia]|wskazowki|uwagi|porad[ay]|notatk[ia]|tips?|notes?)\b[\s:.\-–]*/iu;
const SERVINGS = /(?:porcj[ie]|porcji|liczba\s+porcji|ilość\s+porcji|dla\s+(\d+)\s+os(?:ób|ob|oby)|servings?|serves|wystarczy\s+dla)\s*[:\-–]?\s*(\d+(?:\s*[-–]\s*\d+)?)?/iu;
const TIME = /(?:czas(?:\s+przygotowania|\s+całkowity|\s+gotowania)?|przygotowanie\s+w|gotowe\s+w|total\s+time|prep\s+time)\s*[:\-–]?\s*((?:\d+\s*(?:h|godz\.?|godzin[ay]?|min\.?|minut[ay]?)\s*)+)/iu;

// smieci z interfejsu telefonu i stron z przepisami
const JUNK = [
  /^\d{1,2}[:.]\d{2}(?:\s|$)/u,                    // godzina z paska statusu
  /^[\d\s%:.]*(?:lte|5g|4g|3g|wifi|wi-fi|%)[\s\d%:.]*$/iu,
  /^(?:udostępnij|udostepnij|zapisz|zapisano|drukuj|komentarze?|polub|lubię to|obserwuj|subskrybuj|reklama|advertisement|share|save|print|like|follow|menu|szukaj|zaloguj|więcej|wiecej|czytaj dalej|pokaż więcej|zobacz też|ocena|oceń|przewiń|cookies?|akceptuj)\b/iu,
  /^(?:https?:\/\/|www\.)\S+$/iu,
  /^[^\p{L}\d]+$/u,                                 // same znaki specjalne
  /^.{0,2}$/u,                                       // 1-2 znaki
];

// punktory, w tym typowe pomylki OCR ("e ", "o ", "« ", "» ", "+ ")
const BULLET = /^\s*(?:[-–—•·*▪◦●○■□☐✓✔>+«»]|[eoO°](?=\s+[\p{Lu}\d½¼¾]))\s+/u;
const NUMBERED = /^\s*(?:krok\s*\d{1,2}\s*[.):\-–]?\s+|step\s*\d{1,2}\s*[.):\-–]?\s+|\d{1,2}\s*(?:[.)\]:]|\s-)\s*)/iu;
const QTY_WORDS = "pół|polowa|ćwierć|szczypt[aęy]|garść|garści|łyżk[aięy]|łyżeczk[aięy]|łyżek|łyżeczek|szklank[aięy]|szklanek|kubek|kubka|opakowani[ea]|opak\\.?|puszk[aię]|puszek|ząb(?:ek|ki|ków)|ząbki|plaster(?:ek|ki)?|plastr[yów]*|kawał(?:ek|ki)|sztuk[ia]?|szt\\.?|pęczek|pęczka|główk[ai]|listek|liście|kostk[ai]|kostek|do\\s+smaku|według\\s+uznania|wg\\s+uznania|ok\\.";
const UNITS = "g|gr|dag|dkg|kg|ml|l|litr[ay]?|łyż\\.?|łyżecz\\.?|tbsp|tsp|cup|cups|oz|lb";
const QTY_START = new RegExp(`^(?:\\d+(?:[.,/]\\d+)?|[½¼¾⅓⅔]|${QTY_WORDS})(?=[\\s${L}½¼¾]|$)`, "iu");
const HAS_UNIT = new RegExp(`(?:^|\\s|\\d)(?:${UNITS})(?=[\\s.,)]|$)|(?:^|\\s)(?:${QTY_WORDS})(?=[\\s.,)]|$)`, "iu");

function cleanLine(raw) {
  return raw
    .replace(/[​­]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function isJunk(line) {
  return JUNK.some((re) => re.test(line));
}

function stripMarker(line) {
  return line.replace(BULLET, "").replace(NUMBERED, "").trim();
}

function looksLikeIngredient(line) {
  const s = stripMarker(line);
  if (s.length > 80) return false;
  if (QTY_START.test(s) || HAS_UNIT.test(s)) return true;
  // krotka linia bez czasownika na koncu zdania, z punktorem
  return BULLET.test(line) && s.length <= 45 && !/[.!]$/.test(s);
}

function looksLikeStep(line) {
  const s = stripMarker(line);
  return s.length > 45 || /[.!]$/.test(s) || NUMBERED.test(line) && s.length > 15;
}

const startsNew = (line) => BULLET.test(line) || NUMBERED.test(line);

/** Skleja linie zawiniete przez szerokosc ekranu. */
function joinWrapped(lines, kind) {
  const out = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    const s = line;
    const continuation = prev != null && !startsNew(s) && (
      kind === "steps"
        ? !/[.!?:]$/.test(prev) || /^\p{Ll}/u.test(s)
        : /^\p{Ll}/u.test(s) && !QTY_START.test(s) && !/[,:]$/.test(prev) && prev.length > 18
    );
    if (continuation) out[out.length - 1] = (prev.replace(/-$/, "") + (prev.endsWith("-") ? "" : " ") + s).trim();
    else out.push(s);
  }
  return out;
}

function capitalizeFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Jeden dlugi akapit bez numeracji -> kroki po zdaniach (max ~2 zdania na krok). */
function splitParagraphIntoSteps(text) {
  const sentences = text.match(/[^.!?]+(?:[.!?]+|$)/gu)?.map((x) => x.trim()).filter(Boolean) || [text];
  if (sentences.length <= 2) return [text.trim()];
  const steps = [];
  let cur = "";
  for (const s of sentences) {
    cur = cur ? cur + " " + s : s;
    if (cur.length > 90) { steps.push(cur); cur = ""; }
  }
  if (cur) steps.push(cur);
  return steps;
}

export function parseRecipeText(input) {
  const result = { name: "", servings: "", time: "", ingredients: [], steps: [], notes: "" };
  const rawLines = String(input || "").replace(/\r/g, "").split("\n").map(cleanLine);

  // ---- metadane (porcje, czas) wyciagane z dowolnego miejsca
  const lines = [];
  for (const line of rawLines) {
    if (!line) { lines.push(""); continue; }
    const sv = line.match(SERVINGS);
    if (sv && line.length < 50 && !result.servings) {
      const n = sv[1] || sv[2];
      if (n) { result.servings = n.replace(/\s/g, ""); continue; }
    }
    const tm = line.match(TIME);
    if (tm && line.length < 60 && !result.time) { result.time = tm[1].trim().replace(/\s+/g, " "); continue; }
    if (isJunk(line)) continue;
    lines.push(line);
  }

  // ---- podzial na sekcje
  const sections = { pre: [], ingredients: [], steps: [], notes: [] };
  let current = "pre";
  let sawHeader = false;
  for (const line of lines) {
    if (!line) { sections[current].push(""); continue; }
    let m;
    if ((m = line.match(ING_HEADER)) && line.length < 40) { current = "ingredients"; sawHeader = true; const rest = line.slice(m[0].length).trim(); if (rest) sections.ingredients.push(rest); continue; }
    if ((m = line.match(STEP_HEADER)) && line.length < 45) { current = "steps"; sawHeader = true; const rest = line.slice(m[0].length).trim(); if (rest) sections.steps.push(rest); continue; }
    if ((m = line.match(NOTES_HEADER)) && line.length < 30) { current = "notes"; const rest = line.slice(m[0].length).trim(); if (rest) sections.notes.push(rest); continue; }
    sections[current].push(line);
  }

  // ---- bez naglowkow: klasyfikacja linia po linii
  if (!sawHeader) {
    const pre = [];
    let phase = "pre";
    for (const line of sections.pre) {
      if (!line) { (phase === "pre" ? pre : sections[phase]).push(""); continue; }
      if (phase !== "steps" && looksLikeIngredient(line)) { phase = "ingredients"; sections.ingredients.push(line); continue; }
      if (phase !== "pre" && looksLikeStep(line)) { phase = "steps"; sections.steps.push(line); continue; }
      if (phase === "pre") pre.push(line);
      else sections[phase].push(line);
    }
    sections.pre = pre;
  }

  // ---- nazwa: pierwsza sensowna linia przed reszta
  const nameCandidates = sections.pre.filter((l) => l && l.length >= 3 && l.length <= 90 && !looksLikeIngredient(l));
  if (nameCandidates.length) {
    result.name = capitalizeFirst(stripMarker(nameCandidates[0]).replace(/[.:]+$/, ""));
    const rest = nameCandidates.slice(1).join(" ").trim();
    if (rest && !sections.notes.length && rest.length > 40) sections.notes.unshift(rest); // opis pod tytulem
  }

  // ---- skladniki
  const ingLines = sections.ingredients.filter(Boolean);
  result.ingredients = joinWrapped(ingLines, "ingredients")
    .flatMap((l) => (BULLET.test(l) || NUMBERED.test(l) || QTY_START.test(l) || l.length < 50 ? [l] : l.split(/\s*[;,]\s+(?=\d|[½¼¾]|pół)/u)))
    .map((l) => stripMarker(l).replace(/[;,.]$/, "").trim())
    .filter((l) => l && !isJunk(l));

  // ---- kroki
  const stepBlocks = [];
  let block = [];
  for (const l of sections.steps) {
    if (!l) { if (block.length) stepBlocks.push(block); block = []; } else block.push(l);
  }
  if (block.length) stepBlocks.push(block);
  const numbered = sections.steps.some((l) => l && (NUMBERED.test(l) || BULLET.test(l)));
  let steps;
  if (numbered) {
    steps = joinWrapped(sections.steps.filter(Boolean), "steps");
  } else if (stepBlocks.length > 1) {
    steps = stepBlocks.map((b) => b.join(" "));
  } else {
    steps = stepBlocks.length ? splitParagraphIntoSteps(stepBlocks[0].join(" ")) : [];
  }
  result.steps = steps.map((s) => capitalizeFirst(stripMarker(s))).filter((s) => s.length > 1);

  result.notes = sections.notes.filter(Boolean).join(" ").trim();
  return result;
}

/** Tekst z pola formularza (kazda linia = pozycja) -> lista bez punktorow i numerow. */
export function linesToList(text) {
  return String(text || "").split("\n").map((l) => stripMarker(cleanLine(l))).filter(Boolean);
}

/** Lista -> tekst do pola formularza: skladniki z myslnikami, kroki z numerami. */
export function listToLines(list, kind = "ingredients") {
  return (list || []).map((x, i) => (kind === "steps" ? `${i + 1}. ${x}` : `- ${x}`)).join("\n");
}

/** Stary przepis mial "instructions" jako jeden tekst — zamiana na kroki. */
export function instructionsToSteps(text) {
  if (!text) return [];
  const parsed = parseRecipeText("Przygotowanie:\n" + text);
  return parsed.steps;
}

/** Naglowki grup w skladnikach ("Na ciasto:") nie ida na liste zakupow. */
export function isIngredientHeader(line) {
  return /:\s*$/.test(line) && line.length < 40;
}
