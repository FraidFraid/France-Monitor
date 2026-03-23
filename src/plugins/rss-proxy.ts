/**
 * rss-proxy.ts — Plugin Vite qui proxy les requêtes RSS pour le dev local.
 * En prod, c'est le serverless function api/rss-proxy.js qui fait ça.
 * Pattern WorldMonitor : même approche que rssProxyPlugin().
 */

import type { Plugin } from 'vite';

export function rssProxyPlugin(): Plugin {
    return {
        name: 'rss-proxy',
        configureServer(server) {
            server.middlewares.use('/api/rss-proxy', async (req, res) => {
                const url = new URL(req.url ?? '', 'http://localhost');
                const feedUrl = url.searchParams.get('url');

                if (!feedUrl) {
                    res.statusCode = 400;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Missing ?url= parameter' }));
                    return;
                }

                try {
                    // User-Agent réaliste pour éviter les blocages anti-bot
                    const userAgents = [
                        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    ];
                    const ua = userAgents[Math.floor(Math.random() * userAgents.length)];

                    const resp = await fetch(feedUrl, {
                        headers: {
                            'User-Agent': ua,
                            'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*',
                            'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
                            'Cache-Control': 'no-cache',
                        },
                        redirect: 'follow', // Suivre les redirections 301/302
                        signal: AbortSignal.timeout(8000),
                    });

                    if (!resp.ok) {
                        res.statusCode = resp.status;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: `Upstream ${resp.status}` }));
                        return;
                    }

                    const xml = await resp.text();
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
                    res.setHeader('Cache-Control', 'public, max-age=300');
                    res.end(xml);
                } catch (err) {
                    console.error('[rss-proxy]', feedUrl, err);
                    res.statusCode = 502;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Fetch failed' }));
                }
            });
        },
    };
}
