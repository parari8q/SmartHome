// ==========================================================================
// GRUPY — kilka osob na wspolnych danych (przepisy, zakupy, zadania, kalendarz).
//
// Baza:
//   groups/<gid>/info      { name, owner, invite, createdAt }
//   groups/<gid>/members/<uid>   kod zaproszenia uzyty przy dolaczeniu (reguly go sprawdzaja)
//   groups/<gid>/profiles/<uid>  { name, email, ntfyTopic, notify: { shopping, calendar, todo, recipes } }
//   groups/<gid>/data/...  wspolne dane grupy (ten sam format co dane konta)
//   groups/<gid>/photos/<recipeId>  zdjecia przepisow grupy
//   users/<uid>/group      id grupy, do ktorej nalezy uzytkownik (jedna grupa na osobe)
// ==========================================================================

import { DB_PATHS } from "./config.js";
import { auth, dbGet, dbPut, dbDelete, DbError } from "./db.js";

const listeners = new Set();
let current = null; // { id, info, members, profiles } albo null

const randomId = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");

export const DEFAULT_NOTIFY = { shopping: true, calendar: true, todo: true, recipes: false };

export function currentGroup() { return current; }
export function onGroupChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) { try { fn(current); } catch (e) { console.error(e); } } }

export function inviteCode(group = current) {
  return group ? `${group.id}-${group.info.invite}` : "";
}

export function inviteLink(group = current) {
  return `${location.origin}${location.pathname}?dolacz=${encodeURIComponent(inviteCode(group))}`;
}

export function parseInviteCode(text) {
  const m = String(text || "").trim().match(/([a-z0-9]{6,})-([a-z0-9]{4,})\s*$/i)
    || String(text || "").match(/dolacz=([a-z0-9]{6,})-([a-z0-9]{4,})/i);
  return m ? { gid: m[1].toLowerCase(), invite: m[2].toLowerCase() } : null;
}

/** Wczytaj grupe uzytkownika (albo null). Wywolywane przy starcie i po zmianach. */
export async function loadGroup(uid) {
  current = null;
  if (!uid) { emit(); return null; }
  let gid = null;
  try { gid = await dbGet(`users/${uid}/group`); } catch { /* brak sieci/uprawnien -> konto osobiste */ }
  if (gid) {
    try {
      const [info, members, profiles] = await Promise.all([
        dbGet(`groups/${gid}/info`), dbGet(`groups/${gid}/members`), dbGet(`groups/${gid}/profiles`),
      ]);
      if (info && members && members[uid]) current = { id: gid, info, members, profiles: profiles || {} };
    } catch (err) {
      // usunieto nas z grupy (brak dostepu) — wracamy do danych osobistych
      if (err instanceof DbError && (err.status === 401 || err.status === 403)) {
        try { await dbDelete(`users/${uid}/group`); } catch {}
      } else {
        throw err; // brak sieci: niech wywolujacy sprobuje ponownie
      }
    }
  }
  emit();
  return current;
}

export async function refreshGroup() {
  if (!current) return null;
  const gid = current.id;
  const [info, members, profiles] = await Promise.all([dbGet(`groups/${gid}/info`), dbGet(`groups/${gid}/members`), dbGet(`groups/${gid}/profiles`)]);
  current = { id: gid, info, members: members || {}, profiles: profiles || {} };
  emit();
  return current;
}

function defaultName() {
  return (auth.email || "").split("@")[0] || "Ja";
}

function newProfile(name) {
  return { name: (name || defaultName()).trim(), email: auth.email || "", ntfyTopic: "dashboard-" + randomId(20), notify: { ...DEFAULT_NOTIFY } };
}

/** Zaloz grupe i przenies do niej swoje dotychczasowe dane (kopia). */
export async function createGroup(name, myName) {
  const uid = auth.uid;
  if (!uid) throw new Error("Najpierw się zaloguj.");
  const gid = randomId(10);
  const invite = randomId(8);
  await dbPut(`groups/${gid}/info`, { name: name.trim(), owner: uid, invite, createdAt: Date.now() });
  await dbPut(`groups/${gid}/members/${uid}`, invite);
  await dbPut(`groups/${gid}/profiles/${uid}`, newProfile(myName));

  // kopia danych konta do grupy (dane konta zostaja nietkniete)
  for (const p of Object.values(DB_PATHS)) {
    const value = await dbGet(`users/${uid}/${p}`).catch(() => null);
    if (value != null) await dbPut(`groups/${gid}/data/${p}`, value);
  }
  // zdjecia przepisow
  const recipes = await dbGet(`groups/${gid}/data/${DB_PATHS.recipes}`).catch(() => null);
  for (const cat of Object.values(recipes?.categories || {})) {
    for (const sc of Object.values(cat?.subcategories || {})) {
      for (const r of Object.values(sc?.recipes || {})) {
        if (!r?.photo) continue;
        const photo = await dbGet(`recipe_photos/${uid}/${r.id}`).catch(() => null);
        if (photo) await dbPut(`groups/${gid}/photos/${r.id}`, photo).catch(() => {});
      }
    }
  }
  await dbPut(`users/${uid}/group`, gid);
  return loadGroup(uid);
}

export async function joinGroup(code, myName) {
  const uid = auth.uid;
  if (!uid) throw new Error("Najpierw się zaloguj.");
  const parsed = parseInviteCode(code);
  if (!parsed) throw new Error("To nie wygląda na kod zaproszenia (np. ab12cd34ef-x7k2m9pq).");
  try {
    await dbPut(`groups/${parsed.gid}/members/${uid}`, parsed.invite);
  } catch (err) {
    if (err instanceof DbError && (err.status === 401 || err.status === 403)) throw new Error("Kod jest nieprawidłowy albo nieaktualny — poproś o nowy.");
    throw err;
  }
  await dbPut(`groups/${parsed.gid}/profiles/${uid}`, newProfile(myName));
  await dbPut(`users/${uid}/group`, parsed.gid);
  return loadGroup(uid);
}

export async function leaveGroup() {
  const uid = auth.uid;
  if (!current || !uid) return;
  const gid = current.id;
  await dbDelete(`groups/${gid}/profiles/${uid}`).catch(() => {});
  await dbDelete(`groups/${gid}/members/${uid}`);
  await dbDelete(`users/${uid}/group`);
  current = null;
  emit();
}

export async function removeMember(memberUid) {
  if (!current) return;
  await dbDelete(`groups/${current.id}/profiles/${memberUid}`).catch(() => {});
  await dbDelete(`groups/${current.id}/members/${memberUid}`);
  return refreshGroup();
}

/** Nowy kod zaproszenia (stary przestaje dzialac). Tylko wlasciciel. */
export async function regenerateInvite() {
  if (!current) return;
  await dbPut(`groups/${current.id}/info/invite`, randomId(8));
  return refreshGroup();
}

export async function renameGroup(name) {
  if (!current) return;
  await dbPut(`groups/${current.id}/info/name`, name.trim());
  return refreshGroup();
}

export async function updateMyProfile(fields) {
  const uid = auth.uid;
  if (!current || !uid) return;
  const profile = { ...newProfile(), ...(current.profiles[uid] || {}), ...fields };
  await dbPut(`groups/${current.id}/profiles/${uid}`, profile);
  current.profiles = { ...current.profiles, [uid]: profile };
  emit();
  return profile;
}

export function myProfile() {
  return current && auth.uid ? current.profiles[auth.uid] || null : null;
}

export const isOwner = () => !!current && current.info.owner === auth.uid;
