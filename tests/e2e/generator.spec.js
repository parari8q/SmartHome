import { test, expect } from "@playwright/test";
import { openApp, resetDb, dumpDb, openFromMenu, view } from "./helpers.js";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "content-type": "application/json" };
const pick = (n) => ({ recipes: [RECIPES.recipes[n % RECIPES.recipes.length]] });
const RECIPES = { recipes: [
  { name: "Leczo z cukinią", description: "Szybkie i sycące.", time: "30 min", servings: 2, ingredients: ["2 cukinie", "1 cebula", "200 g kiełbasy"], steps: ["Pokrój warzywa.", "Duś 15 minut."] },
  { name: "Placki z cukinii", description: "Chrupiące.", time: "25 min", servings: 2, ingredients: ["1 cukinia", "2 jajka"], steps: ["Zetrzyj cukinię.", "Usmaż placki."] },
  { name: "Niepełny", ingredients: [], steps: [] },
] };
// kolejne zapytania dostaja kolejne przepisy (3. jest niepelny -> odrzucony)

async function mockGemini(page, calls) {
  await page.route("https://generativelanguage.googleapis.com/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = req.url();
    if (url.includes("/models?")) {
      if (!url.includes("key=dobry-klucz")) return route.fulfill({ status: 400, headers: CORS, body: JSON.stringify({ error: { message: "API key not valid" } }) });
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ models: [
        { name: "models/gemini-3.6-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3.8-flash-lite", supportedGenerationMethods: ["generateContent"] },
      ] }) });
    }
    const body = JSON.parse(req.postData() || "{}");
    calls.push({ url, key: req.headers()["x-goog-api-key"], body });
    const n = calls.length - 1;
    await new Promise((r) => setTimeout(r, 150 * n)); // odpowiedzi przychodza po kolei
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(pick(n)) }] } }] }) });
  });
}

test.beforeEach(async ({ request }) => {
  await resetDb(request, { recipes_data: { categories: [{ id: "c", name: "Obiady", subcategories: [{ id: "s", name: "Szybkie", recipes: [
    { id: "a", name: "Shakshuka", ingredients: ["4 jajka"], steps: ["Smaż."] }] }] }] } });
});

test("generator: klucz Gemini, własna kategoria, generowanie, zapis i zakupy", async ({ page, request }) => {
  const calls = [];
  await mockGemini(page, calls);
  await openApp(page);
  await openFromMenu(page, "Przepisy");
  await page.click("#recipe-generate");
  const v = view(page, "recipes");
  await expect(v.locator(".view-title")).toHaveText("Generator przepisów");

  // zly klucz -> komunikat, dobry -> generator
  await page.fill("#ai-key", "zly");
  await page.click("#ai-save");
  await expect(v.locator(".ai-setup")).toContainText("Klucz API jest nieprawidłowy");
  await page.fill("#ai-key", "dobry-klucz");
  await page.click("#ai-save");
  await expect(page.locator("#gen-run")).toBeVisible();

  await v.locator('[data-tag="Obiad"]').click();
  await v.locator('[data-tag="Do 30 min"]').click();
  await page.click("#gen-add-tag");
  await page.fill(".dialog input", "Dieta PCOS");
  await page.locator(".dialog [data-confirm]").click();
  await expect(v.locator('[data-tag="Dieta PCOS"]')).toHaveAttribute("aria-pressed", "true");
  await page.fill("#gen-have", "cukinia, feta");
  await v.getByRole("button", { name: "Mniej porcji" }).click();
  await v.getByRole("button", { name: "Mniej porcji" }).click();
  await expect(page.locator("#gen-servings")).toHaveText("2 porcje");
  await page.click("#gen-run");

  await expect(v.locator(".gen-card .gen-title")).toHaveText(["Leczo z cukinią", "Placki z cukinii"]); // niepelny odrzucony
  await expect(page.locator("#gen-run")).toHaveText(/nowe propozycje/);
  expect(calls).toHaveLength(3); // 3 rownolegle zapytania po 1 przepis
  expect(calls[0].url).toContain("gemini-3.8-flash:generateContent");
  expect(calls[0].body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "minimal" });
  expect(calls.map((c) => c.body.contents[0].parts[0].text.split("\n")[0])).toEqual(Array(3).fill("Zaproponuj jeden przepis na 2 porcje."));
  expect(calls[0].key).toBe("dobry-klucz");
  const prompt = calls[0].body.contents[0].parts[0].text;
  expect(prompt).toContain("Obiad, Do 30 min, Dieta PCOS");
  expect(prompt).toContain("cukinia, feta");
  expect(prompt).toContain("2 porcje");
  expect(prompt).toContain("Shakshuka");
  expect(calls[0].body.generationConfig.responseMimeType).toBe("application/json");

  // zapis -> kategoria "Z generatora" / "Obiad"
  await v.locator(".gen-card").first().locator(".gen-save").click();
  await expect(v.locator(".gen-card").first().locator(".gen-open")).toBeVisible();
  await expect.poll(async () => {
    const cat = (await dumpDb(request)).recipes_data.categories.find((c) => c.name === "Z generatora");
    const sc = cat && (cat.subcategories || []).find((x) => x.name === "Obiad");
    return sc && (sc.recipes || []).map((r) => [r.name, r.servings, r.ingredients.length, r.steps.length]);
  }).toEqual([["Leczo z cukinią", "2", 3, 2]]);

  await v.locator(".gen-card").nth(1).locator(".gen-shop").click();
  await expect.poll(async () => ((await dumpDb(request)).shopping_list || []).map((i) => i.text)).toEqual(["1 cukinia", "2 jajka"]);

  // otwarcie zapisanego przepisu
  await v.locator(".gen-card").first().locator(".gen-open").click();
  await expect(v.locator(".view-title")).toHaveText("Leczo z cukinią");

  // wlasna kategoria zapamietana po przeladowaniu
  await page.reload();
  await openFromMenu(page, "Przepisy");
  await page.click("#recipe-generate");
  await expect(v.locator('[data-tag="Dieta PCOS"]')).toBeVisible();
});

test("generator: Claude jako dostawca i czytelny błąd limitu", async ({ page }) => {
  let n = 0;
  await page.route("https://api.anthropic.com/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (req.url().includes("/v1/models")) return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ data: [] }) });
    expect(req.headers()["anthropic-dangerous-direct-browser-access"]).toBe("true");
    n++;
    if (n === 1) return route.fulfill({ status: 429, headers: CORS, body: "{}" });
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ content: [{ type: "text", text: "Proszę:\n```json\n" + JSON.stringify(pick(n % 2)) + "\n```" }] }) });
  });
  await openApp(page);
  await openFromMenu(page, "Przepisy");
  await page.click("#recipe-generate");
  const v = view(page, "recipes");
  await v.locator('[data-provider="claude"]').click();
  await page.fill("#ai-key", "sk-ant-test");
  await page.click("#ai-save");
  await page.click("#gen-run");
  await expect(page.locator("#gen-run")).toBeVisible();
  await expect(v.locator(".gen-card:not(.gen-skeleton)")).toHaveCount(2); // jedno z 3 zapytan dostalo 429, reszta dziala
  await expect(v.locator(".gen-foot")).toContainText("Claude");
});

test("generator: wszystkie zapytania nieudane -> komunikat; przerwanie", async ({ page }) => {
  let mode = "limit";
  await page.route("https://generativelanguage.googleapis.com/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (req.url().includes("/models?")) return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ models: [{ name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] }] }) });
    if (mode === "limit") return route.fulfill({ status: 429, headers: CORS, body: "{}" });
    await new Promise((r) => setTimeout(r, 10000)); // "wisi"
    return route.abort();
  });
  await openApp(page);
  await page.evaluate(() => localStorage.setItem("ai_settings", JSON.stringify({ provider: "gemini", key: "k" })));
  await openFromMenu(page, "Przepisy");
  await page.click("#recipe-generate");
  const v = view(page, "recipes");
  await page.click("#gen-run");
  await expect(v.locator(".gen-error")).toContainText("Wyczerpany limit Gemini");
  mode = "hang";
  await page.click("#gen-run");
  await expect(page.locator("#gen-stop")).toContainText("Przerwij");
  await expect(v.locator(".gen-skeleton")).toHaveCount(3);
  await page.click("#gen-stop");
  await expect(v.locator(".gen-error")).toContainText("Przerwano generowanie");
  await expect(page.locator("#gen-run")).toBeVisible();
});
