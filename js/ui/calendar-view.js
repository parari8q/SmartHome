// KALENDARZ — trzy widoki (Miesiac / Tydzien / Lista), dodawanie w wysuwanym
// panelu (takze tekstem: "jutro 18 trening"), szczegoly z edycja i cofaniem,
// powtarzanie, wydarzenia kilkudniowe i kolory osob z grupy.

import { store } from "../store.js";
import { auth } from "../db.js";
import * as C from "../logic/calendar.js";
import { h, clear, ICONS, iconButton, toast } from "../lib/dom.js";
import { formatDateKey, parseDateKey, startOfDay, addDays, capitalize, uid, plural, clone } from "../lib/util.js";
import { registerView } from "./router.js";
import { notifyGroup } from "../notify.js";
import { currentGroup, onGroupChange } from "../groups.js";

const MODE_KEY = "calendar_mode";
const MODES = [["month", "Miesiąc"], ["week", "Tydzień"], ["list", "Lista"]];
const MONTHS = ["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec", "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"];
const DOW = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];
const PALETTE = ["#7db2ff", "#f5a3c7", "#f5b65a", "#b39dff", "#6fd6e0", "#e3dc8c"];
const ALL = { id: "all", name: "Wspólne", color: "#5fd39a" };
const TL_START = 6, TL_END = 24, HOUR_PX = 48;

let shell, fab;
let mode = localStorage.getItem(MODE_KEY) || "month";
let viewMonth = new Date();
let selKey = formatDateKey(startOfDay());
let filterWho = "all";
let sheet = null; // otwarty panel (dodawanie/szczegoly)

const cal = () => store.calendar.value;
const todayKey = () => formatDateKey(startOfDay());
const shiftKey = (key, n) => formatDateKey(addDays(parseDateKey(key), n));
const mondayOf = (key) => { const d = parseDateKey(key); return formatDateKey(addDays(d, -((d.getDay() + 6) % 7))); };

// ----- osoby i kolory --------------------------------------------------------

export function people() {
  const g = currentGroup();
  if (!g) return [];
  const ids = Object.keys(g.members || {}).sort((a, b) => (a === auth.uid ? -1 : b === auth.uid ? 1 : a.localeCompare(b)));
  return [...ids.map((id, i) => ({ id, name: id === auth.uid ? "Ty" : g.profiles?.[id]?.name || `Osoba ${i + 1}`, color: PALETTE[i % PALETTE.length] })), ALL];
}
const personOf = (ev) => people().find((p) => p.id === ev.who) || null;
const colorOf = (ev) => personOf(ev)?.color || "var(--accent)";

// ----- etykiety --------------------------------------------------------------

function dayTitle(key) {
  const d = parseDateKey(key);
  const label = d.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" });
  const yr = d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : "";
  if (key === todayKey()) return "Dziś, " + label.replace(/^\S+,?\s*/, "") + yr;
  if (key === shiftKey(todayKey(), 1)) return "Jutro, " + label.replace(/^\S+,?\s*/, "") + yr;
  return capitalize(label) + yr;
}
const WD = ["nd", "pn", "wt", "śr", "cz", "pt", "sb"];
const dayMonth = (key) => parseDateKey(key).toLocaleDateString("pl-PL", { day: "numeric", month: "short" }).replace(".", "");
const tinyDate = (key) => WD[parseDateKey(key).getDay()] + " " + parseDateKey(key).getDate(); // "wt 17"
const shortDate = (key) => parseDateKey(key).toLocaleDateString("pl-PL", { weekday: "short", day: "numeric", month: "short" });
const rangeText = (ev) => (ev.time ? ev.time + (ev.end ? " – " + ev.end : "") : "cały dzień");

function eventSub(ev, { withTime = false } = {}) {
  return [
    withTime ? rangeText(ev) : null,
    personOf(ev)?.name,
    ev.multi ? shortDate(ev.occKey) + " – " + shortDate(C.occurrenceEnd(ev)) : null,
    C.repeatLabel(ev) || null,
  ].filter(Boolean).join(" · ");
}

// ----- zapis z cofaniem -----------------------------------------------------

function applyWrites(writes, message, { notify = null } = {}) {
  const before = writes.map(([key]) => [key, cal()[key] ? clone(cal()[key]) : null]);
  for (const [key, list] of writes) store.calendar.set(key, list);
  if (message) toast(message, null, { label: "Cofnij", onClick: () => { for (const [k, l] of before) store.calendar.set(k, l); } });
  if (notify) notifyGroup("calendar", notify.text, { day: notify.day, eventId: notify.eventId });
}

// ----- widok ----------------------------------------------------------------

function render() {
  if (!shell || !shell.isOpen()) return;
  shell.setTitle("Kalendarz");
  shell.setActions(h("div", { class: "seg", role: "tablist", "aria-label": "Widok kalendarza" }, MODES.map(([id, label]) =>
    h("button", { type: "button", role: "tab", id: "cal-mode-" + id, class: "seg-btn" + (mode === id ? " active" : ""), "aria-selected": String(mode === id),
      onclick: () => { mode = id; localStorage.setItem(MODE_KEY, id); render(); } }, label))));
  const content = mode === "week" ? renderWeek() : mode === "list" ? renderList() : renderMonth();
  clear(shell.body, content);
}

function navRow(label, onPrev, onNext, onToday) {
  return h("div", { class: "month-nav" },
    h("div", { class: "month-label", id: "cal-month-label" }, label),
    h("button", { type: "button", class: "btn btn-ghost btn-sm", id: "cal-today", onclick: onToday }, "Dziś"),
    iconButton("back", "Wstecz", onPrev), iconButton("next", "Dalej", onNext));
}

function onSwipe(el, fn) {
  let x0 = null, y0 = 0;
  el.addEventListener("pointerdown", (e) => { x0 = e.clientX; y0 = e.clientY; });
  el.addEventListener("pointerup", (e) => {
    if (x0 == null) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) fn(dx < 0 ? 1 : -1);
  });
}

function select(key) {
  selKey = key;
  const d = parseDateKey(key);
  viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  render();
}

function renderMonth() {
  const y = viewMonth.getFullYear(), m = viewMonth.getMonth();
  const first = new Date(y, m, 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  const today = todayKey();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    if (i >= 35 && d.getMonth() !== m) break;
    const key = formatDateKey(d);
    const list = C.eventsOnDay(cal(), key);
    cells.push(h("button", {
      type: "button", dataset: { date: key }, "aria-pressed": String(key === selKey),
      class: "day" + (key === today ? " today" : "") + (key === selKey ? " selected" : "") + (d.getMonth() !== m ? " other" : "") + (list.length ? " has-events" : "") + (key < today ? " past" : ""),
      "aria-label": C.dayLabel(key) + (list.length ? `, ${list.length} ${plural(list.length, "wydarzenie", "wydarzenia", "wydarzeń")}` : ""),
      onclick: () => select(key),
    },
      h("span", { class: "day-num" }, String(d.getDate())),
      list.length ? h("span", { class: "dots" }, list.slice(0, 3).map((ev) => h("i", { style: { background: colorOf(ev) } }))) : null,
      list.length ? h("span", { class: "day-pills" }, list.slice(0, 2).map((ev) => h("span", { class: "day-pill", style: { "--c": colorOf(ev) } }, (ev.time ? ev.time + " " : "") + ev.title)),
        list.length > 2 ? h("span", { class: "day-more" }, `+${list.length - 2} więcej`) : null) : null));
  }
  const goMonth = (n) => { viewMonth = new Date(y, m + n, 1); render(); };
  const grid = h("div", { class: "month-grid" }, DOW.map((d) => h("div", { class: "dow" }, d)), cells);
  onSwipe(grid, goMonth);
  return h("div", { class: "cal-split" },
    h("div", { class: "cal-main" },
      navRow(MONTHS[m] + " " + y, () => goMonth(-1), () => goMonth(1), () => select(today)),
      h("div", { class: "card cal-month" }, grid)),
    dayPanel(selKey));
}

function dayPanel(key) {
  const list = C.eventsOnDay(cal(), key);
  return h("section", { class: "cal-day", "aria-label": "Wybrany dzień" },
    h("div", { class: "cal-day-head" },
      h("h2", { class: "cal-day-title" }, dayTitle(key)),
      list.length ? h("span", { class: "cal-day-count" }, `${list.length} ${plural(list.length, "wydarzenie", "wydarzenia", "wydarzeń")}`) : null),
    list.length
      ? h("div", { class: "rows" }, list.map((ev) => eventRow(ev)))
      : h("button", { type: "button", class: "cal-empty", onclick: () => openEditor({ dateKey: key }) }, "Wolny dzień · dodaj coś"));
}

function eventRow(ev, { dateLabel = null } = {}) {
  const time = dateLabel
    ? [h("b", {}, dateLabel), h("small", {}, ev.time || "cały dzień")]
    : ev.time ? [h("b", {}, ev.time), ev.end ? h("small", {}, ev.end) : null] : [h("b", {}, "cały"), h("small", {}, "dzień")];
  return h("button", { type: "button", class: "row event", dataset: { eventId: ev.id, date: ev.dateKey }, onclick: () => openDetail(ev) },
    h("span", { class: "event-time mono" }, time),
    h("span", { class: "ev-dot", style: { background: colorOf(ev) } }),
    h("span", { class: "row-main" },
      h("span", { class: "row-title event-title" }, ev.title),
      eventSub(ev) ? h("span", { class: "row-sub" }, eventSub(ev)) : null));
}

function renderWeek() {
  const ws = mondayOf(selKey);
  const days = Array.from({ length: 7 }, (_, i) => shiftKey(ws, i));
  const today = todayKey();
  const goWeek = (n) => select(shiftKey(selKey, 7 * n));
  const strip = h("div", { class: "week-strip" }, days.map((key, i) => {
    const list = C.eventsOnDay(cal(), key);
    return h("button", { type: "button", class: "week-day" + (key === selKey ? " selected" : "") + (key === today ? " today" : ""), dataset: { date: key }, "aria-pressed": String(key === selKey), onclick: () => select(key) },
      h("span", { class: "wd-name" }, DOW[i]),
      h("span", { class: "day-num" }, String(parseDateKey(key).getDate())),
      h("span", { class: "dots" }, list.slice(0, 3).map((ev) => h("i", { style: { background: colorOf(ev) } }))));
  }));
  onSwipe(strip, goWeek);
  const list = C.eventsOnDay(cal(), selKey);
  const allDay = list.filter((ev) => !ev.time);
  const timed = list.filter((ev) => ev.time);
  const min = (t) => { const [hh, mm] = t.split(":").map(Number); return hh * 60 + mm; };
  const top = (t) => ((min(t) - TL_START * 60) / 60) * HOUR_PX;
  const tl = h("div", { class: "timeline", style: { height: (TL_END - TL_START) * HOUR_PX + "px" } },
    Array.from({ length: TL_END - TL_START }, (_, i) => h("div", { class: "tl-hour", style: { top: i * HOUR_PX + "px" } }, h("span", {}, String(TL_START + i).padStart(2, "0") + ":00"))),
    selKey === today ? h("div", { class: "tl-now", style: { top: Math.max(0, ((new Date().getHours() * 60 + new Date().getMinutes()) - TL_START * 60) / 60 * HOUR_PX) + "px" } }) : null,
    timed.map((ev) => {
      const t = Math.max(0, top(ev.time));
      const end = ev.end ? top(ev.end) : t + HOUR_PX;
      return h("button", { type: "button", class: "tl-ev event", dataset: { eventId: ev.id }, style: { top: t + "px", height: Math.max(42, end - t - 3) + "px", "--c": colorOf(ev) }, onclick: () => openDetail(ev) },
        h("span", { class: "event-title" }, ev.title), h("span", { class: "tl-sub" }, eventSub(ev, { withTime: true })));
    }));
  const d0 = parseDateKey(ws), d6 = parseDateKey(days[6]);
  return h("div", { class: "cal-week" },
    navRow(MONTHS[d0.getMonth()] + " " + d0.getFullYear(), () => goWeek(-1), () => goWeek(1), () => select(today)),
    h("div", { class: "hint" }, `${d0.getDate()} ${d0.toLocaleDateString("pl-PL", { month: "short" })} – ${d6.getDate()} ${d6.toLocaleDateString("pl-PL", { month: "short" })}`),
    strip,
    h("h2", { class: "cal-day-title" }, dayTitle(selKey)),
    allDay.length ? h("div", { class: "allday" }, allDay.map((ev) =>
      h("button", { type: "button", class: "allday-ev event", dataset: { eventId: ev.id }, style: { "--c": colorOf(ev) }, onclick: () => openDetail(ev) },
        h("span", { class: "ev-dot", style: { background: colorOf(ev) } }), h("span", { class: "event-title" }, ev.title), h("small", {}, "cały dzień")))) : null,
    tl);
}

function renderList() {
  const today = todayKey();
  const sunday = shiftKey(mondayOf(today), 6);
  const buckets = [
    ["Dziś", today, today], ["Jutro", shiftKey(today, 1), shiftKey(today, 1)],
    ["W tym tygodniu", shiftKey(today, 2), sunday],
    ["W przyszłym tygodniu", shiftKey(sunday, 1), shiftKey(sunday, 7)],
    ["Później", shiftKey(sunday, 8), shiftKey(today, 90)],
  ].filter(([, a, b]) => a <= b);
  const ps = people();
  const all = C.occurrences(cal(), today, shiftKey(today, 90)).filter((ev) => filterWho === "all" || (ev.who || "") === filterWho);
  const groups = buckets.map(([name, a, b]) => {
    const items = all.filter((ev) => { const k = ev.occKey < today ? today : ev.occKey; return k >= a && k <= b; });
    return { name, single: a === b, hint: a === b ? shortDate(a) : name === "Później" ? "" : `${dayMonth(a)} – ${dayMonth(b)}`, items };
  }).filter((g) => g.items.length);
  return h("div", { class: "cal-list" },
    ps.length ? h("div", { class: "chips filter-chips" }, [{ id: "all", name: "Wszyscy" }, ...ps].map((p) =>
      h("button", { type: "button", class: "chip-btn" + (filterWho === p.id ? " active" : ""), "aria-pressed": String(filterWho === p.id), onclick: () => { filterWho = p.id; render(); } },
        p.color ? h("span", { class: "ev-dot", style: { background: p.color } }) : null, p.id === "all" && !p.color ? "Wszyscy" : p.name))) : null,
    groups.length ? groups.map((g) => h("section", { class: "cal-group" },
      h("h2", { class: "section-label" }, g.name, g.hint ? h("span", { class: "muted-inline" }, " · " + g.hint) : null),
      h("div", { class: "rows" }, g.items.map((ev) => eventRow({ ...ev, dateKey: ev.occKey }, { dateLabel: g.single ? null : tinyDate(ev.occKey < today ? today : ev.occKey) })))))
      : h("div", { class: "empty" }, "Nic zaplanowanego na najbliższe 3 miesiące."));
}

// ----- panele (dodawanie / szczegoly) ----------------------------------------

function closeSheet() {
  if (!sheet) return;
  sheet.el.remove();
  sheet = null;
  fab.hidden = false;
}

function showSheet(label, ...content) {
  closeSheet();
  const panel = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": label }, h("div", { class: "sheet-handle" }), ...content);
  const el = h("div", { class: "sheet-backdrop", onclick: (e) => { if (e.target === el) closeSheet(); } }, panel);
  el.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
  document.body.append(el);
  fab.hidden = true;
  sheet = { el, panel };
  return panel;
}

function chip(label, on, onclick, extra = {}) {
  return h("button", { type: "button", class: "chip-btn" + (on ? " active" : ""), "aria-pressed": String(!!on), onclick, ...extra }, label);
}

/** Panel dodawania/edycji. init: { dateKey, event?, oldKey? } */
function openEditor({ dateKey = selKey, event = null, oldKey = null } = {}) {
  const ps = people();
  const ev = event || {};
  const d = {
    id: ev.id || null, oldKey, title: ev.title || "", dateKey: ev.startKey || dateKey,
    allDay: event ? !ev.time : false, time: ev.time || "18:00", dur: event ? C.durationMinutes(ev) : 60,
    to: ev.to || "", repeat: ev.repeat?.freq || "none",
    days: new Set(ev.repeat?.days || [parseDateKey(ev.startKey || dateKey).getDay()]),
    who: ev.who || (ps.length ? auth.uid : ""),
  };
  const today = todayKey();
  const setDay = (k) => { // dzien tygodnia powtarzania idzie za wybranym dniem (gdy wybrany jeden)
    if (d.days.size <= 1) d.days = new Set([parseDateKey(k).getDay()]);
    d.dateKey = k;
  };
  const quick = h("input", { type: "text", id: "cal-quick", value: d.title, autocomplete: "off", enterkeyhint: "done", placeholder: "np. jutro 18 trening",
    oninput: () => {
      const p = C.parseQuickAdd(quick.value);
      d.title = p.title;
      if (p.dateKey) setDay(p.dateKey);
      if (p.time) { d.time = p.time; d.allDay = false; }
      draw();
    },
    onkeydown: (e) => { if (e.key === "Enter") save(); } });
  const body = h("div", { class: "sheet-body" });
  const saveBtn = h("button", { type: "button", class: "btn btn-primary btn-block sheet-save", id: "cal-save", onclick: () => save() });

  function draw() {
    const time = d.allDay ? "cały dzień" : d.time + (d.dur ? "–" + C.addMinutes(d.time, d.dur) : "");
    saveBtn.replaceChildren(h("b", {}, d.id ? "Zapisz" : "Dodaj"), h("small", {}, `${d.title || "Bez tytułu"} · ${shortDate(d.dateKey)}, ${time}`));
    const dateInput = h("input", { type: "date", id: "cal-date", value: d.dateKey, "aria-label": "Inny dzień", onchange: (e) => { if (e.target.value) { setDay(e.target.value); draw(); } } });
    body.replaceChildren(...[
      h("div", { class: "field" }, h("span", { class: "field-label" }, "Kiedy"),
        h("div", { class: "chips" },
          [["Dziś", today], ["Jutro", shiftKey(today, 1)], ["Pojutrze", shiftKey(today, 2)]].map(([l, k]) => chip(l, d.dateKey === k, () => { setDay(k); draw(); })),
          dateInput)),
      h("button", { type: "button", class: "switch-row", id: "cal-allday", role: "switch", "aria-checked": String(d.allDay), onclick: () => { d.allDay = !d.allDay; draw(); } },
        h("span", {}, "Cały dzień"), h("span", { class: "switch" + (d.allDay ? " on" : "") })),
      d.allDay
        ? h("div", { class: "field" }, h("label", { class: "field-label", for: "cal-to" }, "Kilka dni — do dnia (opcjonalnie)"),
            h("input", { type: "date", id: "cal-to", value: d.to, min: d.dateKey, onchange: (e) => { d.to = e.target.value; draw(); } }))
        : [h("div", { class: "field" }, h("span", { class: "field-label" }, "Godzina"),
            h("div", { class: "chips" }, ["08:00", "12:00", "15:00", "18:00", "20:00"].map((t) => chip(t, d.time === t, () => { d.time = t; draw(); })),
              h("input", { type: "time", id: "cal-time", value: d.time, "aria-label": "Inna godzina", onchange: (e) => { if (e.target.value) { d.time = e.target.value; draw(); } } }))),
          h("div", { class: "field" }, h("span", { class: "field-label" }, "Jak długo"),
            h("div", { class: "chips" }, [[0, "Bez końca"], [30, "30 min"], [60, "1 h"], [90, "1,5 h"], [120, "2 h"]].map(([v, l]) => chip(l, d.dur === v, () => { d.dur = v; draw(); }))))],
      h("div", { class: "field" }, h("span", { class: "field-label" }, "Powtarzaj"),
        h("div", { class: "chips" }, [["none", "Nie"], ["week", "Co tydzień"], ["month", "Co miesiąc"], ["year", "Co rok"]].map(([v, l]) =>
          chip(l, d.repeat === v, () => { d.repeat = v; draw(); }, { dataset: { repeat: v } }))),
        d.repeat === "week" ? h("div", { class: "chips weekday-chips" }, DOW.map((l, i) => {
          const wd = (i + 1) % 7;
          return chip(l, d.days.has(wd), () => { d.days.has(wd) && d.days.size > 1 ? d.days.delete(wd) : d.days.add(wd); draw(); });
        })) : null),
      ps.length ? h("div", { class: "field" }, h("span", { class: "field-label" }, "Dla kogo"),
        h("div", { class: "chips" }, ps.map((p) => chip([h("span", { class: "ev-dot", style: { background: p.color } }), p.name], d.who === p.id, () => { d.who = p.id; draw(); }, { dataset: { who: p.id } })))) : null,
    ].flat().filter(Boolean));
  }

  function save() {
    const title = d.title.trim() || C.parseQuickAdd(quick.value).title;
    if (!title) { quick.focus(); toast("Wpisz, co się dzieje"); return; }
    const old = event || {};
    const repeat = d.repeat === "none" ? undefined : {
      freq: d.repeat,
      ...(d.repeat === "week" ? { days: [...new Set([...d.days, parseDateKey(d.dateKey).getDay()])].sort() } : {}), // dzien startu zawsze
      ...(old.repeat?.freq === d.repeat && old.repeat.until ? { until: old.repeat.until } : {}),
    };
    const id = d.id || uid("ev_");
    const out = {
      id, title, time: d.allDay ? "" : d.time,
      end: d.allDay ? undefined : C.addMinutes(d.time, d.dur) || undefined,
      to: d.allDay && d.to > d.dateKey ? d.to : undefined,
      repeat, skip: repeat && old.skip ? old.skip : undefined,
      who: d.who || undefined,
    };
    const writes = C.saveEvent(cal(), { oldKey: d.oldKey, newKey: d.dateKey, event: JSON.parse(JSON.stringify(out)) });
    applyWrites(writes, null, // bez komunikatu: nowy wpis widac od razu (i miga) na liscie dnia
      { notify: d.id ? null : { text: `${title} — ${C.dayLabel(d.dateKey).replace(/ \d{4}$/, "")}${out.time ? ", " + out.time : ""}`, day: d.dateKey, eventId: id } });
    closeSheet();
    select(d.dateKey);
    flashEvent(id);
  }

  draw();
  showSheet(d.id ? "Edytuj wydarzenie" : "Nowe wydarzenie",
    h("div", { class: "sheet-head" }, h("h2", {}, d.id ? "Edytuj wydarzenie" : "Nowe wydarzenie"), iconButton("close", "Zamknij", closeSheet)),
    h("div", { class: "sheet-scroll" },
      h("div", { class: "field" }, h("label", { class: "field-label", for: "cal-quick" }, "Co i kiedy"), quick,
        h("span", { class: "hint" }, "Dzień i godzinę rozpoznam sam — możesz też wybrać niżej.")),
      body),
    h("div", { class: "sheet-foot" }, saveBtn));
  quick.focus();
}

function openDetail(ev) {
  const p = personOf(ev);
  const actions = h("div", { class: "sheet-actions" });
  const showActions = () => actions.replaceChildren(
    h("button", { type: "button", class: "btn btn-primary", id: "cal-edit", onclick: () => openEditor({ event: ev, oldKey: ev.startKey }) }, h("span", { class: "icon", html: ICONS.edit }), "Edytuj"),
    h("button", { type: "button", class: "btn btn-ghost", id: "cal-dup", onclick: () => openEditor({ event: { ...ev, id: null, startKey: ev.occKey, repeat: undefined, skip: undefined }, dateKey: ev.occKey }) }, h("span", { class: "icon", html: ICONS.copy }), "Duplikuj"),
    h("button", { type: "button", class: "btn btn-ghost btn-danger-text", id: "cal-delete", onclick: () => (ev.repeat ? askDelete() : del("all")) }, h("span", { class: "icon", html: ICONS.trash }), "Usuń"));
  const askDelete = () => actions.replaceChildren(
    h("p", { class: "sheet-q" }, "To wydarzenie się powtarza. Co usunąć?"),
    h("button", { type: "button", class: "btn btn-ghost btn-block", id: "cal-del-one", onclick: () => del("one") }, "Tylko " + shortDate(ev.occKey)),
    h("button", { type: "button", class: "btn btn-ghost btn-block btn-danger-text", id: "cal-del-following", onclick: () => del("following") }, "To i wszystkie następne"),
    h("button", { type: "button", class: "link-btn", onclick: showActions }, "Anuluj"));
  const del = (how) => {
    const list = C.deleteOccurrence(cal(), ev.startKey, ev.id, ev.occKey, how);
    const what = how === "one" ? ` z ${shortDate(ev.occKey)}` : how === "following" && ev.repeat ? " i następne" : "";
    applyWrites([[ev.startKey, list]], `Usunięto „${ev.title}”${what}`);
    closeSheet();
    render();
  };
  showActions();
  showSheet(ev.title,
    h("div", { class: "sheet-head" },
      h("div", {}, h("h2", { class: "detail-title" }, ev.title),
        p ? h("span", { class: "detail-who" }, h("span", { class: "ev-dot", style: { background: p.color } }), p.name) : null),
      iconButton("close", "Zamknij", closeSheet)),
    h("div", { class: "detail-info" },
      h("div", { class: "detail-row" }, h("span", { class: "icon", html: ICONS.clock }),
        h("span", {}, h("b", {}, ev.multi ? `${shortDate(ev.occKey)} – ${shortDate(C.occurrenceEnd(ev))}` : dayTitle(ev.dateKey || ev.occKey)),
          h("small", {}, rangeText(ev) + (C.durationMinutes(ev) ? " · " + durText(C.durationMinutes(ev)) : "")))),
      ev.repeat ? h("div", { class: "detail-row" }, h("span", { class: "icon", html: ICONS.repeat }),
        h("span", {}, h("b", {}, capitalize(C.repeatLabel(ev))), ev.repeat.until ? h("small", {}, "do " + shortDate(ev.repeat.until)) : null)) : null),
    actions);
}

function flashEvent(id) {
  const el = shell.body.querySelector(`[data-event-id="${id}"]`);
  if (!el) return;
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1600);
}

const durText = (min) => (min % 60 ? (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`) : `${min / 60} h`);

// ----- rejestracja -----------------------------------------------------------

registerView({
  id: "calendar",
  title: "Kalendarz",
  mount(s) {
    shell = s;
    shell.body.classList.add("cal-body");
    fab = h("button", { type: "button", class: "fab cal-fab", id: "cal-add", "aria-label": "Dodaj wydarzenie", html: ICONS.plus, onclick: () => openEditor({ dateKey: selKey }) });
    shell.el.append(fab);
    store.calendar.subscribe(() => { if (shell.isOpen() && !sheet) render(); });
    store.calendar.onStatus((st) => shell.setStatus(st.error || ""));
    onGroupChange(() => { if (shell.isOpen() && !sheet) render(); });
  },
  onOpen(openDayKey = null) {
    closeSheet();
    selKey = openDayKey && /^\d{4}-\d{2}-\d{2}$/.test(openDayKey) ? openDayKey : todayKey();
    const d = parseDateKey(selKey);
    viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    if (openDayKey && mode === "list") mode = "month"; // z powiadomienia: pokaz konkretny dzien
    render();
  },
  onClose() { closeSheet(); },
  back() {
    if (sheet) { closeSheet(); return true; }
    return false;
  },
});
