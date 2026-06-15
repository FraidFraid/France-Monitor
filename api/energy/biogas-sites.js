const BASE_URL =
    'https://opendata.grdf.fr/api/explore/v2.1/catalog/datasets/' +
    'les-sites-dinjection-de-biomethane-en-france/records' +
    '?select=nom_du_projet,commune,coordonnees,capacite_de_production_gwh_an,' +
    'grx_demandeur,gestionnaire_de_registre,type_de_reseau,site_ouvert,procede,region,departement,code_dep';

const PAGE_SIZE = 100;

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();

    try {
        const allSites = [];
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            const url = `${BASE_URL}&limit=${PAGE_SIZE}&offset=${offset}`;
            const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
            if (!resp.ok) return res.status(502).json({ error: `GRDF returned ${resp.status}` });
            const json = await resp.json();
            const results = json.results || [];
            allSites.push(...results);
            offset += PAGE_SIZE;
            hasMore = results.length === PAGE_SIZE && offset < (json.total_count || 0);
        }

        res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');
        return res.status(200).json({ sites: allSites, fetchedAt: new Date().toISOString() });
    } catch (err) {
        return res.status(500).json({ error: err.message || 'fetch failed' });
    }
}
