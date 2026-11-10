import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecipeText, linesToList, listToLines, instructionsToSteps, isIngredientHeader } from "../../js/logic/recipe-parser.js";

test("typowy screen z telefonu: pasek statusu, naglowki, punktory, numerowane kroki", () => {
  const ocr = `17:05 ⚡ 87%
LTE
Udostępnij
Owsianka bananowa z cynamonem
Szybkie śniadanie na zimowe poranki.
Porcje: 2
Czas przygotowania: 15 min
Składniki
• 1 szklanka płatków owsianych
• 2 szklanki mleka
• 1 dojrzały banan
• szczypta cynamonu
• 1 łyżka miodu
Przygotowanie
1. Płatki zalej mlekiem i gotuj na małym ogniu
około 5 minut, często mieszając.
2. Banana pokrój w plasterki.
3. Przełóż owsiankę do miseczek, dodaj banana,
posyp cynamonem i polej miodem.
Komentarze (12)`;
  const r = parseRecipeText(ocr);
  assert.equal(r.name, "Owsianka bananowa z cynamonem");
  assert.equal(r.servings, "2");
  assert.equal(r.time, "15 min");
  assert.deepEqual(r.ingredients, ["1 szklanka płatków owsianych", "2 szklanki mleka", "1 dojrzały banan", "szczypta cynamonu", "1 łyżka miodu"]);
  assert.deepEqual(r.steps, [
    "Płatki zalej mlekiem i gotuj na małym ogniu około 5 minut, często mieszając.",
    "Banana pokrój w plasterki.",
    "Przełóż owsiankę do miseczek, dodaj banana, posyp cynamonem i polej miodem.",
  ]);
  assert.equal(r.notes, "");
});

test("punktory odczytane przez OCR jako 'e', 'o', '«' i myslniki", () => {
  const r = parseRecipeText(`Składniki:
e 200 g mąki
o 2 jajka
« 250 ml mleka
- sól
Wykonanie:
Wszystko zmiksuj i smaż naleśniki na rozgrzanej patelni.`);
  assert.deepEqual(r.ingredients, ["200 g mąki", "2 jajka", "250 ml mleka", "sól"]);
  assert.deepEqual(r.steps, ["Wszystko zmiksuj i smaż naleśniki na rozgrzanej patelni."]);
});

test("zawijane skladniki i grupy ('Na ciasto:')", () => {
  const r = parseRecipeText(`Ciasto drożdżowe
SKŁADNIKI
Na ciasto:
500 g mąki pszennej typu 650 lub
mąki tortowej
25 g świeżych drożdży
Na kruszonkę:
50 g masła
SPOSÓB PRZYGOTOWANIA
Krok 1 Drożdże rozpuść w ciepłym mleku.
Krok 2 Dodaj mąkę i wyrabiaj ciasto przez 10 minut.`);
  assert.equal(r.name, "Ciasto drożdżowe");
  assert.deepEqual(r.ingredients, ["Na ciasto:", "500 g mąki pszennej typu 650 lub mąki tortowej", "25 g świeżych drożdży", "Na kruszonkę:", "50 g masła"]);
  assert.deepEqual(r.steps, ["Drożdże rozpuść w ciepłym mleku.", "Dodaj mąkę i wyrabiaj ciasto przez 10 minut."]);
  assert.ok(isIngredientHeader("Na ciasto:"));
  assert.ok(!isIngredientHeader("200 g mąki"));
});

test("bez naglowkow: skladniki rozpoznane po ilosciach, kroki po zdaniach", () => {
  const r = parseRecipeText(`Szakszuka
4 jajka
1 puszka pomidorów
1 cebula
2 ząbki czosnku
pół łyżeczki kuminu
Cebulę i czosnek zeszklij na oliwie. Dodaj pomidory i kumin, duś 10 minut. Zrób wgłębienia i wbij jajka. Przykryj i gotuj aż białko się zetnie. Podawaj z pieczywem.`);
  assert.equal(r.name, "Szakszuka");
  assert.deepEqual(r.ingredients, ["4 jajka", "1 puszka pomidorów", "1 cebula", "2 ząbki czosnku", "pół łyżeczki kuminu"]);
  assert.ok(r.steps.length >= 2 && r.steps.length <= 5, "dlugi akapit podzielony na kroki: " + r.steps.length);
  assert.equal(r.steps.join(" "), "Cebulę i czosnek zeszklij na oliwie. Dodaj pomidory i kumin, duś 10 minut. Zrób wgłębienia i wbij jajka. Przykryj i gotuj aż białko się zetnie. Podawaj z pieczywem.");
});

test("kroki jako akapity oddzielone pustymi liniami", () => {
  const r = parseRecipeText(`Przygotowanie
Piekarnik nagrzej do 180 stopni.

Wymieszaj suche składniki w misce.

Dodaj jajka i mleko, piecz 25 minut.`);
  assert.deepEqual(r.steps, ["Piekarnik nagrzej do 180 stopni.", "Wymieszaj suche składniki w misce.", "Dodaj jajka i mleko, piecz 25 minut."]);
});

test("kilka screenow sklejonych razem + wskazowki + 'dla 4 osób' + czas w godzinach", () => {
  const r = parseRecipeText(`Gulasz wołowy
Dla 4 osób
Czas: 2 h 30 min
Składniki
1 kg wołowiny
2 cebule

12:41 ⚡ 64%
3 papryki
2 łyżki papryki słodkiej
Przygotowanie
1) Mięso pokrój w kostkę i obsmaż.
2) Dodaj cebulę i paprykę.
Wskazówki
Najlepszy na drugi dzień.`);
  assert.equal(r.servings, "4");
  assert.equal(r.time, "2 h 30 min");
  assert.deepEqual(r.ingredients, ["1 kg wołowiny", "2 cebule", "3 papryki", "2 łyżki papryki słodkiej"]);
  assert.deepEqual(r.steps, ["Mięso pokrój w kostkę i obsmaż.", "Dodaj cebulę i paprykę."]);
  assert.equal(r.notes, "Najlepszy na drugi dzień.");
});

test("pusty / smieciowy tekst nie wywala", () => {
  assert.deepEqual(parseRecipeText(""), { name: "", servings: "", time: "", ingredients: [], steps: [], notes: "" });
  const r = parseRecipeText("12:00\n%%%\n.\n");
  assert.equal(r.name, "");
});

test("pola formularza: myslniki i numery dodawane/usuwane", () => {
  assert.equal(listToLines(["2 jajka", "mąka"]), "- 2 jajka\n- mąka");
  assert.equal(listToLines(["Wymieszaj.", "Piecz."], "steps"), "1. Wymieszaj.\n2. Piecz.");
  assert.deepEqual(linesToList("- 2 jajka\n\n• mąka\n3. sól"), ["2 jajka", "mąka", "sól"]);
  assert.deepEqual(instructionsToSteps("1. Wymieszaj.\n2. Piecz 20 minut."), ["Wymieszaj.", "Piecz 20 minut."]);
  assert.deepEqual(instructionsToSteps(""), []);
});

test("tabelka: nazwa po lewej, ilosc po prawej (np. 'bulion warzywny  1 1/5 l')", () => {
  const r = parseRecipeText(`Zupa krem z dyni
Składniki
dynia hokkaido 1 kg
bulion warzywny 1 1/5 l
cebula 1 szt.
czosnek 2 ząbki
mleczko kokosowe 200 ml
sól do smaku
Przygotowanie
1. Pokrój warzywa.
2. Gotuj w bulionie 20 minut.`);
  assert.deepEqual(r.ingredients, [
    "dynia hokkaido – 1 kg",
    "bulion warzywny – 1 1/5 l",
    "cebula – 1 szt.",
    "czosnek – 2 ząbki",
    "mleczko kokosowe – 200 ml",
    "sól – do smaku",
  ]);
  assert.equal(r.steps.length, 2);
});

test("skladniki malymi literami bez ilosci na poczatku nie sa sklejane w jedna linie", () => {
  const r = parseRecipeText(`Składniki
oliwa z oliwek do smażenia
pomidory z puszki 400 g
świeża bazylia
Przygotowanie
Wszystko podgrzej.`);
  assert.deepEqual(r.ingredients, ["oliwa z oliwek – do smażenia", "pomidory z puszki – 400 g", "świeża bazylia"]);
});

test("ulamki i ilosci: 1/2, 1,5, ½, 1 1/2", () => {
  const r = parseRecipeText(`Składniki
1/2 szklanki cukru
mąka 1,5 szklanki
½ łyżeczki soli
masło 1 1/2 kostki`);
  assert.deepEqual(r.ingredients, ["1/2 szklanki cukru", "mąka – 1,5 szklanki", "½ łyżeczki soli", "masło – 1 1/2 kostki"]);
});

test("zawijana dluga nazwa skladnika dalej sie skleja", () => {
  const r = parseRecipeText(`Składniki
• 500 g mąki pszennej typu 650 albo
tortowej
• 2 jajka`);
  assert.deepEqual(r.ingredients, ["500 g mąki pszennej typu 650 albo tortowej", "2 jajka"]);
});
