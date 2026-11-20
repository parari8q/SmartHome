// ==========================================================================
// Działy sklepu dla listy zakupów: zgadywanie po nazwie produktu
// ("2 puszki pomidorów krojonych" -> Spiżarnia, "pierś z kurczaka" -> Mięso).
// Wygrywa slowo, ktore stoi najwczesniej w nazwie ("sok z cytryny" -> Napoje,
// bo "sok" jest przed "cytryny"). Reczny wybor dzialu (item.cat) ma pierwszenstwo.
// ==========================================================================

import { parseIngredient } from "./shopping.js";

export const CATEGORIES = [
  { id: "warzywa", name: "Warzywa i owoce" },
  { id: "pieczywo", name: "Pieczywo" },
  { id: "nabial", name: "Nabiał i jajka" },
  { id: "mieso", name: "Mięso i ryby" },
  { id: "mrozonki", name: "Mrożonki" },
  { id: "spizarnia", name: "Spiżarnia" },
  { id: "napoje", name: "Napoje" },
  { id: "slodycze", name: "Słodycze i przekąski" },
  { id: "chemia", name: "Chemia i dom" },
  { id: "inne", name: "Inne" },
];
const IDS = new Set(CATEGORIES.map((c) => c.id));
export const isCategory = (id) => IDS.has(id);
export const categoryName = (id) => CATEGORIES.find((c) => c.id === id)?.name || "Inne";

// Wyjatki sprawdzane najpierw (cale wyrazenia, wazniejsze niz pojedyncze slowa)
const SPECIAL = [
  ["spizarnia", /bułk\S* tart|proszek do pieczenia|(?:mleczk|mlek)\S* kokos|pomidor\S* (?:krojon|z puszk|w puszc|suszon)|passat|koncentrat|papryk\S* (?:słodk|ostr|wędzon|mielon)|kostk\S* rosoł|groszek konserw|cukier puder/u],
  ["mrozonki", /mrożon|(?:^|\s)lod(?:y|ów)(?=\s|$)/u],
  ["chemia", /papier toalet|ręcznik\S* papier|płyn do|tablet\S* do zmyw|kapsułk\S* do pran|proszek do pran|pasta do zęb|żel pod prysznic|worki na/u],
];

// Pojedyncze slowa: poczatek wyrazu (odmiana dowolna)
const WORDS = {
  warzywa: "cebul czosn papryk pomidor ogór ogork marchew marchw ziemniak kartof sałat rukol szpinak brokuł brokul kalafior cukini bakłażan dyni dynia seler pietrusz koper natk kapust burak rzodkiew fasolk pieczark grzyb awokad cytryn limonk jabł jabl banan grusz truskaw malin borówk winogr pomarańcz mandaryn kiwi ananas imbir szczypior kolendr mięt jarmuż rabarbar szparag cukinia śliwk wiśni czereśn arbuz melon nektaryn brzoskwin bataty batat kiełk rzodkiewk ziół zioł bazyli",
  pieczywo: "chleb bułk bułek bagiet tortill chałk rogal pieczyw grahamk pita lawasz croissant",
  nabial: "mlek mleko mleka jaj feta fety fetą mozzarell parmezan twaróg twarog twarożk jogurt śmietan masł masl kefir maślank ricott mascarpon halloumi gouda goud cheddar brie camembert serek serk",
  mieso: "kurczak kurczę kurcza pierś piersi filet mięs mies wołow wieprz schab karkówk boczek boczk szynk kiełbas parówk mielon indyk kaczk łosoś łososi dorsz tuńczyk krewetk ryb salami chorizo pancett bekon udk skrzydeł skrzydełk polędwic wątrób kabanos",
  spizarnia: "mąk mak cukier cukru cukr sól soli pieprz przypraw kumin kmin oregano tymian curry cynamon makaron spaghetti penne tagliatelle ryż ryżu kasz płatk owsian olej oliw ocet octu sos ketchup musztard majonez miód miod dżem kakao drożdż soda bulion rosoł fasol ciecierzyc soczewic kukurydz kapar wanili żelatyn orzech migdał rodzynk siemi słonecznik sezam chia kokos puszk konserw gałk liść laur ziel majeran",
  napoje: "wod woda sok soki piw wino win kaw kawy herbat napój napoj cola lemoniad syrop",
  slodycze: "czekolad ciastk ciasteczk chips baton cukierk żelk orzeszk paluszk krakers wafl lizak popcorn",
  chemia: "papier płyn proszek gąbk folia mydł szampon odżywk ręcznik serwetk zmywak worki worek domestos baterie żarówk",
};
// krotkie slowa, ktore musza pasowac dokladnie (inaczej "ser" lapalby "serwetki")
const EXACT = [[/^ser(?:a|y|u|em|ek|ki|ka|kiem)?$/u, "nabial"], [/^por(?:y|a|u|ów)?$/u, "warzywa"]];

const WORD_INDEX = Object.entries(WORDS).flatMap(([cat, list]) => list.split(" ").map((stem) => [stem, cat]));

function wordCategory(word) {
  for (const [re, cat] of EXACT) if (re.test(word)) return cat;
  let best = null;
  for (const [stem, cat] of WORD_INDEX) {
    if (!word.startsWith(stem)) continue;
    if (stem.length <= 3 && word.length > stem.length + 3) continue; // "kaw" nie lapie "kawałek"
    if (!best || stem.length > best.stem.length) best = { stem, cat };
  }
  return best?.cat || null;
}

/** Dzial dla tekstu produktu (bez recznego wyboru). */
export function guessCategory(text) {
  const name = parseIngredient(text).name.toLocaleLowerCase("pl").replace(/[()",.;:!?]/g, " ").replace(/\s+/g, " ").trim();
  const full = String(text || "").toLocaleLowerCase("pl");
  for (const [cat, re] of SPECIAL) if (re.test(name) || re.test(full)) return cat;
  for (const word of name.split(" ")) {
    const cat = wordCategory(word);
    if (cat) return cat;
  }
  return "inne";
}

export const categoryOf = (item) => (item.cat && isCategory(item.cat) ? item.cat : guessCategory(item.text));

/** Grupy do wyswietlenia: niekupione wg dzialow (kolejnosc jak w sklepie), kupione osobno na koncu.
 *  Kazda pozycja niesie index z oryginalnej listy (do odhaczania/edycji). */
export function groupShopping(list) {
  const groups = CATEGORIES.map((c) => ({ ...c, items: [] }));
  const done = [];
  list.forEach((item, index) => {
    if (item.checked) return done.push({ item, index });
    groups.find((g) => g.id === categoryOf(item)).items.push({ item, index });
  });
  return { groups: groups.filter((g) => g.items.length), done };
}

export function setItemCategory(list, index, cat) {
  return list.map((it, i) => (i === index ? { ...it, cat } : it));
}
