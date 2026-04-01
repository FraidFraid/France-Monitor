/**
 * api/finance/commodities.js — Vercel Serverless Function
 * Proxy Yahoo Finance Spark API pour les matières premières.
 * Miroir prod du plugin Vite src/plugins/commodities-proxy.ts.
 *
 * Endpoint: GET /api/finance/commodities
 * Response: Yahoo Finance Spark shape — { spark: { result: [...] } }
 *
 * Cache Redis : 15 min (TTL 900s) pour ne pas brûler le quota Yahoo.
 */

import { Redis } from '@upstash/redis';

const SYMBOLS = 'BZ%3DF,CL%3DF,NG%3DF,GC%3DF,SI%3DF,HG%3DF,ZW%3DF,ZC%3DF,ZS%3DF';
const YAHOO_URL = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${SYMBOLS}&range=1d&interval=5m`;
const CACHE_KEY = 'fm:finance:commodities';
const CACHE_TTL = 900; // 15 minutes

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL || '',
        token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
    });

    try {
        const cached = await redis.get(CACHE_KEY);
        if (cached) {
            res.setHeader('Cache-Control', `s-maxage=${CACHE_TTL}, stale-while-revalidate=120`);
            res.status(200).json(cached);
            return;
        }
    } catch (err) {
        console.warn('[Commodities] Redis get failed, proceeding without cache:', err.message);
    }

    try {
        const resp = await fetch(YAHOO_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(10_000),
        });

        if (!resp.ok) {
            console.error('[Commodities] Yahoo Finance error:', resp.status);
            res.status(502).json({ error: `Upstream HTTP ${resp.status}` });
            return;
        }

        const data = await resp.json();

        try {
            await redis.setex(CACHE_KEY, CACHE_TTL, data);
        } catch (err) {
            console.warn('[Commodities] Redis set failed:', err.message);
        }

        res.setHeader('Cache-Control', `s-maxage=${CACHE_TTL}, stale-while-revalidate=120`);
        res.status(200).json(data);
    } catch (err) {
        console.error('[Commodities] Fetch failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}
