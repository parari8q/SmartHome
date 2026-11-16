import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "../../js/logic/shopping.js";

const texts = (list) => list.map(S.displayText);

test("rozbiór składnika: ilość, jednostka, nazwa", () => {
  assert.deepEqual(S.parseIngredient("200 g masła"), { name: "masła", amounts: [{ value: 200, base: "g" }], style: "pre" });
  assert.deepEqual(S.parseIngredient("2 jajka"), { name: "jajka", amounts: [{ value: 2, base: "szt" }], style: "pre" });
  assert.deepEqual(S.parseIngredient("1 1/2 szklanki mąki"), { name: "mąki", amounts: [{ value: 1.5, base: "szklanka" }], style: "pre" });
  assert.deepEqual(S.parseIngredient("pół łyżeczki soli"), { name: "soli", amounts: [{ value: 0.5, base: "łyżeczka" }], style: "pre" });
  assert.deepEqual(S.parseIngredient("masło – 20 dag"), { name: "masło", amounts: [{ value: 200, base: "g" }], style: "post" });
  assert.deepEqual(S.parseIngredient("bulion warzywny – 1 1/2 l"), { name: "bulion warzywny", amounts: [{ value: 1500, base: "ml" }], style: "post" });
  assert.deepEqual(S.parseIngredient("2 duże jajka"), { name: "duże jajka", amounts: [{ value: 2, base: "szt" }], style: "pre" });
  assert.deepEqual(S.parseIngredient("sól"), { name: "sól", amounts: [], style: "pre" });
});

test("klucz produktu: ta sama rzecz w różnej odmianie i ilości", () => {
  assert.equal(S.productKey("200 g masła"), S.productKey("masło"));
  assert.equal(S.productKey("50 g masła"), S.productKey("masło – 100 g"));
  assert.equal(S.productKey("1 jajko"), S.productKey("3 jajka"));
  assert.notEqual(S.productKey("masło"), S.productKey("mleko"));
  assert.notEqual(S.productKey("mąka pszenna"), S.productKey("mąka żytnia"));
});

test("dodawanie z dwóch przepisów: masło się łączy i sumuje, w nawiasie oba przepisy", () => {
  let { list } = S.addToShopping([], ["200 g masła", "2 jajka", "mąka"], "Ciasto");
  ({ list } = S.addToShopping(list, ["50 g masła", "1 jajko", "mleko"], "Naleśniki"));
  assert.deepEqual(texts(list), [
    "250 g masła (Ciasto, Naleśniki)",
    "3 jajka (Ciasto, Naleśniki)",
    "mąka (Ciasto)",
    "mleko (Naleśniki)",
  ]);
});

test("różne jednostki: przeliczenie albo obie ilości", () => {
  let { list } = S.addToShopping([], ["masło – 60 dag"], "A");
  ({ list } = S.addToShopping(list, ["500 g masła"], "B"));
  assert.equal(S.displayText(list[0]), "masło – 1,1 kg (A, B)");
  ({ list } = S.addToShopping(list, ["2 łyżki masła"], "C"));
  assert.equal(S.displayText(list[0]), "masło – 1,1 kg + 2 łyżki (A, B, C)");
  let r = S.addToShopping([], ["250 ml mleka"], "A");
  r = S.addToShopping(r.list, ["1 l mleka"], "B");
  assert.equal(S.displayText(r.list[0]), "1,25 l mleka (A, B)");
  r = S.addToShopping([], ["½ szklanki cukru"], "A");
  r = S.addToShopping(r.list, ["1 szklanka cukru"], "B");
  assert.equal(S.displayText(r.list[0]), "1½ szklanki cukru (A, B)");
});

test("ręcznie dopisane: bez nawiasu, łączy się z tym z przepisu", () => {
  let { list, added } = S.addToShopping([], ["mleko"]);
  assert.equal(added, 1);
  assert.deepEqual(list, [{ text: "mleko", checked: false }]);
  ({ list, added } = S.addToShopping(list, ["500 ml mleka"], "Naleśniki"));
  assert.equal(added, 0);
  assert.equal(S.displayText(list[0]), "500 ml mleka (Naleśniki)");
});

test("kupione (odhaczone) nie łączą się z nowymi", () => {
  let { list } = S.addToShopping([], ["masło"], "A");
  list = S.toggleShoppingItem(list, 0);
  ({ list } = S.addToShopping(list, ["masło"], "B"));
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((i) => i.checked), [true, false]);
});

test("łączenie powtórek, które już są na liście", () => {
  const list = [
    { text: "200 g masła", checked: false, recipes: ["Ciasto"] },
    { text: "chleb", checked: false },
    { text: "masło", checked: false },
    { text: "100 g masła", checked: true },
    { text: "50 g masła", checked: false, recipes: ["Placki"] },
  ];
  assert.equal(S.countDuplicates(list), 2);
  const merged = S.mergeDuplicates(list);
  assert.deepEqual(texts(merged), ["250 g masła (Ciasto, Placki)", "chleb", "100 g masła"]);
  assert.equal(S.countDuplicates(merged), 0);
});

test("zmiana nazwy zachowuje przepisy i stan", () => {
  const list = [{ text: "250 g masła", checked: true, recipes: ["Ciasto"] }];
  const r = S.renameItem(list, 0, "  masło extra  ");
  assert.deepEqual(r, [{ text: "masło extra", checked: true, recipes: ["Ciasto"] }]);
  assert.equal(S.renameItem(list, 0, "  "), list);
});

test("stary format listy (bez przepisów) działa", () => {
  assert.deepEqual(S.normalizeShopping([{ text: "x" }, { text: "y", checked: true, recipes: { 0: "A" } }, { text: "" }, null]),
    [{ text: "x", checked: false }, { text: "y", checked: true, recipes: ["A"] }]);
});
