/**
 * sncf-proxy.ts — Plugin Vite qui proxy les requêtes SNCF API pour le dev local.
 * En prod, c'est la serverless function api/transport/disruptions.js qui fait ça.
 */

import type { Plugin } from 'vite';
import { loadEnv } from 'vite';

const SNCF_API_BASE = 'https://api.sncf.com/v1';

export function sncfProxyPlugin(): Plugin {
    return {
        name: 'sncf-proxy',
        configureServer(server) {
            // Load env variables (including non-VITE_ prefixed ones)
            const env = loadEnv('development', process.cwd(), '');
            const sncfApiKey = env.SNCF_API_KEY;
            // Proxy pour les perturbations SNCF
            server.middlewares.use('/api/transport/disruptions', async (_req, res) => {
                const apiKey = sncfApiKey;

                if (!apiKey) {
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'SNCF_API_KEY not configured' }));
                    return;
                }

                try {
                    // Encode API key for Basic Auth (SNCF uses key as username, no password)
                    const authHeader = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');

                    // depth=2 includes detailed object info with coordinates
                    const url = `${SNCF_API_BASE}/coverage/sncf/disruptions?count=100&depth=2`;
                    const resp = await fetch(url, {
                        headers: {
                            'Authorization': authHeader,
                            'Accept': 'application/json',
                        },
                        signal: AbortSignal.timeout(15000),
                    });

                    if (!resp.ok) {
                        console.error('[sncf-proxy] API error:', resp.status, await resp.text());
                        res.statusCode = resp.status;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: `SNCF API error: ${resp.status}` }));
                        return;
                    }

                    const data = await resp.json();
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    res.setHeader('Cache-Control', 'public, max-age=300');
                    res.end(JSON.stringify(data));
                } catch (err) {
                    console.error('[sncf-proxy] Fetch failed:', err);
                    res.statusCode = 502;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'SNCF API fetch failed' }));
                }
            });

            // Proxy pour les lignes/trajets
            server.middlewares.use('/api/sncf/lines', async (_req, res) => {
                const apiKey = sncfApiKey;

                if (!apiKey) {
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'SNCF_API_KEY not configured' }));
                    return;
                }

                try {
                    const authHeader = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');

                    const url = `${SNCF_API_BASE}/coverage/sncf/lines?count=200`;
                    const resp = await fetch(url, {
                        headers: {
                            'Authorization': authHeader,
                            'Accept': 'application/json',
                        },
                        signal: AbortSignal.timeout(15000),
                    });

                    if (!resp.ok) {
                        res.statusCode = resp.status;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: `SNCF API error: ${resp.status}` }));
                        return;
                    }

                    const data = await resp.json();
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    res.setHeader('Cache-Control', 'public, max-age=3600');
                    res.end(JSON.stringify(data));
                } catch (err) {
                    console.error('[sncf-proxy] Lines fetch failed:', err);
                    res.statusCode = 502;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'SNCF API fetch failed' }));
                }
            });
        },
    };
}
