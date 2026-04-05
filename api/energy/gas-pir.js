/**
 * api/energy/gas-pir.js — Vercel Serverless Function
 *
 * Proxy ENTSOG pour les flux Physical Flow journaliers aux PIR frontière France.
 * Retourne { points, fetchedAt, status } avec flowGWhDay en GWh/j (flux net FR).
 *
 * Source : https://transparency.entsog.eu/api/v1/operationaldata
 * Pas d'authentification requise.
 *
 * Stratégie de fetch :
 *   - Le filtre ?points=... de l'API ENTSOG ne fonctionne pas correctement.
 *   - On interroge par operatorKey pour les deux TSOs français :
 *     - FR-TSO-0003 (NaTran / GRTgaz) : Taisnières (ITP-00115), Oltingue (ITP-00039), Obergailbach (ITP-00137)
 *     - FR-TSO-0002 (TERÉGA) : VIP PIRINEOS (ITP-00304) = Biriatou + Larrau fusionnés depuis oct. 2014
 *   - Les deux requêtes sont lancées en parallèle, les résultats mergés.
 */

const ENTSOG_URL = 'https://transparency.entsog.eu/api/v1/operationaldata';
// PIR points attendus dans la réponse après merge des deux opérateurs
const PIR_POINTS = ['ITP-00304', 'ITP-00137', 'ITP-00115', 'ITP-00039'];
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

let _cache = null; // { data, fetchedAt }

/** Retourne une date ISO YYYY-MM-DD décalée de `deltaDays` par rapport à aujourd'hui (UTC). */
function isoDate(deltaDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** Construit l'URL ENTSOG pour un operatorKey donné. */
function buildUrl(operatorKey, from, to) {
  const url = new URL(ENTSOG_URL);
  url.searchParams.set('indicator', 'Physical Flow');
  url.searchParams.set('periodType', 'day');
  url.searchParams.set('operatorKey', operatorKey);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  url.searchParams.set('limit', '300');
  return url.toString();
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

    // Deux requêtes parallèles par operatorKey (le filtre ?points= est ignoré par l'API ENTSOG)
    const [r1, r2] = await Promise.all([
      fetch(buildUrl('FR-TSO-0003', from, to), { signal: AbortSignal.timeout(15_000) }),
      fetch(buildUrl('FR-TSO-0002', from, to), { signal: AbortSignal.timeout(15_000) }),
    ]);

    if (!r1.ok) throw new Error(`ENTSOG FR-TSO-0003 HTTP ${r1.status}`);
    if (!r2.ok) throw new Error(`ENTSOG FR-TSO-0002 HTTP ${r2.status}`);

    const [j1, j2] = await Promise.all([r1.json(), r2.json()]);
    const items = [...(j1.operationaldata ?? []), ...(j2.operationaldata ?? [])];

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
    res.status(200).json({ points: [], fetchedAt: new Date().toISOString(), status: 'error', error: err.message });
  }
}
