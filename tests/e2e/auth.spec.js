// Prywatna baza: dostep tylko po zalogowaniu, dalej wspolne dane na wszystkich urzadzeniach.
import { test, expect, devices } from "@playwright/test";
import { openApp, resetDb, dumpDb, openFromMenu, view, DB, login as loginAs } from "./helpers.js";

test.beforeEach(async ({ request }) => {
  await resetDb(request, { todo_lists: [{ id: "l1", name: "Prywatna lista", tasks: [{ id: "t1", text: "Sekret", done: false }] }] });
});

const login = (page, password = "dobrehaslo") => loginAs(page, "ja@example.com", password);
const userDb = async (request) => (await dumpDb(request))?.users?.["uid-ja"];

test("otwarta baza (tak jak teraz): nie trzeba się logować", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("#login")).toHaveCount(0);
  await expect(page.locator("#home-todo")).toContainText("Prywatna lista");
});

test("prywatna baza: bez logowania brak danych, po zalogowaniu wszystko działa i jest zapamiętane", async ({ page, request }) => {
  await request.post(DB + "/__auth?required=1");
  await openApp(page, { expectStatus: "auth" });
  await expect(page.locator("#login")).toBeVisible();
  await expect(page.locator("#home-todo")).toHaveCount(0);

  await login(page, "złe");
  await expect(page.locator(".login-error")).toHaveText("Zły e-mail lub hasło.");

  await login(page);
  await expect(page.locator("#login")).toHaveCount(0);
  await expect(page.locator("#sync")).toHaveAttribute("data-status", "live");
  await expect(page.locator("#home-todo")).toContainText("Prywatna lista");

  // zapis tez przechodzi (z tokenem)
  await openFromMenu(page, "Zadania");
  await page.fill("#todo-input", "Druga lista");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await userDb(request)).todo_lists.length).toBe(2);

  // po przeladowaniu nie trzeba logowac sie ponownie
  await page.reload();
  await expect(page.locator("#sync")).toHaveAttribute("data-status", "live");
  await expect(page.locator("#login")).toHaveCount(0);
  await openFromMenu(page, "Zadania");
  await expect(view(page, "todo").locator(".row", { hasText: "Druga lista" })).toBeVisible();
});

test("prywatna baza: komputer i telefon po zalogowaniu widzą te same dane na żywo", async ({ browser, request }) => {
  await request.post(DB + "/__auth?required=1");
  const pc = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "pl-PL", timezoneId: "Europe/Warsaw" })).newPage();
  const phone = await (await browser.newContext({ ...devices["Pixel 7"], locale: "pl-PL", timezoneId: "Europe/Warsaw" })).newPage();
  for (const p of [pc, phone]) { await openApp(p, { expectStatus: "auth" }); await login(p); await expect(p.locator("#sync")).toHaveAttribute("data-status", "live"); }

  await openFromMenu(pc, "Zadania");
  await pc.locator("#view-todo .row", { hasText: "Prywatna lista" }).click();
  await pc.fill("#todo-input", "Z komputera");
  await pc.keyboard.press("Enter");
  await expect(phone.locator("#home-todo")).toContainText("2");
  await openFromMenu(phone, "Zadania");
  await phone.locator("#view-todo .row", { hasText: "Prywatna lista" }).click();
  await expect(view(phone, "todo").locator(".task", { hasText: "Z komputera" })).toBeVisible();
});

test("zmiana bazy na prywatną w trakcie: urządzenie pokazuje logowanie, a po nim wraca do pracy", async ({ page, request }) => {
  await openApp(page);
  await openFromMenu(page, "Zadania");
  await request.post(DB + "/__auth?required=1"); // zmiana regul, gdy strona jest otwarta
  await expect(page.locator("#login")).toBeVisible();
  await expect(page.locator("#sync")).toHaveAttribute("data-status", "auth");
  await login(page);
  await expect(page.locator("#sync")).toHaveAttribute("data-status", "live");
  await expect(view(page, "todo").locator(".row", { hasText: "Prywatna lista" })).toBeVisible();
  await page.fill("#todo-input", "Po zalogowaniu");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await userDb(request)).todo_lists.map((l) => l.name)).toContain("Po zalogowaniu");
});

test("ustawienia: konto i wylogowanie", async ({ page, request }) => {
  await request.post(DB + "/__auth?required=1");
  await openApp(page, { expectStatus: "auth" });
  await login(page);
  await openFromMenu(page, "Ustawienia");
  await expect(page.locator("#account-row")).toContainText("ja@example.com");
  await page.locator("#account-row").getByRole("button", { name: "Wyloguj" }).click();
  await expect(page.locator("#login")).toBeVisible();
  await expect(page.locator("#sync")).toHaveAttribute("data-status", "auth");
});

test("niezalogowany dodaje zadanie: pojawia się logowanie, a po nim zadanie zapisuje się samo (nic nie ginie)", async ({ page, request }) => {
  await request.post(DB + "/__auth?required=0");
  await openApp(page);
  await openFromMenu(page, "Zadania");
  await request.post(DB + "/__auth?required=1");
  await expect(page.locator("#login")).toBeVisible();
  await page.locator("#login .link-btn").click(); // "Nie teraz"
  await page.fill("#todo-input", "Nie zgub mnie");
  await page.keyboard.press("Enter");
  await expect(page.locator("#login")).toBeVisible();
  await expect(view(page, "todo").locator(".row", { hasText: "Nie zgub mnie" })).toBeVisible();
  await login(page);
  await expect.poll(async () => (await userDb(request))?.todo_lists?.map((l) => l.name)).toContain("Nie zgub mnie");
});

test("zalogowany, ale reguła .write błędna: jasny komunikat zamiast ciągłego logowania", async ({ page, request }) => {
  await request.post(DB + "/__auth?required=1&readonly=1");
  await openApp(page, { expectStatus: "auth" });
  await login(page);
  await expect(page.locator("#sync")).toHaveAttribute("data-status", "live");
  await openFromMenu(page, "Zadania");
  await page.fill("#todo-input", "Test zapisu");
  await page.keyboard.press("Enter");
  await expect(page.locator("#view-todo .view-status")).toContainText(".write");
  await expect(page.locator("#login")).toHaveCount(0);
});
