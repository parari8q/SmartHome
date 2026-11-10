// Uklad pionowy/poziomy. "auto" = wg faktycznej orientacji ekranu
// (nowa domyslna opcja — wczesniej trzeba bylo wybierac recznie).

const KEY = "layoutMode";
const mq = typeof matchMedia !== "undefined" ? matchMedia("(orientation: portrait)") : null;

export function getLayout() {
  const v = localStorage.getItem(KEY);
  return v === "portrait" || v === "landscape" ? v : "auto";
}

function effective(mode) {
  if (mode !== "auto") return mode;
  return mq && mq.matches ? "portrait" : "landscape";
}

function apply() {
  document.documentElement.dataset.layout = effective(getLayout());
}

export function setLayout(mode) {
  if (mode === "auto") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, mode);
  apply();
}

export function initLayout() {
  apply();
  mq?.addEventListener?.("change", apply);
  window.addEventListener("resize", apply);
}
