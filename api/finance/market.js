import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || '',
    token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
});

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const API_KEY = process.env.MARKETSTACK_API_KEY;
    if (!API_KEY) {
        res.status(500).json({ error: 'Missing MARKETSTACK API KEY in environment' });
        return;
    }

    const SYMBOLS = 'CAC.INDX,TTE.PA,AIR.PA,HO.PA,SAF.PA,DG.PA,SAN.PA,ORA.PA,GLE.PA';
    const CACHE_KEY = `fm:finance:market:${SYMBOLS}`;

    try {
        // Obtenir le cache (TTL de 15 min = 900s) pour ne pas brûler le quota Marketstack
        const cached = await redis.get(CACHE_KEY);
        if (cached) {
            console.log('[Finance] Cache Hit');
            res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=120');
            res.status(200).json(cached);
            return;
        }

        console.log('[Finance] Cache Miss - Fetching from Marketstack');
        const URL = `http://api.marketstack.com/v1/intraday/latest?access_key=${API_KEY}&symbols=${SYMBOLS}`;

        const resp = await fetch(URL, { signal: AbortSignal.timeout(10_000) });
        if (!resp.ok) {
            console.error('[Finance] Error from Marketstack:', resp.status);
            res.status(502).json({ error: `Downstream API error ${resp.status}` });
            return;
        }

        const data = await resp.json();

        // Stockage cache dans Redis 
        await redis.setex(CACHE_KEY, 900, data);

        res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=120');
        res.status(200).json(data);
    } catch (err) {
        console.error('[Finance] Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}
