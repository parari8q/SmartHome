import { expect } from "@playwright/test";

export const DB = "http://127.0.0.1:9199";
// wtorek 10 listopada 2026, 14:30 (dzien zelaza)
export const NOW = new Date("2026-11-10T14:30:00+01:00");

export async function resetDb(request, data = null) {
  await request.post(DB + "/__reset", { data: JSON.stringify(data), headers: { "Content-Type": "application/json" } });
  await request.post(DB + "/__fail?mode=off");
}

export async function dumpDb(request) {
  return (await request.get(DB + "/__dump")).json();
}

export const WEATHER = {
  current: { time: "2026-11-10T14:15", temperature_2m: 7.6, apparent_temperature: 4.4, relative_humidity_2m: 81, weather_code: 61, wind_speed_10m: 12.4, is_day: 1 },
  hourly: {
    time: Array.from({ length: 48 }, (_, i) => `2026-11-${i < 24 ? 10 : 11}T${String(i % 24).padStart(2, "0")}:00`),
    temperature_2m: Array.from({ length: 48 }, (_, i) => 5 + (i % 7)),
    weather_code: Array.from({ length: 48 }, (_, i) => [0, 2, 3, 61, 71, 95][i % 6]),
    precipitation_probability: Array.from({ length: 48 }, (_, i) => (i * 7) % 100),
  },
  daily: { sunrise: ["2026-11-10T06:58"], sunset: ["2026-11-10T16:04"], temperature_2m_max: [8.4], temperature_2m_min: [2.2] },
};

/** Otwiera dashboard w trybie testowym (atrapa Firebase, sztuczna pogoda, stala data). */
export async function openApp(page, { spotifyTokens = null, weatherFail = false } = {}) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });

  await page.clock.setFixedTime(NOW);
  await page.addInitScript(({ db, tokens }) => {
    window.__SMARTHOME_TEST__ = { dbUrl: db };
    if (tokens) localStorage.setItem("spotify_tokens", JSON.stringify(tokens));
  }, { db: DB, tokens: spotifyTokens });

  await page.route(/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com/, (r) => r.abort());
  await page.route(/api\.open-meteo\.com/, (r) => (weatherFail ? r.fulfill({ status: 500 }) : r.fulfill({ json: WEATHER })));
  await page.route(/api\.github\.com/, (r) => r.fulfill({ json: [{ type: "file", name: "chihuahua1.jpg", download_url: "/Pieski/chihuahua1.jpg" }] }));

  await page.goto("/dashboard.html");
  await expect(page.locator("#sync")).toHaveAttribute("data-status", "live");
  return errors;
}

export async function openFromMenu(page, label) {
  // najpierw wroc do ekranu glownego (jak uzytkownik przyciskiem "wstecz")
  for (let i = 0; i < 6 && (await page.locator(".view.open").count()); i++) {
    await page.locator(".view.open .view-back").click();
  }
  await page.locator("#menu-btn").click();
  await page.locator(".menu .tile", { hasText: label }).click();
}

export const view = (page, id) => page.locator("#view-" + id);
