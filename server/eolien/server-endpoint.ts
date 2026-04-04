import type { EolienParcsGeoJSON, EolienLiveApiResponse } from '../../src/services/eolien/types.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_LIVE_URL =
  'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/eco2mix-national-tr/records' +
  '?limit=1&select=date_heure,eolien&where=eolien%20is%20not%20null&order_by=-date_heure';
const DEFAULT_OFFICIAL_ONSHORE_WFS_URL =
  'https://mapsrefrec.brgm.fr/wxs/georisques/georisques_services' +
  '?service=WFS&version=2.0.0&request=GetFeature&typeNames=ms:eolienne_wfs' +
  '&outputFormat=application/json;%20subtype=geojson;%20charset=utf-8&srsName=EPSG:4326';

type QueryValue = string | string[] | undefined;

export interface EolienRequestLike {
  method?: string;
  query?: Record<string, QueryValue>;
  url?: string;
  on?: (event: 'close', handler: () => void) => void;
}

export interface EolienResponseLike {
  setHeader(name: string, value: string): void;
  status(code: number): EolienResponseLike;
  json(payload: unknown): void;
  end(payload?: string): void;
  write?(chunk: string): void;
}

export interface EolienEndpointOptions {
  fetchImpl?: typeof fetch;
  liveUrl?: string;
  parksUrl?: string | null;
  officialOnshoreWfsUrl?: string;
  alertThresholdGw?: number;
  streamIntervalMs?: number;
}

function queryFlag(value: QueryValue): boolean {
  if (Array.isArray(value)) return value.includes('1') || value.includes('true');
  return value === '1' || value === 'true';
}

function emptyGeoJSON(): EolienParcsGeoJSON {
  return { type: 'FeatureCollection', features: [] };
}

function isUsableOnshorePayload(payload: EolienParcsGeoJSON): boolean {
  return payload.type === 'FeatureCollection' && Array.isArray(payload.features) && payload.features.length > 1000;
}

async function fetchLivePayload(
  fetchImpl: typeof fetch,
  liveUrl: string,
  alertThresholdGw: number,
): Promise<EolienLiveApiResponse> {
  const response = await fetchImpl(liveUrl, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json() as { results?: Array<{ date_heure?: string; eolien?: number | null }> };
  const record = json.results?.[0];
  if (!record || typeof record.eolien !== 'number' || !record.date_heure) {
    throw new Error('ODRE eco2mix éolien: payload invalide');
  }

  return {
    production_gw: Number((record.eolien / 1000).toFixed(2)),
    timestamp: record.date_heure,
    alertThresholdGw,
    source: 'ODRE eco2mix-national-tr',
  };
}

async function fetchParksPayload(
  fetchImpl: typeof fetch,
  parksUrl: string | null,
  officialOnshoreWfsUrl: string,
): Promise<EolienParcsGeoJSON> {
  try {
    const response = await fetchImpl(parksUrl ?? officialOnshoreWfsUrl, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const onshore = await response.json() as EolienParcsGeoJSON;
    if (!isUsableOnshorePayload(onshore)) {
      throw new Error(`Payload onshore WFS insuffisant (${Array.isArray(onshore.features) ? onshore.features.length : 0} features)`);
    }

    const offshoreFallbackPath = resolve(process.cwd(), 'public/data/eolien-fallback-parks.geojson');
    const offshoreFallback = JSON.parse(readFileSync(offshoreFallbackPath, 'utf8')) as EolienParcsGeoJSON;
    const offshoreFeatures = offshoreFallback.features.filter((feature) => feature.properties?.kind === 'offshore');

    return {
      type: 'FeatureCollection',
      features: [...onshore.features, ...offshoreFeatures],
    };
  } catch {
    try {
      const fallbackPath = resolve(process.cwd(), 'public/data/eolien-france.geojson');
      return JSON.parse(readFileSync(fallbackPath, 'utf8')) as EolienParcsGeoJSON;
    } catch {
      return emptyGeoJSON();
    }
  }
}

export function createEolienEndpoint(options: EolienEndpointOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const liveUrl = options.liveUrl ?? DEFAULT_LIVE_URL;
  const parksUrl = options.parksUrl ?? null;
  const officialOnshoreWfsUrl = options.officialOnshoreWfsUrl ?? DEFAULT_OFFICIAL_ONSHORE_WFS_URL;
  const alertThresholdGw = options.alertThresholdGw ?? 5;
  const streamIntervalMs = options.streamIntervalMs ?? 5 * 60_000;

  return async function handleEolienRequest(req: EolienRequestLike, res: EolienResponseLike): Promise<void> {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');

    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    try {
      const wantsParks = queryFlag(req.query?.['parks']);
      const wantsStream = queryFlag(req.query?.['stream']);

      if (wantsParks) {
        const geojson = await fetchParksPayload(fetchImpl, parksUrl, officialOnshoreWfsUrl);
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        res.status(200).json(geojson);
        return;
      }

      if (wantsStream && res.write) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');

        let closed = false;
        const push = async (): Promise<void> => {
          if (closed || !res.write) return;
          const payload = await fetchLivePayload(fetchImpl, liveUrl, alertThresholdGw);
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        };

        await push();
        const timer = setInterval(() => {
          push().catch(() => {
            if (!closed) res.write?.(`event: error\ndata: {"error":"push_failed"}\n\n`);
          });
        }, streamIntervalMs);

        req.on?.('close', () => {
          closed = true;
          clearInterval(timer);
          res.end();
        });
        return;
      }

      const payload = await fetchLivePayload(fetchImpl, liveUrl, alertThresholdGw);
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
      res.status(200).json(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fetch failed';
      res.status(500).json({ error: message });
    }
  };
}
