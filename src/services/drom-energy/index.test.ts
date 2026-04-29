import assert from 'node:assert/strict';

import { runDromEnergySourceTests } from './sources.test.ts';
import {
  buildReunionPostesSourcesDashboard,
  createEmptyDromEnergyDashboard,
  getDromTerritoryLabel,
  loadDromEnergyDashboard,
  normalizeReunionPostesSourcesFeature,
} from './index.ts';
import { getDromEnergySources } from './sources.ts';
import { buildDromEnergyTooltipContent } from './tooltip.ts';

export async function runDromEnergyTests(): Promise<void> {
  runDromEnergySourceTests();

  const empty = createEmptyDromEnergyDashboard();
  assert.equal(empty.assets.length, 0);
  assert.equal(empty.territories.length, 5);

  const normalized = normalizeReunionPostesSourcesFeature(
    {
      type: 'Feature',
      id: 'ps-saint-denis',
      geometry: {
        type: 'Point',
        coordinates: [55.4481, -20.8789],
      },
      properties: {
        nom: 'Poste source Saint-Denis',
        commune: 'Saint-Denis',
        code_insee: '97411',
        tension_kv: 63,
      },
    },
    'postes_sources_reunion',
    0,
  );

  assert.ok(normalized);
  assert.equal(normalized?.territoryCode, 'RE');
  assert.equal(normalized?.type, 'source_substation');
  assert.deepEqual(normalized?.coordinates, [55.4481, -20.8789]);
  assert.equal(normalized?.communeCode, '97411');
  assert.equal(normalized?.communeName, 'Saint-Denis');
  assert.equal(normalized?.voltageKv, 63);
  assert.equal(normalized?.sourceDatasetId, 'postes_sources_reunion');
  assert.equal(normalized?.rawProperties?.nom, 'Poste source Saint-Denis');
  assert.equal(getDromTerritoryLabel('RE'), 'La Réunion');

  const substationTooltip = buildDromEnergyTooltipContent({
    id: 'ps-saint-denis',
    territoryCode: 'RE',
    type: 'source_substation',
    name: 'Poste source Saint-Denis',
    sourceDatasetId: 'postes_sources_reunion',
    communeName: 'Saint-Denis',
    voltageKv: 63,
    operator: 'EDF SEI',
  });
  assert.equal(substationTooltip.title, 'Poste source Saint-Denis');
  assert.deepEqual(substationTooltip.rows, [
    { label: 'Territoire', value: 'La Réunion' },
    { label: 'Commune', value: 'Saint-Denis' },
    { label: 'Tension', value: '63 kV' },
    { label: 'Opérateur', value: 'EDF SEI' },
  ]);

  const partialTooltip = buildDromEnergyTooltipContent({
    id: 'ps-saint-paul',
    territoryCode: 'RE',
    type: 'source_substation',
    name: 'Poste source Saint-Paul',
    sourceDatasetId: 'postes_sources_reunion',
    communeName: 'Saint-Paul',
  });
  assert.deepEqual(partialTooltip.rows, [
    { label: 'Territoire', value: 'La Réunion' },
    { label: 'Commune', value: 'Saint-Paul' },
  ]);

  const datasetMeta = getDromEnergySources().find((source) => source.id === 'postes_sources_reunion');
  assert.ok(datasetMeta);
  assert.equal(datasetMeta?.localFallbackPath, 'public/data/drom-energy/raw/postes-sources-reunion.geojson');

  const dashboard = buildReunionPostesSourcesDashboard(
    {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [55.4481, -20.8789],
          },
          properties: {
            nom: 'Poste source Saint-Denis',
          },
        },
      ],
    },
    datasetMeta!,
    '2026-04-29T00:00:00.000Z',
  );

  assert.equal(dashboard.assets.length, 1);
  assert.equal(dashboard.assets[0]?.territoryCode, 'RE');
  assert.equal(dashboard.assets[0]?.type, 'source_substation');
  assert.equal(dashboard.datasets.length, 1);
  assert.equal(dashboard.datasets[0]?.id, 'postes_sources_reunion');
  assert.equal(dashboard.updatedAt, '2026-04-29T00:00:00.000Z');

  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const payloadByPath: Array<[string, unknown]> = [
      ['/territories.json', empty.territories],
      ['/sources.json', [{
        ...datasetMeta!,
        fetchedAt: '2026-04-29T00:00:00.000Z',
        ingestion: {
          status: 'success',
          testedAt: '2026-04-29T00:00:00.000Z',
          lastRun: '2026-04-29T00:00:00.000Z',
          source: 'local_fallback',
        },
      }]],
      ['/geo/substations.geojson', {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [55.4481, -20.8789] },
            properties: {
              id: 'ps-saint-denis',
              territoryCode: 'RE',
              type: 'source_substation',
              name: 'Poste source Saint-Denis',
              sourceDatasetId: 'postes_sources_reunion',
            },
          },
        ],
      }],
      ['/geo/pylons.geojson', { type: 'FeatureCollection', features: [] }],
      ['/geo/production-sites.geojson', { type: 'FeatureCollection', features: [] }],
      ['/tables/commune-consumption.json', []],
      ['/tables/co2-emissions.json', []],
      ['/tables/production-limitations.json', []],
      ['/tables/efficiency-actions.json', []],
    ];
    const match = payloadByPath.find(([path]) => url.endsWith(path));
    assert.ok(match, `Unexpected static fetch: ${url}`);
    return new Response(JSON.stringify(match[1]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const staticDashboard = await loadDromEnergyDashboard(fetchImpl);
  assert.equal(staticDashboard.assets.length, 1);
  assert.equal(staticDashboard.assets[0]?.territoryCode, 'RE');
  assert.equal(staticDashboard.assets[0]?.type, 'source_substation');
  assert.equal(staticDashboard.datasets.length, 1);
  assert.equal(staticDashboard.datasets[0]?.ingestion?.status, 'success');
  assert.equal(staticDashboard.datasets[0]?.ingestion?.source, 'local_fallback');
  assert.equal(staticDashboard.updatedAt, '2026-04-29T00:00:00.000Z');
}
