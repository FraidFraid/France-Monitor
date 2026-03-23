/**
 * elus-proxy.ts — Plugin Vite qui proxy les APIs élus (CORS) pour le dev local.
 * Routes :
 *   /api/elus/communes?lat=&lon=           → geo.api.gouv.fr/communes
 *   /api/elus/departements/:code           → geo.api.gouv.fr/departements/:code
 *   /api/elus/regions/:code                → geo.api.gouv.fr/regions/:code
 *   /api/elus/maire?codeInsee=             → tabular-api.data.gouv.fr RNE
 *   /api/elus/deputes                      → api.nosdeputes.fr/deputes/json
 *   /api/elus/senateurs                    → api.nossenateurs.fr/senateurs/json
 */

import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';

async function proxyGet(
    targetUrl: string,
    res: ServerResponse
): Promise<void> {
    try {
        const upstream = await fetch(targetUrl, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'FranceMonitor/1.0' },
            signal: AbortSignal.timeout(20000),
        });
        const body = await upstream.text();
        res.statusCode = upstream.status;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(body);
    } catch (err) {
        console.error('[elus-proxy] upstream error for', targetUrl, err);
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: String(err) }));
    }
}

export function elusProxyPlugin(): Plugin {
    return {
        name: 'elus-proxy',
        configureServer(server) {
            server.middlewares.use('/api/elus', async (req: IncomingMessage, res: ServerResponse, next) => {
                const parsed = new URL(req.url ?? '', 'http://localhost');
                const path = parsed.pathname;
                console.log('[elus-proxy] req.url=', req.url, '→ path=', path);
                const search = parsed.search;  // e.g. "?lat=...&lon=..."

                // GET /api/elus/communes?lat=&lon=&fields=...
                if (path === '/communes') {
                    await proxyGet(`https://geo.api.gouv.fr/communes${search}`, res);
                    return;
                }

                // GET /api/elus/departements/:code?fields=nom
                const deptMatch = path.match(/^\/departements\/([^/]+)$/);
                if (deptMatch) {
                    await proxyGet(`https://geo.api.gouv.fr/departements/${deptMatch[1]}${search}`, res);
                    return;
                }

                // GET /api/elus/regions/:code?fields=nom
                const regionMatch = path.match(/^\/regions\/([^/]+)$/);
                if (regionMatch) {
                    await proxyGet(`https://geo.api.gouv.fr/regions/${regionMatch[1]}${search}`, res);
                    return;
                }

                // GET /api/elus/maire?codeInsee=&limit=
                if (path === '/maire') {
                    const codeInsee = parsed.searchParams.get('codeInsee') ?? '';
                    const limit = parsed.searchParams.get('limit') ?? '5';
                    await proxyGet(
                        `https://tabular-api.data.gouv.fr/api/resources/d5f400de-ae3f-4966-8cb6-a85c70c6c24a/data/?code_de_la_commune__exact=${codeInsee}&limit=${limit}`,
                        res
                    );
                    return;
                }

                // GET /api/elus/deputes
                if (path === '/deputes') {
                    await proxyGet('https://www.nosdeputes.fr/deputes/json', res);
                    return;
                }

                // GET /api/elus/senateurs
                if (path === '/senateurs') {
                    await proxyGet('https://www.nossenateurs.fr/senateurs/json', res);
                    return;
                }

                next();
            });
        },
    };
}
