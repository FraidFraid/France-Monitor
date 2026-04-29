import assert from 'node:assert/strict';

import {
  getDromEnergySources,
  getDromEnergySourcesByFamily,
  getDromEnergySourcesByTerritory,
  getDromEnergyTerritories,
} from './sources.ts';

export function runDromEnergySourceTests(): void {
  const territories = getDromEnergyTerritories();
  assert.equal(territories.length, 5);
  assert.deepEqual(
    territories.map((territory) => territory.code),
    ['GP', 'MQ', 'GF', 'RE', 'YT'],
  );

  const sources = getDromEnergySources();
  assert.equal(sources.length, 11);
  assert.ok(sources.every((source) => source.territoryCodes.length > 0));

  const reunionPostesSources = sources.find((source) => source.id === 'postes_sources_reunion');
  assert.deepEqual(reunionPostesSources?.territoryCodes, ['RE']);
  assert.equal(
    reunionPostesSources?.url,
    'https://opendata.edf.fr/data-fair/api/v1/datasets/postes-sources-reunion/compat-ods/exports/geojson',
  );
  assert.equal(reunionPostesSources?.expectedFormat, 'geojson');
  assert.equal(reunionPostesSources?.family, 'grid_assets');
  assert.equal(reunionPostesSources?.geometry, 'point');
  assert.equal(reunionPostesSources?.source, 'EDF_SEI');
  assert.equal(reunionPostesSources?.localFallbackPath, 'public/data/drom-energy/raw/postes-sources-reunion.geojson');
  assert.equal(reunionPostesSources?.dataGouvResourceId, 'e29232fb-28c6-483e-9de0-3b00ccdd5034');
  assert.ok(reunionPostesSources?.urls?.includes('https://www.data.gouv.fr/api/1/datasets/r/e29232fb-28c6-483e-9de0-3b00ccdd5034'));
  assert.ok(reunionPostesSources?.urls?.includes('https://opendata-reunion.edf.fr/api/explore/v2.1/catalog/datasets/postes-sources-reunion/exports/geojson'));

  const reunionProductionSites = sources.find((source) => source.id === 'production_sites_reunion');
  assert.deepEqual(reunionProductionSites?.territoryCodes, ['RE']);
  assert.equal(reunionProductionSites?.family, 'production_registry');
  assert.equal(reunionProductionSites?.geometry, 'point');
  assert.equal(reunionProductionSites?.source, 'EDF_SEI');
  assert.equal(reunionProductionSites?.localFallbackPath, 'public/data/drom-energy/raw/production-sites-reunion.geojson');

  const guyaneSources = getDromEnergySourcesByTerritory('GF');
  assert.ok(guyaneSources.some((source) => source.id === 'postes_sources_guyane'));
  assert.ok(guyaneSources.every((source) => source.territoryCodes.includes('GF')));

  const gridAssetSources = getDromEnergySourcesByFamily('grid_assets');
  assert.deepEqual(
    gridAssetSources.map((source) => source.id),
    [
      'postes_sources_reunion',
      'postes_sources_guyane',
      'pylones_htb_martinique',
      'pylones_htb_reunion',
    ],
  );

  const clonedSources = getDromEnergySources();
  clonedSources[0]!.territoryCodes.push('GF');
  assert.equal(getDromEnergySources()[0]!.territoryCodes.includes('GF'), false);
}
