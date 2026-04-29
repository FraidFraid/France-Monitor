import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

import {
  DROM_ENERGY_STATIC_FILES,
  buildDromEnergyDashboardFromStaticPayloads,
  emptyFeatureCollection,
} from '../services/drom-energy/static-runtime.js';

const DATA_DIR = resolve(process.cwd(), 'public/data/drom-energy');

async function readJson<T>(relativePath: string, fallback: T): Promise<T> {
  const filePath = resolve(DATA_DIR, relativePath);
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[drom-energy-proxy] Static file unavailable (${filePath}): ${message}`);
    return fallback;
  }
}

async function loadDashboard() {
  const files = DROM_ENERGY_STATIC_FILES;
  const [
    territories,
    sources,
    substations,
    pylons,
    productionSites,
    communeConsumption,
    co2Emissions,
    productionLimitations,
    efficiencyActions,
  ] = await Promise.all([
    readJson(files.territories, []),
    readJson(files.sources, []),
    readJson(files.geo.substations, emptyFeatureCollection()),
    readJson(files.geo.pylons, emptyFeatureCollection()),
    readJson(files.geo.productionSites, emptyFeatureCollection()),
    readJson(files.tables.communeConsumption, []),
    readJson(files.tables.co2Emissions, []),
    readJson(files.tables.productionLimitations, []),
    readJson(files.tables.efficiencyActions, []),
  ]);

  return buildDromEnergyDashboardFromStaticPayloads({
    territories,
    sources,
    substations,
    pylons,
    productionSites,
    communeConsumption,
    co2Emissions,
    productionLimitations,
    efficiencyActions,
  }, { requireFetchedAt: true });
}

export function dromEnergyProxyPlugin(): Plugin {
  return {
    name: 'drom-energy-proxy',
    configureServer(server) {
      server.middlewares.use('/api/energy/drom', async (_req, res) => {
        try {
          const dashboard = await loadDashboard();
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=300');
          res.end(JSON.stringify(dashboard));
        } catch (error) {
          console.error('[drom-energy-proxy]', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'drom_energy_proxy_failed' }));
        }
      });
    },
  };
}
