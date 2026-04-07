import type { Plugin } from 'vite';

export function arcepProxyPlugin(): Plugin {
    return {
        name: 'arcep-proxy',
        configureServer(server) {
            server.middlewares.use('/api/arcep', async (req, res) => {
                try {
                    // Extract the date from query params or URL
                    const urlObj = new URL(req.url || '', `http://${req.headers.host}`);
                    const dateStr = urlObj.searchParams.get('date');

                    if (!dateStr) {
                        res.statusCode = 400;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: 'Missing date parameter' }));
                        return;
                    }

                    const arcepUrl = (d: string) =>
                        `https://object.files.data.gouv.fr/arcep/sites-indisponibles/all/${d}/raw${d}.geojson`;

                    let resp = await fetch(arcepUrl(dateStr));

                    // Fallback J-1 si le fichier du jour n'est pas encore publié (cohérence avec prod)
                    if (!resp.ok && resp.status === 404) {
                        const date = new Date(dateStr + 'T12:00:00');
                        date.setDate(date.getDate() - 1);
                        const fallbackDateStr = date.toISOString().split('T')[0];
                        resp = await fetch(arcepUrl(fallbackDateStr));
                    }

                    if (!resp.ok) {
                        res.statusCode = resp.status;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: 'ARCEP fetch failed' }));
                        return;
                    }

                    const data = await resp.json();

                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.end(JSON.stringify(data));
                } catch (err) {
                    res.statusCode = 502;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Proxy implementation error' }));
                }
            });
        }
    };
}
