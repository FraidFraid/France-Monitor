import type { Plugin } from 'vite';

const TOPAGE_WFS_URL = 'https://services.sandre.eaufrance.fr/geo/topage2023';

function buildUpstreamUrl(searchParams: URLSearchParams): string {
    const bbox = searchParams.get('bbox');
    if (!bbox) {
        throw new Error('Missing bbox');
    }

    const count = Number(searchParams.get('count') ?? '600');
    const upstream = new URL(TOPAGE_WFS_URL);
    upstream.searchParams.set('service', 'WFS');
    upstream.searchParams.set('version', '2.0.0');
    upstream.searchParams.set('request', 'GetFeature');
    upstream.searchParams.set('typeNames', 'sa:TronconHydrographique_FXX_Topage2023');
    upstream.searchParams.set('outputFormat', 'application/json; subtype=geojson');
    upstream.searchParams.set('bbox', bbox);
    upstream.searchParams.set('count', String(Number.isFinite(count) ? Math.max(1, Math.min(count, 1000)) : 600));
    upstream.searchParams.set('language', 'fre');
    return upstream.toString();
}

export function topageProxyPlugin(): Plugin {
    return {
        name: 'topage-proxy',
        configureServer(server) {
            server.middlewares.use('/api/environment/topage-hydro', async (req, res) => {
                try {
                    const url = new URL(req.url ?? '', 'http://localhost');
                    const upstreamUrl = buildUpstreamUrl(url.searchParams);
                    console.info('[topage-proxy] Request', url.searchParams.get('bbox'));
                    const response = await fetch(upstreamUrl, {
                        headers: { Accept: 'application/json' },
                        signal: AbortSignal.timeout(20_000),
                    });

                    if (!response.ok) {
                        res.statusCode = 502;
                        res.setHeader('Content-Type', 'application/json; charset=utf-8');
                        res.end(JSON.stringify({ error: `Topage upstream error ${response.status}` }));
                        return;
                    }

                    const payload = await response.text();
                    try {
                        const parsed = JSON.parse(payload) as { features?: unknown[] };
                        console.info('[topage-proxy] Response features', parsed.features?.length ?? 0);
                    } catch {
                        console.warn('[topage-proxy] Response parse failed');
                    }
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.setHeader('Cache-Control', 'public, max-age=900');
                    res.end(payload);
                } catch (error) {
                    console.error('[topage-proxy]', error);
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify({ error: 'Topage proxy failed' }));
                }
            });
        },
    };
}
