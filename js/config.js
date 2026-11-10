// ==========================================================================
// KONFIGURACJA — jedyne miejsce, ktore zwykle trzeba edytowac.
// ==========================================================================

const testOverrides = (typeof window !== "undefined" && window.__SMARTHOME_TEST__) || {};

export const CONFIG = {
  cityName: "Warszawa",
  latitude: 52.2297,
  longitude: 21.0122,
  weatherRefreshMinutes: 10,
};

// Baza Firebase Realtime Database — wspolna dla komputera i telefonu.
export const FIREBASE_DB_URL = testOverrides.dbUrl ||
  "https://smarthome-cdd0e-default-rtdb.europe-west1.firebasedatabase.app";

// Sciezki w bazie (NIE zmieniac — tam sa Twoje dane).
export const DB_PATHS = {
  todo: "todo_lists",
  supplements: "supplements_log",
  calendar: "calendar_events",
  recipes: "recipes_data",
  shopping: "shopping_list",
};

// Spotify — Redirect URI w panelu developer.spotify.com musi byc DOKLADNIE
// adresem tej strony (np. https://parari8q.github.io/SmartHome/dashboard.html).
export const SPOTIFY_CONFIG = {
  clientId: "f1282342eb5f4bdfaa8dd8b90fc1a62e",
  redirectUri: typeof window !== "undefined" ? window.location.origin + window.location.pathname : "",
  scopes: "user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative user-read-private",
};

// Repozytorium ze zdjeciami-nagrodami (folder "Pieski"). Na GitHub Pages
// wykrywane automatycznie z adresu; to jest wartosc zapasowa.
export const PHOTOS_REPO = { owner: "parari8q", repo: "SmartHome", folder: "Pieski" };

// Skroty w menu, ktore otwieraja zewnetrzna strone.
export const LINK_TILES = [
  { id: "youtube", label: "YouTube", url: "https://m.youtube.com", color: "#e0453f", icon: "youtube" },
];

export const TEST_MODE = !!testOverrides.dbUrl;
