import { test, expect } from "@playwright/test";
import { openApp, resetDb, openFromMenu, view, DB, login } from "./helpers.js";

test("wydarzenia z Kalendarza Google widać w kalendarzu (tylko do odczytu)", async ({ page, request }) => {
  await resetDb(request, {
    calendar_events: { "2026-11-12": [{ id: "k", time: "18:00", title: "Kino" }] },
    calendar_google: { "uid-ola": { name: "Ola", updatedAt: Date.now(), events: [
      { id: "a@2026-11-12", title: "Fryzjer", date: "2026-11-12", time: "10:00", end: "11:00", link: "https://www.google.com/calendar/event?eid=1" },
      { id: "b@2026-11-14", title: "Urlop", date: "2026-11-14", to: "2026-11-16" },
    ] } },
  });
  await openApp(page);
  await openFromMenu(page, "Kalendarz");
  const v = view(page, "calendar");
  await v.locator('.day[data-date="2026-11-12"]').click();
  await expect(v.locator(".cal-day .event-title")).toHaveText(["Fryzjer", "Kino"]);
  await expect(v.locator(".cal-day .event", { hasText: "Fryzjer" }).locator(".row-sub")).toHaveText("Kalendarz Google");
  await expect(v.locator('.day[data-date="2026-11-15"] .dots i')).toHaveCount(1);

  await v.locator(".cal-day .event", { hasText: "Fryzjer" }).click();
  await expect(page.locator(".sheet .detail-who")).toContainText("z Kalendarza Google");
  await expect(page.locator(".sheet .google-note")).toBeVisible();
  await expect(page.locator("#cal-edit")).toHaveCount(0);
  await expect(page.locator(".sheet a", { hasText: "Otwórz w Google" })).toHaveAttribute("href", "https://www.google.com/calendar/event?eid=1");
  await page.locator(".sheet [aria-label=Zamknij]").click();

  await page.click("#cal-mode-list");
  await expect(v.locator(".cal-group .event-title")).toContainText(["Fryzjer", "Kino", "Urlop"]);
});

test("ustawienia: kopiowanie konfiguracji i kodu skryptu, status synchronizacji", async ({ page, request }) => {
  await resetDb(request, { users: { "uid-ja": { calendar_google: { "uid-ja": { name: "ja", updatedAt: Date.parse("2026-11-10T13:25:00Z"), events: [] } } } } });
  await request.post(DB + "/__auth?mode=peruser&owner=uid-ja");
  await page.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => { window.__copied.push(t); } }, configurable: true });
  });
  await openApp(page, { expectStatus: "auth" });
  await login(page, "ja@example.com");
  await expect(page.locator("#sync")).toHaveAttribute("data-status", "live");
  await page.locator("#sync").click();
  const v = view(page, "settings");
  await expect(v.locator("#google-status")).toContainText("Ty: 5 min temu");

  await page.click("#google-copy-config");
  await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(1);
  const cfg = JSON.parse(await page.evaluate(() => window.__copied[0]));
  expect(cfg).toMatchObject({ uid: "uid-ja", base: "users/uid-ja", gid: null, refreshToken: "ref-uid-ja", name: "ja" });
  expect(cfg.dbUrl).toMatch(/^http/);
  expect(cfg.apiKey).toBeTruthy();

  await page.click("#google-copy-code");
  await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(2);
  const code = await page.evaluate(() => window.__copied[1]);
  expect(code).toContain("function synchronizuj()");
  expect(code).toContain("const KONFIGURACJA = 'WKLEJ_TUTAJ';");
});
