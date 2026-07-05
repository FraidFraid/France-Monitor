import type { Plugin } from 'vite';
import { loadEnv } from 'vite';

/**
 * traffic-flow-proxy.ts — Miroir dev de api/traffic/flow.js.
 * Proxy TomTom Flow Segment Data (v4) ; garde la clé TomTom hors du bundle.
 */
export function trafficFlowProxyPlugin(): Plugin {
  return {
    name: 'traffic-flow-proxy',
    configureServer(server) {
      const env = loadEnv('development', process.cwd(), '');
      const tomtomKey = env.TOMTOM_API_KEY || env.VITE_TOMTOM_API_KEY || '';

      server.middlewares.use('/api/traffic/flow', async (req, res) => {
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
          const point = requestUrl.searchParams.get('point') ?? '';
          if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(point)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'point query param (lat,lon) is required' }));
            return;
          }

          const zoomRaw = Number(requestUrl.searchParams.get('zoom') ?? 10);
          const zoom = Math.max(0, Math.min(22, Math.round(Number.isFinite(zoomRaw) ? zoomRaw : 10)));

          const upstreamUrl =
            `https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/${zoom}/json` +
            `?key=${encodeURIComponent(tomtomKey)}&point=${encodeURIComponent(point)}&unit=kmph&thickness=10`;

          const response = await fetch(upstreamUrl, { signal: AbortSignal.timeout(10_000) });
          const text = await response.text();

          res.statusCode = response.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(text);
        } catch (error) {
          console.error('[traffic-flow-proxy]', error);
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            error: error instanceof Error ? error.message : 'Flow segment fetch failed',
          }));
        }
      });
    },
  };
}
