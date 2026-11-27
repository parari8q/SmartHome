// Zmiany na liscie zakupow z mozliwoscia cofniecia (przycisk "Cofnij", Ctrl+Z).
// Historia jest na tym urzadzeniu, w pamieci strony (do przeladowania).

import { store } from "./store.js";
import { UndoStack } from "./logic/undo.js";
import { deepEqual } from "./lib/util.js";
import { toast, confirmDialog } from "./lib/dom.js";

const stack = new UndoStack(30);
const listeners = new Set();
const emit = () => { for (const fn of listeners) { try { fn(stack.size); } catch (e) { console.error(e); } } };

export function onUndoChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const canUndo = () => stack.size > 0;

/** Zapisz nowa liste i zapamietaj poprzednia, zeby dalo sie cofnac. */
export function saveShoppingUndoable(next, label, { quiet = false } = {}) {
  const before = store.shopping.value;
  if (deepEqual(before, next)) return;
  stack.push({ before, after: next, label });
  store.shopping.set("", next);
  emit();
  if (!quiet) toast(label, null, { label: "Cofnij", onClick: () => undoShopping() });
}

export async function undoShopping() {
  const entry = stack.peek();
  if (!entry) { toast("Nie ma czego cofnąć"); return false; }
  const current = store.shopping.value;
  // ktos inny (albo inne urzadzenie) zmienil liste po tej zmianie?
  if (!deepEqual(current, entry.after)) {
    const ok = await confirmDialog("Lista zmieniła się w międzyczasie (np. na innym urządzeniu). Cofnięcie przywróci stan sprzed „" + entry.label + "” i nadpisze te zmiany. Cofnąć?", { okLabel: "Cofnij", danger: false });
    if (!ok) return false;
  }
  stack.pop();
  store.shopping.set("", entry.before);
  emit();
  toast("Cofnięto: " + entry.label, null, stack.size ? { label: "Cofnij jeszcze", onClick: () => undoShopping() } : null);
  return true;
}

/** Po zmianie konta/grupy historia nie pasuje do nowej listy. */
export function clearShoppingHistory() { stack.clear(); emit(); }
