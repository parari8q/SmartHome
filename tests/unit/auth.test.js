import { test } from "node:test";
import assert from "node:assert/strict";
import { FirebaseAuth, authErrorMessage } from "../../js/lib/auth.js";

function memStorage() { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; }
const json = (status, body) => ({ ok: status < 300, status, json: async () => body });

test("logowanie e-mailem zapisuje sesje, ktora przetrwa przeladowanie", async () => {
  const storage = memStorage();
  const calls = [];
  const auth = new FirebaseAuth({ apiKey: "KEY", storage, now: () => 0, fetchImpl: async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return json(200, { idToken: "id1", refreshToken: "r1", expiresIn: "3600", localId: "uid1", email: "a@b.pl" });
  } });
  await auth.signIn(" a@b.pl ", "haslo");
  assert.match(calls[0].url, /accounts:signInWithPassword\?key=KEY/);
  assert.deepEqual(calls[0].body, { email: "a@b.pl", password: "haslo", returnSecureToken: true });
  assert.equal(auth.uid, "uid1");
  const again = new FirebaseAuth({ apiKey: "KEY", storage, now: () => 0 });
  assert.equal(again.isLoggedIn, true);
  assert.equal(await again.getToken(), "id1");
});

test("zle haslo -> czytelny komunikat po polsku", async () => {
  const auth = new FirebaseAuth({ apiKey: "K", storage: memStorage(), fetchImpl: async () => json(400, { error: { message: "INVALID_LOGIN_CREDENTIALS" } }) });
  await assert.rejects(auth.signIn("a@b.pl", "x"), /Zły e-mail lub hasło/);
  assert.equal(auth.isLoggedIn, false);
  assert.match(authErrorMessage("TOO_MANY_ATTEMPTS_TRY_LATER : Access disabled"), /Za dużo prób/);
});

test("token odswiezany przed wygasnieciem, rownolegle prosby = jedno odswiezenie", async () => {
  let t = 0, refreshes = 0;
  const storage = memStorage();
  const auth = new FirebaseAuth({ apiKey: "K", storage, now: () => t, fetchImpl: async (url) => {
    if (url.includes("signInWithPassword")) return json(200, { idToken: "id1", refreshToken: "r1", expiresIn: "3600", localId: "u" });
    refreshes++;
    return json(200, { id_token: "id2", refresh_token: "r2", expires_in: "3600", user_id: "u" });
  } });
  await auth.signIn("a@b.pl", "x");
  t = 50 * 60000;
  assert.equal(await auth.getToken(), "id1");
  t = 56 * 60000;
  const [a, b] = await Promise.all([auth.getToken(), auth.getToken()]);
  assert.deepEqual([a, b, refreshes], ["id2", "id2", 1]);
  assert.equal(await auth.getToken({ force: true }), "id2");
  assert.equal(refreshes, 2);
});

test("uniewazniona sesja wylogowuje; brak sieci zostawia wazny token", async () => {
  let t = 0, mode = "offline";
  const auth = new FirebaseAuth({ apiKey: "K", storage: memStorage(), now: () => t, fetchImpl: async (url) => {
    if (url.includes("signInWithPassword")) return json(200, { idToken: "id1", refreshToken: "r1", expiresIn: "3600", localId: "u" });
    if (mode === "offline") throw new TypeError("Failed to fetch");
    return json(400, { error: { message: "TOKEN_EXPIRED" } });
  } });
  await auth.signIn("a@b.pl", "x");
  t = 58 * 60000;
  assert.equal(await auth.getToken(), "id1");
  t = 61 * 60000;
  assert.equal(await auth.getToken(), null);
  assert.equal(auth.isLoggedIn, true);
  mode = "revoked";
  let changed = 0;
  auth.onChange(() => changed++);
  assert.equal(await auth.getToken(), null);
  assert.equal(auth.isLoggedIn, false);
  assert.equal(changed, 1);
});
