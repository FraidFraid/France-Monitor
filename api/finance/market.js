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

        const BOURSO_MAP = {
            'CAC.INDX': 'bourse/indices/cours/1rPCAC/',
            'DAX.INDX': 'bourse/indices/cours/1rPDAX/',
            'STOXX50.INDX': 'bourse/indices/cours/1rPSTOXX50E/',
            'SPX.INDX': 'bourse/indices/cours/1xSPX/',
            'TTE.PA': 'cours/1rPTTE/',
            'AIR.PA': 'cours/1rPAIR/',
            'HO.PA': 'cours/1rPHO/',
            'SAF.PA': 'cours/1rPSAF/',
            'DG.PA': 'cours/1rPDG/',
            'SAN.PA': 'cours/1rPSAN/',
            'ORA.PA': 'cours/1rPORA/',
            'GLE.PA': 'cours/1rPGLE/'
        };

        console.log('[Finance] Cache Miss - Fetching from Boursorama (Scraping)');
        const fetchBourso = async (symbol, path) => {
            try {
                const res = await fetch(`https://www.boursorama.com/${path}`, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Safari/537.36' },
                    signal: AbortSignal.timeout(6000)
                });
                const html = await res.text();
                const priceMatch = html.match(/class="c-instrument c-instrument--last"[^>]*>([^<]+)<\/span>/);
                const varMatch = html.match(/class="c-instrument c-instrument--variation"[^>]*>([^<]+)<\/span>/);
                
                if (priceMatch && priceMatch[1]) {
                    const price = parseFloat(priceMatch[1].replace(/\s/g, '').replace(',', '.'));
                    let pct = 0;
                    if (varMatch && varMatch[1]) {
                        pct = parseFloat(varMatch[1].replace('%', '').replace('+', '').replace(/\s/g, '').replace(',', '.'));
                    }
                    return {
                        symbol,
                        last: price,
                        open: price / (1 + (pct / 100)),
                        date: new Date().toISOString()
                    };
                }
            } catch (e) {
                console.error(`[Finance] Boursorama fetch failed for ${symbol}:`, e.message);
            }
            return null;
        };

        const results = await Promise.all(
            Object.entries(BOURSO_MAP).map(([sym, path]) => fetchBourso(sym, path))
        );

        const data = { data: results.filter(Boolean) };

        // Stockage cache dans Redis 
        await redis.setex(CACHE_KEY, 900, data);

        res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=120');
        res.status(200).json(data);
    } catch (err) {
        console.error('[Finance] Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}
