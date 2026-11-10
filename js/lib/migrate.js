// ==========================================================================
// Jednorazowe przeniesienie danych ze starego, wspolnego miejsca w bazie
// (todo_lists, calendar_events... w glownym katalogu) do przestrzeni konta
// (users/<uid>/...). Kto moze przeczytac stare dane, decyduja reguly bazy —
// w praktyce tylko wlasciciel, wiec nowe konta zaczynaja od zera.
//
// Stare dane NIE sa kasowane (zostaja jako kopia zapasowa). Po migracji
// zapisujemy znacznik users/<uid>/meta/migrated, zeby nigdy nie powtorzyc
// importu (np. gdy ktos celowo wyczysci liste).
// ==========================================================================

export async function migrateLegacyData({ baseUrl, uid, token, paths, fetchImpl = (...a) => fetch(...a) }) {
  if (!uid) return { status: "skipped" };
  const base = baseUrl.replace(/\/+$/, "");
  const q = token ? "?auth=" + encodeURIComponent(token) : "";
  const url = (p) => `${base}/${p}.json${q}`;
  const userBase = `users/${encodeURIComponent(uid)}`;

  const get = async (p) => {
    const res = await fetchImpl(url(p));
    if (res.status === 401 || res.status === 403) return { denied: true };
    if (!res.ok) throw new Error("HTTP " + res.status);
    return { value: await res.json() };
  };
  const put = async (p, value) => {
    const res = await fetchImpl(url(p), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
    if (!res.ok) throw new Error("HTTP " + res.status);
  };

  // blad sieci = rzucamy wyjatek i NIE zapisujemy znacznika (sprobujemy nastepnym razem)
  const meta = await get(`${userBase}/meta/migrated`);
  if (meta.denied) return { status: "denied" };
  if (meta.value) return { status: "already" };

  const copied = [];
  for (const p of Object.values(paths)) {
    const legacy = await get(p);
    if (legacy.denied || legacy.value == null) continue;
    const current = await get(`${userBase}/${p}`);
    if (current.denied || current.value != null) continue; // nigdy nie nadpisujemy danych konta
    await put(`${userBase}/${p}`, legacy.value);
    copied.push(p);
  }
  await put(`${userBase}/meta/migrated`, { at: new Date().toISOString(), copied: copied.length ? copied : null });
  return { status: "done", copied };
}
