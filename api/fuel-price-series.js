import { readFuelPriceSeriesCache } from './_lib/fuel-price-series.js';

export default async function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const cached = await readFuelPriceSeriesCache();
  if (!cached) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).json({
      error: 'Fuel price series cache unavailable',
      message: 'Run /api/fuel-price-series-refresh via Vercel Cron or generate public/data/fuel-price-series.json.',
    });
    return;
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=7200');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json(cached);
}
