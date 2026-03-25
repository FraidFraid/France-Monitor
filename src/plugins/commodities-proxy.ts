import type { Plugin } from 'vite';

export function commoditiesProxyPlugin(): Plugin {
  return {
    name: 'commodities-proxy',
    configureServer(server) {
      server.middlewares.use('/api/finance/commodities', async (_req, res) => {
        // Symboles URL-encodés (= → %3D) pour compatibilité maximale
        const SYMBOLS = 'BZ%3DF,CL%3DF,NG%3DF,GC%3DF,SI%3DF,HG%3DF,ZW%3DF,ZC%3DF,ZS%3DF';
        const URL = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${SYMBOLS}&range=1d&interval=5m`;

        try {
          const resp = await fetch(URL, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
          });
          if (!resp.ok) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `Upstream error: ${resp.status}` }));
            return;
          }
          const json = await resp.json();
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=900');
          res.end(JSON.stringify(json));
        } catch (err) {
          console.error('[commodities-proxy]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Fetch failed' }));
        }
      });
    },
  };
}
