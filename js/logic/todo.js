// Zadania: [{ id, name, tasks: [{ id, text, done }] }]
// (ten sam format co dotad w bazie pod "todo_lists")

import { asArray, clone, uid } from "../lib/util.js";

export function normalizeTodoLists(raw) {
  return asArray(raw)
    .filter((l) => l && typeof l === "object")
    .map((l) => ({
      id: String(l.id || uid("list_")),
      name: String(l.name ?? ""),
      // Firebase kasuje puste tablice — bez tego nowa, pusta lista
      // wywalala caly ekran po odswiezeniu strony.
      tasks: asArray(l.tasks)
        .filter((t) => t && typeof t === "object")
        .map((t) => ({ id: String(t.id || uid("task_")), text: String(t.text ?? ""), done: !!t.done })),
    }));
}

export function findListByName(lists, name) {
  const n = String(name).trim().toLocaleLowerCase("pl");
  return lists.find((l) => l.name.trim().toLocaleLowerCase("pl") === n) || null;
}

export function createList(lists, name, id = uid("list_")) {
  const next = clone(lists);
  next.push({ id, name: name.trim(), tasks: [] });
  return next;
}

export function renameList(lists, listId, name) {
  return clone(lists).map((l) => (l.id === listId ? { ...l, name: name.trim() } : l));
}

export function deleteList(lists, listId) {
  return clone(lists).filter((l) => l.id !== listId);
}

export function addTask(lists, listId, text, id = uid("task_")) {
  const next = clone(lists);
  const list = next.find((l) => l.id === listId);
  if (!list) return next;
  list.tasks.push({ id, text: text.trim(), done: false });
  return next;
}

/** Dodaj zadanie do listy o danej nazwie; utworz liste, jesli jej nie ma
 *  (uzywane przez polecenia glosowe). */
export function addTaskToNamedList(lists, listName, text) {
  let next = clone(lists);
  let list = findListByName(next, listName);
  if (!list) {
    next = createList(next, listName);
    list = next[next.length - 1];
  }
  return { lists: addTask(next, list.id, text), listId: list.id, created: !findListByName(lists, listName) };
}

function mapTask(lists, listId, taskId, fn) {
  const next = clone(lists);
  const list = next.find((l) => l.id === listId);
  if (!list) return next;
  list.tasks = list.tasks.map((t) => (t.id === taskId ? fn(t) : t)).filter(Boolean);
  return next;
}

export function toggleTask(lists, listId, taskId) {
  return mapTask(lists, listId, taskId, (t) => ({ ...t, done: !t.done }));
}

export function editTask(lists, listId, taskId, text) {
  const trimmed = text.trim();
  if (!trimmed) return clone(lists);
  return mapTask(lists, listId, taskId, (t) => ({ ...t, text: trimmed }));
}

export function deleteTask(lists, listId, taskId) {
  return mapTask(lists, listId, taskId, () => null);
}

export function clearDone(lists, listId) {
  const next = clone(lists);
  const list = next.find((l) => l.id === listId);
  if (list) list.tasks = list.tasks.filter((t) => !t.done);
  return next;
}

export function openCount(list) {
  return list.tasks.filter((t) => !t.done).length;
}

/** Nieodhaczone na gorze, odhaczone na dole (kolejnosc dodania zachowana). */
export function sortedTasks(list) {
  return [...list.tasks.filter((t) => !t.done), ...list.tasks.filter((t) => t.done)];
}
