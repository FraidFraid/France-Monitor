import type { Plugin } from 'vite';
import { fetchMilitaryFlightsSnapshot } from '../../api/_shared/military-flights.js';

export function militaryFlightsProxyPlugin(): Plugin {
  return {
    name: 'military-flights-proxy',
    configureServer(server) {
      server.middlewares.use('/api/traffic/military', async (_req, res) => {
        try {
          const snapshot = await fetchMilitaryFlightsSnapshot(fetch);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=30');
          res.end(JSON.stringify(snapshot));
        } catch (error) {
          console.error('[military-flights-proxy]', error);
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            error: error instanceof Error ? error.message : 'Military flights fetch failed',
          }));
        }
      });
    },
  };
}
