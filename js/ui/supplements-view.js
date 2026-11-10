// WITAMINY — kalendarz dawek, passa i brzydka Chihuahua w nagrode.

import { store } from "../store.js";
import * as S from "../logic/supplements.js";
import { PHOTOS_REPO } from "../config.js";
import { h, clear, ICONS, iconButton, confirmDialog } from "../lib/dom.js";
import { formatDateKey, capitalize } from "../lib/util.js";
import { registerView } from "./router.js";

let shell;
let viewMonth = new Date();
let photoListPromise = null;

const log = () => store.supplements.value;

const CHIHUAHUA_SVG = `<svg viewBox="0 0 200 190" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Rysunek Chihuahuy">
  <ellipse cx="100" cy="150" rx="46" ry="28" fill="#c99b6b"/><rect x="64" y="163" width="9" height="24" rx="4" fill="#c99b6b"/>
  <rect x="129" y="163" width="9" height="24" rx="4" fill="#c99b6b"/><path d="M144 138 Q172 118 158 88" stroke="#c99b6b" stroke-width="9" fill="none" stroke-linecap="round"/>
  <path d="M138 52 Q172 62 154 98 Q122 90 126 58 Z" fill="#c99b6b"/><ellipse cx="95" cy="92" rx="56" ry="50" fill="#d4a878"/>
  <path d="M53 58 Q26 16 53 12 Q76 38 66 70 Z" fill="#c99b6b"/><circle cx="73" cy="88" r="19" fill="#fff"/><circle cx="68" cy="91" r="10.5" fill="#3a2a1a"/>
  <circle cx="64" cy="87" r="3" fill="#fff"/><circle cx="121" cy="93" r="12" fill="#fff"/><circle cx="124" cy="95" r="6.5" fill="#3a2a1a"/>
  <ellipse cx="94" cy="113" rx="9" ry="6.5" fill="#3a2a1a"/><path d="M78 123 Q95 134 112 120" stroke="#3a2a1a" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M99 126 L103 137 L107 126 Z" fill="#fff"/></svg>`;

/** Lista zdjec z folderu Pieski w repozytorium (API GitHuba). */
function fetchPhotoList() {
  if (photoListPromise) return photoListPromise;
  const onPages = location.hostname.endsWith(".github.io");
  const owner = onPages ? location.hostname.split(".")[0] : PHOTOS_REPO.owner;
  const repo = onPages ? (location.pathname.split("/")[1] || PHOTOS_REPO.repo) : PHOTOS_REPO.repo;
  photoListPromise = fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${PHOTOS_REPO.folder}`)
    .then((r) => (r.ok ? r.json() : []))
    .then((files) => (Array.isArray(files) ? files : [])
      .filter((f) => f.type === "file" && /\.(jpe?g|png|webp|gif)$/i.test(f.name))
      // na GitHub Pages ladujemy z tej samej strony (szybciej, bez limitow)
      .map((f) => (onPages ? `${PHOTOS_REPO.folder}/${f.name}` : f.download_url)))
    .catch(() => []);
  return photoListPromise;
}

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

async function renderReward(streak, el) {
  if (!S.isRewardStreak(streak)) return clear(el);
  const caption = h("div", { class: "reward-caption" }, `${streak} ${streak === 1 ? "dzień" : "dni"} z rzędu — oto brzydka Chihuahua w nagrodę`);
  const todayKey = formatDateKey(new Date());
  const photos = await fetchPhotoList();
  let choice = readJSON("chihuahua_reward_choice", null);
  let photo = choice && choice.date === todayKey && photos.includes(choice.photo) ? choice.photo : null;
  if (!photo && photos.length) {
    const r = S.pickUnseen(photos, readJSON("chihuahua_shown", []));
    photo = r.pick;
    localStorage.setItem("chihuahua_shown", JSON.stringify(r.shown));
    localStorage.setItem("chihuahua_reward_choice", JSON.stringify({ date: todayKey, photo }));
  }
  const img = photo
    ? h("img", { src: photo, alt: "Chihuahua — nagroda", class: "reward-img", onerror: (e) => { e.currentTarget.replaceWith(h("div", { class: "reward-svg", html: CHIHUAHUA_SVG })); } })
    : h("div", { class: "reward-svg", html: CHIHUAHUA_SVG });
  clear(el, img, caption);
}

function render() {
  if (!shell) return;
  const y = viewMonth.getFullYear(), m = viewMonth.getMonth();
  const data = log();
  const today = new Date();
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(h("div", { class: "day empty" }));
  for (let d = 1; d <= days; d++) {
    const date = new Date(y, m, d);
    const key = formatDateKey(date);
    const st = S.dayState(data, date, today);
    cells.push(h("button", {
      type: "button",
      class: "day supp" + (st.scheduled ? " scheduled" : "") + (st.isToday ? " today" : "") + (st.missed ? " missed" : "") + (st.taken ? " taken" : "") + (st.isFuture ? " future" : ""),
      style: st.scheduled ? { "--dose": st.scheduled.color } : null,
      title: st.scheduled ? st.scheduled.name : "",
      dataset: { date: key },
      disabled: st.isFuture,
      "aria-pressed": String(st.taken),
      onclick: () => store.supplements.set(key, st.taken ? null : true),
    }, h("span", { class: "day-num" }, String(d)), st.taken ? h("span", { class: "tick", html: ICONS.check }) : null));
  }

  const streak = S.computeStreak(data, today);
  const reward = h("div", { class: "reward" });
  const legend = new Map();
  for (const s of Object.values(S.SUPPLEMENT_SCHEDULE)) legend.set(s.name, s.color);

  clear(shell.body,
    h("div", { class: "month-nav" },
      iconButton("back", "Poprzedni miesiąc", () => { viewMonth = new Date(y, m - 1, 1); render(); }),
      h("div", { class: "month-label", id: "supp-month-label" }, capitalize(viewMonth.toLocaleDateString("pl-PL", { month: "long", year: "numeric" }))),
      iconButton("next", "Następny miesiąc", () => { viewMonth = new Date(y, m + 1, 1); render(); })),
    h("div", { class: "month-grid" }, ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nie"].map((d) => h("div", { class: "dow" }, d)), cells),
    h("div", { class: "legend" }, [...legend].map(([name, color]) => h("span", {}, h("i", { style: { background: color } }), name))),
    h("div", { class: "streak", id: "supp-streak" }, S.streakLabel(streak)),
    reward,
    h("button", { type: "button", class: "link-btn", onclick: async () => {
      if (!(await confirmDialog("Wyczyścić całą historię witamin i zacząć passę od zera?", { okLabel: "Resetuj" }))) return;
      store.supplements.set("", null);
      localStorage.removeItem("chihuahua_shown");
      localStorage.removeItem("chihuahua_reward_choice");
    } }, "Resetuj passę"));
  renderReward(streak, reward);
}

registerView({
  id: "supplements",
  title: "Witaminy",
  mount(s) {
    shell = s;
    store.supplements.subscribe(() => { if (shell.isOpen()) render(); });
    store.supplements.onStatus((st) => shell.setStatus(st.error || ""));
  },
  onOpen() { viewMonth = new Date(); render(); },
});
