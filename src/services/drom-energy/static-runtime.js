export const DROM_ENERGY_DATA_BASE_PATH = '/data/drom-energy';

export const DROM_ENERGY_STATIC_FILES = {
  territories: 'territories.json',
  sources: 'sources.json',
  geo: {
    substations: 'geo/substations.geojson',
    pylons: 'geo/pylons.geojson',
    productionSites: 'geo/production-sites.geojson',
  },
  tables: {
    communeConsumption: 'tables/commune-consumption.json',
    co2Emissions: 'tables/co2-emissions.json',
    productionLimitations: 'tables/production-limitations.json',
    efficiencyActions: 'tables/efficiency-actions.json',
  },
};

export const DROM_TERRITORY_CODES = ['GP', 'MQ', 'GF', 'RE', 'YT'];

export function isDromTerritoryCode(value) {
  return DROM_TERRITORY_CODES.includes(value);
}

export function emptyFeatureCollection() {
  return {
    type: 'FeatureCollection',
    features: [],
  };
}

export function normalizeDromEnergyAssetFeature(feature) {
  const properties = feature?.properties ?? {};
  if (!isDromTerritoryCode(properties.territoryCode)) return null;
  if (typeof properties.id !== 'string') return null;
  if (typeof properties.type !== 'string') return null;
  if (typeof properties.name !== 'string') return null;
  if (typeof properties.sourceDatasetId !== 'string') return null;

  const asset = {
    id: properties.id,
    territoryCode: properties.territoryCode,
    type: properties.type,
    name: properties.name,
    sourceDatasetId: properties.sourceDatasetId,
  };

  if (feature?.geometry?.type === 'Point' && Array.isArray(feature.geometry.coordinates)) {
    const [lon, lat] = feature.geometry.coordinates;
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      asset.coordinates = [lon, lat];
    }
  }

  for (const key of [
    'operator',
    'communeCode',
    'communeName',
    'productionType',
    'status',
    'updatedAt',
    'rawProperties',
  ]) {
    if (properties[key] != null) asset[key] = properties[key];
  }

  for (const key of ['voltageKv', 'capacityMw', 'availableCapacityMw']) {
    if (typeof properties[key] === 'number' && Number.isFinite(properties[key])) {
      asset[key] = properties[key];
    }
  }

  return asset;
}

export function normalizeDromEnergyAssets(payload) {
  if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features)) return [];
  return payload.features
    .map((feature) => normalizeDromEnergyAssetFeature(feature))
    .filter(Boolean);
}

export function normalizeDromEnergyDatasets(payload, options = {}) {
  if (!Array.isArray(payload)) return [];
  const requireFetchedAt = options.requireFetchedAt === true;

  return payload
    .filter((source) => source && typeof source.id === 'string' && Array.isArray(source.territoryCodes))
    .filter((source) => !requireFetchedAt || (typeof source.fetchedAt === 'string' && source.fetchedAt.length > 0))
    .map((source) => ({
      ...source,
      territoryCodes: source.territoryCodes.filter(isDromTerritoryCode),
    }))
    .filter((source) => source.territoryCodes.length > 0);
}

export function normalizeDromEnergyTerritories(payload) {
  if (!Array.isArray(payload)) return [];
  return payload.filter((territory) => territory && isDromTerritoryCode(territory.code));
}

export function getDromEnergyUpdatedAt(datasets) {
  return datasets
    .map((dataset) => dataset.fetchedAt)
    .filter((value) => typeof value === 'string' && value.length > 0)
    .sort()
    .at(-1) ?? new Date(0).toISOString();
}

export function buildDromEnergyDashboardFromStaticPayloads(payloads, options = {}) {
  const datasets = normalizeDromEnergyDatasets(payloads.sources, {
    requireFetchedAt: options.requireFetchedAt === true,
  });

  return {
    territories: normalizeDromEnergyTerritories(payloads.territories),
    assets: [
      ...normalizeDromEnergyAssets(payloads.substations),
      ...normalizeDromEnergyAssets(payloads.pylons),
      ...normalizeDromEnergyAssets(payloads.productionSites),
    ],
    communeMetrics: [
      ...(Array.isArray(payloads.communeConsumption) ? payloads.communeConsumption : []),
      ...(Array.isArray(payloads.co2Emissions) ? payloads.co2Emissions : []),
      ...(Array.isArray(payloads.efficiencyActions) ? payloads.efficiencyActions : []),
    ],
    productionLimitations: Array.isArray(payloads.productionLimitations) ? payloads.productionLimitations : [],
    datasets,
    updatedAt: getDromEnergyUpdatedAt(datasets),
  };
}
