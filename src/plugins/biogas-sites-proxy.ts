import type { Plugin } from 'vite';

const BASE_URL =
    'https://opendata.grdf.fr/api/explore/v2.1/catalog/datasets/' +
    'les-sites-dinjection-de-biomethane-en-france/records' +
    '?select=nom_du_projet,commune,coordonnees,capacite_de_production_gwh_an,' +
    'grx_demandeur,gestionnaire_de_registre,type_de_reseau,site_ouvert,procede,region,departement,code_dep';

const PAGE_SIZE = 100;

export function biogasSitesProxyPlugin(): Plugin {
    return {
        name: 'biogas-sites-proxy',
        configureServer(server) {
            server.middlewares.use('/api/energy/biogas-sites', async (_req, res) => {
                try {
                    const allSites: unknown[] = [];
                    let offset = 0;
                    let hasMore = true;

                    while (hasMore) {
                        const url = `${BASE_URL}&limit=${PAGE_SIZE}&offset=${offset}`;
                        const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
                        if (!resp.ok) {
                            res.writeHead(502, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: `GRDF ${resp.status}` }));
                            return;
                        }
                        const json = await resp.json() as { total_count?: number; results?: unknown[] };
                        const results = json.results ?? [];
                        allSites.push(...results);
                        offset += PAGE_SIZE;
                        hasMore = results.length === PAGE_SIZE && offset < (json.total_count ?? 0);
                    }

                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                    });
                    res.end(JSON.stringify({ sites: allSites, fetchedAt: new Date().toISOString() }));
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: (err as Error).message }));
                }
            });
        },
    };
}
