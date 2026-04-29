import { refreshFuelPriceSeriesCache } from './_lib/fuel-price-series.js';

function getHeader(req, name) {
  const value = req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function isAuthorized(req) {
  if (getHeader(req, 'x-vercel-cron')) return true;

  const secret = process.env.CRON_SECRET ?? process.env.FUEL_PRICE_SERIES_REFRESH_SECRET;
  if (!secret) return false;

  const authHeader = getHeader(req, 'authorization') ?? '';
  if (authHeader === `Bearer ${secret}`) return true;

  const protocol = getHeader(req, 'x-forwarded-proto') ?? 'https';
  const host = getHeader(req, 'host') ?? 'localhost';
  const url = new URL(req.url ?? '/', `${protocol}://${host}`);
  return url.searchParams.get('secret') === secret;
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
