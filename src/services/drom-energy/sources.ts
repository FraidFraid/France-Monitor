import territoriesJson from '../../../public/data/drom-energy/territories.json';
import sourcesJson from '../../../public/data/drom-energy/sources.json';

import type {
  DromEnergyDatasetFamily,
  DromEnergyDatasetGeometry,
  DromEnergyDatasetIngestionStatus,
  DromEnergyDatasetMeta,
  DromEnergyDatasetSource,
  DromEnergyDatasetExpectedFormat,
  DromEnergyTerritory,
  DromTerritoryCode,
} from './types.ts';

interface RawDromEnergyTerritory {
  code: string;
  name: string;
  bounds: number[];
  center: number[];
  inseeRegionCode?: string;
}

interface RawDromEnergySource {
  id: string;
  label: string;
  family: string;
  geometry: string;
  source: string;
  territoryCodes: string[];
  url?: string;
  urls?: string[];
  localFallbackPath?: string;
  expectedFormat?: string;
  dataGouvDatasetSlug?: string;
  dataGouvResourceId?: string;
  dataFairDatasetSlug?: string;
  fetchedAt?: string;
  ingestion?: DromEnergyDatasetIngestionStatus;
}

function toDromTerritoryCode(code: string): DromTerritoryCode {
  switch (code) {
    case 'GP':
    case 'MQ':
    case 'GF':
    case 'RE':
    case 'YT':
      return code;
    default:
      throw new Error(`Unknown DROM territory code: ${code}`);
  }
}

function toTerritoryBounds(bounds: number[]): [number, number, number, number] {
  if (bounds.length !== 4) {
    throw new Error(`Invalid DROM territory bounds length: ${bounds.length}`);
  }
  return [bounds[0]!, bounds[1]!, bounds[2]!, bounds[3]!];
}

function toTerritoryCenter(center: number[]): [number, number] {
  if (center.length !== 2) {
    throw new Error(`Invalid DROM territory center length: ${center.length}`);
  }
  return [center[0]!, center[1]!];
}

function toDatasetFamily(family: string): DromEnergyDatasetFamily {
  switch (family) {
    case 'grid_assets':
    case 'hosting_capacity':
    case 'consumption':
    case 'production_registry':
    case 'production_limitations':
    case 'co2':
    case 'efficiency':
      return family;
    default:
      throw new Error(`Unknown DROM energy dataset family: ${family}`);
  }
}

function toDatasetGeometry(geometry: string): DromEnergyDatasetGeometry {
  switch (geometry) {
    case 'point':
    case 'line':
    case 'polygon':
    case 'none':
      return geometry;
    default:
      throw new Error(`Unknown DROM energy dataset geometry: ${geometry}`);
  }
}

function toDatasetSource(source: string): DromEnergyDatasetSource {
  switch (source) {
    case 'EDF_SEI':
    case 'national_registry':
    case 'regional_reference':
    case 'territorial_reference':
      return source;
    default:
      throw new Error(`Unknown DROM energy dataset source: ${source}`);
  }
}

function toExpectedFormat(format: string | undefined): DromEnergyDatasetExpectedFormat | undefined {
  switch (format) {
    case undefined:
      return undefined;
    case 'geojson':
    case 'json':
    case 'csv':
      return format;
    default:
      throw new Error(`Unknown DROM energy expected format: ${format}`);
  }
}

const DROM_ENERGY_TERRITORIES: DromEnergyTerritory[] = (territoriesJson as RawDromEnergyTerritory[]).map((territory) => ({
  code: toDromTerritoryCode(territory.code),
  name: territory.name,
  bounds: toTerritoryBounds(territory.bounds),
  center: toTerritoryCenter(territory.center),
  inseeRegionCode: territory.inseeRegionCode,
}));

const DROM_ENERGY_SOURCES: DromEnergyDatasetMeta[] = (sourcesJson as RawDromEnergySource[]).map((source) => ({
  id: source.id,
  label: source.label,
  family: toDatasetFamily(source.family),
  geometry: toDatasetGeometry(source.geometry),
  source: toDatasetSource(source.source),
  territoryCodes: source.territoryCodes.map(toDromTerritoryCode),
  url: source.url,
  urls: source.urls,
  localFallbackPath: source.localFallbackPath,
  expectedFormat: toExpectedFormat(source.expectedFormat),
  dataGouvDatasetSlug: source.dataGouvDatasetSlug,
  dataGouvResourceId: source.dataGouvResourceId,
  dataFairDatasetSlug: source.dataFairDatasetSlug,
  fetchedAt: source.fetchedAt,
  ingestion: source.ingestion,
}));

function cloneTerritory(territory: DromEnergyTerritory): DromEnergyTerritory {
  return {
    ...territory,
    bounds: [...territory.bounds] as [number, number, number, number],
    center: [...territory.center] as [number, number],
  };
}

function cloneSource(source: DromEnergyDatasetMeta): DromEnergyDatasetMeta {
  return {
    ...source,
    territoryCodes: [...source.territoryCodes],
    urls: source.urls ? [...source.urls] : undefined,
    ingestion: source.ingestion
      ? {
          ...source.ingestion,
          attempts: source.ingestion.attempts?.map((attempt) => ({ ...attempt })),
        }
      : undefined,
  };
}

export function getDromEnergyTerritories(): DromEnergyTerritory[] {
  return DROM_ENERGY_TERRITORIES.map(cloneTerritory);
}

export function getDromEnergySources(): DromEnergyDatasetMeta[] {
  return DROM_ENERGY_SOURCES.map(cloneSource);
}

export function getDromEnergySourcesByTerritory(code: DromTerritoryCode): DromEnergyDatasetMeta[] {
  return DROM_ENERGY_SOURCES
    .filter((source) => source.territoryCodes.includes(code))
    .map(cloneSource);
}

export function getDromEnergySourcesByFamily(family: DromEnergyDatasetFamily): DromEnergyDatasetMeta[] {
  return DROM_ENERGY_SOURCES
    .filter((source) => source.family === family)
    .map(cloneSource);
}
