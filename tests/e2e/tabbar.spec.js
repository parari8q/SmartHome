import { test, expect } from "@playwright/test";
import { openApp, resetDb, view } from "./helpers.js";

test.beforeEach(async ({ request }) => { await resetDb(request); });

const tab = (page, id) => page.locator(`#tabbar .tab[data-tab="${id}"]`);

test("dolny pasek: zawsze widoczny, przełącza sekcje i podświetla aktywną", async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.locator("#tabbar .tab")).toHaveCount(5);
  await expect(tab(page, "home")).toHaveAttribute("aria-current", "page");

  await tab(page, "shopping").click();
  await expect(view(page, "recipes")).toHaveClass(/open/);
  await expect(view(page, "recipes").locator(".view-title")).toHaveText("Lista zakupów");
  await expect(tab(page, "shopping")).toHaveAttribute("aria-current", "page");
  await expect(tab(page, "recipes")).not.toHaveAttribute("aria-current", "page");
  await expect(page.locator("#tabbar")).toBeVisible();

  await tab(page, "recipes").click();
  await expect(view(page, "recipes").locator(".view-title")).toHaveText("Przepisy");
  await expect(tab(page, "recipes")).toHaveAttribute("aria-current", "page");

  await tab(page, "todo").click();
  await expect(view(page, "todo")).toHaveClass(/open/);
  await expect(view(page, "recipes")).not.toHaveClass(/open/);
  await expect(tab(page, "todo")).toHaveAttribute("aria-current", "page");

  await tab(page, "calendar").click();
  await expect(view(page, "calendar")).toHaveClass(/open/);

  await tab(page, "home").click();
  await expect(page.locator(".view.open")).toHaveCount(0);
  await expect(tab(page, "home")).toHaveAttribute("aria-current", "page");

  // Ustawienia nie maja zakladki — zadna nie jest podswietlona
  await page.locator("#sync").click();
  await expect(view(page, "settings")).toHaveClass(/open/);
  await expect(page.locator('#tabbar [aria-current="page"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("pole dodawania i przyciski widoku nie chowają się pod dolnym paskiem", async ({ page }) => {
  await openApp(page);
  await tab(page, "shopping").click();
  const footer = view(page, "recipes").locator(".view-footer");
  await expect(footer).toBeVisible();
  await page.waitForTimeout(500); // koniec animacji wysuwania widoku
  const f = await footer.boundingBox();
  const t = await page.locator("#tabbar").boundingBox();
  expect(f.y + f.height).toBeLessThanOrEqual(t.y + 1);
});
