import { test } from "node:test";
import assert from "node:assert/strict";
import { createSharedEventSource } from "../../js/lib/shared-stream.js";
import { SyncedDoc } from "../../js/lib/firebase-sync.js";

class RealES {
  static all = [];
  constructor(url) { this.url = url; this.readyState = 1; this.h = {}; RealES.all.push(this); }
  addEventListener(t, fn) { (this.h[t] ||= []).push(fn); }
  emit(type, path, data) { for (const fn of this.h[type] || []) fn({ data: JSON.stringify({ path, data }) }); }
  close() { this.readyState = 2; }
}
const tick = () => new Promise((r) => setImmediate(r));

function setup(base = "users/u1") {
  RealES.all = [];
  const ES = createSharedEventSource({ getBase: () => base, RealEventSource: RealES });
  const docs = {};
  for (const name of ["todo_lists", "calendar_events", "shopping_list"]) {
    docs[name] = new SyncedDoc({ baseUrl: "https://db.x", path: `${base}/${name}`, EventSourceImpl: ES, fetchImpl: async () => ({ ok: true }) });
    docs[name].connect();
  }
  return { ES, docs };
}

test("kilka dokumentow = jedno polaczenie z katalogiem konta", () => {
  const { docs } = setup();
  assert.equal(RealES.all.length, 1);
  assert.equal(RealES.all[0].url, "https://db.x/users/u1.json");
  RealES.all[0].emit("put", "/", { todo_lists: [{ id: "a" }], shopping_list: [{ text: "x" }] });
  assert.deepEqual(docs.todo_lists.value, [{ id: "a" }]);
  assert.deepEqual(docs.shopping_list.value, [{ text: "x" }]);
  assert.equal(docs.calendar_events.getState().loaded, true, "pusty dokument tez dostaje dane");
  assert.equal(docs.calendar_events.value, null);
});

test("zmiany trafiaja tylko do wlasciwego dokumentu, ze sciezka wzgledna", () => {
  const { docs } = setup();
  const es = RealES.all[0];
  es.emit("put", "/", { todo_lists: [{ id: "a" }], shopping_list: [{ text: "x" }] });
  es.emit("put", "/calendar_events/2026-11-10", [{ id: "e" }]);
  assert.deepEqual(docs.calendar_events.value, { "2026-11-10": [{ id: "e" }] });
  es.emit("put", "/todo_lists/0/name", "Dom");
  assert.deepEqual(docs.todo_lists.value, [{ id: "a", name: "Dom" }]);
  es.emit("patch", "/", { "shopping_list/0": { text: "mleko" } });
  assert.deepEqual(docs.shopping_list.value, [{ text: "mleko" }]);
  es.emit("patch", "/calendar_events", { "2026-11-11": [{ id: "f" }] });
  assert.deepEqual(Object.keys(docs.calendar_events.value).sort(), ["2026-11-10", "2026-11-11"]);
});

test("dokument dolaczajacy pozniej dostaje od razu aktualny stan", async () => {
  const { ES } = setup();
  RealES.all[0].emit("put", "/", { recipes_data: { categories: [1] } });
  const late = new SyncedDoc({ baseUrl: "https://db.x", path: "users/u1/recipes_data", EventSourceImpl: ES, fetchImpl: async () => ({ ok: true }) });
  late.connect();
  await tick();
  assert.equal(RealES.all.length, 1);
  assert.deepEqual(late.value, { categories: [1] });
});

test("polaczenie zamykane, gdy wszystkie dokumenty sie odlacza; zerwane -> nowe", () => {
  const { docs } = setup();
  const es = RealES.all[0];
  es.readyState = 2;
  for (const d of Object.values(docs)) d.connect(); // ponowne laczenie po zerwaniu
  assert.equal(RealES.all.length, 2, "jedno nowe polaczenie dla wszystkich");
  for (const d of Object.values(docs)) d.close();
  assert.equal(RealES.all[1].readyState, 2);
});

test("bledy i 'cancel' trafiaja do wszystkich dokumentow", () => {
  const { docs } = setup();
  const errs = [];
  for (const [n, d] of Object.entries(docs)) d.es.onerror = () => errs.push(n);
  RealES.all[0].onerror();
  assert.equal(errs.length, 3);
});

test("bez wspolnego katalogu (stary tryb) kazdy dokument ma wlasne polaczenie", () => {
  RealES.all = [];
  const ES = createSharedEventSource({ getBase: () => null, RealEventSource: RealES });
  const a = new SyncedDoc({ baseUrl: "https://db.x", path: "todo_lists", EventSourceImpl: ES, fetchImpl: async () => ({ ok: true }) });
  a.connect();
  assert.equal(RealES.all.length, 1);
  assert.equal(RealES.all[0].url, "https://db.x/todo_lists.json");
  RealES.all[0].emit("put", "/", [1]);
  assert.deepEqual(a.value, [1]);
});

test("token w adresie: rozne tokeny = rozne polaczenia", async () => {
  RealES.all = [];
  const ES = createSharedEventSource({ getBase: () => "users/u1", RealEventSource: RealES });
  let tok = "t1";
  const mk = (n) => { const d = new SyncedDoc({ baseUrl: "https://db.x", path: "users/u1/" + n, EventSourceImpl: ES, getAuthToken: async () => tok, fetchImpl: async () => ({ ok: true }) }); d.connect(); return d; };
  const d1 = mk("a"); mk("b");
  await tick();
  assert.equal(RealES.all.length, 1);
  assert.equal(RealES.all[0].url, "https://db.x/users/u1.json?auth=t1");
  tok = "t2";
  d1.connect({ forceToken: true });
  await tick();
  assert.equal(RealES.all.at(-1).url, "https://db.x/users/u1.json?auth=t2");
});
