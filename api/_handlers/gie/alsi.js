// api/_handlers/gie/alsi.js — Vercel Serverless Function
// Proxy vers l'API ALSI (Aggregated LNG Storage Inventory) de GIE : dernière journée publiée de
// CHAQUE terminal méthanier français. L'agrégat ?country=FR ne renvoie que des lignes « France »
// (aucun chiffre par terminal) : on interroge donc chaque installation par son code EIC.
// Installations et codes : https://alsi.gie.eu/api/about?show=listing (relevé le 28/09/2026 ;
// le FSRU du Havre a cessé le 22/01/2026). Conditions de la clé GIE : citer « GIE ALSI »
// comme source (badge de GasPanel).
//
// Route   : GET /api/gie/alsi
// Réponse : { terminals: [{ eic, gasDayStart, sendOutGWhDay, inventoryGWh, inventoryMaxGWh,
//             referenceSendOutGWhDay }], errors: [{ eic, error }] }
// Cache   : 1h (données publiées quotidiennement par GIE), 10 min si un terminal manque.

const ALSI_API = 'https://alsi.gie.eu/api';

/** Terminaux méthaniers français en service (EIC installation + EIC opérateur). */
const ALSI_FACILITIES = [
  { eic: '63W179356656691A', company: '21X0000000010679' }, // Fos Tonkin (Elengy)
  { eic: '63W943693783886F', company: '21X000000001070K' }, // Fos Cavaou (Fosmax LNG)
  { eic: '63W631527814486R', company: '21X0000000010679' }, // Montoir-de-Bretagne (Elengy)
  { eic: '21W0000000000451', company: '21X000000001331I' }, // Dunkerque LNG
];

/** @param {unknown} value */
function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** @param {unknown} value */
function gwh(value) {
  return value && typeof value === 'object' ? toNumber(/** @type {{ gwh?: unknown }} */ (value).gwh) : null;
}

/**
 * Dernière journée publiée d'une installation.
 * @param {{ eic: string, company: string }} facility
 * @param {string} apiKey
 */
async function fetchFacility(facility, apiKey) {
  const url = `${ALSI_API}?country=FR&company=${facility.company}&facility=${facility.eic}&size=3`;
  const resp = await fetch(url, {
    headers: { 'x-key': apiKey },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  // GIE répond 200 avec { error, message } quand la clé est refusée.
  if (json?.error) throw new Error(String(json.message || json.error));
  /** @type {Array<Record<string, unknown>>} */
  const rows = Array.isArray(json?.data) ? json.data : [];
  let latest = null;
  for (const row of rows) {
    if (typeof row.gasDayStart !== 'string') continue;
    if (!latest || row.gasDayStart > /** @type {string} */ (latest.gasDayStart)) latest = row;
  }
  if (!latest) throw new Error('aucune journée publiée');
  return {
    eic: facility.eic,
    gasDayStart: /** @type {string} */ (latest.gasDayStart),
    sendOutGWhDay: toNumber(latest.sendOut),
    inventoryGWh: gwh(latest.inventory),
    inventoryMaxGWh: gwh(latest.dtmi),
    referenceSendOutGWhDay: toNumber(latest.dtrs),
  };
}

/**
 * @param {{ method?: string }} req
 * @param {{ statusCode: number, setHeader: (k: string, v: string) => void, status: (c: number) => any, end: (b?: unknown) => unknown }} res
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const apiKey = process.env.GIE_API_KEY;
  if (!apiKey) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'GIE_API_KEY non configurée' });
  }

  const results = await Promise.allSettled(ALSI_FACILITIES.map((f) => fetchFacility(f, apiKey)));
  const terminals = [];
  const errors = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') terminals.push(result.value);
    else {
      const reason = result.reason;
      errors.push({ eic: ALSI_FACILITIES[i].eic, error: reason instanceof Error ? reason.message : String(reason) });
    }
  });

  res.setHeader('Content-Type', 'application/json');
  if (terminals.length === 0) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'GIE ALSI indisponible', errors });
  }
  res.setHeader(
    'Cache-Control',
    errors.length === 0
      ? 'public, s-maxage=3600, stale-while-revalidate=1800'
      : 'public, s-maxage=600, stale-while-revalidate=300',
  );
  return res.status(200).json({ terminals, errors });
}
