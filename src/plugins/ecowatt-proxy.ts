import type { Plugin } from 'vite';

export function ecowattProxyPlugin(): Plugin {
    return {
        name: 'ecowatt-proxy',
        configureServer(server) {
            server.middlewares.use('/api/energy/ecowatt', async (_req, res) => {
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
                        fetch(ODRE_URL),
                        fetch(NAT_ODRE_URL)
                    ]);

                    if (!respReg.ok || !respNat.ok) {
                        res.statusCode = 502;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: `Upstream error: ${respReg.status} / ${respNat.status}` }));
                        return;
                    }

                    const jsonReg = await respReg.json();
                    const jsonNat = await respNat.json();

                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.setHeader('Cache-Control', 'public, max-age=900');
                    res.end(JSON.stringify({
                        regional: jsonReg,
                        national: jsonNat
                    }));
                } catch (err) {
                    console.error('[ecowatt-proxy]', err);
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Fetch failed' }));
                }
            });
        },
    };
}
