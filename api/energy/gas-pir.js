/**
 * api/energy/gas-pir.js — Vercel Serverless Function
 *
 * Proxy ENTSOG pour les flux Physical Flow journaliers aux 5 PIR frontière France.
 * Retourne { points, fetchedAt, status } avec flowGWhDay en GWh/j (flux net FR).
 *
 * Source : https://transparency.entsog.eu/api/v1/operationaldata
 * Pas d'authentification requise.
 */

const ENTSOG_URL = 'https://transparency.entsog.eu/api/v1/operationaldata';
const PIR_POINTS = ['ITP-00033', 'ITP-00018', 'ITP-00137', 'ITP-00115', 'ITP-00039'];
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

let _cache = null; // { data, fetchedAt }

/** Retourne une date ISO YYYY-MM-DD décalée de `deltaDays` par rapport à aujourd'hui (UTC). */
function isoDate(deltaDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** Extrait le flux net (GWh/j) pour un pointKey donné depuis le tableau items ENTSOG. */
function extractNetFlow(items, pointKey) {
  const pointItems = items.filter(it => it.pointKey === pointKey);
  if (pointItems.length === 0) return null;

  // Grouper par direction
  const byDir = { entry: [], exit: [] };
  for (const it of pointItems) {
    if (it.directionKey === 'entry' || it.directionKey === 'exit') {
      byDir[it.directionKey].push(it);
    }
  }

  // Pour chaque direction : trier par periodFrom DESC, prendre le premier avec valeur non-nulle
  function latestValue(dirItems) {
    const sorted = dirItems
      .filter(it => it.value !== null && it.value !== '' && it.value !== undefined)
      .sort((a, b) => (b.periodFrom ?? '').localeCompare(a.periodFrom ?? ''));
    return sorted.length > 0 ? { value: Number(sorted[0].value), periodFrom: sorted[0].periodFrom } : null;
  }

  const entryResult = latestValue(byDir.entry);
  const exitResult = latestValue(byDir.exit);

  if (!entryResult && !exitResult) return null;

  const entryGWh = entryResult ? entryResult.value / 1_000_000 : 0;
  const exitGWh = exitResult ? exitResult.value / 1_000_000 : 0;
  const flowNet = entryGWh - exitGWh; // positif = import net vers FR

  // periodFrom = max lexicographique des deux directions
  const periodFrom = [entryResult?.periodFrom, exitResult?.periodFrom]
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  // pointLabel : prendre le premier item disponible
  const pointLabel = pointItems[0]?.pointLabel ?? pointKey;

  return { pointKey, pointLabel, flowGWhDay: flowNet, periodFrom };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Servir depuis le cache in-process si frais
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', `s-maxage=${Math.floor(CACHE_TTL_MS / 1000)}, stale-while-revalidate`);
    res.status(200).json(_cache.data);
    return;
  }

  try {
    const from = isoDate(-3); // J-3
    const to = isoDate(0);    // J0

    const url = new URL(ENTSOG_URL);
    url.searchParams.set('indicator', 'Physical Flow');
    url.searchParams.set('periodType', 'day');
    url.searchParams.set('points', PIR_POINTS.join(','));
    url.searchParams.set('from', from);
    url.searchParams.set('to', to);
    url.searchParams.set('limit', '100');

    const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) throw new Error(`ENTSOG HTTP ${resp.status}`);

    const json = await resp.json();
    const items = json.operationaldata ?? [];

    // Calculer le flux net pour chaque PIR
    const points = PIR_POINTS
      .map(key => extractNetFlow(items, key))
      .filter(Boolean);

    let status = 'error';
    if (points.length === PIR_POINTS.length) status = 'ok';
    else if (points.length > 0) status = 'partial';

    const data = { points, fetchedAt: new Date().toISOString(), status };
    _cache = { data, fetchedAt: Date.now() };

    res.setHeader('Cache-Control', `s-maxage=${Math.floor(CACHE_TTL_MS / 1000)}, stale-while-revalidate`);
    res.status(200).json(data);
  } catch (err) {
    console.error('[gas-pir] ENTSOG fetch failed:', err.message);
    // HTTP 200 même en cas d'erreur : le client inspecte json.status, pas le code HTTP.
    // Diverge volontairement de ecowatt.js (qui fait res.status(502)) pour simplifier
    // la gestion côté fetchPirFlows() dans gas.ts.
    res.status(200).json({ points: [], fetchedAt: new Date().toISOString(), status: 'error', error: err.message });
  }
}
