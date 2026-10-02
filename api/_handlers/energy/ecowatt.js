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

    const NAT_BASE = 'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/eco2mix-national-tr/records';
    const NAT_FIELDS = 'date_heure,consommation,prevision_j,prevision_j1,taux_co2,nucleaire,eolien,solaire,hydraulique,gaz,fioul,charbon,bioenergies,pompage,ech_physiques,'
        + 'ech_comm_angleterre,ech_comm_espagne,ech_comm_italie,ech_comm_suisse,ech_comm_allemagne_belgique,hydraulique_fil_eau_eclusee,hydraulique_lacs,hydraulique_step_turbinage,eolien_terrestre,eolien_offshore';
    // Dernier quart d'heure mesuré (les échanges commerciaux sont publiés à l'avance : ne pas filtrer sur eux).
    const NAT_ODRE_URL = `${NAT_BASE}?limit=1&select=${NAT_FIELDS}&where=consommation%20is%20not%20null&order_by=-date_heure`;
    // Série de la journée : les 100 derniers quarts d'heure prévus couvrent la journée de Paris en cours ; le client filtre.
    const DAY_ODRE_URL = `${NAT_BASE}?limit=100&select=date_heure,consommation,prevision_j,eolien&where=prevision_j%20is%20not%20null&order_by=-date_heure`;

    try {
        const [respReg, respNat, respDay] = await Promise.all([
            fetch(ODRE_URL, { signal: AbortSignal.timeout(8000) }),
            fetch(NAT_ODRE_URL, { signal: AbortSignal.timeout(8000) }),
            fetch(DAY_ODRE_URL, { signal: AbortSignal.timeout(8000) })
        ]);

        if (!respReg.ok || !respNat.ok || !respDay.ok) {
            res.status(502).json({ error: `Upstream error: ${respReg.status} / ${respNat.status} / ${respDay.status}` });
            return;
        }

        const jsonReg = await respReg.json();
        const jsonNat = await respNat.json();
        const jsonDay = await respDay.json();

        // Cache CDN 5 min : l'âge affiché au panneau doit rester sous le seuil « en retard » (30 min).
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

        res.status(200).json({
            regional: jsonReg,
            national: jsonNat,
            day: jsonDay
        });
    } catch (err) {
        console.error('[api/energy/ecowatt]', err);
        res.status(500).json({ error: 'Fetch failed' });
    }
}
