import { test, expect } from "@playwright/test";
import { openApp, resetDb, dumpDb, openFromMenu, view, DB } from "./helpers.js";

test.beforeEach(async ({ request }) => { await resetDb(request); });

// ============================================================== ZADANIA

test.describe("Zadania", () => {
  test("tworzenie listy, dodawanie, odhaczanie, edycja, usuwanie — wszystko trafia do bazy", async ({ page, request }) => {
    await openApp(page);
    await openFromMenu(page, "Zadania");
    const v = view(page, "todo");
    await expect(v.getByText("Nie masz jeszcze żadnej listy")).toBeVisible();

    await page.fill("#todo-input", "Dom");
    await page.keyboard.press("Enter");
    await v.locator(".row", { hasText: "Dom" }).click();
    await expect(v.locator(".view-title")).toHaveText("Dom");

    for (const t of ["Umyć podłogę", "Wynieść śmieci"]) { await page.fill("#todo-input", t); await v.getByRole("button", { name: "Dodaj" }).click(); }
    await expect(v.locator(".task")).toHaveCount(2);

    await v.locator(".task", { hasText: "Umyć podłogę" }).getByRole("button", { name: "Odhacz" }).click();
    await expect(v.locator(".task.done")).toHaveText(/Umyć podłogę/);
    await expect(v.locator(".task").last()).toHaveClass(/done/); // odhaczone na dole

    await v.locator(".task", { hasText: "Wynieść śmieci" }).getByRole("button", { name: "Edytuj" }).click();
    await v.locator(".inline-edit").fill("Wynieść śmieci i szkło");
    await page.keyboard.press("Enter");
    await expect(v.locator(".task", { hasText: "Wynieść śmieci i szkło" })).toBeVisible();

    await expect.poll(async () => (await dumpDb(request)).todo_lists[0].tasks.map((t) => [t.text, !!t.done]))
      .toEqual([["Umyć podłogę", true], ["Wynieść śmieci i szkło", false]]);

    await v.getByRole("button", { name: /Usuń odhaczone/ }).click();
    await expect(v.locator(".task")).toHaveCount(1);
    await v.locator(".task").getByRole("button", { name: "Usuń" }).click();
    await expect(v.getByText("Ta lista jest pusta")).toBeVisible();
  });

  test("pusta lista po przeładowaniu nie psuje widoku (stary bug: Firebase kasuje puste tablice)", async ({ page }) => {
    await openApp(page);
    await openFromMenu(page, "Zadania");
    await page.fill("#todo-input", "Nowa pusta");
    await page.keyboard.press("Enter");
    await expect(view(page, "todo").locator(".row", { hasText: "Nowa pusta" })).toBeVisible();
    await page.reload();
    await expect(page.locator("#sync")).toHaveAttribute("data-status", "live");
    await openFromMenu(page, "Zadania");
    await expect(view(page, "todo").locator(".row", { hasText: "Nowa pusta" })).toContainText("pusta");
  });

  test("usunięcie listy z zadaniami wymaga potwierdzenia", async ({ page, request }) => {
    await resetDb(request, { todo_lists: [{ id: "l1", name: "Dom", tasks: [{ id: "t1", text: "x", done: false }] }] });
    await openApp(page);
    await openFromMenu(page, "Zadania");
    const row = view(page, "todo").locator(".row", { hasText: "Dom" });
    await row.getByRole("button", { name: /Usuń listę/ }).click();
    await page.getByRole("button", { name: "Anuluj" }).click();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: /Usuń listę/ }).click();
    await page.locator(".dialog [data-confirm]").click();
    await expect(view(page, "todo").getByText("Nie masz jeszcze żadnej listy")).toBeVisible();
    await expect.poll(async () => (await dumpDb(request))?.todo_lists ?? null).toBeNull();
  });

  test("tekst z HTML-em wyświetla się jako tekst (bez psucia strony)", async ({ page }) => {
    await openApp(page);
    await openFromMenu(page, "Zadania");
    await page.fill("#todo-input", `<img src=x onerror="window.__xss=1"> & "lista"`);
    await page.keyboard.press("Enter");
    await expect(view(page, "todo").locator(".row-title").first()).toHaveText(`<img src=x onerror="window.__xss=1"> & "lista"`);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });
});

// ============================================================== KALENDARZ

test.describe("Kalendarz", () => {
  test("dodawanie, sortowanie po godzinie, edycja i usuwanie wydarzeń", async ({ page, request }) => {
    await openApp(page);
    await openFromMenu(page, "Kalendarz");
    const v = view(page, "calendar");
    await expect(v.locator("#cal-month-label")).toHaveText("Listopad 2026");
    await expect(v.locator(".day.today")).toHaveText("10");

    await v.locator('.day[data-date="2026-11-12"]').click();
    await expect(v.locator(".view-title")).toHaveText("Czwartek, 12 listopada 2026");
    await page.fill("#cal-time-input", "18:00"); await page.fill("#cal-title-input", "Kino"); await page.keyboard.press("Enter");
    await page.fill("#cal-time-input", "09:30"); await page.fill("#cal-title-input", "Dentysta"); await v.getByRole("button", { name: "Dodaj" }).click();
    await page.fill("#cal-title-input", "Urodziny"); await page.keyboard.press("Enter");
    await expect(v.locator(".event-title")).toHaveText(["Dentysta", "Kino", "Urodziny"]);
    await expect(v.locator(".event-time").last()).toHaveText("cały dzień");

    await v.locator(".event", { hasText: "Kino" }).getByRole("button", { name: "Edytuj" }).click();
    await v.locator(".event input[type=text]").fill("Kino IMAX");
    await page.keyboard.press("Enter");
    await expect(v.locator(".event-title")).toContainText(["Kino IMAX"]);

    await expect.poll(async () => ((await dumpDb(request)).calendar_events["2026-11-12"] || []).map((e) => e.title).sort())
      .toEqual(["Dentysta", "Kino IMAX", "Urodziny"]);

    await v.locator(".view-back").click();
    await expect(v.locator('.day[data-date="2026-11-12"] .dots i')).toHaveCount(3);
    await expect(v.locator(".row", { hasText: "Dentysta" })).toContainText("09:30");

    await v.locator('.day[data-date="2026-11-12"]').click();
    for (let i = 0; i < 3; i++) await v.locator(".event").first().getByRole("button", { name: "Usuń" }).click();
    await expect(v.getByText("Nic zaplanowanego tego dnia")).toBeVisible();
    await expect.poll(async () => (await dumpDb(request))?.calendar_events ?? null).toBeNull();
  });

  test("nawigacja po miesiącach i przycisk Dziś", async ({ page }) => {
    await openApp(page);
    await openFromMenu(page, "Kalendarz");
    const v = view(page, "calendar");
    await v.getByRole("button", { name: "Następny miesiąc" }).click();
    await expect(v.locator("#cal-month-label")).toHaveText("Grudzień 2026");
    await v.getByRole("button", { name: "Następny miesiąc" }).click();
    await expect(v.locator("#cal-month-label")).toHaveText("Styczeń 2027");
    await v.getByRole("button", { name: "Dziś" }).click();
    await expect(v.locator("#cal-month-label")).toHaveText("Listopad 2026");
  });
});



// ============================================================== GŁOS

test.describe("Polecenia głosowe", () => {
  async function say(page, text) {
    await page.evaluate((t) => {
      class FakeSR {
        start() {
          setTimeout(() => {
            this.onresult?.({ results: [Object.assign([{ transcript: t }], { isFinal: true })] });
            this.onend?.();
          }, 20);
        }
        stop() {}
      }
      window.SpeechRecognition = FakeSR;
    }, text);
    await page.locator("#voice-btn").click();
  }

  test("kalendarz, zadanie i zakupy z mikrofonu", async ({ page, request }) => {
    await openApp(page);
    await say(page, "dentysta w środę o 15:30");
    await expect(page.locator("#voice-bubble")).toContainText("Dentysta");
    await expect(page.locator("#voice-bubble")).toContainText("15:30");

    await say(page, "dodaj umyć okna w kategorii dom");
    await expect(page.locator("#voice-bubble")).toContainText("nowa lista");

    await say(page, "dodaj mleko i chleb do listy zakupów");
    await expect(page.locator("#voice-bubble")).toContainText("mleko, chleb");

    await say(page, "co tam słychać");
    await expect(page.locator("#voice-bubble")).toContainText("Nie zrozumiałem");

    await expect.poll(async () => {
      const db = await dumpDb(request);
      return [db.calendar_events?.["2026-11-11"]?.[0], db.todo_lists?.[0], db.shopping_list?.map((i) => i.text)];
    }).toEqual([
      expect.objectContaining({ title: "Dentysta", time: "15:30" }),
      expect.objectContaining({ name: "dom", tasks: [expect.objectContaining({ text: "umyć okna" })] }),
      ["mleko", "chleb"],
    ]);
    await expect(page.locator("#home-events")).toContainText("Dentysta");
  });
});


// ============================================================== USTAWIENIA

test("ustawienia: zmiana układu ekranu jest zapamiętana na urządzeniu", async ({ page }) => {
  await openApp(page);
  await openFromMenu(page, "Ustawienia");
  await view(page, "settings").getByRole("button", { name: "Pionowo" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-layout", "portrait");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-layout", "portrait");
  await openFromMenu(page, "Ustawienia");
  await view(page, "settings").getByRole("button", { name: "Automatycznie" }).click();
  const expected = await page.evaluate(() => (matchMedia("(orientation: portrait)").matches ? "portrait" : "landscape"));
  await expect(page.locator("html")).toHaveAttribute("data-layout", expected);
});
