/**
 * SmartHome ⇄ Kalendarz Google
 * ------------------------------------------------------------
 * Działa na Twoim koncie Google (script.google.com), co 10 minut, także gdy aplikacja jest zamknięta:
 *   • wydarzenia z aplikacji (całej grupy) → kalendarz „SmartHome” w Twoim Google,
 *     kolor wydarzenia = osoba (taki sam jak w aplikacji, na ile pozwalają kolory Google),
 *   • wydarzenia z Twojego głównego Kalendarza Google → widoczne w aplikacji (tylko do odczytu).
 *
 * Instalacja:
 *   1. W aplikacji: Ustawienia → Kalendarz Google → „Skopiuj konfigurację”.
 *   2. Wklej ją poniżej między apostrofy (zamiast WKLEJ_TUTAJ) i zapisz (Ctrl+S).
 *   3. Na górze wybierz funkcję „instaluj” i kliknij „Uruchom”. Zgódź się na dostęp do kalendarza.
 * Zmiana grupy/konta w aplikacji = skopiuj konfigurację jeszcze raz, wklej i znów „instaluj”.
 * Wyłączenie: uruchom „odinstaluj” (kalendarz „SmartHome” możesz potem usunąć w Google).
 */
const KONFIGURACJA = 'WKLEJ_TUTAJ';

const CAL_NAME = 'SmartHome';
const DAYS_BACK = 7;      // ile dni wstecz kopiować wydarzenia z Google do aplikacji
const DAYS_AHEAD = 120;   // ile dni naprzód
const MAX_MIRROR = 400;

// kolory osób jak w aplikacji (kolejność = posortowane uid członków grupy) → kolory wydarzeń Google
const PERSON_GOOGLE_COLORS = ['7', '4', '5', '1', '3', '6']; // Peacock, Flamingo, Banana, Lavender, Grape, Tangerine
const SHARED_GOOGLE_COLOR = '2';                             // Sage = „Wspólne”
const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

// ======================= uruchamianie =======================

function instaluj() {
  const cfg = config_();
  ScriptApp.getProjectTriggers().forEach((t) => { if (t.getHandlerFunction() === 'synchronizuj') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('synchronizuj').timeBased().everyMinutes(10).create();
  synchronizuj();
  Logger.log('Gotowe — synchronizacja co 10 minut dla: ' + (cfg.name || cfg.uid));
}

function odinstaluj() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  Logger.log('Synchronizacja wyłączona.');
}

function synchronizuj() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const cfg = config_();
    const ctx = groupContext_(cfg);
    pushToGoogle_(cfg, ctx);
    pullFromGoogle_(cfg);
  } finally {
    lock.releaseLock();
  }
}

// ======================= konfiguracja i baza =======================

function config_() {
  const props = PropertiesService.getScriptProperties();
  if (!KONFIGURACJA || KONFIGURACJA === 'WKLEJ_TUTAJ') throw new Error('Wklej konfigurację z aplikacji do KONFIGURACJA na górze skryptu.');
  if (props.getProperty('CONFIG_SRC') !== KONFIGURACJA) { // nowa konfiguracja (np. inna grupa) — zacznij od zera
    const parsed = parseConfig(KONFIGURACJA);
    removeAllMapped_(props);
    props.setProperty('CONFIG', JSON.stringify(parsed));
    props.setProperty('CONFIG_SRC', KONFIGURACJA);
    CacheService.getScriptCache().remove('idToken');
  }
  return JSON.parse(props.getProperty('CONFIG'));
}

function idToken_(cfg) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('idToken');
  if (cached) return cached;
  const res = UrlFetchApp.fetch('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(cfg.apiKey), {
    method: 'post', payload: { grant_type: 'refresh_token', refresh_token: cfg.refreshToken }, muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('Nie mogę zalogować się do bazy — w aplikacji skopiuj konfigurację jeszcze raz. (' + res.getContentText().slice(0, 200) + ')');
  const data = JSON.parse(res.getContentText());
  if (data.refresh_token && data.refresh_token !== cfg.refreshToken) {
    cfg.refreshToken = data.refresh_token;
    PropertiesService.getScriptProperties().setProperty('CONFIG', JSON.stringify(cfg));
  }
  cache.put('idToken', data.id_token, 50 * 60);
  return data.id_token;
}

function db_(cfg, path, method, body) {
  const url = cfg.dbUrl + '/' + path.split('/').map(encodeURIComponent).join('/') + '.json?auth=' + encodeURIComponent(idToken_(cfg));
  const opts = { method: method || 'get', muteHttpExceptions: true };
  if (body !== undefined) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  const res = UrlFetchApp.fetch(url, opts);
  if (res.getResponseCode() >= 300) throw new Error('Baza: HTTP ' + res.getResponseCode() + ' przy ' + path);
  return JSON.parse(res.getContentText() || 'null');
}

function groupContext_(cfg) {
  if (!cfg.gid) return { order: [], names: {} };
  const members = db_(cfg, 'groups/' + cfg.gid + '/members') || {};
  const profiles = db_(cfg, 'groups/' + cfg.gid + '/profiles') || {};
  const names = {};
  Object.keys(profiles).forEach((uid) => { names[uid] = (profiles[uid] && profiles[uid].name) || ''; });
  return { order: Object.keys(members).sort(), names: names };
}

// ======================= aplikacja → Google =======================

function smartHomeCalendar_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('CAL_ID');
  let cal = id ? CalendarApp.getCalendarById(id) : null;
  if (!cal) {
    const found = CalendarApp.getCalendarsByName(CAL_NAME);
    cal = found.length ? found[0] : CalendarApp.createCalendar(CAL_NAME, { summary: 'Wydarzenia z aplikacji SmartHome (zmieniaj je w aplikacji)' });
    props.setProperty('CAL_ID', cal.getId());
  }
  return cal;
}

function pushToGoogle_(cfg, ctx) {
  const events = db_(cfg, cfg.base + '/calendar_events') || {};
  const cal = smartHomeCalendar_();
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const mapped = {};
  Object.keys(all).forEach((k) => { if (k.indexOf('ev_') === 0) { try { mapped[k.slice(3)] = JSON.parse(all[k]); } catch (e) { /* pomin */ } } });
  const seen = {};
  Object.keys(events).forEach((startKey) => {
    toList(events[startKey]).forEach((ev) => {
      if (!ev || !ev.id) return;
      seen[ev.id] = true;
      const spec = eventSpec(ev, startKey, ctx);
      const sig = JSON.stringify(spec);
      const m = mapped[ev.id];
      if (m && m.s === sig) return;
      if (m) removeGoogle_(cal, m);
      const created = createGoogle_(cal, spec);
      props.setProperty('ev_' + ev.id, JSON.stringify({ g: created.id, t: created.series ? 's' : 'e', s: sig }));
    });
  });
  Object.keys(mapped).forEach((id) => {
    if (seen[id]) return;
    removeGoogle_(cal, mapped[id]);
    props.deleteProperty('ev_' + id);
  });
}

function removeAllMapped_(props) {
  const all = props.getProperties();
  const id = props.getProperty('CAL_ID');
  const cal = id ? CalendarApp.getCalendarById(id) : null;
  Object.keys(all).forEach((k) => {
    if (k.indexOf('ev_') !== 0) return;
    if (cal) { try { removeGoogle_(cal, JSON.parse(all[k])); } catch (e) { /* pomin */ } }
    props.deleteProperty(k);
  });
  props.deleteProperty('MIRROR_SIG');
}

function removeGoogle_(cal, m) {
  try {
    if (m.t === 's') { const s = cal.getEventSeriesById(m.g); if (s) s.deleteEventSeries(); }
    else { const e = cal.getEventById(m.g); if (e) e.deleteEvent(); }
  } catch (e) { /* juz usuniete w Google */ }
}

function toDate_(p) { return new Date(p.y, p.m - 1, p.d, p.h || 0, p.mi || 0); }

function createGoogle_(cal, spec) {
  const opts = { description: spec.description };
  let item;
  let series = false;
  if (spec.recurrence) {
    const rec = CalendarApp.newRecurrence();
    let rule;
    if (spec.recurrence.freq === 'week') rule = rec.addWeeklyRule().onlyOnWeekdays(spec.recurrence.days.map((d) => CalendarApp.Weekday[WEEKDAYS[d]]));
    else if (spec.recurrence.freq === 'month') rule = rec.addMonthlyRule();
    else rule = rec.addYearlyRule();
    if (spec.recurrence.until) rule.until(toDate_(Object.assign(dateParts(spec.recurrence.until), { h: 23, mi: 59 })));
    spec.recurrence.skip.forEach((k) => rec.addDateExclusion(toDate_(Object.assign(dateParts(k), { h: spec.start.h || 0, mi: spec.start.mi || 0 }))));
    rec.setTimeZone(Session.getScriptTimeZone());
    item = spec.allDay && !spec.multiDay
      ? cal.createAllDayEventSeries(spec.title, toDate_(spec.start), rec, opts)
      : cal.createEventSeries(spec.title, toDate_(spec.start), toDate_(spec.end), rec, opts);
    series = true;
  } else if (spec.allDay) {
    item = cal.createAllDayEvent(spec.title, toDate_(spec.start), toDate_(spec.end), opts); // koniec wylacznie
  } else {
    item = cal.createEvent(spec.title, toDate_(spec.start), toDate_(spec.end), opts);
  }
  if (spec.color) item.setColor(spec.color);
  return { id: item.getId(), series: series };
}

// ======================= Google → aplikacja =======================

function pullFromGoogle_(cfg) {
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const from = new Date(now.getTime() - DAYS_BACK * 86400000);
  const to = new Date(now.getTime() + DAYS_AHEAD * 86400000);
  const shId = PropertiesService.getScriptProperties().getProperty('CAL_ID');
  const cal = CalendarApp.getDefaultCalendar();
  if (cal.getId() === shId) return;
  const fmt = (d, f) => Utilities.formatDate(d, tz, f);
  const events = cal.getEvents(from, to).slice(0, MAX_MIRROR).map((e) => {
    const allDay = e.isAllDayEvent();
    return mirrorEvent({
      id: e.getId(), title: e.getTitle(), allDay: allDay,
      start: allDay ? e.getAllDayStartDate() : e.getStartTime(),
      end: allDay ? e.getAllDayEndDate() : e.getEndTime(),
    }, fmt);
  });
  const sig = JSON.stringify(events);
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('MIRROR_AT') || 0);
  if (props.getProperty('MIRROR_SIG') === Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, sig)) && Date.now() - last < 6 * 3600000) return;
  db_(cfg, cfg.base + '/calendar_google/' + cfg.uid, 'put', { name: cfg.name || '', updatedAt: Date.now(), events: events });
  props.setProperty('MIRROR_SIG', Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, sig)));
  props.setProperty('MIRROR_AT', String(Date.now()));
}

// ======================= czyste funkcje (testowane w repozytorium) =======================

function parseConfig(text) {
  let c;
  try { c = JSON.parse(String(text).trim()); } catch (e) { throw new Error('Konfiguracja jest uszkodzona — skopiuj ją z aplikacji jeszcze raz.'); }
  ['apiKey', 'dbUrl', 'refreshToken', 'uid', 'base'].forEach((k) => { if (!c || typeof c[k] !== 'string' || !c[k]) throw new Error('W konfiguracji brakuje pola „' + k + '”.'); });
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(c.dbUrl.replace(/\/$/, ''))) throw new Error('Nieprawidłowy adres bazy w konfiguracji.');
  return { apiKey: c.apiKey, dbUrl: c.dbUrl.replace(/\/$/, ''), refreshToken: c.refreshToken, uid: c.uid, base: c.base, gid: c.gid || null, name: c.name || '' };
}

function toList(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (v && typeof v === 'object') return Object.keys(v).sort((a, b) => Number(a) - Number(b)).map((k) => v[k]).filter(Boolean);
  return [];
}

function dateParts(key) {
  const p = String(key).split('-').map(Number);
  return { y: p[0], m: p[1], d: p[2] };
}

function addDaysKey(key, n) {
  const p = dateParts(key);
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

function colorFor(who, order) {
  if (!who) return null;
  if (who === 'all') return SHARED_GOOGLE_COLOR;
  const i = order.indexOf(who);
  return i < 0 ? null : PERSON_GOOGLE_COLORS[i % PERSON_GOOGLE_COLORS.length];
}

/** Opis wydarzenia do utworzenia w Google (bez wywolan Google — da sie przetestowac). */
function eventSpec(ev, startKey, ctx) {
  const time = /^\d{2}:\d{2}$/.test(ev.time || '') ? ev.time : '';
  const multiDay = !!(ev.to && ev.to > startKey);
  const start = dateParts(startKey);
  let end;
  if (time) {
    const t = time.split(':').map(Number);
    start.h = t[0]; start.mi = t[1];
    const e = /^\d{2}:\d{2}$/.test(ev.end || '') ? ev.end.split(':').map(Number) : [Math.min(t[0] + 1, 23), t[0] >= 23 ? 59 : t[1]];
    end = Object.assign(dateParts(startKey), { h: e[0], mi: e[1] });
  } else {
    end = dateParts(addDaysKey(multiDay ? ev.to : startKey, 1)); // calodniowe: koniec wylacznie (dzien po)
  }
  const who = ev.who || '';
  const person = who === 'all' ? 'wszystkich (Wspólne)' : (ctx.names[who] || '');
  const r = ev.repeat && ['week', 'month', 'year'].indexOf(ev.repeat.freq) >= 0 ? ev.repeat : null;
  const weekday = new Date(Date.UTC(start.y, start.m - 1, start.d)).getUTCDay();
  return {
    title: String(ev.title || '(bez tytułu)'),
    description: (person ? 'Dla: ' + person + '\n' : '') + 'Z aplikacji SmartHome — zmieniaj w aplikacji.',
    allDay: !time, multiDay: multiDay, start: start, end: end,
    color: colorFor(who, ctx.order),
    recurrence: r ? {
      freq: r.freq,
      days: r.freq === 'week' ? (toList(r.days).length ? toList(r.days).map(Number) : [weekday]) : [],
      until: /^\d{4}-\d{2}-\d{2}$/.test(r.until || '') ? r.until : null,
      skip: Object.keys(ev.skip || {}).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort(),
    } : null,
  };
}

/** Wydarzenie z Google w formacie dla aplikacji. fmt(date, wzor) formatuje w strefie skryptu. */
function mirrorEvent(e, fmt) {
  const date = fmt(e.start, 'yyyy-MM-dd');
  const out = { id: String(e.id).slice(0, 80) + '@' + date, title: String(e.title || '').slice(0, 200) || '(bez tytułu)', date: date };
  if (e.allDay) {
    const last = fmt(new Date(e.end.getTime() - 86400000), 'yyyy-MM-dd'); // koniec w Google jest wylaczny
    if (last > date) out.to = last;
  } else {
    out.time = fmt(e.start, 'HH:mm');
    const endDate = fmt(e.end, 'yyyy-MM-dd');
    if (endDate > date) out.to = endDate; else out.end = fmt(e.end, 'HH:mm');
  }
  return out;
}
