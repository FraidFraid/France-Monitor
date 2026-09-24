import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getOrRefresh } from '../../_utils/swr-cache.js';

const LIVE_CACHE_KEY = 'swr:energy:eolien:live';
const LIVE_TTL_SEC = 5 * 60;
const LIVE_STALE_SEC = 30 * 60;
const PARKS_CACHE_KEY = 'swr:energy:eolien:parks';
const PARKS_TTL_SEC = 24 * 60 * 60;
const PARKS_STALE_SEC = 7 * 24 * 60 * 60;

const LIVE_URL =
  'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/eco2mix-national-tr/records' +
  '?limit=1&select=date_heure,eolien&where=eolien%20is%20not%20null&order_by=-date_heure';
const OFFICIAL_ONSHORE_WFS_URL =
  'https://mapsrefrec.brgm.fr/wxs/georisques/georisques_services' +
  '?service=WFS&version=2.0.0&request=GetFeature&typeNames=ms:eolienne_wfs' +
  '&outputFormat=application/json;%20subtype=geojson;%20charset=utf-8&srsName=EPSG:4326';

function emptyGeoJSON() {
  return { type: 'FeatureCollection', features: [] };
}

function isUsableOnshorePayload(payload) {
  return payload?.type === 'FeatureCollection' && Array.isArray(payload.features) && payload.features.length > 1000;
}

async function fetchLive(alertThresholdGw) {
  const response = await fetch(LIVE_URL, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  const record = json?.results?.[0];
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

async function fetchParks() {
  try {
    const response = await fetch(OFFICIAL_ONSHORE_WFS_URL, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const onshore = await response.json();
    if (!isUsableOnshorePayload(onshore)) {
      throw new Error(`Payload onshore WFS insuffisant (${Array.isArray(onshore?.features) ? onshore.features.length : 0} features)`);
    }

    const offshoreFallbackPath = resolve(process.cwd(), 'public/data/eolien-fallback-parks.geojson');
    const offshoreFallback = JSON.parse(readFileSync(offshoreFallbackPath, 'utf8'));
    const offshoreFeatures = Array.isArray(offshoreFallback?.features)
      ? offshoreFallback.features.filter((feature) => feature?.properties?.kind === 'offshore')
      : [];

    return {
      type: 'FeatureCollection',
      features: [...onshore.features, ...offshoreFeatures],
    };
  } catch {
    try {
      const fallbackPath = resolve(process.cwd(), 'public/data/eolien-france.geojson');
      return JSON.parse(readFileSync(fallbackPath, 'utf8'));
    } catch {
      return emptyGeoJSON();
    }
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const alertThresholdGw = 5;
  const wantsParks = req.query?.parks === '1' || req.query?.parks === 'true';
  const wantsStream = req.query?.stream === '1' || req.query?.stream === 'true';

  try {
    if (wantsParks) {
      const { value: geojson, cache } = await getOrRefresh(
        PARKS_CACHE_KEY,
        { ttlSec: PARKS_TTL_SEC, staleSec: PARKS_STALE_SEC, timeoutMs: 22_000 },
        fetchParks,
      );
      res.setHeader('Cache-Control', `public, s-maxage=${PARKS_TTL_SEC}, stale-while-revalidate=${PARKS_STALE_SEC}`);
      res.setHeader('X-Cache', cache);
      res.status(200).json(geojson);
      return;
    }

    if (wantsStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');

      let closed = false;
      const push = async () => {
        if (closed) return;
        const payload = await fetchLive(alertThresholdGw);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      await push();
      const timer = setInterval(() => {
        push().catch(() => {
          if (!closed) res.write(`event: error\ndata: {"error":"push_failed"}\n\n`);
        });
      }, 5 * 60_000);

      req.on?.('close', () => {
        closed = true;
        clearInterval(timer);
        res.end();
      });
      return;
    }

    const { value: payload, cache } = await getOrRefresh(
      LIVE_CACHE_KEY,
      { ttlSec: LIVE_TTL_SEC, staleSec: LIVE_STALE_SEC, timeoutMs: 8_000 },
      () => fetchLive(alertThresholdGw),
    );
    res.setHeader('Cache-Control', `public, s-maxage=${LIVE_TTL_SEC}, stale-while-revalidate=${LIVE_STALE_SEC}`);
    res.setHeader('X-Cache', cache);
    res.status(200).json(payload);
  } catch (error) {
    console.error('[api/energy/eolien]', error);
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ error: error instanceof Error ? error.message : 'Fetch failed' });
  }
}
