import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeGoogle, googleOnDay, googleInRange } from "../../js/logic/google-cal.js";

const doc = normalizeGoogle({
  u1: { name: "Ola", updatedAt: 5, events: [
    { id: "a", title: "Fryzjer", date: "2026-11-30", time: "10:00", end: "11:00", link: "https://www.google.com/calendar/event?eid=x" },
    { id: "b", title: "Urlop", date: "2026-12-01", to: "2026-12-03" },
    { id: "c", title: "zła data", date: "jutro" },
    { id: "d", title: "", date: "2026-12-05", link: "javascript:alert(1)" },
  ] },
});

test("normalizacja odrzuca błędne daty i niebezpieczne linki", () => {
  assert.deepEqual(doc.u1.events.map((e) => e.id), ["a", "b", "d"]);
  assert.equal(doc.u1.events[2].title, "(bez tytułu)");
  assert.equal(doc.u1.events[2].link, undefined);
  assert.equal(doc.u1.events[0].link, "https://www.google.com/calendar/event?eid=x");
});

test("wydarzenia dnia i przedziału (kilkudniowe raz w przedziale)", () => {
  assert.deepEqual(googleOnDay(doc, "2026-12-02").map((e) => [e.title, e.who, e.google, e.multi]), [["Urlop", "u1", true, true]]);
  assert.deepEqual(googleOnDay(doc, "2026-11-30")[0], { id: "g:u1:a", title: "Fryzjer", time: "10:00", end: "11:00", startKey: "2026-11-30", occKey: "2026-11-30", dateKey: "2026-11-30", multi: false, google: true, who: "u1", link: "https://www.google.com/calendar/event?eid=x", ownerName: "Ola" });
  assert.deepEqual(googleInRange(doc, "2026-12-02", "2026-12-10").map((e) => [e.title, e.dateKey]), [["Urlop", "2026-12-02"], ["(bez tytułu)", "2026-12-05"]]);
});
