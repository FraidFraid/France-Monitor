import type { Plugin } from 'vite';

export function financeProxyPlugin(): Plugin {
    return {
        name: 'finance-proxy',
        configureServer(server) {
            server.middlewares.use('/api/finance/market', async (_req, res) => {
                const API_KEY = process.env.MARKETSTACK_API_KEY;
                if (!API_KEY) {
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'MARKETSTACK_API_KEY is not defined in env' }));
                    return;
                }

                console.log('[Finance] Fetching from Boursorama (Scraping)');
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

                const fetchBourso = async (symbol: string, path: string) => {
                    try {
                        const res = await fetch(`https://www.boursorama.com/${path}`, {
                            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Safari/537.36' },
                            signal: AbortSignal.timeout(6000)
                        });
                        const html = await res.text();
                        const priceMatch = html.match(/class="c-instrument c-instrument--last"[^>]*>([^<]+)<\/span>/);
                        const varMatch = html.match(/class="c-instrument c-instrument--variation"[^>]*>([^<]+)<\/span>/);
                        
                        if (priceMatch && priceMatch[1]) {
                            const price = parseFloat(priceMatch[1].replace(/\\s/g, '').replace(',', '.'));
                            let pct = 0;
                            if (varMatch && varMatch[1]) {
                                pct = parseFloat(varMatch[1].replace('%', '').replace('+', '').replace(/\\s/g, '').replace(',', '.'));
                            }
                            return {
                                symbol,
                                last: price,
                                open: price / (1 + (pct / 100)),
                                date: new Date().toISOString()
                            };
                        }
                    } catch (e: any) {
                        console.error(`[Finance] Boursorama fetch failed for ${symbol}:`, e.message);
                    }
                    return null;
                };

                try {
                    const results = await Promise.all(
                        Object.entries(BOURSO_MAP).map(([sym, path]) => fetchBourso(sym, path))
                    );

                    const json = { data: results.filter(Boolean) };

                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.setHeader('Cache-Control', 'public, max-age=900'); // Cache 15 minutes
                    res.end(JSON.stringify(json));
                } catch (err: any) {
                    console.error('[finance-proxy]', err);
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Fetch failed' }));
                }
            });
        },
    };
}
