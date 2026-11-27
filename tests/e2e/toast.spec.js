import { test, expect } from "@playwright/test";
import { openApp, resetDb, openFromMenu, view, addCalendarEvent } from "./helpers.js";

test.beforeEach(async ({ request }) => { await resetDb(request, { shopping_list: [{ text: "mleko", checked: false }, { text: "chleb", checked: false }] }); });

test("komunikaty: brak przy odhaczaniu i dodawaniu, krótkie i zamykane dotknięciem przy usuwaniu", async ({ page }) => {
  await openApp(page);
  await openFromMenu(page, "Zakupy");
  const v = view(page, "recipes");
  await v.locator(".task", { hasText: "mleko" }).getByRole("button", { name: "Odhacz" }).click();
  await expect(v.locator(".task.done")).toHaveText(/mleko/);
  await expect(page.locator("#toast.show")).toHaveCount(0);
  await expect(page.locator("#shopping-undo")).toBeEnabled(); // cofanie dalej dostepne

  await v.locator(".task", { hasText: "chleb" }).getByRole("button", { name: "Usuń" }).click();
  await expect(page.locator("#toast.show")).toContainText("Usunięto „chleb”");
  await page.locator("#toast .toast-text").click();
  await expect(page.locator("#toast.show")).toHaveCount(0);

  await v.locator(".task", { hasText: "mleko" }).getByRole("button", { name: "Usuń" }).click();
  await expect(page.locator("#toast.show")).toBeVisible();
  await expect(page.locator("#toast.show")).toHaveCount(0, { timeout: 5500 }); // znika sam po ~4 s

  await openFromMenu(page, "Kalendarz");
  await addCalendarEvent(page, { title: "Kino", time: "18:00" });
  await expect(view(page, "calendar").locator(".cal-day .event-title")).toHaveText(["Kino"]);
  await expect(page.locator("#toast.show")).toHaveCount(0);
});
