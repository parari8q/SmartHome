// PRZEPISY — szybkie dodawanie (screen/zdjecie/tekst -> automatyczny podzial na
// skladniki i kroki), zdjecia dan, wyszukiwarka, tryb gotowania, lista zakupow.

import { store } from "../store.js";
import * as R from "../logic/recipes.js";
import * as S from "../logic/shopping.js";
import { parseRecipeText, linesToList, listToLines } from "../logic/recipe-parser.js";
import { recognizeImages } from "../lib/ocr.js";
import { getRecipePhoto, saveRecipePhoto, deleteRecipePhoto, compressImage } from "../photos.js";
import { h, clear, ICONS, iconButton, emptyState, confirmDialog, promptDialog, toast } from "../lib/dom.js";
import { plural, uid } from "../lib/util.js";
import { registerView } from "./router.js";
import { notifyGroup } from "../notify.js";

let shell;
let screen = "categories";
let entry = "categories";
let catId = null, scId = null, recipeId = null;
let selection = new Set();
let searchQuery = "";
let cooking = false;
const checked = new Map(); // recipeId -> Set("i3", "s1") odhaczone skladniki/kroki (tylko na tym urzadzeniu)
let pendingImport = null;
let editingShopping = null; // indeks edytowanej pozycji listy zakupow   // { files, text } — np. udostepnione z galerii telefonu

const FORM_SCREENS = new Set(["form", "move", "shoppingPick"]);
const DRAFT_KEY = "recipe_draft";
const data = () => store.recipes.value;
const saveRecipes = (next) => store.recipes.set("", next);
const shopping = () => store.shopping.value;
const saveShopping = (next) => store.shopping.set("", next);

function go(next) { screen = next; render(); }

function render() {
  if (!shell) return;
  shell.setActions();
  shell.footer.replaceChildren();
  shell.body.classList.toggle("cooking", screen === "detail" && cooking);
  (SCREENS[screen] || SCREENS.categories)();
}

const deleteBtn = (label, onClick) => iconButton("trash", label, (e) => { e.stopPropagation(); onClick(); }, "icon-btn icon-btn-subtle");

/** Miniatura zdjecia ladowana w tle. */
function photoThumb(recipe, cls = "thumb") {
  const el = h("span", { class: cls + " thumb-empty", html: ICONS.recipes });
  if (recipe.photo || recipe.image) {
    getRecipePhoto(recipe).then((src) => { if (src) el.replaceWith(h("img", { class: cls, src, alt: "" })); });
  }
  return el;
}

function recipeRow(r, label) {
  return h("div", { class: "row row-link recipe-row", role: "button", tabindex: "0", dataset: { recipeId: r.id },
    onclick: () => { catId = r.catId || catId; scId = r.scId || scId; recipeId = r.id; cooking = false; go("detail"); } },
    photoThumb(r),
    h("span", { class: "row-main" }, h("span", { class: "row-title" }, r.name),
      h("span", { class: "row-sub" }, label || [`${r.ingredients.length} składn.`, r.steps.length ? `${r.steps.length} ${plural(r.steps.length, "krok", "kroki", "kroków")}` : "", r.time].filter(Boolean).join(" · "))),
    h("span", { class: "icon chev", html: ICONS.next }));
}

function newRecipe(target = {}) {
  recipeId = null;
  if (target.catId) { catId = target.catId; scId = target.scId; }
  go("form");
}

const SCREENS = {
  categories() {
    shell.setTitle("Przepisy");
    shell.setActions(iconButton("plus", "Nowa kategoria", async () => {
      const name = await promptDialog("Nazwa nowej kategorii", { placeholder: "np. Dieta PCOS" });
      if (name) saveRecipes(R.addCategory(data(), name));
    }));
    const d = data();
    const results = h("div", { class: "rows", id: "recipe-search-results" });
    const list = h("div", {});
    const search = h("input", { type: "search", id: "recipe-search", placeholder: "Szukaj przepisu albo składnika…", value: searchQuery, autocomplete: "off",
      oninput: () => { searchQuery = search.value; renderSearch(); } });

    function renderSearch() {
      const found = R.searchRecipes(data(), searchQuery);
      list.hidden = !!searchQuery.trim();
      clear(results, searchQuery.trim()
        ? (found.length ? found.map((r) => recipeRow(r, r.label)) : emptyState("Nic nie znaleziono."))
        : null);
    }

    clear(list,
      h("button", { type: "button", class: "card-link", onclick: () => go("shoppingList") },
        h("span", { class: "icon", html: ICONS.cart }),
        h("span", { class: "row-main" }, h("span", { class: "row-title" }, "Lista zakupów"), h("span", { class: "row-sub" }, shoppingSummary())),
        h("span", { class: "icon chev", html: ICONS.next })),
      h("div", { class: "section-label" }, "Kategorie"),
      !store.recipes.loaded ? emptyState("Łączenie z bazą…")
        : d.categories.length === 0 ? emptyState("Nie masz jeszcze przepisów. Dodaj pierwszy — kategoria utworzy się sama.")
        : h("div", { class: "rows" }, d.categories.map((cat) =>
          h("div", { class: "row row-link", role: "button", tabindex: "0", onclick: () => { catId = cat.id; go("subcategories"); } },
            h("span", { class: "row-title" }, cat.name),
            h("span", { class: "badge badge-muted" }, String(R.countRecipes(cat))),
            deleteBtn("Usuń kategorię " + cat.name, async () => {
              if (await confirmDialog(`Usunąć kategorię „${cat.name}” wraz ze wszystkimi przepisami?`)) saveRecipes(R.deleteCategory(data(), cat.id));
            })))));

    clear(shell.body,
      h("button", { type: "button", class: "btn btn-primary btn-block btn-big", id: "recipe-new", onclick: () => newRecipe() },
        h("span", { class: "icon", html: ICONS.plus }), "Nowy przepis"),
      search, results, list);
    renderSearch();
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
    shell.setActions(iconButton("plus", "Nowy przepis", () => newRecipe({ catId, scId })));
    clear(shell.body, h("div", { class: "crumb" }, cat.name),
      sc.recipes.length ? h("div", { class: "rows" }, sc.recipes.map((r) => recipeRow({ ...r, catId, scId })))
        : emptyState("Brak przepisów. Dodaj pierwszy przyciskiem +."));
  },

  detail() {
    const r = R.findRecipe(data(), catId, scId, recipeId);
    if (!r) return go("list");
    shell.setTitle(r.name);
    shell.setActions(
      h("button", { type: "button", class: "btn btn-ghost btn-sm" + (cooking ? " active" : ""), id: "cooking-toggle", "aria-pressed": String(cooking),
        onclick: () => { cooking = !cooking; render(); } }, cooking ? "Zakończ gotowanie" : "Tryb gotowania"),
      iconButton("edit", "Edytuj przepis", () => go("form")));

    const done = checked.get(r.id) || new Set();
    checked.set(r.id, done);
    const toggle = (key, el) => { done.has(key) ? done.delete(key) : done.add(key); el.classList.toggle("done", done.has(key)); };

    const photo = h("div", { class: "hero-wrap" });
    if (r.photo || r.image) getRecipePhoto(r).then((src) => { if (src) clear(photo, h("img", { class: "hero-img", src, alt: r.name })); });
    else photo.append(h("label", { class: "photo-drop" }, h("span", { class: "icon", html: ICONS.image }), "Dodaj zdjęcie dania",
      h("input", { type: "file", accept: "image/*", hidden: true, onchange: async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          const version = await saveRecipePhoto(r.id, await compressImage(f));
          saveRecipes(R.updateRecipe(data(), catId, scId, r.id, { photo: version }));
          toast("Zdjęcie zapisane");
        } catch (err) { toast(err.message, 6000); }
      } })));

    const meta = [r.servings && `🍽 ${r.servings} ${plural(Number(r.servings) || 5, "porcja", "porcje", "porcji")}`, r.time && `⏱ ${r.time}`].filter(Boolean);

    clear(shell.body,
      photo,
      meta.length ? h("div", { class: "chips" }, meta.map((m) => h("span", { class: "chip" }, m))) : null,
      h("div", { class: "section-label" }, `Składniki (${r.ingredients.length})`),
      r.ingredients.length
        ? h("ul", { class: "ingredients" }, r.ingredients.map((ing, i) => R.isHeader(ing)
          ? h("li", { class: "ing-header" }, ing)
          : h("li", { class: done.has("i" + i) ? "done" : "", onclick: (e) => toggle("i" + i, e.currentTarget) }, ing)))
        : emptyState("Brak składników."),
      r.steps.length ? [
        h("div", { class: "section-label" }, `Przygotowanie (${r.steps.length} ${plural(r.steps.length, "krok", "kroki", "kroków")})`),
        h("ol", { class: "steps" }, r.steps.map((st, i) =>
          h("li", { class: done.has("s" + i) ? "done" : "", onclick: (e) => toggle("s" + i, e.currentTarget) }, h("span", { class: "step-num" }, String(i + 1)), h("span", {}, st)))),
      ] : null,
      r.notes ? [h("div", { class: "section-label" }, "Notatki"), h("div", { class: "prose" }, r.notes)] : null,
      r.source ? h("p", { class: "hint" }, "Źródło: ", /^https?:\/\//.test(r.source) ? h("a", { href: r.source, target: "_blank", rel: "noopener" }, r.source) : r.source) : null,
      h("div", { class: "button-stack" },
        h("button", { type: "button", class: "btn btn-primary", onclick: () => {
          const items = r.ingredients.filter((x) => !R.isHeader(x));
          const { list: next, added } = S.addToShopping(shopping(), items, r.name);
          saveShopping(next);
          if (items.length) notifyGroup("shopping", `składniki do „${r.name}” (${items.length})`);
          const joined = items.length - added;
          toast(`Dodano do listy zakupów: ${items.length}` + (joined ? ` (${joined} połączono z tym, co już było na liście)` : ""), 4500);
        } }, "Dodaj składniki do zakupów"),
        h("button", { type: "button", class: "btn btn-ghost", onclick: () => go("move") }, "Przenieś do innej kategorii"),
        h("button", { type: "button", class: "btn btn-ghost btn-danger-text", onclick: async () => {
          if (!(await confirmDialog(`Usunąć przepis „${r.name}”?`))) return;
          saveRecipes(R.deleteRecipe(data(), catId, scId, r.id));
          if (r.photo) deleteRecipePhoto(r.id);
          go("list");
        } }, "Usuń przepis")));
  },

  form() { renderForm(); },

  move() {
    const r = R.findRecipe(data(), catId, scId, recipeId);
    if (!r) return go("list");
    shell.setTitle("Przenieś: " + r.name);
    const d = data();
    const sel = categoryPicker(d, catId, scId);
    clear(shell.body, h("div", { class: "form" }, sel.el,
      h("button", { type: "button", class: "btn btn-primary btn-block", onclick: () => {
        const t = sel.value();
        if (!t.scId) return;
        saveRecipes(R.moveRecipe(data(), { catId, scId }, t, recipeId));
        catId = t.catId; scId = t.scId;
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
      let next = shopping();
      for (const r of all.filter((x) => selection.has(x.id))) {
        const items = r.ingredients.filter((x) => !R.isHeader(x));
        next = S.addToShopping(next, items, r.name).list;
        if (items.length) notifyGroup("shopping", `składniki do „${r.name}” (${items.length})`);
      }
      saveShopping(next);
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
    const nChecked = list.filter((i) => i.checked).length;
    const nDup = S.countDuplicates(list);
    shell.setActions(
      h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => { selection = new Set(); go("shoppingPick"); } }, "Z przepisów"),
      nChecked ? h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => saveShopping(S.removeChecked(shopping())) }, `Usuń kupione (${nChecked})`) : null);

    const row = (item, i) => h("div", { class: "row task" + (item.checked ? " done" : ""), dataset: { index: String(i) } },
      h("button", { type: "button", class: "check", "aria-label": item.checked ? "Odznacz" : "Odhacz", "aria-pressed": String(item.checked), html: ICONS.check,
        onclick: () => saveShopping(S.toggleShoppingItem(shopping(), i)) }),
      h("span", { class: "row-main shop-text", ondblclick: (e) => startShopEdit(i, e.currentTarget) },
        h("span", { class: "row-title task-text" }, item.text),
        item.recipes?.length ? h("span", { class: "row-sub shop-recipes" }, "(" + item.recipes.join(", ") + ")") : null),
      iconButton("edit", "Zmień nazwę", (e) => startShopEdit(i, e.currentTarget.parentElement.querySelector(".shop-text")), "icon-btn icon-btn-subtle"),
      iconButton("close", "Usuń", () => saveShopping(shopping().filter((_, j) => j !== i)), "icon-btn icon-btn-subtle"));

    clear(shell.body,
      nDup ? h("button", { type: "button", class: "card-link merge-card", id: "shopping-merge", onclick: () => {
        saveShopping(S.mergeDuplicates(shopping()));
        toast(`Połączono ${nDup} ${plural(nDup, "powtórkę", "powtórki", "powtórek")}`);
      } }, h("span", { class: "row-main" }, h("span", { class: "row-title" }, `Połącz powtarzające się produkty (${nDup})`),
        h("span", { class: "row-sub" }, "np. masło z dwóch przepisów — ilości się zsumują"))) : null,
      !store.shopping.loaded ? emptyState("Łączenie z bazą…")
        : list.length ? h("div", { class: "rows" }, list.map(row))
        : emptyState("Lista jest pusta — dopisz coś na dole albo wybierz przepisy."),
      list.length ? h("button", { type: "button", class: "link-btn", onclick: async () => {
        if (await confirmDialog("Wyczyścić całą listę zakupów?", { okLabel: "Wyczyść" })) saveShopping([]);
      } }, "Wyczyść całą listę") : null);

    const input = h("input", { type: "text", id: "shopping-input", placeholder: "Dopisz produkt (kilka po przecinku)…", autocomplete: "off" });
    const add = () => {
      const items = input.value.split(",").map((x) => x.trim()).filter(Boolean);
      if (!items.length) return;
      saveShopping(S.addToShopping(shopping(), items).list);
      for (const t of items) notifyGroup("shopping", t);
      input.value = "";
      input.focus();
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
    shell.footer.append(h("div", { class: "input-bar" }, input, h("button", { type: "button", class: "btn btn-primary", onclick: add }, "Dodaj")));
  },
};

/** Zmiana nazwy pozycji na liscie zakupow (w miejscu). */
function startShopEdit(index, el) {
  const item = shopping()[index];
  if (!item || !el) return;
  editingShopping = index;
  const input = h("input", { type: "text", class: "inline-edit", id: "shopping-edit", value: item.text });
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    editingShopping = null;
    if (commit && input.value.trim() && input.value.trim() !== item.text) saveShopping(S.renameItem(shopping(), index, input.value));
    render();
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); });
  input.addEventListener("blur", () => finish(true));
  el.replaceWith(input);
  input.focus();
  input.select();
}

// ======================================================================= FORMULARZ

function categoryPicker(d, selCat, selSc) {
  const catSel = h("select", { id: "form-cat", "aria-label": "Kategoria" });
  const scSel = h("select", { id: "form-sc", "aria-label": "Podkategoria" });
  const NEW = "__new__";
  const fillCats = (selected) => {
    catSel.replaceChildren(...d.categories.map((c) => h("option", { value: c.id, selected: c.id === selected }, c.name)),
      h("option", { value: NEW }, d.categories.length ? "+ Nowa kategoria…" : "Moje przepisy (nowa)"));
  };
  const fillSubs = (selected) => {
    const c = R.findCategory(d, catSel.value);
    scSel.replaceChildren(...(c ? c.subcategories : []).map((s) => h("option", { value: s.id, selected: s.id === selected }, s.name)));
    scSel.hidden = !c || !c.subcategories.length;
  };
  fillCats(selCat || d.categories[0]?.id);
  fillSubs(selSc);
  catSel.addEventListener("change", async () => {
    if (catSel.value === NEW && d.categories.length) {
      const name = await promptDialog("Nazwa nowej kategorii", { placeholder: "np. Obiady" });
      if (name) {
        const next = R.addCategory(data(), name);
        saveRecipes(next);
        d = next;
        fillCats(next.categories.at(-1).id);
      } else fillCats(d.categories[0]?.id);
    }
    fillSubs();
  });
  return {
    el: h("div", { class: "picker" }, h("label", { class: "field-label" }, "Kategoria"), h("div", { class: "picker-row" }, catSel, scSel)),
    value: () => ({ catId: catSel.value === NEW ? null : catSel.value, scId: scSel.hidden ? null : scSel.value }),
  };
}

function readDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch { return null; }
}

function renderForm() {
  const editing = recipeId ? R.findRecipe(data(), catId, scId, recipeId) : null;
  if (recipeId && !editing) return go("list");
  shell.setTitle(editing ? "Edytuj przepis" : "Nowy przepis");

  const draft = !editing ? readDraft() : null;
  const src = editing || draft || {};
  let photoData = draft?.photoData || null; // nowe zdjecie (dataURL) do zapisania
  let photoRemoved = false;

  const field = (tag, id, props = {}) => h(tag, { id, autocomplete: "off", ...props });
  const name = field("input", "recipe-name", { type: "text", placeholder: "np. Owsianka bananowa", value: src.name || "" });
  const servings = field("input", "recipe-servings", { type: "text", inputmode: "numeric", placeholder: "np. 2", value: src.servings || "" });
  const time = field("input", "recipe-time", { type: "text", placeholder: "np. 30 min", value: src.time || "" });
  const ingredients = field("textarea", "recipe-ingredients", { rows: 7, placeholder: "- 2 jajka\n- 1 banan\n- pół szklanki płatków" });
  ingredients.value = draft?.ingredientsText ?? listToLines(src.ingredients);
  const steps = field("textarea", "recipe-steps", { rows: 7, placeholder: "1. Płatki zalej mlekiem.\n2. Gotuj 5 minut.\n3. Dodaj banana." });
  steps.value = draft?.stepsText ?? listToLines(src.steps, "steps");
  const notes = field("textarea", "recipe-notes", { rows: 2, placeholder: "Wskazówki, zamienniki…" });
  notes.value = src.notes || "";
  const source = field("input", "recipe-source", { type: "text", placeholder: "Link albo skąd przepis (opcjonalnie)", value: src.source || "" });
  const picker = categoryPicker(data(), draft?.catId || catId, draft?.scId || scId);

  // ---- zdjecie dania
  const preview = h("div", { class: "photo-preview" });
  const showPhoto = (dataUrl) => {
    clear(preview, dataUrl
      ? [h("img", { class: "hero-img", src: dataUrl, alt: "" }),
         h("button", { type: "button", class: "link-btn", onclick: () => { photoData = null; photoRemoved = true; showPhoto(null); saveDraft(); } }, "Usuń zdjęcie")]
      : h("label", { class: "photo-drop", id: "photo-pick" }, h("span", { class: "icon", html: ICONS.image }), "Dodaj zdjęcie dania",
          h("input", { type: "file", accept: "image/*", hidden: true, id: "photo-input", onchange: async (e) => {
            const f = e.target.files[0];
            e.target.value = "";
            if (!f) return;
            try { photoData = await compressImage(f); photoRemoved = false; showPhoto(photoData); saveDraft(); }
            catch (err) { toast(err.message); }
          } })));
  };
  if (photoData) showPhoto(photoData);
  else if (editing && (editing.photo || editing.image)) {
    showPhoto(null);
    getRecipePhoto(editing).then((p) => { if (p && !photoData && !photoRemoved) clear(preview, h("img", { class: "hero-img", src: p, alt: "" }),
      h("button", { type: "button", class: "link-btn", onclick: () => { photoRemoved = true; showPhoto(null); } }, "Usuń zdjęcie")); });
  } else showPhoto(null);

  // ---- import ze screena / tekstu
  const progress = h("div", { class: "ocr-progress", hidden: true }, h("div", { class: "bar" }, h("i")), h("span", { class: "hint" }));
  const rawText = h("textarea", { id: "recipe-raw", rows: 6, placeholder: "Wklej tu tekst przepisu (ze strony, Worda, wiadomości)…" });
  const rawBox = h("div", { class: "raw-box", hidden: true }, rawText,
    h("div", { class: "button-row" },
      h("button", { type: "button", class: "btn btn-primary", id: "recipe-parse", onclick: () => {
        // ponowne rozpoznanie poprawionego tekstu zastepuje skladniki i kroki zamiast je dublowac
        if (rawText.dataset.fromImport) { ingredients.value = ""; steps.value = ""; }
        applyParsed(rawText.value);
      } }, "Rozpoznaj składniki i kroki"),
      h("button", { type: "button", class: "btn btn-ghost", onclick: () => { rawBox.hidden = true; } }, "Zamknij")));

  const setProgress = (p, label) => {
    progress.hidden = p == null;
    progress.querySelector("i").style.width = Math.round((p || 0) * 100) + "%";
    progress.querySelector("span").textContent = label || "";
  };

  function applyParsed(text) {
    const parsed = parseRecipeText(text);
    const found = [];
    if (parsed.name && !name.value.trim()) { name.value = parsed.name; found.push("nazwę"); }
    if (parsed.servings && !servings.value.trim()) servings.value = parsed.servings;
    if (parsed.time && !time.value.trim()) time.value = parsed.time;
    if (parsed.ingredients.length) {
      const cur = linesToList(ingredients.value);
      ingredients.value = listToLines([...cur, ...parsed.ingredients]);
      found.push(`${parsed.ingredients.length} ${plural(parsed.ingredients.length, "składnik", "składniki", "składników")}`);
    }
    if (parsed.steps.length) {
      const cur = linesToList(steps.value);
      steps.value = listToLines([...cur, ...parsed.steps], "steps");
      found.push(`${parsed.steps.length} ${plural(parsed.steps.length, "krok", "kroki", "kroków")}`);
    }
    if (parsed.notes && !notes.value.trim()) notes.value = parsed.notes;
    rawText.value = text;
    const showRaw = document.getElementById("show-raw");
    if (showRaw) showRaw.hidden = false;
    saveDraft();
    toast(found.length ? `Rozpoznano: ${found.join(", ")} — sprawdź i popraw w razie potrzeby` : "Nie udało się rozpoznać przepisu — popraw tekst poniżej i spróbuj jeszcze raz", 5000);
    if (!found.length) rawBox.hidden = false;
  }

  async function importImages(files) {
    files = [...files].filter((f) => f && f.type.startsWith("image/"));
    if (!files.length) return;
    setProgress(0, "Wczytywanie…");
    try {
      const text = await recognizeImages(files, setProgress);
      setProgress(null);
      rawText.dataset.fromImport = "1";
      applyParsed(text);
    } catch (err) {
      setProgress(null);
      toast(err.message || "Nie udało się rozpoznać tekstu", 6000);
    }
  }

  const importCard = h("div", { class: "import-card" },
    h("div", { class: "import-title" }, "Dodaj szybko"),
    h("div", { class: "import-buttons" },
      h("label", { class: "import-btn", id: "import-screens" },
        h("span", { class: "icon", html: ICONS.image }),
        h("span", {}, h("b", {}, "Ze screena lub zdjęcia"), h("small", {}, "możesz wybrać kilka naraz")),
        h("input", { type: "file", accept: "image/*", multiple: true, hidden: true, id: "import-input", onchange: (e) => { importImages(e.target.files); e.target.value = ""; } })),
      h("button", { type: "button", class: "import-btn", id: "import-text", onclick: () => { rawBox.hidden = false; rawText.focus(); } },
        h("span", { class: "icon", html: ICONS.edit }),
        h("span", {}, h("b", {}, "Wklej tekst"), h("small", {}, "ze strony albo wiadomości")))),
    h("p", { class: "hint desktop-only" }, "Na komputerze możesz też wkleić screen skrótem Ctrl+V albo przeciągnąć tu pliki."),
    progress,
    h("button", { type: "button", class: "link-btn", id: "show-raw", hidden: true, onclick: () => { rawBox.hidden = false; rawText.focus(); } },
      "Pokaż odczytany tekst (popraw, jeśli coś jest źle, i rozpoznaj ponownie)"),
    rawBox);

  // ---- szkic (zeby nic nie przepadlo przy zamknieciu)
  function collect() {
    return {
      name: name.value, servings: servings.value, time: time.value, notes: notes.value, source: source.value,
      ingredientsText: ingredients.value, stepsText: steps.value, ...picker.value(), photoData,
    };
  }
  function saveDraft() {
    if (editing) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(collect())); }
    catch { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...collect(), photoData: null })); } catch {} }
  }
  const clearDraft = () => localStorage.removeItem(DRAFT_KEY);

  async function save() {
    const n = name.value.trim();
    if (!n) { name.focus(); toast("Podaj nazwę przepisu."); return; }
    const saveBtn = document.getElementById("recipe-save");
    saveBtn.disabled = true;
    let d = data();
    let target = picker.value();
    if (!target.catId || !target.scId) {
      const t = R.ensureDefaultTarget(d);
      d = t.data;
      if (!target.catId) target = { catId: t.catId, scId: t.scId };
      else target.scId = R.findCategory(d, target.catId)?.subcategories[0]?.id || t.scId;
    }
    const fields = {
      name: n,
      ingredients: linesToList(ingredients.value),
      steps: linesToList(steps.value),
      servings: servings.value.trim(),
      time: time.value.trim(),
      notes: notes.value.trim(),
      source: source.value.trim(),
    };
    const id = editing ? editing.id : uid();
    try {
      if (photoData) fields.photo = await saveRecipePhoto(id, photoData);
      else if (photoRemoved) { fields.photo = null; fields.image = null; if (editing?.photo) deleteRecipePhoto(id); }
      else if (editing?.image && !editing.photo) {
        // przenosimy stare zdjecie z wnetrza przepisu do osobnego miejsca
        try { fields.photo = await saveRecipePhoto(id, editing.image); fields.image = null; } catch {}
      }
    } catch (err) {
      toast(err.message + " Przepis zapisuję bez zdjęcia.", 7000);
    }

    if (editing) {
      d = R.updateRecipe(d, catId, scId, id, fields);
      if (target.catId !== catId || target.scId !== scId) d = R.moveRecipe(d, { catId, scId }, target, id);
    } else {
      d = R.addRecipe(d, target.catId, target.scId, fields, id);
      notifyGroup("recipes", fields.name, { recipeId: id });
    }
    saveRecipes(d);
    clearDraft();
    catId = target.catId; scId = target.scId; recipeId = id;
    toast(editing ? "Zapisano zmiany" : "Przepis zapisany");
    cooking = false;
    go("detail");
  }

  const form = h("form", { class: "form recipe-form", onsubmit: (e) => { e.preventDefault(); save(); }, oninput: saveDraft, onchange: saveDraft },
    !editing ? importCard : null,
    draft && !editing && (draft.name || draft.ingredientsText) ? h("div", { class: "draft-note" }, "Przywrócono niezapisany szkic. ",
      h("button", { type: "button", class: "link-btn", onclick: () => { clearDraft(); render(); } }, "Zacznij od nowa")) : null,
    h("label", { class: "field-label", for: "recipe-name" }, "Nazwa"), name,
    h("div", { class: "two-cols" },
      h("div", {}, h("label", { class: "field-label", for: "recipe-servings" }, "Porcje"), servings),
      h("div", {}, h("label", { class: "field-label", for: "recipe-time" }, "Czas"), time)),
    picker.el,
    h("div", { class: "field-label" }, "Zdjęcie dania"), preview,
    h("label", { class: "field-label", for: "recipe-ingredients" }, "Składniki — każdy w osobnej linii"), ingredients,
    h("label", { class: "field-label", for: "recipe-steps" }, "Kroki — każdy w osobnej linii"), steps,
    h("details", { class: "more" }, h("summary", {}, "Notatki i źródło"),
      h("label", { class: "field-label", for: "recipe-notes" }, "Notatki"), notes,
      h("label", { class: "field-label", for: "recipe-source" }, "Źródło"), source),
    editing ? null : h("p", { class: "hint" }, "Szkic zapisuje się sam — możesz zamknąć i wrócić później."));

  // wklejanie screena (Ctrl+V) i przeciaganie plikow
  form.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.items || [])].filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile());
    if (!files.length) return;
    e.preventDefault();
    importImages(files);
  });
  form.addEventListener("dragover", (e) => { e.preventDefault(); form.classList.add("dragging"); });
  form.addEventListener("dragleave", () => form.classList.remove("dragging"));
  form.addEventListener("drop", (e) => { e.preventDefault(); form.classList.remove("dragging"); importImages(e.dataTransfer.files); });

  clear(shell.body, form);
  shell.footer.append(h("div", { class: "input-bar" },
    h("button", { type: "button", class: "btn btn-primary btn-block", id: "recipe-save", style: { marginTop: "0" }, onclick: save }, editing ? "Zapisz zmiany" : "Zapisz przepis")));

  if (pendingImport) {
    const { files, text } = pendingImport;
    pendingImport = null;
    if (files?.length) importImages(files);
    else if (text) applyParsed(text);
  }
}

function shoppingSummary() {
  const list = shopping();
  const left = list.filter((i) => !i.checked).length;
  if (!list.length) return "pusta";
  return `${left} do kupienia${list.length - left ? `, ${list.length - left} kupione` : ""}`;
}

/** Otworz formularz nowego przepisu i od razu rozpoznaj pliki/tekst
 *  (uzywane przy "Udostepnij" z galerii telefonu). */
export function importIntoNewRecipe({ files = [], text = "" }) {
  pendingImport = { files, text };
  recipeId = null;
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
    const rerender = () => { if (shell.isOpen() && !FORM_SCREENS.has(screen) && editingShopping == null) render(); };
    store.recipes.subscribe(rerender);
    store.shopping.subscribe(rerender);
    store.recipes.onStatus((st) => shell.setStatus(st.error || ""));
  },
  onOpen(startScreen = "categories", openRecipeId = null) {
    cooking = false;
    if (startScreen === "recipe") {
      // z powiadomienia: konkretny przepis (wstecz -> lista jego podkategorii)
      const r = R.allRecipes(data()).find((x) => x.id === openRecipeId);
      entry = "categories";
      if (r) { catId = r.catId; scId = r.scId; recipeId = r.id; screen = "detail"; }
      else screen = "categories";
    } else {
      screen = entry = startScreen;
    }
    render();
  },
  onClose() { cooking = false; },
  back() {
    if (screen === entry || screen === "categories") return false;
    if (screen === "form") { go(recipeId ? "detail" : (scId && catId && entry !== "form" && R.findSubcategory(data(), catId, scId) ? "list" : "categories")); return true; }
    if (screen === "detail" && !R.findSubcategory(data(), catId, scId)) { go("categories"); return true; }
    go(BACK[screen] || "categories");
    return true;
  },
});
