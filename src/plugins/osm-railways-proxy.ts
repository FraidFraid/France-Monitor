import type { Plugin } from 'vite';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

function parseBbox(raw: string | null): { minLat: number; minLon: number; maxLat: number; maxLon: number } | null {
  if (!raw) return null;
  const parts = raw.split(',').map((value) => Number(value.trim()));
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return null;
  const [minLat, minLon, maxLat, maxLon] = parts;
  return { minLat, minLon, maxLat, maxLon };
}

function buildQuery({ minLat, minLon, maxLat, maxLon }: { minLat: number; minLon: number; maxLat: number; maxLon: number }): string {
  return `
[out:json][timeout:20];
(
  way["railway"="rail"](${minLat},${minLon},${maxLat},${maxLon});
);
out body geom;
`.trim();
}

function toFeatureCollection(elements: any[]) {
  return {
    type: 'FeatureCollection',
    features: elements
      .filter((element) => element?.type === 'way' && Array.isArray(element.geometry) && element.geometry.length >= 2)
      .map((element) => ({
        type: 'Feature',
        id: element.id,
        geometry: {
          type: 'LineString',
          coordinates: element.geometry
            .map((coord: { lon: number; lat: number }) => [coord.lon, coord.lat])
            .filter((coord: [number, number]) => Number.isFinite(coord[0]) && Number.isFinite(coord[1])),
        },
        properties: {
          id: element.id,
          name: element.tags?.name ?? null,
          railway: element.tags?.railway ?? 'rail',
          service: element.tags?.service ?? null,
          usage: element.tags?.usage ?? null,
        },
      }))
      .filter((feature) => feature.geometry.coordinates.length >= 2),
  };
}

// Circuit breaker state (server-side, persists across page reloads)
let circuitOpenUntil = 0;
const CIRCUIT_BACKOFF_MS = 5 * 60_000; // 5 min after a 429/504

export function osmRailwaysProxyPlugin(): Plugin {
  const cache = new Map<string, { at: number; data: unknown }>();

  return {
    name: 'osm-railways-proxy',
    configureServer(server) {
      server.middlewares.use('/api/transport/osm-railways', async (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost');
        const bbox = parseBbox(url.searchParams.get('bbox'));

        if (!bbox) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Missing or invalid bbox' }));
          return;
        }

        const key = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
        const cached = cache.get(key);
        if (cached && Date.now() - cached.at < 10 * 60_000) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'public, max-age=600');
          res.end(JSON.stringify(cached.data));
          return;
        }

        // Circuit breaker: refuse immediately if Overpass recently rate-limited us
        if (Date.now() < circuitOpenUntil) {
          const waitSec = Math.ceil((circuitOpenUntil - Date.now()) / 1000);
          console.warn(`[osm-railways-proxy] circuit open — skipping Overpass for ${waitSec}s`);
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: `Overpass rate-limited, retry in ${waitSec}s` }));
          return;
        }

        try {
          const upstream = await fetch(OVERPASS_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
              'Accept': 'application/json',
            },
            body: `data=${encodeURIComponent(buildQuery(bbox))}`,
            signal: AbortSignal.timeout(20_000),
          });

          if (!upstream.ok) {
            const body = await upstream.text();
            console.error('[osm-railways-proxy] upstream error:', upstream.status, body);
            // Open circuit on rate-limit or server overload
            if (upstream.status === 429 || upstream.status === 504) {
              circuitOpenUntil = Date.now() + CIRCUIT_BACKOFF_MS;
              console.warn(`[osm-railways-proxy] circuit opened for 5min (status ${upstream.status})`);
            }
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `Overpass error ${upstream.status}` }));
            return;
          }

          const payload = await upstream.json();
          const geojson = toFeatureCollection(payload.elements ?? []);
          cache.set(key, { at: Date.now(), data: geojson });

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'public, max-age=600');
          res.end(JSON.stringify(geojson));
        } catch (error) {
          console.error('[osm-railways-proxy] fetch failed:', error);
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'OSM rail fetch failed' }));
        }
      });
    },
  };
}
