// Grupy: kilka osob na wspolnych danych + powiadomienia ntfy dla pozostalych.
import { test, expect, devices } from "@playwright/test";
import { openApp, resetDb, dumpDb, openFromMenu, view, DB, login, newContext, closeExtraContexts } from "./helpers.js";
import { fileURLToPath } from "node:url";

const IMG = fileURLToPath(new URL("../../icon-192.png", import.meta.url));

const LEGACY = {
  todo_lists: [{ id: "l1", name: "Moja stara lista", tasks: [{ id: "t1", text: "Stare zadanie", done: false }] }],
  recipes_data: { categories: [{ id: "c", name: "Obiady", subcategories: [{ id: "s", name: "Ogólne", recipes: [{ id: "r1", name: "Pierogi", ingredients: ["mąka"] }] }] }] },
};

test.describe.configure({ timeout: 60000 }); // kilka urzadzen + celowe czekanie na laczenie powiadomien

test.afterEach(async () => { await closeExtraContexts(); });

test.beforeEach(async ({ request }) => {
  await resetDb(request, LEGACY);
  await request.post(DB + "/__auth?mode=peruser&owner=uid-ja");
});

async function device(browser, phone = false) {
  const ctx = await newContext(browser, { ...(phone ? devices["Pixel 7"] : { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } }), locale: "pl-PL", timezoneId: "Europe/Warsaw" });
  const page = await ctx.newPage();
  page.ntfy = [];
  await page.route(/ntfy\.sh/, async (r) => { page.ntfy.push(JSON.parse(r.request().postData())); await r.fulfill({ json: { id: "x" } }); });
  return page;
}

async function signIn(page, email) {
  await openApp(page, { expectStatus: "auth" });
  await login(page, email);
  await expect(page.locator("#sync")).toHaveAttribute("data-status", "live");
}

async function answer(page, text) {
  await page.locator(".dialog input").fill(text);
  await page.locator(".dialog [data-confirm]").click();
}

async function createGroup(page, name = "Dom", me = "Kuba") {
  await openFromMenu(page, "Ustawienia");
  await page.click("#group-create");
  await answer(page, name);
  await answer(page, me);
  await expect(page.locator("#group-name")).toHaveText(name);
  return (await page.locator("#invite-code").textContent()).trim();
}

async function joinGroup(page, code, me = "Ania") {
  await openFromMenu(page, "Ustawienia");
  await page.click("#group-join");
  await answer(page, code);
  await answer(page, me);
}

test("założenie grupy kopiuje moje dane; druga osoba dołącza kodem i widzi te same dane na żywo", async ({ browser, request }) => {
  const ja = await device(browser);
  const ona = await device(browser, true);
  await signIn(ja, "ja@example.com");
  await expect(ja.locator("#home-todo")).toContainText("Moja stara lista");
  const code = await createGroup(ja);
  expect(code).toMatch(/^[a-z0-9]{10}-[a-z0-9]{8}$/);
  await expect(ja.locator("#group-members .member")).toHaveCount(1);

  await signIn(ona, "ona@example.com");
  await expect(ona.locator("#home-todo")).toContainText("Wszystko zrobione"); // jeszcze osobne dane
  await joinGroup(ona, code);
  await expect(ona.locator("#group-name")).toHaveText("Dom");
  await expect(ona.locator("#group-members .member")).toHaveCount(2);
  await ona.locator("#view-settings .view-back").click();
  await expect(ona.locator("#home-todo")).toContainText("Moja stara lista"); // dane grupy

  // zmiana jednej osoby widoczna u drugiej
  await openFromMenu(ona, "Zakupy");
  await ona.fill("#shopping-input", "Chleb");
  await ona.keyboard.press("Enter");
  await ja.locator("#view-settings .view-back").click();
  await expect(ja.locator("#home-shopping")).toContainText("1 pozycja");

  // dane w bazie: w grupie, a dane kont nietkniete
  const db = await dumpDb(request);
  const gid = code.split("-")[0];
  expect(db.groups[gid].data.shopping_list[0].text).toBe("Chleb");
  expect(db.groups[gid].data.todo_lists[0].name).toBe("Moja stara lista");
  expect(db.users["uid-ja"].group).toBe(gid);
  expect(db.users["uid-ona"].group).toBe(gid);
  expect(db.users["uid-ja"].shopping_list).toBeUndefined();
});

test("powiadomienia: dostają je pozostałe osoby (nie autor), zgrupowane, zgodnie z ich ustawieniami", async ({ browser }) => {
  const ja = await device(browser);
  const ona = await device(browser, true);
  await signIn(ja, "ja@example.com");
  const code = await createGroup(ja);
  const jaTopic = (await ja.locator("#ntfy-topic").textContent()).trim();
  expect(jaTopic).toMatch(/^dashboard-[a-z0-9]{20}$/);
  // komputer: bez przycisku (nie ma tu aplikacji), instrukcja dla telefonu + temat do skopiowania
  await expect(ja.locator("#ntfy-steps")).toHaveAttribute("data-platform", "desktop");
  await expect(ja.locator("#ntfy-subscribe")).toHaveCount(0);
  await expect(ja.locator("#ntfy-copy")).toBeVisible();

  await signIn(ona, "ona@example.com");
  await joinGroup(ona, code, "Ania");
  await expect(ona.locator("#group-members .member")).toHaveCount(2);
  const onaTopic = (await ona.locator("#ntfy-topic").textContent()).trim();
  // telefon z Androidem: link "intent://" (dziala tez w kiosku; bez aplikacji otwiera sklep Play)
  await expect(ona.locator("#ntfy-steps")).toHaveAttribute("data-platform", "android");
  await expect(ona.locator("#ntfy-subscribe")).toHaveAttribute("href",
    `intent://ntfy.sh/${onaTopic}?display=Dashboard%20domowy#Intent;scheme=ntfy;package=io.heckel.ntfy;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dio.heckel.ntfy;end`);

  // Ania dodaje 2 produkty szybko po sobie -> jedno powiadomienie dla Kuby
  await openFromMenu(ona, "Zakupy");
  await ona.fill("#shopping-input", "mleko, jajka");
  await ona.keyboard.press("Enter");
  await expect.poll(() => ona.ntfy.length, { timeout: 8000 }).toBe(1);
  expect(ona.ntfy[0]).toMatchObject({ topic: jaTopic, title: "Ania dodał(a) do zakupów", message: "mleko, jajka", tags: ["shopping_cart"], priority: 4 });

  // Kuba dodaje wydarzenie -> powiadomienie dla Ani (Kuba nic nie dostaje o sobie)
  await ja.reload();
  await expect(ja.locator("#sync")).toHaveAttribute("data-status", "live");
  await openFromMenu(ja, "Kalendarz");
  await ja.locator('#view-calendar .day[data-date="2026-11-12"]').click();
  await ja.fill("#cal-time-input", "18:00");
  await ja.fill("#cal-title-input", "Kino");
  await ja.keyboard.press("Enter");
  await expect.poll(() => ja.ntfy.length, { timeout: 8000 }).toBe(1);
  expect(ja.ntfy[0].topic).toBe(onaTopic);
  expect(ja.ntfy[0].title).toBe("Kuba dodał(a) do kalendarza");
  expect(ja.ntfy[0].message).toContain("Kino");
  expect(ja.ntfy[0].message).toContain("18:00");

  // Kuba wylacza powiadomienia o zakupach -> Ania dodaje produkt, nic nie idzie
  await openFromMenu(ja, "Ustawienia");
  await ja.locator('#notify-card input[data-cat="shopping"]').uncheck();
  await expect(ja.locator('#notify-card input[data-cat="shopping"]')).not.toBeChecked();
  await ona.reload(); // swieze profile grupy
  await expect(ona.locator("#sync")).toHaveAttribute("data-status", "live");
  await openFromMenu(ona, "Zakupy");
  await ona.fill("#shopping-input", "masło");
  await ona.keyboard.press("Enter");
  await ona.waitForTimeout(3500);
  expect(ona.ntfy.length).toBe(1);

  // testowe powiadomienie idzie na wlasny temat
  await ja.click("#ntfy-test");
  await expect.poll(() => ja.ntfy.length).toBe(2);
  expect(ja.ntfy[1].topic).toBe(jaTopic);
});

test("bez grupy powiadomienia nie są wysyłane", async ({ browser }) => {
  const ja = await device(browser);
  await signIn(ja, "ja@example.com");
  await openFromMenu(ja, "Zakupy");
  await ja.fill("#shopping-input", "mleko");
  await ja.keyboard.press("Enter");
  await ja.waitForTimeout(3500);
  expect(ja.ntfy).toEqual([]);
});

test("zły kod zaproszenia: czytelny błąd, dalej osobne dane", async ({ browser }) => {
  const ja = await device(browser);
  await signIn(ja, "ja@example.com");
  await createGroup(ja);
  const ona = await device(browser, true);
  await signIn(ona, "ona@example.com");
  await joinGroup(ona, "abcdefghij-zlykod12");
  await expect(ona.locator("#toast")).toContainText("Kod jest nieprawidłowy");
  await expect(ona.locator("#group-none")).toBeVisible();
});

test("link zaproszenia: po otwarciu i zalogowaniu pyta o dołączenie", async ({ browser }) => {
  const ja = await device(browser);
  await signIn(ja, "ja@example.com");
  const code = await createGroup(ja, "Dom");
  const ona = await device(browser, true);
  await ona.clock.setFixedTime(new Date("2026-11-10T14:30:00+01:00"));
  await openApp(ona, { expectStatus: "auth" }); // ustawia tryb testowy
  await ona.goto(`/dashboard.html?dolacz=${code}`);
  await expect(ona.locator("#login")).toBeVisible();
  await login(ona, "ona@example.com");
  await expect(ona.locator(".dialog input")).toHaveValue(code);
  await ona.locator(".dialog [data-confirm]").click();
  await answer(ona, "Ania");
  await expect(ona.locator("#group-name")).toHaveText("Dom");
  await expect(ona).toHaveURL(/dashboard\.html$/);
});

test("opuszczenie grupy i usunięcie przez założyciela: powrót do osobistych danych", async ({ browser, request }) => {
  const ja = await device(browser);
  await signIn(ja, "ja@example.com");
  const code = await createGroup(ja);
  const ona = await device(browser, true);
  await signIn(ona, "ona@example.com");
  await joinGroup(ona, code);
  await expect(ona.locator("#group-name")).toHaveText("Dom");

  // usuniecie przez zalozyciela
  await ja.reload();
  await expect(ja.locator("#sync")).toHaveAttribute("data-status", "live");
  await openFromMenu(ja, "Ustawienia");
  await expect(ja.locator("#group-members .member")).toHaveCount(2);
  await ja.locator('#group-members .member[data-uid="uid-ona"] [aria-label="Usuń z grupy"]').click();
  await ja.locator(".dialog [data-confirm]").click();
  await expect(ja.locator("#group-members .member")).toHaveCount(1);
  await ona.reload();
  await expect(ona.locator("#sync")).toHaveAttribute("data-status", "live");
  await expect(ona.locator("#home-todo")).toContainText("Wszystko zrobione"); // znow osobne dane
  expect((await dumpDb(request)).users["uid-ona"].group).toBeUndefined();

  // zalozyciel sam opuszcza grupe -> jego osobiste dane (kopia sprzed zalozenia grupy)
  await ja.click("#group-leave");
  await ja.locator(".dialog [data-confirm]").click();
  await expect(ja.locator("#group-none")).toBeVisible();
  await ja.locator("#view-settings .view-back").click();
  await expect(ja.locator("#home-todo")).toContainText("Moja stara lista");
});

test("zdjęcia przepisów w grupie są wspólne (groups/<id>/photos) i kopiują się przy zakładaniu", async ({ browser, request }) => {
  const ja = await device(browser);
  await signIn(ja, "ja@example.com");
  // zdjecie dodane jeszcze przed zalozeniem grupy
  await openFromMenu(ja, "Przepisy");
  await ja.fill("#recipe-search", "pierogi");
  await ja.locator(".recipe-row").click();
  await ja.locator(".photo-drop input").setInputFiles(IMG);
  await expect(ja.locator("#view-recipes .hero-img")).toBeVisible();
  await expect.poll(async () => Object.keys((await dumpDb(request)).recipe_photos?.["uid-ja"] || {}).length).toBe(1);

  const code = await createGroup(ja);
  const gid = code.split("-")[0];
  expect((await dumpDb(request)).groups[gid].photos.r1).toMatch(/^data:image/);

  const ona = await device(browser, true);
  await signIn(ona, "ona@example.com");
  await joinGroup(ona, code);
  await openFromMenu(ona, "Przepisy");
  await ona.fill("#recipe-search", "pierogi");
  await ona.locator(".recipe-row").click();
  await expect(ona.locator("#view-recipes .hero-img")).toBeVisible();
});

test("osoba dołącza, gdy u drugiej dashboard jest już otwarty: powiadomienia i tak do niej trafiają", async ({ browser }) => {
  const ja = await device(browser);
  await signIn(ja, "ja@example.com");
  const code = await createGroup(ja);
  await ja.locator("#view-settings .view-back").click();

  const ona = await device(browser, true);
  await signIn(ona, "ona@example.com");
  await joinGroup(ona, code, "Ania");
  const onaTopic = (await ona.locator("#ntfy-topic").textContent()).trim();

  // komputer (ja) nie przeladowywany — po 20 s lista osob odswiezy sie przed wyslaniem
  await ja.evaluate(() => { const real = Date.now; Date.now = () => real() + 60000; });
  await openFromMenu(ja, "Zakupy");
  await ja.fill("#shopping-input", "pomidory");
  await ja.keyboard.press("Enter");
  await expect.poll(() => ja.ntfy.map((n) => n.topic), { timeout: 8000 }).toEqual([onaTopic]);
  expect(ja.ntfy[0].title).toBe("Kuba dodał(a) do zakupów");
});

test("kliknięcie w powiadomienie otwiera właściwe miejsce (dzień w kalendarzu, listę zadań, przepis)", async ({ browser }) => {
  const ja = await device(browser);
  await signIn(ja, "ja@example.com");
  const code = await createGroup(ja);
  const ona = await device(browser, true);
  await signIn(ona, "ona@example.com");
  await joinGroup(ona, code, "Ania");

  // Ania dodaje spotkanie -> powiadomienie dla Kuby z linkiem do tego dnia i wpisu
  await openFromMenu(ona, "Kalendarz");
  await ona.locator('#view-calendar .day[data-date="2026-11-12"]').click();
  await ona.fill("#cal-title-input", "Dentysta");
  await ona.keyboard.press("Enter");
  await expect.poll(() => ona.ntfy.length, { timeout: 8000 }).toBe(1);
  const click = new URL(ona.ntfy[0].click);
  expect(click.searchParams.get("otworz")).toBe("kalendarz");
  expect(click.searchParams.get("dzien")).toBe("2026-11-12");
  expect(click.searchParams.get("wpis")).toMatch(/^ev_/);

  // Kuba klika w powiadomienie (telefon otwiera ten adres)
  await ja.goto(click.pathname + click.search);
  await expect(ja.locator("#view-calendar")).toHaveClass(/open/);
  await expect(ja.locator("#view-calendar .view-title")).toHaveText("Czwartek, 12 listopada 2026");
  await expect(ja.locator(`#view-calendar [data-event-id="${click.searchParams.get("wpis")}"]`)).toHaveClass(/flash/);
  await expect(ja).toHaveURL(/dashboard\.html$/);

  // zadanie na liscie
  await openFromMenu(ona, "Zadania");
  await ona.locator("#view-todo .row", { hasText: "Moja stara lista" }).click();
  await ona.fill("#todo-input", "Kupić prezent");
  await ona.keyboard.press("Enter");
  await expect.poll(() => ona.ntfy.length, { timeout: 8000 }).toBe(2);
  const todoClick = new URL(ona.ntfy[1].click);
  await ja.goto(todoClick.pathname + todoClick.search);
  await expect(ja.locator("#view-todo .view-title")).toHaveText("Moja stara lista");
  await expect(ja.locator(`#view-todo [data-task-id="${todoClick.searchParams.get("wpis")}"]`)).toHaveClass(/flash/);

  // nowy przepis (Kuba wlacza powiadomienia o przepisach — domyslnie sa wylaczone)
  await openFromMenu(ja, "Ustawienia");
  await ja.locator('#notify-card input[data-cat="recipes"]').check();
  await expect(ja.locator('#notify-card input[data-cat="recipes"]')).toBeChecked();
  await ona.evaluate(() => { const n = Date.now; Date.now = () => n() + 60000; }); // Ania pobierze swieze ustawienia
  await openFromMenu(ona, "Przepisy");
  await ona.click("#recipe-new");
  await ona.fill("#recipe-name", "Placki ziemniaczane");
  await ona.click("#recipe-save");
  await expect.poll(() => ona.ntfy.length, { timeout: 8000 }).toBe(3);
  const recipeClick = new URL(ona.ntfy[2].click);
  expect(recipeClick.searchParams.get("otworz")).toBe("przepisy");
  await ja.goto(recipeClick.pathname + recipeClick.search);
  await expect(ja.locator("#view-recipes .view-title")).toHaveText("Placki ziemniaczane");
});
