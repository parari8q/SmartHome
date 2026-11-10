// Start aplikacji.

import { connectAll, onSyncStatus } from "./store.js";
import { installGestures, openMenu, closeMenu, openView } from "./ui/router.js";
import { initLayout } from "./ui/layout.js";
import { initHome, setSyncStatus } from "./ui/home.js";
import { renderMenu } from "./ui/menu.js";
import { mountVoice } from "./ui/voice.js";
import { handleSpotifyRedirect } from "./ui/spotify-view.js";
import { TEST_MODE } from "./config.js";
import "./ui/todo-view.js";
import "./ui/calendar-view.js";
import "./ui/supplements-view.js";
import "./ui/recipes-view.js";
import "./ui/settings-view.js";

initLayout();
renderMenu();
installGestures();
mountVoice(document.getElementById("home"));
document.getElementById("menu-btn").addEventListener("click", openMenu);
document.getElementById("menu-close").addEventListener("click", closeMenu);
document.getElementById("sync").addEventListener("click", () => openView("settings"));

onSyncStatus((status) => setSyncStatus(status));
connectAll();
initHome();

handleSpotifyRedirect().then((loggedIn) => { if (loggedIn) openView("spotify"); });

// --- ekran zawsze wlaczony (tablet/telefon jako ramka na scianie) ---
async function keepAwake() {
  try { if ("wakeLock" in navigator && document.visibilityState === "visible") await navigator.wakeLock.request("screen"); } catch {}
}
keepAwake();
document.addEventListener("visibilitychange", keepAwake);

// --- pelny ekran przy pierwszym dotknieciu (chowa pasek Androida) ---
function fullscreenOnce(e) {
  document.removeEventListener("pointerdown", fullscreenOnce);
  if (TEST_MODE || document.fullscreenElement || !matchMedia("(pointer: coarse)").matches) return;
  if (e.target.closest("a")) return;
  const el = document.documentElement;
  (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.catch?.(() => {});
}
document.addEventListener("pointerdown", fullscreenOnce);

if ("serviceWorker" in navigator && !TEST_MODE) {
  navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Service Worker:", err));
}

window.__app = { openView };
