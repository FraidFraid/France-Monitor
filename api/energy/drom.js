import { readFile } from 'fs/promises';
import { resolve } from 'path';

import {
  DROM_ENERGY_STATIC_FILES,
  buildDromEnergyDashboardFromStaticPayloads,
  emptyFeatureCollection,
} from '../../src/services/drom-energy/static-runtime.js';

const DATA_DIR = resolve(process.cwd(), 'public/data/drom-energy');

async function readJson(relativePath, fallback) {
  const filePath = resolve(DATA_DIR, relativePath);
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[api/energy/drom] Static file unavailable (${filePath}):`, message);
    return fallback;
  }
}

async function loadDashboardFromStaticFiles() {
  const files = DROM_ENERGY_STATIC_FILES;
  const [
    territories,
    sources,
    substations,
    pylons,
    productionSites,
    reunionHtaLines,
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
    readJson(files.geo.reunionHtaLines, emptyFeatureCollection()),
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
    reunionHtaLines,
    communeConsumption,
    co2Emissions,
    productionLimitations,
    efficiencyActions,
  }, { requireFetchedAt: true });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const dashboard = await loadDashboardFromStaticFiles();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    res.status(200).json(dashboard);
  } catch (error) {
    console.error('[api/energy/drom] Unexpected error:', error);
    res.status(500).json({ error: 'drom_energy_internal_error' });
  }
}
