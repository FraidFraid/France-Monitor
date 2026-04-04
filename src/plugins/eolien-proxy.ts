import type { Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LIVE_URL =
  'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/eco2mix-national-tr/records' +
  '?limit=1&select=date_heure,eolien,eolien_terrestre,eolien_offshore&where=eolien%20is%20not%20null&order_by=-date_heure';
// Puissance installée par région (année la plus récente disponible)
const INSTALLED_CAPACITY_URL =
  'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/parc-regional-annuel-prod-eolien-solaire/records' +
  '?limit=100&select=annee,parc_installe_eolien&order_by=-annee';
// Fallback officiel — France Renouvelables / SDES fin 2025
const FALLBACK_INSTALLED_GW = 26.1;
const OFFICIAL_ONSHORE_WFS_URL =
  'https://mapsrefrec.brgm.fr/wxs/georisques/georisques_services' +
  '?service=WFS&version=2.0.0&request=GetFeature&typeNames=ms:eolienne_wfs' +
  '&outputFormat=application/json;%20subtype=geojson;%20charset=utf-8&srsName=EPSG:4326';

function emptyGeoJSON(): { type: 'FeatureCollection'; features: unknown[] } {
  return { type: 'FeatureCollection', features: [] };
}

function loadOffshoreFallback(): { type: 'FeatureCollection'; features: unknown[] } {
  try {
    const fallbackPath = resolve(process.cwd(), 'public/data/eolien-fallback-parks.geojson');
    const payload = JSON.parse(readFileSync(fallbackPath, 'utf8')) as { features?: Array<{ properties?: Record<string, unknown> }> };
    return {
      type: 'FeatureCollection',
      features: Array.isArray(payload.features)
        ? payload.features.filter((feature) => feature?.properties?.kind === 'offshore')
        : [],
    };
  } catch {
    return emptyGeoJSON();
  }
}

function isUsableOnshorePayload(payload: { type?: string; features?: unknown[] }): payload is { type: 'FeatureCollection'; features: unknown[] } {
  return payload.type === 'FeatureCollection' && Array.isArray(payload.features) && payload.features.length > 1000;
}

async function fetchInstalledCapacityGw(): Promise<number> {
  try {
    const resp = await fetch(INSTALLED_CAPACITY_URL, { signal: AbortSignal.timeout(8_000) });
    if (!resp.ok) return FALLBACK_INSTALLED_GW;
    const json = await resp.json() as { results?: Array<{ annee?: number; parc_installe_eolien?: number | null }> };
    const results = json.results ?? [];
    if (results.length === 0) return FALLBACK_INSTALLED_GW;
    // Find max year and sum all regions for that year
    const maxYear = Math.max(...results.map((r) => r.annee ?? 0));
    const installedMw = results
      .filter((r) => r.annee === maxYear)
      .reduce((sum, r) => sum + (r.parc_installe_eolien ?? 0), 0);
    // ODRE regional dataset is onshore only; add 2 GW offshore (fin 2025)
    const totalGw = (installedMw / 1000) + 2.0;
    return totalGw > 10 ? Number(totalGw.toFixed(2)) : FALLBACK_INSTALLED_GW;
  } catch {
    return FALLBACK_INSTALLED_GW;
  }
}

export function eolienProxyPlugin(): Plugin {
  return {
    name: 'eolien-proxy',
    configureServer(server) {
      server.middlewares.use('/api/energy/eolien', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const wantsParks = url.searchParams.get('parks') === '1' || url.searchParams.get('parks') === 'true';

        try {
          if (wantsParks) {
            let geojson: { type: 'FeatureCollection'; features: unknown[] } = emptyGeoJSON();
            try {
              const upstream = await fetch(OFFICIAL_ONSHORE_WFS_URL, { signal: AbortSignal.timeout(20_000) });
              if (!upstream.ok) {
                throw new Error(`Official onshore WFS error ${upstream.status}`);
              }
              const onshore = await upstream.json() as { type?: string; features?: unknown[] };
              if (!isUsableOnshorePayload(onshore)) {
                throw new Error(`Official onshore WFS payload insuffisant (${Array.isArray(onshore.features) ? onshore.features.length : 0} features)`);
              }
              const offshore = loadOffshoreFallback();
              geojson = {
                type: 'FeatureCollection',
                features: [...onshore.features, ...offshore.features],
              };
            } catch (error) {
              console.warn('[eolien-proxy] Official WFS unavailable, fallback local dataset', error);
              const fallbackPath = resolve(process.cwd(), 'public/data/eolien-france.geojson');
              geojson = JSON.parse(readFileSync(fallbackPath, 'utf8')) as { type: 'FeatureCollection'; features: unknown[] };
            }

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store, max-age=0');
            res.end(JSON.stringify(geojson));
            return;
          }

          const upstream = await fetch(LIVE_URL, { signal: AbortSignal.timeout(10_000) });
          if (!upstream.ok) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `Upstream error: ${upstream.status}` }));
            return;
          }

          const json = await upstream.json() as { results?: Array<{ date_heure?: string; eolien?: number | null; eolien_terrestre?: number | null; eolien_offshore?: number | null }> };
          const record = json.results?.[0];
          if (!record || typeof record.eolien !== 'number' || !record.date_heure) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Payload éolien invalide' }));
            return;
          }

          const installedGw = await fetchInstalledCapacityGw();
          const terreMw = record.eolien_terrestre ?? null;
          const merMw = record.eolien_offshore ?? null;

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=300');
          res.end(JSON.stringify({
            production_gw: Number((record.eolien / 1000).toFixed(2)),
            installed_gw: installedGw,
            timestamp: record.date_heure,
            alertThresholdGw: 5,
            terre_mer_split: (terreMw != null && merMw != null)
              ? { terre: Number((terreMw / 1000).toFixed(2)), mer: Number((merMw / 1000).toFixed(2)) }
              : undefined,
            source: 'ODRE eco2mix-national-tr + parc-regional',
          }));
        } catch (err) {
          console.error('[eolien-proxy]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Fetch failed' }));
        }
      });
    },
  };
}
