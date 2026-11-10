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

// Klucz Web API projektu Firebase (do logowania). To publiczny identyfikator,
// nie haslo — bezpieczenstwo zapewniaja reguly bazy (patrz README).
export const FIREBASE_API_KEY = testOverrides.apiKey || "AIzaSyDPdkQ1DXOwXW2R5c2FIMiwEmHujrXuCkU";

// Sciezki w bazie (NIE zmieniac — tam sa Twoje dane).
export const DB_PATHS = {
  todo: "todo_lists",
  calendar: "calendar_events",
  recipes: "recipes_data",
  shopping: "shopping_list",
};

export const TEST_MODE = !!testOverrides.dbUrl;
