export type DromTerritoryCode =
  | 'GP'
  | 'MQ'
  | 'GF'
  | 'RE'
  | 'YT';

export type DromEnergyAssetType =
  | 'source_substation'
  | 'htb_pylon'
  | 'production_site'
  | 'storage_site'
  | 'hosting_capacity_point';

export type DromEnergyDatasetFamily =
  | 'grid_assets'
  | 'hosting_capacity'
  | 'consumption'
  | 'production_registry'
  | 'production_limitations'
  | 'co2'
  | 'efficiency';

export type DromEnergyDatasetGeometry = 'point' | 'line' | 'polygon' | 'none';

export type DromEnergyDatasetSource = 'EDF_SEI' | 'national_registry' | 'territorial_reference';

export type DromEnergyDatasetExpectedFormat = 'geojson' | 'json' | 'csv';

export interface DromEnergyDatasetIngestionStatus {
  status: 'success' | 'failure';
  lastRun?: string;
  testedAt: string;
  source?: 'remote' | 'local_fallback' | 'local_fallback_forced' | 'none';
  selectedUrl?: string;
  reason?: string;
  lastAttemptedUrl?: string;
  statusCode?: number;
  contentType?: string;
  featureCount?: number;
  recordCount?: number;
  error?: string;
  attempts?: Array<{
    url: string;
    statusCode?: number;
    contentType?: string;
    error?: string;
  }>;
}

export interface DromEnergyTerritory {
  code: DromTerritoryCode;
  name: string;
  bounds: [number, number, number, number];
  center: [number, number];
  inseeRegionCode?: string;
}

export interface DromEnergyAsset {
  id: string;
  territoryCode: DromTerritoryCode;
  type: DromEnergyAssetType;
  name: string;
  sourceDatasetId: string;
  operator?: string;
  coordinates?: [number, number];
  communeCode?: string;
  communeName?: string;
  voltageKv?: number;
  capacityMw?: number;
  availableCapacityMw?: number;
  productionType?: string;
  status?: 'active' | 'limited' | 'planned' | 'unknown';
  updatedAt?: string;
  rawProperties?: Record<string, unknown>;
}

export interface DromEnergyCommuneMetric {
  territoryCode: DromTerritoryCode;
  communeCode: string;
  communeName: string;
  year: number;
  sourceDatasetId: string;
  consumptionMwh?: number;
  co2Tons?: number;
  efficiencyActionsCount?: number;
  rawProperties?: Record<string, unknown>;
}

export interface DromEnergyProductionLimitation {
  id: string;
  territoryCode: DromTerritoryCode;
  sourceDatasetId: string;
  siteName?: string;
  productionType?: string;
  limitationReason?: string;
  startDate?: string;
  endDate?: string;
  limitedPowerMw?: number;
  rawProperties?: Record<string, unknown>;
}

export interface DromEnergyDatasetMeta {
  id: string;
  label: string;
  family: DromEnergyDatasetFamily;
  territoryCodes: DromTerritoryCode[];
  geometry: DromEnergyDatasetGeometry;
  source: DromEnergyDatasetSource;
  url?: string;
  urls?: string[];
  localFallbackPath?: string;
  expectedFormat?: DromEnergyDatasetExpectedFormat;
  dataGouvDatasetSlug?: string;
  dataGouvResourceId?: string;
  dataFairDatasetSlug?: string;
  fetchedAt?: string;
  ingestion?: DromEnergyDatasetIngestionStatus;
}

export interface DromEnergyDashboard {
  territories: DromEnergyTerritory[];
  assets: DromEnergyAsset[];
  communeMetrics: DromEnergyCommuneMetric[];
  productionLimitations: DromEnergyProductionLimitation[];
  datasets: DromEnergyDatasetMeta[];
  updatedAt: string;
}
