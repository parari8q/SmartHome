// Dolny pasek nawigacji — zawsze widoczny (zamiast chowania sekcji pod
// menu i gestem w gore). Aktywna zakladka wynika z otwartego widoku.

import { h, ICONS } from "../lib/dom.js";
import { openView, closeView, closeMenu } from "./router.js";

const TABS = [
  { id: "home", label: "Start", icon: "home", open: () => { closeMenu(); closeView(); } },
  { id: "shopping", label: "Zakupy", icon: "cart", open: () => openView("recipes", "shoppingList") },
  { id: "recipes", label: "Przepisy", icon: "recipes", open: () => openView("recipes") },
  { id: "todo", label: "Zadania", icon: "todo", open: () => openView("todo") },
  { id: "calendar", label: "Kalendarz", icon: "calendar", open: () => openView("calendar") },
];

/** Ktora zakladka odpowiada temu, co jest na ekranie. */
export function activeTab(view, sub) {
  if (!view) return "home";
  if (view === "recipes") return sub === "shoppingList" || sub === "shoppingPick" ? "shopping" : "recipes";
  return TABS.some((t) => t.id === view) ? view : null; // np. Ustawienia — zadna zakladka
}

export function mountTabbar() {
  const nav = document.getElementById("tabbar");
  if (!nav) return;
  const buttons = TABS.map((t) => h("button", {
    type: "button", class: "tab", dataset: { tab: t.id }, onclick: t.open,
  }, h("span", { class: "tab-icon", html: ICONS[t.icon] }), h("span", { class: "tab-label" }, t.label)));
  nav.replaceChildren(...buttons);

  const sync = () => {
    const active = activeTab(document.body.dataset.view, document.body.dataset.sub);
    for (const b of buttons) {
      const on = b.dataset.tab === active;
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    }
  };
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ["data-view", "data-sub"] });
  sync();
}
