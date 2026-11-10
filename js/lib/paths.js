// Operacje na sciezkach w drzewie danych — dokladnie tak, jak robi to
// Firebase Realtime Database (null = usuniecie wezla).

export function splitPath(path) {
  if (Array.isArray(path)) return path.map(String);
  return String(path || "").split("/").filter(Boolean);
}

export function getAtPath(root, path) {
  let cur = root;
  for (const key of splitPath(path)) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[key];
  }
  return cur;
}

function isEmptyContainer(v) {
  if (Array.isArray(v)) return v.every((x) => x == null);
  if (v && typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

/** Zwraca NOWE drzewo z ustawiona wartoscia (oryginal nie jest modyfikowany).
 *  value null/undefined usuwa wezel; puste rodzicielskie obiekty znikaja,
 *  tak jak w Firebase. */
export function setAtPath(root, path, value) {
  const parts = splitPath(path);
  if (parts.length === 0) return value == null ? null : value;

  const [key, ...rest] = parts;
  const base = root && typeof root === "object" ? root : {};
  const copy = Array.isArray(base) ? base.slice() : { ...base };
  const child = setAtPath(base[key], rest, value);

  if (child == null || isEmptyContainer(child)) {
    if (Array.isArray(copy) && /^\d+$/.test(key)) copy[Number(key)] = null;
    else delete copy[key];
  } else {
    if (Array.isArray(copy) && !/^\d+$/.test(key)) {
      // klucz nienumeryczny w tablicy — Firebase traktuje to jak obiekt
      const obj = { ...copy };
      obj[key] = child;
      return obj;
    }
    copy[key] = child;
  }
  return isEmptyContainer(copy) ? null : copy;
}

/** Zastosuj zdarzenie ze strumienia Firebase ("put" albo "patch"). */
export function applyFirebaseEvent(root, type, path, data) {
  if (type === "put") return setAtPath(root, path, data);
  if (type === "patch") {
    let next = root;
    for (const [k, v] of Object.entries(data || {})) {
      next = setAtPath(next, [...splitPath(path), ...splitPath(k)], v);
    }
    return next;
  }
  return root;
}

/** Postac danych "po przejsciu przez Firebase": bez nulli i pustych
 *  kontenerow. Uzywane do porownania naszego zapisu z echem z serwera. */
export function firebaseClean(v) {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) {
    const out = v.map(firebaseClean);
    while (out.length && out[out.length - 1] == null) out.pop();
    return out.length ? out : null;
  }
  if (typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      const c = firebaseClean(val);
      if (c != null) out[k] = c;
    }
    return Object.keys(out).length ? out : null;
  }
  return v;
}
