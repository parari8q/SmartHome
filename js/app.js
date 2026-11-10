// Start aplikacji.

import { connectAll, onSyncStatus, onAuthRequired } from "./store.js";
import { showLogin } from "./ui/login.js";
import { installGestures, openMenu, closeMenu, openView } from "./ui/router.js";
import { initLayout } from "./ui/layout.js";
import { initHome, setSyncStatus } from "./ui/home.js";
import { renderMenu } from "./ui/menu.js";
import { mountVoice } from "./ui/voice.js";
import { TEST_MODE } from "./config.js";
import { importIntoNewRecipe } from "./ui/recipes-view.js";
import "./ui/todo-view.js";
import "./ui/calendar-view.js";
import "./ui/recipes-view.js";
import { handleInviteLink } from "./ui/settings-view.js";

initLayout();
renderMenu();
installGestures();
mountVoice(document.getElementById("home"));
document.getElementById("menu-btn").addEventListener("click", openMenu);
document.getElementById("menu-close").addEventListener("click", closeMenu);
document.getElementById("sync").addEventListener("click", () => openView("settings"));

onSyncStatus((status) => setSyncStatus(status));
onAuthRequired(() => showLogin());
connectAll();
initHome();


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

// --- "Udostepnij" z galerii telefonu -> nowy przepis (zainstalowana aplikacja na Androidzie) ---
async function handleSharedFiles() {
  if (!new URLSearchParams(location.search).has("shared")) return;
  history.replaceState({}, document.title, location.pathname);
  try {
    const cache = await caches.open("share-inbox");
    const files = [];
    let text = "";
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      if (new URL(req.url).pathname.endsWith("/text")) text = await res.text();
      else { const blob = await res.blob(); files.push(new File([blob], "udostepnione", { type: blob.type || "image/jpeg" })); }
    }
    await caches.delete("share-inbox");
    if (files.length || text.trim()) {
      importIntoNewRecipe({ files, text });
      openView("recipes", "form");
    }
  } catch (err) {
    console.warn("Udostępnione pliki:", err);
  }
}
handleSharedFiles();
handleInviteLink();

window.__app = { openView };
