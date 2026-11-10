// ZADANIA — kilka list, w kazdej pozycje do odhaczenia.

import { store } from "../store.js";
import * as T from "../logic/todo.js";
import { h, clear, ICONS, iconButton, emptyState, confirmDialog, inputBar } from "../lib/dom.js";
import { plural, uid } from "../lib/util.js";
import { registerView } from "./router.js";
import { notifyGroup } from "../notify.js";

let shell;
let listId = null;    // null = ekran wszystkich list
let editingId = null; // id edytowanego zadania (wtedy nie przerysowujemy na zmiany z zewnatrz)
let bar;

const lists = () => store.todo.value;
const save = (next) => store.todo.set("", next);

function render() {
  if (!shell) return;
  if (editingId) return;
  const all = lists();
  const list = listId && all.find((l) => l.id === listId);
  if (listId && !list) listId = null;

  if (!list) {
    shell.setTitle("Zadania");
    shell.setActions();
    bar.input.placeholder = "Nazwa nowej listy…";
    if (!store.todo.loaded) return clear(shell.body, emptyState("Łączenie z bazą…"));
    if (!all.length) return clear(shell.body, emptyState("Nie masz jeszcze żadnej listy — dodaj pierwszą na dole."));
    clear(shell.body, h("div", { class: "rows" }, all.map((l) => {
      const open = T.openCount(l);
      return h("div", { class: "row row-link", role: "button", tabindex: "0", dataset: { listId: l.id },
        onclick: () => { listId = l.id; render(); },
        onkeydown: (e) => { if (e.key === "Enter") { listId = l.id; render(); } } },
        h("span", { class: "row-main" }, h("span", { class: "row-title" }, l.name),
          h("span", { class: "row-sub" }, l.tasks.length ? `${open} ${plural(open, "otwarte", "otwarte", "otwartych")} z ${l.tasks.length}` : "pusta")),
        h("span", { class: "badge" + (open ? "" : " badge-muted") }, String(open)),
        iconButton("trash", "Usuń listę " + l.name, async (e) => {
          e.stopPropagation();
          const n = l.tasks.length;
          if (n && !(await confirmDialog(`Usunąć listę „${l.name}” razem z ${n} ${plural(n, "pozycją", "pozycjami", "pozycjami")}?`))) return;
          save(T.deleteList(lists(), l.id));
        }, "icon-btn icon-btn-subtle"));
    })));
    return;
  }

  shell.setTitle(list.name);
  bar.input.placeholder = "Nowa pozycja…";
  const done = list.tasks.filter((t) => t.done).length;
  shell.setActions(done ? h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => save(T.clearDone(lists(), list.id)) }, `Usuń odhaczone (${done})`) : null);

  if (!list.tasks.length) return clear(shell.body, emptyState("Ta lista jest pusta — dodaj pierwszą pozycję na dole."));

  clear(shell.body, h("div", { class: "rows" }, T.sortedTasks(list).map((task) =>
    h("div", { class: "row task" + (task.done ? " done" : ""), dataset: { taskId: task.id } },
      h("button", { type: "button", class: "check", "aria-label": task.done ? "Odznacz" : "Odhacz", "aria-pressed": String(task.done), html: ICONS.check,
        onclick: () => save(T.toggleTask(lists(), list.id, task.id)) }),
      h("span", { class: "row-title task-text", title: "Kliknij dwukrotnie, aby edytować", ondblclick: (e) => startEdit(list.id, task, e.currentTarget) }, task.text),
      iconButton("edit", "Edytuj", (e) => startEdit(list.id, task, e.currentTarget.parentElement.querySelector(".task-text")), "icon-btn icon-btn-subtle"),
      iconButton("close", "Usuń", () => save(T.deleteTask(lists(), list.id, task.id)), "icon-btn icon-btn-subtle")))));
}

function startEdit(lId, task, textEl) {
  editingId = task.id;
  const input = h("input", { type: "text", class: "inline-edit", value: task.text });
  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    editingId = null;
    if (commit && input.value.trim() && input.value.trim() !== task.text) save(T.editTask(lists(), lId, task.id, input.value));
    render();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  textEl.replaceWith(input);
  input.focus();
  input.select();
}

registerView({
  id: "todo",
  title: "Zadania",
  mount(s) {
    shell = s;
    bar = inputBar({
      id: "todo-input",
      placeholder: "Nazwa nowej listy…",
      onSubmit: (value) => {
        if (listId) {
          const taskId = uid("task_");
          save(T.addTask(lists(), listId, value, taskId));
          notifyGroup("todo", `${value} (${lists().find((l) => l.id === listId)?.name || "lista"})`, { listId, taskId });
        } else {
          const newId = uid("list_");
          save(T.createList(lists(), value, newId));
          notifyGroup("todo", `nowa lista „${value}”`, { listId: newId });
        }
      },
    });
    shell.footer.append(bar.el);
    store.todo.subscribe(() => { if (shell.isOpen()) render(); });
    store.todo.onStatus((st) => shell.setStatus(st.error || ""));
  },
  onOpen(openListId = null) {
    listId = openListId;
    editingId = null;
    render();
  },
  back() {
    if (listId) { listId = null; editingId = null; render(); return true; }
    return false;
  },
});
