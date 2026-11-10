// Klikniecie w powiadomienie otwiera dashboard z adresem typu
//   ?otworz=kalendarz&dzien=2026-11-12&wpis=ev_123
//   ?otworz=zadania&lista=list_1&wpis=task_9
//   ?otworz=zakupy
//   ?otworz=przepisy&przepis=r1
// — tu przechodzimy od razu do wlasciwego miejsca i podswietlamy nowy wpis.

import { store } from "../store.js";
import { openView } from "./router.js";

function whenLoaded(doc) {
  return new Promise((resolve) => {
    if (doc.loaded) return resolve();
    const off = doc.subscribe(() => { if (doc.loaded) { off(); resolve(); } });
  });
}

function highlight(selector) {
  if (!selector) return;
  let tries = 0;
  const tick = () => {
    const el = document.querySelector(selector);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 3200);
    } else if (tries++ < 20) setTimeout(tick, 150); // dane moga jeszcze dochodzic
  };
  setTimeout(tick, 80);
}

export function parseDeepLink(search) {
  const p = new URLSearchParams(search);
  const what = p.get("otworz");
  if (!what) return null;
  return { what, day: p.get("dzien"), list: p.get("lista"), item: p.get("wpis"), recipe: p.get("przepis") };
}

export async function handleDeepLink() {
  const link = parseDeepLink(location.search);
  if (!link) return;
  history.replaceState({}, document.title, location.pathname);
  const safe = (v) => (v && /^[\w-]+$/.test(v) ? v : null);

  if (link.what === "kalendarz") {
    await whenLoaded(store.calendar);
    const day = link.day && /^\d{4}-\d{2}-\d{2}$/.test(link.day) ? link.day : null;
    openView("calendar", day);
    if (day && safe(link.item)) highlight(`#view-calendar [data-event-id="${safe(link.item)}"]`);
  } else if (link.what === "zadania") {
    await whenLoaded(store.todo);
    const list = safe(link.list);
    openView("todo", list && store.todo.value.some((l) => l.id === list) ? list : null);
    if (list && safe(link.item)) highlight(`#view-todo [data-task-id="${safe(link.item)}"]`);
    else if (list) highlight(`#view-todo .rows`);
  } else if (link.what === "zakupy") {
    await whenLoaded(store.shopping);
    openView("recipes", "shoppingList");
  } else if (link.what === "przepisy") {
    await whenLoaded(store.recipes);
    openView("recipes", link.recipe ? "recipe" : "categories", safe(link.recipe));
  }
}
