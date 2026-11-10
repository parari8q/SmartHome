// SPOTIFY — logowanie PKCE (bez sekretu w kodzie) i sterowanie przez Web API.
// Sterowanie wymaga konta Premium i aktywnego urzadzenia w aplikacji Spotify.
// Logowanie jest per urzadzenie (tokeny w localStorage).

import { SPOTIFY_CONFIG } from "../config.js";
import { h, clear, ICONS, iconButton, emptyState } from "../lib/dom.js";
import { registerView } from "./router.js";

const API = "https://api.spotify.com/v1";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

let shell;
let pollTimer = null;
let isPlaying = false;
let mode = "player"; // player | browse
let browseBack = null;
let market = null;
let searchDebounce = null;
let volumeDebounce = null;
const els = {};

// ----- tokeny ---------------------------------------------------------------

function getTokens() {
  try { return JSON.parse(localStorage.getItem("spotify_tokens") || "null"); } catch { return null; }
}

function saveTokens(data) {
  const existing = getTokens() || {};
  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || existing.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  localStorage.setItem("spotify_tokens", JSON.stringify(tokens));
  return tokens;
}

function randomString(len) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(len)), (v) => chars[v % chars.length]).join("");
}

async function sha256base64url(plain) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(plain));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function startLogin() {
  const verifier = randomString(64);
  localStorage.setItem("spotify_verifier", verifier);
  const params = new URLSearchParams({
    client_id: SPOTIFY_CONFIG.clientId,
    response_type: "code",
    redirect_uri: SPOTIFY_CONFIG.redirectUri,
    scope: SPOTIFY_CONFIG.scopes,
    code_challenge_method: "S256",
    code_challenge: await sha256base64url(verifier),
  });
  location.href = "https://accounts.spotify.com/authorize?" + params;
}

/** Powrot ze strony logowania Spotify (?code=...). Zwraca true, jesli zalogowano. */
export async function handleSpotifyRedirect() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  if (!code && !params.get("error")) return false;
  history.replaceState({}, document.title, SPOTIFY_CONFIG.redirectUri);
  if (!code) return false;
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: SPOTIFY_CONFIG.clientId, grant_type: "authorization_code", code,
        redirect_uri: SPOTIFY_CONFIG.redirectUri, code_verifier: localStorage.getItem("spotify_verifier") || "",
      }),
    });
    const data = await res.json();
    if (data.access_token) { saveTokens(data); return true; }
  } catch (err) {
    console.error("Błąd logowania Spotify:", err);
  }
  return false;
}

let refreshing = null;
async function ensureToken() {
  const tokens = getTokens();
  if (!tokens) return null;
  if (Date.now() < tokens.expires_at - 60000) return tokens.access_token;
  if (!refreshing) {
    refreshing = fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: SPOTIFY_CONFIG.clientId, grant_type: "refresh_token", refresh_token: tokens.refresh_token }),
    }).then((r) => r.json()).then((data) => (data.access_token ? saveTokens(data).access_token : null))
      .catch(() => null).finally(() => { refreshing = null; });
  }
  return refreshing;
}

async function api(path, options = {}) {
  const token = await ensureToken();
  if (!token) throw new Error("brak-logowania");
  return fetch(API + path, { ...options, headers: { ...(options.headers || {}), Authorization: "Bearer " + token } });
}

async function apiOk(path, options) {
  const res = await api(path, options);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 404 && /NO_ACTIVE_DEVICE/.test(body)) throw new Error("Brak aktywnego urządzenia — włącz Spotify na telefonie/komputerze.");
    if (res.status === 403) throw new Error("Sterowanie wymaga Spotify Premium.");
    throw new Error("HTTP " + res.status);
  }
  return res;
}

function setStatus(t) { shell.setStatus(t || ""); }

// ----- odtwarzacz ---------------------------------------------------------

async function refreshNowPlaying() {
  try {
    const res = await api("/me/player");
    if (res.status === 204) {
      setStatus("Nic teraz nie gra. Włącz coś w aplikacji Spotify na dowolnym urządzeniu.");
      showTrack(null);
      return;
    }
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (!data || !data.item) return;
    if (data.device && typeof data.device.volume_percent === "number" && document.activeElement !== els.volume) {
      els.volume.value = data.device.volume_percent;
    }
    isPlaying = data.is_playing;
    showTrack(data.item, data.device);
    setStatus("");
  } catch (err) {
    if (err.message === "brak-logowania") return renderLoggedOut();
    setStatus("Nie udało się pobrać danych ze Spotify.");
  }
}

function showTrack(item, device) {
  els.track.textContent = item ? item.name : "—";
  els.artist.textContent = item ? (item.artists ? item.artists.map((a) => a.name).join(", ") : item.show?.name || "") : "—";
  els.device.textContent = device ? "▸ " + device.name : "";
  const art = item && ((item.album?.images || [])[0] || (item.images || [])[0]);
  if (art) { els.art.src = art.url; els.art.hidden = false; } else { els.art.removeAttribute("src"); els.art.hidden = true; }
  els.playpause.innerHTML = isPlaying ? ICONS.pause : ICONS.play;
  els.playpause.setAttribute("aria-label", isPlaying ? "Pauza" : "Odtwórz");
}

async function control(path, method, after = 500) {
  try {
    await apiOk(path, { method });
    setTimeout(refreshNowPlaying, after);
  } catch (err) {
    setStatus("Nie udało się: " + err.message);
  }
}

async function play(body) {
  try {
    await apiOk("/me/player/play", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    showPlayer();
    setTimeout(refreshNowPlaying, 600);
  } catch (err) {
    setStatus("Nie udało się odtworzyć: " + err.message);
  }
}

// ----- przegladanie ---------------------------------------------------------

const imgOf = (images, smallest = true) => (images && images.length ? images[smallest ? images.length - 1 : 0].url : "");

function row(title, subtitle, img, onClick) {
  return h("button", { type: "button", class: "row row-link media-row", onclick: onClick },
    img ? h("img", { class: "thumb", src: img, alt: "", loading: "lazy" }) : h("span", { class: "thumb thumb-empty" }),
    h("span", { class: "row-main" }, h("span", { class: "row-title" }, title), subtitle ? h("span", { class: "row-sub" }, subtitle) : null));
}

function results(...nodes) { clear(els.results, ...nodes); }
const loading = () => results(emptyState("Ładowanie…"));

function recentItems() {
  try { return JSON.parse(localStorage.getItem("spotify_recent_items") || "[]"); } catch { return []; }
}
function remember(item) {
  const items = [item, ...recentItems().filter((i) => !(i.kind === item.kind && i.id === item.id))].slice(0, 12);
  localStorage.setItem("spotify_recent_items", JSON.stringify(items));
}

function showHistory() {
  els.browseTitle.textContent = "Ostatnie";
  browseBack = null;
  const items = recentItems();
  results(
    h("button", { type: "button", class: "row row-link", onclick: showPlaylists }, h("span", { class: "row-title" }, "Twoje playlisty"), h("span", { class: "icon chev", html: ICONS.next })),
    items.length ? items.map((it) => row(it.name, it.subtitle, it.image, () => openRecent(it))) : emptyState("Wpisz, czego szukasz — utwór, wykonawcę albo album."),
    items.length ? h("button", { type: "button", class: "link-btn", onclick: () => { localStorage.removeItem("spotify_recent_items"); showHistory(); } }, "Wyczyść historię") : null);
}

function openRecent(it) {
  if (it.kind === "track") play({ uris: [it.uri] });
  else if (it.kind === "artist") showArtist({ id: it.id, name: it.name, images: it.image ? [{ url: it.image }] : [] });
  else if (it.kind === "album") showAlbum({ id: it.id, name: it.name, uri: it.uri, artists: [{ name: it.subtitle }], images: it.image ? [{ url: it.image }] : [] });
  else if (it.kind === "playlist") showPlaylist({ id: it.id, name: it.name, uri: it.uri, images: it.image ? [{ url: it.image }] : [] });
}

const playTrack = (t) => { remember({ kind: "track", id: t.id, uri: t.uri, name: t.name, subtitle: (t.artists || []).map((a) => a.name).join(", "), image: imgOf(t.album?.images) }); play({ uris: [t.uri] }); };

async function guarded(title, back, fn) {
  els.browseTitle.textContent = title;
  browseBack = back;
  loading();
  try { await fn(); } catch (err) { results(emptyState("Coś poszło nie tak (" + err.message + ").")); }
}

function showPlaylists() {
  return guarded("Twoje playlisty", showHistory, async () => {
    const data = await (await apiOk("/me/playlists?limit=50")).json();
    const items = (data.items || []).filter(Boolean);
    results(items.length ? items.map((pl) => row(pl.name, "Playlista", imgOf(pl.images, false), () => { browseBack = showPlaylists; showPlaylist(pl); })) : emptyState("Nie masz jeszcze playlist."));
  });
}

function showPlaylist(pl) {
  const back = browseBack || showHistory;
  return guarded(pl.name, back, async () => {
    remember({ kind: "playlist", id: pl.id, uri: pl.uri, name: pl.name, subtitle: "Playlista", image: imgOf(pl.images, false) });
    const data = await (await apiOk(`/playlists/${pl.id}/tracks?limit=50`)).json();
    results(row("▶  Odtwórz całą playlistę", "", imgOf(pl.images, false), () => play({ context_uri: pl.uri })),
      (data.items || []).filter((i) => i && i.track).map((i) => row(i.track.name, (i.track.artists || []).map((a) => a.name).join(", "), imgOf(i.track.album?.images), () => playTrack(i.track))));
  });
}

function showAlbum(al) {
  const back = browseBack || showHistory;
  return guarded(al.name, back, async () => {
    remember({ kind: "album", id: al.id, uri: al.uri, name: al.name, subtitle: (al.artists || []).map((a) => a.name).join(", "), image: imgOf(al.images) });
    const data = await (await apiOk(`/albums/${al.id}/tracks?limit=50`)).json();
    results(row("▶  Odtwórz cały album", (al.artists || []).map((a) => a.name).join(", "), imgOf(al.images, false), () => play({ context_uri: al.uri })),
      (data.items || []).map((t) => row(t.name, (t.artists || []).map((a) => a.name).join(", "), imgOf(al.images), () => playTrack({ ...t, album: al }))));
  });
}

function showArtist(ar) {
  const back = browseBack || showHistory;
  return guarded(ar.name, back, async () => {
    remember({ kind: "artist", id: ar.id, name: ar.name, subtitle: "Wykonawca", image: imgOf(ar.images) });
    if (!market) {
      try { market = (await (await api("/me")).json()).country || "PL"; } catch { market = "PL"; }
    }
    const data = await (await apiOk(`/artists/${ar.id}/top-tracks?market=${market}`)).json();
    results(h("div", { class: "section-label" }, "Najpopularniejsze"),
      (data.tracks || []).map((t) => row(t.name, t.album?.name || "", imgOf(t.album?.images), () => playTrack(t))));
  });
}

function search(q) {
  const again = () => { els.search.value = q; search(q); };
  const via = (fn) => (x) => { browseBack = again; fn(x); };
  return guarded("Wyniki: " + q, showHistory, async () => {
    const data = await (await apiOk("/search?type=track,artist,album,playlist&limit=6&q=" + encodeURIComponent(q))).json();
    const list = (k) => ((data[k] && data[k].items) || []).filter(Boolean);
    const [tracks, artists, albums, playlists] = ["tracks", "artists", "albums", "playlists"].map(list);
    if (!tracks.length && !artists.length && !albums.length && !playlists.length) return results(emptyState("Brak wyników."));
    results(
      tracks.length ? [h("div", { class: "section-label" }, "Utwory"), tracks.map((t) => row(t.name, t.artists.map((a) => a.name).join(", "), imgOf(t.album?.images), () => playTrack(t)))] : null,
      artists.length ? [h("div", { class: "section-label" }, "Wykonawcy"), artists.map((a) => row(a.name, "Wykonawca", imgOf(a.images), () => via(showArtist)(a)))] : null,
      albums.length ? [h("div", { class: "section-label" }, "Albumy"), albums.map((a) => row(a.name, a.artists.map((x) => x.name).join(", "), imgOf(a.images), () => via(showAlbum)(a)))] : null,
      playlists.length ? [h("div", { class: "section-label" }, "Playlisty"), playlists.map((p) => row(p.name, p.owner?.display_name || "", imgOf(p.images, false), () => via(showPlaylist)(p)))] : null);
  });
}

// ----- widok ------------------------------------------------------------------

function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

function renderLoggedOut() {
  stopPolling();
  shell.setActions();
  clear(shell.body, h("div", { class: "center-stack" },
    h("span", { class: "big-icon", html: ICONS.spotify }),
    h("button", { type: "button", class: "btn btn-primary", id: "spotify-login", onclick: startLogin }, "Zaloguj się do Spotify"),
    h("p", { class: "hint" }, "Redirect URI tej strony: " + SPOTIFY_CONFIG.redirectUri)));
}

function showPlayer() {
  mode = "player";
  els.player.hidden = false;
  els.browse.hidden = true;
  shell.setTitle("Spotify");
}

function showBrowse() {
  mode = "browse";
  els.player.hidden = true;
  els.browse.hidden = false;
  shell.setTitle("Szukaj");
  els.search.value = "";
  showHistory();
  els.search.focus();
}

function renderLoggedIn() {
  els.art = h("img", { class: "album-art", alt: "", hidden: true });
  els.track = h("div", { class: "track-name" }, "—");
  els.artist = h("div", { class: "track-artist" }, "—");
  els.device = h("div", { class: "hint" });
  els.playpause = h("button", { type: "button", class: "round-btn round-btn-lg", "aria-label": "Odtwórz", html: ICONS.play,
    onclick: () => control(isPlaying ? "/me/player/pause" : "/me/player/play", "PUT", 400) });
  els.volume = h("input", { type: "range", min: 0, max: 100, value: 50, "aria-label": "Głośność", "data-no-swipe": "",
    oninput: (e) => {
      clearTimeout(volumeDebounce);
      const v = e.target.value;
      volumeDebounce = setTimeout(() => control(`/me/player/volume?volume_percent=${v}`, "PUT", 800), 300);
    } });
  els.player = h("div", { class: "player" },
    els.art, els.track, els.artist,
    h("div", { class: "controls" },
      h("button", { type: "button", class: "round-btn", "aria-label": "Poprzedni", html: ICONS.prev, onclick: () => control("/me/player/previous", "POST") }),
      els.playpause,
      h("button", { type: "button", class: "round-btn", "aria-label": "Następny", html: ICONS.skip, onclick: () => control("/me/player/next", "POST") })),
    h("div", { class: "volume" }, h("span", { class: "icon", html: ICONS.volume }), els.volume),
    els.device,
    h("button", { type: "button", class: "link-btn", onclick: () => {
      localStorage.removeItem("spotify_tokens");
      localStorage.removeItem("spotify_verifier");
      renderLoggedOut();
    } }, "Wyloguj"));

  els.browseTitle = h("div", { class: "section-label" });
  els.search = h("input", { type: "search", placeholder: "Szukaj utworu, wykonawcy, albumu…", autocomplete: "off",
    oninput: () => {
      clearTimeout(searchDebounce);
      const q = els.search.value.trim();
      if (!q) return showHistory();
      searchDebounce = setTimeout(() => search(q), 400);
    } });
  els.results = h("div", { class: "rows" });
  els.browse = h("div", { class: "browse", hidden: true }, els.search, els.browseTitle, els.results);

  clear(shell.body, els.player, els.browse);
  shell.setActions(iconButton("search", "Szukaj", showBrowse));
  showPlayer();
  refreshNowPlaying();
  stopPolling();
  pollTimer = setInterval(refreshNowPlaying, 10000);
}

registerView({
  id: "spotify",
  title: "Spotify",
  mount(s) { shell = s; },
  onOpen() {
    setStatus("");
    getTokens() ? renderLoggedIn() : renderLoggedOut();
  },
  onClose() { stopPolling(); },
  back() {
    if (mode === "browse" && getTokens()) {
      if (browseBack) { const fn = browseBack; browseBack = null; fn(); return true; }
      showPlayer();
      return true;
    }
    return false;
  },
});
