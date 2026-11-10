// KALENDARZ — widok miesiaca; dzien = lista wydarzen z godzina.

import { store } from "../store.js";
import * as C from "../logic/calendar.js";
import { h, clear, ICONS, iconButton, emptyState } from "../lib/dom.js";
import { formatDateKey, startOfDay, capitalize } from "../lib/util.js";
import { registerView } from "./router.js";
import { notifyGroup } from "../notify.js";

let shell;
let viewMonth = new Date();
let dayKey = null;
let editingId = null;
let bar, timeInput, titleInput;

const cal = () => store.calendar.value;
const saveDay = (key, list) => store.calendar.set(key, list);

function render() {
  if (!shell || editingId) return;
  dayKey ? renderDay() : renderMonth();
}

function renderMonth() {
  shell.setTitle("Kalendarz");
  shell.setActions(h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => { viewMonth = new Date(); renderMonth(); } }, "Dziś"));
  bar.hidden = true;

  const y = viewMonth.getFullYear(), m = viewMonth.getMonth();
  const today = startOfDay();
  const events = cal();
  const label = capitalize(viewMonth.toLocaleDateString("pl-PL", { month: "long", year: "numeric" }));

  const grid = h("div", { class: "month-grid" },
    ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nie"].map((d) => h("div", { class: "dow" }, d)),
    C.monthGrid(y, m).map((date) => {
      if (!date) return h("div", { class: "day empty" });
      const key = formatDateKey(date);
      const n = (events[key] || []).length;
      return h("button", {
        type: "button",
        class: "day" + (date.getTime() === today.getTime() ? " today" : "") + (n ? " has-events" : "") + (date < today ? " past" : ""),
        dataset: { date: key },
        "aria-label": C.dayLabel(key) + (n ? `, ${n} wydarzeń` : ""),
        onclick: () => { dayKey = key; render(); },
      }, h("span", { class: "day-num" }, String(date.getDate())), n ? h("span", { class: "dots" }, Array.from({ length: Math.min(n, 3) }, () => h("i"))) : null);
    }));

  const upcoming = C.upcomingEvents(events, new Date(), 14, 5);
  clear(shell.body,
    h("div", { class: "month-nav" },
      iconButton("back", "Poprzedni miesiąc", () => { viewMonth = new Date(y, m - 1, 1); renderMonth(); }),
      h("div", { class: "month-label", id: "cal-month-label" }, label),
      iconButton("next", "Następny miesiąc", () => { viewMonth = new Date(y, m + 1, 1); renderMonth(); })),
    grid,
    h("div", { class: "section-label" }, "Najbliższe 2 tygodnie"),
    upcoming.length
      ? h("div", { class: "rows" }, upcoming.map((ev) => h("button", { type: "button", class: "row row-link", onclick: () => { dayKey = ev.dateKey; render(); } },
          h("span", { class: "pill" }, C.relativeDayLabel(ev.dayOffset, ev.dateKey)),
          h("span", { class: "row-title" }, ev.title),
          ev.time ? h("span", { class: "row-sub mono" }, ev.time) : null)))
      : emptyState("Nic zaplanowanego."));
}

function renderDay() {
  shell.setTitle(capitalize(C.dayLabel(dayKey)));
  shell.setActions();
  bar.hidden = false;
  const events = C.eventsForDay(cal(), dayKey);
  if (!events.length) return clear(shell.body, emptyState("Nic zaplanowanego tego dnia — dodaj coś na dole."));
  clear(shell.body, h("div", { class: "rows" }, events.map((ev) =>
    h("div", { class: "row event", dataset: { eventId: ev.id } },
      h("span", { class: "event-time mono" }, ev.time || "cały dzień"),
      h("span", { class: "row-title event-title" }, ev.title),
      iconButton("edit", "Edytuj", (e) => startEdit(ev, e.currentTarget.closest(".row")), "icon-btn icon-btn-subtle"),
      iconButton("close", "Usuń", () => saveDay(dayKey, C.deleteEvent(cal(), dayKey, ev.id)), "icon-btn icon-btn-subtle")))));
}

function startEdit(ev, row) {
  editingId = ev.id;
  const t = h("input", { type: "time", class: "inline-edit time-input", value: ev.time || "" });
  const title = h("input", { type: "text", class: "inline-edit", value: ev.title });
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    editingId = null;
    if (commit && title.value.trim()) saveDay(dayKey, C.updateEvent(cal(), dayKey, ev.id, { time: t.value, title: title.value }));
    render();
  };
  for (const inp of [t, title]) {
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); });
    inp.addEventListener("blur", () => setTimeout(() => { if (!row.contains(document.activeElement)) finish(true); }, 120));
  }
  row.querySelector(".event-time").replaceWith(t);
  row.querySelector(".event-title").replaceWith(title);
  title.focus();
  title.select();
}

function submit() {
  const title = titleInput.value.trim();
  if (!title || !dayKey) return;
  saveDay(dayKey, C.addEvent(cal(), dayKey, { time: timeInput.value, title }));
  notifyGroup("calendar", `${title} — ${C.dayLabel(dayKey).replace(/ \d{4}$/, "")}${timeInput.value ? ", " + timeInput.value : ""}`);
  titleInput.value = "";
  timeInput.value = "";
  titleInput.focus();
}

registerView({
  id: "calendar",
  title: "Kalendarz",
  mount(s) {
    shell = s;
    timeInput = h("input", { type: "time", class: "time-input", id: "cal-time-input", "aria-label": "Godzina (opcjonalnie)" });
    titleInput = h("input", { type: "text", id: "cal-title-input", placeholder: "Co się dzieje…", autocomplete: "off",
      onkeydown: (e) => { if (e.key === "Enter") submit(); } });
    bar = h("div", { class: "input-bar" }, timeInput, titleInput, h("button", { type: "button", class: "btn btn-primary", onclick: submit }, "Dodaj"));
    shell.footer.append(bar);
    store.calendar.subscribe(() => { if (shell.isOpen()) render(); });
    store.calendar.onStatus((st) => shell.setStatus(st.error || ""));
  },
  onOpen(openDayKey = null) {
    viewMonth = openDayKey ? new Date(openDayKey + "T12:00") : new Date();
    dayKey = openDayKey;
    editingId = null;
    render();
  },
  back() {
    if (dayKey) {
      viewMonth = new Date(dayKey + "T12:00");
      dayKey = null; editingId = null; render(); return true;
    }
    return false;
  },
});
