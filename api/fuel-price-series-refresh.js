import { timingSafeEqual } from 'node:crypto';
import { refreshFuelPriceSeriesCache } from './_lib/fuel-price-series.js';

function getHeader(req, name) {
  const value = req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

// Seul « Authorization: Bearer <secret> » ouvre la route (minuteur fm-fuel-series, cron Vercel). L'en-tête x-vercel-cron
// n'est plus accepté : n'importe quel client peut l'envoyer. Le secret en paramètre d'URL non plus : il finissait dans les
// journaux d'accès.
function isAuthorized(req) {
  const secret = process.env.CRON_SECRET ?? process.env.FUEL_PRICE_SERIES_REFRESH_SECRET;
  if (!secret) return false;

  const presented = Buffer.from(String(getHeader(req, 'authorization') ?? ''));
  const expected = Buffer.from(`Bearer ${secret}`);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

export default async function handler(req, res) {
  if (req.method && req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const { payload, persisted } = await refreshFuelPriceSeriesCache();
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true,
      persisted,
      updatedAt: payload.updatedAt,
      points: Object.fromEntries(Object.entries(payload.series).map(([key, series]) => [key, series.length])),
      payload,
    });
  } catch (error) {
    console.error('[fuel-price-series-refresh] refresh failed; keeping previous cache', error);
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Fuel price series refresh failed',
    });
  }
}
