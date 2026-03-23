/**
 * api/rss-proxy.js — Vercel Serverless Function
 * Proxy RSS pour contourner CORS en production.
 * Identique au plugin Vite mais en Edge Function.
 */

export const config = { runtime: 'edge' };

/**
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export default async function handler(request) {
    const { searchParams } = new URL(request.url);
    const feedUrl = searchParams.get('url');

    if (!feedUrl) {
        return new Response(JSON.stringify({ error: 'Missing ?url= parameter' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // Validate URL (basic whitelist: only http/https)
    let parsed;
    try {
        parsed = new URL(feedUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('Invalid protocol');
        }
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid URL' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
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
            return new Response(JSON.stringify({ error: `Upstream ${resp.status}` }), {
                status: resp.status,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const xml = await resp.text();
        return new Response(xml, {
            status: 200,
            headers: {
                'Content-Type': 'application/xml; charset=utf-8',
                'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
                'Access-Control-Allow-Origin': '*',
            },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: 'Fetch failed', message: err.message }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
