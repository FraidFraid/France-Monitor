/**
 * api/traffic/flow.js — Vercel Serverless Function
 *
 * Proxy TomTom Flow Segment Data (v4) : garde la clé TomTom côté serveur.
 * Le client appelle /api/traffic/flow?point=lat,lon&zoom=Z ; la réponse TomTom
 * brute (JSON) est renvoyée telle quelle pour que le parsing client reste identique.
 *
 * Route : GET /api/traffic/flow
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const tomtomKey = process.env.TOMTOM_API_KEY || process.env.VITE_TOMTOM_API_KEY || '';
  if (!tomtomKey) {
    res.status(500).json({ error: 'TomTom API key missing' });
    return;
  }

  const point = typeof req.query?.point === 'string' ? req.query.point : '';
  // point attendu : "lat,lon" (deux nombres décimaux, éventuellement négatifs).
  if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(point)) {
    res.status(400).json({ error: 'point query param (lat,lon) is required' });
    return;
  }

  const zoomRaw = Number(req.query?.zoom ?? 10);
  const zoom = Math.max(0, Math.min(22, Math.round(Number.isFinite(zoomRaw) ? zoomRaw : 10)));

  try {
    const upstreamUrl =
      `https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/${zoom}/json` +
      `?key=${encodeURIComponent(tomtomKey)}&point=${encodeURIComponent(point)}&unit=kmph&thickness=10`;

    const response = await fetch(upstreamUrl, { signal: AbortSignal.timeout(10_000) });
    const json = await response.json();

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=60');
    res.status(response.status).json(json);
  } catch (error) {
    console.error('[traffic-flow]', error);
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Flow segment fetch failed',
    });
  }
}
