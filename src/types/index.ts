import type { LineString, MultiLineString, Polygon } from 'geojson';

// ═══ Threat & Classification ═══

export type ThreatLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type EventCategory =
  | 'social'
  | 'security'
  | 'energy'
  | 'weather'
  | 'transport'
  | 'infrastructure'
  | 'health'
  | 'general'
  | 'finance'
  | 'floods'
  | 'fires'
  | 'cyber';

export interface ThreatClassification {
  level: ThreatLevel;
  category: EventCategory;
  confidence: number;
  source: 'keyword' | 'ml' | 'llm';
}

// ═══ Feeds & News ═══

export interface Feed {
  name: string;
  url: string;
  type?: 'general' | 'economy' | 'tech' | 'sport' | 'politics';
  region?: string;
  tier: number;
}

export interface NewsItem {
  id: string;
  source: string;
  title: string;
  link: string;
  pubDate: Date;
  isAlert: boolean;
  tier?: number;
  feedRegion?: string;  // Region from the feed config (e.g. "Bretagne"), used as geocoding fallback
  threat?: ThreatClassification;
  lat?: number;
  lon?: number;
  locationName?: string;
  summary?: string;
  aiSummary?: string;
  aiSummaryStatus?: 'pending' | 'done' | 'failed';  // Status of AI summary generation
}

// ═══ Time & Filters ═══

export type TimeRange = '1h' | '6h' | '24h' | '48h' | '7d' | 'all';

export interface MapLayers {
  newsGroup: boolean;
  news: boolean;
  alerts: boolean;
  energySystems: boolean;
  powerGrid: boolean;
  hydroBackbone: boolean;
  windMonitor: boolean;
  health: boolean;
  healthOscour: boolean;
  healthApl: boolean;
  hospitals: boolean;
  environmentGroup: boolean;
  environmental: boolean;
  fires: boolean;
  criticalEnergyInfra: boolean;
  traffic: boolean;
  trafficRoad: boolean;
  trafficMaritime: boolean;
  trafficAir: boolean;
  trafficRail: boolean;
  metroLoad: boolean;
  sovereignty: boolean;
  military: boolean;
  subseaCables: boolean;
  outages: boolean;
  outagesElec: boolean;
  outagesTelecom: boolean;
  outagesInternet: boolean;
  outagesCloud: boolean;
  stability: boolean;
  cyber: boolean;
  gasNetwork: boolean;
  oilNetwork: boolean;
  nuclearFleet: boolean;
  dayNight?: boolean;
  elus?: boolean;
}

export type LayerRole = 'groupMaster' | 'child' | 'standalone';

export interface LayerConfig<L = any> {
  id: keyof MapLayers;
  groupId?: string;           // Ex: 'health'
  role: LayerRole;
  label?: string;
  dependsOnGroup?: boolean;   // Si false, visible même si le master du groupe est OFF
  legend?: L;                 // Pointeur vers la configuration de la légende
}

export interface FilterState {
  timeRange: TimeRange;
  categories: EventCategory[];
  threatLevels: ThreatLevel[];
  layers: MapLayers;
  searchQuery: string;
}


// ═══ Energy (Ecowatt) ═══

export type EcowattSignal = 'green' | 'orange' | 'red';

export interface RegionEnergyStats {
  regionCode:          string;     // code INSEE région (ex: "11")
  regionName:          string;
  updatedAt:           Date;
  consumptionMW:       number;
  consumptionDeltaPct: number;     // variation vs même heure J-1 (%)
  production:          EnergyMix;  // réutilise le type existant
  lowCarbonPct:        number;     // (nucleaire+hydro+eolien+solaire) / total
  carbonIntensity:     number;     // gCO₂/kWh estimé
  ecowattToday:        EcowattSignal;
  ecowattJ1:           EcowattSignal; // estimé (même signal en l'absence de prévision)
  ecowattJ2:           EcowattSignal;
}

export interface InterconnectionFlowStats {
  id:                    string;   // "FR-ES", "FR-DE", etc.
  label:                 string;   // "France → Espagne"
  direction:             'export' | 'import' | 'balanced';
  powerMW:               number;   // positif = export FR
  capacityMW:            number;   // NTC de l'interconnexion
  utilizationPct:        number;
  dailyBalanceMWh:       number;   // solde estimé J en cours
  dailyBalancePrevMWh:   number;   // solde estimé J-1
  summary:               string;   // phrase générée
  updatedAt:             Date;
}

export interface InterconnectionFlow {
  country: string;
  flowMW: number; // positive = import INTO France, negative = export FROM France (convention éCO2mix)
  coordinates: [number, number]; // target coordinates outside France
}

export interface EcowattResponse {
  signals: Record<string, EcowattSignal>;
  mixes: Record<string, EnergyMix>;
  national: EnergyMix;
  interconnections: InterconnectionFlow[];
}

export interface EcowattData {
  date: string;
  signal: EcowattSignal;
  message: string;
  regions?: Record<string, EcowattSignal>;
}

export interface EnergyMix {
  timestamp: Date;
  nuclear: number;
  wind: number;
  solar: number;
  hydro: number;
  gas: number;
  other: number;
  total: number;
}

// ═══ Weather (Météo-France) ═══

export type MeteoVigilanceLevel = 'green' | 'yellow' | 'orange' | 'red' | 'violet';

export type MeteoRiskType =
  | 'wind'
  | 'rain-flood'
  | 'thunderstorm'
  | 'flood'
  | 'snow-ice'
  | 'heat'
  | 'cold'
  | 'avalanche'
  | 'wave-surge';

export interface MeteoAlert {
  department: string;
  departmentCode: string;
  level: MeteoVigilanceLevel;
  risks: MeteoRiskType[];
  startDate?: Date;
  endDate?: Date;
}

export const RISK_LABELS: Record<string, string> = {
  'wind': 'Vent violent',
  'rain-flood': 'Pluie-inondation',
  'thunderstorm': 'Orages',
  'flood': 'Crues',
  'snow-ice': 'Neige-verglas',
  'heat': 'Canicule',
  'cold': 'Grand froid',
  'avalanche': 'Avalanches',
  'wave-surge': 'Vagues-submersion',
};


// ═══ Floods (Vigicrues) ═══

export type FloodVigilanceLevel = 'green' | 'yellow' | 'orange' | 'red';
export type FloodDataSource = 'live' | 'mock';
export type FloodGeometryFidelity = 'raw' | 'matched' | 'fallback';

export interface FloodSegment {
  id: string;
  name: string;
  level: FloodVigilanceLevel;
  dataSource: FloodDataSource;
  geometryFidelity: FloodGeometryFidelity;
  matchConfidence: number;
  rawVertexCount: number;
  displayVertexCount: number;
  geometry: LineString | MultiLineString;
  rawGeometry: LineString | MultiLineString;
  displayGeometry: LineString | MultiLineString;
}

// ═══ Copernicus / Satellite ═══

/** Used by copernicus.ts buildEoBrowserUrl() and EO Browser CTA links in popups. */
export type SatelliteCollection = 'sentinel-2-l2a' | 'sentinel-1-grd';

export type SatelliteSourceType = 'news' | 'flood';

export interface CopernicusScene {
  id: string;
  datetime: string;
  cloudCover?: number;
  thumbnailUrl?: string;
  cogUrl?: string;
  bbox: [number, number, number, number];
  collection: SatelliteCollection;
}

export interface SatelliteViewRequest {
  bbox: [number, number, number, number];
  sourceType: SatelliteSourceType;
  title?: string;
  point?: [number, number];
  geometry?: LineString | MultiLineString;
  preferredCollection?: SatelliteCollection;
  eventDate?: Date;
}

export type SentinelNdwiDateInput =
  | string
  | {
    from: string;
    to: string;
  };

export interface SentinelNdwiResponse {
  sceneId: string;
  acquisitionDate: string;
  cloudCoverage: number | null;
  imageUrl?: string;
  tileUrl?: string;
}

export interface SentinelNdwiRequest {
  aoi: Polygon;
  date: SentinelNdwiDateInput;
  maxCloudCoverage?: number;
}

// ═══ Fires (NASA FIRMS) ═══

export interface ActiveFire {
  id: string;
  latitude: number;
  longitude: number;
  bright_ti4: number;
  scan: number;
  track: number;
  acq_date: string;
  acq_time: string;
  satellite: string;
  confidence: string;
  version: string;
  bright_ti5: number;
  frp: number;
  daynight: string;
}

/**
 * Un incident feu = cluster DBSCAN de détections VIIRS proches spatio-temporellement.
 * Centroïde pondéré par FRP, enveloppe bbox, stats agrégées.
 */
export interface FireIncident {
  id: string;                       // hash déterministe du cluster
  centroidLat: number;              // centroïde pondéré FRP
  centroidLon: number;
  bboxMinLat: number;               // enveloppe englobante
  bboxMaxLat: number;
  bboxMinLon: number;
  bboxMaxLon: number;
  detectionsCount: number;
  frpMean: number;                  // MW
  frpMax: number;
  frpTotal: number;
  confidenceMax: 'high' | 'nominal' | 'low';
  startDatetime: string;            // ISO 8601 UTC
  endDatetime: string;
  durationMinutes: number;
  satellites: string[];             // ex: ['SNPP', 'NOAA-20']
  hasNightDetection: boolean;
  nearUrban: boolean;               // dans un rayon de 15 km d'une zone urbaine/industrielle
  clusterMethod: 'dbscan';
  epsKm: number;
  minPoints: number;
  score: FireIncidentScore;
  detectionIds: string[];           // IDs des ActiveFire membres
}

/**
 * Score de sévérité et d'impact pour un incident feu.
 * severityScore : intensité intrinsèque (FRP, persistance, confiance).
 * impactScore   : risque contextuel (zones urbaines, infra critique, nuit).
 */
export interface FireIncidentScore {
  severityScore: number;   // 0–100
  impactScore: number;     // 0–100
  labels: string[];        // ex: ['high_frp', 'persistent', 'near_urban', 'night', 'multi_satellite']
}

export interface WaterLevel {
  stationCode: string;
  stationName: string;
  level: number;
  timestamp: Date;
  trend: 'rising' | 'stable' | 'falling';
}

// ═══ Transport (SNCF) ═══

export interface TrainStop {
  name: string;
  time?: string; // Format HH:MM
  plannedTime?: string; // Scheduled HH:MM
  updatedTime?: string; // Realtime HH:MM
  delayMinutes?: number;
  coordinates?: [number, number]; // [lon, lat]
}

export interface TransportDisruption {
  id: string;
  type: 'delay' | 'cancellation' | 'works' | 'other';
  trainNumber?: string;
  line: string;
  description: string;
  severity: ThreatLevel;
  startDate: Date;
  endDate?: Date;
  departure?: TrainStop;
  arrival?: TrainStop;
  affectedStops?: string[];
  totalDelayMinutes?: number;
  coordinates?: [number, number]; // Center point for map highlight [lon, lat]
  routeGeometry?: LineString;
  rawRouteGeometry?: LineString;
  geometryFidelity?: 'matched' | 'raw' | 'fallback' | 'synthetic';
}

export interface RailNetworkData {
  /** LineString features: disrupted arc between departure and arrival */
  arcs: GeoJSON.FeatureCollection<GeoJSON.LineString, {
    id: string;
    severity: string;
    type: string;
    line: string;
    trainNumber?: string;
    description: string;
    departureName?: string;
    arrivalName?: string;
    departurePlannedTime?: string;
    departureUpdatedTime?: string;
    arrivalPlannedTime?: string;
    arrivalUpdatedTime?: string;
    totalDelayMinutes?: number;
    affectedStopsCount?: number;
    affectedStopsJson?: string;
    geometryFidelity?: string;
  }>;
  /** Point features: unique impacted stations, worst severity wins */
  stations: GeoJSON.FeatureCollection<GeoJSON.Point, {
    name: string;
    severity: string;
    count: number;
    linesJson?: string;
    trainNumbersJson?: string;
    affectedStopsJson?: string;
  }>;
}

// ═══ Map & Geo ═══

export interface MapViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface ViewPreset {
  name: string;
  center: [number, number]; // [lng, lat]
  zoom: number;
}

export interface InfrastructurePoint {
  id: string;
  name: string;
  type: 'nuclear' | 'thermal' | 'hydro' | 'dam' | 'substation' | 'gas-terminal' | 'gas-storage' | 'refinery' | 'oil-depot';
  coordinates: [number, number]; // [lng, lat]
  status?: 'active' | 'maintenance' | 'shutdown';
  capacity?: number;
  capacityUnit?: string;
  operator?: string;
  voltageKv?: number;
  fuelType?: string;
  storageCapacityHm3?: number;
  throughputKbpd?: number;
  notes?: string;
  /** Couleur CSS override (ex. pour statut nucléaire dynamique RTE). */
  colorOverride?: string;
}

export type HydraulicAssetType =
  | 'hydro_production'
  | 'step_storage'
  | 'water_regulation';

export type HydraulicAssetSubtype =
  | 'dam'
  | 'reservoir'
  | 'pumped_storage'
  | 'run_of_river';

export type HydraulicTrend = 'low' | 'normal' | 'high' | 'stress';
export type HydraulicSignalSource = 'DERIVED_CONTEXT_ONLY' | 'DERIVED_REAL_MEASURE_SUPPORT';
export type HydraulicMeasuredSupportLevel = 'none' | 'partial' | 'strong';
export type HydraulicDataFreshness = 'fresh' | 'aging' | 'stale' | 'unavailable';
export type HydraulicObservationTrend = 'rising' | 'falling' | 'stable' | 'mixed' | 'unavailable';

export type HydraulicLocationAccuracy = 'site' | 'commune' | 'approx';

export interface HydraulicBackboneAsset {
  id: string;
  name: string;
  type: HydraulicAssetType;
  subtype: HydraulicAssetSubtype;
  location: {
    lat: number;
    lon: number;
    region: string;
    country: 'FR';
  };
  capacity_mw: number | null;
  reservoir_volume: number | null;
  operator: string | null;
  river: string | null;
  commune?: string | null;
  department?: string | null;
  technology?: string | null;
  head_m?: number | null;
  annual_generation_gwh?: number | null;
  location_accuracy?: HydraulicLocationAccuracy;
  official_name?: string | null;
  source_date?: string | null;
  verification_sources?: string[];
  criticality_score: number;
  signals: {
    hydro_trend: HydraulicTrend;
    last_update: string;
    signalSource: HydraulicSignalSource;
    dataFreshness: HydraulicDataFreshness;
    measuredSupportLevel: HydraulicMeasuredSupportLevel;
    hydroTrend: HydraulicObservationTrend;
    observationTimestamp: string | null;
    confidence: number;
    measuredStationCount: number;
    sourceDetail: string | null;
  };
  selection_reason?: string;
}

// ═══ Nuclear Sites (RTE / ASN) ═══

export type NuclearStatus =
  | 'operational'
  | 'planned_outage'
  | 'forced_outage'
  | 'decommissioning';

export interface NuclearSiteStats {
  /** Nom du site (ex. "Gravelines") */
  name: string;
  /** Région administrative */
  region: string;
  /** Nombre de réacteurs */
  reactorCount: number;
  /** Puissance nette installée totale (MW) */
  totalNetCapacityMW: number;
  /** Description courte des types de réacteurs (ex. ["4 x 1300 MW (P4)"]) */
  reactorTypes: string[];
  /** Années de mise en service de chaque réacteur */
  commissioningYears: number[];
  /** État opérationnel du site */
  status: NuclearStatus;
  /** Production instantanée en MW (si connue) */
  currentOutputMW?: number;
  /** Taux d'utilisation actuel en % */
  loadFactorPct?: number;
  /** Production annuelle récente en TWh (moyenne) */
  annualGenerationTWh?: number;
  /** Info prolongation durée de vie (ex. "Prolongation 50 ans approuvée") */
  lifetimeExtension?: string;
  /** URL fiche sûreté ASN */
  asnLink?: string;
  /** Timestamp ISO des données RTE/éCO2mix */
  updatedAt?: string;
}

export interface NuclearUnitReference {
  id: string;
  plantId: string;
  plantName: string;
  unitName: string;
  nominalPowerMW: number;
  aliases?: string[];
}

// ═══ Nuclear Module (RTE Layer 1 + REMIT Layer 2 + Correlation Layer 3) ═══

export type ReactorAvailabilityStatus =
  | 'AVAILABLE'
  | 'REDUCED'
  | 'OUTAGE_PLANNED'
  | 'OUTAGE_UNPLANNED'
  | 'UNKNOWN';

/** Indisponibilité structurée RTE (Layer 1 — OAuth2 API) */
export interface NuclearUnavailability {
  id: string;
  plantName: string;          // ex. "Gravelines"
  unitName: string;           // ex. "GRAVELINES-1" (nom RTE normalisé)
  nominalPowerMW: number;
  availablePowerMW: number;
  status: ReactorAvailabilityStatus;
  startDate: Date;
  endDate: Date | null;
  type: 'PLANNED' | 'UNPLANNED' | 'FORCE_MAJEURE';
  updatedAt: Date;
}

/** Signal REMIT filtré pour le nucléaire (Layer 2 — IIP RSS) */
export interface NuclearRemitSignal {
  id: string;
  plantName: string;
  unitName: string | null;
  classifiedAs:
    | 'UNPLANNED_OUTAGE'
    | 'PLANNED_MAINTENANCE'
    | 'RESTART'
    | 'EXTENSION'
    | 'OTHER';
  capacityMW: number | null;
  publishedAt: Date;
  title: string;
  link: string;
  /** false par défaut dans nuclear-remit.ts, résolu dans nuclear-correlation.ts */
  confirmedByRTE: boolean;
  matchConfidence: number; // 0–1
}

/** Signal REMIT non reflété dans les données RTE structurées */
export interface UnconfirmedRemitSignal {
  remitSignal: NuclearRemitSignal;
  reason: string;
  confidence: number;
}

/** Score de tension nucléaire (Layer 3) */
export interface NuclearStressScore {
  installedCapacityMW: number;
  availableCapacityMW: number;
  stressRatio: number;  // (installed - available) / installed
  level: 'NORMAL' | 'TENSION' | 'CRITIQUE'; // <10% / 10–25% / >25%
  gridTensionRisk: boolean;
  updatedAt: Date;
  freshness: 'quasi-realtime' | 'stale' | 'unavailable';
}

/** État global du module nucléaire */
export interface NuclearState {
  unavailabilities: NuclearUnavailability[];
  remitSignals: NuclearRemitSignal[];
  unconfirmedSignals: UnconfirmedRemitSignal[];
  stress: NuclearStressScore | null;
  rteAvailable: boolean;
  remitAvailable: boolean;
  remitStatus: 'ok' | 'empty' | 'html' | 'unavailable';
  fetchedAt: Date;
}

// ═══ Military (Def & Sec) ═══

export type FrenchMilitaryOperator =
  | 'armee-air'      // Armée de l'Air et de l'Espace
  | 'marine'         // Marine Nationale
  | 'gendarmerie'    // Gendarmerie Nationale (Aviation)
  | 'alat'           // Aviation Légère de l'Armée de Terre
  | 'securite-civile' // Sécurité Civile
  | 'douanes'        // Direction générale des douanes
  | 'unknown';

export type FrenchAircraftType =
  | 'fighter'
  | 'transport'
  | 'tanker'
  | 'awacs'
  | 'patrol'
  | 'helicopter'
  | 'trainer'
  | 'drone'
  | 'liaison'
  | 'unknown';

export interface MilitaryFlight {
  id: string; // ICAO24
  callsign: string;
  country: string;
  longitude: number;
  latitude: number;
  altitude: number;  // feet
  velocity: number;  // m/s (raw) kept for compat
  speed: number;     // knots
  heading: number;
  lastContact: number;
  isMilitary?: boolean;
  // Enriched classification fields
  hexCode?: string;
  aircraftType?: FrenchAircraftType;
  aircraftModel?: string;  // e.g. "Rafale", "A400M"
  operator?: FrenchMilitaryOperator;
  operatorLabel?: string;  // human-readable label
  confidence?: 'high' | 'medium' | 'low';
  squawk?: string;
  registration?: string;   // immatriculation (e.g. F-ZBMH, 5890)
  // Trail (position history for path rendering)
  trail?: [number, number][];  // [[lon, lat], ...] - last N positions
  // Squawk alert (emergency codes)
  squawkAlert?: {
    code: string;
    type: 'emergency' | 'military' | 'special';
    severity: 'critical' | 'high' | 'info';
    description: string;
  };
  // Allied aircraft info
  isAllied?: boolean;
  branch?: string;  // e.g. "USAF", "RAF", "Luftwaffe"
  // Navigation accuracy — NAC-P (0–11), from ADS-B DO-260B §2.2.3.2.7.2
  // 11 = <3m, 0 = unknown/no GPS fix. Only available from adsb.fi, not proxy.
  nacP?: number;
}

export type MilitaryFlightsMode = 'live' | 'stale-cache' | 'empty';

export interface MilitaryFlightsSnapshot {
  source: string;
  fetchedAt: number;
  ttlMs: number;
  flights: MilitaryFlight[];
  sourceCounts: Record<string, number>;
  errors: Array<{ source: string; message: string }>;
  mode: MilitaryFlightsMode;
  isMock: boolean;
  isStale: boolean;
}

export interface AirTrafficFlight {
  id: string;
  callsign: string;
  longitude: number;
  latitude: number;
  altitude: number;
  speed: number;
  heading: number;
  registration?: string;
  aircraftType?: string;
  aircraftModel?: string;
  operator?: string;
  category?: string;
  originAirport?: string;
  destinationAirport?: string;
  eta?: number;
  lastSeen?: number;
  onGround?: boolean;
  source: string;
  anomalies?: AirTrafficAnomaly[];
  nearbyAirportIata?: string;
  nearbyAirportName?: string;
  nearbyAirportDistanceKm?: number;
  airportScore?: number;
  airportSeverity?: ThreatLevel;
  airportSignals?: string[];
}

export interface AirTrafficAnomaly {
  type: 'holding' | 'go-around' | 'rapid-manoeuvre' | 'reroute-probable';
  label: string;
  severity: ThreatLevel;
  details?: string;
  airportIata?: string;
}

export interface AirTrafficAirportScore {
  iata: string;
  icao: string;
  name: string;
  city: string;
  score: number;
  severity: ThreatLevel;
  activeFlights: number;
  terminalFlights: number;
  anomalyCount: number;
  signals: string[];
  reasons: string[];
}

export interface MilitaryBase {
  id: string;
  name: string;
  type: 'air' | 'navy' | 'army' | 'joint' | 'fortification' | 'other';
  coordinates: [number, number]; // [lng, lat]
  description?: string;
  /** Sous-type enrichi (aeronavale, commandement, fortification, etc.) */
  subtype?: string;
  /** Tier de visibilité (1=zoom 3+, 2=zoom 5+, 3=zoom 8+) */
  tier?: number;
}

export interface RestrictedZone {
  id: string;
  name: string;
  type: 'ZIT' | 'ZRT' | 'ZIA';
  geometry: any; // GeoJSON Polygon
  active: boolean;
  minAltitude?: number;
  maxAltitude?: number;
}

// ═══ Finance (Bourse) ═══

export interface MarketData {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  trend: 'up' | 'down' | 'flat';
  lastUpdated: Date;
  history?: number[];
  category?: 'indices' | 'defense' | 'services';
}

// ═══ Finance (Matières premières) ═══

export interface CommodityData extends Omit<MarketData, 'history' | 'category'> {
  history: number[];  // Required (Omit+redeclaration — TypeScript strict interdit d'affiner un champ optionnel via extends direct)
  category: 'energy' | 'metals' | 'agro';
  unit: string;       // '$/bbl', '$/oz', '$/MMBtu', '¢/bu', '$/lb'
}

// ═══ Pannes Télécoms & Électricité (ARCEP / Enedis) ═══

export interface TelecomOutage {
  id: string;
  operator: string;
  department: string;
  city: string;
  voiceStatus: 'OK' | 'HS' | 'Degraded';
  dataStatus: 'OK' | 'HS' | 'Degraded';
  reason: string;
  coordinates: [number, number]; // [lon, lat]
}

export interface PowerOutage {
  departmentCode: string;
  departmentName: string;
  offGridCount: number;      // Nombre de PDL (Points de Livraison) hors réseau
  totalPDL: number;          // Total PDL (estimation)
  eventCause: string;        // "Tempête Caetano", "Vents violents", "Neige"
  trend: 'stable' | 'improving' | 'worsening';
}

// ═══ Santé / Épidémiologie — ISS (Indice de Stress Sanitaire) ═══

/** Niveaux ISS — nomenclature inspirée du système de vigilance français */
export type ISSLevel = 1 | 2 | 3 | 4;

export interface ISSLevelDef {
  level: ISSLevel;
  range: [number, number];  // [min, max] inclusive
  name: string;              // nom officiel court
  label: string;             // libellé descriptif
  color: string;             // couleur primaire hex
  fillColor: string;         // couleur remplissage carte (avec alpha)
  lineColor: string;         // couleur contour carte
  icon: string;              // emoji/icône
}

export const ISS_LEVELS: readonly ISSLevelDef[] = [
  { level: 1, range: [0, 24], name: 'Sérénité', label: 'Activité sanitaire normale', color: '#2ECC71', fillColor: 'rgba(46,204,113,0.25)', lineColor: '#2ECC71', icon: '🟢' },
  { level: 2, range: [25, 49], name: 'Vigilance', label: 'Surveillance renforcée', color: '#F1C40F', fillColor: 'rgba(241,196,15,0.25)', lineColor: '#F1C40F', icon: '🟡' },
  { level: 3, range: [50, 74], name: 'Alerte', label: 'Tension modérée (accès restreint)', color: '#E67E22', fillColor: 'rgba(230,126,34,0.30)', lineColor: '#E67E22', icon: '🟠' },
  { level: 4, range: [75, 100], name: 'Crise', label: 'Pression élevée, plan blanc', color: '#E74C3C', fillColor: 'rgba(231,76,60,0.35)', lineColor: '#E74C3C', icon: '🔴' },
] as const;

export type APLCategory = 'desert' | 'fragile' | 'bon' | 'surdote' | 'indisponible';

export interface APLLevelDef {
  id: string;
  category: APLCategory;
  label: string;
  color: string;
}

/** 
 * SINGLE SOURCE OF TRUTH for APL classes (Déserts médicaux).
 * Used by map renderer (DeckGLMap) and the map legend (App) 
 * to ensure exact synchronization of colors and logical order.
 */
export const APL_LEVELS: readonly APLLevelDef[] = [
  { id: 'apl-4', category: 'surdote', label: 'Très bonne', color: '#00BCD4' }, // turquoise / cyan
  { id: 'apl-3', category: 'bon', label: 'Moyenne', color: '#1E88E5' }, // bleu moyen
  { id: 'apl-2', category: 'fragile', label: 'Mauvaise (fragile)', color: '#9575CD' }, // violet clair
  { id: 'apl-1', category: 'desert', label: 'Désert', color: '#311B92' }, // violet profond très saturé
] as const;

export interface OscourLevelDef {
  id: string;
  threshold: number;
  label: string;
  color: string;
  radius: number;
}

/** 
 * SINGLE SOURCE OF TRUTH for OSCOUR classes.
 * Used by map renderer (DeckGLMap) and the map legend (App) 
 */
export const OSCOUR_LEVELS: readonly OscourLevelDef[] = [
  {
    id: 'osc-1',
    threshold: 0,
    label: 'Normal / Pas de hausse',
    color: '#BDC3C7',      // gris neutre
    radius: 4,
  },
  {
    id: 'osc-2',
    threshold: 0.05,
    label: 'Hausse modérée (+5%)',
    color: '#F39C12',      // orange
    radius: 8,
  },
  {
    id: 'osc-3',
    threshold: 0.20,
    label: 'Forte hausse (+20%)',
    color: '#FF5252',      // rouge "normal", bien lisible
    radius: 14,
  },
  {
    id: 'osc-4',
    threshold: 0.50,
    label: 'Situation extrême (+50%)',
    color: '#7C4DFF',      // violet électrique très contrasté
    radius: 24,
  },
] as const;


/** Sources de données santé clairement identifiées */
export type HealthDataSource =
  | 'spf-epid'         // Santé Publique France — indicateurs épidémiologiques
  | 'drees'            // DREES — hospitalisations, urgences
  | 'sentinelles'      // Réseau Sentinelles — surveillance syndromique
  | 'ansm'             // ANSM — pénuries médicaments
  | 'sos-medecins'     // SOS Médecins — actes de médecine de ville
  | 'oscour'           // OSCOUR — passages aux urgences
  | 'composite';       // Agrégat multi-sources

/** Métrique départementale — granularité fine pour usage professionnel */
export interface HealthDepartmentMetric {
  depCode: string;               // code INSEE département (01, 2A, 75, 971, …)
  depName: string;
  regionCode: string;            // code INSEE région parent
  regionName: string;

  // ── Indicateurs épidémiologiques ──
  incidenceRate: number;         // taux d'incidence pour 100k (composite)
  hospitalizations: number;      // hospitalisations en cours (toutes pathologies couvertes)
  reanimation: number;           // soins critiques / réanimation
  emergencyVisits: number;       // passages urgences (OSCOUR / SOS Médecins)
  positivityRate: number;        // taux de positivité (%), si disponible

  // ── Détail par source ──
  spfIncidence: number | null;           // SPF : incidence 100k
  spfHospitalizations: number | null;    // SPF : hospitalisations
  spfReanimation: number | null;         // SPF : réanimation
  dreesUrgences: number | null;          // DREES : passages urgences
  sentinellesIncidence: number | null;   // Sentinelles : incidence syndromique 100k

  // ── Axes enrichis: OSCOUR/SOS + désert médical ──
  topMotifs: Array<{
    code: string;
    label: string;
    trendPct: number;
    trendLabel: string;
    network: 'OSCOUR' | 'SOS_MED';
  }>;
  aplIndex: number | null; // Accessibilité Potentielle Localisée (normalisée autour de 1)
  aplCategory: APLCategory;

  // ── Scores ──
  iss: number;                   // Indice de Stress Sanitaire 0-100
  issLevel: ISSLevel;            // Niveau ISS (1-5)
  trend: 'up' | 'down' | 'stable';
  source: HealthDataSource;
  updatedAt: Date;
}

/** Métrique régionale — agrégation des départements */
export interface HealthRegionMetric {
  regionCode: string;            // code INSEE région (11, 24, ...)
  regionName: string;
  incidenceRate: number;         // pour 100k, composite
  spfIncidenceRate: number | null;
  sentinellesIncidenceRate: number | null;
  hospitalizations: number;      // valeur brute
  spfHospitalizations: number | null;
  reanimation: number;
  positivityRate: number;        // %
  iss: number;                   // ISS 0-100 (anciennement healthStressIndex)
  issLevel: ISSLevel;
  /** @deprecated use `iss` */ healthStressIndex: number;
  trend: 'up' | 'down' | 'stable';
  source: HealthDataSource;
  updatedAt: Date;
  /** Nombre de départements avec données dans cette région */
  departmentCount: number;
}

export interface HealthFeatures {
  generatedAt: Date;
  /** ISS national — moyenne pondérée par population */
  nationalISS: number;
  /** @deprecated use `nationalISS` */ nationalHealthStressIndex: number;
  nationalISSLevel: ISSLevel;
  regionalCount: number;
  departmentalCount: number;
  worseningRegions: number;
  improvingRegions: number;
  worseningDepartments: number;
  improvingDepartments: number;
  topRiskRegionCodes: string[];
  topRiskDepartmentCodes: string[];

  sourceStatus: {
    santePubliqueFrance: 'ok' | 'stale' | 'error';
    drees: 'ok' | 'stale' | 'error';
    sentinelles: 'ok' | 'stale' | 'error';
    drugShortages: 'ok' | 'stale' | 'error';
    oscourSos: 'ok' | 'stale' | 'error';
    apl: 'ok' | 'stale' | 'error';
  };

  // ── Sentinelles ──
  sentinellesIndicatorPoints: number;
  sentinellesIndicators: Array<{
    code: string;      // grippe, diarrhee, varicelle
    label: string;
    nationalIncidence: number;
    trend?: number;    // difference with previous week
  }>;

  epidemicAlerts: Array<{
    id: string;
    pathogen: string;
    severity: 'critical' | 'high' | 'warning';
    title: string;
    summary: string;
    locations: string[];
    date: string;
    sourceLabel: string;
    sourceUrl?: string | null;
  }>;

  // ── ANSM Pharmacovigilance ──
  drugShortagesCount: number;
  drugShortagesByStatus: {
    rupture: number;
    tension: number;
    normalisation: number;
    unknown: number;
  };
  drugShortagesLastUpdate: Date | null;
  drugShortagesUrl: string;
  drugShortagesItems: Array<{
    drugName: string;
    status: 'tension' | 'rupture' | 'normalisation' | 'unknown';
  }>;
}

// ═══ Data Freshness & Watchdog ═══

/**
 * Vérité intrinsèque de la donnée exposée par une source.
 *
 * TEMPS_REEL     — flux live mis à jour en continu (< quelques minutes)
 * HISTORIQUE     — agrégats statistiques ou archives (jour/mois/an)
 * CACHE_FIGE     — dernière valeur connue, source injoignable
 * RECONSTRUIT    — calculé / estimé à partir d'autres signaux
 * INDISPONIBLE   — source en échec, aucune donnée servie
 */
export type DataFreshness =
  | 'TEMPS_REEL'
  | 'HISTORIQUE'
  | 'CACHE_FIGE'
  | 'RECONSTRUIT'
  | 'INDISPONIBLE';

/** Labels d'affichage correspondant à chaque DataFreshness */
export const DATA_FRESHNESS_LABELS: Record<DataFreshness, string> = {
  TEMPS_REEL:  'TEMPS RÉEL',
  HISTORIQUE:  'HISTORIQUE',
  CACHE_FIGE:  'CACHE FIGÉ',
  RECONSTRUIT: 'RECONSTRUIT / ESTIMÉ',
  INDISPONIBLE:'INDISPONIBLE',
};

export interface DataSourceStatus {
  name: string;
  lastUpdate: Date | null;
  status: 'ok' | 'stale' | 'error' | 'loading';
  error?: string;
  detail?: string;
  /** Vérité intrinsèque de la donnée (indépendante du statut de fetch) */
  freshness?: DataFreshness;
  // ── Watchdog metrics (optionnels, rétrocompatibles) ──
  lastSuccess?: Date | null;
  lastError?: Date | null;
  cacheAgeMs?: number | null;      // ms depuis le dernier fetch réussi
  fetchCount?: number;             // total de fetches tentés (session)
  failureCount?: number;           // total d'échecs cumulés (session)
  fallbackCount?: number;          // nombre de fallbacks activés (session)
  responseTimeMs?: number | null;  // durée du dernier fetch réussi (ms)
}

/**
 * Événement émis par un service vers le Watchdog.
 * Chaque fetch doit émettre loading → success | failure.
 * Un fallback peut être déclaré indépendamment.
 */
export type WatchdogEvent =
  | { type: 'loading' }
  | { type: 'success'; responseTimeMs?: number; detail?: string }
  | { type: 'failure'; error: string; isFallback?: boolean }
  | { type: 'fallback'; reason: string };

/** Configuration déclarée une fois par service au module load */
export interface WatchdogSourceConfig {
  /** Nom affiché dans StatusPanel */
  label: string;
  /** Délai en ms avant de passer automatiquement à 'stale' (défaut: 10 min) */
  staleAfterMs?: number;
  /** Description fixe (provenance, licence…) affichée sous le nom */
  detail?: string;
  /** Vérité intrinsèque de la donnée servie par cette source */
  freshness?: DataFreshness;
}

/** Snapshot exporté par Watchdog.getSnapshot() */
export interface WatchdogSnapshot {
  sourceId: string;
  status: DataSourceStatus;
}

// ═══ Cache ═══

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

// ═══ Circuit Breaker ═══

export interface CircuitBreakerState {
  failureCount: number;
  cooldownUntil: number;
  isOpen: boolean;
}

// ═══ ISNR (Indice de Stabilité Nationale & Régionale) ═══

export interface ISNRDimensionScores {
  social: number;      // 0-100 : grèves, manifs, blocages
  security: number;    // 0-100 : incidents, interventions
  infra: number;       // 0-100 : météo, crues, pannes
  velocity: number;    // 0-100 : densité articles récents
}

export interface ISNRScore {
  code: string;           // Code département (01-95, 971-976)
  name: string;           // Nom département
  score: number;          // Score global 0-100
  dimensions: ISNRDimensionScores;
  trend: 'up' | 'down' | 'stable';  // Tendance vs période précédente
  eventCount: number;     // Nombre d'événements dans la fenêtre
  lastUpdate: Date;
}

export interface ISNRData {
  scores: ISNRScore[];
  nationalScore: number;
  timestamp: Date;
}

// ═══ Cybersécurité Nationale ═══

export type CyberSeverity = 'low' | 'medium' | 'high' | 'critical';

export type CyberSource = 'CERT-FR' | 'RansomwareLive' | 'NVD';

export interface CyberSourceStatus {
  source: CyberSource;
  isUp: boolean;
  lastSync: string;
  error?: string;
}

export interface CyberAlert {
  id: string;
  title: string;
  severity: CyberSeverity;
  url: string;
  date: string;
  source: CyberSource;
}

export interface CyberRansomwareVictim {
  sector: string;
  count: number;
}

export interface CyberCVE {
  id: string;
  score: number;       // CVSS score 0-10
  target: string;      // affected software/vendor
  description?: string;
  url: string;
}

export interface CyberState {
  meta: {
    globalScore: number;  // 0-100 (baromètre)
    trend: 'rising' | 'stable' | 'falling';
    sources: CyberSourceStatus[];
    lastUpdate: Date;
  };
  alerts: {
    count30d: number;
    latest: CyberAlert[];
  };
  ransomware: {
    total30d: number;
    topSectors: CyberRansomwareVictim[];
  };
  vulnerabilities: {
    criticalCount: number;
    topCVEs: CyberCVE[];
  };
}

// ═══ France Intelligence Card ═══

export interface FranceCountrySignals {
  // News
  criticalNews: number;
  highNews: number;
  topNewsCount: number;      // min(newsItems.length, 20) — used in information axis formula
  // Météo / crues / feux (severe levels only)
  meteoAlerts: number;       // orange | red | violet
  floodAlerts: number;       // orange | red
  fireDetections: number;
  // Transport
  railDisruptions: number;
  railSevere: number;
  roadIncidents: number;
  // Infrastructure
  powerOutages: number;
  telecomOutages: number;
  // Cyber
  cyberAlerts: number;
  cyberCritical: number;
  // Defense / intelligence
  militaryFlights: number;
  maritimeTrafficFrance: number;
  defenseAlerts: number;
  defenseHigh: number;
  jammingSignals: number;
  // Finance (weak signal)
  marketStress: number;
}

export interface FranceCountryAxes {
  troubles: number;    // 0–100 — civil unrest / perturbation
  conflict: number;    // 0–100 — military posture / confrontation
  security: number;    // 0–100 — security severity
  information: number; // 0–100 — multi-source signal pressure
}

export interface FranceBriefContext {
  score: number;
  axes: FranceCountryAxes;
  signals: FranceCountrySignals;
  topHeadlines: string[];              // max 6 normalized titles
  ecowattSignal: string | null;
  meteoMaxLevel: string | null;
  cyberScore: number;
  isnrComponents: { social: number; security: number; infra: number };
  energySummary: FranceIntelEnergySummary | null;
}

export interface FranceCountrySnapshot {
  // Computed by the engine
  signals: FranceCountrySignals;
  axes: FranceCountryAxes;
  score: number;                       // CII 0–100
  briefContext: FranceBriefContext;
  // Raw data for the renderer (mirrors old FranceIntelData fields)
  stability: ISNRData;
  cyber: CyberState;
  meteo: MeteoAlert[];
  topNews: NewsItem[];
  energy: FranceIntelEnergySummary | null;
  timeline: { days: string[]; lanes: FranceIntelTimelineLane[] };
  brief?: string | null;
  briefLang: 'fr' | 'en';
  briefFreshness?: 'fresh' | 'cached';
}

export interface FranceIntelEnergySummary {
  ecowattSignal: EcowattSignal | null;
  totalMw: number | null;
  shares: {
    nuclear: number;
    gas: number;
    hydro: number;
    wind: number;
    solar: number;
    other: number;
  };
  nuclearStress: number | null;
  windGw: number | null;
  windLoadFactor: number | null;
}

export interface FranceIntelTimelineLane {
  key: 'social' | 'security' | 'weather' | 'transport' | 'cyber';
  label: string;
  color: string;
  counts: number[];
}

/** Seuils pour le calcul du score cyber */
export const CYBER_THRESHOLDS = {
  // Alertes CERT-FR
  CERT_CRITICAL_COUNT: 3,     // > 3 critical alerts = max score contrib
  CERT_HIGH_COUNT: 10,        // > 10 high alerts = high contrib
  CERT_WEIGHT: 0.40,          // 40% du score global

  // Ransomware
  RANSOM_HIGH_COUNT: 20,      // > 20 victimes FR/30j = max contrib
  RANSOM_WEIGHT: 0.40,        // 40% du score global

  // CVE
  CVE_CRITICAL_COUNT: 5,      // > 5 CVE critiques = max contrib
  CVE_WEIGHT: 0.20,           // 20% du score global

  // Score plancher si alerte critique CERT-FR
  CRITICAL_FLOOR: 70,
} as const;

/** Couleurs du baromètre cyber */
export const CYBER_SCORE_COLORS = {
  low: { min: 0, max: 33, color: '#10B981', label: 'Vigilance normale' },      // emerald-500
  medium: { min: 34, max: 66, color: '#F59E0B', label: 'Vigilance accrue' },   // amber-500
  high: { min: 67, max: 100, color: '#EF4444', label: 'Alerte cyber' },        // red-500
} as const;

// ═══ AIS Maritime Traffic ═══

export interface AisShipData {
  id: string;
  name: string;
  type: string;
  shipType: number;       // AIS type code (70-79=cargo, 80-89=tanker, 30=fishing, etc.)
  shipCategory: string;   // Legacy category string
  lat: number;
  lon: number;
  speed: number;
  heading: number;
  mmsi: string;
  callSign?: string;
  imoNumber?: number;
  navStatus?: number;
  cog?: number;
  draught?: number;
  dimensions?: {
    a?: number;
    b?: number;
    c?: number;
    d?: number;
    length?: number;
    width?: number;
  };
  eta?: {
    month?: number;
    day?: number;
    hour?: number;
    minute?: number;
  };
  destination?: string;   // Declared destination port
  lastSeen?: number;
  country?: string;         // "ISO2|CountryName" from MMSI MID (e.g. "FR|France")
  trail?: Array<[number, number]>; // Dernières positions [lon, lat] (max 80 points)
}

// ═══ Pannes Internet & BGP (IODA / CAIDA + BGPView) ═══

export interface IodaOutageEvent {
  id: string;
  entityCode: string;        // 'FR', '3215', etc.
  entityName: string;        // 'France', 'Orange France', etc.
  entityType: 'country' | 'asn' | 'region';
  startTime: Date;
  endTime: Date | null;
  duration: number;           // seconds, 0 if ongoing
  score: number;              // IODA severity score (0-100+)
  datasources: string[];      // ['bgp', 'ibr', 'active-probing']
  isOngoing: boolean;
  coordinates: [number, number]; // [lon, lat] for map display
}

export interface IspBgpStatus {
  asn: string;                // e.g. '3215'
  ispName: string;            // 'Orange France'
  prefixCount: number;        // currently visible BGP prefixes
  prefixCountNormal: number;  // baseline prefix count
  visibility: number;         // 0-100 % visibility
  status: 'normal' | 'degraded' | 'outage';
  coordinates: [number, number]; // [lon, lat] ISP HQ
  lastUpdated: Date;
  // Enrichissement OSINT
  trafficEstimation: string | null;  // ex: "100-200 Gbps"
  lookingGlass: string | null;       // URL looking glass
  ixList: string[];                  // noms des IX (France-IX, DE-CIX…)
  peerCount: number;                 // nombre de pairs BGP (v4+v6)
  prefixV4: number;                  // préfixes IPv4 annoncés
  prefixV6: number;                  // préfixes IPv6 annoncés
  networkType: string;               // "Opérateur national", "Cloud"…
  peeringPolicy: string;             // "Open", "Selective", "Restrictive"
  arcepFiber: string | null;         // couverture fibre ARCEP
  mobile: string | null;             // "5G NR", "N/A"
  noc: string | null;                // contact NOC
  ipv6Label: string | null;          // description IPv6
}

export interface NetworkOutageState {
  iodaEvents: IodaOutageEvent[];
  ispStatus: IspBgpStatus[];
  nationalScore: number;       // 0-100 internet health (100 = healthy, 0 = crisis)
  sourcesStatus: {
    ioda: 'ok' | 'stale' | 'error';
    bgpview: 'ok' | 'stale' | 'error';
  };
  lastUpdate: Date;
}

// ═══ Infrastructure Cloud & IXP ═══

export type InfraStatusLevel =
  | 'operational'
  | 'degraded'
  | 'partial'
  | 'outage'
  | 'maintenance'
  | 'unknown';

export interface InfraIncident {
  title: string;
  severity: 'minor' | 'major' | 'critical';
  startedAt: string; // ISO
}

export interface DatacenterStatus {
  id: string;
  name: string;
  provider: string;               // 'OVH' | 'Scaleway' | 'AWS' | 'Google' | 'Cloudflare'
  region: string;                 // 'Roubaix' | 'Paris' | 'eu-west-3' | …
  coordinates: [number, number];  // [lng, lat]
  status: InfraStatusLevel;
  incidents: InfraIncident[];
  lastUpdated: string;            // ISO
}

export interface IxpStatus {
  id: string;
  name: string;
  city: string;
  coordinates: [number, number];
  peersCount: number;
  speedGbps: number;
  status: InfraStatusLevel;
  lastUpdated: string; // ISO
}

export interface CloudflareRadarAnomaly {
  id: string;           // uuid from API
  type: string;         // 'LOCATION' | 'AS' | 'ORIGIN'
  startDate: string;    // ISO
  endDate?: string;
  status: string;       // 'VERIFIED' | 'UNVERIFIED' per Cloudflare Radar API
  locationDetails?: { code: string; name: string };
  asnDetails?: { asn: string; name: string; locations?: { code: string; name: string } };
  originDetails?: { name: string; origin: string };
}

export interface InfraNetworkState {
  datacenters: DatacenterStatus[];
  ixps: IxpStatus[];
  cloudflareAnomalies: CloudflareRadarAnomaly[];
  sourcesStatus: {
    ovh:        'ok' | 'stale' | 'error';
    scaleway:   'ok' | 'stale' | 'error';
    aws:        'ok' | 'stale' | 'error';
    google:     'ok' | 'stale' | 'error';
    cloudflare: 'ok' | 'stale' | 'error';
    peeringdb:  'ok' | 'stale' | 'error';
    radar:      'ok' | 'stale' | 'error';
  };
  lastUpdate: Date;
}

// ═══ ORE Incidents (Electricity/Gas) ═══

export interface OreIncident {
  id: string;
  type: 'electricity' | 'gas';
  nature: string;
  department: string;
  city: string;
  startDate: Date;
  severity: 'critical' | 'high' | 'medium' | 'low';
  coordinates: [number, number]; // [lon, lat]
}

// ═══ Gas Network (EcoGaz + GRTgaz/Teréga) ═══

export type EcoGazSignal = 'green' | 'yellow' | 'orange' | 'red' | 'unknown';

export interface GasTerminal {
  id: string;
  name: string;
  type: 'lng-terminal';
  coordinates: [number, number]; // [lng, lat]
  operator: 'Elengy' | 'Dunkerque LNG';
  capacityGWh: number; // Daily regasification capacity
  currentSendOut?: number; // Current send-out rate (GWh/day)
  utilizationPct?: number; // Utilization percentage
  inventory?: number; // Current LNG stock level
  inventoryCapacity?: number; // Total tank capacity
  inventoryPct?: number; // Fill level of tanks
  status: 'active' | 'maintenance' | 'offline';
}

export interface GasStorage {
  id: string;
  name: string;
  type: 'underground-storage';
  coordinates: [number, number]; // [lng, lat]
  operator: 'Storengy' | 'Terega' | 'Geomethane';
  capacityTWh: number; // Max capacity
  fillLevel: number; // 0-100 percentage
  currentStockTWh?: number; // Absolute stock value
  flowRateGWhDay?: number; // Daily injection/withdrawal rate
  fillTrend: 'filling' | 'stable' | 'withdrawing';
  status: 'active' | 'maintenance';
}

export interface GasInterconnection {
  id: string;
  name: string;
  country: string; // Espagne, Belgique, Allemagne, Suisse
  direction: 'bidirectional' | 'import' | 'export';
  coordinates: [number, number]; // Border point [lng, lat]
  flowGWhDay: number; // Current flow (positive = import, negative = export)
  maxCapacityGWhDay: number;
  entsogKey?: string; // ENTSOG connectionpoint key (ITP-XXXXX)
}

export type GasDirection = 'import' | 'export';

export interface GasInterconnectionFlowStats {
  borderCode:               string;   // ex. 'FR-ES'
  originLabel:              string;   // ex. 'Espagne'
  destinationLabel:         string;   // ex. 'France'
  direction:                GasDirection;
  currentFlowGWhPerDay:     number;   // valeur absolue
  capacityGWhPerDay:        number;
  utilizationPct:           number;
  dailyNetGWh:              number;   // solde jour (>0 = export FR)
  sevenDayNetGWh:           number;   // solde 7 j
  nationalStorageLevelPct:  number;
  storageTrend:             'filling' | 'withdrawing' | 'stable';
  ecogazSignal:             'vert' | 'jaune' | 'orange' | 'rouge';
  updatedAt:                Date;
  sevenDaySeries:           number[]; // GWh/j J-7→J0 (>0=export FR)
}

export interface EcoGazStatus {
  date: string;
  signal: EcoGazSignal;
  message: string;
  forecast: Array<{
    date: string;
    signal: EcoGazSignal;
  }>;
  lastUpdate: Date;
}

export interface GasNetworkState {
  ecogaz: EcoGazStatus;
  terminals: GasTerminal[];
  storages: GasStorage[];
  interconnections: GasInterconnection[];
  nationalStats: {
    totalStorageCapacityTWh: number;
    currentStorageTWh: number;
    averageFillLevel: number;
    storageTrend: 'filling' | 'stable' | 'withdrawing';
    totalImportGWhDay: number;
    totalExportGWhDay: number;
    storageNetFlowGWhDay?: number; // Total national injection(+) or withdrawal(-) from underground storages
  };
  sourceStatus: {
    ecogaz: 'ok' | 'stale' | 'error';
    grtgaz: 'ok' | 'stale' | 'error';
    terega: 'ok' | 'stale' | 'error';
    odre: 'ok' | 'stale' | 'error';
  };
  lastUpdate: Date;
}

// ═══ Pannes Crowd-sourced (Signalements Citoyens) ═══

/**
 * Signalement citoyen d'une panne électrique (crowd-sourced).
 * Agrégé par ville/département — pas d'adresse individuelle (privacy).
 */
export interface CitizenOutageReport {
  id: string;
  source: 'infocoupure' | 'coupure-elec';
  city: string;
  department: string;
  departmentCode: string;
  reportCount: number;         // Nombre de signalements agrégés
  timestamp: Date;
  coordinates: [number, number]; // [lng, lat] — centroïde ville
  type: 'electricity' | 'internet' | 'unknown';
}

/**
 * Zone de panne géographique issue du clustering DBSCAN.
 * GeoJSON Feature<Polygon> avec métadonnées.
 */
export interface OutageZoneProperties {
  clusterId: number;
  density: number;             // Signalements/km²
  totalReports: number;        // Somme des signalements dans la zone
  sources: Array<CitizenOutageReport['source']>;
  severity: 'low' | 'medium' | 'high' | 'critical';
  center: [number, number];    // [lng, lat] centroïde du cluster
  radiusKm: number;
  createdAt: string;           // ISO timestamp
}

export type OutageZone = GeoJSON.Feature<GeoJSON.Polygon, OutageZoneProperties>;
export type OutageZoneCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon, OutageZoneProperties>;

/**
 * Réponse de l'endpoint /api/outages/citizen
 */
export interface CitizenOutageResponse {
  zones: OutageZoneCollection;
  reports: CitizenOutageReport[];
  stats: {
    totalReports: number;
    totalZones: number;
    criticalZones: number;
    sourcesStatus: Record<CitizenOutageReport['source'], 'ok' | 'error' | 'stale'>;
    fetchedAt: string;         // ISO timestamp
  };
}

// ═══ Oil Network (CPDP / Pétrole) ═══

export type OilVigilanceStatus = 'normal' | 'tense' | 'critical' | 'unknown';

export type OilPipelineKind = 'crude' | 'products';

export interface OilPipeline {
  id: string;
  name: string;
  operator: string;
  kind: OilPipelineKind;
  description?: string;
  // GeoJSON geometry loaded separately from oil_pipelines.geojson
}

export interface OilRefinery {
  id: string;
  name: string;
  operator: string;
  capacityMtPerYear: number; // Million tonnes per year
  location: [number, number]; // [lng, lat]
  status: 'active' | 'maintenance' | 'offline';
  region: string;
}

export interface OilDepot {
  id: string;
  name: string;
  role: 'terminal' | 'distribution' | 'strategic';
  location: [number, number]; // [lng, lat]
  capacityM3?: number; // Capacity in cubic meters
  operator?: string;
}

export interface OilProductStock {
  product: string; // 'gazole', 'essence', 'carburéacteur', 'fioul domestique', 'fioul lourd'
  stocksTons: number;
  daysCover: number; // Days of consumption covered
  trend: 'up' | 'down' | 'stable';
}

export type OilFreshnessLevel = 'HYBRID' | 'MONTHLY' | 'STRUCTURAL';

export interface OilFreshnessInfo {
  level: OilFreshnessLevel;
  label: string;
  detail: string;
  asOf?: string;
}

export interface OilStocksSnapshot {
  date: string;
  nationalStocksDays: number; // Total national stock in days of consumption
  totalStocksTons: number;
  byProduct: OilProductStock[];
}

export interface OilFlowsSnapshot {
  netImportTonsPerDay: number; // Positive = net import, negative = net export
  trend: 'up' | 'down' | 'stable';
  importTonsPerDay: number;
  exportTonsPerDay: number;
  consumptionTonsPerDay: number;
}

export interface OilOriginShare {
  label: string;
  volumeMt: number;
  sharePct: number;
  referenceYear?: number;
  sourceLabel?: string;
  partialBreakdown?: boolean;
  breakdown?: Array<{
    label: string;
    volumeMt: number;
    sharePct: number;
  }>;
}

export interface OilMonthlyDelivery {
  title: string;
  periodLabel: string;
  publicationDate?: string;
  sourceLabel?: string;
  roadFuelMillionM3: number | null;
  roadFuelYoYPct: number | null;
  totalProductsMillionTons: number | null;
  totalProductsYoYPct: number | null;
  jetFuelMillionM3: number | null;
  jetFuelYoYPct: number | null;
  gasoilYoYPct: number | null;
  gasolineYoYPct: number | null;
}

export interface OilLocalConsumptionRegion {
  regionCode: string;
  regionName: string;
  roadFuelVolume: number;
}

export interface OilLocalConsumptionSnapshot {
  year: number;
  totalRoadFuelVolume: number;
  topRegions: OilLocalConsumptionRegion[];
  sourceLabel?: string;
}

export interface OilDashboard {
  meta: {
    lastUpdate: string;
    vigilanceScore: number; // 0-100, higher = more tension
    status: OilVigilanceStatus;
    partialData: boolean;
    freshness: {
      dashboard: OilFreshnessInfo;
      deliveries: OilFreshnessInfo;
      infrastructure: OilFreshnessInfo;
    };
  };
  stocks: OilStocksSnapshot;
  flows: OilFlowsSnapshot;
  origins: OilOriginShare[];
  deliveries: OilMonthlyDelivery[];
  localConsumption: OilLocalConsumptionSnapshot | null;
  refineries: OilRefinery[];
  depots: OilDepot[];
  sourceStatus: {
    sdes: 'ok' | 'stale' | 'error';
    insee: 'ok' | 'stale' | 'error';
    cpdp: 'ok' | 'stale' | 'error';
    monthlyConsumption: 'ok' | 'stale' | 'error';
    localConsumption: 'ok' | 'stale' | 'error';
    pipelines: 'ok' | 'stale' | 'error';
  };
}

// ═══ Fuel Tension (Prix Carburants) ═══

export type FuelType = 'gazole' | 'sp95' | 'sp98' | 'e10';

export type FuelTensionLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type FuelTensionBadge = 'LIVE' | 'QUASI-LIVE' | 'NO_DATA';

export interface FuelFreshness {
  timestamp: string | null;
  ageMinutes: number | null;
  badge: FuelTensionBadge;
}

export interface FuelStationFuelStatus {
  fuelType: FuelType;
  label: string;
  price: number | null; // EUR/L
  updatedAt: string | null;
  updateAgeMinutes: number | null;
  ruptureType: 'temporaire' | 'definitive' | null;
  available: boolean;
}

export interface FuelStation {
  id: string;
  departmentCode: string;
  departmentName: string;
  city: string;
  address?: string;
  location: [number, number] | null;
  fetchedAt: string;
  fuels: Partial<Record<FuelType, FuelStationFuelStatus>>;
}

export interface FuelTensionSignal {
  departmentCode: string;
  departmentName: string;
  fuelType: FuelType;
  avgPrice: number | null; // EUR/L
  deltaPrice7d: number | null; // cents/L
  stationCount: number;
  anomalyShare: number; // percent
  avgUpdateAgeMinutes: number | null;
  tensionLevel: FuelTensionLevel;
  dataFreshness: FuelFreshness;
}

export interface FuelTensionDepartmentSummary {
  departmentCode: string;
  departmentName: string;
  stationCount: number;
  anomalyShare: number; // percent
  avgUpdateAgeMinutes: number | null;
  deltaPrice7d: number | null; // cents/L, mean of comparable fuels
  maxDeltaPrice7d: number | null; // cents/L
  tensionLevel: FuelTensionLevel;
  freshness: FuelFreshness;
  fuelSignals: FuelTensionSignal[];
}

export interface FuelTensionNationalSummary {
  stationCount: number;
  departmentCount: number;
  anomalyShare: number; // percent
  avgUpdateAgeMinutes: number | null;
  medianUpdateAgeMinutes: number | null;
  avgPrices: Partial<Record<FuelType, number>>;
  topDepartments: FuelTensionDepartmentSummary[];
}

export interface FuelTensionDashboard {
  generatedAt: string;
  departments: string[];
  signals: FuelTensionSignal[];
  summaries: FuelTensionDepartmentSummary[];
  national: FuelTensionNationalSummary;
  sourceStatus: 'ok' | 'stale' | 'error';
  degraded: boolean;
  sourceLabel: string;
  coverageLabel: string;
  disclaimerFr: string;
  disclaimerEn?: string;
  errorMessage?: string;
}

// ═══ GPS Jamming / Guerre Électronique ═══

/**
 * Signal OSINT de suspicion de brouillage GPS, construit à partir d'anomalies ADS-B.
 * Ce n'est pas une preuve de brouillage — c'est un signal heuristique plausible.
 *
 * Timestamp en secondes Unix (cohérent avec MilitaryFlight.lastContact).
 * Position en [lng, lat] (convention GeoJSON du projet).
 */
export interface GpsJammingSignal {
  id: string;                    // jamming-${ts}-${idx}
  position: [number, number];    // [lng, lat] centroïde de la zone suspectée
  timestamp: number;             // Unix seconds
  severity: ThreatLevel;         // 'high' | 'medium' | 'low'
  confidence: number;            // 0.0–1.0
  reasons: string[];             // indicateurs déclencheurs lisibles
  affectedIcao24s: string[];     // codes ICAO24 (hex) des aéronefs impliqués
  clusterRadius?: number;        // km — rayon de la zone, si signal multi-aéronefs
}

// ═══ AIS Anomalies ═══

export interface AisAnomaly {
    id: string;                          // silence-${mmsi}-${ts} | rendez-${mmsiA}-${mmsiB}-${ts}
    type: 'radio_silence' | 'rendezvous';
    // severity : radio_silence militaire → 'high', radio_silence risque → 'medium', rendezvous → 'medium'
    severity: ThreatLevel;
    position: [number, number];          // [lng, lat] — lastSeenPos pour silence, centroïde pour rendezvous
    timestamp: number;                   // Unix milliseconds (Date.now())
    mmsis: string[];                     // 1 MMSI pour silence, 2 pour rendezvous
    description: string;                 // Texte FR pour toast, ex: "Silence radio · Dixmude · 14 min"
}
