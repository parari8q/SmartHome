// EKRAN GLOWNY — zegar, pogoda i panel "Dziś" z danymi z bazy.

import { CONFIG } from "../config.js";
import { store } from "../store.js";
import { buildWeatherUrl, summarize, themeFor, describeCode } from "../logic/weather.js";
import { upcomingEvents, relativeDayLabel } from "../logic/calendar.js";
import { todayReminder, computeStreak } from "../logic/supplements.js";
import { openCount } from "../logic/todo.js";
import { h, clear, ICONS } from "../lib/dom.js";
import { capitalize, plural } from "../lib/util.js";
import { openView } from "./router.js";

export const WEATHER_ICONS = {
  clear: `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><circle cx="50" cy="50" r="20"/><g class="anim-sun"><line x1="50" y1="8" x2="50" y2="20"/><line x1="50" y1="80" x2="50" y2="92"/><line x1="8" y1="50" x2="20" y2="50"/><line x1="80" y1="50" x2="92" y2="50"/><line x1="21" y1="21" x2="29" y2="29"/><line x1="71" y1="71" x2="79" y2="79"/><line x1="21" y1="79" x2="29" y2="71"/><line x1="71" y1="29" x2="79" y2="21"/></g></svg>`,
  cloud: `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path class="anim-cloud" d="M28 62a16 16 0 1 1 4-31.5 20 20 0 0 1 38 8A14 14 0 0 1 68 66H30"/></svg>`,
  fog: `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><line class="anim-fog" x1="18" y1="38" x2="82" y2="38"/><line class="anim-fog" x1="12" y1="52" x2="88" y2="52"/><line class="anim-fog" x1="20" y1="66" x2="80" y2="66"/></svg>`,
  rain: `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M26 52a16 16 0 1 1 4-31.5 20 20 0 0 1 38 8A14 14 0 0 1 66 56H28"/><line class="anim-drop" x1="34" y1="66" x2="34" y2="76"/><line class="anim-drop" x1="50" y1="66" x2="50" y2="76"/><line class="anim-drop" x1="66" y1="66" x2="66" y2="76"/></svg>`,
  snow: `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M26 50a16 16 0 1 1 4-31.5 20 20 0 0 1 38 8A14 14 0 0 1 66 54H28"/><circle class="anim-drop" cx="34" cy="68" r="2" fill="currentColor"/><circle class="anim-drop" cx="50" cy="68" r="2" fill="currentColor"/><circle class="anim-drop" cx="66" cy="68" r="2" fill="currentColor"/></svg>`,
  storm: `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M26 48a16 16 0 1 1 4-31.5 20 20 0 0 1 38 8A14 14 0 0 1 66 52H28"/><path class="anim-bolt" d="M52 58l-10 16h9l-4 12 13-18h-9l4-10z" fill="currentColor" stroke="none"/></svg>`,
};

const $ = (id) => document.getElementById(id);
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });

// ----- zegar ------------------------------------------------------------------

function tickClock() {
  const now = new Date();
  $("clock").textContent = now.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  const date = capitalize(now.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" }));
  if ($("date").textContent !== date) {
    $("date").textContent = date;
    renderToday(); // o polnocy odswiezamy "Dziś"
  }
}

// ----- pogoda -------------------------------------------------------------------

function setTheme(cat, isDay) {
  const t = themeFor(cat, isDay);
  const root = document.documentElement.style;
  root.setProperty("--sky-top", t.top);
  root.setProperty("--sky-bottom", t.bottom);
  root.setProperty("--accent", t.accent);
}

let weatherFailures = 0;
async function fetchWeather() {
  try {
    const res = await fetch(buildWeatherUrl(CONFIG));
    if (!res.ok) throw new Error("HTTP " + res.status);
    renderWeather(summarize(await res.json()));
    weatherFailures = 0;
    $("weather-error").hidden = true;
  } catch (err) {
    console.warn("Pogoda:", err);
    weatherFailures++;
    $("weather-error").hidden = false;
    // szybsza ponowna proba niz standardowe 10 min
    setTimeout(fetchWeather, Math.min(60000 * weatherFailures, 300000));
  }
}

function renderWeather(w) {
  setTheme(w.cat, w.isDay);
  $("weather-icon").innerHTML = WEATHER_ICONS[w.cat] || WEATHER_ICONS.cloud;
  $("temp").textContent = String(w.temp);
  $("condition").textContent = w.text;
  $("location").textContent = CONFIG.cityName + (w.max != null ? ` · ${w.max}° / ${w.min}°` : "");
  $("stat-feels").textContent = w.feels + "°";
  $("stat-humidity").textContent = w.humidity + "%";
  $("stat-wind").textContent = w.wind + " km/h";
  $("stat-sun").textContent = w.isDay && w.sunset ? fmtTime(w.sunset) : (w.sunrise ? fmtTime(w.sunrise) : "--:--");
  $("stat-sun-label").textContent = w.isDay ? "Zachód" : "Wschód";
  clear($("hourly"), w.hours.map((hr) => h("div", { class: "hour" },
    h("div", { class: "h-time" }, fmtTime(hr.time)),
    h("div", { class: "h-icon", html: WEATHER_ICONS[describeCode(hr.code).cat] || WEATHER_ICONS.cloud }),
    h("div", { class: "h-temp" }, hr.temp + "°"),
    hr.precip ? h("div", { class: "h-precip" }, hr.precip + "%") : null)));
  $("last-updated").textContent = "Aktualizacja " + new Date().toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}

// ----- panel "Dziś" ---------------------------------------------------------

function card(id, iconName, title, onClick, ...content) {
  return h("button", { type: "button", class: "today-card", id, onclick: onClick },
    h("div", { class: "today-card-head" }, h("span", { class: "icon", html: ICONS[iconName] }), h("span", {}, title)),
    ...content);
}

function renderToday() {
  const panel = $("today");
  if (!panel) return;
  const cards = [];

  const reminder = todayReminder(store.supplements.value);
  if (store.supplements.loaded && reminder) {
    const streak = computeStreak(store.supplements.value);
    cards.push(h("button", { type: "button", class: "today-card reminder", id: "home-supp", style: { "--dose": reminder.color }, onclick: () => openView("supplements") },
      h("span", { class: "dose-dot" }),
      h("span", { class: "row-main" }, h("span", { class: "row-title" }, "Dziś: " + reminder.name),
        h("span", { class: "row-sub" }, streak ? `Passa ${streak} — nie przerwij jej!` : "Odhacz po wzięciu")),
      h("span", { class: "icon chev", html: ICONS.next })));
  }

  if (store.calendar.loaded) {
    const events = upcomingEvents(store.calendar.value, new Date(), 7, 3);
    cards.push(card("home-events", "calendar", "Najbliższe", () => openView("calendar"),
      events.length
        ? h("ul", { class: "mini-list" }, events.map((ev) => h("li", {},
            h("span", { class: "pill" }, relativeDayLabel(ev.dayOffset, ev.dateKey) + (ev.time ? " " + ev.time : "")),
            h("span", { class: "ellipsis" }, ev.title))))
        : h("div", { class: "muted" }, "Nic w tym tygodniu")));
  }

  if (store.todo.loaded) {
    const lists = store.todo.value.filter((l) => openCount(l) > 0).sort((a, b) => openCount(b) - openCount(a));
    const total = lists.reduce((s, l) => s + openCount(l), 0);
    cards.push(card("home-todo", "todo", "Zadania", () => openView("todo"),
      total
        ? h("ul", { class: "mini-list" }, lists.slice(0, 3).map((l) => h("li", {}, h("span", { class: "badge" }, String(openCount(l))), h("span", { class: "ellipsis" }, l.name))))
        : h("div", { class: "muted" }, "Wszystko zrobione 🎉")));
  }

  if (store.shopping.loaded) {
    const left = store.shopping.value.filter((i) => !i.checked).length;
    if (left) {
      cards.push(card("home-shopping", "cart", "Zakupy", () => openView("recipes", "shoppingList"),
        h("div", { class: "muted" }, `${left} ${plural(left, "pozycja", "pozycje", "pozycji")} do kupienia`)));
    }
  }

  clear(panel, cards);
}

// ----- status synchronizacji -------------------------------------------------

const STATUS_TEXT = {
  live: "Zsynchronizowano",
  saving: "Zapisywanie…",
  connecting: "Łączenie z bazą…",
  offline: "Brak połączenia — zmiany zapiszą się po powrocie sieci",
  warning: "Problem z zapisem — szczegóły w Ustawieniach",
  error: "Błąd połączenia z bazą",
  auth: "Brak dostępu — zaloguj się (Ustawienia)",
};

export function setSyncStatus(status) {
  const el = $("sync");
  el.className = "sync-dot sync-" + status;
  el.title = STATUS_TEXT[status] || status;
  el.setAttribute("aria-label", el.title);
  el.dataset.status = status;
}

export function initHome() {
  tickClock();
  setInterval(tickClock, 1000);
  fetchWeather();
  setInterval(fetchWeather, CONFIG.weatherRefreshMinutes * 60000);
  for (const doc of [store.todo, store.calendar, store.supplements, store.shopping]) doc.subscribe(renderToday);
  renderToday();
}
