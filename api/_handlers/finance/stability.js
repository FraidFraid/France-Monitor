// api/_handlers/finance/stability.js : bloc « Stabilité financière » (spec 2026-10-12) : séries BCE (CISS France et zone euro,
// €STR, EUR/USD), taux directeurs et écart OAT-Bund (TradingView). GET seulement ; 200 dès qu'une partie a répondu (pannes
// nommées dans `errors`, cache CDN raccourci), sinon 502 non mis en cache.
import { loadEcbRates, loadEcbSeries } from '../../_lib/ecb.js';
import { loadSpread } from '../../_lib/oat-bund.js';
import { handlePreflight, sendSourceJson } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=900, stale-while-revalidate=600';

export async function loadFinancialStability(now) {
  const [series, rates, spread] = await Promise.all([loadEcbSeries(now), loadEcbRates(), loadSpread(now)]);
  const errors = [...series, ...rates, spread].map((p) => p.error).filter((e) => typeof e === 'string');
  return { readAt: new Date(now).toISOString(), series, rates, spread, errors };
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadFinancialStability(Date.now());
  const ok = [...body.series, ...body.rates, body.spread].some((p) => p.status !== 'unavailable');
  sendSourceJson(res, body, { ok, cacheControl: CACHE_CONTROL });
}
