// Minimalny Service Worker — jedyny cel to spelnienie wymagan Chrome
// dotyczacych "instalowalnosci" strony jako prawdziwej, samodzielnej
// aplikacji (WebAPK), zamiast zwyklego skrotu-zakladki.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request).catch(() => new Response("Brak połączenia", { status: 503 }))
  );
});
