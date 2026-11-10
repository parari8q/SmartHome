// ==========================================================================
// Logowanie do Firebase (e-mail + haslo) przez REST — bez ciezkiego SDK.
// Sesja (refresh token) zapisana w localStorage, wiec kazde urzadzenie
// loguje sie tylko raz. Token dostepu (wazny 1 h) odswiezany automatycznie.
// ==========================================================================

const STORAGE_KEY = "firebase_session";

const ERRORS = {
  EMAIL_NOT_FOUND: "Zły e-mail lub hasło.",
  INVALID_PASSWORD: "Zły e-mail lub hasło.",
  INVALID_LOGIN_CREDENTIALS: "Zły e-mail lub hasło.",
  INVALID_EMAIL: "To nie wygląda na adres e-mail.",
  USER_DISABLED: "To konto jest wyłączone.",
  TOO_MANY_ATTEMPTS_TRY_LATER: "Za dużo prób — spróbuj za kilka minut.",
  OPERATION_NOT_ALLOWED: "Logowanie e-mailem nie jest włączone w konsoli Firebase.",
};

export function authErrorMessage(code = "") {
  const key = Object.keys(ERRORS).find((k) => code.startsWith(k));
  return key ? ERRORS[key] : "Nie udało się zalogować (" + code + ").";
}

export class FirebaseAuth {
  constructor({ apiKey, fetchImpl, storage, now } = {}) {
    this.apiKey = apiKey;
    this.fetch = fetchImpl || ((...a) => globalThis.fetch(...a));
    this.storage = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    this.now = now || (() => Date.now());
    this.session = this._load();
    this._refreshing = null;
    this._listeners = new Set();
  }

  _load() {
    try { return JSON.parse(this.storage?.getItem(STORAGE_KEY) || "null"); } catch { return null; }
  }

  _save(session) {
    this.session = session;
    if (session) this.storage?.setItem(STORAGE_KEY, JSON.stringify(session));
    else this.storage?.removeItem(STORAGE_KEY);
    for (const fn of this._listeners) { try { fn(session); } catch (e) { console.error(e); } }
  }

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }

  get isLoggedIn() { return !!this.session; }
  get email() { return this.session?.email || null; }
  get uid() { return this.session?.uid || null; }

  async signIn(email, password) {
    const res = await this.fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${this.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password, returnSecureToken: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.idToken) throw new Error(authErrorMessage(data?.error?.message || "HTTP " + res.status));
    this._save({
      email: data.email || email.trim(),
      uid: data.localId,
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      expiresAt: this.now() + Number(data.expiresIn || 3600) * 1000,
    });
    return this.session;
  }

  signOut() { this._save(null); }

  /** Aktualny token (odswiezony, jesli wygasa w ciagu 5 min). null = niezalogowany. */
  async getToken({ force = false } = {}) {
    const s = this.session;
    if (!s) return null;
    if (!force && this.now() < s.expiresAt - 5 * 60000) return s.idToken;
    if (!this._refreshing) this._refreshing = this._refresh().finally(() => { this._refreshing = null; });
    return this._refreshing;
  }

  async _refresh() {
    const s = this.session;
    let res;
    try {
      res = await this.fetch(`https://securetoken.googleapis.com/v1/token?key=${this.apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: s.refreshToken }).toString(),
      });
    } catch {
      // brak sieci — stary token, jesli jeszcze wazny; inaczej i tak nie ma polaczenia
      return this.now() < s.expiresAt ? s.idToken : null;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id_token) {
      // sesja uniewazniona (np. zmiana hasla, usuniete konto) — trzeba zalogowac sie ponownie
      if (res.status === 400 || res.status === 401 || res.status === 403) this._save(null);
      return null;
    }
    this._save({
      ...s,
      idToken: data.id_token,
      refreshToken: data.refresh_token || s.refreshToken,
      uid: data.user_id || s.uid,
      expiresAt: this.now() + Number(data.expires_in || 3600) * 1000,
    });
    return this.session.idToken;
  }
}
