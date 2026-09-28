// api/_handlers/gie/agsi.js — Vercel Serverless Function
// Proxy vers l'API AGSI (Aggregated Gas Storage Inventory) de GIE — niveaux de
// stockage gaz agrégés France (30 dernières journées gazières). En dev, servi
// tel quel par api-router-fallback (GIE_API_KEY requise, sinon 503).
//
// Route  : GET /api/gie/agsi
// Cache  : 1h (données publiées quotidiennement par GIE)

const AGSI_URL = 'https://agsi.gie.eu/api?country=FR';

/**
 * @param {{ method?: string }} req
 * @param {{ statusCode: number, setHeader: (k: string, v: string) => void, status: (c: number) => any, end: (b?: unknown) => unknown }} res
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const apiKey = process.env.GIE_API_KEY;
  if (!apiKey) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'GIE_API_KEY non configurée' });
  }

  try {
    const resp = await fetch(AGSI_URL, {
      headers: { 'x-key': apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await resp.text();
    // GIE répond 200 avec { error, message } quand la clé est refusée : ne pas le mettre en cache
    // comme un succès.
    if (resp.ok) {
      let upstreamError = null;
      try {
        const parsed = JSON.parse(body);
        if (parsed?.error) upstreamError = String(parsed.message || parsed.error);
      } catch {
        upstreamError = 'réponse non JSON';
      }
      if (upstreamError) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(502).json({ error: `GIE AGSI : ${upstreamError}` });
      }
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', resp.ok ? 'public, s-maxage=3600, stale-while-revalidate=1800' : 'no-store');
    return res.status(resp.status).end(body);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
