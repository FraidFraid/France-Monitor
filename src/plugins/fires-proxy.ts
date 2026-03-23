/**
 * fires-proxy.ts — Vite Plugin (dev)
 *
 * Intercepte /api/fires et proxifie vers NASA FIRMS VIIRS C2 (Europe 24h).
 * Contourne les restrictions CORS de NASA côté navigateur.
 */

import type { Plugin } from 'vite';

const NASA_FIRMS_URL =
    'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Europe_24h.csv';

export function firesProxyPlugin(): Plugin {
    return {
        name: 'fires-proxy',
        configureServer(server) {
            server.middlewares.use('/api/fires', async (_req, res) => {
                try {
                    const upstream = await fetch(NASA_FIRMS_URL, {
                        signal: AbortSignal.timeout(15000),
                        headers: { 'User-Agent': 'FranceMonitor/1.0 (github.com/france-monitor)' },
                    });

                    if (!upstream.ok) {
                        res.statusCode = 502;
                        res.end(`NASA FIRMS HTTP ${upstream.status}`);
                        return;
                    }

                    const csv = await upstream.text();
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.end(csv);
                } catch (err) {
                    console.error('[fires-proxy] Erreur:', err);
                    res.statusCode = 502;
                    res.end('Proxy error');
                }
            });
        },
    };
}
