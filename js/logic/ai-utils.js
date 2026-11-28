// Pomocnicze funkcje AI bez zaleznosci od przegladarki (testowane w node).

export class AiError extends Error {}

/** Najnowszy model "Flash" dostepny dla klucza (nazwy modeli Gemini czesto sie zmieniaja). */
export function pickGeminiModel(models) {
  const ok = models
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => String(m.name || "").replace(/^models\//, ""))
    .filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/lite|live|tts|image|audio|transcribe|thinking|exp/.test(n));
  const ver = (n) => n.match(/^gemini-([\d.]+)/)[1].split(".").map(Number);
  const score = (n) => { const [a = 0, b = 0] = ver(n); return a * 100 + b - (/preview/.test(n) ? 0.5 : 0) - (n.length > 20 ? 0.1 : 0); };
  return ok.sort((x, y) => score(y) - score(x))[0] || null;
}

/** Wyciaga obiekt JSON z odpowiedzi tekstowej (takze otoczonej ```json ... ```). */
export function extractJson(text) {
  const s = String(text || "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) throw new AiError("AI nie zwróciło przepisu w oczekiwanym formacie — spróbuj ponownie.");
  try { return JSON.parse(s.slice(a, b + 1)); } catch { throw new AiError("AI zwróciło uszkodzoną odpowiedź — spróbuj ponownie."); }
}

