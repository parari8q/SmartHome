// Ekran logowania — pokazywany, gdy baza odmowi dostepu (prywatna baza),
// albo recznie z Ustawien. Kazde urzadzenie loguje sie tylko raz.

import { auth, reconnectAll } from "../store.js";
import { h, ICONS } from "../lib/dom.js";

let overlay = null;

export function showLogin({ reason = "" } = {}) {
  if (overlay) return;
  const email = h("input", { type: "email", id: "login-email", placeholder: "E-mail", autocomplete: "username", value: auth.email || "" });
  const password = h("input", { type: "password", id: "login-password", placeholder: "Hasło", autocomplete: "current-password" });
  const error = h("div", { class: "login-error", role: "alert" });
  const button = h("button", { type: "submit", class: "btn btn-primary btn-block", id: "login-submit" }, "Zaloguj");

  const form = h("form", { class: "login-card", onsubmit: async (e) => {
    e.preventDefault();
    if (!email.value.trim() || !password.value) { error.textContent = "Podaj e-mail i hasło."; return; }
    button.disabled = true;
    button.textContent = "Logowanie…";
    error.textContent = "";
    try {
      await auth.signIn(email.value, password.value);
      hideLogin();
      reconnectAll();
    } catch (err) {
      error.textContent = err.message;
      button.disabled = false;
      button.textContent = "Zaloguj";
    }
  } },
    h("span", { class: "login-icon", html: ICONS.lock }),
    h("h2", {}, "Zaloguj się"),
    h("p", { class: "hint" }, reason || "Dane są prywatne. Zaloguj się raz na tym urządzeniu — logowanie zostanie zapamiętane."),
    email, password, error, button,
    h("button", { type: "button", class: "link-btn", onclick: hideLogin }, "Nie teraz"));

  overlay = h("div", { class: "login-backdrop", id: "login" }, form);
  document.body.append(overlay);
  (email.value ? password : email).focus();
}

export function hideLogin() {
  overlay?.remove();
  overlay = null;
}
