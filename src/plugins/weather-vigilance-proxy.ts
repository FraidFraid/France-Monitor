import type { Plugin } from 'vite';
import { loadEnv } from 'vite';

/**
 * weather-vigilance-proxy.ts — Miroir dev de api/weather/vigilance.js.
 * Proxy Météo-France DPVigilance ; ajoute le header `apikey` côté serveur.
 */
export function weatherVigilanceProxyPlugin(): Plugin {
  const UPSTREAM_URL =
    'https://public-api.meteofrance.fr/public/DPVigilance/v1/cartevigilance/encours';

  return {
    name: 'weather-vigilance-proxy',
    configureServer(server) {
      const env = loadEnv('development', process.cwd(), '');
      const apiKey = env.METEO_FRANCE_API_KEY || env.VITE_METEOFRANCE_API_KEY || '';

      server.middlewares.use('/api/weather/vigilance', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        if (!apiKey) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Météo-France API key missing' }));
          return;
        }

        try {
          const response = await fetch(UPSTREAM_URL, {
            headers: {
              Accept: 'application/json',
              apikey: apiKey,
            },
            signal: AbortSignal.timeout(8_000),
          });

          const body = await response.text();
          const contentType = response.headers.get('content-type') || 'application/json; charset=utf-8';
          res.statusCode = response.status;
          res.setHeader('Content-Type', contentType);
          res.setHeader('Cache-Control', 'no-cache');
          res.end(body);
        } catch (error) {
          console.error('[weather-vigilance-proxy]', error);
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            error: error instanceof Error ? error.message : 'Vigilance fetch failed',
          }));
        }
      });
    },
  };
}
