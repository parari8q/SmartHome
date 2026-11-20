import { test } from "node:test";
import assert from "node:assert/strict";
import { guessCategory, groupShopping, categoryOf, setItemCategory } from "../../js/logic/shop-categories.js";
import { normalizeShopping, addToShopping, mergeDuplicates, renameItem } from "../../js/logic/shopping.js";

test("zgaduje działy po nazwie i odmianie", () => {
  const cases = {
    "cebula": "warzywa", "3 cebule": "warzywa", "2 papryki": "warzywa", "1 główka czosnku": "warzywa", "por": "warzywa",
    "chleb": "pieczywo", "6 bułek": "pieczywo",
    "mleko": "nabial", "500 ml mleka": "nabial", "6 jajek": "nabial", "jajka 6 szt.": "nabial", "100 g fety": "nabial", "ser żółty": "nabial", "200 g masła": "nabial",
    "pierś z kurczaka": "mieso", "500 g mięsa mielonego": "mieso", "łosoś": "mieso",
    "2 puszki pomidorów krojonych": "spizarnia", "mąka": "spizarnia", "1 łyżeczka kuminu": "spizarnia", "makaron penne": "spizarnia", "bułka tarta": "spizarnia", "papryka słodka mielona": "spizarnia", "bulion warzywny 1 1/5 l": "spizarnia",
    "sok z cytryny": "napoje", "kawa mielona": "napoje", "woda gazowana": "napoje",
    "czekolada gorzka": "slodycze", "papier toaletowy": "chemia", "płyn do naczyń": "chemia", "serwetki": "chemia",
    "mrożone warzywa": "mrozonki", "coś dziwnego": "inne",
  };
  for (const [text, cat] of Object.entries(cases)) assert.equal(guessCategory(text), cat, text);
});

test("kawałek kurczaka to mięso, a nie kawa", () => {
  assert.equal(guessCategory("kawałek kurczaka"), "mieso");
});

test("grupuje wg kolejności w sklepie, kupione osobno, indeksy z listy", () => {
  const list = [{ text: "mleko", checked: false }, { text: "chleb", checked: false }, { text: "cebula", checked: true }, { text: "masło", checked: false }];
  const { groups, done } = groupShopping(list);
  assert.deepEqual(groups.map((g) => g.id), ["pieczywo", "nabial"]);
  assert.deepEqual(groups[1].items.map((x) => x.index), [0, 3]);
  assert.deepEqual(done.map((x) => x.index), [2]);
});

test("ręcznie wybrany dział ma pierwszeństwo i przetrwa normalizację, zmianę nazwy i łączenie", () => {
  let list = setItemCategory([{ text: "tofu", checked: false }], 0, "nabial");
  list = normalizeShopping(list);
  assert.equal(categoryOf(list[0]), "nabial");
  list = renameItem(list, 0, "tofu wędzone");
  assert.equal(list[0].cat, "nabial");
  list = addToShopping(list, ["tofu wędzone"]).list;
  assert.equal(list.length, 1);
  assert.equal(list[0].cat, "nabial");
  assert.equal(normalizeShopping([{ text: "x", cat: "zle" }])[0].cat, undefined);
  assert.equal(mergeDuplicates([{ text: "tofu", checked: false }, { text: "tofu", checked: false, cat: "mieso" }])[0].cat, "mieso");
});

import { scaleIngredient, servingsNumber } from "../../js/logic/shopping.js";

test("przeliczanie porcji", () => {
  assert.equal(scaleIngredient("200 g masła", 1.5), "300 g masła");
  assert.equal(scaleIngredient("4 jajka", 0.5), "2 jajka");
  assert.equal(scaleIngredient("2 łyżki oliwy", 0.25), "½ łyżki oliwy");
  assert.equal(scaleIngredient("1 szklanka mleka", 1.5), "1½ szklanki mleka");
  assert.equal(scaleIngredient("700 g mąki", 2), "1,4 kg mąki");
  assert.equal(scaleIngredient("masło – 100 g", 2), "masło – 200 g");
  assert.equal(scaleIngredient("sól do smaku", 2), "sól do smaku");
  assert.equal(scaleIngredient("2-3 ząbki czosnku", 2), "2-3 ząbki czosnku");
  assert.equal(scaleIngredient("200 g masła", 1), "200 g masła");
  assert.equal(servingsNumber("4 porcje"), 4);
  assert.equal(servingsNumber(""), null);
});
