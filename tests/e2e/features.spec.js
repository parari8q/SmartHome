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

// ============================================================== WITAMINY

test.describe("Witaminy", () => {
  test("odhaczanie dawki, passa, przypomnienie na ekranie głównym i nagroda", async ({ page, request }) => {
    await resetDb(request, { supplements_log: { "2026-11-08": true, "2026-11-06": true } });
    await openApp(page);
    await expect(page.locator("#home-supp")).toContainText("Dziś: Żelazo");
    await expect(page.locator("#home-supp")).toContainText("Passa 2");

    await page.locator("#home-supp").click();
    const v = view(page, "supplements");
    await expect(v).toHaveClass(/open/);
    await expect(v.locator("#supp-streak")).toHaveText("Passa: 2 dni 🔥");
    await expect(v.locator('.day[data-date="2026-11-05"]')).toHaveClass(/missed/);
    await expect(v.locator('.day[data-date="2026-11-12"]')).toBeDisabled(); // przyszlosc

    await v.locator('.day[data-date="2026-11-10"]').click();
    await expect(v.locator("#supp-streak")).toHaveText("Passa: 3 dni 🔥");
    await expect(v.locator(".reward img, .reward svg")).toBeVisible(); // nieparzysta passa = nagroda
    await expect(v.locator(".reward-caption")).toContainText("3 dni z rzędu");
    await expect.poll(async () => (await dumpDb(request)).supplements_log["2026-11-10"]).toBe(true);

    await v.locator(".view-back").click();
    await expect(page.locator("#home-supp")).toHaveCount(0); // wziete = brak przypomnienia

    await page.locator("#home-supp, #menu-btn").first().click();
    await page.locator(".tile", { hasText: "Witaminy" }).click();
    await v.locator('.day[data-date="2026-11-10"]').click(); // odznaczenie
    await expect(v.locator("#supp-streak")).toHaveText("Passa: 2 dni 🔥");
    await expect.poll(async () => (await dumpDb(request)).supplements_log["2026-11-10"]).toBeUndefined();
  });

  test("reset passy po potwierdzeniu", async ({ page, request }) => {
    await resetDb(request, { supplements_log: { "2026-11-08": true } });
    await openApp(page);
    await openFromMenu(page, "Witaminy");
    await view(page, "supplements").getByRole("button", { name: "Resetuj passę" }).click();
    await page.locator(".dialog [data-confirm]").click();
    await expect(view(page, "supplements").locator("#supp-streak")).toContainText("Zacznij passę");
    await expect.poll(async () => (await dumpDb(request))?.supplements_log ?? null).toBeNull();
  });
});

// ============================================================== PRZEPISY I ZAKUPY

test.describe("Przepisy i lista zakupów", () => {
  test("kategoria → przepis → edycja → przeniesienie → zakupy", async ({ page, request }) => {
    await openApp(page);
    await openFromMenu(page, "Przepisy");
    const v = view(page, "recipes");

    await v.getByRole("button", { name: "Nowa kategoria" }).click();
    await page.locator(".dialog input").fill("Dieta PCOS");
    await page.keyboard.press("Enter");
    await v.locator(".row", { hasText: "Dieta PCOS" }).click();
    await expect(v.locator(".row-title")).toHaveText(["Śniadanie", "Obiad", "Kolacja", "Deser"]);

    await v.locator(".row", { hasText: "Śniadanie" }).click();
    await v.getByRole("button", { name: "Nowy przepis" }).click();
    await page.fill("#recipe-name", "Owsianka");
    await page.fill("#recipe-pasted", "- płatki owsiane\n- banan, mleko");
    await v.getByRole("button", { name: /Rozbij na składniki/ }).click();
    await expect(page.locator("#recipe-ingredients")).toHaveValue("płatki owsiane\nbanan\nmleko");
    await page.fill("#recipe-instructions", "Ugotuj.");
    await page.click("#recipe-save");

    await v.locator(".row", { hasText: "Owsianka" }).click();
    await expect(v.locator(".ingredients li")).toHaveText(["płatki owsiane", "banan", "mleko"]);
    await expect(v.locator(".prose")).toHaveText("Ugotuj.");

    await v.getByRole("button", { name: "Edytuj przepis" }).click();
    await page.fill("#recipe-name", "Owsianka bananowa");
    await page.click("#recipe-save");
    await expect(v.locator(".view-title")).toHaveText("Owsianka bananowa");

    await v.getByRole("button", { name: "Przenieś do innej kategorii" }).click();
    await page.selectOption("#move-sc", { label: "Kolacja" });
    await v.getByRole("button", { name: "Przenieś tutaj" }).click();
    await v.locator(".view-back").click();
    await expect(v.locator(".view-title")).toHaveText("Kolacja");
    await expect(v.locator(".row", { hasText: "Owsianka bananowa" })).toBeVisible();

    await v.locator(".row", { hasText: "Owsianka bananowa" }).click();
    await v.getByRole("button", { name: "Dodaj składniki do zakupów" }).click();
    await expect(page.locator("#toast")).toContainText("Dodano do listy zakupów: 3");

    const db = await dumpDb(request);
    const cat = db.recipes_data.categories[0];
    expect(cat.subcategories.find((s) => s.name === "Kolacja").recipes[0].name).toBe("Owsianka bananowa");
    expect(db.shopping_list.map((i) => i.text)).toEqual(["płatki owsiane", "banan", "mleko"]);
  });

  test("lista zakupów: z przepisów, ręcznie, odhaczanie i usuwanie kupionych", async ({ page, request }) => {
    await resetDb(request, { recipes_data: { categories: [{ id: "c", name: "K", subcategories: [{ id: "s", name: "Obiad", recipes: [
      { id: "a", name: "Naleśniki", ingredients: ["mąka", "mleko", "jajka"] }, { id: "b", name: "Omlet", ingredients: ["Jajka", "ser"] }] }] }] } });
    await openApp(page);
    await openFromMenu(page, "Zakupy");
    const v = view(page, "recipes");
    await expect(v.getByText("Lista jest pusta")).toBeVisible();

    await v.getByRole("button", { name: "Z przepisów" }).click();
    await v.locator(".check-row", { hasText: "Naleśniki" }).click();
    await v.locator(".check-row", { hasText: "Omlet" }).click();
    await v.getByRole("button", { name: /Dodaj składniki z 2/ }).click();
    await expect(v.locator(".task-text")).toHaveText(["mąka", "mleko", "jajka", "ser"]); // bez duplikatu "Jajka"

    await page.fill("#shopping-input", "chleb, masło");
    await page.keyboard.press("Enter");
    await expect(v.locator(".task")).toHaveCount(6);

    await v.locator(".task", { hasText: "mleko" }).getByRole("button", { name: "Odhacz" }).click();
    await v.getByRole("button", { name: /Usuń kupione \(1\)/ }).click();
    await expect(v.locator(".task-text")).toHaveText(["mąka", "jajka", "ser", "chleb", "masło"]);
    await expect.poll(async () => (await dumpDb(request)).shopping_list.length).toBe(5);

    await v.locator(".view-back").click(); // otwarte z menu "Zakupy" => zamyka
    await expect(v).not.toHaveClass(/open/);
    await expect(page.locator("#home-shopping")).toContainText("5 pozycji do kupienia");
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

// ============================================================== SPOTIFY

test.describe("Spotify", () => {
  test("bez logowania pokazuje przycisk logowania", async ({ page }) => {
    await openApp(page);
    await openFromMenu(page, "Spotify");
    await expect(page.locator("#spotify-login")).toBeVisible();
  });

  test("po zalogowaniu: co gra, sterowanie, wyszukiwanie i odtwarzanie", async ({ page }) => {
    const calls = [];
    await page.route(/api\.spotify\.com/, async (route) => {
      const url = new URL(route.request().url());
      calls.push(route.request().method() + " " + url.pathname);
      if (url.pathname === "/v1/me/player") return route.fulfill({ json: { is_playing: true, device: { name: "Telefon", volume_percent: 40 },
        item: { name: "Utwór <b>testowy</b>", artists: [{ name: "Artysta" }], album: { images: [{ url: "/icon-192.png" }] } } } });
      if (url.pathname === "/v1/search") return route.fulfill({ json: { tracks: { items: [{ id: "t1", uri: "spotify:track:t1", name: "Znaleziony", artists: [{ name: "X" }], album: { images: [] } }] }, artists: { items: [] }, albums: { items: [] }, playlists: { items: [null] } } });
      return route.fulfill({ status: 204 });
    });
    await openApp(page, { spotifyTokens: { access_token: "abc", refresh_token: "r", expires_at: Date.parse("2030-01-01") } });
    await openFromMenu(page, "Spotify");
    const v = view(page, "spotify");
    await expect(v.locator(".track-name")).toHaveText("Utwór <b>testowy</b>");
    await expect(v.locator(".track-artist")).toHaveText("Artysta");
    await expect(v.getByRole("button", { name: "Pauza" })).toBeVisible();

    await v.getByRole("button", { name: "Pauza" }).click();
    await v.getByRole("button", { name: "Następny" }).click();
    await expect.poll(() => calls).toEqual(expect.arrayContaining(["PUT /v1/me/player/pause", "POST /v1/me/player/next"]));

    await v.getByRole("button", { name: "Szukaj" }).click();
    await v.locator("input[type=search]").fill("znal");
    await v.locator(".row", { hasText: "Znaleziony" }).click();
    await expect.poll(() => calls).toContain("PUT /v1/me/player/play");
    await expect(v.locator(".player")).toBeVisible(); // po odtworzeniu wraca do odtwarzacza

    await v.getByRole("button", { name: "Szukaj" }).click();
    await expect(v.locator(".row", { hasText: "Znaleziony" })).toBeVisible(); // historia
    await v.locator(".view-back").click();
    await expect(v.locator(".player")).toBeVisible();

    await v.getByRole("button", { name: "Wyloguj" }).click();
    await expect(page.locator("#spotify-login")).toBeVisible();
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
