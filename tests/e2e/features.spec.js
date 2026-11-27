import { test, expect } from "@playwright/test";
import { openApp, resetDb, dumpDb, openFromMenu, view, DB, addCalendarEvent } from "./helpers.js";

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
  test("dodawanie z panelu, kolejność po godzinie, edycja i usuwanie z cofaniem", async ({ page, request }) => {
    await openApp(page);
    await openFromMenu(page, "Kalendarz");
    const v = view(page, "calendar");
    await expect(v.locator("#cal-month-label")).toHaveText("Listopad 2026");
    await expect(v.locator(".day.today .day-num")).toHaveText("10");
    await expect(v.locator(".cal-day-title")).toHaveText("Dziś, 10 listopada");

    await v.locator('.day[data-date="2026-11-12"]').click();
    await expect(v.locator(".cal-day-title")).toHaveText("Czwartek, 12 listopada");
    await addCalendarEvent(page, { title: "Kino", time: "18:00" });
    await addCalendarEvent(page, { title: "Dentysta", time: "09:30" });
    await addCalendarEvent(page, { title: "Urodziny" });
    await expect(v.locator(".cal-day .event-title")).toHaveText(["Urodziny", "Dentysta", "Kino"]); // caly dzien na gorze
    await expect(v.locator(".cal-day .event").first().locator(".event-time")).toHaveText("całydzień");
    await expect(v.locator(".cal-day .event", { hasText: "Kino" }).locator(".event-time")).toHaveText("18:0019:00"); // domyslnie 1 h
    await expect(v.locator('.day[data-date="2026-11-12"] .dots i')).toHaveCount(3);

    // edycja: szczegoly -> Edytuj
    await v.locator(".cal-day .event", { hasText: "Kino" }).click();
    await expect(page.locator(".sheet .detail-title")).toHaveText("Kino");
    await page.click("#cal-edit");
    await page.fill("#cal-quick", "Kino IMAX");
    await page.click("#cal-save");
    await expect(v.locator(".cal-day .event-title")).toContainText(["Kino IMAX"]);
    await expect.poll(async () => ((await dumpDb(request)).calendar_events["2026-11-12"] || []).map((e) => [e.title, e.time, e.end || ""]).sort())
      .toEqual([["Dentysta", "09:30", "10:30"], ["Kino IMAX", "18:00", "19:00"], ["Urodziny", "", ""]]);

    // usuwanie + cofnij
    await v.locator(".cal-day .event", { hasText: "Dentysta" }).click();
    await page.click("#cal-delete");
    await expect(v.locator(".cal-day .event")).toHaveCount(2);
    await expect(page.locator("#toast")).toContainText("Usunięto „Dentysta”");
    await page.click("#toast-action");
    await expect(v.locator(".cal-day .event")).toHaveCount(3);
    for (const t of ["Dentysta", "Kino IMAX", "Urodziny"]) {
      await v.locator(".cal-day .event", { hasText: t }).click();
      await page.click("#cal-delete");
    }
    await expect(v.getByText("Wolny dzień · dodaj coś")).toBeVisible();
    await expect.poll(async () => (await dumpDb(request))?.calendar_events ?? null).toBeNull();
  });

  test("szybkie dodawanie tekstem, powtarzanie co tydzień i usuwanie jednego wystąpienia", async ({ page, request }) => {
    await openApp(page);
    await openFromMenu(page, "Kalendarz");
    const v = view(page, "calendar");
    await page.click("#cal-add");
    await page.fill("#cal-quick", "jutro 18 trening");
    await expect(page.locator("#cal-save")).toContainText(/Trening · śr\.?, 11 lis, 18:00–19:00/);
    await page.locator('.sheet [data-repeat="week"]').click();
    await page.click("#cal-save");
    await expect(v.locator(".cal-day-title")).toHaveText("Jutro, 11 listopada");
    await expect(v.locator(".cal-day .event .row-sub")).toHaveText("co tydzień");
    for (const d of ["2026-11-18", "2026-11-25"]) await expect(v.locator(`.day[data-date="${d}"] .dots i`)).toHaveCount(1);
    await expect(v.locator('.day[data-date="2026-11-12"] .dots i')).toHaveCount(0);

    await v.locator('.day[data-date="2026-11-18"]').click();
    await v.locator(".cal-day .event").click();
    await page.click("#cal-delete");
    await page.click("#cal-del-one");
    await expect(v.locator('.day[data-date="2026-11-18"] .dots i')).toHaveCount(0);
    await expect(v.locator('.day[data-date="2026-11-25"] .dots i')).toHaveCount(1);
    await expect.poll(async () => (await dumpDb(request)).calendar_events["2026-11-11"][0]).toMatchObject({ title: "Trening", time: "18:00", end: "19:00", repeat: { freq: "week", days: [3] }, skip: { "2026-11-18": true } });
  });

  test("widoki Tydzień i Lista (zapamiętany wybór), wydarzenie kilkudniowe", async ({ page, request }) => {
    await resetDb(request, { calendar_events: {
      "2026-11-12": [{ id: "a", time: "09:30", end: "10:30", title: "Dentysta" }],
      "2026-11-14": [{ id: "b", time: "", title: "Wyjazd", to: "2026-11-16" }],
    } });
    await openApp(page);
    await openFromMenu(page, "Kalendarz");
    const v = view(page, "calendar");
    await expect(v.locator('.day[data-date="2026-11-15"] .dots i')).toHaveCount(1);
    await page.click("#cal-mode-week");
    await expect(v.locator(".week-day")).toHaveCount(7);
    await v.locator('.week-day[data-date="2026-11-12"]').click();
    await expect(v.locator(".tl-ev .event-title")).toHaveText("Dentysta");
    await v.locator('.week-day[data-date="2026-11-15"]').click();
    await expect(v.locator(".allday-ev .event-title")).toHaveText("Wyjazd");

    await page.click("#cal-mode-list");
    await expect(v.locator(".cal-group .section-label")).toHaveText([/W tym tygodniu/]); // wyjazd 14–16 zaczyna sie w tym tygodniu
    await expect(v.locator(".cal-group .event-title")).toHaveText(["Dentysta", "Wyjazd"]);
    await page.reload();
    await expect(page.locator("#sync")).toHaveAttribute("data-status", "live");
    await openFromMenu(page, "Kalendarz");
    await expect(page.locator("#cal-mode-list")).toHaveAttribute("aria-selected", "true");
  });

  test("nawigacja po miesiącach i przycisk Dziś", async ({ page }) => {
    await openApp(page);
    await openFromMenu(page, "Kalendarz");
    const v = view(page, "calendar");
    await v.getByRole("button", { name: "Dalej" }).click();
    await expect(v.locator("#cal-month-label")).toHaveText("Grudzień 2026");
    await v.getByRole("button", { name: "Dalej" }).click();
    await expect(v.locator("#cal-month-label")).toHaveText("Styczeń 2027");
    await page.click("#cal-today");
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
