import type { Feature, FeatureCollection, Geometry, Point } from 'geojson';

import {
  getDromEnergySources,
  getDromEnergyTerritories,
} from './sources.ts';
import {
  DROM_ENERGY_DATA_BASE_PATH,
  DROM_ENERGY_STATIC_FILES,
  buildDromEnergyDashboardFromStaticPayloads,
  emptyFeatureCollection,
} from './static-runtime.js';
import type {
  DromEnergyAsset,
  DromEnergyCommuneMetric,
  DromEnergyDashboard,
  DromEnergyDatasetMeta,
  DromEnergyProductionLimitation,
  DromEnergyTerritory,
} from './types.ts';

export {
  getDromEnergySources,
  getDromEnergySourcesByFamily,
  getDromEnergySourcesByTerritory,
  getDromEnergyTerritories,
} from './sources.ts';
export { getDromTerritoryLabel } from './labels.ts';
export type {
  DromEnergyDatasetFamily,
  DromEnergyDatasetGeometry,
  DromEnergyDatasetMeta,
  DromEnergyDatasetSource,
  DromEnergyAsset,
  DromEnergyAssetType,
  DromEnergyCommuneMetric,
  DromEnergyDashboard,
  DromEnergyProductionLimitation,
  DromEnergyTerritory,
  DromTerritoryCode,
} from './types.ts';

const DROM_ENERGY_ENDPOINT = '/api/energy/drom';
const REUNION_POSTES_SOURCES_DATASET_ID = 'postes_sources_reunion';

type FetchLike = typeof fetch;

interface GeoJsonLike {
  type?: string;
  features?: unknown[];
}

function cloneTerritory(territory: DromEnergyTerritory): DromEnergyTerritory {
  return {
    ...territory,
    bounds: [...territory.bounds] as [number, number, number, number],
    center: [...territory.center] as [number, number],
  };
}

function cloneDataset(dataset: DromEnergyDatasetMeta): DromEnergyDatasetMeta {
  return {
    ...dataset,
    territoryCodes: [...dataset.territoryCodes],
  };
}

function cloneAsset(asset: DromEnergyAsset): DromEnergyAsset {
  return {
    ...asset,
    coordinates: asset.coordinates ? [...asset.coordinates] as [number, number] : undefined,
    rawProperties: asset.rawProperties ? { ...asset.rawProperties } : undefined,
  };
}

function cloneCommuneMetric(metric: DromEnergyCommuneMetric): DromEnergyCommuneMetric {
  return {
    ...metric,
    rawProperties: metric.rawProperties ? { ...metric.rawProperties } : undefined,
  };
}

function cloneLimitation(limitation: DromEnergyProductionLimitation): DromEnergyProductionLimitation {
  return {
    ...limitation,
    rawProperties: limitation.rawProperties ? { ...limitation.rawProperties } : undefined,
  };
}

function getDefaultTerritories(): DromEnergyTerritory[] {
  return getDromEnergyTerritories().map(cloneTerritory);
}

function pickString(props: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = props[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickNumber(props: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = props[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function isPointFeature(feature: Feature<Geometry, Record<string, unknown>>): feature is Feature<Point, Record<string, unknown>> {
  return feature.geometry?.type === 'Point' && Array.isArray(feature.geometry.coordinates);
}

function isFeatureCollection(value: unknown): value is FeatureCollection<Geometry, Record<string, unknown>> {
  const candidate = value as GeoJsonLike | null;
  return candidate?.type === 'FeatureCollection' && Array.isArray(candidate.features);
}

function toRawProperties(properties: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (!properties) return undefined;
  return { ...properties };
}

function buildFallbackAssetId(
  coordinates: [number, number],
  index: number,
): string {
  return `re-source-substation-${index}-${coordinates[0]}-${coordinates[1]}`;
}

function mergeDashboardMeta(
  base: DromEnergyDashboard,
  datasets: DromEnergyDatasetMeta[],
  updatedAt: string,
): DromEnergyDashboard {
  return {
    territories: base.territories.map(cloneTerritory),
    assets: base.assets.map(cloneAsset),
    communeMetrics: base.communeMetrics.map(cloneCommuneMetric),
    productionLimitations: base.productionLimitations.map(cloneLimitation),
    datasets: datasets.map(cloneDataset),
    gridLines: base.gridLines,
    updatedAt,
  };
}

async function fetchStaticJson<T>(
  path: string,
  fetchImpl: FetchLike,
  fallback: T,
): Promise<T> {
  try {
    const response = await fetchImpl(path, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`static file responded ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[drom-energy] Failed static load ${path}: ${message}`);
    return fallback;
  }
}

export function createEmptyDromEnergyDashboard(): DromEnergyDashboard {
  return {
    territories: getDefaultTerritories(),
    assets: [],
    communeMetrics: [],
    productionLimitations: [],
    datasets: [],
    gridLines: {
      reunionHta: emptyFeatureCollection() as FeatureCollection<Geometry, Record<string, unknown>>,
    },
    updatedAt: new Date(0).toISOString(),
  };
}

export function normalizeReunionPostesSourcesFeature(
  feature: Feature<Geometry, Record<string, unknown>>,
  datasetId = REUNION_POSTES_SOURCES_DATASET_ID,
  index = 0,
): DromEnergyAsset | null {
  if (!isPointFeature(feature)) return null;

  const [lon, lat] = feature.geometry.coordinates;
  if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    return null;
  }

  const properties = feature.properties ?? {};
  const featureId = typeof feature.id === 'string' || typeof feature.id === 'number'
    ? String(feature.id)
    : null;
  const id = featureId ?? pickString(properties, ['id', 'objectid', 'fid', 'gid', 'code', 'code_ps', 'code_poste'])
    ?? buildFallbackAssetId([lon, lat], index);
  const name = pickString(properties, [
    'nom',
    'name',
    'libelle',
    'label',
    'poste',
    'poste_source',
    'nom_poste',
    'ouvrage',
  ]) ?? id;

  const asset: DromEnergyAsset = {
    id,
    territoryCode: 'RE',
    type: 'source_substation',
    name,
    sourceDatasetId: datasetId,
    coordinates: [lon, lat],
    rawProperties: toRawProperties(properties),
  };

  const voltageKv = pickNumber(properties, ['tension', 'tension_kv', 'voltage_kv', 'voltage']);
  if (voltageKv != null) asset.voltageKv = voltageKv;

  const operator = pickString(properties, ['operateur', 'operator', 'exploitant']);
  if (operator) asset.operator = operator;

  const communeCode = pickString(properties, ['code_insee', 'insee_com', 'code_commune', 'commune_code']);
  if (communeCode) asset.communeCode = communeCode;

  const communeName = pickString(properties, ['commune', 'nom_commune', 'libelle_commune']);
  if (communeName) asset.communeName = communeName;

  return asset;
}

export function buildReunionPostesSourcesDashboard(
  payload: unknown,
  datasetMeta: DromEnergyDatasetMeta,
  updatedAt: string,
): DromEnergyDashboard {
  const base = createEmptyDromEnergyDashboard();
  if (!isFeatureCollection(payload)) {
    return mergeDashboardMeta(base, [], updatedAt);
  }

  base.assets.push(
    ...payload.features
      .map((feature, index) => normalizeReunionPostesSourcesFeature(feature, datasetMeta.id, index))
      .filter((asset): asset is DromEnergyAsset => asset != null),
  );

  return mergeDashboardMeta(
    base,
    [{ ...datasetMeta, fetchedAt: updatedAt }],
    updatedAt,
  );
}

export async function loadDromEnergyDashboard(fetchImpl: FetchLike = fetch): Promise<DromEnergyDashboard> {
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
    fetchStaticJson<unknown>(`${DROM_ENERGY_DATA_BASE_PATH}/${DROM_ENERGY_STATIC_FILES.territories}`, fetchImpl, getDefaultTerritories()),
    fetchStaticJson<unknown>(`${DROM_ENERGY_DATA_BASE_PATH}/${DROM_ENERGY_STATIC_FILES.sources}`, fetchImpl, getDromEnergySources()),
    fetchStaticJson<unknown>(`${DROM_ENERGY_DATA_BASE_PATH}/${DROM_ENERGY_STATIC_FILES.geo.substations}`, fetchImpl, emptyFeatureCollection()),
    fetchStaticJson<unknown>(`${DROM_ENERGY_DATA_BASE_PATH}/${DROM_ENERGY_STATIC_FILES.geo.pylons}`, fetchImpl, emptyFeatureCollection()),
    fetchStaticJson<unknown>(`${DROM_ENERGY_DATA_BASE_PATH}/${DROM_ENERGY_STATIC_FILES.geo.productionSites}`, fetchImpl, emptyFeatureCollection()),
    fetchStaticJson<unknown>(`${DROM_ENERGY_DATA_BASE_PATH}/${DROM_ENERGY_STATIC_FILES.geo.reunionHtaLines}`, fetchImpl, emptyFeatureCollection()),
    fetchStaticJson<DromEnergyCommuneMetric[]>(
      `${DROM_ENERGY_DATA_BASE_PATH}/${DROM_ENERGY_STATIC_FILES.tables.communeConsumption}`,
      fetchImpl,
      [],
    ),
    fetchStaticJson<DromEnergyCommuneMetric[]>(
      `${DROM_ENERGY_DATA_BASE_PATH}/${DROM_ENERGY_STATIC_FILES.tables.co2Emissions}`,
      fetchImpl,
      [],
    ),
    fetchStaticJson<DromEnergyProductionLimitation[]>(
      `${DROM_ENERGY_DATA_BASE_PATH}/${DROM_ENERGY_STATIC_FILES.tables.productionLimitations}`,
      fetchImpl,
      [],
    ),
    fetchStaticJson<DromEnergyCommuneMetric[]>(
      `${DROM_ENERGY_DATA_BASE_PATH}/${DROM_ENERGY_STATIC_FILES.tables.efficiencyActions}`,
      fetchImpl,
      [],
    ),
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
  }, { requireFetchedAt: true }) as DromEnergyDashboard;
}

export async function loadReunionPostesSourcesDashboard(fetchImpl: FetchLike = fetch): Promise<DromEnergyDashboard> {
  return loadDromEnergyDashboard(fetchImpl);
}

export async function fetchDromEnergyDashboard(): Promise<DromEnergyDashboard> {
  const response = await fetch(DROM_ENERGY_ENDPOINT, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`DROM energy request failed: ${response.status}`);
  }

  return (await response.json()) as DromEnergyDashboard;
}
