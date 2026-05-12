/**
 * rte-iip-proxy.ts — Vite Dev Plugin
 *
 * En dev, forward `/api/rte-iip` vers la fonction Vercel déployée.
 * Évite de réimplémenter le parsing RSS IIP en local.
 */

import type { Plugin } from 'vite';

const PROD_ENDPOINT = 'https://www.francemonitor.com/api/rte-iip';
const TIMEOUT_MS = 28_000;

export function rteIipProxyPlugin(): Plugin {
    return {
        name: 'rte-iip-proxy',
        configureServer(server) {
            server.middlewares.use('/api/rte-iip', async (_req, res) => {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Content-Type', 'application/json');
                try {
                    const resp = await fetch(PROD_ENDPOINT, {
                        signal: AbortSignal.timeout(TIMEOUT_MS),
                        headers: { Accept: 'application/json' },
                    });
                    const body = await resp.text();
                    res.statusCode = resp.status;
                    res.end(body);
                } catch (err) {
                    res.statusCode = 502;
                    res.end(JSON.stringify({
                        error: 'Proxy fetch failed',
                        detail: (err as Error).message,
                        endpoint: PROD_ENDPOINT,
                    }));
                }
            });
        },
    };
}
