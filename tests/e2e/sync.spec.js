// Najwazniejsze wymaganie: komputer i telefon widza te same dane na zywo.
import { test, expect, devices } from "@playwright/test";
import { openApp, resetDb, dumpDb, openFromMenu, view, DB } from "./helpers.js";

test.beforeEach(async ({ request }) => { await resetDb(request); });

async function twoDevices(browser) {
  const pc = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "pl-PL", timezoneId: "Europe/Warsaw" })).newPage();
  const phone = await (await browser.newContext({ ...devices["Pixel 7"], locale: "pl-PL", timezoneId: "Europe/Warsaw" })).newPage();
  await openApp(pc);
  await openApp(phone);
  return { pc, phone };
}

test("zadanie dodane na komputerze pojawia się na telefonie bez odświeżania (i odwrotnie)", async ({ browser }) => {
  const { pc, phone } = await twoDevices(browser);
  await openFromMenu(pc, "Zadania");
  await openFromMenu(phone, "Zadania");

  await pc.fill("#todo-input", "Zakupy");
  await pc.keyboard.press("Enter");
  await expect(view(phone, "todo").locator(".row", { hasText: "Zakupy" })).toBeVisible();

  await view(phone, "todo").locator(".row", { hasText: "Zakupy" }).click();
  await phone.fill("#todo-input", "Mleko");
  await phone.keyboard.press("Enter");
  await pc.locator("#view-todo .row", { hasText: "Zakupy" }).click();
  await expect(view(pc, "todo").locator(".task", { hasText: "Mleko" })).toBeVisible();

  await view(pc, "todo").locator(".task", { hasText: "Mleko" }).getByRole("button", { name: "Odhacz" }).click();
  await expect(view(phone, "todo").locator(".task.done", { hasText: "Mleko" })).toBeVisible();
});

test("ekran główny na drugim urządzeniu aktualizuje się na żywo", async ({ browser }) => {
  const { pc, phone } = await twoDevices(browser);
  await openFromMenu(pc, "Zakupy");
  await pc.fill("#shopping-input", "Pomidory");
  await pc.keyboard.press("Enter");
  await expect(phone.locator("#home-shopping")).toContainText("1 pozycja");

  await openFromMenu(pc, "Kalendarz");
  await pc.locator('#view-calendar .day[data-date="2026-11-10"]').click();
  await pc.fill("#cal-title-input", "Kolacja u Ani");
  await pc.keyboard.press("Enter");
  await expect(phone.locator("#home-events")).toContainText("Kolacja u Ani");
});

test("szybkie zmiany na dwóch urządzeniach naraz — nic nie ginie", async ({ browser, request }) => {
  const { pc, phone } = await twoDevices(browser);
  await openFromMenu(pc, "Kalendarz");
  await openFromMenu(phone, "Kalendarz");
  await pc.locator('#view-calendar .day[data-date="2026-11-14"]').click();
  await phone.locator('#view-calendar .day[data-date="2026-11-15"]').click();
  // kazdy dzien zapisywany osobno, wiec rownolegle dodawanie sie nie nadpisuje
  for (let i = 1; i <= 4; i++) {
    await pc.fill("#cal-title-input", "PC " + i); await pc.keyboard.press("Enter");
    await phone.fill("#cal-title-input", "Tel " + i); await phone.keyboard.press("Enter");
  }
  await expect.poll(async () => {
    const ev = (await dumpDb(request)).calendar_events;
    return [ev["2026-11-14"]?.length, ev["2026-11-15"]?.length];
  }).toEqual([4, 4]);
  await phone.locator("#view-calendar .view-back").click();
  await phone.locator('#view-calendar .day[data-date="2026-11-14"]').click();
  await expect(phone.locator("#view-calendar .event")).toHaveCount(4);
});

test("edycja w toku nie jest przerywana zmianą z innego urządzenia", async ({ browser }) => {
  const { pc, phone } = await twoDevices(browser);
  await openFromMenu(pc, "Zadania");
  await pc.fill("#todo-input", "Dom"); await pc.keyboard.press("Enter");
  await pc.locator("#view-todo .row", { hasText: "Dom" }).click();
  await pc.fill("#todo-input", "Odkurzyć"); await pc.keyboard.press("Enter");

  await pc.locator("#view-todo .task").getByRole("button", { name: "Edytuj" }).click();
  await pc.locator("#view-todo .inline-edit").fill("Odkurzyć salon");

  await openFromMenu(phone, "Zadania");
  await phone.fill("#todo-input", "Praca"); await phone.keyboard.press("Enter");
  await phone.waitForTimeout(500);

  await expect(pc.locator("#view-todo .inline-edit")).toHaveValue("Odkurzyć salon");
  await pc.keyboard.press("Enter");
  await expect(view(phone, "todo").locator(".row", { hasText: "Dom" })).toContainText("1 otwarte z 1");
  await view(phone, "todo").locator(".row", { hasText: "Dom" }).click();
  await expect(view(phone, "todo").locator(".task-text")).toHaveText("Odkurzyć salon");
});

test("brak sieci przy zapisie: zmiana zostaje i zapisuje się po powrocie sieci", async ({ page, request }) => {
  await openApp(page);
  await openFromMenu(page, "Zadania");
  await request.post(DB + "/__fail?mode=network");
  await page.fill("#todo-input", "Offline lista");
  await page.keyboard.press("Enter");
  await expect(view(page, "todo").locator(".row", { hasText: "Offline lista" })).toBeVisible();
  await expect(page.locator("#view-todo .view-status")).toContainText("Brak połączenia");
  await request.post(DB + "/__fail?mode=off");
  await expect.poll(async () => (await dumpDb(request))?.todo_lists?.[0]?.name, { timeout: 10000 }).toBe("Offline lista");
  await expect(page.locator("#sync")).toHaveAttribute("data-status", "live", { timeout: 10000 });
  await expect(page.locator("#view-todo .view-status")).toHaveText("");
});

test("błąd serwera przy zapisie: zmiana jest cofana i widać komunikat", async ({ page, request }) => {
  await openApp(page);
  await openFromMenu(page, "Zadania");
  await request.post(DB + "/__fail?mode=500");
  await page.fill("#todo-input", "Nie zapisze się");
  await page.keyboard.press("Enter");
  await expect(page.locator("#view-todo .view-status")).toContainText("HTTP 500");
  await expect(view(page, "todo").getByText("Nie masz jeszcze żadnej listy")).toBeVisible();
});

test("dane istniejące w bazie w starym formacie wczytują się poprawnie", async ({ page, request }) => {
  // dokladnie taki ksztalt zapisywala poprzednia wersja (w tym false w witaminach i obiekty zamiast tablic)
  await resetDb(request, {
    todo_lists: [{ id: "list_1700000000000", name: "Stara lista", tasks: [{ id: "task_1", text: "Stare zadanie", done: false }] }, { id: "list_2", name: "Pusta" }],
    supplements_log: { "2026-11-08": true, "2026-11-06": false },
    calendar_events: { "2026-11-10": { 0: { id: "ev_1", time: "", title: "Stare wydarzenie" } } },
    recipes_data: { categories: { 0: { id: "c", name: "Kat", subcategories: [{ id: "s", name: "Sub" }] } } },
    shopping_list: [{ text: "Stary produkt", checked: true }],
  });
  const errors = await openApp(page);
  await expect(page.locator("#home-todo")).toContainText("Stara lista");
  await expect(page.locator("#home-events")).toContainText("Stare wydarzenie");
  await openFromMenu(page, "Przepisy");
  await expect(view(page, "recipes").locator(".row", { hasText: "Kat" })).toBeVisible();
  await openFromMenu(page, "Zakupy");
  await expect(view(page, "recipes").locator(".task.done", { hasText: "Stary produkt" })).toBeVisible();
  expect(errors).toEqual([]);
});
