// Service Worker: pozwala zainstalowac strone jako aplikacje i otworzyc ja
// bez internetu (ostatnia wersja z pamieci). Zawsze najpierw probuje sieci,
// wiec po wgraniu zmian na GitHuba od razu laduje sie nowa wersja.
// Dane z Firebase i API (pogoda, Spotify) nigdy nie sa tu zapamietywane.

const CACHE = "dashboard-v3";

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

  // "Udostepnij" z galerii telefonu (manifest.json -> share_target): zapisujemy
  // pliki w schowku i przekierowujemy do aplikacji, ktora otworzy nowy przepis.
  if (req.method === "POST" && url.origin === self.location.origin && url.pathname.endsWith("/share-target")) {
    event.respondWith((async () => {
      try {
        const form = await req.formData();
        await caches.delete("share-inbox");
        const inbox = await caches.open("share-inbox");
        let i = 0;
        for (const f of form.getAll("images")) {
          if (f && typeof f === "object" && f.size) await inbox.put(new URL(`share-inbox/img-${i++}`, self.registration.scope).href, new Response(f, { headers: { "Content-Type": f.type || "image/jpeg" } }));
        }
        const text = [form.get("title"), form.get("text"), form.get("url")].filter(Boolean).join("\n");
        if (text) await inbox.put(new URL("share-inbox/text", self.registration.scope).href, new Response(text));
      } catch (e) { /* i tak otwieramy aplikacje */ }
      return Response.redirect(new URL("dashboard.html?shared=1", self.registration.scope).href, 303);
    })());
    return;
  }

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
