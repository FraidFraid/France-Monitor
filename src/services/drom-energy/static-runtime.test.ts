import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDromEnergyDashboardFromStaticPayloads, isDemoDataset } from './static-runtime.js';

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(`../../../public/data/drom-energy/${path}`, import.meta.url), 'utf8'));
const meta = (id: string, source: string) => ({ id, label: id, family: 'grid_assets', geometry: 'point', source: 'EDF_SEI', territoryCodes: ['RE'],
  fetchedAt: '2026-04-29T16:38:45.329Z', ingestion: { status: 'success', testedAt: '2026-04-29T16:38:45.329Z', source } });
const point = (id: string, datasetId: string) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [55.4, -20.9] },
  properties: { id, territoryCode: 'RE', type: 'source_substation', name: `Poste ${id}`, sourceDatasetId: datasetId } });
const payloads = (source: string) => ({
  territories: [], sources: [meta('postes_sources_reunion', source)],
  substations: { type: 'FeatureCollection', features: [point('a', 'postes_sources_reunion')] },
  pylons: { type: 'FeatureCollection', features: [] }, productionSites: { type: 'FeatureCollection', features: [] },
  reunionHtaLines: { type: 'FeatureCollection', features: [] },
  communeConsumption: [], co2Emissions: [], productionLimitations: [], efficiencyActions: [],
});

describe('données de démonstration DROM', () => {
  it('un jeu en repli local forcé est de démonstration', () => {
    expect(isDemoDataset({ ingestion: { source: 'local_fallback_forced' } })).toBe(true);
    expect(isDemoDataset({ ingestion: { source: 'local_fallback' } })).toBe(false);
    expect(isDemoDataset({ ingestion: { source: 'remote' } })).toBe(false);
    expect(isDemoDataset({})).toBe(false);
  });
  it('ses actifs ne sont jamais servis (carte et panneau) ; ceux d’un vrai jeu le sont', () => {
    expect(buildDromEnergyDashboardFromStaticPayloads(payloads('local_fallback_forced'), { requireFetchedAt: true }).assets).toEqual([]);
    expect(buildDromEnergyDashboardFromStaticPayloads(payloads('remote'), { requireFetchedAt: true }).assets).toHaveLength(1);
  });
  it('fichiers du dépôt : aucun enregistrement « Test » servi', () => {
    const d = buildDromEnergyDashboardFromStaticPayloads({
      territories: read('territories.json'), sources: read('sources.json'),
      substations: read('geo/substations.geojson'), pylons: read('geo/pylons.geojson'), productionSites: read('geo/production-sites.geojson'),
      reunionHtaLines: read('geo/lines-hta-reunion.geojson'), communeConsumption: [], co2Emissions: [], productionLimitations: [], efficiencyActions: [],
    }, { requireFetchedAt: true }) as { assets: Array<{ name: string }>; communeMetrics: unknown[]; gridLines: { reunionHta: { features: unknown[] } } };
    expect(d.assets.filter((a) => /\bTest\b/i.test(a.name))).toEqual([]);
    expect(d.gridLines.reunionHta.features).toEqual([]);
  });
});
