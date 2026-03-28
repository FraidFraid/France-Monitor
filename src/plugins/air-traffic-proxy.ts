import type { Plugin } from 'vite';
import { loadEnv } from 'vite';
import { fetchAirTrafficSnapshot } from '../../api/_shared/air-traffic.js';
import { fetchAirTrafficSnapshotFromRelay } from '../../api/_shared/air-relay.js';

export function airTrafficProxyPlugin(): Plugin {
  return {
    name: 'air-traffic-proxy',
    configureServer(server) {
      const env = loadEnv('development', process.cwd(), '');
      if (env.OPENSKY_CLIENT_ID) process.env.OPENSKY_CLIENT_ID = env.OPENSKY_CLIENT_ID;
      if (env.OPENSKY_CLIENT_SECRET) process.env.OPENSKY_CLIENT_SECRET = env.OPENSKY_CLIENT_SECRET;

      server.middlewares.use('/api/traffic/air', async (_req, res) => {
        try {
          let snapshot;
          try {
            snapshot = await fetchAirTrafficSnapshotFromRelay(fetch, 'http://127.0.0.1:8090');
          } catch {
            snapshot = await fetchAirTrafficSnapshot(fetch);
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(JSON.stringify(snapshot));
        } catch (error) {
          console.error('[air-traffic-proxy]', error);
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            error: error instanceof Error ? error.message : 'Air traffic fetch failed',
          }));
        }
      });
    },
  };
}
