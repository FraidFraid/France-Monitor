import type { Plugin } from 'vite';

/**
 * finance-proxy.ts — Plugin Vite dev pour /api/finance/market.
 *
 * Source : TradingView Scanner API
 * Remplace Yahoo Finance qui bloque avec 429.
 */

const INTERNAL_TO_TV: Record<string, string> = {
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

export function financeProxyPlugin(): Plugin {
    return {
        name: 'finance-proxy',
        configureServer(server) {
            server.middlewares.use('/api/finance/market', async (_req, res) => {
                console.log('[Finance] Fetching from TradingView Scanner');

                try {
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
                        signal: AbortSignal.timeout(10_000),
                    });

                    if (!resp.ok) {
                        console.error(`[Finance] TradingView returned ${resp.status}`);
                        res.statusCode = resp.status;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: `TV upstream ${resp.status}`, data: [] }));
                        return;
                    }

                    // Colonnes demandées : ["name", "close", "change"] → d = [nom, clôture, variation%]
                    const raw = await resp.json() as {
                        data?: Array<{
                            s: string;
                            d: [string, number | null, number | null];
                        }>;
                    };

                    const quotes = raw?.data || [];
                    const data = quotes
                        .map((item) => {
                            const internalSym = TV_TO_INTERNAL[item.s];
                            if (!internalSym) return null;
                            
                            const close = item.d[1] || 0;
                            const changePercent = item.d[2] || 0; 
                            const open = close / (1 + (changePercent / 100));

                            return { symbol: internalSym, last: close, open: open, date: new Date().toISOString() };
                        })
                        .filter(Boolean);

                    console.log(`[Finance] ${data.length} symboles récupérés (TV)`);
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.setHeader('Cache-Control', 'public, max-age=300');
                    res.end(JSON.stringify({ data }));
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.error('[finance-proxy] Fetch error:', msg);
                    res.statusCode = 502;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Fetch failed', data: [] }));
                }
            });
        },
    };
}
