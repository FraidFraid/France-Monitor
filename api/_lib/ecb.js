// api/_lib/ecb.js : séries de la BCE du bloc « Stabilité financière » (spec 2026-10-12 stabilité financière). ECB Data Portal,
// sans clé, CSV `detail=dataonly` lu par nom de colonne (vérifié le 12/10/2026). Six séries indépendantes : une en panne
// n'emporte pas les autres. Les séries « FM/B… » des taux directeurs n'ont qu'une observation par changement de taux.
import { cachedSourceReport, fetchStrictResponse, sourceError } from './source-http.js';
import { parisDay } from './paris-time.js';

export const ECB_BASE = 'https://data-api.ecb.europa.eu/service/data';
export const ECB_SERIES = Object.freeze([
  { id: 'cissFr', path: 'CISS/D.FR.Z0Z.4F.EC.SS_CIN.IDX', label: 'BCE CISS France' },
  { id: 'cissEa', path: 'CISS/D.U2.Z0Z.4F.EC.SS_CIN.IDX', label: 'BCE CISS zone euro' },
  { id: 'estr', path: 'EST/B.EU000A2X2A25.WT', label: 'BCE €STR' },
  { id: 'eurusd', path: 'EXR/D.USD.EUR.SP00.A', label: 'BCE EUR/USD' },
]);
export const ECB_RATES = Object.freeze([
  { id: 'depot', path: 'FM/B.U2.EUR.4F.KR.DFR.LEV', label: 'BCE taux de dépôt' },
  { id: 'refi', path: 'FM/B.U2.EUR.4F.KR.MRR_FR.LEV', label: 'BCE taux de refinancement' },
]);
export const SERIES_POINTS = 90;
/** Le CISS paraît avec 1 à 2 jours ouvrés de décalage : au-delà de 4 jours calendaires, la série est en retard. */
export const ECB_LATE_AFTER_DAYS = 4;
const DAY_MS = 86_400_000;
const FETCH_TIMEOUT_MS = 12_000;
/** Publication quotidienne : relue chaque heure, dernière valeur gardée 14 jours en cas de panne. */
const CACHE = { ttlSec: 3_600, staleSec: 14 * 86_400, shared: true, waitMs: FETCH_TIMEOUT_MS + 3_000 };

export function ecbUrl(path, n) {
  return `${ECB_BASE}/${path}?lastNObservations=${n}&detail=dataonly&format=csvdata`;
}

/** Observations datées d'un CSV BCE, ordre chronologique ; valeur vide ou non numérique écartée. */
export function parseEcbCsv(text) {
  const lines = String(text ?? '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const header = lines[0].split(',').map((h) => h.trim());
  const t = header.indexOf('TIME_PERIOD');
  const v = header.indexOf('OBS_VALUE');
  if (t < 0 || v < 0) throw new Error('CSV BCE sans colonnes TIME_PERIOD / OBS_VALUE');
  const points = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const date = (cells[t] ?? '').trim();
    const raw = (cells[v] ?? '').trim();
    const value = raw === '' ? Number.NaN : Number(raw);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value)) continue;
    points.push({ date, value });
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

/** Vrai si la date de valeur a plus de ECB_LATE_AFTER_DAYS jours calendaires (Paris). */
export function isEcbLate(date, now) {
  const days = Math.floor((Date.parse(`${parisDay(now)}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS);
  return days > ECB_LATE_AFTER_DAYS;
}

const frDay = (date) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

async function readPoints(def, n) {
  const { text } = await fetchStrictResponse(ecbUrl(def.path, n), { expect: 'text', timeoutMs: FETCH_TIMEOUT_MS, headers: { Accept: 'text/csv' } });
  const points = parseEcbCsv(text);
  if (points.length === 0) throw new Error('aucune observation');
  return points;
}

/** Points d'une série (cache d'une heure) et panne nommée ; `points: null` si aucune valeur connue. */
async function loadOne(def, n) {
  try {
    const { value, error } = await cachedSourceReport(`fin:ecb:${def.id}`, CACHE, def.label, () => readPoints(def, n));
    return { points: value, error };
  } catch (err) {
    return { points: null, error: sourceError(def.label, err) };
  }
}

export async function loadEcbSeries(now) {
  return Promise.all(ECB_SERIES.map(async (def) => {
    const { points, error } = await loadOne(def, SERIES_POINTS);
    if (!points) return { id: def.id, value: null, date: null, history: [], status: 'unavailable', error };
    const last = points[points.length - 1];
    const late = isEcbLate(last.date, now);
    const lateError = late ? `${def.label} : dernière valeur au ${frDay(last.date)}` : null;
    return { id: def.id, value: last.value, date: last.date, history: points, status: error || late ? 'stale' : 'ok', error: error ?? lateError };
  }));
}

export async function loadEcbRates() {
  return Promise.all(ECB_RATES.map(async (def) => {
    const { points, error } = await loadOne(def, 2);
    if (!points) return { id: def.id, value: null, since: null, previous: null, status: 'unavailable', error };
    const last = points[points.length - 1];
    const previous = points.length > 1 ? points[points.length - 2].value : null;
    return { id: def.id, value: last.value, since: last.date, previous, status: error ? 'stale' : 'ok', error };
  }));
}
