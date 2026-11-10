import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClickUrl } from "../../js/notify.js";

const B = "https://x.github.io/SmartHome/dashboard.html";

test("klikniecie w powiadomienie: konkretne miejsce, gdy jedno; ogolny widok, gdy rozne", () => {
  assert.equal(buildClickUrl("calendar", [{ day: "2026-11-12", eventId: "ev_1" }], B), B + "?otworz=kalendarz&dzien=2026-11-12&wpis=ev_1");
  assert.equal(buildClickUrl("calendar", [{ day: "2026-11-12", eventId: "a" }, { day: "2026-11-12", eventId: "b" }], B), B + "?otworz=kalendarz&dzien=2026-11-12");
  assert.equal(buildClickUrl("calendar", [{ day: "2026-11-12" }, { day: "2026-11-13" }], B), B + "?otworz=kalendarz");
  assert.equal(buildClickUrl("todo", [{ listId: "L1", taskId: "T1" }], B), B + "?otworz=zadania&lista=L1&wpis=T1");
  assert.equal(buildClickUrl("todo", [{ listId: "L1", taskId: "T1" }, { listId: "L2", taskId: "T2" }], B), B + "?otworz=zadania");
  assert.equal(buildClickUrl("shopping", [null, null], B), B + "?otworz=zakupy");
  assert.equal(buildClickUrl("recipes", [{ recipeId: "r1" }], B), B + "?otworz=przepisy&przepis=r1");
  assert.equal(buildClickUrl("recipes", [{ recipeId: "r1" }, { recipeId: "r2" }], B), B + "?otworz=przepisy");
});
