// api/_handlers/geo/communes.js — résolution groupée point → commune (geo.api.gouv.fr).
//
// GET /api/geo/communes?points=44.8412,-0.5801;45.1000,1.2000
//   → { results: Array<{ nom, codeDepartement } | null | { error: 'upstream' }> } dans l'ordre des points :
//     null = aucune commune (mer, hors France), définitif ; { error } = échec amont, à retenter.
//
// Pourquoi : la géo-résolution des incidents feux faisait un appel geo.api par maille et par
// visiteur (88 requêtes au chargement mesurées le 22/09/2026). Un seul appel groupé, mis en cache
// par le CDN (même liste de points pour tous les visiteurs, car mêmes détections FIRMS) et, point
// par point, dans Redis pendant 30 jours (une commune ne change pas de département).
// geo.api.gouv.fr et non la BAN : la BAN ne renvoie rien sur un foyer en forêt non adressée.

import { getOrRefresh } from '../../_utils/swr-cache.js';

const MAX_POINTS = 200;
const CONCURRENCY = 8;
const UPSTREAM_TIMEOUT_MS = 5_000;
const POINT_TTL_SEC = 30 * 24 * 60 * 60;

/**
 * Analyse et normalise `points` (4 décimales ≈ 11 m, bornes géographiques valides).
 * Pure et exportée pour les tests.
 * @param {unknown} raw
 * @returns {{ lat: string, lon: string }[] | null}  null si le paramètre est invalide
 */
export function parsePoints(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const parts = raw.split(';').filter(Boolean);
  if (parts.length === 0 || parts.length > MAX_POINTS) return null;
  const points = [];
  for (const part of parts) {
    const [latRaw, lonRaw] = part.split(',');
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    points.push({ lat: lat.toFixed(4), lon: lon.toFixed(4) });
  }
  return points;
}

/**
 * @param {{ lat: string, lon: string }} point
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<{ nom: string, codeDepartement: string } | null>}
 */
async function lookupPoint(point, fetchImpl) {
  const url = `https://geo.api.gouv.fr/communes?lat=${point.lat}&lon=${point.lon}&fields=nom,codeDepartement&format=json`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`geo.api HTTP ${response.status}`);
  const body = /** @type {Array<{ nom?: string, codeDepartement?: string }>} */ (await response.json());
  const first = Array.isArray(body) ? body[0] : undefined;
  // Point en mer ou hors France : réponse vide, résultat légitime (mis en cache aussi).
  if (!first?.nom || !first?.codeDepartement) return null;
  return { nom: first.nom, codeDepartement: first.codeDepartement };
}

/**
 * Résout tous les points, concurrence bornée, cache par point. Un échec réseau donne `null`
 * pour ce point sans faire échouer le lot. Exportée pour les tests.
 * @param {{ lat: string, lon: string }[]} points
 * @param {{ fetchImpl?: typeof fetch, cache?: typeof getOrRefresh }} [deps]
 */
export async function resolvePoints(points, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const cached = deps.cache ?? getOrRefresh;
  /** @type {Array<{ nom: string, codeDepartement: string } | null | { error: 'upstream' }>} */
  const results = new Array(points.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < points.length) {
      const index = next++;
      const point = points[index];
      try {
        const { value } = await cached(
          `geo:commune:v1:${point.lat},${point.lon}`,
          { ttlSec: POINT_TTL_SEC, staleSec: 0, timeoutMs: UPSTREAM_TIMEOUT_MS },
          () => lookupPoint(point, fetchImpl),
        );
        results[index] = value ?? null;
      } catch {
        results[index] = { error: 'upstream' };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, points.length) }, worker));
  return results;
}

/** @param {any} req @param {any} res */
export default async function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    res.status(405).json({ error: 'Méthode non autorisée' });
    return;
  }
  const points = parsePoints(req.query?.points);
  if (!points) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ error: `Paramètre points invalide (1 à ${MAX_POINTS} couples lat,lon séparés par ;)` });
    return;
  }
  const results = await resolvePoints(points);
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  res.status(200).json({ results });
}
