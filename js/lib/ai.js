// Polaczenie z AI (Gemini albo Claude) wprost z przegladarki, kluczem uzytkownika.
// Klucz trzymamy na koncie uzytkownika w bazie (users/<uid>/settings/ai — reguly
// pozwalaja czytac tylko wlascicielowi), a bez logowania tylko na tym urzadzeniu.

import { auth, dbGet, dbPut } from "../db.js";
import { pickGeminiModel, extractJson, AiError } from "../logic/ai-utils.js";

export { AiError };

const LOCAL_KEY = "ai_settings";
const MODEL_CACHE = "ai_gemini_model";

export const PROVIDERS = {
  gemini: { name: "Gemini (Google)", keyUrl: "https://aistudio.google.com/apikey", hint: "Darmowy limit w Google AI Studio wystarcza na codzienne generowanie." },
  claude: { name: "Claude (Anthropic)", keyUrl: "https://console.anthropic.com/settings/keys", hint: "Płatne za użycie — jeden przepis to ułamek grosza do kilku groszy." },
};
const CLAUDE_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5"];

let cached = null;

const settingsPath = () => (auth.uid ? `users/${auth.uid}/settings/ai` : null);

export async function loadAiSettings() {
  if (cached && cached.uid === (auth.uid || null)) return cached.value;
  let value = null;
  const path = settingsPath();
  if (path) { try { value = await dbGet(path); } catch { value = null; } }
  if (!value) { try { value = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null"); } catch { value = null; } }
  value = value && PROVIDERS[value.provider] && typeof value.key === "string" ? { provider: value.provider, key: value.key } : null;
  cached = { uid: auth.uid || null, value };
  return value;
}

export async function saveAiSettings(value) {
  const clean = value && value.key ? { provider: value.provider, key: value.key.trim() } : null;
  const path = settingsPath();
  if (path) await dbPut(path, clean);
  else if (clean) localStorage.setItem(LOCAL_KEY, JSON.stringify(clean));
  if (path || !clean) localStorage.removeItem(LOCAL_KEY);
  localStorage.removeItem(MODEL_CACHE);
  cached = { uid: auth.uid || null, value: clean };
  return clean;
}


function friendly(status, provider, text = "") {
  if (status === 400 && /api[_ ]?key/i.test(text)) return "Klucz API jest nieprawidłowy — sprawdź go w Ustawieniach.";
  if (status === 401 || status === 403) return "Klucz API jest nieprawidłowy albo nie ma uprawnień — sprawdź go w Ustawieniach.";
  if (status === 429) return provider === "gemini" ? "Wyczerpany limit Gemini — spróbuj za chwilę (darmowy limit odnawia się co minutę i co dzień)." : "Za dużo zapytań albo brak środków na koncie Anthropic.";
  if (status >= 500) return "Serwer AI ma chwilowe problemy — spróbuj ponownie.";
  return `AI zwróciło błąd (HTTP ${status}).`;
}

async function geminiModel(key) {
  const c = localStorage.getItem(MODEL_CACHE);
  if (c) { try { const { model, at } = JSON.parse(c); if (Date.now() - at < 86400000) return model; } catch { /* ignore */ } }
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new AiError(friendly(res.status, "gemini", await res.text().catch(() => "")));
  const model = pickGeminiModel((await res.json()).models || []);
  if (!model) throw new AiError("Nie znalazłem modelu Gemini Flash dla tego klucza.");
  localStorage.setItem(MODEL_CACHE, JSON.stringify({ model, at: Date.now() }));
  return model;
}

/** Zapytanie o JSON. schema: JSON Schema (Gemini dostaje go wprost, Claude w opisie). */
export async function generateJson({ provider, key, system, prompt, schema, signal }) {
  if (!key) throw new AiError("Najpierw dodaj klucz API w Ustawieniach.");
  if (provider === "gemini") {
    const model = await geminiModel(key);
    const call = (thinking) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 1, responseMimeType: "application/json", responseSchema: schema,
          // przepis nie wymaga dlugiego "myslenia" modelu — to ono najbardziej wydluza czekanie
          ...(thinking ? { thinkingConfig: { thinkingLevel: "minimal" } } : {}),
        },
      }),
    });
    let res = await call(true);
    if (res.status === 400) {
      const text = await res.clone().text().catch(() => "");
      if (/thinking/i.test(text)) res = await call(false);
    }
    if (!res.ok) {
      if (res.status === 404) localStorage.removeItem(MODEL_CACHE); // model wycofany — nastepnym razem wybierz nowy
      throw new AiError(friendly(res.status, provider, await res.text().catch(() => "")));
    }
    const body = await res.json();
    const text = (body.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    if (!text) throw new AiError(body.promptFeedback?.blockReason ? "AI odmówiło odpowiedzi na to zapytanie — zmień opis." : "AI nie zwróciło odpowiedzi — spróbuj ponownie.");
    return extractJson(text);
  }
  if (provider === "claude") {
    let lastError = null;
    for (const model of CLAUDE_MODELS) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal,
        headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({
          model, max_tokens: 6000, system: system + "\n\nOdpowiedz WYŁĄCZNIE obiektem JSON zgodnym ze schematem (bez komentarzy):\n" + JSON.stringify(schema),
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (res.status === 404) { lastError = new AiError("Model niedostępny"); continue; } // sprobuj nastepnego modelu
      if (!res.ok) throw new AiError(friendly(res.status, provider, await res.text().catch(() => "")));
      const body = await res.json();
      return extractJson((body.content || []).map((c) => c.text || "").join(""));
    }
    throw lastError || new AiError("Brak dostępnego modelu Claude.");
  }
  throw new AiError("Nieznany dostawca AI.");
}

/** Szybki test klucza (bez generowania). */
export async function testKey({ provider, key }) {
  if (provider === "gemini") { localStorage.removeItem(MODEL_CACHE); return geminiModel(key.trim()); }
  const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
    headers: { "x-api-key": key.trim(), "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
  });
  if (!res.ok) throw new AiError(friendly(res.status, provider));
  return "Claude";
}
