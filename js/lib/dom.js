// Tworzenie elementow bez innerHTML z danymi uzytkownika (koniec z
// psuciem sie strony, gdy w nazwie zadania jest "<" albo cudzyslow).

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith("--")) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    }
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") el.innerHTML = v; // tylko dla zaufanych stalych (ikony)
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICONS = {
  home: P('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  user: P('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  sparkles: P('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
  clock: P('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  repeat: P('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>'),
  copy: P('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  back: P('<polyline points="15 18 9 12 15 6"/>'),
  down: P('<polyline points="6 9 12 15 18 9"/>'),
  up: P('<polyline points="6 15 12 9 18 15"/>'),
  next: P('<polyline points="9 18 15 12 9 6"/>'),
  undo: P('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  eye: P('<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: P('<path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-7-11-7a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>'),
  plus: P('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  close: P('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  check: P('<polyline points="20 6 9 17 4 12"/>'),
  edit: P('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  trash: P('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
  mic: P('<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/>'),
  grid: P('<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>'),
  search: P('<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
  more: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>',
  todo: P('<path d="M9 11l2 2 4-4"/><rect x="3" y="4" width="18" height="17" rx="3"/>'),
  calendar: P('<rect x="3" y="5" width="18" height="16" rx="3"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>'),
  weather: P('<path d="M4 15a4 4 0 0 1 1-7.9 6 6 0 0 1 11.4-2A5 5 0 0 1 19 15H4z"/><line x1="9" y1="19" x2="9" y2="21"/><line x1="13" y1="19" x2="13" y2="21"/>'),
  recipes: P('<path d="M4 3h9l7 7v11H4z"/><path d="M13 3v7h7"/><line x1="8" y1="13" x2="15" y2="13"/><line x1="8" y1="16" x2="15" y2="16"/>'),
  cart: P('<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 8H6"/>'),
  settings: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  portrait: P('<rect x="6" y="2" width="12" height="20" rx="2"/>'),
  landscape: P('<rect x="2" y="6" width="20" height="12" rx="2"/>'),
  lock: P('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  image: P('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'),
};

export function icon(name, cls = "icon") {
  return h("span", { class: cls, html: ICONS[name] || "" });
}

export function iconButton(name, label, onClick, cls = "icon-btn") {
  return h("button", { type: "button", class: cls, "aria-label": label, title: label, onclick: onClick, html: ICONS[name] });
}

export function emptyState(text) {
  return h("div", { class: "empty" }, text);
}

// ----- okienko potwierdzenia (zamiast window.confirm, ktory w trybie kiosku
// bywa blokowany) -----------------------------------------------------------

export function confirmDialog(message, { okLabel = "Usuń", danger = true } = {}) {
  return new Promise((resolve) => {
    const close = (result) => { overlay.remove(); resolve(result); };
    const overlay = h("div", { class: "dialog-backdrop", onclick: (e) => { if (e.target === overlay) close(false); } },
      h("div", { class: "dialog", role: "dialog", "aria-modal": "true" },
        h("p", {}, message),
        h("div", { class: "dialog-actions" },
          h("button", { type: "button", class: "btn btn-ghost", onclick: () => close(false) }, "Anuluj"),
          h("button", { type: "button", class: "btn " + (danger ? "btn-danger" : "btn-primary"), "data-confirm": "", onclick: () => close(true) }, okLabel))));
    document.body.append(overlay);
    overlay.querySelector("[data-confirm]").focus();
  });
}

export function promptDialog(message, { placeholder = "", value = "", okLabel = "Dodaj" } = {}) {
  return new Promise((resolve) => {
    const input = h("input", { type: "text", placeholder, value, autocomplete: "off" });
    const close = (result) => { overlay.remove(); resolve(result); };
    const ok = () => { const v = input.value.trim(); if (v) close(v); else input.focus(); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") ok(); if (e.key === "Escape") close(null); });
    const overlay = h("div", { class: "dialog-backdrop", onclick: (e) => { if (e.target === overlay) close(null); } },
      h("div", { class: "dialog", role: "dialog", "aria-modal": "true" },
        h("p", {}, message), input,
        h("div", { class: "dialog-actions" },
          h("button", { type: "button", class: "btn btn-ghost", onclick: () => close(null) }, "Anuluj"),
          h("button", { type: "button", class: "btn btn-primary", "data-confirm": "", onclick: ok }, okLabel))));
    document.body.append(overlay);
    input.focus();
  });
}

let toastTimer = null;
/** Krotki, dyskretny komunikat na dole ekranu; action = { label, onClick } dodaje przycisk (np. "Cofnij").
 *  Domyslnie 2,5 s (z przyciskiem 4 s); znika po dotknieciu albo przesunieciu palcem. */
export function toast(message, ms = null, action = null) {
  ms = ms ?? (action ? 4000 : 2500);
  let el = document.getElementById("toast");
  if (!el) {
    el = h("div", { id: "toast", role: "status", "aria-live": "polite" });
    let x0 = null, y0 = 0;
    const hide = () => { el.classList.remove("show"); clearTimeout(toastTimer); };
    el.addEventListener("pointerdown", (e) => { x0 = e.clientX; y0 = e.clientY; });
    el.addEventListener("pointerup", (e) => {
      if (x0 == null || e.target.closest(".toast-action")) { x0 = null; return; }
      const moved = Math.abs(e.clientX - x0) > 30 || e.clientY - y0 > 20;
      x0 = null;
      if (moved || e.target.closest(".toast-text")) hide(); // dotkniecie tekstu albo przesuniecie = zamknij
    });
    document.body.append(el);
  }
  el.replaceChildren(h("span", { class: "toast-text" }, message));
  if (action) {
    el.append(h("button", { type: "button", class: "toast-action", id: "toast-action", onclick: () => {
      el.classList.remove("show");
      action.onClick();
    } }, action.label));
  }
  el.classList.toggle("has-action", !!action);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

/** Pole tekstowe + przycisk "Dodaj" na dole widoku. */
export function inputBar({ placeholder, onSubmit, id, extra = [] }) {
  const input = h("input", { type: "text", placeholder, id, enterkeyhint: "done", autocomplete: "off" });
  const submit = () => {
    const v = input.value.trim();
    if (!v) return;
    const keep = onSubmit(v, extraEls) === false;
    if (!keep) input.value = "";
    input.focus();
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  const extraEls = extra;
  return { el: h("div", { class: "input-bar" }, ...extra, input, h("button", { type: "button", class: "btn btn-primary", onclick: submit }, "Dodaj")), input };
}
