import type { FeatureCollection, Geometry, Point } from 'geojson';

export type EolienParkKind = 'onshore' | 'offshore' | 'unknown';
export type EolienParkStatus = 'operating' | 'construction' | 'authorized' | 'project' | 'inactive' | 'unknown';
export type EolienAlertLevel = 'normal' | 'watch' | 'low-production';

export interface EolienTerreMerSplit {
  terre: number;
  mer: number;
}

export interface EolienLiveApiResponse {
  production_gw: number;
  timestamp: string;
  installed_gw?: number;
  terre_mer_split?: EolienTerreMerSplit;
  alertThresholdGw?: number;
  source?: string;
}

export interface EolienLive {
  production: number;
  production_gw: number;
  puissance_installee: number;
  facteur_charge: number;
  parcs_actifs: number;
  timestamp: Date;
  alertLevel: EolienAlertLevel;
  terre_mer_split?: EolienTerreMerSplit;
}

export interface EolienParkProperties {
  id: string;
  name: string;
  status: EolienParkStatus;
  kind: EolienParkKind;
  capacityMw: number | null;
  turbineCount: number | null;
  commissioningYear: number | null;
  operator: string | null;
  commune: string | null;
  department: string | null;
  region: string | null;
  estimatedProductionMw?: number | null;
  [key: string]: unknown;
}

export type EolienParcsGeoJSON = FeatureCollection<Geometry, EolienParkProperties>;

export interface EolienParkSummary {
  id: string;
  groupId: string;
  name: string;
  status: EolienParkStatus;
  kind: EolienParkKind;
  capacityMw: number | null;
  turbineCount: number | null;
  operator: string | null;
  commune: string | null;
  department: string | null;
  region: string | null;
  commissioningYear: number | null;
  estimatedProductionMw: number | null;
  coordinates: [number, number];
  sourceType: 'turbine' | 'park';
}

export interface EolienTrackerSnapshot {
  live: EolienLive;
  geojson: EolienParcsGeoJSON;
  points: EolienParkSummary[];
  parks: EolienParkSummary[];
}

export interface EolienLayerFeatureProperties extends EolienParkProperties {
  capacityMw: number;
  estimatedProductionMw: number;
  radius: number;
  color: string;
  ringColor: string;
  glowColor: string;
  opacity: number;
}

export type EolienLayerGeoJSON = FeatureCollection<Point, EolienLayerFeatureProperties>;
