// Mikrofon na ekranie glownym: rozpoznawanie mowy (Chrome/Android) i
// wykonanie polecenia (kalendarz / zadanie / zakupy).

import { store } from "../store.js";
import { parseVoiceCommand } from "../logic/voice-parser.js";
import { addTaskToNamedList } from "../logic/todo.js";
import { addEvent } from "../logic/calendar.js";
import { mergeShopping } from "../logic/recipes.js";
import { h, ICONS } from "../lib/dom.js";
import { parseDateKey, uid } from "../lib/util.js";
import { notifyGroup } from "../notify.js";

let recognition = null;
let listening = false;
let bubble, bubbleText, button;
let hideTimer = null;

function show(text, autoHideMs = 0) {
  bubble.hidden = false;
  bubbleText.textContent = text;
  clearTimeout(hideTimer);
  if (autoHideMs) hideTimer = setTimeout(() => { bubble.hidden = true; }, autoHideMs);
}

/** Wykonaj polecenie tekstowe — eksportowane tez do testow. */
export function runCommand(text, now = new Date()) {
  const cmd = parseVoiceCommand(text, now);
  if (cmd.type === "calendar") {
    const eventId = uid("ev_");
    store.calendar.set(cmd.dateKey, addEvent(store.calendar.value, cmd.dateKey, { time: cmd.time, title: cmd.title }, eventId));
    const label = parseDateKey(cmd.dateKey).toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" });
    notifyGroup("calendar", `${cmd.title} — ${label}${cmd.time ? ", " + cmd.time : ""}`, { day: cmd.dateKey, eventId });
    return { cmd, message: `📅 „${cmd.title}” — ${label}${cmd.time ? ", " + cmd.time : ""}` };
  }
  if (cmd.type === "todo") {
    const r = addTaskToNamedList(store.todo.value, cmd.list, cmd.text);
    store.todo.set("", r.lists);
    const lastTask = r.lists.find((l) => l.id === r.listId)?.tasks.at(-1);
    notifyGroup("todo", `${cmd.text} (${cmd.list})`, { listId: r.listId, taskId: lastTask?.id });
    return { cmd, message: `✅ „${cmd.text}” → ${cmd.list}${r.created ? " (nowa lista)" : ""}` };
  }
  if (cmd.type === "shopping") {
    store.shopping.set("", mergeShopping(store.shopping.value, cmd.items.map((text) => ({ text }))));
    for (const t of cmd.items) notifyGroup("shopping", t);
    return { cmd, message: `🛒 Do zakupów: ${cmd.items.join(", ")}` };
  }
  return { cmd, message: `Nie zrozumiałem: „${text}”. Spróbuj np. „dentysta jutro o 15”, „dodaj mleko do zakupów”.` };
}

function start() {
  if (listening) { try { recognition?.stop(); } catch {} return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { show("Rozpoznawanie mowy nie działa w tej przeglądarce (spróbuj Chrome).", 5000); return; }

  let finalText = "";
  recognition = new SR();
  recognition.lang = "pl-PL";
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.onresult = (e) => {
    let t = "";
    for (let i = 0; i < e.results.length; i++) {
      t += e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText = t;
    }
    show(t || "…");
  };
  recognition.onerror = (e) => {
    if (e.error === "not-allowed") show("Brak dostępu do mikrofonu — zezwól w ustawieniach przeglądarki.", 6000);
    else if (e.error !== "aborted" && e.error !== "no-speech") show("Błąd rozpoznawania: " + e.error, 5000);
  };
  recognition.onend = () => {
    listening = false;
    recognition = null;
    button.classList.remove("listening");
    if (finalText) show(runCommand(finalText).message, 8000);
    else show("Nic nie usłyszałem — spróbuj jeszcze raz.", 4000);
  };
  try {
    listening = true;
    button.classList.add("listening");
    show("Słucham…");
    recognition.start();
  } catch (err) {
    listening = false;
    button.classList.remove("listening");
    show("Nie udało się włączyć mikrofonu: " + err.message, 5000);
  }
}

export function mountVoice(container) {
  button = h("button", { type: "button", class: "fab fab-mic", id: "voice-btn", "aria-label": "Polecenie głosowe", title: "Polecenie głosowe", html: ICONS.mic, onclick: start });
  bubbleText = h("span");
  bubble = h("div", { class: "voice-bubble", id: "voice-bubble", hidden: true, role: "status" },
    bubbleText,
    h("button", { type: "button", class: "icon-btn icon-btn-subtle", "aria-label": "Zamknij", html: ICONS.close, onclick: () => { bubble.hidden = true; } }));
  container.append(button, bubble);
}
