import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDate, parseTime, parseVoiceCommand } from "../../js/logic/voice-parser.js";

// wtorek, 10 listopada 2026, 14:30
const NOW = new Date(2026, 10, 10, 14, 30);
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("daty slowne z polskimi znakami (wczesniej nie dzialaly)", () => {
  assert.equal(key(parseDate("spotkanie dziś o 15", NOW).date), "2026-11-10");
  assert.equal(key(parseDate("dzisiaj", NOW).date), "2026-11-10");
  assert.equal(key(parseDate("w środę kino", NOW).date), "2026-11-11");
  assert.equal(key(parseDate("w sobotę", NOW).date), "2026-11-14");
  assert.equal(key(parseDate("w niedzielę obiad", NOW).date), "2026-11-15");
});

test("jutro / pojutrze / za X", () => {
  assert.equal(key(parseDate("jutro", NOW).date), "2026-11-11");
  assert.equal(key(parseDate("pojutrze", NOW).date), "2026-11-12");
  assert.equal(key(parseDate("za tydzień", NOW).date), "2026-11-17");
  assert.equal(key(parseDate("za 3 dni", NOW).date), "2026-11-13");
  assert.equal(key(parseDate("za dwa dni", NOW).date), "2026-11-12");
  assert.equal(key(parseDate("za 2 tygodnie", NOW).date), "2026-11-24");
});

test("dzien tygodnia: dzis = dzis, 'przyszły' = za tydzien", () => {
  assert.equal(key(parseDate("we wtorek", NOW).date), "2026-11-10");
  assert.equal(key(parseDate("w przyszły wtorek", NOW).date), "2026-11-17");
  assert.equal(key(parseDate("w najbliższy piątek", NOW).date), "2026-11-13");
  assert.equal(key(parseDate("w poniedziałek", NOW).date), "2026-11-16");
});

test("daty liczbowe i z nazwa miesiaca", () => {
  assert.equal(key(parseDate("24 grudnia wigilia", NOW).date), "2026-12-24");
  assert.equal(key(parseDate("5 stycznia", NOW).date), "2027-01-05"); // minelo -> przyszly rok
  assert.equal(key(parseDate("3 października", NOW).date), "2027-10-03");
  assert.equal(key(parseDate("12.12", NOW).date), "2026-12-12");
  assert.equal(key(parseDate("1/2/2027", NOW).date), "2027-02-01");
  assert.equal(parseDate("31.02", NOW), null); // nie ma takiego dnia
  assert.equal(parseDate("15.30", NOW), null); // to godzina, nie data
});

test("'pojutrze' nie jest brane za 'jutro'", () => {
  assert.equal(key(parseDate("pojutrze rano", NOW).date), "2026-11-12");
});

test("godziny", () => {
  assert.equal(parseTime("o 15").time, "15:00");
  assert.equal(parseTime("o 9:05").time, "09:05");
  assert.equal(parseTime("o 15.30").time, "15:30");
  assert.equal(parseTime("o godzinie 8").time, "08:00");
  assert.equal(parseTime("o godz. 18:45").time, "18:45");
  assert.equal(parseTime("o 7 wieczorem").time, "19:00");
  assert.equal(parseTime("o 3 po południu").time, "15:00");
  assert.equal(parseTime("o 7 rano").time, "07:00");
  assert.equal(parseTime("spotkanie 14:20").time, "14:20");
  assert.equal(parseTime("o 25"), null);
  assert.equal(parseTime("do 15 listopada"), null);
});

test("polecenie kalendarza", () => {
  const c = parseVoiceCommand("dodaj dentysta jutro o 15:30", NOW);
  assert.equal(c.type, "calendar");
  assert.equal(c.dateKey, "2026-11-11");
  assert.equal(c.time, "15:30");
  assert.equal(c.title, "Dentysta");

  const c2 = parseVoiceCommand("w środę o 18 kino z Asią", NOW);
  assert.deepEqual([c2.type, c2.dateKey, c2.time, c2.title], ["calendar", "2026-11-11", "18:00", "Kino z Asią"]);

  const c3 = parseVoiceCommand("zaplanuj spotkanie dziś", NOW);
  assert.deepEqual([c3.dateKey, c3.time, c3.title], ["2026-11-10", "", "Spotkanie"]);

  const c4 = parseVoiceCommand("wpisz do kalendarza 24 grudnia wigilia u babci", NOW);
  assert.deepEqual([c4.dateKey, c4.title], ["2026-12-24", "Wigilia u babci"]);
});

test("polecenie zadania (stary format dalej dziala)", () => {
  assert.deepEqual(parseVoiceCommand("dodaj umyć podłogę w kategorii dom", NOW),
    { type: "todo", list: "dom", text: "umyć podłogę" });
  assert.deepEqual(parseVoiceCommand("dodaj do listy zadań zadzwonić do mamy do kategorii Telefony.", NOW),
    { type: "todo", list: "Telefony", text: "zadzwonić do mamy" });
  assert.deepEqual(parseVoiceCommand("dopisz wynieść śmieci do listy dom", NOW),
    { type: "todo", list: "dom", text: "wynieść śmieci" });
});

test("zadanie z data w tresci idzie na liste, nie do kalendarza", () => {
  const c = parseVoiceCommand("dodaj kupić prezent na jutro w kategorii dom", NOW);
  assert.equal(c.type, "todo");
  assert.equal(c.text, "kupić prezent na jutro");
});

test("lista zakupow", () => {
  assert.deepEqual(parseVoiceCommand("dodaj mleko do listy zakupów", NOW), { type: "shopping", items: ["mleko"] });
  assert.deepEqual(parseVoiceCommand("dodaj jajka, chleb i masło do zakupów", NOW),
    { type: "shopping", items: ["jajka", "chleb", "masło"] });
  assert.deepEqual(parseVoiceCommand("kup banany", NOW), { type: "shopping", items: ["banany"] });
});

test("nierozpoznane", () => {
  assert.equal(parseVoiceCommand("jaka jest pogoda", NOW).type, "unknown");
  assert.equal(parseVoiceCommand("", NOW).type, "unknown");
  assert.equal(parseVoiceCommand("dodaj jutro", NOW).type, "unknown"); // brak tytulu
});
