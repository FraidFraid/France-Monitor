import type { Plugin } from 'vite';
import { loadEnv } from 'vite';

/**
 * traffic-tile-proxy.ts — Miroir dev de api/traffic/tile.js.
 * Proxy des tuiles raster TomTom Traffic Flow (PNG binaire) ; clé côté serveur.
 */
export function trafficTileProxyPlugin(): Plugin {
  return {
    name: 'traffic-tile-proxy',
    configureServer(server) {
      const env = loadEnv('development', process.cwd(), '');
      const tomtomKey = env.TOMTOM_API_KEY || env.VITE_TOMTOM_API_KEY || '';

      server.middlewares.use('/api/traffic/tile', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        if (!tomtomKey) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'TomTom API key missing' }));
          return;
        }

        try {
          const requestUrl = new URL(req.url ?? '', 'http://127.0.0.1:3001');
          const z = Number(requestUrl.searchParams.get('z'));
          const x = Number(requestUrl.searchParams.get('x'));
          const y = Number(requestUrl.searchParams.get('y'));
          const valid =
            Number.isInteger(z) && z >= 0 && z <= 22 &&
            Number.isInteger(x) && x >= 0 &&
            Number.isInteger(y) && y >= 0;
          if (!valid) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'z/x/y integer query params are required (0<=z<=22)' }));
            return;
          }

          const upstreamUrl =
            `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/${z}/${x}/${y}.png` +
            `?tileSize=256&key=${encodeURIComponent(tomtomKey)}`;

          const response = await fetch(upstreamUrl, { signal: AbortSignal.timeout(10_000) });
          if (!response.ok) {
            res.statusCode = response.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `TomTom tile ${response.status}` }));
            return;
          }

          const buffer = Buffer.from(await response.arrayBuffer());
          res.statusCode = 200;
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(buffer);
        } catch (error) {
          console.error('[traffic-tile-proxy]', error);
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            error: error instanceof Error ? error.message : 'Tile fetch failed',
          }));
        }
      });
    },
  };
}
