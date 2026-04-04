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
// Dataset Géorisques — export complet (8 554 turbines)
// Le WFS live est plafonné à 54 features côté serveur BRGM, sans possibilité de pagination
const GEORISQUES_LOCAL_PATH = 'public/data/eolien-france.geojson';

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
            const dataPath = resolve(process.cwd(), GEORISQUES_LOCAL_PATH);
            const geojson = JSON.parse(readFileSync(dataPath, 'utf8')) as { type: 'FeatureCollection'; features: unknown[] };

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
            alertThresholdGw: 3,
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
