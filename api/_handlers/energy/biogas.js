/**
 * api/energy/biogas.js - Vercel Serverless Function
 * Fetches daily biomethane production from GRDF open data
 */

export default async function handler(req, res) {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const GRDF_URL =
        'https://opendata.grdf.fr/api/explore/v2.1/catalog/datasets/' +
        'quantites-journalieres-provisoires-injectees-de-biomethane-agregees-a-la-maille1/records' +
        '?limit=60&order_by=-journee_gaziere';

    try {
        const resp = await fetch(GRDF_URL, { signal: AbortSignal.timeout(8000) });

        if (!resp.ok) {
            res.status(502).json({ error: `GRDF returned ${resp.status}` });
            return;
        }

        const json = await resp.json();

        // Instruct Vercel CDN to cache this for 1 hour
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

        res.status(200).json({
            records: json.results || [],
            fetchedAt: new Date().toISOString(),
        });
    } catch (err) {
        console.error('[api/energy/biogas]', err);
        res.status(500).json({ error: 'Fetch failed' });
    }
}
