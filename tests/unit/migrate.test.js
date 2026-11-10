import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateLegacyData } from "../../js/lib/migrate.js";

const PATHS = { todo: "todo_lists", calendar: "calendar_events" };

function fakeDb(initial, { deny = () => false, failGet = false } = {}) {
  const data = structuredClone(initial);
  const get = (p) => p.split("/").reduce((o, k) => (o == null ? undefined : o[decodeURIComponent(k)]), data);
  const set = (p, v) => { const ks = p.split("/").map(decodeURIComponent); let o = data; ks.slice(0, -1).forEach((k) => { o = o[k] ??= {}; }); o[ks.at(-1)] = v; };
  const fetchImpl = async (url, opts = {}) => {
    const p = new URL(url).pathname.slice(1, -5);
    if (failGet) throw new TypeError("Failed to fetch");
    if (deny(p)) return { ok: false, status: 401, json: async () => ({}) };
    if (opts.method === "PUT") { set(p, JSON.parse(opts.body)); return { ok: true, status: 200 }; }
    return { ok: true, status: 200, json: async () => get(p) ?? null };
  };
  return { data, fetchImpl };
}

test("wlasciciel: stare dane kopiowane do jego przestrzeni, oryginal zostaje", async () => {
  const db = fakeDb({ todo_lists: [{ id: "l", name: "Dom" }], calendar_events: { "2026-11-10": [{ id: "e" }] } });
  const r = await migrateLegacyData({ baseUrl: "https://db.x", uid: "u1", token: "t", paths: PATHS, fetchImpl: db.fetchImpl });
  assert.deepEqual(r, { status: "done", copied: ["todo_lists", "calendar_events"] });
  assert.deepEqual(db.data.users.u1.todo_lists, [{ id: "l", name: "Dom" }]);
  assert.ok(db.data.users.u1.meta.migrated.at);
  assert.deepEqual(db.data.todo_lists, [{ id: "l", name: "Dom" }], "stare dane nie skasowane");
});

test("drugi raz nic nie robi (np. po wyczyszczeniu listy dane nie wracaja)", async () => {
  const db = fakeDb({ todo_lists: [{ id: "l" }], users: { u1: { meta: { migrated: { at: "x" } } } } });
  const r = await migrateLegacyData({ baseUrl: "https://db.x", uid: "u1", token: "t", paths: PATHS, fetchImpl: db.fetchImpl });
  assert.equal(r.status, "already");
  assert.equal(db.data.users.u1.todo_lists, undefined);
});

test("inne konto (reguly nie pozwalaja czytac starych danych) zaczyna od zera", async () => {
  const db = fakeDb({ todo_lists: [{ id: "l" }] }, { deny: (p) => !p.startsWith("users/u2/") });
  const r = await migrateLegacyData({ baseUrl: "https://db.x", uid: "u2", token: "t", paths: PATHS, fetchImpl: db.fetchImpl });
  assert.deepEqual(r, { status: "done", copied: [] });
  assert.equal(db.data.users.u2.todo_lists, undefined);
  assert.ok(db.data.users.u2.meta.migrated);
});

test("nie nadpisuje danych, ktore konto juz ma", async () => {
  const db = fakeDb({ todo_lists: [{ id: "stare" }], users: { u1: { todo_lists: [{ id: "nowe" }] } } });
  const r = await migrateLegacyData({ baseUrl: "https://db.x", uid: "u1", token: "t", paths: PATHS, fetchImpl: db.fetchImpl });
  assert.deepEqual(r.copied, []);
  assert.deepEqual(db.data.users.u1.todo_lists, [{ id: "nowe" }]);
});

test("brak sieci: wyjatek i brak znacznika (sprobuje nastepnym razem)", async () => {
  const db = fakeDb({ todo_lists: [1] }, { failGet: true });
  await assert.rejects(migrateLegacyData({ baseUrl: "https://db.x", uid: "u1", token: "t", paths: PATHS, fetchImpl: db.fetchImpl }));
  assert.equal(db.data.users, undefined);
});
