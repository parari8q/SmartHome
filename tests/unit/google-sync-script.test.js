// Czyste funkcje skryptu Apps Script (tools/google-calendar-sync.gs) — ladowane w piaskownicy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(new URL("../../tools/google-calendar-sync.gs", import.meta.url), "utf8");
const sb = {};
vm.createContext(sb);
vm.runInContext(code + "\n;this.__ = { parseConfig, eventSpec, mirrorEvent, colorFor, toList, addDaysKey };", sb);
const G = sb.__;
const plain = (o) => JSON.parse(JSON.stringify(o));
const ctx = { order: ["aaa", "bbb"], names: { aaa: "Ja", bbb: "Ola" } };

test("konfiguracja: wymagane pola i bezpieczny adres bazy", () => {
  const ok = { apiKey: "k", dbUrl: "https://x.firebasedatabase.app/", refreshToken: "r", uid: "u", base: "groups/g/data", gid: "g", name: "Ja" };
  assert.deepEqual(plain(G.parseConfig(JSON.stringify(ok))), { ...ok, dbUrl: "https://x.firebasedatabase.app" });
  assert.throws(() => G.parseConfig("{"), /uszkodzona/);
  assert.throws(() => G.parseConfig(JSON.stringify({ ...ok, refreshToken: "" })), /refreshToken/);
  assert.throws(() => G.parseConfig(JSON.stringify({ ...ok, dbUrl: "https://evil.com/x?y" })), /adres bazy/);
});

test("kolory osób zgodne z kolejnością w aplikacji", () => {
  assert.equal(G.colorFor("aaa", ctx.order), "7");
  assert.equal(G.colorFor("bbb", ctx.order), "4");
  assert.equal(G.colorFor("all", ctx.order), "2");
  assert.equal(G.colorFor("", ctx.order), null);
  assert.equal(G.colorFor("obcy", ctx.order), null);
});

test("wydarzenie z godziną (domyślnie 1 h), całodniowe, kilkudniowe", () => {
  const t = plain(G.eventSpec({ id: "1", title: "Kino", time: "18:00", who: "bbb" }, "2026-11-12", ctx));
  assert.deepEqual([t.allDay, t.start, t.end, t.color, t.description, t.recurrence], [false, { y: 2026, m: 11, d: 12, h: 18, mi: 0 }, { y: 2026, m: 11, d: 12, h: 19, mi: 0 }, "4", "Dla: Ola\nZ aplikacji SmartHome — zmieniaj w aplikacji.", null]);
  assert.deepEqual(plain(G.eventSpec({ time: "18:00", end: "19:30", title: "A" }, "2026-11-12", ctx).end), { y: 2026, m: 11, d: 12, h: 19, mi: 30 });
  const a = plain(G.eventSpec({ title: "Urodziny", time: "" }, "2026-11-30", ctx));
  assert.deepEqual([a.allDay, a.end, a.color], [true, { y: 2026, m: 12, d: 1 }, null]); // koniec wylacznie
  const m = plain(G.eventSpec({ title: "Wyjazd", time: "", to: "2026-12-07", who: "all" }, "2026-12-05", ctx));
  assert.deepEqual([m.multiDay, m.end, m.color, m.description.split("\n")[0]], [true, { y: 2026, m: 12, d: 8 }, "2", "Dla: wszystkich (Wspólne)"]);
});

test("powtarzanie: dni tygodnia, koniec, pominięte dni", () => {
  const r = plain(G.eventSpec({ title: "Trening", time: "18:00", repeat: { freq: "week", days: [2, 5], until: "2027-01-31" }, skip: { "2026-11-27": true, zle: true } }, "2026-11-03", ctx).recurrence);
  assert.deepEqual(r, { freq: "week", days: [2, 5], until: "2027-01-31", skip: ["2026-11-27"] });
  assert.deepEqual(plain(G.eventSpec({ title: "T", time: "", repeat: { freq: "week" } }, "2026-11-11", ctx).recurrence.days), [3]); // sroda
  assert.deepEqual(plain(G.eventSpec({ title: "U", repeat: { freq: "year" } }, "2026-11-28", ctx).recurrence), { freq: "year", days: [], until: null, skip: [] });
  assert.deepEqual(plain(G.toList({ 1: "b", 0: "a" })), ["a", "b"]); // Firebase moze zwrocic tablice jako obiekt
});

test("wydarzenia z Google → aplikacja (koniec całodniowych wyłączny)", () => {
  const fmt = (d, f) => {
    const iso = d.toISOString();
    return f === "yyyy-MM-dd" ? iso.slice(0, 10) : iso.slice(11, 16);
  };
  const U = (s) => new Date(s + "Z");
  assert.deepEqual(plain(G.mirrorEvent({ id: "x", title: "Fryzjer", allDay: false, start: U("2026-11-30T10:00:00"), end: U("2026-11-30T11:00:00") }, fmt)),
    { id: "x@2026-11-30", title: "Fryzjer", date: "2026-11-30", time: "10:00", end: "11:00" });
  assert.deepEqual(plain(G.mirrorEvent({ id: "y", title: "Urlop", allDay: true, start: U("2026-12-01T00:00:00"), end: U("2026-12-04T00:00:00") }, fmt)),
    { id: "y@2026-12-01", title: "Urlop", date: "2026-12-01", to: "2026-12-03" });
  assert.deepEqual(plain(G.mirrorEvent({ id: "z", title: "", allDay: true, start: U("2026-12-05T00:00:00"), end: U("2026-12-06T00:00:00") }, fmt)),
    { id: "z@2026-12-05", title: "(bez tytułu)", date: "2026-12-05" });
});
