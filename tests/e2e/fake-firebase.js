// Atrapa Firebase Realtime Database (REST + strumien SSE) do testow.
// Odwzorowuje to, co ma znaczenie dla aplikacji:
//  * GET z "Accept: text/event-stream" = strumien: najpierw "put" z cala
//    wartoscia, potem "put"/"patch" przy kazdej zmianie (sciezki wzgledne)
//  * PUT / PATCH / DELETE na dowolnej sciezce, null = usuniecie
//  * puste tablice/obiekty i nulle znikaja (jak w prawdziwym Firebase)
// Endpointy testowe: POST /__reset (body = nowa zawartosc), GET /__dump,
// POST /__fail?mode=network|500|off

import http from "node:http";

function clean(v) {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) {
    const out = v.map(clean);
    while (out.length && out[out.length - 1] == null) out.pop();
    return out.length ? out : null;
  }
  if (typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) { const c = clean(val); if (c != null) out[k] = c; }
    return Object.keys(out).length ? out : null;
  }
  return v;
}

const split = (p) => p.split("/").filter(Boolean).map(decodeURIComponent);

function get(root, parts) {
  let cur = root;
  for (const k of parts) { if (cur == null || typeof cur !== "object") return null; cur = cur[k]; }
  return cur ?? null;
}

function set(root, parts, value) {
  if (!parts.length) return clean(value);
  const [k, ...rest] = parts;
  const base = root && typeof root === "object" ? root : {};
  const copy = Array.isArray(base) ? base.slice() : { ...base };
  copy[k] = set(base[k], rest, value);
  return clean(copy);
}

export function startFakeFirebase(port = 0) {
  let data = null;
  let failMode = "off";
  let authRequired = false;
  let readOnly = false; // symulacja blednej reguly ".write" // true = "prywatna baza": tylko tokeny zaczynajace sie od "tok-"
  const listeners = new Set(); // { parts, res }

  const send = (res, event, payload) => res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);

  function notify(writeParts, type, payload) {
    for (const l of listeners) {
      const lp = l.parts;
      const isPrefix = (a, b) => a.length <= b.length && a.every((x, i) => x === b[i]);
      if (isPrefix(lp, writeParts)) {
        const rel = "/" + writeParts.slice(lp.length).join("/");
        send(l.res, type, { path: rel, data: payload });
      } else if (isPrefix(writeParts, lp)) {
        send(l.res, "put", { path: "/", data: get(data, lp) });
      }
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,PUT,PATCH,DELETE,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.writeHead(204).end();

    let body = "";
    for await (const chunk of req) body += chunk;

    if (url.pathname === "/__reset") { data = clean(body ? JSON.parse(body) : null); for (const l of listeners) send(l.res, "put", { path: "/", data: get(data, l.parts) }); return res.end("ok"); }
    if (url.pathname === "/__dump") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify(data)); }
    if (url.pathname === "/__auth") {
      authRequired = url.searchParams.get("required") === "1";
      readOnly = url.searchParams.get("readonly") === "1";
      // jak prawdziwy Firebase: po zmianie regul otwarte strumienie bez prawa odczytu dostaja "cancel"
      if (authRequired) for (const l of [...listeners]) { send(l.res, "cancel", null); l.res.end(); listeners.delete(l); }
      return res.end(String(authRequired));
    }
    if (url.pathname === "/__fail") { failMode = url.searchParams.get("mode") || "off"; return res.end(failMode); }

    if (!url.pathname.endsWith(".json")) return res.writeHead(404).end();
    const parts = split(url.pathname.slice(0, -5));
    if (authRequired && !(url.searchParams.get("auth") || "").startsWith("tok-")) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end('{"error":"Permission denied"}');
    }
    if (readOnly && req.method !== "GET") {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end('{"error":"Permission denied"}');
    }

    if (req.method === "GET" && (req.headers.accept || "").includes("text/event-stream")) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      const l = { parts, res };
      listeners.add(l);
      send(res, "put", { path: "/", data: get(data, parts) });
      const ka = setInterval(() => send(res, "keep-alive", null), 15000);
      req.on("close", () => { clearInterval(ka); listeners.delete(l); });
      return;
    }

    if (req.method !== "GET" && failMode === "network") { req.socket.destroy(); return; }
    if (req.method !== "GET" && failMode === "500") { res.writeHead(500); return res.end('{"error":"boom"}'); }

    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET") return res.end(JSON.stringify(get(data, parts)));
    if (req.method === "PUT") {
      const value = JSON.parse(body);
      data = set(data, parts, value);
      notify(parts, "put", clean(value));
      return res.end(body);
    }
    if (req.method === "DELETE") {
      data = set(data, parts, null);
      notify(parts, "put", null);
      return res.end("null");
    }
    if (req.method === "PATCH") {
      const value = JSON.parse(body);
      for (const [k, v] of Object.entries(value)) data = set(data, [...parts, ...split(k)], v);
      notify(parts, "patch", value);
      return res.end(body);
    }
    res.writeHead(405).end();
  });

  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const port = Number(process.argv[2] || 9199);
  startFakeFirebase(port).then(() => console.log("fake firebase on " + port));
}
