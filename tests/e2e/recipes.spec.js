// Przepisy: szybkie dodawanie ze screena/tekstu, zdjecia dan, wyszukiwarka,
// tryb gotowania, lista zakupow.
import { test, expect } from "@playwright/test";
import { openApp, resetDb, dumpDb, openFromMenu, view, DB, login } from "./helpers.js";
import { fileURLToPath } from "node:url";

const IMG = fileURLToPath(new URL("../../icon-192.png", import.meta.url));

const OCR_TEXT = `17:05 ⚡ 87%
Udostępnij
Owsianka bananowa
Porcje: 2
Czas przygotowania: 15 min
Składniki
• 1 szklanka płatków owsianych
• 2 szklanki mleka
• 1 banan
Przygotowanie
1. Płatki zalej mlekiem i gotuj
około 5 minut.
2. Dodaj pokrojonego banana.`;

/** Atrapa rozpoznawania tekstu (prawdziwy Tesseract pobiera sie z internetu). */
async function mockOcr(page, texts = [OCR_TEXT]) {
  await page.addInitScript((list) => {
    let i = 0;
    window.__ocrCalls = 0;
    window.Tesseract = {
      recognize: async (_img, lang, opts) => {
        window.__ocrCalls++;
        window.__ocrLang = lang;
        opts?.logger?.({ status: "recognizing text", progress: 0.5 });
        await new Promise((r) => setTimeout(r, 50));
        return { data: { text: list[Math.min(i++, list.length - 1)] } };
      },
    };
  }, texts);
}

const v = (page) => view(page, "recipes");

test.beforeEach(async ({ request }) => { await resetDb(request); });

test("screen przepisu → automatycznie nazwa, porcje, czas, składniki i kroki → zapis (bez kategorii)", async ({ page, request }) => {
  await mockOcr(page);
  await openApp(page);
  await openFromMenu(page, "Przepisy");
  await page.click("#recipe-new");
  await expect(v(page).locator(".view-title")).toHaveText("Nowy przepis");

  await page.setInputFiles("#import-input", IMG);
  await expect(page.locator("#recipe-name")).toHaveValue("Owsianka bananowa");
  await expect(page.locator("#recipe-servings")).toHaveValue("2");
  await expect(page.locator("#recipe-time")).toHaveValue("15 min");
  await expect(page.locator("#recipe-ingredients")).toHaveValue("- 1 szklanka płatków owsianych\n- 2 szklanki mleka\n- 1 banan");
  await expect(page.locator("#recipe-steps")).toHaveValue("1. Płatki zalej mlekiem i gotuj około 5 minut.\n2. Dodaj pokrojonego banana.");
  await expect(page.locator("#toast")).toContainText("3 składniki, 2 kroki");
  expect(await page.evaluate(() => window.__ocrLang)).toBe("pol+eng");

  await page.click("#recipe-save");
  // widok przepisu: skladniki z myslnikami, ponumerowane kroki
  await expect(v(page).locator(".view-title")).toHaveText("Owsianka bananowa");
  await expect(v(page).locator(".ingredients li")).toHaveText(["1 szklanka płatków owsianych", "2 szklanki mleka", "1 banan"]);
  await expect(v(page).locator(".steps li")).toHaveText(["1Płatki zalej mlekiem i gotuj około 5 minut.", "2Dodaj pokrojonego banana."]);
  await expect(v(page).locator(".chip")).toHaveText(["🍽 2 porcje", "⏱ 15 min"]);

  const db = await dumpDb(request);
  const cat = db.recipes_data.categories[0];
  expect(cat.name).toBe("Moje przepisy"); // utworzona sama
  const r = cat.subcategories[0].recipes[0];
  expect(r).toMatchObject({ name: "Owsianka bananowa", servings: "2", time: "15 min", steps: ["Płatki zalej mlekiem i gotuj około 5 minut.", "Dodaj pokrojonego banana."] });
});

test("kilka screenów naraz są łączone w jeden przepis", async ({ page }) => {
  await mockOcr(page, ["Gulasz\nSkładniki\n1 kg wołowiny\n2 cebule", "3 papryki\nPrzygotowanie\n1. Obsmaż mięso.\n2. Duś godzinę."]);
  await openApp(page);
  await openFromMenu(page, "Przepisy");
  await page.click("#recipe-new");
  await page.setInputFiles("#import-input", [IMG, IMG]);
  await expect(page.locator("#recipe-ingredients")).toHaveValue("- 1 kg wołowiny\n- 2 cebule\n- 3 papryki");
  await expect(page.locator("#recipe-steps")).toHaveValue("1. Obsmaż mięso.\n2. Duś godzinę.");
  expect(await page.evaluate(() => window.__ocrCalls)).toBe(2);
});

test("wklejony tekst też jest rozpoznawany", async ({ page }) => {
  await openApp(page);
  await openFromMenu(page, "Przepisy");
  await page.click("#recipe-new");
  await page.click("#import-text");
  await page.fill("#recipe-raw", "Naleśniki\nSkładniki:\n- 200 g mąki\n- 2 jajka\nWykonanie:\nWszystko zmiksuj i smaż.");
  await page.click("#recipe-parse");
  await expect(page.locator("#recipe-name")).toHaveValue("Naleśniki");
  await expect(page.locator("#recipe-ingredients")).toHaveValue("- 200 g mąki\n- 2 jajka");
  await expect(page.locator("#recipe-steps")).toHaveValue("1. Wszystko zmiksuj i smaż.");
});

test("zdjęcie dania zapisuje się w bazie osobno i pokazuje przy przepisie (też po przeładowaniu)", async ({ page, request }) => {
  await openApp(page);
  await openFromMenu(page, "Przepisy");
  await page.click("#recipe-new");
  await page.fill("#recipe-name", "Sałatka");
  await page.fill("#recipe-ingredients", "pomidor\nogórek");
  await page.setInputFiles("#photo-input", IMG);
  await expect(page.locator(".photo-preview img")).toBeVisible();
  await page.click("#recipe-save");
  await expect(v(page).locator(".hero-img")).toBeVisible();

  await expect.poll(async () => (await dumpDb(request)).recipes_data?.categories?.length).toBe(1);
  const db = await dumpDb(request);
  const r = db.recipes_data.categories[0].subcategories[0].recipes[0];
  expect(typeof r.photo).toBe("number");
  expect(r.image).toBeUndefined(); // nie w srodku przepisu
  expect(db.recipe_photos.shared[r.id]).toMatch(/^data:image\/jpeg;base64,/);

  await page.reload();
  await expect(page.locator("#sync")).toHaveAttribute("data-status", "live");
  await openFromMenu(page, "Przepisy");
  await page.fill("#recipe-search", "sałat");
  await expect(v(page).locator(".recipe-row img.thumb")).toBeVisible(); // miniatura na liscie
  await v(page).locator(".recipe-row").click();
  await expect(v(page).locator(".hero-img")).toBeVisible();
});

test("zalogowany: zdjęcia w przestrzeni konta (recipe_photos/<uid>)", async ({ page, request }) => {
  await request.post(DB + "/__auth?mode=peruser&owner=uid-ja");
  await openApp(page, { expectStatus: "auth" });
  await login(page, "ja@example.com");
  await expect(page.locator("#sync")).toHaveAttribute("data-status", "live");
  await openFromMenu(page, "Przepisy");
  await page.click("#recipe-new");
  await page.fill("#recipe-name", "Placki");
  await page.setInputFiles("#photo-input", IMG);
  await expect(page.locator(".photo-preview img")).toBeVisible();
  await page.click("#recipe-save");
  await expect(v(page).locator(".hero-img")).toBeVisible();
  await expect.poll(async () => (await dumpDb(request)).users?.["uid-ja"]?.recipes_data?.categories?.length).toBe(1);
  const db = await dumpDb(request);
  const r = db.users["uid-ja"].recipes_data.categories[0].subcategories[0].recipes[0];
  expect(db.recipe_photos["uid-ja"][r.id]).toMatch(/^data:image/);
});

test("szkic nie przepada po zamknięciu formularza", async ({ page }) => {
  await openApp(page);
  await openFromMenu(page, "Przepisy");
  await page.click("#recipe-new");
  await page.fill("#recipe-name", "Niedokończony");
  await page.fill("#recipe-ingredients", "- mąka");
  await v(page).locator(".view-back").click();
  await page.click("#recipe-new");
  await expect(page.locator("#recipe-name")).toHaveValue("Niedokończony");
  await expect(page.locator(".draft-note")).toBeVisible();
  await page.locator(".draft-note .link-btn").click();
  await expect(page.locator("#recipe-name")).toHaveValue("");
});

test("widok przepisu: odhaczanie, tryb gotowania, edycja, przeniesienie, zakupy, usunięcie", async ({ page, request }) => {
  await resetDb(request, { recipes_data: { categories: [{ id: "c", name: "Dieta", subcategories: [{ id: "s1", name: "Obiad", recipes: [
    { id: "r1", name: "Makaron", ingredients: ["Na sos:", "pomidory", "czosnek"], instructions: "1. Ugotuj makaron.\n2. Zrób sos." }] }, { id: "s2", name: "Kolacja" }] }] } });
  await openApp(page);
  await openFromMenu(page, "Przepisy");
  await page.fill("#recipe-search", "czosnek"); // szukanie po skladniku
  await v(page).locator(".recipe-row", { hasText: "Makaron" }).click();

  await expect(v(page).locator(".ing-header")).toHaveText("Na sos:");
  await expect(v(page).locator(".steps li")).toHaveCount(2); // stary format "instructions" -> kroki
  await v(page).locator(".steps li").first().click();
  await expect(v(page).locator(".steps li").first()).toHaveClass(/done/);
  await page.click("#cooking-toggle");
  await expect(v(page).locator(".view-body")).toHaveClass(/cooking/);

  await v(page).getByRole("button", { name: "Dodaj składniki do zakupów" }).click();
  await expect(page.locator("#toast")).toContainText("Dodano do listy zakupów: 2"); // bez "Na sos:"

  await v(page).getByRole("button", { name: "Edytuj przepis" }).click();
  await page.fill("#recipe-name", "Makaron z sosem");
  await page.selectOption("#form-sc", { label: "Kolacja" }); // zmiana kategorii przy edycji
  await page.click("#recipe-save");
  await expect(v(page).locator(".view-title")).toHaveText("Makaron z sosem");

  await expect.poll(async () => (await dumpDb(request)).recipes_data.categories[0].subcategories[1].recipes?.length).toBe(1);
  let db = await dumpDb(request);
  expect(db.recipes_data.categories[0].subcategories[1].recipes[0]).toMatchObject({ name: "Makaron z sosem", steps: ["Ugotuj makaron.", "Zrób sos."] });
  expect(db.shopping_list.map((i) => i.text)).toEqual(["pomidory", "czosnek"]);

  await v(page).getByRole("button", { name: "Usuń przepis" }).click();
  await page.locator(".dialog [data-confirm]").click();
  await expect.poll(async () => (await dumpDb(request)).recipes_data.categories[0].subcategories[1].recipes ?? []).toEqual([]);
});

test("kategorie: dodawanie, nowa kategoria z formularza, usuwanie z potwierdzeniem", async ({ page, request }) => {
  await openApp(page);
  await openFromMenu(page, "Przepisy");
  await v(page).getByRole("button", { name: "Nowa kategoria" }).click();
  await page.locator(".dialog input").fill("Desery");
  await page.keyboard.press("Enter");
  await v(page).locator(".row", { hasText: "Desery" }).click();
  await expect(v(page).locator(".row-title")).toHaveText(["Śniadanie", "Obiad", "Kolacja", "Deser"]);
  await v(page).locator(".row", { hasText: "Deser" }).last().click();
  await v(page).getByRole("button", { name: "Nowy przepis" }).click();
  await expect(page.locator("#form-sc option:checked")).toHaveText("Deser"); // podpowiada biezaca kategorie
  await page.fill("#recipe-name", "Sernik");
  await page.click("#recipe-save");
  await v(page).locator(".view-back").click();
  await expect(v(page).locator(".recipe-row", { hasText: "Sernik" })).toBeVisible();
  await expect.poll(async () => (await dumpDb(request)).recipes_data.categories[0].subcategories[3].recipes?.length).toBe(1);
  const db = await dumpDb(request);
  expect(db.recipes_data.categories[0].subcategories[3].recipes[0].name).toBe("Sernik");
});

test("udostępnianie z galerii telefonu otwiera nowy przepis i rozpoznaje zdjęcie", async ({ page }) => {
  await mockOcr(page);
  await openApp(page);
  // to robi service worker po "Udostepnij" -> Dashboard
  await page.evaluate(async () => {
    const png = await (await fetch("icon-192.png")).blob();
    const c = await caches.open("share-inbox");
    await c.put(new URL("share-inbox/img-0", location.href).href, new Response(png, { headers: { "Content-Type": "image/png" } }));
  });
  await page.goto("/dashboard.html?shared=1");
  await expect(view(page, "recipes")).toHaveClass(/open/);
  await expect(page.locator("#recipe-name")).toHaveValue("Owsianka bananowa");
  await expect(page).toHaveURL(/dashboard\.html$/);
});

test("lista zakupów: z przepisów, ręcznie, odhaczanie i usuwanie kupionych", async ({ page, request }) => {
  await resetDb(request, { recipes_data: { categories: [{ id: "c", name: "K", subcategories: [{ id: "s", name: "Obiad", recipes: [
    { id: "a", name: "Naleśniki", ingredients: ["mąka", "mleko", "jajka"] }, { id: "b", name: "Omlet", ingredients: ["Jajka", "ser"] }] }] }] } });
  await openApp(page);
  await openFromMenu(page, "Zakupy");
  await expect(v(page).getByText("Lista jest pusta")).toBeVisible();
  await v(page).getByRole("button", { name: "Z przepisów" }).click();
  await v(page).locator(".check-row", { hasText: "Naleśniki" }).click();
  await v(page).locator(".check-row", { hasText: "Omlet" }).click();
  await v(page).getByRole("button", { name: /Dodaj składniki z 2/ }).click();
  await expect(v(page).locator(".task-text")).toHaveText(["mąka", "mleko", "jajka", "ser"]);
  await page.fill("#shopping-input", "chleb, masło");
  await page.keyboard.press("Enter");
  await v(page).locator(".task", { hasText: "mleko" }).getByRole("button", { name: "Odhacz" }).click();
  await v(page).getByRole("button", { name: /Usuń kupione \(1\)/ }).click();
  await expect(v(page).locator(".task-text")).toHaveText(["mąka", "jajka", "ser", "chleb", "masło"]);
  await expect.poll(async () => (await dumpDb(request)).shopping_list.length).toBe(5);
  await v(page).locator(".view-back").click();
  await expect(page.locator("#home-shopping")).toContainText("5 pozycji do kupienia");
});

test("tabelka ze strony: złe odczytanie ilości można poprawić w odczytanym tekście (bez dublowania)", async ({ page }) => {
  await page.addInitScript(() => {
    window.__params = null;
    window.Tesseract = {
      createWorker: async () => ({
        setParameters: async (p) => { window.__params = p; },
        recognize: async () => ({ data: { text: "Zupa z dyni\nSkładniki\ndynia hokkaido 1 kg\nbulion warzywny 1151\nPrzygotowanie\n1. Gotuj 20 minut." } }),
      }),
    };
  });
  await openApp(page);
  await openFromMenu(page, "Przepisy");
  await page.click("#recipe-new");
  await page.setInputFiles("#import-input", IMG);
  await expect(page.locator("#recipe-ingredients")).toHaveValue("- dynia hokkaido – 1 kg\n- bulion warzywny – 1151");
  expect(await page.evaluate(() => window.__params)).toMatchObject({ tessedit_pageseg_mode: "4", preserve_interword_spaces: "1" });

  await page.click("#show-raw");
  const raw = page.locator("#recipe-raw");
  await raw.fill((await raw.inputValue()).replace("1151", "1 1/5 l"));
  await page.click("#recipe-parse");
  await expect(page.locator("#recipe-ingredients")).toHaveValue("- dynia hokkaido – 1 kg\n- bulion warzywny – 1 1/5 l");
  await expect(page.locator("#recipe-steps")).toHaveValue("1. Gotuj 20 minut.");
});
