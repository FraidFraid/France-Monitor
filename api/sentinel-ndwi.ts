import { getOrRefresh } from './_utils/swr-cache.js';
import { asRateLimitRequest, checkRateLimit } from './_utils/rate-limit.js';
import { MIN_PASS_COVERAGE, groupPasses, passTimeRange } from './_lib/s2-passes.js';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

type NdwiPolygon = {
  type: 'Polygon';
  coordinates: number[][][];
};

type DateRangeInput = {
  from: string;
  to: string;
};

type NdwiRequestBody = {
  aoi?: NdwiPolygon;
  date?: string | DateRangeInput;
  maxCloudCoverage?: number;
};

type CdseTokenCache = {
  token: string;
  expiresAt: number;
};

type MinimalRequest = {
  method?: string;
  on(event: 'data', listener: (chunk: string | Buffer) => void): void;
  on(event: 'end', listener: () => void): void;
  on(event: 'error', listener: (error: unknown) => void): void;
};

type MinimalResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
};

type StacFeature = {
  id?: string;
  bbox?: number[];
  properties?: {
    datetime?: string;
    'eo:cloud_cover'?: number | string | null;
  };
};

const STAC_BASE = 'https://earth-search.aws.element84.com/v1/search';
const CDSE_PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';
const CDSE_TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
// Cache swr (mémoire + Redis) — 15 min de fraîcheur, pas de fenêtre stale : une image NDWI
// périmée n'a pas de sens à servir "en dégradé" au-delà de son TTL, contrairement aux flux
// temps réel. Le repli sur une valeur périmée reste possible si CDSE tombe en panne
// (voir getOrRefresh : une erreur du producer retombe sur la dernière valeur connue).
const NDWI_CACHE_TTL_SEC = 15 * 60;
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

// Le token OAuth CDSE reste en mémoire process (c'est un secret à courte durée de vie :
// il ne doit jamais transiter par Redis).
let cdseTokenCache: CdseTokenCache | null = null;

function explainNdwiError(error: unknown) {
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
  if (message === 'daily_budget_exhausted') {
    return 'Quota quotidien de rendus NDWI atteint. Utiliser le lien EO Browser en attendant demain.';
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

function buildCacheKey(aoi: NdwiPolygon, dateInput: string | DateRangeInput | undefined, maxCloudCoverage: number) {
  return JSON.stringify({
    aoi,
    date: dateInput,
    maxCloudCoverage,
  });
}

function json(res: MinimalResponse, status: number, payload: JsonValue) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

/** Corps maximal : une emprise de crue pèse quelques centaines d'octets. Au-delà, la lecture s'arrête (413). */
const MAX_BODY_BYTES = 32 * 1024;
/** Sommets et étendue maximale d'une emprise (degrés) : une crue tient dans une fraction de degré. */
const MAX_RING_POINTS = 200;
const MAX_AOI_SPAN_DEG = 3;
/** Rendus NDWI par adresse et par minute, et rendus nouveaux par jour pour tout le site (chacun coûte du quota CDSE). */
const NDWI_RATE_LIMIT_PER_MIN = 20;
const NDWI_DAILY_BUDGET = 400;
let budgetDay = '';
let budgetUsed = 0;

/** Réserve un rendu dans le budget du jour (UTC) ; faux quand il est épuisé. */
function reserveNdwiRender(now = new Date()): boolean {
  const day = now.toISOString().slice(0, 10);
  if (day !== budgetDay) { budgetDay = day; budgetUsed = 0; }
  if (budgetUsed >= NDWI_DAILY_BUDGET) return false;
  budgetUsed += 1;
  return true;
}

function readJsonBody(req: MinimalRequest): Promise<NdwiRequestBody> {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let tooLarge = false;
    req.on('data', (chunk: string | Buffer) => {
      if (tooLarge) return;
      bytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        tooLarge = true;
        body = '';
        reject(new Error('body_too_large'));
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        resolve((body ? JSON.parse(body) : {}) as NdwiRequestBody);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isDateRange(value: unknown): value is DateRangeInput {
  return !!value && typeof value === 'object'
    && isIsoDate((value as { from?: unknown }).from) && isIsoDate((value as { to?: unknown }).to);
}

function isPolygon(value: unknown): value is NdwiPolygon {
  return !!value
    && typeof value === 'object'
    && 'type' in value
    && value.type === 'Polygon'
    && 'coordinates' in value
    && Array.isArray(value.coordinates)
    && Array.isArray(value.coordinates[0])
    && value.coordinates[0].length >= 4
    && isBoundedRing(value.coordinates[0]);
}

/** Anneau fait de couples de nombres finis, en nombre et en étendue bornés. */
function isBoundedRing(ring: unknown[]): boolean {
  if (ring.length > MAX_RING_POINTS) return false;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const coord of ring) {
    if (!Array.isArray(coord) || coord.length < 2) return false;
    const lng = coord[0];
    const lat = coord[1];
    if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat)) return false;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return false;
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  return maxLng - minLng <= MAX_AOI_SPAN_DEG && maxLat - minLat <= MAX_AOI_SPAN_DEG;
}

/** Emprise arrondie à 4 décimales (une dizaine de mètres) : deux demandes quasi identiques partagent le même rendu en cache. */
function roundPolygon(polygon: NdwiPolygon): NdwiPolygon {
  const round = (n: number) => Math.round(n * 1e4) / 1e4;
  return {
    ...polygon,
    coordinates: polygon.coordinates.map((ring) => ring.map((c) => [round(Number(c[0])), round(Number(c[1]))])),
  } as NdwiPolygon;
}

function polygonToBbox(polygon: NdwiPolygon) {
  const ring = polygon.coordinates[0];
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const coord of ring) {
    const lng = Number(coord[0]);
    const lat = Number(coord[1]);
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }

  return [minLng, minLat, maxLng, maxLat];
}

function computeOutputSize(aoi: NdwiPolygon, maxDimension = 1280) {
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

function normalizeDateInput(input: string | DateRangeInput | undefined) {
  if (typeof input === 'string' && isIsoDate(input)) {
    const target = new Date(input);
    const from = new Date(target);
    const to = new Date(target);
    from.setDate(from.getDate() - 10);
    to.setDate(to.getDate() + 10);
    return {
      searchFrom: from.toISOString(),
      searchTo: to.toISOString(),
      targetTime: target.getTime(),
    };
  }

  if (input && typeof input === 'object' && isIsoDate(input.from) && isIsoDate(input.to)) {
    const from = new Date(input.from);
    const to = new Date(input.to);
    const targetTime = from.getTime() + ((to.getTime() - from.getTime()) / 2);
    return {
      searchFrom: from.toISOString(),
      searchTo: to.toISOString(),
      targetTime,
    };
  }

  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 10);
  return {
    searchFrom: from.toISOString(),
    searchTo: now.toISOString(),
    targetTime: now.getTime(),
  };
}

async function getCdseAccessToken() {
  // Preferred in production: inject a short-lived bearer as CDSE_ACCESS_TOKEN.
  // Fallback supported here: CDSE_CLIENT_ID + CDSE_CLIENT_SECRET for client-credentials OAuth.
  if (process.env.CDSE_ACCESS_TOKEN) {
    return process.env.CDSE_ACCESS_TOKEN;
  }

  if (cdseTokenCache && cdseTokenCache.expiresAt > Date.now()) {
    return cdseTokenCache.token;
  }

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
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`cdse_token_http_${response.status}`);
  }

  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload?.access_token) {
    throw new Error('missing_cdse_access_token');
  }

  const expiresInMs = Number(payload.expires_in ?? 3600) * 1000;
  cdseTokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(60_000, expiresInMs - 60_000),
  };

  return payload.access_token;
}

async function fetchClosestScene(aoi: NdwiPolygon, dateInput: string | DateRangeInput | undefined, maxCloudCoverage: number) {
  const { searchFrom, searchTo, targetTime } = normalizeDateInput(dateInput);

  const response = await fetch(STAC_BASE, {
    method: 'POST',
    headers: {
      Accept: 'application/geo+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      collections: ['sentinel-2-l2a'],
      intersects: aoi,
      datetime: `${searchFrom}/${searchTo}`,
      // Deux à quatre tuiles par passage : 24 pour garder une dizaine de passages.
      limit: 24,
    }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[api/sentinel-ndwi] STAC 400 payload', errorText.slice(0, 800));
    throw new Error(`stac_http_${response.status}`);
  }

  const payload = await response.json() as { features?: StacFeature[] };
  const features = Array.isArray(payload?.features) ? payload.features : [];

  // Passages (tuiles d'une même minute regroupées) couvrant au moins 90 % de la zone ; nébulosité de la zone, pas de la tuile
  // (20/10/2026 : un passage en bordure de fauchée donnait une image presque vide).
  const filtered = groupPasses(features, polygonToBbox(aoi) as [number, number, number, number])
    .filter((p) => p.coverage >= MIN_PASS_COVERAGE && (p.cloudCover === null || p.cloudCover <= maxCloudCoverage))
    .sort((left, right) => {
      const leftDistance = Math.abs((Date.parse(left.datetime) || 0) - targetTime);
      const rightDistance = Math.abs((Date.parse(right.datetime) || 0) - targetTime);
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      return (left.cloudCover ?? 1000) - (right.cloudCover ?? 1000);
    });

  if (filtered.length === 0) {
    throw new Error('stac_empty');
  }

  const scene = filtered[0];
  return {
    id: scene.id || 'unknown-scene',
    datetime: scene.datetime || new Date().toISOString(),
    cloudCover: scene.cloudCover,
    bbox: polygonToBbox(aoi),
  };
}

async function fetchNdwiImage(aoi: NdwiPolygon, acquisitionDate: string, maxCloudCoverage: number, accessToken: string) {
  // Le seul passage choisi (± 20 min), toutes ses tuiles : jamais « le plus récent sur ± 2 jours », qui pouvait prendre une
  // bordure de fauchée d'une autre orbite. Nébulosité déjà contrôlée sur la zone au choix du passage.
  void maxCloudCoverage;
  const dayRange = passTimeRange(acquisitionDate);
  const outputSize = computeOutputSize(aoi);
  const payload = {
    input: {
      bounds: {
        geometry: aoi,
        properties: {
          crs: 'http://www.opengis.net/def/crs/EPSG/0/4326',
        },
      },
      data: [
        {
          type: 'sentinel-2-l2a',
          dataFilter: {
            timeRange: dayRange,
            maxCloudCoverage: 100,
          },
        },
      ],
    },
    output: {
      width: outputSize.width,
      height: outputSize.height,
      responses: [
        {
          identifier: 'default',
          format: {
            type: 'image/png',
          },
        },
      ],
    },
    evalscript: NDWI_EVALSCRIPT,
  };

  const response = await fetch(CDSE_PROCESS_URL, {
    method: 'POST',
    headers: {
      Accept: 'image/png',
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('[api/sentinel-ndwi] CDSE Process API error', response.status, text);
    throw new Error(`process_http_${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer).toString('base64');
}

export default async function handler(req: MinimalRequest, res: MinimalResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const rl = await checkRateLimit('sentinel-ndwi', asRateLimitRequest(req as { headers?: Record<string, string | string[] | undefined> }), NDWI_RATE_LIMIT_PER_MIN);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfter || 60));
    json(res, 429, { error: 'Too Many Requests' });
    return;
  }

  let body: NdwiRequestBody;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'body_too_large';
    json(res, tooLarge ? 413 : 400, { error: tooLarge ? 'Corps trop volumineux' : 'Invalid JSON body' });
    return;
  }

  try {
    const rawAoi = body.aoi;
    const date = isIsoDate(body.date) || isDateRange(body.date) ? body.date : undefined;
    const maxCloudCoverage = Number.isFinite(body.maxCloudCoverage)
      ? Math.max(0, Math.min(100, Number(body.maxCloudCoverage)))
      : 30;

    if (!isPolygon(rawAoi)) {
      json(res, 400, { error: 'Invalid AOI polygon' });
      return;
    }
    const aoi = roundPolygon(rawAoi);

    // v2 (20/10/2026) : choix par passage ; les images du choix par tuile ne sont plus servies.
    const cacheKey = `swr:sentinel-ndwi:v2:${buildCacheKey(aoi, date, maxCloudCoverage)}`;
    const { value: payload } = (await getOrRefresh(
      cacheKey,
      { ttlSec: NDWI_CACHE_TTL_SEC },
      async () => {
        if (!reserveNdwiRender()) throw new Error('daily_budget_exhausted');
        const scene = await fetchClosestScene(aoi, date, maxCloudCoverage);
        const accessToken = await getCdseAccessToken();
        const base64Png = await fetchNdwiImage(aoi, scene.datetime, maxCloudCoverage, accessToken);
        return {
          sceneId: scene.id,
          acquisitionDate: scene.datetime,
          cloudCoverage: scene.cloudCover,
          imageUrl: `data:image/png;base64,${base64Png}`,
        };
      },
    )) as { value: JsonValue };
    json(res, 200, payload);
  } catch (error) {
    const detail = explainNdwiError(error);
    console.error('[api/sentinel-ndwi]', detail, error);
    json(res, 502, { error: detail });
  }
}
