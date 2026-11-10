import { test } from "node:test";
import assert from "node:assert/strict";
import * as todo from "../../js/logic/todo.js";
import * as cal from "../../js/logic/calendar.js";
import * as rec from "../../js/logic/recipes.js";
import * as weather from "../../js/logic/weather.js";
import { escapeHtml, plural, asArray } from "../../js/lib/util.js";

// ---------------------------------------------------------------- zadania

test("todo: pusta lista z Firebase (bez 'tasks') nie wywala aplikacji", () => {
  // Firebase nie zapisuje pustych tablic — tak wraca nowo utworzona lista
  const lists = todo.normalizeTodoLists([{ id: "list_1", name: "Dom" }]);
  assert.deepEqual(lists, [{ id: "list_1", name: "Dom", tasks: [] }]);
  assert.equal(todo.openCount(lists[0]), 0);
});

test("todo: tablica zapisana jako obiekt i dziury po usunieciu", () => {
  const lists = todo.normalizeTodoLists({ 0: { id: "a", name: "A", tasks: { 0: { id: "t", text: "x" }, 2: null } } });
  assert.equal(lists[0].tasks.length, 1);
  assert.equal(lists[0].tasks[0].done, false);
  assert.deepEqual(todo.normalizeTodoLists(null), []);
});

test("todo: pelny cykl operacji nie modyfikuje wejscia", () => {
  let lists = [];
  lists = todo.createList(lists, " Zakupy ", "L1");
  const frozen = JSON.stringify(lists);
  let next = todo.addTask(lists, "L1", "mleko", "T1");
  assert.equal(JSON.stringify(lists), frozen);
  next = todo.addTask(next, "L1", "chleb", "T2");
  next = todo.toggleTask(next, "L1", "T1");
  assert.equal(next[0].tasks[0].done, true);
  assert.equal(todo.openCount(next[0]), 1);
  assert.deepEqual(todo.sortedTasks(next[0]).map((t) => t.id), ["T2", "T1"]);
  next = todo.editTask(next, "L1", "T2", "chleb razowy");
  assert.equal(next[0].tasks[1].text, "chleb razowy");
  assert.equal(todo.editTask(next, "L1", "T2", "   ")[0].tasks[1].text, "chleb razowy");
  next = todo.clearDone(next, "L1");
  assert.deepEqual(next[0].tasks.map((t) => t.id), ["T2"]);
  next = todo.deleteTask(next, "L1", "T2");
  assert.equal(next[0].tasks.length, 0);
  next = todo.renameList(next, "L1", "Sklep");
  assert.equal(next[0].name, "Sklep");
  assert.deepEqual(todo.deleteList(next, "L1"), []);
});

test("todo: dodanie do listy po nazwie (bez wzgledu na wielkosc liter) albo nowej", () => {
  let lists = todo.createList([], "Dom", "L1");
  let r = todo.addTaskToNamedList(lists, "dom", "odkurzyć");
  assert.equal(r.created, false);
  assert.equal(r.lists.length, 1);
  assert.equal(r.lists[0].tasks[0].text, "odkurzyć");
  r = todo.addTaskToNamedList(r.lists, "Praca", "raport");
  assert.equal(r.created, true);
  assert.equal(r.lists.length, 2);
  assert.equal(r.lists[1].name, "Praca");
});

// ---------------------------------------------------------------- kalendarz

test("kalendarz: normalizacja odrzuca smieci i puste dni", () => {
  const c = cal.normalizeCalendar({ "2026-11-10": [{ id: "e", title: "A" }], "2026-11-11": [], zly: [{}], "2026-11-12": { 0: { id: "x", time: "09:00", title: "B" } } });
  assert.deepEqual(Object.keys(c).sort(), ["2026-11-10", "2026-11-12"]);
  assert.equal(c["2026-11-10"][0].time, "");
});

test("kalendarz: dodawanie, sortowanie, edycja, usuwanie", () => {
  let c = {};
  c["2026-11-10"] = cal.addEvent(c, "2026-11-10", { time: "18:00", title: "Kino" }, "e1");
  c["2026-11-10"] = cal.addEvent(c, "2026-11-10", { time: "", title: "Cały dzień" }, "e2");
  c["2026-11-10"] = cal.addEvent(c, "2026-11-10", { time: "08:30", title: "Praca" }, "e3");
  assert.deepEqual(cal.eventsForDay(c, "2026-11-10").map((e) => e.id), ["e3", "e1", "e2"]);
  c["2026-11-10"] = cal.updateEvent(c, "2026-11-10", "e1", { time: "19:00", title: "Kino 2" });
  assert.equal(c["2026-11-10"].find((e) => e.id === "e1").time, "19:00");
  assert.equal(cal.updateEvent(c, "2026-11-10", "e1", { title: "  " }).find((e) => e.id === "e1").title, "Kino 2");
  c["2026-11-10"] = cal.deleteEvent(c, "2026-11-10", "e1");
  c["2026-11-10"] = cal.deleteEvent(c, "2026-11-10", "e2");
  assert.equal(cal.deleteEvent(c, "2026-11-10", "e3"), null);
});

test("kalendarz: najblizsze wydarzenia i siatka miesiaca", () => {
  const c = { "2026-11-10": [{ id: "a", time: "10:00", title: "A" }], "2026-11-12": [{ id: "b", time: "", title: "B" }], "2026-12-30": [{ id: "z", time: "", title: "Z" }] };
  const up = cal.upcomingEvents(c, new Date(2026, 10, 10, 20), 7, 4);
  assert.deepEqual(up.map((e) => [e.id, e.dayOffset]), [["a", 0], ["b", 2]]);
  const grid = cal.monthGrid(2026, 10); // listopad 2026 zaczyna sie w niedziele
  assert.equal(grid.filter((x) => x === null).length, 6);
  assert.equal(grid.filter(Boolean).length, 30);
  assert.equal(cal.relativeDayLabel(0, "2026-11-10"), "Dziś");
  assert.equal(cal.relativeDayLabel(1, "2026-11-11"), "Jutro");
});

// ---------------------------------------------------------------- przepisy

test("przepisy: normalizacja danych bez pustych tablic", () => {
  const d = rec.normalizeRecipes({ categories: [{ id: "c", name: "Dieta", subcategories: [{ id: "s", name: "Obiad" }] }] });
  assert.deepEqual(d.categories[0].subcategories[0].recipes, []);
  assert.deepEqual(rec.normalizeRecipes(null), { categories: [] });
});

test("przepisy: kategorie, przepisy, przenoszenie", () => {
  let n = 0;
  const id = () => "id" + ++n;
  let d = rec.addCategory({ categories: [] }, "Dieta PCOS", id);
  const cat = d.categories[0];
  assert.deepEqual(cat.subcategories.map((s) => s.name), rec.DEFAULT_SUBCATEGORIES);
  const [s1, s2] = cat.subcategories;
  d = rec.addRecipe(d, cat.id, s1.id, { name: " Owsianka ", ingredients: ["płatki", "banan"], instructions: "" }, "r1", 1);
  assert.equal(rec.findRecipe(d, cat.id, s1.id, "r1").name, "Owsianka");
  assert.equal(rec.countRecipes(d.categories[0]), 1);
  d = rec.updateRecipe(d, cat.id, s1.id, "r1", { name: "Owsianka II", ingredients: ["płatki"] });
  assert.deepEqual(rec.findRecipe(d, cat.id, s1.id, "r1").ingredients, ["płatki"]);
  d = rec.moveRecipe(d, { catId: cat.id, scId: s1.id }, { catId: cat.id, scId: s2.id }, "r1");
  assert.equal(rec.findRecipe(d, cat.id, s1.id, "r1"), null);
  assert.equal(rec.findRecipe(d, cat.id, s2.id, "r1").name, "Owsianka II");
  assert.equal(rec.allRecipes(d)[0].label, "Dieta PCOS / Obiad");
  d = rec.addSubcategory(d, cat.id, "Przekąski", "sx");
  assert.equal(d.categories[0].subcategories.length, 5);
  d = rec.deleteSubcategory(d, cat.id, "sx");
  d = rec.deleteRecipe(d, cat.id, s2.id, "r1");
  assert.equal(rec.countRecipes(d.categories[0]), 0);
  assert.deepEqual(rec.deleteCategory(d, cat.id).categories, []);
});

test("przepisy: rozbijanie tekstu na skladniki", () => {
  assert.deepEqual(rec.splitIntoIngredients("- 2 jajka\n• 1 banan, mleko\n1. mąka\n\n"), ["2 jajka", "1 banan", "mleko", "mąka"]);
  assert.deepEqual(rec.parseIngredients(" a \n\n b"), ["a", "b"]);
});

test("lista zakupow: bez duplikatow, laczenie, odhaczanie", () => {
  const recipes = [{ id: "a", ingredients: ["Mleko", "jajka"] }, { id: "b", ingredients: ["mleko ", "Mąka"] }, { id: "c", ingredients: ["sól"] }];
  const list = rec.buildShoppingList(recipes, new Set(["a", "b"]));
  assert.deepEqual(list.map((i) => i.text), ["Mleko", "jajka", "Mąka"]);
  const merged = rec.mergeShopping(list, [{ text: "MĄKA" }, { text: "cukier" }]);
  assert.deepEqual(merged.map((i) => i.text), ["Mleko", "jajka", "Mąka", "cukier"]);
  const toggled = rec.toggleShoppingItem(merged, 1);
  assert.equal(toggled[1].checked, true);
  assert.deepEqual(rec.removeChecked(toggled).map((i) => i.text), ["Mleko", "Mąka", "cukier"]);
  assert.deepEqual(rec.normalizeShopping([{ text: "x" }, { text: "" }, null]), [{ text: "x", checked: false }]);
});

// ---------------------------------------------------------------- pogoda / util

test("pogoda: podsumowanie i kolejne godziny", () => {
  const hourlyTimes = Array.from({ length: 48 }, (_, i) => `2026-11-10T${String(i % 24).padStart(2, "0")}:00`);
  const data = {
    current: { time: "2026-11-10T14:15", temperature_2m: 7.6, apparent_temperature: 4.4, relative_humidity_2m: 81, weather_code: 61, wind_speed_10m: 12.4, is_day: 1 },
    hourly: { time: hourlyTimes.slice(0, 24), temperature_2m: Array(24).fill(5), weather_code: Array(24).fill(3) },
    daily: { sunrise: ["2026-11-10T06:58"], sunset: ["2026-11-10T16:04"], temperature_2m_max: [8.4], temperature_2m_min: [2.2] },
  };
  const s = weather.summarize(data);
  assert.equal(s.temp, 8);
  assert.equal(s.text, "Lekki deszcz");
  assert.equal(s.cat, "rain");
  assert.equal(s.hours.length, 6);
  assert.equal(s.hours[0].time, "2026-11-10T15:00");
  assert.equal(weather.describeCode(1234).cat, "cloud");
  assert.equal(weather.themeFor("rain", false), weather.THEMES["night-rain"]);
  assert.match(weather.buildWeatherUrl({ latitude: 52.2, longitude: 21 }), /latitude=52.2&longitude=21/);
});

test("util: escapeHtml, plural, asArray", () => {
  assert.equal(escapeHtml(`<img src=x onerror="a">&'`), "&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;");
  assert.deepEqual([1, 2, 5, 12, 22, 25].map((n) => plural(n, "zadanie", "zadania", "zadań")),
    ["zadanie", "zadania", "zadań", "zadań", "zadania", "zadań"]);
  assert.deepEqual(asArray({ 1: "b", 0: "a" }), ["a", "b"]);
});
