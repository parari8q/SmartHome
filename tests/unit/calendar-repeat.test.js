import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../../js/logic/calendar.js";

const cal = C.normalizeCalendar({
  "2026-11-03": [{ id: "tr", time: "18:00", end: "19:30", title: "Trening", repeat: { freq: "week", days: [2, 5] }, who: "u1" }],
  "2026-11-28": [{ id: "ur", time: "", title: "Urodziny", repeat: { freq: "year" } }],
  "2026-12-05": [{ id: "wy", time: "", title: "Wyjazd", to: "2026-12-07" }],
  "2026-01-31": [{ id: "cz", time: "", title: "Czynsz", repeat: { freq: "month" } }],
});
const titles = (key) => C.eventsOnDay(cal, key).map((e) => e.title);

test("normalizacja zachowuje nowe pola i odrzuca błędne", () => {
  const e = C.normalizeEvent({ id: "x", time: "18:00", end: "19:00", title: "A", to: "zle", repeat: { freq: "week", days: [5, 2, 9] }, skip: { "2026-11-06": true, x: 1 }, who: "u1" });
  assert.deepEqual(e, { id: "x", time: "18:00", end: "19:00", title: "A", repeat: { freq: "week", days: [2, 5] }, skip: { "2026-11-06": true }, who: "u1" });
  assert.equal(C.normalizeEvent({ time: "", end: "19:00", title: "B" }).end, undefined); // koniec tylko z poczatkiem
});

test("powtarzanie: tydzień (wt, pt), rok, miesiąc (bez 31 w krótkich miesiącach)", () => {
  assert.deepEqual(titles("2026-11-27"), ["Trening"]); // piatek
  assert.deepEqual(titles("2026-11-24"), ["Trening"]); // wtorek
  assert.deepEqual(titles("2026-11-25"), []);
  assert.deepEqual(titles("2026-11-02"), []); // przed startem
  assert.deepEqual(titles("2027-11-28"), ["Urodziny"]);
  assert.deepEqual(titles("2026-03-31"), ["Czynsz"]);
  assert.deepEqual(titles("2026-04-30"), []);
});

test("wydarzenie kilkudniowe widać każdego dnia, w occurrences raz", () => {
  assert.ok(titles("2026-12-06").includes("Wyjazd"));
  assert.ok(titles("2026-12-07").includes("Wyjazd"));
  assert.ok(!titles("2026-12-08").includes("Wyjazd"));
  const occ = C.occurrences(cal, "2026-12-01", "2026-12-10").filter((e) => e.id === "wy");
  assert.equal(occ.length, 1);
});

test("usuwanie: tylko ten dzień, ten i następne, całość", () => {
  const one = { ...cal, "2026-11-03": C.deleteOccurrence(cal, "2026-11-03", "tr", "2026-11-27", "one") };
  assert.deepEqual(C.eventsOnDay(one, "2026-11-27").map((e) => e.id), []);
  assert.deepEqual(C.eventsOnDay(one, "2026-12-01").map((e) => e.id), ["tr"]);
  const fol = { ...cal, "2026-11-03": C.deleteOccurrence(cal, "2026-11-03", "tr", "2026-11-27", "following") };
  assert.deepEqual(C.eventsOnDay(fol, "2026-11-24").map((e) => e.id), ["tr"]);
  assert.deepEqual(C.eventsOnDay(fol, "2026-11-27").map((e) => e.id), []);
  assert.deepEqual(C.eventsOnDay(fol, "2026-12-04").map((e) => e.id), []);
  assert.equal(C.deleteOccurrence(cal, "2026-11-03", "tr", "2026-11-03", "following"), null);
  assert.equal(C.deleteOccurrence(cal, "2026-12-05", "wy", "2026-12-05", "one"), null); // bez powtarzania = usun
});

test("zapis: nowe, edycja w miejscu, przeniesienie na inny dzień", () => {
  const c = { "2026-11-10": [{ id: "a", time: "", title: "A" }, { id: "b", time: "", title: "B" }] };
  assert.deepEqual(C.saveEvent(c, { newKey: "2026-11-10", event: { id: "n", time: "18:00", title: " Kino " } })[0][1].map((e) => e.title), ["A", "B", "Kino"]);
  assert.deepEqual(C.saveEvent(c, { oldKey: "2026-11-10", newKey: "2026-11-10", event: { id: "a", time: "", title: "A2" } })[0][1].map((e) => e.title), ["A2", "B"]);
  const moved = C.saveEvent(c, { oldKey: "2026-11-10", newKey: "2026-11-12", event: { id: "a", time: "", title: "A" } });
  assert.deepEqual(moved.map(([k, l]) => [k, l && l.map((e) => e.id)]), [["2026-11-10", ["b"]], ["2026-11-12", ["a"]]]);
});

test("najbliższe wydarzenia uwzględniają powtórzenia i trwające wyjazdy", () => {
  const up = C.upcomingEvents(cal, new Date(2026, 11, 6, 9), 3, 5);
  assert.deepEqual(up.map((e) => [e.title, e.dateKey, e.dayOffset]), [["Wyjazd", "2026-12-06", 0], ["Trening", "2026-12-08", 2]]);
  const up2 = C.upcomingEvents(cal, new Date(2026, 10, 26, 9), 3, 5);
  assert.deepEqual(up2.map((e) => e.title), ["Trening", "Urodziny"]);
});

test("szybkie dodawanie po polsku", () => {
  const now = new Date(2026, 10, 27, 12); // piatek
  assert.deepEqual(C.parseQuickAdd("jutro 18 trening", now), { title: "Trening", dateKey: "2026-11-28", time: "18:00" });
  assert.deepEqual(C.parseQuickAdd("dentysta w środę o 9:30", now), { title: "Dentysta", dateKey: "2026-12-02", time: "09:30" });
  assert.deepEqual(C.parseQuickAdd("kino", now), { title: "Kino", dateKey: null, time: null });
  assert.deepEqual(C.parseQuickAdd("dziś 2 piwa z Tomkiem", now), { title: "2 piwa z Tomkiem", dateKey: "2026-11-27", time: null });
});

test("etykiety: powtarzanie i godzina końca", () => {
  assert.equal(C.repeatLabel(cal["2026-11-03"][0]), "co tydzień (wt, pt)");
  assert.equal(C.addMinutes("18:00", 90), "19:30");
  assert.equal(C.addMinutes("23:30", 120), "23:59");
  assert.equal(C.durationMinutes({ time: "18:00", end: "19:30" }), 90);
});
