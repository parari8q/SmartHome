// USTAWIENIA — orientacja (per urzadzenie) i stan synchronizacji.

import { store, auth, reconnectAll } from "../store.js";
import { showLogin } from "./login.js";
import { h, clear, ICONS } from "../lib/dom.js";
import { registerView } from "./router.js";
import { getLayout, setLayout } from "./layout.js";

let shell;
const NAMES = { todo: "Zadania", calendar: "Kalendarz", recipes: "Przepisy", shopping: "Lista zakupów" };
const CONN = { live: "połączono", connecting: "łączenie…", offline: "brak połączenia", error: "błąd", auth: "brak dostępu" };

function render() {
  const layout = getLayout();
  const choice = (mode, label) => h("button", {
    type: "button", class: "choice" + (layout === mode ? " active" : ""), "aria-pressed": String(layout === mode),
    onclick: () => { setLayout(mode); render(); },
  }, h("span", { class: "icon", html: ICONS[mode] }), label);

  clear(shell.body,
    h("div", { class: "section-label" }, "Układ ekranu (na tym urządzeniu)"),
    h("div", { class: "choices" }, choice("auto", "Automatycznie"), choice("portrait", "Pionowo"), choice("landscape", "Poziomo")),
    h("div", { class: "section-label" }, "Konto"),
    h("div", { class: "row", id: "account-row" },
      h("span", { class: "row-main" },
        h("span", { class: "row-title" }, auth.isLoggedIn ? auth.email : "Niezalogowano"),
        h("span", { class: "row-sub" }, auth.isLoggedIn ? "Widzisz dane tego konta — wspólne dla wszystkich urządzeń, na których się nim zalogujesz" : "Zaloguj się, żeby zobaczyć swoje dane")),
      auth.isLoggedIn
        ? h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => { auth.signOut(); render(); } }, "Wyloguj")
        : h("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => showLogin() }, "Zaloguj")),
    h("div", { class: "section-label" }, "Synchronizacja"),
    h("div", { class: "rows" }, Object.entries(store).map(([key, doc]) => {
      const s = doc.getState();
      return h("div", { class: "row sync-row" },
        h("span", { class: "sync-dot sync-" + (s.connection === "auth" ? "error" : s.error ? "warning" : s.connection) }),
        h("span", { class: "row-main" }, h("span", { class: "row-title" }, NAMES[key]),
          h("span", { class: "row-sub" }, (CONN[s.connection] || s.connection) + (s.pending ? ` · zapisywanie (${s.pending})` : "") + (s.error ? " · " + s.error : ""))));
    })),
    h("div", { class: "button-row" },
      h("button", { type: "button", class: "btn btn-ghost", onclick: () => { for (const d of Object.values(store)) d.connect(); setTimeout(render, 800); } }, "Połącz ponownie"),
      h("button", { type: "button", class: "btn btn-ghost", onclick: () => location.reload() }, "Przeładuj aplikację")),
    h("p", { class: "hint" }, "Zadania, kalendarz, przepisy i zakupy należą do konta: każde urządzenie zalogowane na to samo konto widzi je na żywo, a inne konto ma swoje, osobne dane. Układ ekranu jest osobny dla każdego urządzenia."));
}

registerView({
  id: "settings",
  title: "Ustawienia",
  mount(s) {
    shell = s;
    for (const doc of Object.values(store)) doc.onStatus(() => { if (shell.isOpen()) render(); });
    auth.onChange(() => { if (shell.isOpen()) render(); });
  },
  onOpen: render,
});
