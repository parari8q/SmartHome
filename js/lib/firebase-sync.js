// ==========================================================================
// Synchronizacja z Firebase Realtime Database przez REST + strumien SSE.
//
// Jak to dziala (i czemu jest lepsze niz poprzednie "ignoruj echo przez
// 2,5 s"):
//   * `server` — ostatni znany stan bazy, aktualizowany KAZDYM zdarzeniem
//     ze strumienia (nic nie jest ignorowane).
//   * `queue`  — nasze zapisy, ktore jeszcze nie wrocily z serwera.
//   * To, co widzi uzytkownik = server + nalozone na niego nasze zapisy.
//
// Dzieki temu wlasna zmiana pojawia sie od razu, zmiana z innego urzadzenia
// nigdy nie ginie, a echo wlasnego zapisu nie powoduje migotania. Zapisy
// ida po kolei; brak sieci = ponawianie z rosnacym odstepem (dane nie
// przepadaja), blad serwera = cofniecie zmiany i komunikat.
// ==========================================================================

import { applyFirebaseEvent, firebaseClean, getAtPath, setAtPath, splitPath } from "./paths.js";
import { clone, deepEqual, stableStringify } from "./util.js";

const CLOSED = 2;

export class SyncedDoc {
  constructor({
    baseUrl,
    path,
    normalize = (v) => v,
    fetchImpl,
    EventSourceImpl,
    timers,
    now,
    ackTimeoutMs = 4000,
    staleAfterMs = 90000,
  }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.path = splitPath(path);
    this.normalize = normalize;
    this.fetch = fetchImpl || ((...a) => globalThis.fetch(...a));
    this.EventSource = EventSourceImpl || globalThis.EventSource;
    this.timers = timers || { setTimeout: (...a) => setTimeout(...a), clearTimeout: (t) => clearTimeout(t) };
    this.now = now || (() => Date.now());
    this.ackTimeoutMs = ackTimeoutMs;
    this.staleAfterMs = staleAfterMs;

    this.server = null;
    this.loaded = false;
    this.queue = [];
    this.connection = "connecting";
    this.lastError = null;
    this.lastEventAt = 0;
    this.es = null;

    this._listeners = new Set();
    this._statusListeners = new Set();
    this._lastEmitted = undefined;
    this._writing = false;
    this._retryTimer = null;
    this._retryDelay = 1000;
    this._reconnectTimer = null;
    this._opSeq = 0;
  }

  // ----- adresy -------------------------------------------------------------

  url(subPath = []) {
    const parts = [...this.path, ...splitPath(subPath)].map(encodeURIComponent);
    return this.baseUrl + "/" + parts.join("/") + ".json";
  }

  // ----- stan widoczny dla aplikacji --------------------------------------

  get raw() {
    let v = clone(this.server);
    for (const op of this.queue) v = setAtPath(v, op.parts, clone(op.value));
    return v;
  }

  get value() {
    return this.normalize(this.raw);
  }

  get pendingCount() {
    return this.queue.filter((op) => op.state !== "acked").length;
  }

  getState() {
    return {
      connection: this.connection,
      loaded: this.loaded,
      pending: this.pendingCount,
      error: this.lastError,
    };
  }

  subscribe(fn) {
    this._listeners.add(fn);
    if (this.loaded) fn(this.value);
    return () => this._listeners.delete(fn);
  }

  onStatus(fn) {
    this._statusListeners.add(fn);
    fn(this.getState());
    return () => this._statusListeners.delete(fn);
  }

  _emit(force = false) {
    const value = this.value;
    const key = stableStringify(value);
    if (force || key !== this._lastEmitted) {
      this._lastEmitted = key;
      for (const fn of this._listeners) {
        try { fn(value); } catch (err) { console.error("Blad w odbiorcy danych", this.path.join("/"), err); }
      }
    }
  }

  _emitStatus() {
    const s = this.getState();
    for (const fn of this._statusListeners) {
      try { fn(s); } catch (err) { console.error(err); }
    }
  }

  // ----- odczyt (strumien SSE) ---------------------------------------------

  connect() {
    if (this.es) { try { this.es.close(); } catch {} }
    if (!this.EventSource) {
      this.connection = "error";
      this.lastError = "Przeglądarka nie obsługuje EventSource";
      this._emitStatus();
      return;
    }
    const es = new this.EventSource(this.url());
    this.es = es;
    this.lastEventAt = this.now();

    const handle = (type) => (e) => this._onStreamEvent(type, e);
    es.addEventListener("put", handle("put"));
    es.addEventListener("patch", handle("patch"));
    es.addEventListener("keep-alive", () => { this.lastEventAt = this.now(); });
    es.addEventListener("cancel", () => {
      this.connection = "error";
      this.lastError = "Baza odrzuciła połączenie (brak uprawnień?)";
      this._emitStatus();
    });
    es.onerror = () => {
      if (this.es !== es) return;
      this.connection = "offline";
      this._emitStatus();
      if (es.readyState === CLOSED) this._scheduleReconnect();
    };
  }

  _onStreamEvent(type, e) {
    this.lastEventAt = this.now();
    let payload;
    try { payload = JSON.parse(e.data); } catch { return; }
    if (!payload || typeof payload !== "object" || !("path" in payload)) return;

    this.server = applyFirebaseEvent(this.server, type, payload.path, payload.data);
    this.loaded = true;
    this._reconnectDelay = 0;
    if (this.connection !== "live") {
      this.connection = "live";
      if (this.lastError && !this.pendingCount) this.lastError = null;
    }
    this._pruneAcked();
    this._emit();
    this._emitStatus();
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectDelay = Math.min((this._reconnectDelay || 1000) * 2, 30000);
    this._reconnectTimer = this.timers.setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, this._reconnectDelay);
  }

  /** Wywolywane przy powrocie karty na pierwszy plan / odzyskaniu sieci /
   *  okresowo: odnawia zerwane albo "zawieszone" polaczenie. */
  ensureConnected() {
    const stale = this.now() - this.lastEventAt > this.staleAfterMs;
    if (!this.es || this.es.readyState === CLOSED || stale) this.connect();
    if (this.queue.some((op) => op.state === "queued")) this.retryNow();
  }

  close() {
    if (this.es) { try { this.es.close(); } catch {} this.es = null; }
    if (this._retryTimer) this.timers.clearTimeout(this._retryTimer);
    if (this._reconnectTimer) this.timers.clearTimeout(this._reconnectTimer);
  }

  // ----- zapis --------------------------------------------------------------

  /** Ustaw wartosc pod sciezka (wzgledna wobec dokumentu; "" = calosc).
   *  null usuwa. Zwraca Promise, ktory spelnia sie po zapisaniu na serwerze. */
  set(subPath, value) {
    const op = {
      id: ++this._opSeq,
      parts: splitPath(subPath),
      value: value === undefined ? null : clone(value),
      state: "queued",
      attempts: 0,
    };
    const promise = new Promise((resolve, reject) => { op.resolve = resolve; op.reject = reject; });
    promise.catch(() => {}); // blad i tak trafia do statusu — nie chcemy "unhandled rejection"
    this.queue.push(op);
    this._emit();
    this._emitStatus();
    this._pump();
    return promise;
  }

  retryNow() {
    if (this._retryTimer) { this.timers.clearTimeout(this._retryTimer); this._retryTimer = null; }
    this._pump();
  }

  async _pump() {
    if (this._writing || this._retryTimer) return;
    const op = this.queue.find((o) => o.state === "queued");
    if (!op) return;

    this._writing = true;
    op.state = "inflight";
    op.attempts++;

    let res;
    try {
      const isDelete = op.value === null;
      res = await this.fetch(this.url(op.parts), isDelete
        ? { method: "DELETE" }
        : { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(op.value) });
    } catch (err) {
      // brak sieci — zostawiamy w kolejce i probujemy ponownie pozniej
      op.state = "queued";
      this._writing = false;
      this.lastError = "Brak połączenia — zapiszę, gdy wróci sieć";
      this._emitStatus();
      const delay = this._retryDelay;
      this._retryDelay = Math.min(this._retryDelay * 2, 30000);
      this._retryTimer = this.timers.setTimeout(() => { this._retryTimer = null; this._pump(); }, delay);
      return;
    }

    this._writing = false;
    this._retryDelay = 1000;

    if (!res.ok) {
      let body = "";
      try { body = await res.text(); } catch {}
      this.queue = this.queue.filter((o) => o !== op);
      this.lastError = `Błąd zapisu (HTTP ${res.status}) ${body.slice(0, 120)}`.trim();
      this._emit();
      this._emitStatus();
      op.reject(new Error(this.lastError));
    } else {
      op.state = "acked";
      op.ackedAt = this.now();
      if (this.lastError && this.lastError.startsWith("Brak połączenia")) this.lastError = null;
      this.timers.setTimeout(() => this._dropOp(op), this.ackTimeoutMs);
      this._pruneAcked();
      this._emit();
      this._emitStatus();
      op.resolve();
    }
    this._pump();
  }

  /** Zapis potwierdzony i serwer juz pokazuje te wartosc => nakladka zbedna. */
  _pruneAcked() {
    const before = this.queue.length;
    const covers = (a, b) => a.length <= b.length && a.every((k, i) => k === b[i]);
    this.queue = this.queue.filter((op, i) => {
      if (op.state !== "acked") return true;
      // przykryty przez pozniejszy zapis tej samej (lub wyzszej) sciezki
      if (this.queue.slice(i + 1).some((later) => covers(later.parts, op.parts))) return false;
      return !deepEqual(firebaseClean(getAtPath(this.server, op.parts)), firebaseClean(op.value));
    });
    return before !== this.queue.length;
  }

  _dropOp(op) {
    const i = this.queue.indexOf(op);
    if (i === -1) return;
    this.queue.splice(i, 1);
    this._emit();
    this._emitStatus();
  }
}

/** Laczny status kilku dokumentow — do kropki "synchronizacja" w rogu. */
export function combineStatus(states) {
  const list = Object.values(states);
  if (list.some((s) => s.connection === "error")) return "error";
  if (list.some((s) => s.error)) return "warning";
  if (list.some((s) => s.connection === "offline")) return "offline";
  if (list.some((s) => !s.loaded || s.connection === "connecting")) return "connecting";
  if (list.some((s) => s.pending > 0)) return "saving";
  return "live";
}
