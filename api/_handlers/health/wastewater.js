// api/_handlers/health/wastewater.js : SARS-CoV-2 dans les eaux usées (SUM'eau, Odissé, Santé publique France),
// hebdomadaire, recul de deux semaines (spec 2026-10-03 panneaux santé § 2.4). Indicateur sans unité (virus
// rapporté à l'azote ammoniacal, lissé ; les valeurs passées sont réécrites à chaque livraison) : à lire en tendance.
import { HealthFetchError, cachedSource, handlePreflight, sendHealthJson, sourceError } from '../../_lib/health-http.js';
import { fetchDatasetInfo, fetchRecords } from '../../_lib/odisse.js';

export const SUMEAU_DATASET = 'sum-eau-indicateurs';
export const CACHE_CONTROL = 's-maxage=21600, stale-while-revalidate=86400';
const TTL_SEC = 6 * 3600;
const POINTS = 26;
const NON_STATION = new Set(['semaine', 'date_complet', 'national_12', 'national_54']);

const round1 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

export function toWastewaterPoint(row) {
  return { week: String(row.semaine), start: String(row.date_complet), national54: round1(row.national_54), national12: round1(row.national_12) };
}

/**
 * Lignes SUM'eau (plus récentes d'abord ou non) → 26 dernières semaines chronologiques, même semaine ISO un an
 * plus tôt (semaine 53 sans équivalent l'année d'avant : semaine 52), stations ayant transmis la dernière semaine
 * (valeur numérique finie seulement) et nombre de colonnes de station.
 */
export function buildWastewater(seriesRows, lastRow) {
  const all = seriesRows.map(toWastewaterPoint).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const points = all.slice(-POINTS);
  const last = points.at(-1);
  const m = last ? /^(\d{4})-S(\d{2})$/.exec(last.week) : null;
  const candidates = m ? [`${Number(m[1]) - 1}-S${m[2]}`, ...(m[2] === '53' ? [`${Number(m[1]) - 1}-S52`] : [])] : [];
  const lastYear = candidates.map((w) => all.find((p) => p.week === w)).find(Boolean) ?? null;
  const stations = lastRow ? Object.keys(lastRow).filter((k) => !NON_STATION.has(k)) : [];
  return {
    points,
    lastYear,
    stationsReporting: lastRow ? stations.filter((k) => typeof lastRow[k] === 'number' && Number.isFinite(lastRow[k])).length : null,
    stationsTotal: stations.length,
  };
}

async function nonEmpty(promise) {
  const rows = await promise;
  if (rows.length === 0) throw new HealthFetchError('aucune ligne', { kind: 'empty' });
  return rows;
}

/** Réponse complète (WastewaterResponse) ; série, stations et date de publication échouent séparément. */
export async function loadWastewater() {
  const errors = [];
  const settle = (label, promise) => promise.catch((err) => { errors.push(sourceError(label, err)); return null; });
  const [seriesRows, lastRows, info] = await Promise.all([
    settle('SUM’eau, série nationale', cachedSource('wastewater:series', { ttlSec: TTL_SEC }, async () => nonEmpty((await fetchRecords(SUMEAU_DATASET, {
      select: 'semaine,date_complet,national_54,national_12', orderBy: 'date_complet desc', limit: 60,
    })).results))),
    settle('SUM’eau, stations', cachedSource('wastewater:last', { ttlSec: TTL_SEC }, async () => nonEmpty((await fetchRecords(SUMEAU_DATASET, {
      orderBy: 'date_complet desc', limit: 1,
    })).results))),
    settle('SUM’eau, date de publication', cachedSource('wastewater:meta', { ttlSec: TTL_SEC }, () => fetchDatasetInfo(SUMEAU_DATASET))),
  ]);
  return { ...buildWastewater(seriesRows ?? [], lastRows?.[0] ?? null), publishedAt: info?.dataProcessed ?? null, errors: errors.sort() };
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadWastewater();
  sendHealthJson(res, body, { ok: body.points.length > 0, cacheControl: CACHE_CONTROL });
}
