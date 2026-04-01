import type { Plugin } from 'vite';
import { loadEnv } from 'vite';

export function trafficRoadProxyPlugin(): Plugin {
  return {
    name: 'traffic-road-proxy',
    configureServer(server) {
      const env = loadEnv('development', process.cwd(), '');
      const tomtomKey = env.VITE_TOMTOM_API_KEY || env.TOMTOM_API_KEY || '';

      server.middlewares.use('/api/traffic/road', async (req, res) => {
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
          const bbox = requestUrl.searchParams.get('bbox');
          if (!bbox) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'bbox query param is required' }));
            return;
          }

          const upstreamUrl =
            `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${encodeURIComponent(tomtomKey)}` +
            `&bbox=${encodeURIComponent(bbox)}` +
            `&fields=${encodeURIComponent('{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description},startTime,endTime,from,to,length,delay,roadNumbers,timeValidity,probabilityOfOccurrence,numberOfReports,lastReportTime}}}')}` +
            `&language=fr-FR&timeValidityFilter=present,future`;

          const response = await fetch(upstreamUrl, { signal: AbortSignal.timeout(10_000) });
          const text = await response.text();

          res.statusCode = response.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(text);
        } catch (error) {
          console.error('[traffic-road-proxy]', error);
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            error: error instanceof Error ? error.message : 'Road traffic fetch failed',
          }));
        }
      });
    },
  };
}
