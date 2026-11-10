// PRZEPISY — kategorie -> podkategorie -> przepisy, plus lista zakupow.

import { store } from "../store.js";
import * as R from "../logic/recipes.js";
import { h, clear, ICONS, iconButton, emptyState, confirmDialog, promptDialog, toast } from "../lib/dom.js";
import { registerView } from "./router.js";

let shell;
let screen = "categories";
let catId = null, scId = null, recipeId = null;
let pendingImage = null;
let selection = new Set();
let entry = "categories"; // ekran, od ktorego otwarto widok

const FORM_SCREENS = new Set(["form", "move", "shoppingPick"]);
const data = () => store.recipes.value;
const saveRecipes = (next) => store.recipes.set("", next);
const shopping = () => store.shopping.value;
const saveShopping = (next) => store.shopping.set("", next);

function go(next) { screen = next; render(); }

function render() {
  if (!shell) return;
  shell.setActions();
  shell.footer.replaceChildren();
  const fn = SCREENS[screen] || SCREENS.categories;
  fn();
}

const deleteBtn = (label, onClick) => iconButton("trash", label, (e) => { e.stopPropagation(); onClick(); }, "icon-btn icon-btn-subtle");

const SCREENS = {
  categories() {
    shell.setTitle("Przepisy");
    shell.setActions(iconButton("plus", "Nowa kategoria", async () => {
      const name = await promptDialog("Nazwa nowej kategorii", { placeholder: "np. Dieta PCOS" });
      if (name) saveRecipes(R.addCategory(data(), name));
    }));
    const d = data();
    clear(shell.body,
      h("button", { type: "button", class: "card-link", onclick: () => go("shoppingList") },
        h("span", { class: "icon", html: ICONS.cart }),
        h("span", { class: "row-main" }, h("span", { class: "row-title" }, "Lista zakupów"),
          h("span", { class: "row-sub" }, shoppingSummary())),
        h("span", { class: "icon chev", html: ICONS.next })),
      h("div", { class: "section-label" }, "Kategorie"),
      !store.recipes.loaded ? emptyState("Łączenie z bazą…")
        : d.categories.length === 0 ? emptyState("Brak kategorii. Dodaj pierwszą przyciskiem +.")
        : h("div", { class: "rows" }, d.categories.map((cat) =>
          h("div", { class: "row row-link", role: "button", tabindex: "0", onclick: () => { catId = cat.id; go("subcategories"); } },
            h("span", { class: "row-title" }, cat.name),
            h("span", { class: "badge badge-muted" }, String(R.countRecipes(cat))),
            deleteBtn("Usuń kategorię " + cat.name, async () => {
              if (await confirmDialog(`Usunąć kategorię „${cat.name}” wraz ze wszystkimi przepisami?`)) saveRecipes(R.deleteCategory(data(), cat.id));
            })))));
  },

  subcategories() {
    const cat = R.findCategory(data(), catId);
    if (!cat) return go("categories");
    shell.setTitle(cat.name);
    shell.setActions(iconButton("plus", "Nowa podkategoria", async () => {
      const name = await promptDialog("Nazwa nowej podkategorii", { placeholder: "np. Przekąski" });
      if (name) saveRecipes(R.addSubcategory(data(), cat.id, name));
    }));
    clear(shell.body, cat.subcategories.length ? h("div", { class: "rows" }, cat.subcategories.map((sc) =>
      h("div", { class: "row row-link", role: "button", tabindex: "0", onclick: () => { scId = sc.id; go("list"); } },
        h("span", { class: "row-title" }, sc.name),
        h("span", { class: "badge badge-muted" }, String(sc.recipes.length)),
        deleteBtn("Usuń podkategorię " + sc.name, async () => {
          if (await confirmDialog(`Usunąć podkategorię „${sc.name}” wraz z przepisami?`)) saveRecipes(R.deleteSubcategory(data(), cat.id, sc.id));
        })))) : emptyState("Brak podkategorii. Dodaj pierwszą przyciskiem +."));
  },

  list() {
    const cat = R.findCategory(data(), catId);
    const sc = R.findSubcategory(data(), catId, scId);
    if (!cat || !sc) return go("categories");
    shell.setTitle(sc.name);
    shell.setActions(iconButton("plus", "Nowy przepis", () => { recipeId = null; pendingImage = null; go("form"); }));
    clear(shell.body, h("div", { class: "crumb" }, cat.name),
      sc.recipes.length ? h("div", { class: "rows" }, sc.recipes.map((r) =>
        h("div", { class: "row row-link", role: "button", tabindex: "0", onclick: () => { recipeId = r.id; go("detail"); } },
          r.image ? h("img", { class: "thumb", src: r.image, alt: "" }) : null,
          h("span", { class: "row-main" }, h("span", { class: "row-title" }, r.name),
            h("span", { class: "row-sub" }, `${r.ingredients.length} składników`)),
          deleteBtn("Usuń przepis " + r.name, async () => {
            if (await confirmDialog(`Usunąć przepis „${r.name}”?`)) saveRecipes(R.deleteRecipe(data(), catId, scId, r.id));
          })))) : emptyState("Brak przepisów. Dodaj pierwszy przyciskiem +."));
  },

  detail() {
    const r = R.findRecipe(data(), catId, scId, recipeId);
    if (!r) return go("list");
    shell.setTitle(r.name);
    shell.setActions(iconButton("edit", "Edytuj przepis", () => { pendingImage = r.image || null; go("form"); }));
    clear(shell.body,
      r.image ? h("img", { class: "hero-img", src: r.image, alt: r.name }) : null,
      h("div", { class: "section-label" }, "Składniki"),
      r.ingredients.length ? h("ul", { class: "ingredients" }, r.ingredients.map((i) => h("li", {}, i))) : emptyState("Brak składników."),
      r.instructions ? [h("div", { class: "section-label" }, "Przygotowanie"), h("div", { class: "prose" }, r.instructions)] : null,
      h("div", { class: "button-stack" },
        h("button", { type: "button", class: "btn btn-primary", onclick: () => {
          const before = shopping().length;
          const next = R.mergeShopping(shopping(), r.ingredients.map((text) => ({ text })));
          saveShopping(next);
          toast(`Dodano do listy zakupów: ${next.length - before}`);
        } }, "Dodaj składniki do zakupów"),
        h("button", { type: "button", class: "btn btn-ghost", onclick: () => go("move") }, "Przenieś do innej kategorii"),
        h("button", { type: "button", class: "btn btn-ghost btn-danger-text", onclick: async () => {
          if (!(await confirmDialog(`Usunąć przepis „${r.name}”?`))) return;
          saveRecipes(R.deleteRecipe(data(), catId, scId, r.id));
          go("list");
        } }, "Usuń przepis")));
  },

  form() {
    const editing = recipeId ? R.findRecipe(data(), catId, scId, recipeId) : null;
    if (recipeId && !editing) return go("list");
    shell.setTitle(editing ? "Edytuj przepis" : "Nowy przepis");

    const name = h("input", { type: "text", id: "recipe-name", placeholder: "np. Owsianka bananowa", value: editing?.name || "" });
    const pasted = h("textarea", { id: "recipe-pasted", rows: 3, placeholder: "Wklej tekst przepisu (z Worda, strony, Google Docs)…" });
    const ingredients = h("textarea", { id: "recipe-ingredients", rows: 6, placeholder: "2 jajka\n1 banan\npół szklanki płatków" });
    ingredients.value = (editing?.ingredients || []).join("\n");
    const instructions = h("textarea", { id: "recipe-instructions", rows: 4, placeholder: "Kroki przygotowania…" });
    instructions.value = editing?.instructions || "";
    const preview = h("img", { class: "hero-img", alt: "", hidden: !pendingImage, src: pendingImage || null });
    const removePhoto = h("button", { type: "button", class: "link-btn", hidden: !pendingImage, onclick: () => { pendingImage = null; preview.hidden = true; removePhoto.hidden = true; } }, "Usuń zdjęcie");
    const ocrStatus = h("div", { class: "hint" });

    const setPhoto = async (file) => {
      try {
        pendingImage = await compressImage(file);
        preview.src = pendingImage; preview.hidden = false; removePhoto.hidden = false;
      } catch { toast("Nie udało się wczytać zdjęcia."); }
    };
    const runOcr = (file) => {
      if (typeof Tesseract === "undefined") { toast("Rozpoznawanie tekstu wymaga internetu."); return; }
      ocrStatus.textContent = "Rozpoznaję tekst ze zdjęcia… (to może chwilę potrwać)";
      Tesseract.recognize(file, "pol+eng")
        .then(({ data: { text } }) => { pasted.value = text.trim(); ocrStatus.textContent = "Gotowe — sprawdź tekst i kliknij „Rozbij na składniki”."; })
        .catch(() => { ocrStatus.textContent = "Nie udało się odczytać tekstu. Spróbuj wyraźniejszego zdjęcia."; });
    };
    const readDocx = (file) => {
      if (typeof mammoth === "undefined") { toast("Odczyt .docx wymaga internetu."); return; }
      file.arrayBuffer().then((buf) => mammoth.extractRawText({ arrayBuffer: buf }))
        .then((res) => { pasted.value = res.value.trim(); })
        .catch(() => toast("Nie udało się odczytać pliku .docx."));
    };
    const fileBtn = (label, accept, onFile) => h("label", { class: "btn btn-ghost btn-file" }, label,
      h("input", { type: "file", accept, hidden: true, onchange: (e) => { const f = e.target.files[0]; if (f) onFile(f); e.target.value = ""; } }));

    const save = () => {
      const n = name.value.trim();
      if (!n) { name.focus(); toast("Podaj nazwę przepisu."); return; }
      const fields = { name: n, ingredients: R.parseIngredients(ingredients.value), instructions: instructions.value.trim(), image: pendingImage || null };
      if (editing) {
        saveRecipes(R.updateRecipe(data(), catId, scId, recipeId, fields));
        go("detail");
      } else {
        saveRecipes(R.addRecipe(data(), catId, scId, fields));
        go("list");
      }
      pendingImage = null;
    };

    const form = h("div", { class: "form" },
      h("label", { class: "field-label", for: "recipe-name" }, "Nazwa"), name,
      h("div", { class: "field-label" }, "Zdjęcie dania (opcjonalnie)"),
      h("div", { class: "button-row" }, fileBtn("Wybierz zdjęcie", "image/*", setPhoto), removePhoto),
      preview,
      h("div", { class: "field-label" }, "Szybkie wypełnianie"),
      h("div", { class: "button-row" },
        fileBtn("Zdjęcie/screen przepisu → tekst", "image/*", runOcr),
        fileBtn("Plik .docx", ".docx", readDocx)),
      ocrStatus,
      pasted,
      h("div", { class: "button-row" }, h("button", { type: "button", class: "btn btn-ghost", onclick: () => {
        const lines = R.splitIntoIngredients(pasted.value);
        if (!lines.length) return;
        ingredients.value = [ingredients.value.trim(), ...lines].filter(Boolean).join("\n");
      } }, "Rozbij na składniki ↓")),
      h("p", { class: "hint" }, "Wskazówka: screen przepisu możesz też wkleić tu skrótem Ctrl+V."),
      h("label", { class: "field-label", for: "recipe-ingredients" }, "Składniki (każdy w osobnej linii)"), ingredients,
      h("label", { class: "field-label", for: "recipe-instructions" }, "Przygotowanie (opcjonalnie)"), instructions,
      h("button", { type: "button", class: "btn btn-primary btn-block", id: "recipe-save", onclick: save }, editing ? "Zapisz zmiany" : "Zapisz przepis"));

    form.addEventListener("paste", (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
      if (!item) return;
      e.preventDefault();
      runOcr(item.getAsFile());
    });
    clear(shell.body, form);
  },

  move() {
    const r = R.findRecipe(data(), catId, scId, recipeId);
    if (!r) return go("list");
    shell.setTitle("Przenieś: " + r.name);
    const d = data();
    const catSel = h("select", { id: "move-cat" }, d.categories.map((c) => h("option", { value: c.id, selected: c.id === catId }, c.name)));
    const scSel = h("select", { id: "move-sc" });
    const fill = () => {
      const c = R.findCategory(d, catSel.value);
      scSel.replaceChildren(...(c ? c.subcategories : []).map((s) => h("option", { value: s.id, selected: s.id === scId }, s.name)));
    };
    catSel.addEventListener("change", fill);
    fill();
    clear(shell.body, h("div", { class: "form" },
      h("label", { class: "field-label", for: "move-cat" }, "Kategoria"), catSel,
      h("label", { class: "field-label", for: "move-sc" }, "Podkategoria"), scSel,
      h("button", { type: "button", class: "btn btn-primary btn-block", onclick: () => {
        if (!scSel.value) return;
        saveRecipes(R.moveRecipe(data(), { catId, scId }, { catId: catSel.value, scId: scSel.value }, recipeId));
        catId = catSel.value; scId = scSel.value;
        go("detail");
      } }, "Przenieś tutaj")));
  },

  shoppingPick() {
    shell.setTitle("Wybierz przepisy");
    const all = R.allRecipes(data());
    if (!all.length) return clear(shell.body, emptyState("Nie masz jeszcze zapisanych przepisów."));
    const genBtn = h("button", { type: "button", class: "btn btn-primary btn-block" });
    const updateBtn = () => { genBtn.textContent = selection.size ? `Dodaj składniki z ${selection.size} do listy` : "Zaznacz przepisy"; genBtn.disabled = !selection.size; };
    genBtn.addEventListener("click", () => {
      saveShopping(R.mergeShopping(shopping(), R.buildShoppingList(all, selection)));
      selection = new Set();
      go("shoppingList");
    });
    updateBtn();
    clear(shell.body, h("div", { class: "rows" }, all.map((r) =>
      h("label", { class: "row check-row" },
        h("input", { type: "checkbox", checked: selection.has(r.id), onchange: (e) => { e.target.checked ? selection.add(r.id) : selection.delete(r.id); updateBtn(); } }),
        h("span", { class: "row-main" }, h("span", { class: "row-title" }, r.name), h("span", { class: "row-sub" }, r.label))))));
    shell.footer.append(h("div", { class: "input-bar" }, genBtn));
  },

  shoppingList() {
    shell.setTitle("Lista zakupów");
    const list = shopping();
    const checked = list.filter((i) => i.checked).length;
    shell.setActions(
      h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => { selection = new Set(); go("shoppingPick"); } }, "Z przepisów"),
      checked ? h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => saveShopping(R.removeChecked(shopping())) }, `Usuń kupione (${checked})`) : null);

    clear(shell.body,
      !store.shopping.loaded ? emptyState("Łączenie z bazą…")
        : list.length ? h("div", { class: "rows" }, list.map((item, i) =>
          h("div", { class: "row task" + (item.checked ? " done" : ""), dataset: { index: String(i) } },
            h("button", { type: "button", class: "check", "aria-label": item.checked ? "Odznacz" : "Odhacz", "aria-pressed": String(item.checked), html: ICONS.check,
              onclick: () => saveShopping(R.toggleShoppingItem(shopping(), i)) }),
            h("span", { class: "row-title task-text" }, item.text),
            iconButton("close", "Usuń", () => saveShopping(shopping().filter((_, j) => j !== i)), "icon-btn icon-btn-subtle"))))
        : emptyState("Lista jest pusta — dopisz coś na dole albo wybierz przepisy."),
      list.length ? h("button", { type: "button", class: "link-btn", onclick: async () => {
        if (await confirmDialog("Wyczyścić całą listę zakupów?", { okLabel: "Wyczyść" })) saveShopping([]);
      } }, "Wyczyść całą listę") : null);

    const input = h("input", { type: "text", id: "shopping-input", placeholder: "Dopisz produkt…", autocomplete: "off" });
    const add = () => {
      const v = input.value.trim();
      if (!v) return;
      saveShopping(R.mergeShopping(shopping(), v.split(",").map((text) => ({ text }))));
      input.value = "";
      input.focus();
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
    shell.footer.append(h("div", { class: "input-bar" }, input, h("button", { type: "button", class: "btn btn-primary", onclick: add }, "Dodaj")));
  },
};

function shoppingSummary() {
  const list = shopping();
  const left = list.filter((i) => !i.checked).length;
  if (!list.length) return "pusta";
  return `${left} do kupienia${list.length - left ? `, ${list.length - left} kupione` : ""}`;
}

/** Zmniejsza zdjecie przed zapisaniem w bazie (wczesniej szly pelne zdjecia
 *  z telefonu po kilka MB, co spowalnialo synchronizacje). */
export function compressImage(file, maxDim = 1000, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    img.src = url;
  });
}

const BACK = {
  subcategories: "categories", list: "subcategories", detail: "list", move: "detail",
  shoppingList: "categories", shoppingPick: "shoppingList",
};

registerView({
  id: "recipes",
  title: "Przepisy",
  mount(s) {
    shell = s;
    const rerender = () => { if (shell.isOpen() && !FORM_SCREENS.has(screen)) render(); };
    store.recipes.subscribe(rerender);
    store.shopping.subscribe(rerender);
    store.recipes.onStatus((st) => shell.setStatus(st.error || ""));
  },
  onOpen(startScreen = "categories") {
    screen = entry = startScreen;
    render();
  },
  back() {
    if (screen === entry || screen === "categories") return false;
    if (screen === "form") { go(recipeId ? "detail" : "list"); return true; }
    go(BACK[screen] || "categories");
    return true;
  },
});
