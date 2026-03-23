/**
 * api/fires.js — Vercel Serverless Function
 *
 * Proxy NASA FIRMS VIIRS C2 (24h, Europe) pour contourner les restrictions CORS.
 * Le client (fires.ts) parse le CSV identiquement à avant.
 *
 * Route : GET /api/fires
 * Cache : 1h (FIRMS se met à jour toutes les ~3h)
 */

const NASA_FIRMS_URL =
    'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Europe_24h.csv';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    try {
        const upstream = await fetch(NASA_FIRMS_URL, {
            signal: AbortSignal.timeout(15000),
            headers: { 'User-Agent': 'FranceMonitor/1.0 (github.com/france-monitor)' },
        });

        if (!upstream.ok) {
            res.status(502).end(`NASA FIRMS HTTP ${upstream.status}`);
            return;
        }

        const csv = await upstream.text();
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(csv);
    } catch (err) {
        console.error('[api/fires] Erreur upstream:', err);
        res.status(502).json({ error: 'Proxy error' });
    }
}
