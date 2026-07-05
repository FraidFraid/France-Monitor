import type { Plugin } from 'vite';
import type { Polygon } from 'geojson';
import type { IncomingMessage } from 'node:http';

const STAC_BASE = 'https://earth-search.aws.element84.com/v1/search';
const CDSE_PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';
const CDSE_TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const NDWI_CACHE_TTL_MS = 15 * 60 * 1000;
const NDWI_EVALSCRIPT = `//VERSION=3
const ramp = [
  [-0.8, 0x008000],
  [0, 0xFFFFFF],
  [0.8, 0x0000CC]
];
let viz = new ColorRampVisualizer(ramp);

function setup() {
  return {
    input: ["B03", "B08", "dataMask"],
    output: { id: "default", bands: 4 }
  };
}
function evaluatePixel(sample) {
  let val = index(sample.B03, sample.B08);
  if (!isFinite(val)) val = 0;
  return [...viz.process(val), sample.dataMask];
}`;

const ndwiResponseCache = new Map<string, { expiresAt: number; value: { sceneId: string; acquisitionDate: string; cloudCoverage: number | null; imageUrl: string } }>();
let cdseTokenCache: { token: string; expiresAt: number } | null = null;

function explainNdwiError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? 'unknown_error');
  if (message === 'missing_cdse_credentials') {
    return 'CDSE credentials manquants: definir CDSE_ACCESS_TOKEN ou CDSE_CLIENT_ID/CDSE_CLIENT_SECRET';
  }
  if (message === 'missing_cdse_access_token') {
    return 'CDSE token introuvable dans la reponse OAuth';
  }
  if (message.startsWith('cdse_token_http_')) {
    return `Echec auth CDSE (${message.replace('cdse_token_http_', 'HTTP ')})`;
  }
  if (message.startsWith('stac_http_')) {
    return `Echec STAC (${message.replace('stac_http_', 'HTTP ')})`;
  }
  if (message === 'stac_empty') {
    return 'Aucune scene Sentinel-2 exploitable pour cette AOI / cette fenetre temporelle';
  }
  if (message.startsWith('process_http_')) {
    if (message === 'process_http_401') {
      return 'Token CDSE expire ou invalide. Utiliser le lien EO Browser en fallback.';
    }
    return `Echec Processing API CDSE (${message.replace('process_http_', 'HTTP ')})`;
  }
  return `NDWI indisponible pour cette crue (${message})`;
}

function buildCacheKey(aoi: Polygon, dateInput: unknown, maxCloudCoverage: number): string {
  return JSON.stringify({
    aoi,
    date: dateInput,
    maxCloudCoverage,
  });
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function isPolygon(value: unknown): value is Polygon {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { type?: unknown; coordinates?: unknown };
  return candidate.type === 'Polygon'
    && Array.isArray(candidate.coordinates)
    && Array.isArray(candidate.coordinates[0])
    && candidate.coordinates[0].length >= 4;
}

function normalizeDateInput(input: unknown): { searchFrom: string; searchTo: string; targetTime: number } {
  if (typeof input === 'string' && !Number.isNaN(Date.parse(input))) {
    const target = new Date(input);
    const from = new Date(target);
    const to = new Date(target);
    from.setDate(from.getDate() - 10);
    to.setDate(to.getDate() + 10);
    return { searchFrom: from.toISOString(), searchTo: to.toISOString(), targetTime: target.getTime() };
  }

  if (input && typeof input === 'object') {
    const candidate = input as { from?: string; to?: string };
    if (!Number.isNaN(Date.parse(candidate.from ?? '')) && !Number.isNaN(Date.parse(candidate.to ?? ''))) {
      const from = new Date(candidate.from as string);
      const to = new Date(candidate.to as string);
      return {
        searchFrom: from.toISOString(),
        searchTo: to.toISOString(),
        targetTime: from.getTime() + ((to.getTime() - from.getTime()) / 2),
      };
    }
  }

  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 10);
  return { searchFrom: from.toISOString(), searchTo: now.toISOString(), targetTime: now.getTime() };
}

function toProcessingRange(dateString: string, paddingDays = 2): { from: string; to: string } {
  const center = new Date(dateString);
  const from = new Date(center);
  const to = new Date(center);
  from.setDate(from.getDate() - paddingDays);
  to.setDate(to.getDate() + paddingDays);
  return {
    from: `${from.toISOString().split('T')[0]}T00:00:00Z`,
    to: `${to.toISOString().split('T')[0]}T23:59:59Z`,
  };
}

function polygonToBbox(polygon: Polygon): [number, number, number, number] {
  const ring = polygon.coordinates[0];
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLng, minLat, maxLng, maxLat];
}

function computeOutputSize(aoi: Polygon, maxDimension = 1280): { width: number; height: number } {
  const [minLng, minLat, maxLng, maxLat] = polygonToBbox(aoi);
  const widthDeg = Math.max(0.0001, maxLng - minLng);
  const heightDeg = Math.max(0.0001, maxLat - minLat);
  const ratio = widthDeg / heightDeg;

  if (ratio >= 1) {
    return {
      width: maxDimension,
      height: Math.max(512, Math.round(maxDimension / ratio)),
    };
  }

  return {
    width: Math.max(512, Math.round(maxDimension * ratio)),
    height: maxDimension,
  };
}

async function getCdseAccessToken(): Promise<string> {
  if (process.env.CDSE_ACCESS_TOKEN) return process.env.CDSE_ACCESS_TOKEN;
  if (cdseTokenCache && cdseTokenCache.expiresAt > Date.now()) return cdseTokenCache.token;
  if (!process.env.CDSE_CLIENT_ID || !process.env.CDSE_CLIENT_SECRET) {
    throw new Error('missing_cdse_credentials');
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.CDSE_CLIENT_ID,
    client_secret: process.env.CDSE_CLIENT_SECRET,
  });

  const response = await fetch(CDSE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`cdse_token_http_${response.status}`);
  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error('missing_cdse_access_token');
  const expiresInMs = Number(payload.expires_in ?? 3600) * 1000;
  cdseTokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(60_000, expiresInMs - 60_000),
  };
  return payload.access_token;
}

export function sentinelNdwiProxyPlugin(): Plugin {
  return {
    name: 'sentinel-ndwi-proxy',
    configureServer(server) {
      server.middlewares.use('/api/sentinel-ndwi', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        try {
          const body = await readJsonBody(req) as { aoi?: unknown; date?: unknown; maxCloudCoverage?: number };
          if (!isPolygon(body.aoi)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'Invalid AOI polygon' }));
            return;
          }

          const maxCloudCoverage = Number.isFinite(body.maxCloudCoverage)
            ? Math.max(0, Math.min(100, Number(body.maxCloudCoverage)))
            : 30;
          const cacheKey = buildCacheKey(body.aoi, body.date, maxCloudCoverage);
          const cached = ndwiResponseCache.get(cacheKey);
          if (cached && cached.expiresAt > Date.now()) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(cached.value));
            return;
          }
          const { searchFrom, searchTo, targetTime } = normalizeDateInput(body.date);

          const stacResponse = await fetch(STAC_BASE, {
            method: 'POST',
            headers: {
              Accept: 'application/geo+json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              collections: ['sentinel-2-l2a'],
              intersects: body.aoi,
              datetime: `${searchFrom}/${searchTo}`,
              limit: 12,
            }),
            signal: AbortSignal.timeout(12_000),
          });

          if (!stacResponse.ok) {
            const errorText = await stacResponse.text();
            console.error('[sentinel-ndwi-proxy] STAC upstream body', errorText.slice(0, 800));
            throw new Error(`stac_http_${stacResponse.status}`);
          }

          const stacPayload = await stacResponse.json() as { features?: Array<Record<string, unknown>> };
          const scene = (Array.isArray(stacPayload.features) ? stacPayload.features : [])
            .filter((feature) => {
              const cloudCover = feature?.properties && typeof feature.properties === 'object'
                ? (feature.properties as Record<string, unknown>)['eo:cloud_cover']
                : null;
              return cloudCover == null || Number(cloudCover) <= maxCloudCoverage;
            })
            .sort((left, right) => {
              const leftProps = (left.properties ?? {}) as Record<string, unknown>;
              const rightProps = (right.properties ?? {}) as Record<string, unknown>;
              const leftTime = Date.parse(String(leftProps.datetime ?? '')) || 0;
              const rightTime = Date.parse(String(rightProps.datetime ?? '')) || 0;
              const leftDistance = Math.abs(leftTime - targetTime);
              const rightDistance = Math.abs(rightTime - targetTime);
              if (leftDistance !== rightDistance) return leftDistance - rightDistance;
              return Number(leftProps['eo:cloud_cover'] ?? 1000) - Number(rightProps['eo:cloud_cover'] ?? 1000);
            })[0];

          if (!scene) {
            throw new Error('stac_empty');
          }

          const sceneProps = (scene.properties ?? {}) as Record<string, unknown>;
          const sceneDate = String(sceneProps.datetime ?? new Date().toISOString());
          const accessToken = await getCdseAccessToken();
          const outputSize = computeOutputSize(body.aoi);
          const processResponse = await fetch(CDSE_PROCESS_URL, {
            method: 'POST',
            headers: {
              Accept: 'image/png',
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              input: {
                bounds: {
                  geometry: body.aoi,
                  properties: {
                    crs: 'http://www.opengis.net/def/crs/EPSG/0/4326',
                  },
                },
                data: [
                  {
                    type: 'sentinel-2-l2a',
                    dataFilter: {
                      timeRange: toProcessingRange(sceneDate, 2),
                      maxCloudCoverage,
                    },
                  },
                ],
              },
              output: {
                width: outputSize.width,
                height: outputSize.height,
                responses: [{ identifier: 'default', format: { type: 'image/png' } }],
              },
              evalscript: NDWI_EVALSCRIPT,
            }),
            signal: AbortSignal.timeout(20_000),
          });

          if (!processResponse.ok) {
            const text = await processResponse.text();
            console.error('[sentinel-ndwi-proxy] CDSE Process API error', processResponse.status, text);
            throw new Error(`process_http_${processResponse.status}`);
          }

          const base64Png = Buffer.from(await processResponse.arrayBuffer()).toString('base64');
          const payload = {
            sceneId: String(scene.id ?? 'unknown-scene'),
            acquisitionDate: sceneDate,
            cloudCoverage: sceneProps['eo:cloud_cover'] != null ? Number(sceneProps['eo:cloud_cover']) : null,
            imageUrl: `data:image/png;base64,${base64Png}`,
          };
          ndwiResponseCache.set(cacheKey, {
            expiresAt: Date.now() + NDWI_CACHE_TTL_MS,
            value: payload,
          });
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(payload));
        } catch (error) {
          const detail = explainNdwiError(error);
          console.error('[sentinel-ndwi-proxy]', detail, error);
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: detail }));
        }
      });
    },
  };
}
