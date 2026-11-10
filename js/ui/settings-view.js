// USTAWIENIA — konto, grupa (wspolne dane), powiadomienia, uklad ekranu, synchronizacja.

import { store, auth, currentSpace, onSpaceChange, refreshSpace } from "../store.js";
import * as G from "../groups.js";
import { CATEGORIES, ntfySubscribeLink, sendTestNotification } from "../notify.js";
import { h, clear, ICONS, confirmDialog, promptDialog, toast } from "../lib/dom.js";
import { registerView, openView } from "./router.js";
import { getLayout, setLayout } from "./layout.js";
import { showLogin } from "./login.js";

let shell;
let busy = false;
const NAMES = { todo: "Zadania", calendar: "Kalendarz", recipes: "Przepisy", shopping: "Lista zakupów" };
const CONN = { live: "połączono", connecting: "łączenie…", offline: "brak połączenia", error: "błąd", auth: "brak dostępu" };

async function run(fn, okMessage) {
  if (busy) return;
  busy = true;
  render();
  try {
    await fn();
    if (okMessage) toast(okMessage);
  } catch (err) {
    toast(err.message || "Coś poszło nie tak", 6000);
  } finally {
    busy = false;
    render();
  }
}

function accountSection() {
  return [
    h("div", { class: "section-label" }, "Konto"),
    h("div", { class: "row", id: "account-row" },
      h("span", { class: "row-main" },
        h("span", { class: "row-title" }, auth.isLoggedIn ? auth.email : "Niezalogowano"),
        h("span", { class: "row-sub" }, auth.isLoggedIn ? "Zalogowano na tym urządzeniu" : "Zaloguj się, żeby zobaczyć swoje dane")),
      auth.isLoggedIn
        ? h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => { auth.signOut(); render(); } }, "Wyloguj")
        : h("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => showLogin() }, "Zaloguj")),
  ];
}

function memberWord(n) {
  return n === 1 ? "osoba" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "osoby" : "osób";
}

function groupSection() {
  if (!auth.isLoggedIn) return [];
  const group = G.currentGroup();

  if (!group) {
    return [
      h("div", { class: "section-label" }, "Grupa"),
      h("div", { class: "card", id: "group-none" },
        h("p", {}, "Teraz Twoje dane widzisz tylko Ty. Załóż grupę, żeby dzielić przepisy, zakupy, zadania i kalendarz z innymi osobami, albo dołącz do istniejącej grupy kodem zaproszenia."),
        h("div", { class: "button-row" },
          h("button", { type: "button", class: "btn btn-primary", id: "group-create", disabled: busy, onclick: async () => {
            const name = await promptDialog("Nazwa grupy", { placeholder: "np. Dom", okLabel: "Dalej" });
            if (!name) return;
            const me = await promptDialog("Jak masz się wyświetlać innym?", { value: (auth.email || "").split("@")[0], okLabel: "Załóż grupę" });
            if (!me) return;
            run(async () => { await G.createGroup(name, me); await refreshSpace(); }, "Grupa założona — Twoje dane są teraz w grupie");
          } }, "Załóż grupę"),
          h("button", { type: "button", class: "btn btn-ghost", id: "group-join", disabled: busy, onclick: () => askJoin() }, "Dołącz kodem")),
        busy ? h("p", { class: "hint" }, "Chwileczkę…") : null),
    ];
  }

  const owner = G.isOwner();
  const me = G.myProfile();
  const members = Object.keys(group.members || {});
  return [
    h("div", { class: "section-label" }, "Grupa"),
    h("div", { class: "card", id: "group-card" },
      h("div", { class: "group-head" },
        h("div", {}, h("div", { class: "group-name", id: "group-name" }, group.info.name),
          h("div", { class: "hint" }, `${members.length} ${memberWord(members.length)} · wspólne przepisy, zakupy, zadania i kalendarz`)),
        owner ? h("button", { type: "button", class: "icon-btn icon-btn-subtle", "aria-label": "Zmień nazwę grupy", html: ICONS.edit, onclick: async () => {
          const name = await promptDialog("Nowa nazwa grupy", { value: group.info.name, okLabel: "Zapisz" });
          if (name) run(() => G.renameGroup(name));
        } }) : null),
      h("div", { class: "rows", id: "group-members" }, members.map((uid) => {
        const p = group.profiles?.[uid] || {};
        return h("div", { class: "row member", dataset: { uid } },
          h("span", { class: "avatar" }, (p.name || p.email || "?").charAt(0).toUpperCase()),
          h("span", { class: "row-main" },
            h("span", { class: "row-title" }, (p.name || p.email || "Bez nazwy") + (uid === auth.uid ? " (Ty)" : "")),
            h("span", { class: "row-sub" }, [p.email, uid === group.info.owner ? "założyciel" : ""].filter(Boolean).join(" · "))),
          uid === auth.uid ? h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: async () => {
            const name = await promptDialog("Jak masz się wyświetlać innym?", { value: p.name || "", okLabel: "Zapisz" });
            if (name) run(() => G.updateMyProfile({ name }));
          } }, "Zmień imię")
            : owner ? h("button", { type: "button", class: "icon-btn icon-btn-subtle", "aria-label": "Usuń z grupy", html: ICONS.trash, onclick: async () => {
              if (await confirmDialog(`Usunąć ${p.name || p.email} z grupy? Straci dostęp do wspólnych danych.`)) run(() => G.removeMember(uid));
            } }) : null);
      })),
      h("div", { class: "field-label" }, "Zaproś kogoś"),
      h("div", { class: "invite" },
        h("code", { id: "invite-code" }, G.inviteCode()),
        h("button", { type: "button", class: "btn btn-primary btn-sm", id: "invite-share", onclick: async () => {
          const link = G.inviteLink();
          const text = `Dołącz do grupy „${group.info.name}” w dashboardzie domowym: ${link}`;
          try {
            if (navigator.share) await navigator.share({ title: "Zaproszenie do grupy", text, url: link });
            else { await navigator.clipboard.writeText(link); toast("Link skopiowany — wyślij go komuś"); }
          } catch { /* anulowane */ }
        } }, navigator.share ? "Udostępnij link" : "Kopiuj link")),
      h("p", { class: "hint" }, "Druga osoba musi mieć konto (dodajesz je w Firebase → Authentication → Add user). Loguje się i otwiera link albo wpisuje kod w Ustawienia → Dołącz kodem."),
      owner ? h("button", { type: "button", class: "link-btn", onclick: async () => {
        if (await confirmDialog("Wygenerować nowy kod? Stary przestanie działać (osoby już w grupie zostają).", { okLabel: "Nowy kod", danger: false })) run(() => G.regenerateInvite(), "Nowy kod gotowy");
      } }, "Wygeneruj nowy kod") : null,
      h("button", { type: "button", class: "link-btn btn-danger-text", id: "group-leave", onclick: async () => {
        if (await confirmDialog("Opuścić grupę? Wrócisz do swoich osobistych danych. Dane grupy zostają dla pozostałych osób.", { okLabel: "Opuść" })) {
          run(async () => { await G.leaveGroup(); await refreshSpace(); }, "Opuszczono grupę");
        }
      } }, "Opuść grupę")),

    h("div", { class: "section-label" }, "Powiadomienia na telefon"),
    me ? h("div", { class: "card", id: "notify-card" },
      h("p", {}, "Gdy ktoś z grupy coś doda, dostaniesz powiadomienie przez darmową aplikację ntfy, nawet gdy dashboard jest zamknięty. O swoich zmianach powiadomień nie dostajesz."),
      h("ol", { class: "steps-mini" },
        h("li", {}, "Zainstaluj ntfy: ",
          h("a", { href: "https://play.google.com/store/apps/details?id=io.heckel.ntfy", target: "_blank", rel: "noopener" }, "Android"), " · ",
          h("a", { href: "https://apps.apple.com/app/ntfy/id1625396347", target: "_blank", rel: "noopener" }, "iPhone")),
        h("li", {}, "Na telefonie otwórz te Ustawienia i kliknij ",
          h("a", { class: "btn btn-primary btn-sm", id: "ntfy-subscribe", href: ntfySubscribeLink(me.ntfyTopic) }, "Włącz w ntfy")),
        h("li", {}, "Na iPhonie (albo gdy przycisk nie działa): w ntfy kliknij + i wpisz temat ", h("code", { id: "ntfy-topic" }, me.ntfyTopic))),
      h("div", { class: "field-label" }, "Powiadamiaj mnie o:"),
      h("div", { class: "notify-prefs" }, Object.entries(CATEGORIES).map(([key, c]) =>
        h("label", { class: "check-row row" },
          h("input", { type: "checkbox", dataset: { cat: key }, checked: (me.notify || G.DEFAULT_NOTIFY)[key] !== false,
            onchange: (e) => run(() => G.updateMyProfile({ notify: { ...G.DEFAULT_NOTIFY, ...(me.notify || {}), [key]: e.target.checked } })) }),
          h("span", { class: "row-title" }, c.label)))),
      h("button", { type: "button", class: "btn btn-ghost btn-sm", id: "ntfy-test",
        onclick: () => sendTestNotification(me.ntfyTopic).then(() => toast("Wysłano — sprawdź telefon"), () => toast("Nie udało się wysłać")) }, "Wyślij testowe powiadomienie"))
      : null,
  ];
}

async function askJoin(prefill = "") {
  const code = await promptDialog("Wpisz kod zaproszenia albo wklej link", { value: prefill, placeholder: "np. ab12cd34ef-x7k2m9pq", okLabel: "Dalej" });
  if (!code) return;
  const me = await promptDialog("Jak masz się wyświetlać innym?", { value: (auth.email || "").split("@")[0], okLabel: "Dołącz" });
  if (!me) return;
  await run(async () => { await G.joinGroup(code, me); await refreshSpace(); }, "Dołączono do grupy");
}

/** Otworzono link ?dolacz=KOD — po zalogowaniu pytamy o dolaczenie. */
export function handleInviteLink() {
  const code = new URLSearchParams(location.search).get("dolacz");
  if (code) {
    sessionStorage.setItem("pending_invite", code);
    history.replaceState({}, document.title, location.pathname);
  }
  const tryJoin = () => {
    const pending = sessionStorage.getItem("pending_invite");
    if (!pending) return;
    if (!auth.isLoggedIn) { showLogin({ reason: "Zaloguj się, żeby dołączyć do grupy, do której dostałeś zaproszenie." }); return; }
    sessionStorage.removeItem("pending_invite");
    if (G.currentGroup()) { toast("Należysz już do grupy — najpierw ją opuść (Ustawienia)", 6000); return; }
    openView("settings");
    askJoin(pending);
  };
  auth.onChange(() => setTimeout(tryJoin, 300));
  setTimeout(tryJoin, 800);
}

function render() {
  if (!shell || !shell.isOpen()) return;
  const layout = getLayout();
  const choice = (mode, label) => h("button", {
    type: "button", class: "choice" + (layout === mode ? " active" : ""), "aria-pressed": String(layout === mode),
    onclick: () => { setLayout(mode); render(); },
  }, h("span", { class: "icon", html: ICONS[mode] || ICONS.grid }), label);

  clear(shell.body,
    accountSection(),
    groupSection(),
    h("div", { class: "section-label" }, "Układ ekranu (na tym urządzeniu)"),
    h("div", { class: "choices" }, choice("auto", "Automatycznie"), choice("portrait", "Pionowo"), choice("landscape", "Poziomo")),
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
      h("button", { type: "button", class: "btn btn-ghost", onclick: () => location.reload() }, "Przeładuj aplikację")));
}

registerView({
  id: "settings",
  title: "Ustawienia",
  mount(s) {
    shell = s;
    for (const doc of Object.values(store)) doc.onStatus(() => render());
    auth.onChange(() => render());
    G.onGroupChange(() => render());
    onSpaceChange(() => render());
  },
  onOpen() {
    render();
    if (G.currentGroup()) G.refreshGroup().catch(() => {});
  },
});
