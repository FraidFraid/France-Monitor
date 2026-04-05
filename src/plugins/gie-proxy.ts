import type { Plugin, ViteDevServer } from 'vite';

export default function gieProxyPlugin(): Plugin {
  return {
    name: 'gie-proxy',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/gie/agsi', async (_req, res) => {
        const apiKey = process.env.GIE_API_KEY;
        const fallbackAGSI = {
          data: [
            {
              name: 'Storengy',
              workingGas: '109.84',
              injection: '0',
              withdrawal: '254.12',
              info: 'Fallback Dev Mode'
            },
            {
              name: 'Teréga',
              workingGas: '23.41',
              injection: '12.0',
              withdrawal: '0',
              info: 'Fallback Dev Mode'
            }
          ]
        };

        if (!apiKey) {
          console.warn('[GIE Proxy] GIE_API_KEY not found in .env, returning fallback AGSI data for dev purposes');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(fallbackAGSI));
          return;
        }

        try {
          // Ex: https://agsi.gie.eu/api?country=FR
          const response = await fetch(`https://agsi.gie.eu/api?country=FR`, {
            headers: { 'x-key': apiKey }
          });
          const data = await response.text();
          res.setHeader('Content-Type', 'application/json');
          res.end(data);
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err) }));
        }
      });

      server.middlewares.use('/api/gie/alsi', async (_req, res) => {
        const apiKey = process.env.GIE_API_KEY;
        const fallbackALSI = {
          data: [
            {
              name: 'Fos Cavaou',
              sendOut: '145.2',
              inventory: '12',
              info: 'Fallback Dev Mode'
            },
            {
              name: 'Montoir',
              sendOut: '210.0',
              inventory: '45',
              info: 'Fallback Dev Mode'
            },
            {
              name: 'Dunkerque LNG',
              sendOut: '180.5',
              inventory: '33',
              info: 'Fallback Dev Mode'
            }
          ]
        };

        if (!apiKey) {
          console.warn('[GIE Proxy] GIE_API_KEY not found in .env, returning fallback ALSI data for dev purposes');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(fallbackALSI));
          return;
        }

        try {
          const response = await fetch(`https://alsi.gie.eu/api?country=FR`, {
            headers: { 'x-key': apiKey }
          });
          const data = await response.text();
          res.setHeader('Content-Type', 'application/json');
          res.end(data);
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
    }
  };
}
