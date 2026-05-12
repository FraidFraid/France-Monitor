/**
 * citizen-outages-proxy.ts — Vite Dev Plugin
 *
 * En développement, proxifie `/api/outages/citizen`.
 * En production, la route est gérée par Vercel Serverless.
 *
 * Important :
 *   Le calcul des zones signalées est partagé avec la prod via
 *   `api/_shared/citizen-outages-handler.js` pour éviter toute divergence
 *   entre Vite local et Vercel.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

import { fetchCitizenOutagesData } from '../../api/_shared/citizen-outages-handler.js';

const DEV_CACHE_TTL_MS = 10 * 60_000;

let devCache: { data: unknown; fetchedAt: number } | null = null;

export function citizenOutagesProxyPlugin(): Plugin {
    return {
        name: 'citizen-outages-proxy',
        configureServer(server) {
            const handler = async (_req: IncomingMessage, res: ServerResponse) => {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
                res.setHeader('Content-Type', 'application/json');

                if (_req.method === 'OPTIONS') {
                    res.statusCode = 204;
                    res.end();
                    return;
                }

                const now = Date.now();
                if (devCache && now - devCache.fetchedAt < DEV_CACHE_TTL_MS) {
                    res.statusCode = 200;
                    res.end(JSON.stringify(devCache.data));
                    return;
                }

                try {
                    console.info('[citizen-outages] Shared scraper (dev/prod parity)...');
                    const data = await fetchCitizenOutagesData();
                    devCache = { data, fetchedAt: now };
                    res.statusCode = 200;
                    res.end(JSON.stringify(data));
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    console.warn('[citizen-outages] Shared scraper failed:', message);

                    if (devCache) {
                        const cached = devCache.data as { stats?: Record<string, unknown> } & Record<string, unknown>;
                        res.statusCode = 200;
                        res.end(JSON.stringify({
                            ...cached,
                            stats: {
                                ...(cached.stats ?? {}),
                                stale: true,
                            },
                        }));
                        return;
                    }

                    res.statusCode = 502;
                    res.end(JSON.stringify({ error: `Citizen outages fetch failed: ${message}` }));
                }
            };

            server.middlewares.use('/api/outages/citizen', handler);
            server.middlewares.use('/api/citizen-outages', handler);
        },
    };
}
