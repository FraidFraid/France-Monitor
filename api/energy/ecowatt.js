/**
 * api/energy/ecowatt.js - Vercel Serverless Function
 * Fetches real-time energy mix from ODRE API
 */

export default async function handler(req, res) {
    // Add CORS headers, particularly important if fetching from different origin
    res.setHeader('Access-Control-Allow-Credentials', true)
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version')

    if (req.method === 'OPTIONS') {
        res.status(200).end()
        return
    }

    const ODRE_URL =
        'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/eco2mix-regional-tr/records' +
        '?limit=20' +
        '&select=code_insee_region,libelle_region,date_heure,consommation,nucleaire,eolien,solaire,hydraulique,thermique,bioenergies,ech_physiques' +
        '&where=consommation%20is%20not%20null' +
        '&order_by=-date_heure';

    const NAT_ODRE_URL =
        'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/eco2mix-national-tr/records' +
        '?limit=1' +
        '&select=ech_comm_angleterre,ech_comm_espagne,ech_comm_italie,ech_comm_suisse,ech_comm_allemagne_belgique' +
        '&where=ech_comm_angleterre%20is%20not%20null' +
        '&order_by=-date_heure';

    try {
        const [respReg, respNat] = await Promise.all([
            fetch(ODRE_URL, { signal: AbortSignal.timeout(8000) }),
            fetch(NAT_ODRE_URL, { signal: AbortSignal.timeout(8000) })
        ]);

        if (!respReg.ok || !respNat.ok) {
            res.status(502).json({ error: `Upstream error: ${respReg.status} / ${respNat.status}` });
            return;
        }

        const jsonReg = await respReg.json();
        const jsonNat = await respNat.json();

        // Instruct Vercel CDN to cache this for 15 minutes
        res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate');

        res.status(200).json({
            regional: jsonReg,
            national: jsonNat
        });
    } catch (err) {
        console.error('[api/energy/ecowatt]', err);
        res.status(500).json({ error: 'Fetch failed' });
    }
}
