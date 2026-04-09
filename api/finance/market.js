/**
 * api/finance/market.js — Vercel Serverless Function
 *
 * Source : TradingView Scanner API
 * Remplace Yahoo Finance qui bloque avec des 429 Too Many Requests.
 *
 * Cache Redis 15 min pour ne pas surcharger TradingView.
 */

import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || '',
    token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
});

const INTERNAL_TO_TV = {
    'CAC.INDX':     'EURONEXT:PX1',
    'DAX.INDX':     'XETR:DAX',
    'STOXX50.INDX': 'TVC:SX5E',
    'SPX.INDX':     'SP:SPX',
    'TTE.PA':       'EURONEXT:TTE',
    'AIR.PA':       'EURONEXT:AIR',
    'HO.PA':        'EURONEXT:HO',
    'SAF.PA':       'EURONEXT:SAF',
    'DG.PA':        'EURONEXT:DG',
    'SAN.PA':       'EURONEXT:SAN',
    'ORA.PA':       'EURONEXT:ORA',
    'GLE.PA':       'EURONEXT:GLE',
    'EURUSD=X':     'FX:EURUSD',
    'EURGBP=X':     'FX:EURGBP',
    'EURCHF=X':     'FX:EURCHF',
    'EURJPY=X':     'FX:EURJPY',
};

const TV_TO_INTERNAL = Object.fromEntries(
    Object.entries(INTERNAL_TO_TV).map(([k, v]) => [v, k])
);

const CACHE_KEY = 'fm:finance:market:v7:tv:fx4';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        // Lecture cache Redis
        const cached = await redis.get(CACHE_KEY);
        if (cached) {
            console.log('[Finance] Cache hit TV');
            res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=120');
            res.status(200).json(cached);
            return;
        }

        console.log('[Finance] Cache miss — fetching TradingView Scanner');

        const tickers = Object.values(INTERNAL_TO_TV);
        const payload = {
            symbols: { tickers },
            columns: ["name", "close", "change"]
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
            throw new Error(`TradingView API returned ${resp.status}`);
        }

        const raw = await resp.json();
        
        const data = (raw.data || []).map(item => {
            const internalSym = TV_TO_INTERNAL[item.s];
            if (!internalSym) return null;
            
            const close = item.d[1] || 0;
            const changePercent = item.d[2] || 0; 
            const open = close / (1 + (changePercent / 100));

            return {
                symbol: internalSym,
                last: close,
                open: open,
                date: new Date().toISOString()
            };
        }).filter(Boolean);

        console.log(`[Finance] ${data.length} symboles récupérés via TV`);

        const responsePayload = { data };

        // Mise en cache 15 min
        if (data.length > 0) {
            await redis.setex(CACHE_KEY, 900, responsePayload);
        }

        res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=120');
        res.status(200).json(responsePayload);

    } catch (err) {
        console.error('[Finance] Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}
