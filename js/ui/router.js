// Prosty "router" widokow: ekran glowny pod spodem, nad nim menu albo
// jeden pelnoekranowy widok (Zadania, Kalendarz...).

import { h, ICONS } from "../lib/dom.js";

const views = new Map();
let current = null;

export function registerView(def) {
  const title = h("h1", { class: "view-title" }, def.title);
  const actions = h("div", { class: "view-actions" });
  const body = h("div", { class: "view-body" });
  const footer = h("div", { class: "view-footer" });
  const status = h("div", { class: "view-status", role: "status" });
  const el = h("section", { class: "view", id: "view-" + def.id, "aria-hidden": "true", "aria-label": def.title },
    h("header", { class: "view-header" },
      h("button", { type: "button", class: "icon-btn view-back", "aria-label": "Wróć", title: "Wróć", html: ICONS.back, onclick: () => back() }),
      title,
      actions),
    body, status, footer);
  document.getElementById("views").append(el);

  const shell = {
    el, body, footer,
    setTitle: (t) => { title.textContent = t; },
    setActions: (...nodes) => actions.replaceChildren(...nodes.flat().filter(Boolean)),
    setStatus: (t) => { status.textContent = t || ""; },
    isOpen: () => current === def.id,
  };
  views.set(def.id, { def, shell });
  def.mount?.(shell);
  return shell;
}

export function openView(id, ...args) {
  const v = views.get(id);
  if (!v) return;
  closeMenu();
  if (current && current !== id) hide(current);
  current = id;
  v.shell.el.classList.add("open");
  v.shell.el.setAttribute("aria-hidden", "false");
  document.body.dataset.view = id;
  v.def.onOpen?.(...args);
}

function hide(id) {
  const v = views.get(id);
  if (!v) return;
  v.shell.el.classList.remove("open");
  v.shell.el.setAttribute("aria-hidden", "true");
  v.def.onClose?.();
}

export function closeView() {
  if (!current) return;
  hide(current);
  current = null;
  delete document.body.dataset.view;
}

/** Wstecz: najpierw podekran widoku (np. z listy zadan do wszystkich list),
 *  potem zamkniecie widoku, potem zamkniecie menu. */
export function back() {
  if (current) {
    const v = views.get(current);
    if (v.def.back && v.def.back() === true) return;
    closeView();
    return;
  }
  closeMenu();
}

export function currentView() { return current; }

export function openMenu() {
  document.getElementById("menu").classList.add("open");
  document.getElementById("menu").setAttribute("aria-hidden", "false");
}

export function closeMenu() {
  document.getElementById("menu").classList.remove("open");
  document.getElementById("menu").setAttribute("aria-hidden", "true");
}

export function menuOpen() {
  return document.getElementById("menu").classList.contains("open");
}

/** Gesty: w gore na ekranie glownym = menu; w dol = wstecz (tylko gdy
 *  lista jest przewinieta na sama gore — wczesniej przewijanie listy
 *  potrafilo zamknac caly widok). */
export function installGestures() {
  let startY = null, startX = null, scroller = null;
  const THRESHOLD = 70;

  document.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || e.target.closest("input, textarea, select, [data-no-swipe]")) { startY = null; return; }
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    scroller = e.target.closest(".view-body, .menu-grid, .scroll");
  }, { passive: true });

  document.addEventListener("touchend", (e) => {
    if (startY === null) return;
    const dy = e.changedTouches[0].clientY - startY;
    const dx = e.changedTouches[0].clientX - startX;
    startY = null;
    if (Math.abs(dx) > Math.abs(dy)) return;
    if (dy < -THRESHOLD && !current && !menuOpen()) openMenu();
    else if (dy > THRESHOLD && (!scroller || scroller.scrollTop <= 0)) {
      if (current || menuOpen()) back();
    }
  }, { passive: true });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.querySelector(".dialog-backdrop") && !e.target.closest("input, textarea, select")) back();
  });
}
