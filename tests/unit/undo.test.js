import { test } from "node:test";
import assert from "node:assert/strict";
import { UndoStack } from "../../js/logic/undo.js";

test("cofanie po kolei, od ostatniej zmiany", () => {
  const u = new UndoStack();
  u.push({ before: [], after: ["a"], label: "1" });
  u.push({ before: ["a"], after: ["a", "b"], label: "2" });
  assert.equal(u.size, 2);
  assert.equal(u.peek().label, "2");
  assert.equal(u.pop().label, "2");
  assert.equal(u.pop().label, "1");
  assert.equal(u.pop(), null);
});

test("limit historii: najstarsze zmiany wypadają", () => {
  const u = new UndoStack(3);
  for (let i = 1; i <= 5; i++) u.push({ label: String(i) });
  assert.equal(u.size, 3);
  assert.deepEqual([u.pop().label, u.pop().label, u.pop().label], ["5", "4", "3"]);
  u.push({ label: "x" });
  u.clear();
  assert.equal(u.size, 0);
});
