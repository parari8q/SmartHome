// Karta konfiguracji klucza AI (w generatorze przepisow i w Ustawieniach).

import { h, toast } from "../lib/dom.js";
import { PROVIDERS, saveAiSettings, testKey } from "../lib/ai.js";
import { auth } from "../db.js";

export function aiSetupCard({ current = null, onSaved = () => {}, onCancel = null } = {}) {
  let provider = current?.provider || "gemini";
  const key = h("input", { type: "password", id: "ai-key", autocomplete: "off", spellcheck: "false", placeholder: "Wklej klucz API" });
  const info = h("p", { class: "hint" });
  const link = h("a", { target: "_blank", rel: "noopener" }, "Gdzie wziąć klucz?");
  const choices = h("div", { class: "choices" });
  const status = h("p", { class: "hint", role: "status" });
  const save = h("button", { type: "button", class: "btn btn-primary", id: "ai-save" }, "Sprawdź i zapisz");

  const draw = () => {
    choices.replaceChildren(...Object.entries(PROVIDERS).map(([id, p]) => h("button", {
      type: "button", class: "choice" + (provider === id ? " active" : ""), "aria-pressed": String(provider === id), dataset: { provider: id },
      onclick: () => { provider = id; draw(); },
    }, p.name)));
    info.textContent = PROVIDERS[provider].hint;
    link.href = PROVIDERS[provider].keyUrl;
  };
  save.addEventListener("click", async () => {
    const value = key.value.trim();
    if (!value) { key.focus(); return; }
    save.disabled = true; status.textContent = "Sprawdzam klucz…";
    try {
      await testKey({ provider, key: value });
      const saved = await saveAiSettings({ provider, key: value });
      toast("Klucz zapisany");
      onSaved(saved);
    } catch (err) {
      status.textContent = err.message || "Nie udało się sprawdzić klucza";
      save.disabled = false;
    }
  });
  key.addEventListener("keydown", (e) => { if (e.key === "Enter") save.click(); });
  draw();
  return h("div", { class: "card ai-setup" },
    h("b", {}, "Połącz z AI"),
    h("p", {}, "Generator korzysta z Twojego klucza API. ", auth.uid ? "Klucz zapisze się na Twoim koncie — widzisz go tylko Ty." : "Bez logowania klucz zostaje tylko na tym urządzeniu."),
    choices, info, link, key, status,
    h("div", { class: "button-row" }, save, onCancel ? h("button", { type: "button", class: "btn btn-ghost", onclick: onCancel }, "Anuluj") : null));
}
