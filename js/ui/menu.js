import { LINK_TILES } from "../config.js";
import { h, ICONS } from "../lib/dom.js";
import { openView, closeMenu } from "./router.js";

const TILES = [
  { id: "todo", label: "Zadania", icon: "todo", color: "#7c6fd1" },
  { id: "calendar", label: "Kalendarz", icon: "calendar", color: "#d9952f" },
  { id: "supplements", label: "Witaminy", icon: "pill", color: "#6f9fc2" },
  { id: "shopping", label: "Zakupy", icon: "cart", color: "#d4627a", open: () => openView("recipes", "shoppingList") },
  { id: "recipes", label: "Przepisy", icon: "recipes", color: "#5c9e4c" },
  { id: "spotify", label: "Spotify", icon: "spotify", color: "#2fa35a" },
  ...LINK_TILES.map((t) => ({ ...t, link: true })),
  { id: "home", label: "Pogoda", icon: "weather", color: "#3b7bc4", open: () => closeMenu() },
  { id: "settings", label: "Ustawienia", icon: "settings", color: "#5b6270" },
];

export function renderMenu() {
  const grid = document.getElementById("menu-grid");
  grid.replaceChildren(...TILES.map((t) => {
    const inner = [h("span", { class: "tile-icon", html: ICONS[t.icon] }), h("span", { class: "tile-label" }, t.label)];
    const style = { "--tile": t.color };
    return t.link
      ? h("a", { class: "tile", href: t.url, style, dataset: { tile: t.id } }, inner)
      : h("button", { type: "button", class: "tile", style, dataset: { tile: t.id }, onclick: () => (t.open ? t.open() : openView(t.id)) }, inner);
  }));
}
