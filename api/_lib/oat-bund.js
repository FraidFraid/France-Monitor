// api/_lib/oat-bund.js : écart de taux à 10 ans France-Allemagne (OAT-Bund) du bloc « Stabilité financière » (spec 2026-10-12).
// Source de marché, non officielle : scanner TradingView (déjà lu par /api/finance/market ; vérifié le 12/10/2026 : FR10Y 4,90,
// DE10Y 3,47). Un point par jour (date de Paris) est gardé 400 jours dans kv-history ; le dernier relevé du jour remplace le
// précédent ; aucune interpolation : un jour sans relève reste un trou.
import { cachedSourceReport, fetchStrictResponse, sourceError } from './source-http.js';
import { readLog, upsertLogEntry } from './kv-history.js';
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
  return { readAt: new Date(now).toISOString(), ...parseSpread(json) };
}

const toPoints = (log) => log.map((e) => ({ date: e.date, value: e.value })).sort((a, b) => a.date.localeCompare(b.date));

/** Courbe enregistrée, avec le point du jour s'il y en a un ; une écriture en échec n'empêche pas l'affichage. */
async function history(now, entry) {
  if (entry) {
    try {
      return toPoints(await upsertLogEntry(SPREAD_LOG_KEY, entry, { ...LOG, now }));
    } catch (err) {
      console.warn('[oat-bund] point du jour non enregistré', err);
    }
  }
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
  if (!read) return { value: null, fr10y: null, de10y: null, readAt: null, history: await history(now, null), status: 'unavailable', error };
  const entry = { date: parisDay(Date.parse(read.readAt)), at: read.readAt, value: read.value };
  return {
    value: read.value, fr10y: read.fr10y, de10y: read.de10y, readAt: read.readAt,
    history: await history(now, entry), status: error ? 'stale' : 'ok', error,
  };
}
