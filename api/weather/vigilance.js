/**
 * api/weather/vigilance.js — Vercel Serverless Function
 *
 * Proxy Météo-France DPVigilance (carte vigilance en cours) : garde la clé API
 * (header `apikey`) côté serveur. Le client appelle /api/weather/vigilance sans clé.
 * La réponse JSON upstream est renvoyée telle quelle (parsing client inchangé).
 *
 * Route : GET /api/weather/vigilance
 */
const UPSTREAM_URL =
  'https://public-api.meteofrance.fr/public/DPVigilance/v1/cartevigilance/encours';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.METEO_FRANCE_API_KEY || process.env.VITE_METEOFRANCE_API_KEY || '';
  if (!apiKey) {
    res.status(500).json({ error: 'Météo-France API key missing' });
    return;
  }

  try {
    const response = await fetch(UPSTREAM_URL, {
      headers: {
        Accept: 'application/json',
        apikey: apiKey,
      },
      signal: AbortSignal.timeout(8_000),
    });

    const body = await response.text();
    // On préserve le content-type upstream : le client vérifie qu'il reçoit du JSON.
    const contentType = response.headers.get('content-type') || 'application/json; charset=utf-8';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(response.status).send(body);
  } catch (error) {
    console.error('[weather-vigilance]', error);
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Vigilance fetch failed',
    });
  }
}
