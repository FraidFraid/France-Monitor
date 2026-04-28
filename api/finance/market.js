/**
 * api/finance/market.js — Vercel Serverless Function
 *
 * Source : TradingView Scanner API
 * Cache Redis 15 min pour ne pas surcharger TradingView.
 */

import { Redis } from '@upstash/redis';

const redis =
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
        ? new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
        })
        : null;

const INTERNAL_TO_TV = {
    'CAC.INDX': 'EURONEXT:PX1',
    'DAX.INDX': 'XETR:DAX',
    'STOXX50.INDX': 'TVC:SX5E',
    'SPX.INDX': 'SP:SPX',
    'TTE.PA': 'EURONEXT:TTE',
    'AIR.PA': 'EURONEXT:AIR',
    'HO.PA': 'EURONEXT:HO',
    'SAF.PA': 'EURONEXT:SAF',
    'DG.PA': 'EURONEXT:DG',
    'SAN.PA': 'EURONEXT:SAN',
    'ORA.PA': 'EURONEXT:ORA',
    'GLE.PA': 'EURONEXT:GLE',
    'EURUSD=X': 'FX:EURUSD',
    'EURGBP=X': 'FX:EURGBP',
    'EURCHF=X': 'FX:EURCHF',
    'EURJPY=X': 'FX:EURJPY',
};

const TV_TO_INTERNAL = Object.fromEntries(
    Object.entries(INTERNAL_TO_TV).map(([k, v]) => [v, k])
);

const CACHE_KEY = 'fm:finance:market:v7:tv:fx4';
const CACHE_TTL = 900;

async function safeRedisGet(key) {
    if (!redis) return null;
    try {
        return await redis.get(key);
    } catch (err) {
        console.warn('[Finance] Redis get failed:', err?.message || err);
        return null;
    }
}

async function safeRedisSetex(key, ttl, value) {
    if (!redis) return false;
    try {
        await redis.setex(key, ttl, value);
        return true;
    } catch (err) {
        console.warn('[Finance] Redis set failed:', err?.message || err);
        return false;
    }
}

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const cached = await safeRedisGet(CACHE_KEY);
        if (cached) {
            console.log('[Finance] Cache hit TV');
            res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=120');
            return res.status(200).json(cached);
        }

        console.log('[Finance] Cache miss — fetching TradingView Scanner');

        const tickers = Object.values(INTERNAL_TO_TV);
        const payload = {
            symbols: { tickers },
            columns: ['name', 'close', 'change'],
        };

        const resp = await fetch('https://scanner.tradingview.com/global/scan', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'FranceMonitor/1.0',
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(8000),
        });

        if (!resp.ok) {
            const text = await resp.text();
            console.error('[Finance] TradingView upstream failed:', resp.status, text.slice(0, 500));
            return res.status(resp.status).json({
                error: 'finance_upstream_failed',
                status: resp.status,
            });
        }

        const raw = await resp.json();

        const data = (raw.data || [])
            .map((item) => {
                const internalSym = TV_TO_INTERNAL[item.s];
                if (!internalSym) return null;

                const close = item.d?.[1] || 0;
                const changePercent = item.d?.[2] || 0;
                const open = close / (1 + changePercent / 100);

                return {
                    symbol: internalSym,
                    last: close,
                    open,
                    date: new Date().toISOString(),
                };
            })
            .filter(Boolean);

        console.log(`[Finance] ${data.length} symboles récupérés via TV`);

        const responsePayload = { data };

        if (data.length > 0) {
            await safeRedisSetex(CACHE_KEY, CACHE_TTL, responsePayload);
        }

        res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=120');
        return res.status(200).json(responsePayload);
    } catch (err) {
        console.error('[Finance] Error:', err);
        return res.status(500).json({
            error: 'finance_internal_error',
            message: err?.message || 'Internal Server Error',
        });
    }
}