// Service Worker: pozwala zainstalowac strone jako aplikacje i otworzyc ja
// bez internetu (ostatnia wersja z pamieci). Zawsze najpierw probuje sieci,
// wiec po wgraniu zmian na GitHuba od razu laduje sie nowa wersja.
// Dane z Firebase i API (pogoda, Spotify) nigdy nie sa tu zapamietywane.

const CACHE = "dashboard-v2";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return; // tylko pliki tej strony

  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch {
      const cached = await caches.match(req, { ignoreSearch: req.mode === "navigate" });
      return cached || new Response("Brak połączenia", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  })());
});
