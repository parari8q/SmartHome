import { test } from "node:test";
import assert from "node:assert/strict";
import { SyncedDoc, combineStatus } from "../../js/lib/firebase-sync.js";
import { setAtPath, applyFirebaseEvent, firebaseClean, getAtPath } from "../../js/lib/paths.js";

// ---------------------------------------------------------------- atrapy

class FakeES {
  static last = null;
  constructor(url) { this.url = url; this.readyState = 1; this.handlers = {}; FakeES.last = this; }
  addEventListener(t, fn) { (this.handlers[t] ||= []).push(fn); }
  emit(type, path, data) { for (const fn of this.handlers[type] || []) fn({ data: JSON.stringify({ path, data }) }); }
  close() { this.readyState = 2; }
}

function makeTimers() {
  let t = 0; const q = [];
  return {
    now: () => t,
    timers: {
      setTimeout: (fn, ms) => { const h = { fn, at: t + ms }; q.push(h); return h; },
      clearTimeout: (h) => { const i = q.indexOf(h); if (i >= 0) q.splice(i, 1); },
    },
    advance(ms) {
      t += ms;
      for (;;) {
        q.sort((a, b) => a.at - b.at);
        if (!q.length || q[0].at > t) break;
        q.shift().fn();
      }
    },
  };
}

const tick = () => new Promise((r) => setImmediate(r));

function setup({ fetchImpl } = {}) {
  const calls = [];
  const clock = makeTimers();
  const responders = [];
  const f = fetchImpl || ((url, opts) => {
    calls.push({ url, ...opts });
    return new Promise((resolve, reject) => responders.push({ resolve, reject }));
  });
  const doc = new SyncedDoc({
    baseUrl: "https://db.example/", path: "todo_lists", fetchImpl: f, EventSourceImpl: FakeES,
    timers: clock.timers, now: clock.now, ackTimeoutMs: 4000,
  });
  doc.connect();
  return { doc, es: FakeES.last, calls, responders, clock };
}

const ok = { ok: true, status: 200, text: async () => "" };

// ---------------------------------------------------------------- sciezki

test("paths: set/get/usuwanie jak w Firebase", () => {
  let r = setAtPath(null, "a/b", 1);
  assert.deepEqual(r, { a: { b: 1 } });
  r = setAtPath(r, "a/c", [1, 2]);
  assert.deepEqual(getAtPath(r, "a/c/1"), 2);
  r = setAtPath(r, "a/b", null);
  r = setAtPath(r, "a/c", null);
  assert.equal(r, null); // puste rodzicielskie wezly znikaja
  assert.deepEqual(setAtPath({ x: 1 }, "", { y: 2 }), { y: 2 });
  assert.deepEqual(applyFirebaseEvent({ a: 1, b: { c: 2 } }, "patch", "/b", { d: 3, c: null }), { a: 1, b: { d: 3 } });
  assert.deepEqual(firebaseClean({ a: [], b: {}, c: null, d: [{ x: [] }], e: 0 }), { e: 0 });
});

// ---------------------------------------------------------------- synchronizacja

test("adres strumienia i zapisu", () => {
  const { doc, es } = setup();
  assert.equal(es.url, "https://db.example/todo_lists.json");
  assert.equal(doc.url("2026-11-10"), "https://db.example/todo_lists/2026-11-10.json");
});

test("dane z serwera trafiaja do odbiorcow, a status zmienia sie na 'live'", () => {
  const { doc, es } = setup();
  const seen = [];
  doc.subscribe((v) => seen.push(v));
  assert.equal(doc.getState().loaded, false);
  es.emit("put", "/", [{ id: "a" }]);
  assert.deepEqual(seen, [[{ id: "a" }]]);
  assert.equal(doc.getState().connection, "live");
  es.emit("put", "/0/name", "Dom");
  assert.deepEqual(seen.at(-1), [{ id: "a", name: "Dom" }]);
});

test("wlasny zapis widac od razu; echo nie powoduje drugiego renderu", async () => {
  const { doc, es, calls, responders } = setup();
  es.emit("put", "/", [{ id: "a" }]);
  const seen = [];
  doc.subscribe((v) => seen.push(v));
  doc.set("", [{ id: "a" }, { id: "b" }]);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[1], [{ id: "a" }, { id: "b" }]);
  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].body, JSON.stringify([{ id: "a" }, { id: "b" }]));
  responders[0].resolve(ok);
  await tick();
  es.emit("put", "/", [{ id: "a" }, { id: "b" }]); // echo
  assert.equal(seen.length, 2);
  assert.equal(doc.queue.length, 0);
});

test("spozniony stary snapshot NIE nadpisuje swiezej zmiany (stary bug przepisow)", async () => {
  const { doc, es, responders } = setup();
  es.emit("put", "/", ["stare"]);
  doc.set("", ["nowe"]);
  es.emit("put", "/", ["stare"]); // stary stan przychodzi zanim serwer przetworzy zapis
  assert.deepEqual(doc.value, ["nowe"]);
  responders[0].resolve(ok);
  await tick();
  assert.deepEqual(doc.value, ["nowe"]); // potwierdzony, czeka na echo
  es.emit("put", "/", ["nowe"]);
  assert.deepEqual(doc.value, ["nowe"]);
  assert.equal(doc.queue.length, 0);
});

test("zmiana z innego urzadzenia jest widoczna mimo trwajacego zapisu w innym miejscu", async () => {
  const { doc, es, responders } = setup();
  es.emit("put", "/", { a: 1 });
  doc.set("b", 2);
  es.emit("put", "/c", 3); // inne urzadzenie
  assert.deepEqual(doc.value, { a: 1, b: 2, c: 3 });
  responders[0].resolve(ok);
  await tick();
  es.emit("put", "/b", 2);
  assert.deepEqual(doc.value, { a: 1, b: 2, c: 3 });
});

test("zapisy ida po kolei, a pusta tablica w echu (Firebase ja kasuje) i tak zamyka zapis", async () => {
  const { doc, es, calls, responders } = setup();
  es.emit("put", "/", null);
  doc.set("", [{ id: "a", tasks: [] }]);
  doc.set("", [{ id: "a", tasks: [] }, { id: "b", tasks: [] }]);
  assert.equal(calls.length, 1, "drugi zapis czeka na pierwszy");
  responders[0].resolve(ok);
  await tick();
  assert.equal(calls.length, 2);
  responders[1].resolve(ok);
  await tick();
  es.emit("put", "/", [{ id: "a" }, { id: "b" }]);
  assert.equal(doc.queue.length, 0);
});

test("null wysyla DELETE", () => {
  const { doc, es, calls } = setup();
  es.emit("put", "/", { "2026-11-10": true });
  doc.set("2026-11-10", null);
  assert.equal(calls[0].method, "DELETE");
  assert.equal(calls[0].url, "https://db.example/todo_lists/2026-11-10.json");
  assert.equal(doc.value, null);
});

test("blad serwera cofa zmiane i pokazuje komunikat", async () => {
  const { doc, es, responders } = setup();
  es.emit("put", "/", ["a"]);
  const p = doc.set("", ["a", "b"]);
  responders[0].resolve({ ok: false, status: 500, text: async () => "Internal boom" });
  await assert.rejects(p, /HTTP 500/);
  assert.deepEqual(doc.value, ["a"]);
  assert.match(doc.getState().error, /Internal boom/);
});

test("brak sieci: zmiana zostaje, zapis ponawiany az do skutku", async () => {
  const { doc, es, calls, responders, clock } = setup();
  es.emit("put", "/", []);
  const p = doc.set("", ["x"]);
  responders[0].reject(new TypeError("Failed to fetch"));
  await tick();
  assert.deepEqual(doc.value, ["x"]);
  assert.match(doc.getState().error, /Brak połączenia/);
  assert.equal(calls.length, 1);
  clock.advance(1000);
  await tick();
  assert.equal(calls.length, 2);
  responders[1].reject(new TypeError("Failed to fetch"));
  await tick();
  clock.advance(1999);
  await tick();
  assert.equal(calls.length, 2, "kolejna proba po 2 s (rosnacy odstep)");
  clock.advance(1);
  await tick();
  assert.equal(calls.length, 3);
  responders[2].resolve(ok);
  await p;
  assert.equal(doc.getState().error, null);
});

test("potwierdzony zapis bez echa znika po czasie (nie blokuje zmian z innych urzadzen)", async () => {
  const { doc, es, responders, clock } = setup();
  es.emit("put", "/", ["a"]);
  doc.set("", ["mine"]);
  responders[0].resolve(ok);
  await tick();
  es.emit("put", "/", ["theirs"]); // ktos nadpisal zaraz po nas
  assert.deepEqual(doc.value, ["mine"]);
  clock.advance(4000);
  assert.deepEqual(doc.value, ["theirs"]);
});

test("ponowne polaczenie po zerwaniu i po 'zawieszeniu' strumienia", () => {
  const { doc, es, clock } = setup();
  es.emit("put", "/", 1);
  es.readyState = 2;
  es.onerror();
  assert.equal(doc.getState().connection, "offline");
  clock.advance(2000);
  assert.notEqual(FakeES.last, es, "nowe polaczenie");
  const es2 = FakeES.last;
  es2.emit("put", "/", 2);
  assert.equal(doc.value, 2);
  clock.advance(100000); // brak keep-alive przez 100 s
  doc.ensureConnected();
  assert.notEqual(FakeES.last, es2);
});

test("blad w jednym odbiorcy nie psuje pozostalych", () => {
  const { doc, es } = setup();
  const orig = console.error; console.error = () => {};
  let got = null;
  doc.subscribe(() => { throw new Error("boom"); });
  doc.subscribe((v) => { got = v; });
  es.emit("put", "/", 5);
  console.error = orig;
  assert.equal(got, 5);
});

test("laczny status", () => {
  const live = { connection: "live", loaded: true, pending: 0, error: null };
  assert.equal(combineStatus({ a: live, b: live }), "live");
  assert.equal(combineStatus({ a: live, b: { ...live, pending: 1 } }), "saving");
  assert.equal(combineStatus({ a: live, b: { ...live, connection: "offline" } }), "offline");
  assert.equal(combineStatus({ a: { ...live, loaded: false, connection: "connecting" } }), "connecting");
  assert.equal(combineStatus({ a: { ...live, error: "x" } }), "warning");
});

// ---------------------------------------------------------------- logowanie

function setupAuth({ token = "tok1", probeStatus = 401 } = {}) {
  const calls = [];
  const clock = makeTimers();
  let authRequired = 0;
  const tokens = [];
  const doc = new SyncedDoc({
    baseUrl: "https://db.example", path: "todo_lists", EventSourceImpl: FakeES, timers: clock.timers, now: clock.now,
    fetchImpl: async (url, opts) => { calls.push({ url, ...opts }); return url.includes("shallow") ? { status: probeStatus, ok: probeStatus < 300 } : ok; },
    getAuthToken: async ({ force }) => { tokens.push(force); return typeof token === "function" ? token(force) : token; },
    onAuthRequired: () => authRequired++,
  });
  return { doc, calls, clock, tokens, get authRequired() { return authRequired; } };
}

test("logowanie: token trafia do strumienia i do zapisow", async () => {
  const t = setupAuth();
  t.doc.connect();
  await tick();
  assert.equal(FakeES.last.url, "https://db.example/todo_lists.json?auth=tok1");
  FakeES.last.emit("put", "/", []);
  await t.doc.set("", ["x"]);
  assert.equal(t.calls[0].url, "https://db.example/todo_lists.json?auth=tok1");
});

test("logowanie: odmowa dostepu (401) -> jedna proba ze swiezym tokenem, potem prosba o logowanie", async () => {
  const t = setupAuth({ token: (force) => (force ? "fresh" : "old") });
  t.doc.connect();
  await tick();
  FakeES.last.readyState = 2;
  FakeES.last.onerror();
  await tick(); await tick();
  assert.equal(FakeES.last.url, "https://db.example/todo_lists.json?auth=fresh", "ponowienie ze swiezym tokenem");
  FakeES.last.readyState = 2;
  FakeES.last.onerror();
  await tick(); await tick();
  assert.equal(t.authRequired, 1);
  assert.equal(t.doc.getState().connection, "auth");
  assert.equal(combineStatus({ a: t.doc.getState() }), "auth");
});

test("logowanie: zerwanie przez siec (nie 401) -> zwykle ponowne laczenie", async () => {
  const t = setupAuth({ probeStatus: 200 });
  t.doc.connect();
  await tick();
  const first = FakeES.last;
  first.readyState = 2;
  first.onerror();
  await tick(); await tick();
  assert.equal(t.authRequired, 0);
  t.clock.advance(2000);
  await tick();
  assert.notEqual(FakeES.last, first);
});

test("logowanie: wygasly token w strumieniu (auth_revoked) -> nowe polaczenie z odswiezonym tokenem", async () => {
  const t = setupAuth();
  t.doc.connect();
  await tick();
  const first = FakeES.last;
  first.handlers.auth_revoked[0]({ data: "null" });
  await tick();
  assert.notEqual(FakeES.last, first);
  assert.deepEqual(t.tokens, [false, true]);
});

test("logowanie: zapis odrzucony 401 cofa zmiane i prosi o logowanie", async () => {
  const clock = makeTimers();
  let asked = 0;
  const doc = new SyncedDoc({ baseUrl: "https://db.example", path: "x", EventSourceImpl: FakeES, timers: clock.timers, now: clock.now,
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => "Permission denied" }),
    getAuthToken: async () => null, onAuthRequired: () => asked++ });
  doc.connect();
  await tick();
  FakeES.last.emit("put", "/", ["a"]);
  await assert.rejects(doc.set("", ["a", "b"]), /zaloguj/);
  assert.deepEqual(doc.value, ["a"]);
  assert.equal(asked, 1);
});
