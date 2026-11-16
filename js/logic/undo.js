// Historia zmian do cofania (jak Ctrl+Z). Czysta logika — bez bazy i DOM.

export class UndoStack {
  constructor(limit = 30) {
    this.limit = limit;
    this.items = [];
  }

  /** Zapamietaj zmiane: stan przed, stan po i opis ("Usunięto „mleko”"). */
  push(entry) {
    this.items.push(entry);
    if (this.items.length > this.limit) this.items.shift();
  }

  pop() {
    return this.items.pop() || null;
  }

  peek() {
    return this.items[this.items.length - 1] || null;
  }

  get size() {
    return this.items.length;
  }

  clear() {
    this.items = [];
  }
}
