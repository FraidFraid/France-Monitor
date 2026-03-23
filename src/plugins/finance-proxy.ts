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

                // Symbols: CAC 40, TotalEnergies, Airbus, Thales, Safran, Vinci, Sanofi, Orange, SocGen
                const SYMBOLS = 'CAC.INDX,TTE.PA,AIR.PA,HO.PA,SAF.PA,DG.PA,SAN.PA,ORA.PA,GLE.PA';
                const URL = `http://api.marketstack.com/v1/intraday/latest?access_key=${API_KEY}&symbols=${SYMBOLS}`;

                try {
                    const resp = await fetch(URL);
                    if (!resp.ok) {
                        res.statusCode = 502;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: `Upstream error: ${resp.status}` }));
                        return;
                    }

                    const json = await resp.json();

                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.setHeader('Cache-Control', 'public, max-age=900'); // Cache 15 minutes
                    res.end(JSON.stringify(json));
                } catch (err) {
                    console.error('[finance-proxy]', err);
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Fetch failed' }));
                }
            });
        },
    };
}
