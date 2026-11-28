// USTAWIENIA — konto, grupa (wspolne dane), powiadomienia, uklad ekranu, synchronizacja.

import { store, auth, currentSpace, onSpaceChange, refreshSpace } from "../store.js";
import * as G from "../groups.js";
import { CATEGORIES, ntfySubscribeLink, sendTestNotification, detectPlatform, NTFY_PLAY_URL, NTFY_APPSTORE_URL } from "../notify.js";
import { h, clear, ICONS, confirmDialog, promptDialog, toast } from "../lib/dom.js";
import { registerView, openView } from "./router.js";
import { getLayout, setLayout } from "./layout.js";
import { showLogin } from "./login.js";
import { loadAiSettings, saveAiSettings, PROVIDERS } from "../lib/ai.js";
import { aiSetupCard } from "./ai-setup.js";
import { FIREBASE_DB_URL, FIREBASE_API_KEY } from "../config.js";

let shell;
let busy = false;
let aiEditing = false;
const NAMES = { todo: "Zadania", calendar: "Kalendarz", recipes: "Przepisy", shopping: "Lista zakupów", google: "Kalendarz Google" };
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
      ntfySteps(me.ntfyTopic),
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

function copyButton(text, label = "Kopiuj temat") {
  return h("button", { type: "button", class: "btn btn-ghost btn-sm", id: "ntfy-copy", onclick: async () => {
    try { await navigator.clipboard.writeText(text); toast("Skopiowano — wklej w aplikacji ntfy"); }
    catch { toast("Zaznacz temat i skopiuj ręcznie"); }
  } }, label);
}

/** Instrukcja wlaczenia powiadomien dopasowana do urzadzenia. */
function ntfySteps(topic) {
  const platform = detectPlatform();
  const topicBox = h("div", { class: "invite" }, h("code", { id: "ntfy-topic" }, topic), copyButton(topic));
  const manual = h("li", {}, "Albo ręcznie: w ntfy kliknij ", h("b", {}, "+"), ", wklej temat i kliknij ", h("b", {}, "Subscribe"), " (serwer zostaw domyślny ntfy.sh).", topicBox);

  if (platform === "android") {
    return h("ol", { class: "steps-mini", id: "ntfy-steps", dataset: { platform } },
      h("li", {}, "Zainstaluj ", h("a", { href: NTFY_PLAY_URL, target: "_blank", rel: "noopener" }, "ntfy ze sklepu Play"), "."),
      h("li", {}, "Kliknij ", h("a", { class: "btn btn-primary btn-sm", id: "ntfy-subscribe", href: ntfySubscribeLink(topic, platform) }, "Włącz w ntfy"),
        " — otworzy się aplikacja ntfy z gotowym tematem."),
      manual);
  }
  if (platform === "ios") {
    return h("ol", { class: "steps-mini", id: "ntfy-steps", dataset: { platform } },
      h("li", {}, "Zainstaluj ", h("a", { href: NTFY_APPSTORE_URL, target: "_blank", rel: "noopener" }, "ntfy z App Store"), " i zezwól na powiadomienia."),
      h("li", {}, "W ntfy kliknij ", h("b", {}, "+"), ", wklej temat i kliknij ", h("b", {}, "Subscribe"), ":", topicBox));
  }
  return h("ol", { class: "steps-mini", id: "ntfy-steps", dataset: { platform } },
    h("li", {}, "Zainstaluj na telefonie ntfy: ",
      h("a", { href: NTFY_PLAY_URL, target: "_blank", rel: "noopener" }, "Android"), " · ",
      h("a", { href: NTFY_APPSTORE_URL, target: "_blank", rel: "noopener" }, "iPhone"), "."),
    h("li", {}, "Najprościej: otwórz dashboard ", h("b", {}, "na telefonie"), " → Ustawienia → „Włącz w ntfy”."),
    h("li", {}, "Albo w aplikacji ntfy kliknij ", h("b", {}, "+"), ", wpisz ten temat i kliknij ", h("b", {}, "Subscribe"), ":", topicBox));
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

let aiBox = null;
function aiSection() {
  // odswiezenia statusu nie moga kasowac wpisywanego klucza
  if (aiBox && (aiBox.contains(document.activeElement) || aiBox.querySelector("#ai-key")?.value)) return aiBox;
  const box = aiBox = h("div", { class: "ai-section" }, h("div", { class: "empty" }, "Wczytywanie…"));
  loadAiSettings().then((ai) => {
    if (!ai || aiEditing) {
      box.replaceChildren(aiSetupCard({ current: ai, onSaved: () => { aiEditing = false; aiBox = null; render(); }, onCancel: ai ? () => { aiEditing = false; aiBox = null; render(); } : null }));
      return;
    }
    box.replaceChildren(h("div", { class: "card" },
      h("p", {}, `Połączono: ${PROVIDERS[ai.provider].name} · klucz •••• ${ai.key.slice(-4)}`),
      h("div", { class: "button-row" },
        h("button", { type: "button", class: "btn btn-ghost btn-sm", id: "ai-change", onclick: () => { aiEditing = true; aiBox = null; render(); } }, "Zmień klucz"),
        h("button", { type: "button", class: "btn btn-ghost btn-sm", id: "ai-remove", onclick: async () => {
          if (!(await confirmDialog("Usunąć klucz AI? Generator przepisów przestanie działać, dopóki nie dodasz nowego."))) return;
          aiBox = null;
          await run(() => saveAiSettings(null), "Klucz usunięty");
        } }, "Usuń klucz"))));
  });
  return box;
}

/** Konfiguracja dla skryptu Google Apps Script (zawiera token logowania — jak haslo). */
export function googleSyncConfig() {
  const space = currentSpace();
  const g = G.currentGroup();
  const name = g?.profiles?.[auth.uid]?.name || (auth.email || "").split("@")[0];
  return JSON.stringify({ apiKey: FIREBASE_API_KEY, dbUrl: FIREBASE_DB_URL, refreshToken: auth.session?.refreshToken || "", uid: auth.uid, base: space.base, gid: space.gid || null, name });
}

function syncAgo(ts) {
  if (!ts) return "jeszcze nie było";
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return "przed chwilą";
  if (min < 60) return `${min} min temu`;
  const d = new Date(ts);
  return d.toLocaleString("pl-PL", { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

function googleSection() {
  if (!auth.uid) return h("div", { class: "card" }, h("p", {}, "Zaloguj się, żeby połączyć kalendarz z Kalendarzem Google."));
  const mirror = store.google.value || {};
  const g = G.currentGroup();
  const who = Object.keys(mirror).map((uid) => `${uid === auth.uid ? "Ty" : mirror[uid].name || g?.profiles?.[uid]?.name || "Ktoś z grupy"}: ${syncAgo(mirror[uid].updatedAt)}`);
  const copy = (text, msg) => async () => {
    try { await navigator.clipboard.writeText(text); toast(msg); }
    catch { await promptDialog("Skopiuj ręcznie (Ctrl+C):", { value: text }); }
  };
  return h("div", { class: "card google-sync" },
    h("p", {}, "Wydarzenia całej grupy trafiają do kalendarza „SmartHome” w Twoim Google (kolor = osoba), a wydarzenia z Twojego Kalendarza Google pokazują się tutaj. Działa samo co 10 minut przez mały skrypt na Twoim koncie Google — także gdy aplikacja jest zamknięta."),
    h("ol", { class: "steps-mini" },
      h("li", {}, "Kliknij „Skopiuj kod skryptu”, otwórz ", h("a", { href: "https://script.google.com/home/projects/create", target: "_blank", rel: "noopener" }, "script.google.com → Nowy projekt"), ", usuń, co tam jest, i wklej kod."),
      h("li", {}, "Kliknij „Skopiuj konfigurację” i wklej ją w skrypcie zamiast WKLEJ_TUTAJ (między apostrofy). Zapisz (Ctrl+S)."),
      h("li", {}, "Na górze wybierz funkcję „instaluj”, kliknij „Uruchom” i zgódź się na dostęp do kalendarza (przy „Aplikacja nie została zweryfikowana” wybierz „Zaawansowane” → „Przejdź do projektu”).")),
    h("div", { class: "button-row" },
      h("button", { type: "button", class: "btn btn-ghost btn-sm", id: "google-copy-code", onclick: async () => {
        try {
          const code = await (await fetch("tools/google-calendar-sync.gs", { cache: "no-store" })).text();
          await copy(code, "Kod skryptu skopiowany")();
        } catch { toast("Nie udało się pobrać kodu — spróbuj ponownie"); }
      } }, "Skopiuj kod skryptu"),
      h("button", { type: "button", class: "btn btn-primary btn-sm", id: "google-copy-config", onclick: copy(googleSyncConfig(), "Konfiguracja skopiowana — wklej ją w skrypcie") }, "Skopiuj konfigurację")),
    h("p", { class: "hint" }, "Konfiguracja zawiera Twój klucz logowania do aplikacji — nie wysyłaj jej nikomu. Po zmianie grupy skopiuj ją jeszcze raz."),
    who.length ? h("p", { class: "hint", id: "google-status" }, "Ostatnia synchronizacja — " + who.join(" · ")) : null);
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
    h("div", { class: "section-label" }, "Kalendarz Google"),
    googleSection(),
    h("div", { class: "section-label" }, "Generator przepisów (AI)"),
    aiSection(),
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
