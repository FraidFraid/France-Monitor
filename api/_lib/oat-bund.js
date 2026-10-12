// api/_lib/oat-bund.js : écart de taux à 10 ans France-Allemagne (OAT-Bund) du bloc « Stabilité financière » (spec 2026-10-12).
// Source de marché, non officielle : scanner TradingView (déjà lu par /api/finance/market ; vérifié le 12/10/2026 : FR10Y 4,90,
// DE10Y 3,47). Un point par jour (date de Paris) est gardé 400 jours dans kv-history ; le dernier relevé du jour remplace le
// précédent ; aucune interpolation : un jour sans relève reste un trou. Le point n'est écrit qu'à une vraie relève (au plus 4 par
// heure), jamais le week-end (TradingView rend alors la clôture du vendredi), et jamais après une lecture Redis en échec : réécrire
// la clé à partir d'un journal vide effacerait la courbe gardée (revue finale du 12/10, I1, I2, I4).
import { cachedSourceReport, fetchStrictResponse, sourceError } from './source-http.js';
import { kvReadJson, readLog, upsertLogEntry } from './kv-history.js';
import { parisDay } from './paris-time.js';

export const TV_SCAN_URL = 'https://scanner.tradingview.com/global/scan';
export const FR10Y = 'TVC:FR10Y';
export const DE10Y = 'TVC:DE10Y';
export const SPREAD_LOG_KEY = 'fin:oat-bund:daily';
export const SPREAD_KEEP_MS = 400 * 86_400_000;
/** Écart plausible (points) : en dehors, le symbole ou la réponse est faux. */
export const SPREAD_RANGE = Object.freeze({ min: -1, max: 5 });
export const SPREAD_LABEL = 'Écart OAT-Bund (TradingView)';
const FETCH_TIMEOUT_MS = 8_000;
const LOG = { idOf: (e) => e.date, dateOf: (e) => e.at, maxAgeMs: SPREAD_KEEP_MS };

/** Taux à 10 ans des deux pays et écart arrondi au centième ; lève si un taux manque ou si l'écart est hors plage. */
export function parseSpread(json) {
  const rows = Array.isArray(json?.data) ? json.data : [];
  const close = (symbol) => {
    const v = rows.find((r) => r?.s === symbol)?.d?.[1];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const fr10y = close(FR10Y);
  const de10y = close(DE10Y);
  if (fr10y === null || de10y === null) throw new Error('taux à 10 ans absent ou illisible');
  const value = Math.round((fr10y - de10y) * 100) / 100;
  if (value < SPREAD_RANGE.min || value > SPREAD_RANGE.max) throw new Error(`écart hors plage (${value} pt)`);
  return { fr10y, de10y, value };
}

/** Samedi ou dimanche à Paris (date AAAA-MM-JJ) : marché obligataire fermé. */
export function isWeekendDay(date) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** Point du jour : seulement en semaine et après une lecture Redis réussie (sinon la courbe gardée serait écrasée). */
async function recordPoint(entry, now) {
  if (isWeekendDay(entry.date)) return;
  const { failed } = await kvReadJson(SPREAD_LOG_KEY, now);
  if (failed) {
    console.warn('[oat-bund] lecture Redis en échec : point du jour non enregistré');
    return;
  }
  await upsertLogEntry(SPREAD_LOG_KEY, entry, { ...LOG, now });
}

async function readSpread(now) {
  const { text } = await fetchStrictResponse(TV_SCAN_URL, {
    method: 'POST',
    expect: 'json',
    timeoutMs: FETCH_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: JSON.stringify({ symbols: { tickers: [FR10Y, DE10Y] }, columns: ['name', 'close', 'change'] }),
  });
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('JSON illisible'); }
  const read = { readAt: new Date(now).toISOString(), ...parseSpread(json) };
  await recordPoint({ date: parisDay(now), at: read.readAt, value: read.value }, now);
  return read;
}

const toPoints = (log) => log.map((e) => ({ date: e.date, value: e.value })).sort((a, b) => a.date.localeCompare(b.date));

/** Courbe enregistrée (lecture seule) ; Redis muet : courbe vide, la valeur du jour s'affiche quand même. */
async function history(now) {
  try {
    return toPoints(await readLog(SPREAD_LOG_KEY, { dateOf: LOG.dateOf, maxAgeMs: LOG.maxAgeMs, now }));
  } catch {
    return [];
  }
}

export async function loadSpread(now) {
  let read = null;
  let error = null;
  try {
    ({ value: read, error } = await cachedSourceReport(
      'fin:oat-bund',
      { ttlSec: 900, staleSec: 7 * 86_400, shared: false, waitMs: FETCH_TIMEOUT_MS + 2_000 },
      SPREAD_LABEL,
      () => readSpread(now),
    ));
  } catch (err) {
    error = sourceError(SPREAD_LABEL, err);
  }
  if (!read) return { value: null, fr10y: null, de10y: null, readAt: null, history: await history(now), status: 'unavailable', error };
  return {
    value: read.value, fr10y: read.fr10y, de10y: read.de10y, readAt: read.readAt,
    history: await history(now), status: error ? 'stale' : 'ok', error,
  };
}
