// ==========================================================================
// Jedno wspolne polaczenie SSE zamiast osobnego dla kazdego dokumentu.
//
// Przegladarka pozwala tylko na kilka stalych polaczen do jednego serwera
// (HTTP/1.1: 6, wspolne dla WSZYSTKICH kart). Przy 5 dokumentach = 5 polaczen
// na karte, juz druga otwarta karta z dashboardem utykala na "laczenie...".
// Tu wszystkie dokumenty pod wspolnym katalogiem (np. users/<uid>) dostaja
// dane z jednego strumienia.
//
// Zwraca klase zgodna z EventSource — SyncedDoc nie musi nic o tym wiedziec.
// ==========================================================================

import { applyFirebaseEvent, getAtPath, splitPath } from "./paths.js";

const CLOSED = 2;

function parseUrl(url) {
  const u = new URL(url);
  const path = splitPath(decodeURIComponent(u.pathname.replace(/\.json$/, "")));
  return { origin: u.origin, path, auth: u.searchParams.get("auth") || "" };
}

/** baseUrl: adres bazy; getBase(): aktualny wspolny katalog (np. "users/abc") albo null. */
export function createSharedEventSource({ getBase, RealEventSource = globalThis.EventSource }) {
  const hubs = new Map(); // klucz: origin|base|auth

  class Hub {
    constructor(key, url) {
      this.key = key;
      this.subs = new Set();
      this.snapshot = undefined; // undefined = jeszcze brak danych
      this.es = new RealEventSource(url);
      for (const type of ["put", "patch"]) this.es.addEventListener(type, (e) => this.onData(type, e));
      for (const type of ["keep-alive", "cancel", "auth_revoked"]) {
        this.es.addEventListener(type, (e) => { for (const s of this.subs) s._dispatch(type, e); });
      }
      this.es.onerror = (e) => { for (const s of [...this.subs]) s._error(e); };
    }

    get readyState() { return this.es.readyState; }

    onData(type, e) {
      let payload;
      try { payload = JSON.parse(e.data); } catch { return; }
      this.snapshot = applyFirebaseEvent(this.snapshot ?? null, type, payload.path, payload.data);
      const parts = splitPath(payload.path);
      for (const s of this.subs) {
        const rel = s.rel; // sciezka dokumentu wzgledem katalogu wspolnego, np. ["todo_lists"]
        const isUnder = parts.length >= rel.length && rel.every((k, i) => k === parts[i]);
        const isAbove = parts.length < rel.length && parts.every((k, i) => k === rel[i]);
        if (type === "put" && isUnder) s._send("put", "/" + parts.slice(rel.length).join("/"), payload.data);
        else if (type === "put" && isAbove) s._send("put", "/", getAtPath(this.snapshot, rel) ?? null);
        else if (type === "patch") {
          if (isUnder) s._send("patch", "/" + parts.slice(rel.length).join("/"), payload.data);
          else if (isAbove) {
            const touches = Object.keys(payload.data || {}).some((k) => {
              const full = [...parts, ...splitPath(k)];
              return full.slice(0, rel.length).every((x, i) => x === rel[i]) || rel.slice(0, full.length).every((x, i) => x === full[i]);
            });
            if (touches) s._send("put", "/", getAtPath(this.snapshot, rel) ?? null);
          }
        }
      }
    }

    add(sub) {
      this.subs.add(sub);
      // dolaczajacy pozniej dostaje od razu aktualny stan
      if (this.snapshot !== undefined) queueMicrotask(() => sub._send("put", "/", getAtPath(this.snapshot, sub.rel) ?? null));
    }

    remove(sub) {
      this.subs.delete(sub);
      if (!this.subs.size) {
        this.es.close();
        if (hubs.get(this.key) === this) hubs.delete(this.key);
      }
    }
  }

  return class SharedEventSource {
    constructor(url) {
      this.url = url;
      this._handlers = {};
      this.onerror = null;
      const base = splitPath(getBase() || "");
      const { origin, path, auth } = parseUrl(url);
      const shared = base.length && path.length > base.length && base.every((k, i) => k === path[i]);
      if (!shared) { this._own = new RealEventSource(url); return this._proxyOwn(); }

      this.rel = path.slice(base.length);
      const key = [origin, base.join("/"), auth].join("|");
      let hub = hubs.get(key);
      if (!hub || hub.readyState === CLOSED) { // zerwane na dobre -> nowe polaczenie
        const q = auth ? "?auth=" + encodeURIComponent(auth) : "";
        hub = new Hub(key, `${origin}/${base.map(encodeURIComponent).join("/")}.json${q}`);
        hubs.set(key, hub);
      }
      this._hub = hub;
      this._closed = false;
      hub.add(this);
    }

    // dokument spoza wspolnego katalogu — zwykle, osobne polaczenie
    _proxyOwn() {
      const own = this._own;
      return new Proxy(this, {
        get: (t, k) => (k === "readyState" ? own.readyState : k === "close" ? () => own.close()
          : k === "addEventListener" ? own.addEventListener.bind(own) : t[k]),
        set: (t, k, v) => { if (k === "onerror") own.onerror = v; else t[k] = v; return true; },
      });
    }

    get readyState() { return this._closed ? CLOSED : this._hub.readyState; }

    addEventListener(type, fn) { (this._handlers[type] ||= []).push(fn); }

    _send(type, path, data) {
      if (this._closed) return;
      this._dispatch(type, { data: JSON.stringify({ path, data }) });
    }

    _dispatch(type, e) {
      if (this._closed) return;
      for (const fn of this._handlers[type] || []) fn(e);
    }

    _error(e) {
      if (!this._closed) this.onerror?.(e);
    }

    close() {
      if (this._closed) return;
      this._closed = true;
      this._hub.remove(this);
    }
  };
}
