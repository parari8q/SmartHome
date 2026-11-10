// Kazde konto ma swoje dane; urzadzenia na tym samym koncie widza to samo.
import { test, expect, devices } from "@playwright/test";
import { openApp, resetDb, dumpDb, openFromMenu, view, DB, login, newContext, closeExtraContexts } from "./helpers.js";

const LEGACY = {
  todo_lists: [{ id: "l1", name: "Moja stara lista", tasks: [{ id: "t1", text: "Stare zadanie", done: false }] }],
  shopping_list: [{ text: "Mleko", checked: false }],
};

test.afterEach(async () => { await closeExtraContexts(); });

test.beforeEach(async ({ request }) => {
  await resetDb(request, LEGACY);
  // reguly z README: users/<uid> tylko dla wlasciciela tej przestrzeni, stare dane do odczytu tylko dla uid-ja
  await request.post(DB + "/__auth?mode=peruser&owner=uid-ja");
});

const ctx = async (browser, phone = false) => (await newContext(browser, {
  ...(phone ? devices["Pixel 7"] : { viewport: { width: 1280, height: 800 } }), locale: "pl-PL", timezoneId: "Europe/Warsaw",
})).newPage();

async function signIn(page, email) {
  await openApp(page, { expectStatus: "auth" });
  await login(page, email);
  await expect(page.locator("#sync")).toHaveAttribute("data-status", "live");
}

test("właściciel po zalogowaniu widzi swoje dotychczasowe dane (przeniesione na konto)", async ({ page, request }) => {
  await signIn(page, "ja@example.com");
  await expect(page.locator("#home-todo")).toContainText("Moja stara lista");
  await expect(page.locator("#home-shopping")).toContainText("1 pozycja");
  const db = await dumpDb(request);
  expect(db.users["uid-ja"].todo_lists[0].name).toBe("Moja stara lista");
  expect(db.todo_lists[0].name).toBe("Moja stara lista"); // kopia zapasowa zostaje
});

test("drugie konto ma osobne, puste dane i nie widzi danych pierwszego", async ({ browser, request }) => {
  const ja = await ctx(browser);
  const ona = await ctx(browser, true);
  await signIn(ja, "ja@example.com");
  await signIn(ona, "ona@example.com");

  await expect(ja.locator("#home-todo")).toContainText("Moja stara lista");
  await expect(ona.locator("#home-todo")).toContainText("Wszystko zrobione");

  await openFromMenu(ona, "Zadania");
  await ona.fill("#todo-input", "Lista Ani");
  await ona.keyboard.press("Enter");
  await openFromMenu(ja, "Zadania");
  await expect(view(ja, "todo").locator(".row", { hasText: "Moja stara lista" })).toBeVisible();
  await ja.waitForTimeout(500);
  await expect(view(ja, "todo").locator(".row", { hasText: "Lista Ani" })).toHaveCount(0);
  await expect(view(ona, "todo").locator(".row", { hasText: "Moja stara lista" })).toHaveCount(0);

  const db = await dumpDb(request);
  expect(db.users["uid-ona"].todo_lists.map((l) => l.name)).toEqual(["Lista Ani"]);
  expect(db.users["uid-ja"].todo_lists.map((l) => l.name)).toEqual(["Moja stara lista"]);
});

test("dwa urządzenia na tym samym koncie widzą te same dane na żywo", async ({ browser }) => {
  const pc = await ctx(browser);
  const phone = await ctx(browser, true);
  await signIn(pc, "ona@example.com");
  await signIn(phone, "ona@example.com");
  await openFromMenu(pc, "Zakupy");
  await pc.fill("#shopping-input", "Chleb");
  await pc.keyboard.press("Enter");
  await expect(phone.locator("#home-shopping")).toContainText("1 pozycja");
});

test("wylogowanie i zalogowanie na inne konto na tym samym urządzeniu przełącza dane", async ({ page }) => {
  await signIn(page, "ja@example.com");
  await expect(page.locator("#home-todo")).toContainText("Moja stara lista");
  await openFromMenu(page, "Ustawienia");
  await page.locator("#account-row").getByRole("button", { name: "Wyloguj" }).click();
  await expect(page.locator("#login")).toBeVisible();
  await login(page, "ona@example.com");
  await expect(page.locator("#sync")).toHaveAttribute("data-status", "live");
  await page.locator("#view-settings .view-back").click();
  await expect(page.locator("#home-todo")).toContainText("Wszystko zrobione");
  await expect(page.locator("#home-todo")).not.toContainText("Moja stara lista");
});

test("wyczyszczona lista nie wraca ze starych danych przy kolejnym logowaniu", async ({ page, request }) => {
  await signIn(page, "ja@example.com");
  await openFromMenu(page, "Zadania");
  await view(page, "todo").locator(".row", { hasText: "Moja stara lista" }).getByRole("button", { name: /Usuń listę/ }).click();
  await page.locator(".dialog [data-confirm]").click();
  await expect.poll(async () => (await dumpDb(request)).users["uid-ja"].todo_lists ?? null).toBeNull();
  await page.evaluate(() => localStorage.clear()); // nowe urzadzenie / wyczyszczona przegladarka
  await page.reload();
  await login(page, "ja@example.com");
  await expect(page.locator("#sync")).toHaveAttribute("data-status", "live");
  await openFromMenu(page, "Zadania");
  await expect(view(page, "todo").getByText("Nie masz jeszcze żadnej listy")).toBeVisible();
});

test("kilka kart naraz: jedno połączenie na kartę, wszystkie się łączą (limit przeglądarki)", async ({ browser, request }) => {
  // osobne konto, zeby liczyc tylko polaczenia z tego testu
  const mine = async () => (await (await request.get(DB + "/__streams")).json()).filter((s) => s === "users/uid-karty").length;
  const context = await newContext(browser, { viewport: { width: 1280, height: 800 }, locale: "pl-PL", timezoneId: "Europe/Warsaw" });
  const first = await context.newPage();
  await signIn(first, "karty@example.com");
  const tabs = [first];
  for (let i = 0; i < 3; i++) {
    const p = await context.newPage(); // ta sama przegladarka -> wspolny limit polaczen
    await openApp(p); // juz zalogowane (wspolny localStorage); czeka na status "polaczono"
    tabs.push(p);
  }
  await expect.poll(mine).toBe(4); // 4 karty = 4 polaczenia (wczesniej bylo 20, a limit to 6)

  await openFromMenu(tabs[3], "Zakupy");
  await tabs[3].fill("#shopping-input", "Masło");
  await tabs[3].keyboard.press("Enter");
  for (const p of tabs.slice(0, 3)) await expect(p.locator("#home-shopping")).toContainText("1 pozycja");
  await context.close();
});
