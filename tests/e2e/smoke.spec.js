import { test, expect } from "@playwright/test";
import { openApp, resetDb, openFromMenu, view } from "./helpers.js";

test.beforeEach(async ({ request }) => { await resetDb(request); });

test("strona startuje bez błędów, pokazuje zegar, pogodę i status synchronizacji", async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.locator("#clock")).toHaveText("14:30");
  await expect(page.locator("#date")).toHaveText("Wtorek, 10 listopada");
  await expect(page.locator("#temp")).toHaveText("8");
  await expect(page.locator("#condition")).toHaveText("Lekki deszcz");
  await expect(page.locator("#stat-feels")).toHaveText("4°");
  await expect(page.locator("#stat-sun")).toHaveText("16:04");
  await expect(page.locator("#hourly .hour")).toHaveCount(6);
  await expect(page.locator("#hourly .h-time").first()).toHaveText("15:00");
  await expect(page.locator("#sync")).toHaveAttribute("data-status", "live");
  expect(errors).toEqual([]);
});

test("błąd pogody pokazuje komunikat, ale reszta działa", async ({ page }) => {
  await openApp(page, { weatherFail: true });
  await expect(page.locator("#weather-error")).toBeVisible();
  await openFromMenu(page, "Zadania");
  await expect(view(page, "todo")).toBeVisible();
});

test("menu: wszystkie kafelki otwierają właściwe widoki, wstecz wraca", async ({ page }) => {
  await openApp(page);
  for (const [label, id, title] of [
    ["Zadania", "todo", "Zadania"], ["Kalendarz", "calendar", "Kalendarz"], ["Witaminy", "supplements", "Witaminy"],
    ["Zakupy", "recipes", "Lista zakupów"], ["Przepisy", "recipes", "Przepisy"], ["Spotify", "spotify", "Spotify"],
    ["Ustawienia", "settings", "Ustawienia"],
  ]) {
    await openFromMenu(page, label);
    await expect(view(page, id)).toHaveClass(/open/);
    await expect(view(page, id).locator(".view-title")).toHaveText(title);
    await view(page, id).locator(".view-back").click();
    await expect(view(page, id)).not.toHaveClass(/open/);
  }
  // "Pogoda" po prostu zamyka menu
  await page.locator("#menu-btn").click();
  await page.locator(".tile", { hasText: "Pogoda" }).click();
  await expect(page.locator("#menu")).not.toHaveClass(/open/);
  await expect(page.locator(".tile[data-tile=youtube]")).toHaveAttribute("href", "https://m.youtube.com");
});

test("Escape zamyka widok, a kropka synchronizacji otwiera ustawienia", async ({ page }) => {
  await openApp(page);
  await page.locator("#sync").click();
  await expect(view(page, "settings")).toHaveClass(/open/);
  await expect(view(page, "settings").locator(".row")).toHaveCount(5);
  await page.keyboard.press("Escape");
  await expect(view(page, "settings")).not.toHaveClass(/open/);
});
