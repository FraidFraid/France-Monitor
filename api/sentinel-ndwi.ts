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

type NdwiCacheEntry = {
  expiresAt: number;
  value: JsonValue;
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

const ndwiResponseCache = new Map<string, NdwiCacheEntry>();
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

function readJsonBody(req: MinimalRequest): Promise<NdwiRequestBody> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string | Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
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

function isPolygon(value: unknown): value is NdwiPolygon {
  return !!value
    && typeof value === 'object'
    && 'type' in value
    && value.type === 'Polygon'
    && 'coordinates' in value
    && Array.isArray(value.coordinates)
    && Array.isArray(value.coordinates[0])
    && value.coordinates[0].length >= 4;
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

function toProcessingRange(dateString: string, paddingDays = 2) {
  const value = new Date(dateString);
  const from = new Date(value);
  const to = new Date(value);
  from.setDate(from.getDate() - paddingDays);
  to.setDate(to.getDate() + paddingDays);
  const fromDay = from.toISOString().split('T')[0];
  const toDay = to.toISOString().split('T')[0];
  return {
    from: `${fromDay}T00:00:00Z`,
    to: `${toDay}T23:59:59Z`,
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
      limit: 12,
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

  const filtered = features
    .filter((feature: StacFeature) => {
      const cloudCover = feature?.properties?.['eo:cloud_cover'];
      return cloudCover == null || Number(cloudCover) <= maxCloudCoverage;
    })
    .sort((left: StacFeature, right: StacFeature) => {
      const leftTime = Date.parse(left?.properties?.datetime ?? '') || 0;
      const rightTime = Date.parse(right?.properties?.datetime ?? '') || 0;
      const leftDistance = Math.abs(leftTime - targetTime);
      const rightDistance = Math.abs(rightTime - targetTime);
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      const leftCloud = Number(left?.properties?.['eo:cloud_cover'] ?? 1000);
      const rightCloud = Number(right?.properties?.['eo:cloud_cover'] ?? 1000);
      return leftCloud - rightCloud;
    });

  if (filtered.length === 0) {
    throw new Error('stac_empty');
  }

  const scene = filtered[0];
  return {
    id: String(scene.id ?? 'unknown-scene'),
    datetime: String(scene?.properties?.datetime ?? new Date().toISOString()),
    cloudCover: scene?.properties?.['eo:cloud_cover'] != null ? Number(scene.properties['eo:cloud_cover']) : null,
    bbox: Array.isArray(scene?.bbox) ? scene.bbox : polygonToBbox(aoi),
  };
}

async function fetchNdwiImage(aoi: NdwiPolygon, acquisitionDate: string, maxCloudCoverage: number, accessToken: string) {
  const dayRange = toProcessingRange(acquisitionDate, 2);
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
            maxCloudCoverage,
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

  try {
    const body: NdwiRequestBody = await readJsonBody(req);
    const aoi = body.aoi;
    const date = body.date;
    const maxCloudCoverage = Number.isFinite(body.maxCloudCoverage)
      ? Math.max(0, Math.min(100, Number(body.maxCloudCoverage)))
      : 30;

    if (!isPolygon(aoi)) {
      json(res, 400, { error: 'Invalid AOI polygon' });
      return;
    }

    const cacheKey = buildCacheKey(aoi, date, maxCloudCoverage);
    const cached = ndwiResponseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      json(res, 200, cached.value);
      return;
    }

    const scene = await fetchClosestScene(aoi, date, maxCloudCoverage);
    const accessToken = await getCdseAccessToken();
    const base64Png = await fetchNdwiImage(aoi, scene.datetime, maxCloudCoverage, accessToken);
    const payload = {
      sceneId: scene.id,
      acquisitionDate: scene.datetime,
      cloudCoverage: scene.cloudCover,
      imageUrl: `data:image/png;base64,${base64Png}`,
    };
    ndwiResponseCache.set(cacheKey, {
      expiresAt: Date.now() + NDWI_CACHE_TTL_MS,
      value: payload,
    });
    json(res, 200, payload);
  } catch (error) {
    const detail = explainNdwiError(error);
    console.error('[api/sentinel-ndwi]', detail, error);
    json(res, 502, { error: detail });
  }
}
