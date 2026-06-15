import type { Plugin } from 'vite';

const GRDF_URL =
    'https://opendata.grdf.fr/api/explore/v2.1/catalog/datasets/' +
    'quantites-journalieres-provisoires-injectees-de-biomethane-agregees-a-la-maille1/records' +
    '?limit=60&order_by=-journee_gaziere';

export function biogasProxyPlugin(): Plugin {
    return {
        name: 'biogas-proxy',
        configureServer(server) {
            server.middlewares.use('/api/energy/biogas', async (_req, res) => {
                try {
                    const resp = await fetch(GRDF_URL, { signal: AbortSignal.timeout(8000) });

                    if (!resp.ok) {
                        res.statusCode = 502;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: `GRDF returned ${resp.status}` }));
                        return;
                    }

                    const json = (await resp.json()) as { results?: unknown[] };

                    const payload = {
                        records: json.results ?? [],
                        fetchedAt: new Date().toISOString(),
                    };

                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.setHeader('Cache-Control', 'public, max-age=3600');
                    res.end(JSON.stringify(payload));
                } catch (err) {
                    console.error('[biogas-proxy]', err);
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Fetch failed' }));
                }
            });
        },
    };
}
