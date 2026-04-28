/**
 * App.ts — Orchestrateur principal de France Monitor.
 * Phase 2 : pipeline RSS réel + classifier + géocodeur.
 */

import { MapContainer } from './components/MapContainer.ts';
import { MapPopup } from './components/MapPopup.ts';
import { MapLegend, type LegendCategory } from './components/MapLegend.ts';
import { UnderMapNewsFeed } from './components/UnderMapNewsFeed.ts';
import { StatusPanel } from './components/StatusPanel.ts';
import type { SearchModal } from './components/SearchModal.ts';
import { EnvironmentPanel } from './components/EnvironmentPanel.ts';
import { EnergyPanel } from './components/EnergyPanel.ts';
import { TransportPanel } from './components/TransportPanel.ts';
import { FiresPanel } from './components/FiresPanel.ts';
import { TrafficPanel } from './components/TrafficPanel.ts';
import { FinancePanel } from './components/FinancePanel.ts';
import { MarketStrip } from './components/MarketStrip.ts';
import { CommodityStrip } from './components/CommodityStrip.ts';
import { fetchCommodityData } from './services/commodities.ts';
import { ISNRPanel } from './components/ISNRPanel.ts';
import { CyberPanel } from './components/CyberPanel.ts';
import type { FranceIntelPanel } from './components/FranceIntelPanel.ts';
import { fetchFranceIntelBrief } from './services/france-intel-brief.ts';
import {
  buildFranceCountrySnapshot as buildFranceEngine,
  type FranceRawData,
} from './services/france-country-intel.ts';
import type { FranceCountrySnapshot, FranceIntelTimelineLane } from './types/index.ts';
import { GasPanel } from './components/GasPanel.ts';
import { HydraulicPanel } from './components/HydraulicPanel.ts';
import { EolienPanel } from './components/EolienPanel.ts';
import { OilPanel } from './components/OilPanel.ts';
import { DayNightPanel } from './components/DayNightPanel.ts';
import { OutagesPanel } from './components/OutagesPanel.ts';
import { DefensePanel } from './components/DefensePanel.ts';
import { NationalHealthPanel } from './components/NationalHealthPanel.ts';
import { HealthBarometerPanel } from './components/HealthBarometerPanel.ts';
import { MaritimePanel } from './components/MaritimePanel.ts';
import { BarometerWidget } from './components/BarometerWidget.ts';
import type { SentinelModal } from './components/SentinelModal.ts';
import type { RightSidebar } from './components/RightSidebar.ts';
import { fetchNetworkBarometer, setBarometerEolienLive } from './services/network-barometer.ts';
import { LayerPanel } from './components/LayerPanel.ts';
import { computeISNR } from './services/stability-index.ts';
import { ALL_INFRASTRUCTURE, NUCLEAR_PLANTS } from './config/infrastructure.ts';
import { RESTRICTED_ZONES, detectMilitarySurges, type MilitarySurge } from './config/military.ts';
import { ACTIVE_INSTALLATIONS } from './config/military-bases-db.ts';
import { loadStaticOsmFeatures, mergeWithStaticDb } from './services/military-osm.ts';

import { fetchMilitaryFlights } from './services/military-flights.ts';
import { detectGpsJammingSignals } from './services/gps-jamming.ts';
import { AIS_RELAY_URL, getAisStatus, getMilitaryShips, getAllLiveTraffic, NAVY_MMSI_SET, onFirstAisData } from './services/military-ships.ts';
import { connectAis } from './services/ais-connection.ts';
import { detectAisAnomalies } from './services/ais-anomalies.ts';
import { detectCableThreats, militaryShipToAIS, type DefenseAlert } from './services/cable-threats.ts';
import { ALL_FEEDS } from './config/feeds.ts';
import { VIEW_PRESETS } from './config/geo.ts';
import { fetchAllFeeds } from './services/rss.ts';
import { classifyByKeywords } from './services/classifier.ts';
import { classifyWithAI } from './services/ai-classifier.ts';
import { summarizeWithFallback } from './services/summarization.ts';
import { geocodeNewsItem } from './services/geocoder.ts';
import { fetchEcowatt } from './services/ecowatt.ts';
import { fetchEnergyRegions, fetchBorderHistory } from './services/energy-regions.ts';
import { fetchMetropoles } from './services/metropoles.ts';
import { fetchHospitalsData } from './services/hospitals.ts';
import { fetchVigilanceMeteo, fetchVigilanceTimeline, type VigilanceTimeline } from './services/vigilance-meteo.ts';
import { fetchVigicrues } from './services/vigicrues.ts';
import { fetchSncfDisruptions, buildRailNetworkData } from './services/transport.ts';
import { buildHydraulicBackboneAssets } from './services/hydraulic-backbone.ts';
import { fetchHydraulicHydrometrySnapshot, type HydraulicHydrometrySnapshot } from './services/hubeau-hydrometry.ts';
import { EolienTracker } from './services/eolien/eolien-tracker.ts';

import { fetchFiresData } from './services/fires.ts';
import { fetchTrafficIncidents, hasFreshTrafficIncidentCache, type TrafficIncident } from './services/traffic.ts';
import { fetchAirTrafficSnapshot } from './services/air-traffic.ts';
import { fetchMarketData } from './services/finance.ts';
import { fetchTelecomOutages, fetchPowerOutages, getPowerOutagesMeta, lastArcepDataDate } from './services/outages.ts';
import { fetchOutageZoneCollection } from './services/outages-scraper.ts';
import { fetchRTEIIPIncidents } from './services/rte-iip.ts';
import { fetchNuclearUnavailabilities, buildNuclearColorMap } from './services/nuclear-rte.ts';
import { buildNuclearState } from './services/nuclear-correlation.ts';
import { NuclearPanel } from './components/NuclearPanel.ts';
import { SituationMonitor } from './components/SituationMonitor.ts';
import { SituationHistoryPanel } from './components/SituationHistoryPanel.ts';
import { pushHistorySnapshot } from './services/situation-history.ts';
import { AlertMonitor } from './components/AlertMonitor.ts';
import type { NuclearState, NuclearUnavailability, InfrastructurePoint } from './types/index.ts';
import { fetchNetworkOutages } from './services/internet-outages.ts';
import { fetchSpaceWeather, computeTerminatorGeoJSON } from './services/space-weather.ts';
import { fetchInfraNetwork } from './services/infra-network.ts';
import { fetchHealthData } from './services/health.ts';
import { computeHealthBarometer } from './services/health-barometer.ts';
import type { HealthBarometerMetrics } from './services/health-barometer.ts';
import { fetchCyberDashboard, isCyberPanelEnabled } from './services/cyber.ts';
import { fetchGasNetwork, isGasPanelEnabled } from './services/gas.ts';
import { fetchOilDashboard, isOilPanelEnabled } from './services/oil.ts';
import { buildDegradedFuelTensionDashboard, fetchFuelTensionDashboard } from './services/fuel-tension.ts';
import { computeSentinellesBarometerFromIndicators } from './services/sentinellesService.ts';
import { computeFloodSegmentBbox } from './services/copernicus.ts';
import { readUrlState, writeUrlState } from './utils/urlState.ts';
import { loadNewsFromCache, saveNewsToCache } from './utils/newsCache.ts';
import type { NewsItem, FilterState, FuelTensionDashboard, MapLayers, MeteoAlert, EcowattResponse, TransportDisruption, FloodSegment, ISNRData, LayerConfig, CyberState, OilDashboard, PowerOutage, NetworkOutageState, InfraNetworkState, TelecomOutage, EventCategory, AisAnomaly, RailNetworkData, HydraulicBackboneAsset, MarketData, HealthFeatures, GpsJammingSignal, DetectedSituation, SituationSeverity, ThreatLevel } from './types/index.ts';
import { APL_LEVELS, OSCOUR_LEVELS } from './types/index.ts';
import { fetchISNRSynthesis, type NuclearBriefingContext, type EolienBriefingContext, type OilBriefingContext } from './services/isnr-synthesis.ts';
import type { EolienLive, EolienParkSummary } from './services/eolien/types.ts';
import { Watchdog } from './services/watchdog.ts';


// ─── Polling intervals (ms) ─────────────────────────────────────────────────
// Single source of truth for every setInterval cadence in this file.
// Tune here — never scatter magic numbers near each setInterval call.
const RSS_POLL_INTERVAL_MS             =  5 * 60_000; //  5 min
const POLL_FINANCE_MS                  =  5 * 60_000; //  5 min  (market data + nuclear snapshot)
const POLL_NUCLEAR_MS                  = 15 * 60_000; // 15 min  (RTE real-time unavailabilities)
const POLL_OIL_MS                      = 10 * 60_000; // 10 min  (oil stocks / refinery flows)
const POLL_COMMODITIES_MS              = 15 * 60_000; // 15 min
const POLL_AIR_TRAFFIC_MS              = 12_000;       // 12 s    (IATA feed latency)
const POLL_HEALTH_MS                   = 15 * 60_000; // 15 min  (ISS / SOS Médecins metrics)
const POLL_HYDRAULIC_MS                = 10 * 60_000; // 10 min  (hydrometrics + barrage signals)
const POLL_EOLIEN_MS                   =  5 * 60_000; //  5 min  (RTE éolien temps-réel)
const POLL_NETWORK_BAROMETER_MS        =  5 * 60_000; //  5 min
const POLL_SPACE_WEATHER_TERMINATOR_MS =     60_000;  //  1 min  (terminator drifts ~0.25°/min)
const POLL_SPACE_WEATHER_REFRESH_MS    = 15 * 60_000; // 15 min

const ALERT_MONITOR_LIMIT = 2;
const ALERT_MONITOR_TTLS_MS = {
  NEWS_ALERT: 20 * 60_000,
  MILITARY_SURGE_ALERT: 10 * 60_000,
  WEATHER_ALERT: 30 * 60_000,
  AIS_ANOMALY_ALERT: 30 * 60_000,
  DEFENSE_ALERT: 15 * 60_000,
  GPS_JAMMING_ALERT: 10 * 60_000,
} as const;

const SITUATION_SEVERITY_SCORE: Record<SituationSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  watch: 1,
};

const METEO_RISK_LABELS: Record<string, string> = {
  wind: 'vent',
  'rain-flood': 'pluie-inondation',
  thunderstorm: 'orages',
  flood: 'crues',
  'snow-ice': 'neige-verglas',
  heat: 'canicule',
  cold: 'grand froid',
  avalanche: 'avalanches',
  'wave-surge': 'vagues-submersion',
};

function truncateLabel(value: string, maxLength = 96): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function sortSituations(items: DetectedSituation[]): DetectedSituation[] {
  return [...items].sort((a, b) => {
    const severityDelta = SITUATION_SEVERITY_SCORE[b.severity] - SITUATION_SEVERITY_SCORE[a.severity];
    if (severityDelta !== 0) return severityDelta;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
}

function threatLevelToSituationSeverity(level?: ThreatLevel): SituationSeverity {
  if (level === 'critical') return 'critical';
  if (level === 'high') return 'high';
  if (level === 'medium') return 'medium';
  return 'watch';
}

function defenseSeverityToSituationSeverity(level: DefenseAlert['severity']): SituationSeverity {
  if (level === 'high') return 'critical';
  if (level === 'medium') return 'high';
  return 'medium';
}

function getAlertMonitorExpiry(alert: DetectedSituation, nowMs: number): number {
  switch (alert.type) {
    case 'AIS_ANOMALY_ALERT':
      return alert.updatedAt.getTime() + ALERT_MONITOR_TTLS_MS.AIS_ANOMALY_ALERT;
    case 'NEWS_ALERT':
      return nowMs + ALERT_MONITOR_TTLS_MS.NEWS_ALERT;
    case 'MILITARY_SURGE_ALERT':
      return nowMs + ALERT_MONITOR_TTLS_MS.MILITARY_SURGE_ALERT;
    case 'WEATHER_ALERT':
      return nowMs + ALERT_MONITOR_TTLS_MS.WEATHER_ALERT;
    case 'DEFENSE_ALERT':
      return nowMs + ALERT_MONITOR_TTLS_MS.DEFENSE_ALERT;
    case 'GPS_JAMMING_ALERT':
      return nowMs + ALERT_MONITOR_TTLS_MS.GPS_JAMMING_ALERT;
    default:
      return nowMs + 10 * 60_000;
  }
}

function summarizeNuclearPlantForMap(
  plantName: string,
  installedCapacityMW: number,
  unavailabilities: NuclearUnavailability[],
): {
  availableMW: number;
  availabilityRatio: number;
  status: 'active' | 'maintenance' | 'shutdown';
  notes?: string;
} {
  const now = Date.now();
  const activeUnits = unavailabilities.filter(
    (u) =>
      normalizePlantKey(u.plantName) === normalizePlantKey(plantName) &&
      u.startDate.getTime() <= now &&
      (u.endDate === null || u.endDate.getTime() >= now),
  );

  if (activeUnits.length === 0) {
  return {
      availableMW: installedCapacityMW,
      availabilityRatio: installedCapacityMW > 0 ? 1 : 0,
      status: 'active',
    };
  }

  const unavailableMW = activeUnits.reduce(
    (sum, u) => sum + Math.max(0, u.nominalPowerMW - u.availablePowerMW),
    0,
  );
  const availableMW = Math.max(0, installedCapacityMW - unavailableMW);
  const availabilityRatio = installedCapacityMW > 0 ? availableMW / installedCapacityMW : 0;
  const impactedUnits = activeUnits
    .map((u) => `${u.unitName} (${u.status === 'OUTAGE_UNPLANNED' ? 'arrêt fortuit' : u.status === 'OUTAGE_PLANNED' ? 'arrêt programmé' : 'réduit'})`)
    .join(' · ');

  return {
    availableMW,
    availabilityRatio,
    status: 'maintenance',
    notes: impactedUnits ? `Tranches impactées : ${impactedUnits}` : undefined,
  };
}

function buildNuclearInfrastructurePoints(
  unavailabilities: NuclearUnavailability[] = [],
): InfrastructurePoint[] {
  const colorMap = buildNuclearColorMap(unavailabilities);

  return NUCLEAR_PLANTS
    .filter((p) => p.status !== 'shutdown')
    .map((p) => {
      const summary = summarizeNuclearPlantForMap(p.name, p.capacity ?? 0, unavailabilities);
      return {
        ...p,
        colorOverride: colorMap[p.name] ?? '#6B7280',
        totalPower: p.capacity ?? 0,
        totalAvailable: summary.availableMW,
        globalAvailability: summary.availabilityRatio,
        status: summary.status,
        notes: summary.notes ?? p.notes,
      };
    });
}

function buildEnergyInfrastructurePoints(
  unavailabilities: NuclearUnavailability[] = [],
): InfrastructurePoint[] {
  const gasInfra = ALL_INFRASTRUCTURE.filter((p) => p.type === 'gas-terminal' || p.type === 'gas-storage');
  return [...buildNuclearInfrastructurePoints(unavailabilities), ...gasInfra];
}

function buildOilBriefingContext(
  oilData: OilDashboard | null,
  fuelTension: FuelTensionDashboard | null,
): OilBriefingContext | undefined {
  if (!oilData && !fuelTension) return undefined;

  const topDepartments = fuelTension?.national.topDepartments
    ?.slice(0, 3)
    .map((summary) => `${summary.departmentName} (${summary.tensionLevel})`)
    ?? [];

  return {
    structuralStatus: oilData?.meta.status ?? 'unknown',
    structuralScore: oilData?.meta.vigilanceScore ?? null,
    nationalStocksDays: oilData?.stocks.nationalStocksDays ?? null,
    monthlyRoadFuelYoYPct: oilData?.deliveries?.[0]?.roadFuelYoYPct ?? null,
    fuelTensionCoverage: fuelTension?.coverageLabel ?? null,
    fuelTensionLevel: fuelTension?.national.tensionLevel ?? null,
    fuelTensionAnomalyShare: fuelTension?.national.anomalyShare ?? null,
    fuelTensionAvgUpdateAgeMinutes: fuelTension?.national.avgUpdateAgeMinutes ?? null,
    fuelTensionTopDepartments: topDepartments,
    fuelTensionStationCount: fuelTension?.national.stationCount ?? null,
  };
}

function normalizePlantKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function buildNuclearBriefingContext(state: NuclearState | null): NuclearBriefingContext | undefined {
  if (!state || !state.stress) {
    return undefined;
  }

  const now = Date.now();
  const activeUnavailabilities = state.unavailabilities.filter(
    (item) =>
      item.startDate.getTime() <= now &&
      (item.endDate === null || item.endDate.getTime() >= now),
  );
  const affectedSites = Array.from(
    new Set(activeUnavailabilities.map((item) => item.plantName).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, 'fr'));

  return {
    rteAvailable: state.rteAvailable,
    availableCapacityMW: state.stress.availableCapacityMW ?? null,
    installedCapacityMW: state.stress.installedCapacityMW ?? null,
    unplannedOutageCount: activeUnavailabilities.filter((item) => item.status === 'OUTAGE_UNPLANNED').length,
    plannedOutageCount: activeUnavailabilities.filter((item) => item.status === 'OUTAGE_PLANNED').length,
    reducedCount: activeUnavailabilities.filter((item) => item.status === 'REDUCED').length,
    affectedSites,
    gridTensionRisk: state.stress.gridTensionRisk,
    remitUnconfirmedCount: state.unconfirmedSignals.length,
  };
}

// Default layer visibility (alerts remain implicitly enabled)
const DEFAULT_LAYERS: MapLayers = {
  newsGroup: false,
  news: false,
  alerts: true,
  energySystems: false,
  powerGrid: false,
  hydroBackbone: false,
  windMonitor: false,
  health: false,
  healthOscour: false,
  healthApl: false,
  hospitals: false,
  environmentGroup: false,
  environmental: false,
  weatherRadar: false,
  fires: false,
  traffic: false,
  trafficRoad: false,
  trafficMaritime: false,
  trafficAir: false,
  trafficRail: false,
  metroLoad: false,
  sovereignty: false,
  military: false,
  subseaCables: false,
  outages: false,
  outagesElec: false,
  outagesTelecom: false,
  outagesInternet: false,
  outagesCloud: false,
  stability: false,
  cyber: false,
  gasNetwork: false,
  oilNetwork: false,
  nuclearFleet: false,
  dayNight: false,
};

const ENERGY_SYSTEM_LAYER_KEYS: Array<
  'powerGrid' |
  'hydroBackbone' |
  'gasNetwork' |
  'oilNetwork' |
  'windMonitor' |
  'metroLoad' |
  'nuclearFleet'
> = [
  'powerGrid',
  'hydroBackbone',
  'gasNetwork',
  'oilNetwork',
  'windMonitor',
  'metroLoad',
  'nuclearFleet',
];

function hasActiveEnergySystems(layers: Pick<MapLayers, typeof ENERGY_SYSTEM_LAYER_KEYS[number] | 'energySystems'>): boolean {
  return ENERGY_SYSTEM_LAYER_KEYS.some((key) => layers[key]);
}

const HEALTH_ISS_LEGEND: LegendCategory = {
  id: 'health',
  title: 'Santé — ISS (Stress Sanitaire)',
  type: 'gradient',
  items: [],
  gradientColors: ['#2ECC71', '#F1C40F', '#E67E22', '#E74C3C'],
  gradientMin: 'Sérénité (0)',
  gradientMax: 'Crise (100)',
  source: {
    label: 'Santé publique France / Composite',
    year: new Date().getFullYear(),
  },
  refresh: {
    label: 'Mise à jour quotidienne'
  }
};


const HEALTH_APL_LEGEND: LegendCategory = {
  id: 'healthApl',
  title: 'Santé — APL (Déserts médicaux)',
  items: APL_LEVELS.map(level => ({
    id: level.id,
    label: level.label,
    color: level.color,
    shape: 'square'
  })),
  source: {
    label: 'DREES',
    url: 'https://data.drees.solidarites-sante.gouv.fr/explore/dataset/accessibilite-potentielle-localisee-apl-aux-medecins-generalistes/',
    year: '2023',
  },
  refresh: {
    label: 'Mise à jour annuelle (structurelle)'
  }
};




const HEALTH_OSCOUR_LEGEND: LegendCategory = {
  id: 'healthOscour',
  title: 'Santé — Urgences / SOS Médecins',
  items: OSCOUR_LEVELS.map(level => ({
    id: level.id,
    label: level.label,
    color: level.color,
    shape: 'circle'
  })),
  source: {
    label: 'Santé publique France – SURSAUD',
    url: 'https://geodes.santepubliquefrance.fr/',
    year: new Date().getFullYear(),
  },
  refresh: {
    label: 'Données quotidiennes (J-1)'
  }
};

const HOSPITALS_LEGEND: LegendCategory = {
  id: 'hospitals',
  title: 'Infrastructures Hospitalières',
  items: [
    { id: 'chu', label: 'Sous tension (CHU)', color: '#F4D03F', shape: 'circle' },
    { id: 'ch', label: 'Capacité normale (CH / Clinique)', color: '#1ABC9C', shape: 'circle' }
  ],
  source: {
    label: 'FINESS / data.gouv',
  },
  refresh: {
    label: 'Mise à jour annuelle (structurelle)'
  }
};

const ROAD_TRAFFIC_LEGEND: LegendCategory = {
  id: 'trafficRoad',
  title: 'Trafic routier',
  items: [
    { id: 'road-high', label: 'Incident fort', color: '#ff5050', shape: 'circle' },
    { id: 'road-medium', label: 'Incident modéré', color: '#ffaa00', shape: 'circle' },
    { id: 'road-low', label: 'Incident faible', color: '#ffdc50', shape: 'circle' },
  ],
  source: {
    label: 'TomTom',
    year: new Date().getFullYear(),
  },
  refresh: {
    label: 'Environ 5 min'
  }
};

const ENVIRONMENTAL_LEGEND: LegendCategory = {
  id: 'environmental',
  title: 'Météo / Crues',
  columns: 2,
  splitIndex: 4,
  items: [
    { id: 'env-weather-header', label: 'Météo-France', color: '#9898a8', isHeader: true },
    { id: 'env-weather-red', label: 'Vigilance météo rouge', color: '#EF4444', shape: 'zone', borderColor: '#FCA5A5' },
    { id: 'env-weather-orange', label: 'Vigilance météo orange', color: '#F59E0B', shape: 'zone', borderColor: '#FCD34D' },
    { id: 'env-weather-yellow', label: 'Vigilance météo jaune', color: '#EAB308', shape: 'zone', borderColor: '#FDE68A' },
    { id: 'env-flood-header', label: 'Vigicrues', color: '#9898a8', isHeader: true },
    { id: 'env-flood-red', label: 'Tronçon en vigilance rouge', color: '#EF4444', icon: '━', iconSize: 18 },
    { id: 'env-flood-orange', label: 'Tronçon en vigilance orange', color: '#F59E0B', icon: '━', iconSize: 18 },
    { id: 'env-flood-yellow', label: 'Tronçon en vigilance jaune', color: '#EAB308', icon: '━', iconSize: 18 },
  ],
  source: {
    label: 'Météo-France · Vigicrues',
  },
  refresh: {
    label: 'Environ 15 min'
  },
  notes: [
    'Météo-France = vigilance par département.',
    'Vigicrues = vigilance par tronçon de cours d’eau.',
  ],
};

const WEATHER_RADAR_LEGEND: LegendCategory = {
  id: 'weatherRadar',
  title: 'Radar météo',
  items: [
    { id: 'weather-radar-light', label: 'Précipitations faibles', color: '#4FC3F7', shape: 'square' },
    { id: 'weather-radar-moderate', label: 'Précipitations modérées', color: '#8BC34A', shape: 'square' },
    { id: 'weather-radar-heavy', label: 'Précipitations fortes', color: '#FF9800', shape: 'square' },
    { id: 'weather-radar-intense', label: 'Cellules intenses', color: '#E53935', shape: 'square' },
  ],
  source: {
    label: 'RainViewer radar mosaic',
  },
  refresh: {
    label: 'Environ 10 min'
  },
  notes: [
    'Overlay raster pluie/précipitations.',
    'Masqué aux gros zooms pour éviter une lecture trompeuse.',
    'À lire avec la vigilance Météo-France pour qualifier le risque régional.',
  ],
};

const NEWS_LEGEND: LegendCategory = {
  id: 'news',
  title: 'Actualites',
  columns: 2,
  splitIndex: 6,
  items: [
    { id: 'news-severity-header', label: 'Niveau', color: '#9898a8', isHeader: true },
    { id: 'news-critical', label: 'Critique', color: '#ff2d55', shape: 'circle' },
    { id: 'news-high', label: 'Eleve', color: '#ff6b35', shape: 'circle' },
    { id: 'news-medium', label: 'Modere', color: '#ffcc00', shape: 'circle' },
    { id: 'news-low', label: 'Faible', color: '#34c759', shape: 'circle' },
    { id: 'news-info', label: 'Information', color: '#5ac8fa', shape: 'circle' },
    { id: 'news-clusters-header', label: 'Clusters', color: '#9898a8', isHeader: true },
    { id: 'news-cluster-small', label: '< 5 articles', color: '#94a3b8', icon: '●', iconSize: 12 },
    { id: 'news-cluster-medium', label: '5 a 14 articles', color: '#94a3b8', icon: '●', iconSize: 16 },
    { id: 'news-cluster-large', label: '15 a 49 articles', color: '#94a3b8', icon: '●', iconSize: 20 },
    { id: 'news-cluster-xlarge', label: '50+ articles', color: '#94a3b8', icon: '●', iconSize: 24 },
  ],
  source: {
    label: 'RSS PQR / geocodage local / classification hybride',
  },
  refresh: {
    label: 'Environ 5 min'
  },
  notes: [
    'Couleur = niveau de gravite.',
    'Taille du cluster = nombre d articles agreges.',
  ],
};

const MARITIME_TRAFFIC_LEGEND: LegendCategory = {
  id: 'trafficMaritime',
  title: 'Trafic maritime',
  columns: 2,
  items: [
    { id: 'sea-cargo',     label: 'Cargo',          color: '#4ade80', shape: 'vessel' },
    { id: 'sea-tanker',    label: 'Pétrolier',      color: '#60a5fa', shape: 'vessel' },
    { id: 'sea-passenger', label: 'Passagers',      color: '#f97316', shape: 'vessel' },
    { id: 'sea-fishing',   label: 'Pêche',          color: '#facc15', shape: 'vessel' },
    { id: 'sea-tug',       label: 'Remorqueur/SAR', color: '#a855f7', shape: 'vessel' },
    { id: 'sea-sailing',   label: 'Voilier',        color: '#06b6d4', shape: 'vessel' },
    { id: 'sea-highspeed', label: 'Grande vitesse', color: '#f472b6', shape: 'vessel' },
    { id: 'sea-unknown',   label: 'Inconnu',        color: '#94a3b8', shape: 'vessel' },
  ],
  source: {
    label: 'AIS · aisstream.io',
    year: new Date().getFullYear(),
  },
  refresh: {
    label: 'Temps réel WebSocket'
  }
};

const AIR_TRAFFIC_LEGEND: LegendCategory = {
  id: 'trafficAir',
  title: 'Trafic aérien civil',
  columns: 2,
  items: [
    { id: 'air-low', label: 'Très bas (< 5k ft)', color: '#ff7832', icon: '✈' },
    { id: 'air-mid', label: 'Bas / montée (5–15k)', color: '#ffd232', icon: '✈' },
    { id: 'air-upper-mid', label: 'Intermédiaire (15–25k)', color: '#82e650', icon: '✈' },
    { id: 'air-cruise', label: 'Croisière (25–35k)', color: '#32c8ff', icon: '✈' },
    { id: 'air-high', label: 'Très haut (> 35k)', color: '#8264ff', icon: '✈' },
  ],
  source: {
    label: 'OpenSky / airplanes.live',
    year: new Date().getFullYear(),
  },
  refresh: {
    label: 'Quasi temps réel'
  }
};


const MILITARY_LEGEND: LegendCategory = {
  id: 'military',
  title: 'Défense — Activité Militaire',
  columns: 2,
  items: [
    // Types d'aéronefs (icône ✈)
    { id: 'fighter', label: 'Chasseur', color: '#ff3b30', shape: 'circle', icon: '✈' },
    { id: 'transport', label: 'Transport', color: '#4a9eff', shape: 'circle', icon: '✈' },
    { id: 'tanker', label: 'Ravitailleur', color: '#ff9500', shape: 'circle', icon: '✈' },
    { id: 'awacs', label: 'AWACS / ISR', color: '#a855f7', shape: 'circle', icon: '✈' },
    { id: 'patrol', label: 'Patrouille maritime', color: '#00d4c8', shape: 'circle', icon: '✈' },
    { id: 'helicopter', label: 'Hélicoptère', color: '#22c55e', shape: 'circle', icon: '✈' },
    { id: 'drone', label: 'Drone / UAV', color: '#ff6b9d', shape: 'circle', icon: '✈' },
    { id: 'trainer', label: 'Entraînement', color: '#ffcc00', shape: 'circle', icon: '✈' },
    { id: 'liaison', label: 'Liaison', color: '#9898a8', shape: 'circle', icon: '✈' },
    // Bases (triangles ▲)
    { id: 'base-air', label: 'Base aérienne', color: '#4a9eff', shape: 'triangle' },
    { id: 'base-navy', label: 'Base navale', color: '#00d4c8', shape: 'triangle' },
    { id: 'base-army', label: 'Base terrestre', color: '#22c55e', shape: 'triangle' },
    { id: 'base-joint', label: 'Base interarmées', color: '#a855f7', shape: 'triangle' },
    { id: 'base-fortification', label: 'Fortification', color: '#78716c', shape: 'triangle' },
    { id: 'base-other', label: 'Autre site militaire', color: '#f59e0b', shape: 'triangle' },
    // Navires & zones
    { id: 'ship', label: 'Navire Marine Nationale', color: '#00d4c8', shape: 'square', icon: '⚓\uFE0E' },
    { id: 'zone', label: 'Zone restreinte (RTF/P/D)', color: '#ff2d55', shape: 'zone' },
  ],
  source: {
    label: 'ADS-B Exchange / OpenSky / Marine Traffic',
  },
  refresh: {
    label: 'Temps réel (~30s)'
  }
};

const SUBSEA_CABLES_LEGEND: LegendCategory = {
  id: 'subseaCables',
  title: 'Connectivité sous-marine',
  items: [
    { id: 'subsea-route', label: 'Liaison sous-marine', color: '#22c7ff', icon: '━━━' },
    { id: 'subsea-landing', label: 'Point d’atterrage (contour blanc = repère visuel)', color: '#7dd3fc', shape: 'circle', borderColor: '#ffffff', borderWidth: 2 },
  ],
  source: {
    label: 'SubmarineCableMap / jeux publics consolidés',
  },
  refresh: {
    label: 'Tracés statiques, enrichissement dérivé local'
  }
};

const CYBER_LEGEND: LegendCategory = {
  id: 'cyber',
  title: 'Vigilance Cyber — CERT-FR',
  type: 'categorical',
  items: [
    { id: 'critical', label: 'Critique', color: '#EF4444', shape: 'circle' },
    { id: 'high', label: 'Élevée', color: '#F97316', shape: 'circle' },
    { id: 'medium', label: 'Moyenne', color: '#EAB308', shape: 'circle' },
    { id: 'low', label: 'Faible', color: '#22C55E', shape: 'circle' },
  ],
  source: {
    label: 'CERT-FR / ANSSI',
    year: new Date().getFullYear(),
  },
  refresh: {
    label: '~5 min'
  }
};

const ENERGY_ECOWATT_LEGEND: LegendCategory = {
  id: 'powerGrid',
  title: 'Électricité — Écowatt',
  type: 'categorical',
  columns: 2,
  splitIndex: 3,
  items: [
    { id: 'green', label: 'Situation normale', color: '#22C55E', shape: 'square' },
    { id: 'orange', label: 'Système tendu', color: '#F59E0B', shape: 'square' },
    { id: 'red', label: 'Coupures possibles', color: '#EF4444', shape: 'square' },
    // Electric flow arcs: Blue/cyan neon plasma effect
    { id: 'elec-import', label: 'Import élec.', color: '#FF4B4B', icon: '←', iconSize: 18 },
    { id: 'elec-export', label: 'Export élec.', color: '#16A34A', icon: '→', iconSize: 18 },
  ],
  source: {
    label: 'RTE / Écowatt',
    year: new Date().getFullYear(),
  },
  refresh: {
    label: '~15 min'
  },
  notes: [
    'Qualité des données : chargement en cours',
    'Données de consommation/production nationales aggrégées (estimations partielles J-1, etc.)',
  ],
};



const HYDRAULIC_LEGEND: LegendCategory = {
  id: 'hydroBackbone',
  title: 'Backbone énergétique — Hydraulique',
  type: 'categorical',
  columns: 2,
  splitIndex: 3,
  items: [
    { id: 'hydro-production', label: 'Hydro production', color: '#3B82F6', shape: 'circle' },
    { id: 'hydro-step', label: 'STEP / pompage', color: '#8B5CF6', shape: 'circle' },
    { id: 'hydro-water-regulation', label: 'Régulation / retenue', color: '#9CA3AF', shape: 'circle' },
    { id: 'hydro-low', label: 'Signal bas', color: '#60A5FA', shape: 'ring' },
    { id: 'hydro-normal', label: 'Signal normal', color: '#BFDBFE', shape: 'ring' },
    { id: 'hydro-high', label: 'Signal haut', color: '#2563EB', shape: 'ring' },
    { id: 'hydro-stress', label: 'Signal stress', color: '#EF4444', shape: 'ring' },
  ],
  source: {
    label: 'Sélection consolidée + Hub’Eau hydrométrie en appui',
  },
  refresh: {
    label: 'Structure statique · score dérivé recalculé ~10 min avec appui Hub’Eau si disponible'
  },
  notes: [
    'Selection d’actifs hydrauliques critiques — couverture non exhaustive',
    'STEP, barrages > 50 MW, grands réservoirs et actifs insulaires structurants uniquement.',
    'Stress hydro-énergétique estimé à partir de signaux hydrométriques Hub’Eau + contexte énergie.',
  ],
};

const EOLIEN_LEGEND: LegendCategory = {
  id: 'windMonitor',
  title: 'Veille Éolienne',
  type: 'categorical',
  columns: 2,
  splitIndex: 3,
  items: [
    { id: 'wind-onshore',   label: 'Éolienne terrestre', color: '#38BDF8', shape: 'circle' },
    { id: 'wind-offshore',  label: 'Parc en mer',        color: '#14B8A6', shape: 'circle' },
    { id: 'wind-inactive',  label: 'Défaillant',         color: '#EF4444', shape: 'circle' },
    { id: 'wind-cluster-sm', label: 'Cluster < 50 points', color: '#7DD3FC', shape: 'circle' },
    { id: 'wind-cluster-md', label: 'Cluster 50 à 199', color: '#2563EB', shape: 'circle' },
    { id: 'wind-cluster-lg', label: 'Cluster 200+', color: '#1E3A8A', shape: 'circle' },
  ],
  source: {
    label: 'ODRE eco2mix + Géorisques / référentiel éolien',
  },
  refresh: {
    label: 'Live 5 min · parcs cache 1 h'
  },
  notes: [
    'Production nationale live via eco2mix.',
    'Les parcs servent de fond OSINT cartographique, pas de télémesure parc-à-parc.',
  ],
};

const METROPOLES_ELECTRIC_LEGEND: LegendCategory = {
  id: 'metroLoad',
  title: 'Charge métropolitaine',
  type: 'categorical',
  items: [
    { id: 'metro-low', label: 'Consommation relative faible', color: '#34C759', shape: 'circle' },
    { id: 'metro-medium', label: 'Consommation relative moyenne', color: '#FF9500', shape: 'circle' },
    { id: 'metro-high', label: 'Consommation relative forte', color: '#FF3B30', shape: 'circle' },
  ],
  source: {
    label: 'ODRE / eco2mix-metropoles-tr',
    year: new Date().getFullYear(),
  },
  refresh: {
    label: '~15 min (lag possible ~1h)'
  }
};

const GAS_LEGEND: LegendCategory = {
  id: 'gasNetwork',
  title: 'Réseau Gaz',
  type: 'categorical',
  columns: 2,
  splitIndex: 5,
  items: [
    { id: 'gas-network', label: 'Gazoduc principal', color: 'rgba(17,94,89,0.72)', icon: '━━━' },
    { id: 'terminal', label: 'Terminal GNL', color: '#A78BFA', shape: 'circle' },
    { id: 'storage-high', label: 'Stockage > 70%', color: '#6EE7B7', shape: 'circle' },
    { id: 'storage-medium', label: 'Stockage 50-70%', color: '#2DD4BF', shape: 'circle' },
    { id: 'storage-low', label: 'Stockage < 50%', color: '#0891B2', shape: 'circle' },
    { id: 'storage-critical', label: 'Stockage < 30%', color: '#1E3A8A', shape: 'circle' },
    { id: 'storage-filling', label: 'Contour vert = remplissage', color: '#22C55E', shape: 'ring' },
    { id: 'storage-withdrawing', label: 'Contour rouge = soutirage', color: '#EF4444', shape: 'ring' },
    { id: 'storage-neutral', label: 'Contour gris = neutre/inconnu', color: '#6B7280', shape: 'ring' },
    { id: 'pir-import', label: 'Import gaz', color: '#A855F7', icon: '←', iconSize: 18 },
    { id: 'pir-export', label: 'Export gaz', color: '#06B6D4', icon: '→', iconSize: 18 },
  ],
  source: {
    label: 'PEG NaTran / ODRE / Teréga',
    year: new Date().getFullYear(),
  },
  refresh: {
    label: '~15 min'
  },
  notes: [
    'Qualité des données : chargement en cours',
  ],
};

const OIL_LEGEND: LegendCategory = {
  id: 'oilNetwork',
  title: 'Pétrole – Réseau & stocks',
  type: 'categorical',
  columns: 2,
  splitIndex: 5,
  items: [
    // Active = triangle ▲ ambre clair, halo sombre fin
    { id: 'oil-refinery',          label: 'Raffinerie (active)',          color: '#FCD34D', shape: 'triangle-up',   borderColor: '#1C1917', borderWidth: 2 },
    // Maintenance = triangle ▼ inversé ambre sombre, halo clair épais
    { id: 'oil-refinery-maint',    label: 'Raffinerie (maintenance)',     color: '#78350F', shape: 'triangle-down', borderColor: '#FCD34D', borderWidth: 4 },
    // Stratégique : jaune presque blanc, opacité réduite, pas d'anneau
    { id: 'oil-depot-strategic',   label: 'Dépôt stratégique',           color: 'rgba(254,249,195,0.65)', shape: 'circle' },
    // Terminal : disque sombre + anneau interne lumineux ("rond dans le rond")
    { id: 'oil-depot-terminal',    label: 'Terminal pétrolier',           color: '#F59E0B', shape: 'circle', gradient: 'radial-gradient(circle, #1C0800 38%, #F59E0B 38%)', borderColor: '#292524', borderWidth: 1 },
    // Distribution : amber-600, distinct du marron clair des oléoducs
    { id: 'oil-depot-distrib',     label: 'Dépôt de distribution',       color: '#D97706', shape: 'circle' },
    { id: 'oil-pipeline-crude',    label: 'Oléoduc (pétrole brut)',      color: '#78350F', icon: '━━━' },
    { id: 'oil-pipeline-products', label: 'Oléoduc (produits raffinés)', color: '#a16207', icon: '━━━' },
    { id: 'oil-import',            label: 'Flux import',                 color: '#C2410C', icon: '←', iconSize: 18 },
    { id: 'oil-export',            label: 'Flux export',                 color: '#F59E0B', icon: '→', iconSize: 18 },
  ],
  source: {
    label: 'SDES (Chiffres clés de l’énergie 2025, données 2024) + séries mensuelles produits pétroliers data.gouv',
  },
  refresh: {
    label: 'HYBRID / MONTHLY / STRUCTURAL — pas de télémesure temps réel du raffinage ou du réseau'
  },
  notes: [
    'Qualité des données : chargement en cours',
  ],
};

// ── Pannes Électricité (Enedis / Ecowatt / Zones citoyennes) ────────────────
const OUTAGES_ELEC_LEGEND: LegendCategory = {
  id: 'outagesElec',
  title: 'Pannes Électricité',
  type: 'categorical',
  items: [
    { id: 'power-low',      label: '< 1 000 PDL hors réseau',      color: 'rgba(234,179,8,0.30)',  shape: 'zone', borderColor: '#EAB308' },
    { id: 'power-medium',   label: '1 000 – 4 999 PDL hors réseau', color: 'rgba(245,158,11,0.45)', shape: 'zone', borderColor: '#F59E0B' },
    { id: 'power-high',     label: '5 000 – 9 999 PDL hors réseau', color: 'rgba(249,115,22,0.58)', shape: 'zone', borderColor: '#F97316' },
    { id: 'power-critical', label: '≥ 10 000 PDL hors réseau',      color: 'rgba(239,68,68,0.72)',  shape: 'zone', borderColor: '#EF4444' },
    { id: 'zone-citizen',   label: 'Zone de coupure signalée',       color: 'rgba(180,0,255,0.20)',  shape: 'zone', borderColor: '#b400ff' },
  ],
  source: { label: 'Enedis DataFair · Ecowatt RTE · Signalements citoyens' },
  refresh: { label: '15 min (Enedis) · 5 min (Ecowatt) · 10 min (zones citoyennes)' },
};

// ── Pannes Télécom 4G·5G (ARCEP) ─────────────────────────────────────────────
const OUTAGES_TELECOM_LEGEND: LegendCategory = {
  id: 'outagesTelecom',
  title: 'Pannes Télécom',
  type: 'categorical',
  items: [
    { id: 'telecom-hs',  label: 'Antenne HS',         color: '#EF4444', shape: 'circle', borderColor: '#0a0a0f', borderWidth: 1 },
    { id: 'telecom-deg', label: 'Antenne dégradée',   color: '#FF8C00', shape: 'circle', borderColor: '#0a0a0f', borderWidth: 1 },
  ],
  source: { label: 'ARCEP — Observatoire qualité mobile' },
  refresh: { label: 'Quotidien (J-1)' },
};

// ── Pannes Internet / BGP (IODA + BGPView) ───────────────────────────────────
const OUTAGES_INTERNET_LEGEND: LegendCategory = {
  id: 'outagesInternet',
  title: 'Pannes Internet',
  type: 'categorical',
  columns: 2,
  splitIndex: 4,
  items: [
    // ── Anomalies IODA (colonne gauche) ──
    { id: 'ioda-header',   label: 'Anomalies IODA',      color: '#9898a8', isHeader: true },
    { id: 'ioda-critical', label: 'Critique (score ≥ 80)',color: '#EF4444', shape: 'ring' },
    { id: 'ioda-severe',   label: 'Sévère (50–79)',       color: '#F59E0B', shape: 'ring' },
    { id: 'ioda-low',      label: 'Modérée (< 50)',       color: '#10B981', shape: 'ring' },
    // ── Opérateurs ISP / BGP (colonne droite) ──
    { id: 'isp-header',   label: 'Opérateurs BGP',       color: '#9898a8', isHeader: true },
    { id: 'isp-outage',   label: 'En panne',              color: '#EF4444', gradient: 'radial-gradient(circle, #EF4444 32%, transparent 32%, transparent 55%, #EF4444 55%, #EF4444 78%, transparent 78%)', shape: 'circle' },
    { id: 'isp-degraded', label: 'Dégradé',               color: '#F59E0B', gradient: 'radial-gradient(circle, #F59E0B 32%, transparent 32%, transparent 55%, #F59E0B 55%, #F59E0B 78%, transparent 78%)', shape: 'circle' },
    { id: 'isp-normal',   label: 'Normal',                color: '#10B981', gradient: 'radial-gradient(circle, #10B981 32%, transparent 32%, transparent 55%, #10B981 55%, #10B981 78%, transparent 78%)', shape: 'circle' },
  ],
  source: { label: 'IODA (CAIDA / Georgia Tech) · BGPView' },
  refresh: { label: '5 min' },
};

// ── Pannes Cloud & IXP (datacenters + points d'échange) ─────────────────────
const OUTAGES_CLOUD_LEGEND: LegendCategory = {
  id: 'outagesCloud',
  title: 'Pannes Cloud / IXP',
  type: 'categorical',
  items: [
    { id: 'dc-ok',   label: 'Datacenter opérationnel', color: '#60A5FA', shape: 'triangle-up', borderColor: '#0a0a0f', borderWidth: 1 },
    { id: 'dc-deg',  label: 'Datacenter dégradé',      color: '#3B82F6', shape: 'triangle-up', borderColor: '#0a0a0f', borderWidth: 1 },
    { id: 'dc-out',  label: 'Datacenter en panne',     color: '#1D4ED8', shape: 'triangle-up', borderColor: '#0a0a0f', borderWidth: 1 },
    { id: 'ixp-ok',  label: 'Point d\'échange (IXP)',  color: '#BFDBFE', shape: 'square',     borderColor: '#0a0a0f', borderWidth: 1 },
    { id: 'ixp-out', label: 'IXP dégradé / hors service', color: '#64748B', shape: 'square', borderColor: '#0a0a0f', borderWidth: 1 },
  ],
  source: { label: 'OVH · Scaleway · AWS · GCP · Cloudflare Radar · PeeringDB' },
  refresh: { label: '5 min' },
};

function cloneLegend(category: LegendCategory, overrides: Partial<LegendCategory>): LegendCategory {
  return {
    ...category,
    ...overrides,
    items: overrides.items ?? category.items.map((item) => ({ ...item })),
    source: overrides.source ?? (category.source ? { ...category.source } : undefined),
    refresh: overrides.refresh ?? (category.refresh ? { ...category.refresh } : undefined),
    notes: overrides.notes ?? (category.notes ? [...category.notes] : undefined),
  };
}

const NUCLEAR_LEGEND: LegendCategory = {
  id: 'nuclearFleet',
  title: 'Nucléaire — Indisponibilités RTE',
  items: [
    { id: 'nuc-available',  label: 'Disponible',          color: '#2ECC71', shape: 'circle' },
    { id: 'nuc-reduced',    label: 'Production réduite',  color: '#F59E0B', shape: 'circle' },
    { id: 'nuc-planned',    label: 'Arrêt planifié',      color: '#7B8CDE', shape: 'circle' },
    { id: 'nuc-unplanned',  label: 'Arrêt non planifié',  color: '#E74C3C', shape: 'circle' },
    { id: 'nuc-unknown',    label: 'Inconnu',             color: '#6B7280', shape: 'circle' },
    { id: 'nuc-remit',      label: 'Signal REMIT (alpha)', color: '#111827', shape: 'circle' },
  ],
  source: {
    label: 'RTE Open Data · IIP REMIT',
    year: new Date().getFullYear(),
  },
  refresh: { label: 'Cache applicatif 15 min' },
  notes: ['REMIT = signal anticipatoire non confirmé par données structurées RTE.'],
};

const LAYER_CONFIGS: LayerConfig<LegendCategory>[] = [
  {
    id: 'newsGroup',
    groupId: 'news',
    role: 'groupMaster',
    dependsOnGroup: false,
    label: 'Actualites',
  },
  {
    id: 'news',
    groupId: 'news',
    role: 'child',
    dependsOnGroup: true,
    label: 'Actualites',
    legend: NEWS_LEGEND,
  },
  {
    id: 'stability',
    groupId: 'news',
    role: 'child',
    dependsOnGroup: true,
    label: 'Indice de stabilite',
  },
  {
    id: 'traffic',
    groupId: 'traffic',
    role: 'groupMaster',
    dependsOnGroup: false,
    label: 'Trafics',
  },
  {
    id: 'trafficRoad',
    groupId: 'traffic',
    role: 'child',
    dependsOnGroup: true,
    label: 'Trafic routier',
    legend: ROAD_TRAFFIC_LEGEND,
  },
  {
    id: 'trafficMaritime',
    groupId: 'traffic',
    role: 'child',
    dependsOnGroup: true,
    label: 'Trafic maritime (AIS)',
    legend: MARITIME_TRAFFIC_LEGEND,
  },
  {
    id: 'trafficAir',
    groupId: 'traffic',
    role: 'child',
    dependsOnGroup: true,
    label: 'Trafic aérien (preview)',
    legend: AIR_TRAFFIC_LEGEND,
  },
  {
    id: 'trafficRail',
    groupId: 'traffic',
    role: 'child',
    dependsOnGroup: true,
    label: 'Réseau ferroviaire (SNCF)',
  },
  // ─── Energy Group ───
  {
    id: 'energySystems',
    groupId: 'energySystems',
    role: 'groupMaster',
    dependsOnGroup: false,
    label: 'Systèmes énergétiques',
  },
  {
    id: 'powerGrid',
    groupId: 'energySystems',
    role: 'child',
    dependsOnGroup: true,
    label: 'Réseau électrique / Écowatt',
    legend: ENERGY_ECOWATT_LEGEND,
  },
  {
    id: 'nuclearFleet',
    groupId: 'energySystems',
    role: 'child',
    dependsOnGroup: true,
    label: 'Parc nucléaire',
    legend: NUCLEAR_LEGEND,
  },
  {
    id: 'gasNetwork',
    groupId: 'energySystems',
    role: 'child',
    dependsOnGroup: true,
    label: 'Réseau Gaz',
    legend: GAS_LEGEND,
  },
  {
    id: 'hydroBackbone',
    groupId: 'energySystems',
    role: 'child',
    dependsOnGroup: true,
    label: 'Backbone hydraulique',
    legend: HYDRAULIC_LEGEND,
  },
  {
    id: 'oilNetwork',
    groupId: 'energySystems',
    role: 'child',
    dependsOnGroup: true,
    label: 'Pétrole – Réseau & stocks',
    legend: OIL_LEGEND,
  },
  {
    id: 'windMonitor',
    groupId: 'energySystems',
    role: 'child',
    dependsOnGroup: true,
    label: 'Veille Éolienne',
    legend: EOLIEN_LEGEND,
  },

  {
    id: 'metroLoad',
    groupId: 'energySystems',
    role: 'child',
    dependsOnGroup: true,
    label: 'Charge métropolitaine',
    legend: METROPOLES_ELECTRIC_LEGEND,
  },
  // ─── Health Group ───
  {
    id: 'health',
    groupId: 'health',
    role: 'standalone',
    dependsOnGroup: false,
    label: 'Santé / Épidémio',
    legend: HEALTH_ISS_LEGEND,
  },
  {
    id: 'healthApl',
    groupId: 'health',
    role: 'standalone',
    dependsOnGroup: false,
    label: 'APL – Déserts médicaux',
    legend: HEALTH_APL_LEGEND,
  },
  {
    id: 'healthOscour',
    groupId: 'health',
    role: 'standalone',
    dependsOnGroup: false,
    label: 'OSCOUR / SOS Médecins',
    legend: HEALTH_OSCOUR_LEGEND,
  },
  {
    id: 'hospitals',
    groupId: 'health',
    role: 'standalone',
    dependsOnGroup: false,
    label: 'Hôpitaux',
    legend: HOSPITALS_LEGEND,
  },
  {
    id: 'sovereignty',
    groupId: 'sovereignty',
    role: 'groupMaster',
    dependsOnGroup: false,
    label: 'Souveraineté',
  },
  {
    id: 'military',
    groupId: 'sovereignty',
    role: 'child',
    dependsOnGroup: true,
    label: 'Défense / Militaire',
    legend: MILITARY_LEGEND,
  },
  {
    id: 'subseaCables',
    groupId: 'sovereignty',
    role: 'child',
    dependsOnGroup: true,
    label: 'Connectivité sous-marine',
    legend: SUBSEA_CABLES_LEGEND,
  },
  {
    id: 'cyber',
    groupId: 'sovereignty',
    role: 'child',
    dependsOnGroup: true,
    label: 'Vigilance Cyber',
    legend: CYBER_LEGEND,
  },
  {
    id: 'outages',
    groupId: 'outages',
    role: 'groupMaster',
    dependsOnGroup: false,
    label: 'Pannes Réseau',
  },
  {
    id: 'outagesElec',
    groupId: 'outages',
    role: 'child',
    dependsOnGroup: true,
    label: 'Électricité',
    legend: OUTAGES_ELEC_LEGEND,
  },
  {
    id: 'outagesTelecom',
    groupId: 'outages',
    role: 'child',
    dependsOnGroup: true,
    label: 'Télécom 4G·5G',
    legend: OUTAGES_TELECOM_LEGEND,
  },
  {
    id: 'outagesInternet',
    groupId: 'outages',
    role: 'child',
    dependsOnGroup: true,
    label: 'Internet / BGP',
    legend: OUTAGES_INTERNET_LEGEND,
  },
  {
    id: 'outagesCloud',
    groupId: 'outages',
    role: 'child',
    dependsOnGroup: true,
    label: 'Cloud / IXP',
    legend: OUTAGES_CLOUD_LEGEND,
  },
  {
    id: 'environmentGroup',
    groupId: 'environment',
    role: 'groupMaster',
    dependsOnGroup: false,
    label: 'Environnement',
  },
  {
    id: 'environmental',
    groupId: 'environment',
    role: 'child',
    dependsOnGroup: true,
    label: 'MÉTÉO / CRUES',
    legend: ENVIRONMENTAL_LEGEND,
  },
  {
    id: 'weatherRadar',
    groupId: 'environment',
    role: 'child',
    dependsOnGroup: true,
    label: 'RADAR MÉTÉO',
    legend: WEATHER_RADAR_LEGEND,
  },
  // ─── Feux de forêt ───
  {
    id: 'fires',
    role: 'standalone',
    label: 'Feux de forêt (NASA FIRMS)',
  },
  // ─── Terminateur jour/nuit ───
  {
    id: 'dayNight',
    role: 'standalone',
    label: '🌙 Jour / Nuit',
  },
  // ─── Terminateur jour/nuit ───
  {
    id: 'dayNight',
    role: 'standalone',
    label: '🌙 Jour / Nuit',
  },
];

const FRANCE_INTEL_BRIEF_REFRESH_MS = 6 * 60 * 60 * 1000;

export class App {

  private container: HTMLElement;
  private mapContainer: MapContainer | null = null;
  private mapPopup: MapPopup | null = null;
  private mapLegend: MapLegend | null = null;
  private newsPanel: UnderMapNewsFeed | null = null;
  private statusPanel: StatusPanel | null = null;
  private environmentPanel: EnvironmentPanel | null = null;
  private energyPanel: EnergyPanel | null = null;
  private hydraulicPanel: HydraulicPanel | null = null;
  private eolienPanel: EolienPanel | null = null;
  private transportPanel: TransportPanel | null = null;
  private firesPanel: FiresPanel | null = null;
  private maritimePanel: MaritimePanel | null = null;
  private currentActiveFires: import('./types/index.ts').ActiveFire[] = [];
  private trafficPanel: TrafficPanel | null = null;
  private financePanel: FinancePanel | null = null;
  private marketStrip: MarketStrip | null = null;
  private commodityStrip: CommodityStrip | null = null;
  private _intervalCommodities: ReturnType<typeof setInterval> | null = null;
  private isnrPanel: ISNRPanel | null = null;
  private cyberPanel: CyberPanel | null = null;
  private franceIntelPanel: FranceIntelPanel | null = null;
  private situationMonitor: SituationMonitor | null = null;
  private situationHistoryPanel: SituationHistoryPanel | null = null;
  private alertMonitor: AlertMonitor | null = null;
  private franceIntelBriefRequestId = 0;
  private franceIntelBriefRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private currentCyberData: CyberState | null = null;
  private gasPanel: GasPanel | null = null;
  private currentGasData: import('./types').GasNetworkState | null = null;
  private oilPanel: OilPanel | null = null;
  private currentOilData: OilDashboard | null = null;
  private currentFuelTensionData: FuelTensionDashboard | null = null;
  private currentNuclearState: NuclearState | null = null;
  private nuclearPanel: NuclearPanel | null = null;
  private dayNightPanel: DayNightPanel | null = null;
  private outagesPanel: OutagesPanel | null = null;
  private currentPowerOutages: PowerOutage[] = [];
  private currentTelecomOutages: TelecomOutage[] = [];
  private currentNetworkState: NetworkOutageState | null = null;
  private currentInfraState: InfraNetworkState | null = null;
  private currentCitizenZones: import('./types/index.ts').OutageZoneCollection | null = null;
  private defensePanel: DefensePanel | null = null;
  private currentDefenseAlerts: DefenseAlert[] = [];
  private currentAisAnomalies: AisAnomaly[] = [];
  private currentJammingSignals: GpsJammingSignal[] = [];
  private currentMilitarySurges: MilitarySurge[] = [];
  private currentMilitaryFlightsCount = 0;
  private currentMaritimeTrafficFranceCount = 0;
  private submarineCablesData: GeoJSON.FeatureCollection<GeoJSON.LineString> | null = null;
  private nationalHealthPanel: NationalHealthPanel | null = null;
  private healthBarometerPanel: HealthBarometerPanel | null = null;
  private sentinelModal: SentinelModal | null = null;
  private rightSidebar: RightSidebar | null = null;
  private sentinelModalPromise: Promise<SentinelModal> | null = null;
  private rightSidebarPromise: Promise<RightSidebar> | null = null;
  private lastBarometerMetrics: HealthBarometerMetrics | null = null;
  private hasHealthData = false;
  private currentHealthFeatures: HealthFeatures | null = null;
  private currentMarketData: MarketData[] = [];
  private searchModal: SearchModal | null = null;
  private searchModalPromise: Promise<SearchModal> | null = null;
  private layerPanel: LayerPanel | null = null;
  private floatContainerEl: HTMLElement | null = null;
  private rightSidebarRootEl: HTMLElement | null = null;
  private rightSidebarMobileToggleEl: HTMLButtonElement | null = null;
  private pendingGovernmentCategories: EventCategory[] = [];
  private alertMonitorCache = new Map<string, { situation: DetectedSituation; expiresAt: number }>();
  private newsItems: NewsItem[] = [];
  private rssRequestSeq = 0;
  private currentISNRData: ISNRData | null = null;
  private currentMeteoAlerts: MeteoAlert[] = [];
  private _aisZeroWarnLogged = false; // Avoid spamming "0 ships" warning
  private _aisLoaderEl: HTMLElement | null = null; // Loader overlay while AIS connects
  private _showAisLoaderFn: (() => void) | null = null; // Ref so onLayerToggle can trigger it
  private currentMeteoTimeline: VigilanceTimeline | null = null;
  private currentEcowattResponse: EcowattResponse | null = null;
  private currentEcowattUsesFallback = false;
  private currentHydraulicAssets: HydraulicBackboneAsset[] = [];
  private currentHydraulicHydrometry: HydraulicHydrometrySnapshot | null = null;
  private currentEolienLive: EolienLive | null = null;
  private currentEolienPoints: EolienParkSummary[] = [];
  private currentEolienParks: EolienParkSummary[] = [];
  private currentEolienError: string | null = null;
  private readonly eolienTracker = new EolienTracker();


  private currentSncfDisruptions: TransportDisruption[] = [];
  private currentRailNetworkData: RailNetworkData | null = null;
  private currentFloodSegments: FloodSegment[] = [];
  private currentTrafficIncidents: TrafficIncident[] = [];
  private trafficDataLoaded = false;
  private trafficLoadPromise: Promise<void> | null = null;
  private franceIntelPanelPromise: Promise<FranceIntelPanel> | null = null;
  private activeLayers: MapLayers = { ...DEFAULT_LAYERS };

  private _intervalRSS: ReturnType<typeof setInterval> | null = null;
  private _intervalMilitaryFlights: ReturnType<typeof setInterval> | null = null;
  private _intervalShips: ReturnType<typeof setInterval> | null = null;
  private _intervalFinance: ReturnType<typeof setInterval> | null = null;
  private _intervalNuclear: ReturnType<typeof setInterval> | null = null;
  private _intervalOil: ReturnType<typeof setInterval> | null = null;
  private _intervalAirTraffic: ReturnType<typeof setInterval> | null = null;
  private _intervalHealth: ReturnType<typeof setInterval> | null = null;
  private _intervalHydraulic: ReturnType<typeof setInterval> | null = null;
  private _intervalEolien: ReturnType<typeof setInterval> | null = null;
  private _intervalClock: ReturnType<typeof setInterval> | null = null;
  private networkBarometerWidget: BarometerWidget | null = null;
  private _intervalNetworkBarometer: ReturnType<typeof setInterval> | null = null;
  private _intervalSpaceWeatherTerminator: ReturnType<typeof setInterval> | null = null;
  private _intervalSpaceWeatherRefresh: ReturnType<typeof setInterval> | null = null;

  public destroy(): void {
    if (this._intervalRSS !== null) { clearInterval(this._intervalRSS); this._intervalRSS = null; }
    if (this._intervalMilitaryFlights !== null) { clearInterval(this._intervalMilitaryFlights); this._intervalMilitaryFlights = null; }
    if (this._intervalShips !== null) { clearInterval(this._intervalShips); this._intervalShips = null; }
    if (this._intervalFinance !== null) { clearInterval(this._intervalFinance); this._intervalFinance = null; }
    if (this._intervalNuclear !== null) { clearInterval(this._intervalNuclear); this._intervalNuclear = null; }
    if (this._intervalOil !== null) { clearInterval(this._intervalOil); this._intervalOil = null; }
    if (this._intervalCommodities !== null) { clearInterval(this._intervalCommodities); this._intervalCommodities = null; }
    if (this._intervalAirTraffic !== null) { clearInterval(this._intervalAirTraffic); this._intervalAirTraffic = null; }
    if (this._intervalHealth !== null) { clearInterval(this._intervalHealth); this._intervalHealth = null; }
    if (this._intervalHydraulic !== null) { clearInterval(this._intervalHydraulic); this._intervalHydraulic = null; }
    if (this._intervalEolien !== null) { clearInterval(this._intervalEolien); this._intervalEolien = null; }
    if (this._intervalClock !== null) { clearInterval(this._intervalClock); this._intervalClock = null; }
    if (this._intervalNetworkBarometer !== null) {
      clearInterval(this._intervalNetworkBarometer);
      this._intervalNetworkBarometer = null;
    }
    if (this._intervalSpaceWeatherTerminator !== null) {
      clearInterval(this._intervalSpaceWeatherTerminator);
      this._intervalSpaceWeatherTerminator = null;
    }
    if (this._intervalSpaceWeatherRefresh !== null) {
      clearInterval(this._intervalSpaceWeatherRefresh);
      this._intervalSpaceWeatherRefresh = null;
    }
    this.networkBarometerWidget?.destroy();
    this.networkBarometerWidget = null;
  }

  private isPanelVisible(element: HTMLElement | null): boolean {
    return !!element && element.style.display !== 'none';
  }

  private layoutEnergyFloatingPanels(): void {
    requestAnimationFrame(() => {
      const panels = [
        this.container.querySelector<HTMLElement>('.energy-panel-modal'),
        this.container.querySelector<HTMLElement>('.hydraulic-panel-modal'),
        this.container.querySelector<HTMLElement>('.eolien-panel-modal'),
        this.container.querySelector<HTMLElement>('.gas-panel-modal'),
        this.container.querySelector<HTMLElement>('.oil-panel-modal'),
      ].filter((panel): panel is HTMLElement => this.isPanelVisible(panel));

      let previousBottom = 0;
      for (const [index, panel] of panels.entries()) {
        panel.style.right = '20px';
        panel.style.left = 'auto';
        panel.style.bottom = 'auto';
        
        if (index === 0) {
          panel.style.top = 'var(--right-panel-top)';
        } else {
          panel.style.top = `${previousBottom + 16}px`;
        }
        
        previousBottom = panel.offsetTop + panel.offsetHeight;
      }
    });
  }

  private layoutEnvironmentFloatingPanels(): void {
    requestAnimationFrame(() => {
      const panels = [
        document.body.querySelector<HTMLElement>('.environment-panel-modal'),
        document.body.querySelector<HTMLElement>('.fires-panel-modal'),
      ].filter((panel): panel is HTMLElement => this.isPanelVisible(panel));

      let previousBottom = 0;

      for (const [index, panel] of panels.entries()) {
        panel.style.right = '20px';
        panel.style.left = 'auto';
        panel.style.bottom = 'auto';
        
        if (index === 0) {
          panel.style.top = 'var(--right-panel-top)';
        } else {
          panel.style.top = `${previousBottom + 16}px`;
        }
        
        previousBottom = panel.offsetTop + panel.offsetHeight;
      }
    });
  }

  private syncTrafficGroupState(): void {
    this.activeLayers.traffic =
      this.activeLayers.trafficRoad ||
      this.activeLayers.trafficMaritime ||
      this.activeLayers.trafficAir ||
      this.activeLayers.trafficRail;
  }

  private refreshLegendVisibility(): void {
    const groupsOn = new Set(
      LAYER_CONFIGS
        .filter(l => l.role === 'groupMaster' && this.activeLayers[l.id])
        .map(l => l.groupId)
    );

    for (const config of LAYER_CONFIGS) {
      if (config.legend) {
        let isVisible = false;
        if (this.activeLayers[config.id]) {
          if (config.role === 'child' && config.dependsOnGroup) {
            isVisible = groupsOn.has(config.groupId);
          } else {
            isVisible = true;
          }
        }
        this.mapLegend?.setCategoryVisibility(config.legend.id, isVisible);
      }
    }
  }

  private refreshTrafficLegend(): void {
    if (!this.mapLegend) return;

    this.mapLegend.setCategoryVisibility('trafficRoad', this.activeLayers.traffic && this.activeLayers.trafficRoad);
    this.mapLegend.setCategoryVisibility('trafficMaritime', this.activeLayers.traffic && this.activeLayers.trafficMaritime);
    this.mapLegend.setCategoryVisibility('trafficAir', this.activeLayers.traffic && this.activeLayers.trafficAir);
    // Rail legend lives in TransportPanel — no mapLegend entry to toggle
  }

  private formatLegendSourceStatus(status: 'ok' | 'stale' | 'error'): string {
    switch (status) {
      case 'ok':
        return 'TEMPS RÉEL';
      case 'stale':
        return 'CACHE FIGÉ';
      default:
        return 'INDISPONIBLE';
    }
  }

  private refreshEnergyDataLegends(): void {
    if (!this.mapLegend) return;

    const electricityNotes = this.currentEcowattResponse
      ? this.currentEcowattUsesFallback
        ? [
            'Qualité des données : INDISPONIBLE',
            'Mix/interconnexions : INDISPONIBLE',
          ]
        : [
            'Qualité des données : signal, mix et interconnexions en TEMPS RÉEL (eco2mix/ODRE)',
            'Détail réacteurs nucléaires : non inclus ici',
          ]
      : [
          'Qualité des données : chargement en cours',
        ];

    const gasNotes = this.currentGasData
      ? [
          `EcoGaz : ${this.formatLegendSourceStatus(this.currentGasData.sourceStatus.ecogaz)}`,
          'Stockages/flux : données ODRE (TEMPS RÉEL) quand disponibles, sinon INDISPONIBLE',
          'Terminaux et sites : HISTORIQUE / référentiel local',
        ]
      : [
          'Qualité des données : chargement en cours',
        ];

    const oilNotes = this.currentOilData
      ? [
          'OilNetwork : SDES pétrole 2025 (données 2024) + séries mensuelles produits pétroliers data.gouv – HYBRID / MONTHLY / STRUCTURAL',
          'Arcs : projection OSINT à partir des parts d’origine, pas du port-à-port mesuré',
        ]
      : [
          'Qualité des données : chargement en cours',
        ];


    const hydraulicNotes = this.currentHydraulicAssets.length > 0
      ? [
          `Couche chargée : ${this.currentHydraulicAssets.length} actifs critiques sélectionnés`,
          `Hub’Eau hydrométrie : ${this.currentHydraulicHydrometry?.detail ?? 'appui en chargement'}`,
          `Fraîcheur mesures : ${this.currentHydraulicHydrometry?.maxObservationAgeMinutes != null ? `${this.currentHydraulicHydrometry.maxObservationAgeMinutes} min max` : 'non disponible'}`,
          'Limite : pas de télémesure EDF barrage par barrage.',
        ]
      : [
          'Selection d’actifs hydrauliques critiques — couverture non exhaustive',
          'Signaux auto-recalculés toutes les 10 minutes quand la couche est active',
          'Chargement des signaux hydrauliques en cours',
        ];

    const eolienNotes = this.currentEolienLive
      ? [
          `Production live France : ${this.currentEolienLive.production_gw.toFixed(1)} GW`,
          `Facteur de charge estimé : ${Math.round(this.currentEolienLive.facteur_charge * 100)}%`,
          `Parcs suivis : ${this.currentEolienParks.length} · points carte : ${this.currentEolienPoints.length}`,
          'Alerte production critique si la puissance nationale passe sous 3 GW',
        ]
      : [
          'Production live France via eco2mix/ODRE',
          this.currentEolienError
            ? `Erreur couche éolienne : ${this.currentEolienError}`
            : 'Référentiel cartographique parcs terrestres / en mer en chargement',
        ];

    this.mapLegend.addCategory(cloneLegend(ENERGY_ECOWATT_LEGEND, { notes: electricityNotes }));
    this.mapLegend.addCategory(NUCLEAR_LEGEND);
    this.mapLegend.addCategory(cloneLegend(GAS_LEGEND, { notes: gasNotes }));
    this.mapLegend.addCategory(cloneLegend(HYDRAULIC_LEGEND, { notes: hydraulicNotes }));
    this.mapLegend.addCategory(cloneLegend(OIL_LEGEND, { notes: oilNotes }));
    this.mapLegend.addCategory(cloneLegend(EOLIEN_LEGEND, { notes: eolienNotes }));

    this.mapLegend.addCategory(METROPOLES_ELECTRIC_LEGEND);
  }

  constructor(container: HTMLElement) {
    this.container = container;
  }

  private syncRightSidebarTriggers(isOpen: boolean): void {
    const mobileToggle = this.rightSidebarMobileToggleEl;
    if (!mobileToggle) return;
    mobileToggle.setAttribute('aria-label', isOpen ? 'Fermer le panneau latéral' : 'Ouvrir le panneau latéral');
    mobileToggle.textContent = isOpen ? '✕' : '☰';
  }

  private ensureRightSidebar(): Promise<RightSidebar> {
    if (this.rightSidebar) return Promise.resolve(this.rightSidebar);
    if (this.rightSidebarPromise) return this.rightSidebarPromise;
    if (!this.rightSidebarRootEl) {
      return Promise.reject(new Error('Right sidebar root not ready'));
    }

    this.rightSidebarPromise = import('./components/RightSidebar.ts').then(({ RightSidebar }) => {
      const sidebar = new RightSidebar(this.rightSidebarRootEl!);
      sidebar.mount();
      sidebar.setOnToggle((isOpen) => this.syncRightSidebarTriggers(isOpen));
      sidebar.setGovernmentContext(this.pendingGovernmentCategories);
      this.syncRightSidebarTriggers(sidebar.isOpen());
      this.rightSidebar = sidebar;
      return sidebar;
    });

    return this.rightSidebarPromise;
  }

  private ensureSentinelModal(): Promise<SentinelModal> {
    if (this.sentinelModal) return Promise.resolve(this.sentinelModal);
    if (this.sentinelModalPromise) return this.sentinelModalPromise;
    if (!this.floatContainerEl) {
      return Promise.reject(new Error('Floating container not ready'));
    }

    this.sentinelModalPromise = import('./components/SentinelModal.ts').then(({ SentinelModal }) => {
      const modal = new SentinelModal(this.floatContainerEl!);
      this.sentinelModal = modal;
      return modal;
    });

    return this.sentinelModalPromise;
  }

  private ensureSearchModal(): Promise<SearchModal> {
    if (this.searchModal) return Promise.resolve(this.searchModal);
    if (this.searchModalPromise) return this.searchModalPromise;

    this.searchModalPromise = import('./components/SearchModal.ts').then(({ SearchModal }) => {
      const modal = new SearchModal(this.container, { bindKeyboardShortcut: false });
      modal.setOnFlyTo((lon, lat, zoom, item) => {
        this.mapContainer?.flyTo(lon, lat, zoom);
        if (item) {
          this.mapContainer?.selectItem(item);
          this.newsPanel?.selectItem(item.id);
          this.routeGovernmentContextForItem(item);
        }
      });
      modal.updateNewsItems(this.newsItems);
      this.searchModal = modal;
      return modal;
    });

    return this.searchModalPromise;
  }

  private ensureFranceIntelPanel(): Promise<FranceIntelPanel> {
    if (this.franceIntelPanel) return Promise.resolve(this.franceIntelPanel);
    if (this.franceIntelPanelPromise) return this.franceIntelPanelPromise;
    if (!this.floatContainerEl) {
      return Promise.reject(new Error('Floating container not ready'));
    }

    this.franceIntelPanelPromise = import('./components/FranceIntelPanel.ts').then(({ FranceIntelPanel }) => {
      const panel = new FranceIntelPanel(this.floatContainerEl!);
      panel.setInfrastructureWidget(this.networkBarometerWidget);
      panel.setOnClose(() => {
        this.clearFranceIntelBriefRefresh();
      });
      panel.mount();
      this.franceIntelPanel = panel;
      return panel;
    });

    return this.franceIntelPanelPromise;
  }

  private async loadAplData(): Promise<void> {
    const response = await fetch('/data/apl-departements.json');
    const data = await response.json();

    // Mise à jour de l'année réelle si présente dans le JSON
    if (data.metadata?.year && HEALTH_APL_LEGEND.source) {
      HEALTH_APL_LEGEND.source.year = data.metadata.year;
      // On utilise 'as any' pour forcer l'appel si la méthode n'est pas typée
      (this.mapLegend as any)?.updateCategory?.(HEALTH_APL_LEGEND);
    }

    const aplDepartments = Array.isArray(data?.departements)
      ? data.departements.map((item: any) => ({
        depCode: String(item?.code_insee ?? '').trim(),
        depName: '',
        regionCode: '',
        regionName: '',
        incidenceRate: 0,
        hospitalizations: 0,
        reanimation: 0,
        emergencyVisits: 0,
        positivityRate: 0,
        spfIncidence: null,
        spfHospitalizations: null,
        spfReanimation: null,
        dreesUrgences: null,
        sentinellesIncidence: null,
        topMotifs: [],
        aplIndex: Number.isFinite(Number(item?.apl_index)) ? Number(item.apl_index) : null,
        aplCategory: ['desert', 'fragile', 'bon', 'surdote'].includes(String(item?.category ?? '').trim().toLowerCase())
          ? String(item.category).trim().toLowerCase()
          : 'indisponible',
        iss: 0,
        issLevel: 1,
        trend: 'stable',
        source: 'drees',
        updatedAt: new Date(),
      })).filter((item: any) => item.depCode)
      : [];

    if (aplDepartments.length > 0) {
      this.hasHealthData = true;
      this.mapContainer?.updateHealth([], {} as any, aplDepartments);
    }
  }

  async init(): Promise<void> {
    // ── Phase 0: Layer state ─────────────────────────────────────────────────
    // All layers start OFF by default. Only URL params (shared links) can override.
    localStorage.removeItem('fm-active-layers'); // Clear persisted layers
    const urlState = readUrlState();
    if (urlState.layers) {
      const merged = { ...DEFAULT_LAYERS, ...urlState.layers };
      merged.newsGroup = merged.news || merged.stability;
      // Back-compat: old shared links used `traffic` for road incidents.
      if (merged.traffic && !merged.trafficRoad) merged.trafficRoad = true;
      merged.traffic = merged.trafficRoad || merged.trafficMaritime || merged.trafficAir || (merged.trafficRail ?? false);
      merged.energySystems = hasActiveEnergySystems(merged);
      merged.environmentGroup = merged.environmental || merged.weatherRadar || merged.fires || (merged.dayNight ?? false);
      merged.sovereignty = merged.military || merged.subseaCables || merged.cyber;
      merged.outages = merged.outagesElec || merged.outagesTelecom || merged.outagesInternet || merged.outagesCloud || merged.outages;
      this.activeLayers = merged;
    }

    this.renderShell();
    this.updateBarometerFabVisibility();
    await this.initMap();

    // ── Apply saved layer visibility IMMEDIATELY (before any data) ──────────
    // This is the critical fix for the "flash of default layers" on page load:
    // the map is ready but hidden layers must be set before any layer becomes visible.
    this.mapContainer?.setLayerVisibility(this.getEffectiveLayers());
    this.layerPanel?.updateLayers(this.activeLayers);
    this.updateBarometerFabVisibility();

    // APL JSON - non-blocking, the map does not need it to be interactive
    this.loadAplData().catch((err) => console.warn('[Init] APL load failed:', err));
    // Apply URL view if present
    if (urlState.lng != null && urlState.lat != null) {
      this.mapContainer?.flyTo(urlState.lng, urlState.lat, urlState.zoom ?? 6);
    }

    // Charger le cache local (affichage instantané)
    const cached = loadNewsFromCache();
    if (cached && cached.length > 0) {
      this.newsItems = cached;
      this.mapContainer?.updateNews(this.newsItems);
      this.newsPanel?.updateItems(this.newsItems);
      this.statusPanel?.updateSource('RSS PQR', { status: 'ok', lastUpdate: new Date() });
      console.log(`[Init] ${cached.length} articles chargés depuis le cache`);
    } else {
      this.newsItems = [];
    }

    // ── Polling — start immediately, independent of layer data
    this.startRSSPipeline();
    this.startMilitaryPolling();
    this.startFinancePolling();
    this.startCommodityPolling();
    this.startOilPolling();
    this.startAirTrafficPolling();
    this.startHealthPolling();
    this.startHydraulicPolling();
    this.startEolienPolling();

    // ── Static data — sync, instant
    this.loadStaticData();

    // ── CRITICAL layers — await: map becomes useful
    await this.loadCriticalLayers();
    this.updateISNR();

    // ── SECONDARY layers — background
    this.loadSecondaryLayers()
      .then(() => this.updateISNR())
      .catch((err) => console.error('[Init] Secondary layers error:', err));

    // ── OPTIONAL layers — background
    this.loadOptionalLayers().catch((err) => console.error('[Init] Optional layers error:', err));

    console.log('[FranceMonitor] App initialized — map interactive, layers loading in background');
  }

  // ─── Shell Layout ───────────────────────────────────────────────────────────

  private renderShell(): void {
    // ── Header ──
    const header = document.createElement('header');
    header.className = 'header';
    header.innerHTML = `
      <button class="header-title header-about-trigger" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="À propos de France Monitor">
        <img class="header-logo" src="/icon.svg" alt="Logo France Monitor" />
        <span class="header-title-text">
          <span class="header-title-word header-title-word--france">France</span><span class="header-title-word header-title-word--monitor">Monitor</span>
        </span>
      </button>
      <div class="header-center" id="region-presets"></div>
      <div class="header-status">
        <div id="header-data-sources"></div>
        <span class="header-clock" id="clock"></span>
        <span class="header-live-dot" title="En direct"></span>
      </div>
    `;
    this.container.appendChild(header);

    const aboutModal = document.createElement('div');
    aboutModal.className = 'about-modal';
    aboutModal.setAttribute('aria-hidden', 'true');
    aboutModal.innerHTML = `
      <div class="about-modal__backdrop" data-close="true"></div>
      <div class="about-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="about-modal-title">
        <button class="about-modal__close" type="button" aria-label="Fermer la fenêtre À propos">✕</button>
        <div class="about-modal__hero">
          <div class="about-modal__brand">
            <img class="about-modal__logo" src="/icon.svg" alt="Logo France Monitor" />
            <div class="about-modal__brand-copy">
              <div class="about-modal__title-row">
                <div id="about-modal-title" class="about-modal__title">France Monitor</div>
                <div class="about-modal__version">v1.0</div>
              </div>
              <div class="about-modal__subtitle">Tableau de bord situationnel pour la France</div>
            </div>
          </div>
        </div>
        <div class="about-modal__body">
          <p class="about-modal__text">
            France Monitor est un tableau de bord OSINT expérimental de veille nationale, qui agrège des signaux publics (open data, flux RSS, APIs) sur l'énergie, les transports, la santé, l'environnement et les réseaux. Il ne s'agit ni d'un média ni d'un service officiel, mais d'un outil d'exploration et de détection de signaux faibles.
          </p>
          <div class="about-modal__links">
            <a class="about-modal__chip" href="/about">À propos</a>
            <a class="about-modal__chip" href="/methodology">Méthodologie</a>
            <a class="about-modal__chip" href="/docs">Documentation</a>
            <a class="about-modal__chip" href="/contact">Contact</a>
            <a class="about-modal__chip" href="/legal">Légal</a>
          </div>
          <div class="about-modal__links" style="margin-top: 10px;">
            <a
              class="about-modal__chip"
              href="https://github.com/FraidFraid/France-Monitor"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Dépôt GitHub de France Monitor"
            >
              GitHub
            </a>
            <a
              class="about-modal__chip"
              href="https://www.linkedin.com/in/fredaubourg/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Profil LinkedIn de Fraid"
            >
              LinkedIn
            </a>
            <span class="about-modal__chip about-modal__chip--static">AGPL-3.0</span>
          </div>
          <div class="about-modal__legal">
            <div>Copyright © 2026 Fraid</div>
            <div>Projet OSINT indépendant.</div>
          </div>
        </div>
      </div>
    `;
    this.container.appendChild(aboutModal);

    const aboutTrigger = header.querySelector<HTMLButtonElement>('.header-about-trigger');
    const setAboutModalOpen = (open: boolean) => {
      aboutModal.setAttribute('aria-hidden', open ? 'false' : 'true');
      aboutTrigger?.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.style.overflow = open ? 'hidden' : '';
    };
    aboutTrigger?.addEventListener('click', () => setAboutModalOpen(true));
    aboutModal.querySelector('.about-modal__close')?.addEventListener('click', () => setAboutModalOpen(false));
    aboutModal.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.dataset['close'] === 'true') setAboutModalOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && aboutModal.getAttribute('aria-hidden') === 'false') {
        setAboutModalOpen(false);
      }
    });

    // GOUVERNEMENT and ElusPanel disabled for Vercel limits

    this.renderRegionPresets(document.getElementById('region-presets')!);
    const headerDataSources = document.getElementById('header-data-sources');
    if (headerDataSources) {
      this.statusPanel = new StatusPanel(headerDataSources, { variant: 'dropdown', icon: '' });
      this.statusPanel.setOnSourceClick((name) => this.handleSourcePanelClick(name));
      this.statusPanel.mount();

      // ── Abonnement Watchdog → StatusPanel (coexiste avec les appels directs existants) ──
      // Les appels statusPanel?.updateSource() épars dans chaque loadXxx() continuent de
      // fonctionner. Les events Watchdog les enrichissent avec les métriques de monitoring.
      Watchdog.on('update', (snapshots) => {
        for (const snap of snapshots) {
          this.statusPanel?.updateSource(snap.status.name, snap.status);
        }
      });
    }

    // ── Main layout ──
    const main = document.createElement('main');
    main.className = 'main-container';

    // ── Sidebar ──
    const sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';
    const sidebarContent = document.createElement('div');
    sidebarContent.className = 'sidebar-content';
    sidebarContent.id = 'sidebar-content';
    sidebar.appendChild(sidebarContent);
    main.appendChild(sidebar);

    // ── Map area ──
    const mapArea = document.createElement('div');
    mapArea.className = 'map-area';

    // Layer toggles moved to header modal (UnifiedSettings)

    const mapContainerEl = document.createElement('div');
    mapContainerEl.className = 'map-container';
    mapContainerEl.id = 'map-container';
    mapContainerEl.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">
        <div style="text-align:center;">
          <div class="loading-spinner" style="margin:0 auto 12px;"></div>
          <p>Chargement de la carte…</p>
        </div>
      </div>
    `;
    mapArea.appendChild(mapContainerEl);

    const underMapArea = document.createElement('section');
    underMapArea.className = 'under-map-area';
    underMapArea.id = 'under-map-area';
    underMapArea.innerHTML = `<div class="under-map-grid" id="under-map-grid"></div>`;
    mapArea.appendChild(underMapArea);

    const bottomLinks = document.createElement('nav');
    bottomLinks.className = 'app-bottom-links';
    bottomLinks.setAttribute('aria-label', 'Pages d’information France Monitor');
    bottomLinks.innerHTML = `
      <a href="/about">À propos</a>
      <span aria-hidden="true">·</span>
      <a href="/methodology">Méthodologie</a>
      <span aria-hidden="true">·</span>
      <a href="/docs">Documentation</a>
      <span aria-hidden="true">·</span>
      <a href="/legal">Mentions légales</a>
      <span aria-hidden="true">·</span>
      <a href="/contact">Contact</a>
    `;

    const underMapJumpBtn = document.createElement('button');
    underMapJumpBtn.className = 'map-underfold-btn';
    underMapJumpBtn.type = 'button';
    underMapJumpBtn.setAttribute('aria-expanded', 'false');
    underMapJumpBtn.innerHTML = `
      <span class="map-underfold-btn__label">Voir les modules</span>
      <span class="map-underfold-btn__chevron">⌄</span>
    `;
    const underMapLabelEl = underMapJumpBtn.querySelector('.map-underfold-btn__label') as HTMLElement | null;
    const underMapChevronEl = underMapJumpBtn.querySelector('.map-underfold-btn__chevron') as HTMLElement | null;
    let underMapExpanded = false;
    let underMapScrollLockUntil = 0;
    const syncUnderMapToggle = (expanded: boolean) => {
      underMapExpanded = expanded;
      underMapJumpBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      if (underMapLabelEl) underMapLabelEl.textContent = expanded ? 'Revenir à la carte' : 'Voir les modules';
      if (underMapChevronEl) underMapChevronEl.textContent = expanded ? '⌃' : '⌄';
    };
    underMapJumpBtn.onclick = () => {
      underMapScrollLockUntil = Date.now() + 700;
      if (underMapExpanded) {
        syncUnderMapToggle(false);
        mapArea.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        syncUnderMapToggle(true);
        mapArea.scrollTo({ top: underMapArea.offsetTop, behavior: 'smooth' });
      }
    };
    mapArea.addEventListener('scroll', () => {
      if (Date.now() < underMapScrollLockUntil) return;
      const mapTop = mapArea.scrollTop;
      const revealThreshold = Math.max(32, underMapArea.offsetTop - mapContainerEl.clientHeight / 2);
      const isUnderMapVisible = mapTop >= revealThreshold;
      syncUnderMapToggle(isUnderMapVisible);
    }, { passive: true });
    mapArea.appendChild(underMapJumpBtn);

    // ── Bouton flottant "Baromètre national Santé" ──
    const barometerBtn = document.createElement('button');
    barometerBtn.id = 'barometer-fab';
    barometerBtn.innerHTML = '🩺 Baromètre Santé — <span style="color:#888; font-weight:600;">⏳ Chargement...</span>';
    barometerBtn.style.cssText = `
      position: absolute;
      top: 70px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 900;
      background: linear-gradient(135deg, rgba(30,30,50,0.92), rgba(20,20,40,0.95));
      border: 1px solid rgba(255,255,255,0.18);
      color: #e8e8ec;
      padding: 8px 18px;
      border-radius: 24px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      backdrop-filter: blur(12px);
      transition: all 0.2s;
      white-space: nowrap;
      letter-spacing: 0.2px;
    `;
    barometerBtn.onmouseover = () => {
      barometerBtn.style.background = 'linear-gradient(135deg, rgba(46,204,113,0.25), rgba(231,76,60,0.25))';
      barometerBtn.style.borderColor = 'rgba(255,255,255,0.3)';
      barometerBtn.style.transform = 'translateX(-50%) scale(1.04)';
    };
    barometerBtn.onmouseout = () => {
      barometerBtn.style.background = 'linear-gradient(135deg, rgba(30,30,50,0.92), rgba(20,20,40,0.95))';
      barometerBtn.style.borderColor = 'rgba(255,255,255,0.18)';
      barometerBtn.style.transform = 'translateX(-50%) scale(1)';
    };
    barometerBtn.onclick = () => {
      document.dispatchEvent(new CustomEvent('open-health-barometer'));
    };
    mapArea.appendChild(barometerBtn);

    main.appendChild(mapArea);

    // ── Right Sidebar ──
    const rightSidebarEl = document.createElement('aside');
    rightSidebarEl.id = 'right-sidebar';
    main.appendChild(rightSidebarEl);
    this.rightSidebarRootEl = rightSidebarEl;

    // Mobile toggle button — only visible on small screens via CSS
    const mobileToggle = document.createElement('button');
    mobileToggle.className = 'right-sidebar-mobile-toggle';
    mobileToggle.setAttribute('aria-label', 'Ouvrir le panneau latéral');
    mobileToggle.textContent = '☰';
    mapArea.appendChild(mobileToggle);
    this.rightSidebarMobileToggleEl = mobileToggle;

    this.container.appendChild(main);
    this.container.appendChild(bottomLinks);
    this.syncRightSidebarTriggers(false);

    mobileToggle.addEventListener('click', () => {
      void this.ensureRightSidebar().then((sidebar) => sidebar.toggle());
    });
    // presidentToggle listener removed

    // ── Mount sidebar panels ──
    const sidebarEl = document.getElementById('sidebar-content')!;

    // Baromètre Pannes Réseau (premier élément de la sidebar, avant les couches)
    this.networkBarometerWidget = new BarometerWidget(sidebarEl);
    this.networkBarometerWidget.mount({ attach: false });

    // Bouton Intelligence France (juste au-dessus des couches)
    const intelSidebarBtn = document.createElement('button');
    intelSidebarBtn.className = 'sidebar-intel-entry';
    intelSidebarBtn.type = 'button';
    intelSidebarBtn.setAttribute('aria-label', 'Ouvrir Intelligence France');
    intelSidebarBtn.innerHTML = `
      <span class="sidebar-intel-entry__flag">🇫🇷</span>
      <span class="sidebar-intel-entry__body">
        <span class="sidebar-intel-entry__title">Intelligence France</span>
        <span class="sidebar-intel-entry__meta">Veille OSINT nationale en sources ouvertes. Synthèse nationale, signaux actifs, énergie, sécurité</span>
      </span>
      <span class="sidebar-intel-entry__arrow" aria-hidden="true">›</span>
    `;
    intelSidebarBtn.onclick = () => {
      document.dispatchEvent(new CustomEvent('open-france-intel'));
    };
    sidebarEl.appendChild(intelSidebarBtn);

    // LayerPanel (COUCHES)
    this.layerPanel = new LayerPanel(sidebarEl, this.activeLayers);
    this.layerPanel.setOnChange((key, enabled) => this.onLayerToggle(key, enabled));
    this.layerPanel.mount();

    const underMapGrid = document.getElementById('under-map-grid')!;

    // Moitié gauche : Flux boursier + Matières premières côte à côte
    const marketGroupWrapper = document.createElement('div');
    marketGroupWrapper.className = 'under-map-market-group';
    underMapGrid.appendChild(marketGroupWrapper);

    const marketStripContainer = document.createElement('div');
    marketGroupWrapper.appendChild(marketStripContainer);
    this.marketStrip = new MarketStrip(marketStripContainer);
    this.marketStrip.mount();

    const commodityStripContainer = document.createElement('div');
    marketGroupWrapper.appendChild(commodityStripContainer);
    this.commodityStrip = new CommodityStrip(commodityStripContainer);
    this.commodityStrip.mount();

    // Moitié droite : Historique + Flux actualités
    const rightColWrapper = document.createElement('div');
    rightColWrapper.className = 'under-map-right-group';
    rightColWrapper.style.display = 'flex';
    rightColWrapper.style.flexDirection = 'column';
    rightColWrapper.style.gap = '12px';
    rightColWrapper.style.height = '100%';
    underMapGrid.appendChild(rightColWrapper);

    // 1. Historique situation — toujours visible
    const historyContainer = document.createElement('div');
    historyContainer.className = 'sit-hist-wrap';
    rightColWrapper.appendChild(historyContainer);

    // 2. Flux actualités (en-dessous de l'historique)
    const newsFeedContainer = document.createElement('div');
    newsFeedContainer.style.flex = '1';
    newsFeedContainer.style.minHeight = '0';
    rightColWrapper.appendChild(newsFeedContainer);
    
    this.newsPanel = new UnderMapNewsFeed(newsFeedContainer);
    this.newsPanel.setOnFilterChange((filter) => this.onFilterChange(filter));
    this.newsPanel.setOnItemClick((item) => {
      this.mapContainer?.selectItem(item);
      if (item.lon != null && item.lat != null) {
        this.mapContainer?.flyTo(item.lon, item.lat, 12);
      }
      this.routeGovernmentContextForItem(item);
    });
    this.newsPanel.mount();
    const initialUrlState = readUrlState();
    this.newsPanel.setFilter({
      timeRange: initialUrlState.timeRange === '1h' || initialUrlState.timeRange === '6h' || initialUrlState.timeRange === '24h' || initialUrlState.timeRange === '48h' || initialUrlState.timeRange === '7d' || initialUrlState.timeRange === 'all'
        ? initialUrlState.timeRange
        : '24h',
      searchQuery: '',
    });
    writeUrlState({
      timeRange: initialUrlState.timeRange === '1h' || initialUrlState.timeRange === '6h' || initialUrlState.timeRange === '24h' || initialUrlState.timeRange === '48h' || initialUrlState.timeRange === '7d' || initialUrlState.timeRange === 'all'
        ? initialUrlState.timeRange
        : '24h',
      searchQuery: undefined,
    });

    // Floating panels (mounted to App root container)
    const floatContainer = document.createElement('div');
    this.container.appendChild(floatContainer);
    this.floatContainerEl = floatContainer;

    this.environmentPanel = new EnvironmentPanel(floatContainer);
    this.environmentPanel.setOnHoverDepartment((code) => {
      this.mapContainer?.highlightWeatherDepartment(code);
    });
    this.environmentPanel.setOnHoverSegment((segmentId) => {
      this.mapContainer?.highlightFloodSegment(segmentId);
    });
    this.environmentPanel.setOnSelectSegment((segmentId) => {
      const segment = this.currentFloodSegments.find((item) => item.id === segmentId);
      if (!segment) return;
      this.mapContainer?.highlightFloodSegment(segmentId);
      this.mapContainer?.fitBounds(computeFloodSegmentBbox(segment.displayGeometry), 80);
    });
    this.environmentPanel.setOnClose(() => {
      this.layoutEnvironmentFloatingPanels();
    });
    this.environmentPanel.mount();

    this.energyPanel = new EnergyPanel(floatContainer);
    this.energyPanel.setOnClose(() => this.closeEnergyLayer('powerGrid'));
    this.energyPanel.mount();

    this.hydraulicPanel = new HydraulicPanel(floatContainer);
    this.hydraulicPanel.setOnClose(() => this.closeEnergyLayer('hydroBackbone'));
    this.hydraulicPanel.setOnSelectAsset((asset) => {
      this.mapContainer?.flyTo(asset.location.lon, asset.location.lat, 10.5);
    });
    this.hydraulicPanel.mount();

    this.eolienPanel = new EolienPanel(floatContainer);
    this.eolienPanel.setOnClose(() => this.closeEnergyLayer('windMonitor'));
    this.eolienPanel.setOnSelectPark((park) => {
      this.mapContainer?.flyTo(park.coordinates[0], park.coordinates[1], 9.8);
    });
    this.eolienPanel.mount();

    this.isnrPanel = new ISNRPanel(floatContainer);
    this.isnrPanel.setOnHoverDepartment((code) => {
      this.mapContainer?.highlightISNRDepartment(code);
    });
    // Click sur département : pas de flyTo (panel latéral uniquement, sans interaction carte)
    this.isnrPanel.mount();

    this.nationalHealthPanel = new NationalHealthPanel(floatContainer);
    this.nationalHealthPanel.mount();

    this.healthBarometerPanel = new HealthBarometerPanel(floatContainer);
    this.healthBarometerPanel.mount();

    void this.refreshNetworkBarometerWidget();
    this._intervalNetworkBarometer = setInterval(
      () => this.refreshNetworkBarometerWidget().catch(err => console.error('[App] Network barometer poll error', err)),
      POLL_NETWORK_BAROMETER_MS
    );

    document.addEventListener('open-national-health', () => {
      // Only open if at least one health layer is active
      const isAnyHealthLayerActive =
        this.activeLayers.health ||
        this.activeLayers.healthApl ||
        this.activeLayers.healthOscour ||
        this.activeLayers.hospitals;

      if (!isAnyHealthLayerActive) return;

      if (this.mapContainer?.getHealthFeatures) {
        const features = this.mapContainer.getHealthFeatures();
        if (features) {
          // Hide other floating panels
          this.environmentPanel?.hide();
          this.energyPanel?.hide();
          this.transportPanel?.hide();
          this.firesPanel?.hide();
          this.trafficPanel?.hide();
          this.isnrPanel?.hide();
          this.franceIntelPanel?.hide();

          this.nationalHealthPanel?.show(features);
        }
      }
    });

    document.addEventListener('open-health-barometer', () => {
      // Only open if at least one health layer is active
      const isAnyHealthLayerActive =
        this.activeLayers.health ||
        this.activeLayers.healthApl ||
        this.activeLayers.healthOscour ||
        this.activeLayers.hospitals;

      if (!isAnyHealthLayerActive) return;

      const metrics = (window as any).__healthBarometerMetrics ?? this.lastBarometerMetrics;
      if (metrics) {
        this.environmentPanel?.hide();
        this.energyPanel?.hide();
        this.transportPanel?.hide();
        this.firesPanel?.hide();
        this.trafficPanel?.hide();
        this.isnrPanel?.hide();
        this.franceIntelPanel?.hide();
        // Remove nationalHealthPanel?.hide() to allow both panels to be open simultaneously
        this.healthBarometerPanel?.show(metrics);
      }
    });

    // France Intelligence Panel — open on sidebar button click or map click
    document.addEventListener('open-france-intel', () => {
      void this.openFranceIntelPanel();
    });

    // Handle lang toggle from panel header button
    document.addEventListener('france-intel-lang-toggle', (e: Event) => {
      const { lang } = (e as CustomEvent<{ lang: 'fr' | 'en' }>).detail;
      const snapshot = this.buildFranceSnapshot(lang);
      this.franceIntelPanel?.show(snapshot);
      this.requestFranceIntelBrief(snapshot, lang);
    });

    this.transportPanel = new TransportPanel(floatContainer);
    this.transportPanel.setOnHover((disruption) => {
      this.mapContainer?.highlightTrainRoute(this.resolveRailFocusDisruption(disruption));
    });
    this.transportPanel.setOnSelect((disruption) => {
      const focusDisruption = this.resolveRailFocusDisruption(disruption);
      this.mapContainer?.highlightTrainRoute(focusDisruption);
      const departure = disruption?.departure?.coordinates ?? disruption?.coordinates ?? null;
      const arrival = disruption?.arrival?.coordinates ?? null;
      if (!departure) return;

      if (arrival) {
        const midLon = (departure[0] + arrival[0]) / 2;
        const midLat = (departure[1] + arrival[1]) / 2;
        this.mapContainer?.flyTo(midLon, midLat, 7);
      } else {
        this.mapContainer?.flyTo(departure[0], departure[1], 10);
      }
    });
    this.transportPanel.mount();

    this.firesPanel = new FiresPanel(floatContainer);
    this.firesPanel.mount();
    this.firesPanel.setOnFilteredFires((filtered) => {
      this.mapContainer?.updateFires(filtered);
    });
    this.firesPanel.setOnHoverFire((lat, lon) => {
      if (lat !== null && lon !== null) {
        this.mapContainer?.highlightFire(lat, lon);
      } else {
        this.mapContainer?.clearFireHighlight();
      }
    });
    this.firesPanel.setOnHoverIncident((points) => {
      if (points) {
        this.mapContainer?.highlightFireCluster(points);
      } else {
        this.mapContainer?.clearFireHighlight();
      }
    });
    this.firesPanel.setOnModisToggle((enabled) => {
      this.mapContainer?.setModisOverlayVisible(enabled);
    });
    this.firesPanel.setOnClose(() => {
      this.layoutEnvironmentFloatingPanels();
    });

    this.trafficPanel = new TrafficPanel(floatContainer);
    this.trafficPanel.setOnClickIncident((lng, lat) => {
      this.mapContainer?.flyTo(lng, lat, 14);
    });
    this.trafficPanel.mount();

    this.maritimePanel = new MaritimePanel(floatContainer);
    this.maritimePanel.setOnHighlightShip((mmsi) => {
      this.mapContainer?.setHighlightedShip(mmsi);
    });
    if (this.activeLayers.trafficMaritime) {
      this.maritimePanel.show();
    }

    // ElusPanel disabled

    // Cyber Panel (Cybersecurity Dashboard)
    this.cyberPanel = new CyberPanel(floatContainer);
    this.cyberPanel.setOnClose(() => {
      // Optional: could update StatusPanel state here
    });
    this.cyberPanel.mount();

    // Gas Panel (EcoGaz + Vital Organs Dashboard)
    this.gasPanel = new GasPanel(floatContainer);
    this.gasPanel.setOnClose(() => this.closeEnergyLayer('gasNetwork'));
    this.gasPanel.setPipelineCallback((show) => {
      this.mapContainer?.setGasPipelineVisible(show);
    });
    this.gasPanel.mount();

    // Oil Panel (Vigilance Pétrole - Raffineries, Stocks, Flux)
    this.oilPanel = new OilPanel(floatContainer);
    // skipLayout: oil panel doesn't use the energy floating stack
    this.oilPanel.setOnClose(() => this.closeEnergyLayer('oilNetwork', { skipLayout: true }));
    this.oilPanel.setOnFuelTensionMapVisibilityChange((visible) => {
      void this.mapContainer?.updateFuelTension(visible ? this.currentFuelTensionData : null);
    });
    this.oilPanel.mount();

    // Nuclear Panel (Veille Nucléaire — RTE unavailabilities + REMIT)
    this.nuclearPanel = new NuclearPanel(floatContainer);
    this.nuclearPanel.mount();
    this.nuclearPanel.setOnPlantHover((plantName) => {
      if (!plantName) {
        this.mapContainer?.setHighlightedInfrastructurePoint(null);
        return;
      }
      const plant = NUCLEAR_PLANTS.find((item) => item.name === plantName);
      this.mapContainer?.setHighlightedInfrastructurePoint(plant?.coordinates ?? null);
    });
    this.nuclearPanel.setOnClose(() => {
      // Clear any highlighted plant before deactivating the layer
      this.mapContainer?.setHighlightedInfrastructurePoint(null);
      this.closeEnergyLayer('nuclearFleet');
    });

    // Outages Panel (Pannes Réseau — incidents ORE Enedis)
    this.outagesPanel = new OutagesPanel(floatContainer);
    this.outagesPanel.setOnClose(() => {
      this.activeLayers.outages = false;
      this.activeLayers.outagesElec = false;
      this.activeLayers.outagesTelecom = false;
      this.activeLayers.outagesInternet = false;
      this.activeLayers.outagesCloud = false;
      this.mapContainer?.setLayerVisibility(this.getEffectiveLayers());
      this.layerPanel?.updateLayers(this.activeLayers);
    });
    this.outagesPanel.setOnDeptHover((code) => this.mapContainer?.highlightPowerDept(code));
    this.outagesPanel.setOnZoneHover((id) => this.mapContainer?.highlightCitizenZone(id));
    this.outagesPanel.setOnIspHover((data) => this.mapContainer?.highlightIsp(data));
    this.outagesPanel.setOnIodaHover((data) => this.mapContainer?.highlightIoda(data));
    this.outagesPanel.setOnDcHover((data) => this.mapContainer?.highlightDc(data));
    this.outagesPanel.setOnIxpHover((data) => this.mapContainer?.highlightIxp(data));
    this.outagesPanel.setOnTabChange((_tab) => {
      // Tab changes drive panel content only — layer dimming is driven exclusively
      // by legend card hover, not by which panel tab is active.
    });
    this.outagesPanel.setOnIspClick((data) => this.mapContainer?.flyTo(data.coordinates[0], data.coordinates[1], 7));
    this.outagesPanel.setOnIodaClick((data) => this.mapContainer?.flyTo(data.coordinates[0], data.coordinates[1], 6));
    this.outagesPanel.setOnDcClick((data) => this.mapContainer?.flyTo(data.coordinates[0], data.coordinates[1], 13));
    this.outagesPanel.setOnIxpClick((data) => this.mapContainer?.flyTo(data.coordinates[0], data.coordinates[1], 13));
    this.outagesPanel.mount();

    // Defense Panel (Cable threats) - positioned below CyberPanel
    this.defensePanel = new DefensePanel(floatContainer);
    this.defensePanel.setOnClose(() => {
      // Optional: could update StatusPanel state here
    });
    this.defensePanel.setOnAlertClick((alert) => {
      if (!this.activeLayers.trafficMaritime && AIS_RELAY_URL) {
        this.onLayerToggle('trafficMaritime', true);
        this.layerPanel?.updateLayers(this.activeLayers);
      }
      if (!this.activeLayers.subseaCables) {
        this.onLayerToggle('subseaCables', true);
        this.layerPanel?.updateLayers(this.activeLayers);
      }
      // Fly to the threat location when clicking on an alert item
      this.mapContainer?.flyTo(alert.coordinates[0], alert.coordinates[1], 10);
    });
    this.defensePanel.setOnJammingClick((signal) => {
      const zoom = signal.clusterRadius != null
        ? (signal.clusterRadius > 50 ? 8 : 9)
        : 11;
      this.mapContainer?.flyTo(signal.position[0], signal.position[1], zoom);
    });
    this.defensePanel.mount();

    // Day/Night Panel (panneau latéral droit — contrôle terminateur)
    this.dayNightPanel = new DayNightPanel(this.container);
    this.dayNightPanel.setOnChange((opts) => {
      this.mapContainer?.updateDayNightOptions({
        showNight: opts.showNight,
        showTwilight: opts.showTwilight,
        showSunIcon: opts.showSunIcon,
        timestamp: opts.timestamp,
      });
    });
    this.dayNightPanel.mount();

    // Layer toggles now in header (UnifiedSettings modal)

    // ── Search Modal ──
    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        void this.ensureSearchModal().then((modal) => modal.show());
      }
    });

    // ── Clock ──
    this.startClock();
  }

  private renderRegionPresets(container: HTMLElement): void {
    const presets = [
      'france', 'idf', 'paca', 'bretagne', 'grandest',
      'guadeloupe', 'martinique', 'guyane', 'reunion', 'mayotte'
    ];

    const listEl = document.createElement('div');
    listEl.className = 'region-presets-list';

    const selectEl = document.createElement('select');
    selectEl.className = 'region-preset-select';
    selectEl.setAttribute('aria-label', 'Choisir une région');

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Régions';
    placeholder.selected = true;
    selectEl.appendChild(placeholder);

    for (const key of presets) {
      const preset = VIEW_PRESETS[key];
      if (!preset) continue;

      const btn = document.createElement('button');
      btn.className = 'region-preset-btn';
      btn.textContent = preset.name;
      btn.addEventListener('click', () => {
        this.mapContainer?.flyTo(preset.center[0], preset.center[1], preset.zoom);
      });
      listEl.appendChild(btn);

      const option = document.createElement('option');
      option.value = key;
      option.textContent = preset.name;
      selectEl.appendChild(option);
    }

    selectEl.addEventListener('change', () => {
      const preset = VIEW_PRESETS[selectEl.value];
      if (preset) {
        this.mapContainer?.flyTo(preset.center[0], preset.center[1], preset.zoom);
      }
    });

    container.appendChild(listEl);
    container.appendChild(selectEl);

    let requiredWidth = 0;
    let compact = false;
    const syncCompactMode = (): void => {
      if (requiredWidth === 0) {
        const previousCompact = container.dataset['compact'];
        container.dataset['compact'] = 'false';
        requiredWidth = listEl.scrollWidth;
        if (previousCompact) {
          container.dataset['compact'] = previousCompact;
        } else {
          delete container.dataset['compact'];
        }
      }

      const availableWidth = container.clientWidth;
      const nextCompact = compact
        ? requiredWidth > availableWidth - 40
        : requiredWidth > availableWidth - 8;

      compact = nextCompact;
      container.dataset['compact'] = compact ? 'true' : 'false';
    };

    requestAnimationFrame(syncCompactMode);
    window.addEventListener('resize', syncCompactMode);

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => syncCompactMode());
      observer.observe(container);
      observer.observe(listEl);
    }
  }

  private handleSourcePanelClick(name: string): void {
    this.environmentPanel?.hide();
    this.energyPanel?.hide();
    this.eolienPanel?.hide();
    this.transportPanel?.hide();
    this.firesPanel?.hide();
    this.trafficPanel?.hide();
    this.isnrPanel?.hide();
    this.nationalHealthPanel?.hide();
    this.franceIntelPanel?.hide();

    if (name === 'Météo-France' || name === 'Vigicrues') {
      this.environmentPanel?.show(this.currentMeteoAlerts, this.currentFloodSegments, this.currentMeteoTimeline ?? undefined);
      this.layoutEnvironmentFloatingPanels();
    } else if (name === 'Éolien France') {
      this.eolienPanel?.show(this.currentEolienLive, this.currentEolienParks);
      this.layoutEnergyFloatingPanels();
    } else if (name === 'SNCF') {
      this.transportPanel?.show(this.currentSncfDisruptions);
    } else if (name === 'NASA FIRMS') {
      this.firesPanel?.show(this.currentActiveFires);
      this.layoutEnvironmentFloatingPanels();
    } else if (name === 'Trafic') {
      this.trafficPanel?.show(this.currentTrafficIncidents);
    } else if (name === 'Cyber') {
      this.cyberPanel?.show(this.currentCyberData);
    } else if (name === 'Écowatt RTE') {
      this.energyPanel?.show(this.currentEcowattResponse);
    } else if (
      name === 'ARCEP Réseau Mobile' ||
      name === 'Enedis / Pannes Électricité' ||
      name === 'Infra Réseau DC / IXP' ||
      name === 'IODA Internet'
    ) {
      this.outagesPanel?.show(
        this.currentPowerOutages,
        this.currentTelecomOutages,
        this.currentNetworkState,
        this.currentInfraState,
        this.currentCitizenZones ?? undefined,
      );
    } else if (name === 'Réseau Gaz / EcoGaz') {
      if (this.currentGasData) this.gasPanel?.show(this.currentGasData);
    } else if (name === 'Pétrole SDES / INSEE') {
      if (this.currentOilData) this.oilPanel?.show(this.currentOilData, this.currentFuelTensionData);
    } else if (name === 'Vols Militaires ADS-B') {
      this.defensePanel?.show(this.currentDefenseAlerts, this.currentJammingSignals);
    } else if (name === 'Feux NASA FIRMS') {
      this.firesPanel?.show(this.currentActiveFires);
      this.layoutEnvironmentFloatingPanels();
    } else if (name === 'Marchés Financiers') {
      if (this.currentMarketData.length > 0) this.financePanel?.show(this.currentMarketData);
    } else if (name === 'Santé SPF / DREES') {
      if (this.currentHealthFeatures) this.nationalHealthPanel?.show(this.currentHealthFeatures);
    }
  }

  private getEffectiveLayers(): MapLayers {
    const effective: MapLayers = { ...this.activeLayers };
    effective.traffic =
      effective.trafficRoad ||
      effective.trafficMaritime ||
      effective.trafficAir ||
      effective.trafficRail;
    const groupsOn = new Set(
      LAYER_CONFIGS
        .filter(l => l.role === "groupMaster" && effective[l.id])
        .map(l => l.groupId)
    );

    for (const config of LAYER_CONFIGS) {
      if (this.activeLayers[config.id] && config.role === 'child' && config.dependsOnGroup) {
        effective[config.id] = groupsOn.has(config.groupId);
      }
    }
    return effective;
  }

  private updateBarometerFabVisibility(): void {
    const fab = document.getElementById('barometer-fab');

    const isAnyHealthLayerActive =
      this.activeLayers.health ||
      this.activeLayers.healthApl ||
      this.activeLayers.healthOscour ||
      this.activeLayers.hospitals;

    // Hide FAB when no health layer is active
    if (fab) {
      fab.style.display = isAnyHealthLayerActive ? 'block' : 'none';
    }

    // Also hide health panels when no health layer is active
    if (!isAnyHealthLayerActive) {
      this.healthBarometerPanel?.hide();
      this.nationalHealthPanel?.hide();
    }
  }

  /**
   * Shared close handler for panels whose layer belongs to the energy group
   * (powerGrid, hydroBackbone, windMonitor, gasNetwork, oilNetwork, nuclearFleet).
   *
   * Deactivates the layer, recomputes the energySystems aggregate flag,
   * syncs the LayerPanel toggle UI, refreshes map visibility, and — unless
   * skipLayout is true — restacks the energy floating panels.
   *
   * Usage in setOnClose:
   *   this.energyPanel.setOnClose(() => this.closeEnergyLayer('powerGrid'));
   */
  private closeEnergyLayer(layerKey: keyof MapLayers, opts: { skipLayout?: boolean } = {}): void {
    this.activeLayers[layerKey] = false;
    this.activeLayers.energySystems = hasActiveEnergySystems(this.activeLayers);
    this.layerPanel?.updateLayers(this.activeLayers);
    this.mapContainer?.setLayerVisibility(this.getEffectiveLayers());
    if (!opts.skipLayout) this.layoutEnergyFloatingPanels();
  }

  private onLayerToggle(key: keyof MapLayers, enabled: boolean): void {
    this.activeLayers[key] = enabled;
    this._syncGroupFlags(key, enabled);

    this.mapContainer?.setLayerVisibility(this.getEffectiveLayers());
    this.refreshLegendVisibility();
    this.refreshTrafficLegend();

    // Persist layer state across sessions
    try {
      localStorage.setItem('fm-active-layers', JSON.stringify(this.activeLayers));
    } catch (err) {
      console.warn('[App] localStorage quota exceeded, could not persist layer state', err);
    }
    writeUrlState({ layers: this.activeLayers });

    this.updateBarometerFabVisibility();

    // AIS loader lifecycle — show while waiting for first ship data, hide when layer off
    if (key === 'trafficMaritime' && !enabled && this._aisLoaderEl) {
      this._aisLoaderEl.remove();
      this._aisLoaderEl = null;
    }
    if (key === 'trafficMaritime' && enabled && getAllLiveTraffic().length === 0) {
      this._showAisLoaderFn?.();
    }

    // Road traffic data is loaded on-demand (not pre-fetched) to save bandwidth
    if (key === 'trafficRoad') {
      if (enabled) {
        void this.ensureTrafficLoaded().catch((error) => {
          console.error('[App] Failed to load road traffic on demand', error);
        });
      } else if (!this.activeLayers.trafficRoad) {
        this.mapContainer?.updateTrafficIncidents([]);
      }
    }
    this._handlePanelVisibility(key, enabled);
  }

  /**
   * Recalculate aggregate group flags after a child layer is toggled.
   * Called at the top of onLayerToggle, before any map or panel update.
   *
   * Group flags (energySystems, environmentGroup, …) are derived values:
   * they're true when at least one child layer in the group is active.
   * They drive group-level toggles in the LayerPanel and guard panel show/hide.
   */
  private _syncGroupFlags(key: keyof MapLayers, enabled: boolean): void {
    // If a child layer was enabled, also enable its parent group
    const toggledConfig = LAYER_CONFIGS.find((config) => config.id === key);
    if (enabled && toggledConfig?.role === 'child' && toggledConfig.dependsOnGroup && toggledConfig.groupId) {
      const parentConfig = LAYER_CONFIGS.find(
        (config) => config.role === 'groupMaster' && config.groupId === toggledConfig.groupId
      );
      if (parentConfig) {
        this.activeLayers[parentConfig.id] = true;
      }
    }

    if (key === 'military' || key === 'subseaCables' || key === 'cyber') {
      this.activeLayers.sovereignty =
        this.activeLayers.military || this.activeLayers.subseaCables || this.activeLayers.cyber;
    }
    if (ENERGY_SYSTEM_LAYER_KEYS.includes(key as typeof ENERGY_SYSTEM_LAYER_KEYS[number])) {
      this.activeLayers.energySystems = hasActiveEnergySystems(this.activeLayers);
    }
    if (key === 'environmental' || key === 'weatherRadar' || key === 'fires' || key === 'dayNight') {
      this.activeLayers.environmentGroup =
        this.activeLayers.environmental ||
        this.activeLayers.weatherRadar ||
        this.activeLayers.fires ||
        (this.activeLayers.dayNight ?? false);
    }
    if (key === 'trafficRoad' || key === 'trafficMaritime' || key === 'trafficAir' || key === 'trafficRail') {
      this.syncTrafficGroupState();
    }
    if (key === 'outagesElec' || key === 'outagesTelecom' || key === 'outagesInternet' || key === 'outagesCloud') {
      this.activeLayers.outages =
        this.activeLayers.outagesElec ||
        this.activeLayers.outagesTelecom ||
        this.activeLayers.outagesInternet ||
        this.activeLayers.outagesCloud;
    }
    if (key === 'news' || key === 'stability') {
      this.activeLayers.newsGroup = this.activeLayers.news || this.activeLayers.stability;
    }
  }

  /**
   * Show or hide the panel that corresponds to the toggled layer.
   *
   * Some layers have no panel (subseaCables: visual-only).
   * Some panels are shared across child layers (outages tab auto-switch).
   * Some trigger lazy data loads if the data hasn't been fetched yet.
   *
   * Called at the end of onLayerToggle, after map visibility and state
   * have already been updated.
   */
  private _handlePanelVisibility(key: keyof MapLayers, enabled: boolean): void {
    // Traffic panels — standalone ifs so both run if key matches both (impossible in
    // practice but safe: they guard on the specific key value).
    if (key === 'trafficMaritime') {
      if (enabled) this.maritimePanel?.show();
      else this.maritimePanel?.hide();
    }
    if (key === 'trafficRail') {
      if (enabled) this.transportPanel?.show(this.currentSncfDisruptions);
      else this.transportPanel?.hide();
    }

    // All remaining panels use an if/else chain — at most one branch fires per toggle.
    if (key === 'stability') {
      if (this.activeLayers.stability && this.currentISNRData) this.isnrPanel?.show(this.currentISNRData);
      else this.isnrPanel?.hide();
    } else if (key === 'energySystems') {
      // Group master turned off: collapse all energy panels
      if (!this.activeLayers.energySystems) {
        this.energyPanel?.hide();
        this.layoutEnergyFloatingPanels();
      }
    } else if (key === 'environmentGroup') {
      // Group master turned off: collapse all environment panels
      if (!this.activeLayers.environmentGroup) {
        this.environmentPanel?.hide();
        this.firesPanel?.hide();
        this.dayNightPanel?.hide();
        this.layoutEnvironmentFloatingPanels();
      }
    } else if (key === 'environmental') {
      if (enabled) this.environmentPanel?.show(this.currentMeteoAlerts, this.currentFloodSegments, this.currentMeteoTimeline ?? undefined);
      else this.environmentPanel?.hide();
      this.layoutEnvironmentFloatingPanels();
    } else if (key === 'health' || key === 'healthApl' || key === 'healthOscour' || key === 'hospitals') {
      const anyHealthActive =
        this.activeLayers.health || this.activeLayers.healthApl ||
        this.activeLayers.healthOscour || this.activeLayers.hospitals;
      // Lazy-load health data on first activation
      if (enabled && !this.hasHealthData) {
        this.loadHealth().catch((err) => console.error('[App] Failed to load health layers', err));
      }
      if (enabled && anyHealthActive) {
        document.dispatchEvent(new CustomEvent('open-national-health'));
      } else if (!anyHealthActive) {
        this.healthBarometerPanel?.hide();
        this.nationalHealthPanel?.hide();
      }
    } else if (key === 'sovereignty') {
      // Group master: show/hide child panels based on which sub-layers are active
      if (!this.activeLayers.sovereignty) {
        this.cyberPanel?.hide();
        this.defensePanel?.hide();
      } else {
        if (this.activeLayers.cyber) {
          if (!this.currentCyberData) this.loadCyber();
          this.cyberPanel?.show(this.currentCyberData);
        }
        if (this.activeLayers.military) {
          this.defensePanel?.show(this.currentDefenseAlerts, this.currentJammingSignals);
        }
      }
    } else if (key === 'cyber') {
      if (this.activeLayers.cyber && this.activeLayers.sovereignty) {
        if (!this.currentCyberData) this.loadCyber(); // lazy-load on first enable
        this.cyberPanel?.show(this.currentCyberData);
      } else {
        this.cyberPanel?.hide();
      }
    } else if (key === 'military') {
      if (this.activeLayers.military && this.activeLayers.sovereignty) {
        this.defensePanel?.show(this.currentDefenseAlerts, this.currentJammingSignals);
      } else {
        this.defensePanel?.hide();
      }
    } else if (key === 'subseaCables') {
      // Visual-only layer — no panel to toggle.
    } else if (key === 'powerGrid') {
      if (this.activeLayers.powerGrid) this.energyPanel?.show(this.currentEcowattResponse);
      else this.energyPanel?.hide();
      this.layoutEnergyFloatingPanels();
    } else if (key === 'hydroBackbone') {
      if (this.activeLayers.hydroBackbone) {
        void this.refreshHydraulicSignalSources();
        this.hydraulicPanel?.show(this.currentHydraulicAssets, this.currentEcowattResponse);
      } else {
        this.hydraulicPanel?.hide();
      }
      this.layoutEnergyFloatingPanels();
    } else if (key === 'windMonitor') {
      if (this.activeLayers.windMonitor) {
        void this.loadEolien();
        this.eolienPanel?.show(this.currentEolienLive, this.currentEolienParks);
      } else {
        this.eolienPanel?.hide();
      }
      this.layoutEnergyFloatingPanels();
    } else if (key === 'gasNetwork') {
      if (this.activeLayers.gasNetwork) {
        if (!this.currentGasData) this.loadGas(); // lazy-load on first enable
        this.gasPanel?.show(this.currentGasData);
        this.layoutEnergyFloatingPanels();
      } else {
        this.gasPanel?.hide();
        this.layoutEnergyFloatingPanels();
      }
    } else if (key === 'oilNetwork') {
      if (this.activeLayers.oilNetwork) {
        if (!this.currentOilData) void this.loadOil(); // lazy-load on first enable
        this.oilPanel?.show(this.currentOilData, this.currentFuelTensionData);
      } else {
        this.oilPanel?.hide();
      }
    } else if (key === 'nuclearFleet') {
      if (this.activeLayers.nuclearFleet) {
        const nuclearInfra = this.currentNuclearState
          ? buildEnergyInfrastructurePoints(this.currentNuclearState.unavailabilities)
          : buildEnergyInfrastructurePoints();
        this.mapContainer?.updateInfrastructure(nuclearInfra);
        if (!this.currentNuclearState) void this.loadNuclear(); // lazy-load on first enable
        this.nuclearPanel?.show(this.currentNuclearState, this.currentEcowattResponse);
        this.layoutEnergyFloatingPanels();
      } else {
        this.nuclearPanel?.hide();
        this.layoutEnergyFloatingPanels();
      }
    } else if (key === 'fires') {
      if (this.activeLayers.fires) this.firesPanel?.show(this.currentActiveFires);
      else this.firesPanel?.hide();
      this.layoutEnvironmentFloatingPanels();
    } else if (key === 'dayNight') {
      if (enabled) this.dayNightPanel?.show();
      else this.dayNightPanel?.hide();
    } else if (key === 'elus') {
      void this.mapContainer?.setMairesPolitiqueVisible(false);
    } else if (key === 'outages') {
      // Group master turned off — collapse the panel
      if (!this.activeLayers.outages) this.outagesPanel?.hide();
    } else if (key === 'outagesElec' || key === 'outagesTelecom' || key === 'outagesInternet' || key === 'outagesCloud') {
      if (this.activeLayers.outages) {
        // Auto-switch to the active tab when exactly one sub-layer is on
        const activeCount = [
          this.activeLayers.outagesElec,
          this.activeLayers.outagesTelecom,
          this.activeLayers.outagesInternet,
          this.activeLayers.outagesCloud,
        ].filter(Boolean).length;
        let autoTab: 'electric' | 'telecom' | 'internet' | 'cloud' | undefined;
        if (activeCount === 1) {
          if (this.activeLayers.outagesElec)          autoTab = 'electric';
          else if (this.activeLayers.outagesTelecom)  autoTab = 'telecom';
          else if (this.activeLayers.outagesInternet) autoTab = 'internet';
          else if (this.activeLayers.outagesCloud)    autoTab = 'cloud';
        }
        this.outagesPanel?.show(
          this.currentPowerOutages, this.currentTelecomOutages,
          this.currentNetworkState, this.currentInfraState,
          this.currentCitizenZones ?? undefined, autoTab
        );
      } else {
        this.outagesPanel?.hide();
      }
    }
  }

  // ─── Map ────────────────────────────────────────────────────────────────────

  private async initMap(): Promise<void> {
    const mapEl = document.getElementById('map-container');
    if (!mapEl) return;

    this.mapContainer = new MapContainer(mapEl);

    this.mapContainer.setOnItemHover((item, x, y) => {
      if (item) {
        this.mapPopup?.show(item, x, y);
        this.newsPanel?.highlightItem(item.id);
      } else {
        this.mapPopup?.hide();
        this.newsPanel?.highlightItem();
      }
    });

    this.mapContainer.setOnItemClick((item) => {
      this.mapPopup?.hide();
      this.mapContainer?.selectItem(item);
      this.newsPanel?.selectItem(item.id);
      if (item.lon != null && item.lat != null) {
        this.mapContainer?.flyTo(item.lon, item.lat, 12);
      }
      this.routeGovernmentContextForItem(item);
    });

    // Cluster hover: show popup with list of articles
    this.mapContainer.setOnClusterHover((items, x, y, totalCount) => {
      if (items.length > 0) {
        this.mapPopup?.showCluster(items, x, y, totalCount);
      } else {
        // Use hideCluster() - not hide() - to properly exit cluster mode
        this.mapPopup?.hideCluster();
      }
    });

    // Cluster click at max zoom: show all articles in side panel
    this.mapContainer.setOnClusterClick((items, center) => {
      if (items.length === 0) return;
      console.log(`[App] Cluster clicked at max zoom: ${items.length} articles at [${center[0].toFixed(3)}, ${center[1].toFixed(3)}]`);

      // Select the first item to highlight in the panel
      const firstItem = items[0];
      this.newsPanel?.selectItem(firstItem.id);

    });


    // Raw map click → élus panel (clic direct sur la carte, hors articles/clusters)
    this.mapContainer.setOnRawMapClick((_lat, _lon) => {
    });

    this.mapContainer.setOnSatelliteView((request) => {
      this.mapContainer?.setSentinelSceneOverlay(null);
      this.mapContainer?.fitBounds(request.bbox, 80);
      void this.ensureSentinelModal().then((modal) => modal.show(request));
    });

    // Handle military flight clicks → show detailed popup
    this.mapContainer.setOnMilitaryFlightClick((flight, x, y) => {
      if (this.mapPopup) {
        this.mapPopup.showMilitaryFlight(flight, x, y);
      }
    });

    // Handle military base clicks → show detailed popup
    this.mapContainer.setOnMilitaryBaseClick((base, x, y) => {
      if (this.mapPopup) {
        this.mapPopup.showMilitaryBase(base, x, y);
      }
    });

    // Handle military ship clicks → show detailed popup
    this.mapContainer.setOnMilitaryShipClick((ship, x, y) => {
      if (this.mapPopup) {
        this.mapPopup.showMilitaryShip(ship, x, y);
      }
    });

    // Maritime ship click → open MaritimePanel modal
    this.mapContainer.setOnMaritimeShipClick((ship) => {
      this.mapContainer?.setSelectedShip(ship.mmsi ?? null);
      this.maritimePanel?.openShipModal(ship);
    });

    // Sync URL when map view changes
    this.mapContainer.setOnViewChange((vs) => {
      writeUrlState({
        lng: vs.longitude,
        lat: vs.latitude,
        zoom: vs.zoom,
        layers: this.activeLayers,
      });
    });

    await this.mapContainer.init();
    this.alertMonitor?.destroy();
    this.alertMonitor = new AlertMonitor(mapEl);
    this.situationMonitor?.destroy();
    this.situationMonitor = new SituationMonitor(mapEl);
    this.situationMonitor.setOnLayerActivate((layerKeys) => {
      for (const key of layerKeys) {
        if (key in this.activeLayers && !this.activeLayers[key as keyof typeof this.activeLayers]) {
          this.onLayerToggle(key as keyof typeof this.activeLayers, true);
        }
      }
    });
    this.situationMonitor.setOnFlyTo((lon, lat, zoom) => {
      this.mapContainer?.flyTo(lon, lat, zoom ?? 10);
    });
    this.situationHistoryPanel?.destroy();
    this.situationHistoryPanel = new SituationHistoryPanel(mapEl);
    const historyWrap = document.querySelector<HTMLElement>('.sit-hist-wrap');
    if (historyWrap) {
      this.situationHistoryPanel.mount(historyWrap);
    }
    this.mapPopup = new MapPopup(mapEl);

    // Initialize map legend
    this.mapLegend = new MapLegend(mapEl);
    this.mapLegend.init();

    // Wire map hover interactions
    this.mapLegend.setOnHover((categoryId) => {
      this.mapContainer?.setLegendHover(categoryId);
    });

    this.mapLegend.addCategory(NEWS_LEGEND);
    this.mapLegend.addCategory(ROAD_TRAFFIC_LEGEND);
    this.mapLegend.addCategory(MARITIME_TRAFFIC_LEGEND);
    this.mapLegend.addCategory(AIR_TRAFFIC_LEGEND);
    // Rail legend is embedded in TransportPanel — not in the bottom map legend
    this.mapLegend.addCategory(HEALTH_ISS_LEGEND);
    this.mapLegend.addCategory(HEALTH_APL_LEGEND);
    this.mapLegend.addCategory(HEALTH_OSCOUR_LEGEND);
    this.mapLegend.addCategory(HOSPITALS_LEGEND);
    this.mapLegend.addCategory(ENERGY_ECOWATT_LEGEND);
    this.mapLegend.addCategory(NUCLEAR_LEGEND);
    this.mapLegend.addCategory(GAS_LEGEND);
    this.mapLegend.addCategory(HYDRAULIC_LEGEND);
    this.mapLegend.addCategory(OIL_LEGEND);
    this.mapLegend.addCategory(EOLIEN_LEGEND);

    this.mapLegend.addCategory(METROPOLES_ELECTRIC_LEGEND);
    this.mapLegend.addCategory(ENVIRONMENTAL_LEGEND);
    this.mapLegend.addCategory(WEATHER_RADAR_LEGEND);
    this.mapLegend.addCategory(MILITARY_LEGEND);
    this.mapLegend.addCategory(SUBSEA_CABLES_LEGEND);
    this.mapLegend.addCategory(CYBER_LEGEND);
    this.mapLegend.addCategory(OUTAGES_ELEC_LEGEND);
    this.mapLegend.addCategory(OUTAGES_TELECOM_LEGEND);
    this.mapLegend.addCategory(OUTAGES_INTERNET_LEGEND);
    this.mapLegend.addCategory(OUTAGES_CLOUD_LEGEND);
    this.refreshEnergyDataLegends();

    this.refreshLegendVisibility();
    this.refreshTrafficLegend();

    // Handle click on single item popup -> open article link
    this.mapPopup.setOnItemClick((item) => {
      console.log('[App] Popup item clicked:', item.title, item.link);
      if (item.link) {
        window.open(item.link, '_blank', 'noopener,noreferrer');
      }
    });

    // Handle clicks on items in the cluster popup
    this.mapPopup.setOnClusterItemClick((item) => {
      console.log('[App] Cluster item clicked:', item.title);
      // Open the article link
      if (item.link) {
        window.open(item.link, '_blank', 'noopener,noreferrer');
      }
    });

    // Handle "Cliquez pour voir tout" in cluster popup
    this.mapPopup.setOnClusterExpand((items) => {
      console.log('[App] Cluster expand requested:', items.length, 'items');
      // Select the first item and scroll panel to show all related items
      if (items.length > 0) {
        this.newsPanel?.selectItem(items[0].id);
      }
    });
  }

  // ─── Data ────────────────────────────────────────────────────────────────────

  // ─── RSS Pipeline ──────────────────────────────────────────────────────────

  private startRSSPipeline(): void {
    // First fetch immediately
    this.fetchAndProcessRSS();
    // Poll every 5 min
    this._intervalRSS = setInterval(() => this.fetchAndProcessRSS().catch(err => console.error('[App] RSS poll error', err)), RSS_POLL_INTERVAL_MS);
  }

  private startMilitaryPolling(): void {
    connectAis();
    const fetchFlights = async () => {
      try {
        this.statusPanel?.updateSource('Vols militaires', {
          status: 'loading',
          lastUpdate: null,
          detail: 'adsb.fi -> airplanes.live -> OpenSky',
          error: undefined,
        });
        const snapshot = await fetchMilitaryFlights();
        const flights = snapshot.flights;
        this.currentMilitaryFlightsCount = flights.length;
        this.mapContainer?.updateMilitaryFlights(flights);
        this.refreshFranceIntelPanel();

        const sourceBreakdown = Object.entries(snapshot.sourceCounts)
          .filter(([, count]) => count > 0)
          .map(([source, count]) => `${source} ${count}`)
          .join(' + ');
        const modeLabel =
          snapshot.mode === 'empty'
            ? 'VIDE'
            : snapshot.mode === 'stale-cache'
              ? 'CACHE'
              : snapshot.errors.length > 0
                ? 'DEGRADE'
                : 'LIVE';
        const detail = `${modeLabel} · ${sourceBreakdown || snapshot.source}${snapshot.errors.length > 0 ? ` · fallback ${snapshot.errors.map((e) => e.source).join(', ')}` : ''}`;
        this.statusPanel?.updateSource('Vols militaires', {
          status: snapshot.mode === 'empty' || snapshot.mode === 'stale-cache' || snapshot.errors.length > 0 ? 'stale' : 'ok',
          lastUpdate: new Date(snapshot.fetchedAt),
          detail,
          error: undefined,
        });

        // Detect and display military surges (WorldMonitor pattern)
        const surges = detectMilitarySurges(
          flights.map((f) => ({
            latitude: f.latitude,
            longitude: f.longitude,
            aircraftType: f.aircraftType,
            squawkAlert: f.squawkAlert,
          }))
        );
        this.currentMilitarySurges = surges;
        if (surges.length > 0) {
          const emergencies = surges.filter((s) => s.type === 'emergency');
          if (emergencies.length > 0) {
            this.statusPanel?.updateSource('Vols militaires', {
              status: 'error',
              lastUpdate: new Date(),
              detail,
              error: emergencies[0].description,
            });
          }
        }

        // Détection brouillage GPS / guerre électronique (heuristique ADS-B)
        const jammingSignals = detectGpsJammingSignals(flights);
        this.currentJammingSignals = jammingSignals;
        this.defensePanel?.update(this.currentDefenseAlerts, jammingSignals);
        this.refreshFranceIntelPanel();
      } catch (err) {
        console.error('[Military] Failed to fetch flights', err);
        this.currentMilitarySurges = [];
        this.currentJammingSignals = [];
        this.refreshFranceIntelPanel();
        this.statusPanel?.updateSource('Vols militaires', {
          status: 'error',
          lastUpdate: new Date(),
          detail: 'adsb.fi -> airplanes.live -> OpenSky',
          error: err instanceof Error ? err.message : 'Échec vols militaires',
        });
      }
    };
    fetchFlights();
    // ADS-B: refresh frequently enough to feel live without hammering sources.
    this._intervalMilitaryFlights = setInterval(() => fetchFlights().catch(err => console.error('[App] Military flights poll error', err)), 5_000);

    // Ships: refresh map frequently; heavier cable analysis stays throttled below.
    const AIS_UI_REFRESH_MS = 5_000;
    const AIS_ALERT_REFRESH_MS = 30_000;
    let initialRetryCount = 0;

    const showAisLoader = () => {
      if (this._aisLoaderEl) return;
      const el = document.createElement('div');
      el.id = 'ais-loader';
      el.style.cssText = [
        'position:fixed',      // fixed sur le viewport, pas clipé par overflow:hidden
        'bottom:80px',
        'left:50%',
        'transform:translateX(-50%)',
        'z-index:9000',
        'display:flex',
        'align-items:center',
        'gap:8px',
        'background:rgba(14,14,22,0.90)',
        'border:1px solid rgba(96,165,250,0.35)',
        'border-radius:20px',
        'padding:7px 16px 7px 12px',
        'font-size:12px',
        'font-family:system-ui,sans-serif',
        'color:#93c5fd',
        'pointer-events:none',
        'backdrop-filter:blur(8px)',
        'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
      ].join(';');
      el.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 14 14" style="flex-shrink:0;animation:ais-spin 1s linear infinite">
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="rgba(96,165,250,0.2)" stroke-width="1.5"/>
          <path d="M7 1.5 A5.5 5.5 0 0 1 12.5 7" fill="none" stroke="#60a5fa" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <span>Chargement AIS maritime…</span>
      `;
      if (!document.getElementById('ais-loader-style')) {
        const style = document.createElement('style');
        style.id = 'ais-loader-style';
        style.textContent = '@keyframes ais-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
        document.head.appendChild(style);
      }
      document.body.appendChild(el);   // body, pas map-container (overflow:hidden)
      this._aisLoaderEl = el;
    };
    this._showAisLoaderFn = showAisLoader; // Expose so onLayerToggle can trigger it

    const hideAisLoader = () => {
      if (!this._aisLoaderEl) return;
      this._aisLoaderEl.style.transition = 'opacity 0.4s ease';
      this._aisLoaderEl.style.opacity = '0';
      setTimeout(() => {
        this._aisLoaderEl?.remove();
        this._aisLoaderEl = null;
      }, 420);
    };
    const MAX_INITIAL_RETRIES = 5;
    let lastDefenseAlertUpdate = 0;

    const updateShips = async () => {
      try {
        const aisStatus = getAisStatus();
        const aisRelayLabel = AIS_RELAY_URL ?? 'Non configuré';
        const aisDetail = `${aisRelayLabel} · ${aisStatus.shipCount} navire${aisStatus.shipCount > 1 ? 's' : ''} · ${aisStatus.messageCount} msg`;
        this.statusPanel?.updateSource('AIS maritime', {
          status: aisStatus.connected ? (aisStatus.shipCount > 0 ? 'ok' : 'loading') : 'error',
          lastUpdate: aisStatus.connected ? new Date() : null,
          detail: aisStatus.connected ? aisDetail : aisRelayLabel,
          error: aisStatus.connected ? undefined : 'relais déconnecté',
        });

        // Navires Marine Nationale pour l'affichage sur la carte (icônes dédiées)
        const militaryShips = getMilitaryShips();
        this.mapContainer?.updateMilitaryShips(militaryShips);

        // Use exported NAVY_MMSI_SET (sovereign whitelist) - more reliable than runtime-built set
        const navyMmsiSet = NAVY_MMSI_SET;

        // Tout le trafic AIS mondial (civils, étrangers, etc.)
        const allTraffic = getAllLiveTraffic();
        this.currentMaritimeTrafficFranceCount = getAllLiveTraffic(10 * 60 * 1000, true).length;

        if (allTraffic.length > 0) {
          this._aisZeroWarnLogged = false; // Reset so we can warn again if connection drops
          initialRetryCount = MAX_INITIAL_RETRIES; // Stop fast retries once we have data
          hideAisLoader();
        } else {
          // Show loader only when maritime layer is active
          if (this.activeLayers.trafficMaritime) showAisLoader();
          if (!this._aisZeroWarnLogged) {
            this._aisZeroWarnLogged = true;
            // Fast retry during initial connection (WebSocket may not have data yet)
            if (initialRetryCount < MAX_INITIAL_RETRIES) {
              initialRetryCount++;
              setTimeout(updateShips, 2000);
            }
          }
        }

        // ALWAYS push to map, even with 0 ships (initializes the layer)
        this.mapContainer?.updateGlobalTraffic([...allTraffic], navyMmsiSet);

        // Détection anomalies AIS (radio silence, rendezvous suspects)
        const aisAnomalies = detectAisAnomalies(allTraffic);
        const AIS_ANOMALY_TTL_MS = 30 * 60 * 1000;
        const cutoff = Date.now() - AIS_ANOMALY_TTL_MS;
        this.currentAisAnomalies = [
          ...this.currentAisAnomalies.filter((anomaly) => anomaly.timestamp >= cutoff),
          ...aisAnomalies,
        ];
        this.refreshFranceIntelPanel();

        // Détection de menaces sur câbles (plus coûteuse) à cadence réduite.
        const now = Date.now();
        if (now - lastDefenseAlertUpdate >= AIS_ALERT_REFRESH_MS) {
          lastDefenseAlertUpdate = now;
          await this.loadDefenseAlerts(allTraffic, navyMmsiSet);
        }
      } catch (err) {
        console.error('[Military Ships] Failed to update', err);
        this.statusPanel?.updateSource('AIS maritime', {
          status: 'error',
          lastUpdate: new Date(),
          detail: AIS_RELAY_URL ?? 'Non configuré',
          error: err instanceof Error ? err.message : 'Échec mise à jour AIS',
        });
      }
    };

    // Register callback for first AIS data arrival (triggers immediate refresh)
    onFirstAisData(() => {
      updateShips();
    });

    updateShips();
    this._intervalShips = setInterval(() => updateShips().catch(err => console.error('[App] Ships poll error', err)), AIS_UI_REFRESH_MS);
  }

  /**
   * Load submarine cables data (once) and detect cable threats.
   * Analyse TOUT le trafic AIS (civils + militaires étrangers) pour détecter les menaces.
   * Les navires Marine Nationale sont exclus des alertes (whitelist souveraine).
   *
   * @param allTraffic - Tous les navires AIS reçus (civils, étrangers, militaires)
   * @param navyMmsiSet - Set des MMSI Marine Nationale (exclus des alertes)
   */
  private async loadDefenseAlerts(
    allTraffic: ReturnType<typeof getMilitaryShips>,
    navyMmsiSet: Set<string>
  ): Promise<void> {
    try {
      // Load cables data if not already loaded
      if (!this.submarineCablesData) {
        const response = await fetch('/data/submarine-cables.json');
        if (!response.ok) {
          console.warn('[Defense] Failed to load submarine cables data');
          return;
        }
        this.submarineCablesData = await response.json();
      }

      // Filtrer les navires Marine Nationale (whitelist souveraine - pas d'alertes)
      // et convertir en format AISShip pour la détection
      const aisShips = allTraffic
        .filter(ship => !ship.mmsi || !navyMmsiSet.has(ship.mmsi)) // Exclure Marine Nationale
        .map(ship => ({
          ...militaryShipToAIS(ship),
          isMilitary: false, // Tous les navires restants sont civils/étrangers
        }));

      // Détecter les menaces sur le trafic civil/étranger uniquement
      this.currentDefenseAlerts = detectCableThreats(
        aisShips,
        this.submarineCablesData!,
        { maxDistanceMeters: 500, maxSpeedKnots: 2, militaryOnly: false }
      );

      // Update panel if visible
      if (this.defensePanel?.isVisible()) {
        this.defensePanel.update(this.currentDefenseAlerts, this.currentJammingSignals);
      }

      if (this.currentDefenseAlerts.length > 0) {
        console.log(`[Defense] ${this.currentDefenseAlerts.length} cable threat(s) detected (excluding French Navy)`);
      }
    } catch (err) {
      console.error('[Defense] Failed to load alerts', err);
    }
  }

  private startFinancePolling(): void {
    const fetchFinance = async () => {
      try {
        const data = await fetchMarketData();
        this.currentMarketData = data;
        this.marketStrip?.update(data);
        if (data.length > 0) {
          this.financePanel?.show(data);
        }
      } catch (err) {
        console.error('[Finance] Polling failed', err);
      }
    };
    fetchFinance();
    this._intervalFinance = setInterval(() => fetchFinance().catch(err => console.error('[App] Finance poll error', err)), POLL_FINANCE_MS);
    this._intervalNuclear = setInterval(() => {
      void this.loadNuclear();
    }, POLL_NUCLEAR_MS);
  }

  private startOilPolling(): void {
    if (this._intervalOil !== null) clearInterval(this._intervalOil);

    this._intervalOil = setInterval(() => {
      if (!this.activeLayers.oilNetwork) return;
      void this.loadOil();
    }, POLL_OIL_MS);
  }

  private startCommodityPolling(): void {
    const fetchCommodities = async () => {
      try {
        const data = await fetchCommodityData();
        this.commodityStrip?.update(data);
      } catch (err) {
        console.error('[Commodities] Polling failed', err);
      }
    };
    fetchCommodities();
    this._intervalCommodities = setInterval(
      () => fetchCommodities().catch(err => console.error('[App] Commodities poll error', err)),
      POLL_COMMODITIES_MS,
    );
  }

  private startAirTrafficPolling(): void {
    let inFlight = false;

    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await this.loadAirTraffic();
      } catch (err) {
        console.error('[AirTraffic] Polling failed', err);
        this.statusPanel?.updateSource('Trafic aérien', {
          status: 'error',
          lastUpdate: new Date(),
          detail: 'airplanes.live + OpenSky · proxy agrégé',
          error: err instanceof Error ? err.message : 'Échec trafic aérien',
        });
      } finally {
        inFlight = false;
      }
    };

    void poll();
    this._intervalAirTraffic = setInterval(() => {
      poll().catch(err => console.error('[App] AirTraffic poll error', err));
    }, POLL_AIR_TRAFFIC_MS);
  }

  private async fetchAndProcessRSS(): Promise<void> {
    try {
      this.statusPanel?.updateSource('RSS PQR', { status: 'loading', lastUpdate: null });
      const requestId = ++this.rssRequestSeq;
      const rawItems = await fetchAllFeeds(ALL_FEEDS);
      console.log(`[RSS] Fetched ${rawItems.length} raw items`);

      if (rawItems.length === 0) {
        this.statusPanel?.updateSource('RSS PQR', { status: 'stale', lastUpdate: new Date() });
        return; // Keep previous data
      }

      // 1. Classify by keywords IMMEDIATELY
      for (const item of rawItems) {
        if (!item.threat) {
          // Fast local keyword approach initially
          item.threat = classifyByKeywords(item.title, item.summary);
        }
      }

      // Update news items directly with RSS results (fast path)
      this.applyNewsItems(rawItems);
      this.statusPanel?.updateSource('RSS PQR', { status: 'ok', lastUpdate: new Date() });

      // Snapshot ISNR sur chaque tick RSS (alimente l'historique sparkline)
      this.updateISNR();

      console.log(`[RSS] Pipeline stage 1 complete: ${rawItems.length} items parsed and classified by keywords.`);

      // 2. Background processing for AI & Geocoding
      // Deep-enough clone: each item object is a new reference so that in-place
      // mutations from geocoding / AI / summarization (item.lat, item.threat, etc.)
      // do NOT pollute the objects already handed to the map in stage 1.
      // The WebGL animation loop reads item coords on every frame — without this
      // clone, markers jump position progressively as geocoding completes (flicker).
      this.augmentItemsInBackground(rawItems.map(item => ({ ...item })), requestId);

    } catch (err) {
      console.error('[RSS] Pipeline failed:', err);
      this.statusPanel?.updateSource('RSS PQR', { status: 'error', lastUpdate: new Date() });
    }
  }

  private applyNewsItems(items: NewsItem[]): void {
    this.newsItems = [...items].sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
    this.mapContainer?.updateNews(this.newsItems);
    this.newsPanel?.updateItems(this.newsItems);
    this.searchModal?.updateNewsItems(this.newsItems);
    this.refreshFranceIntelPanel();
  }

  // ─── Background AI & Geocoding ─────────────────────────────────────────────

  private async augmentItemsInBackground(items: NewsItem[], requestId: number): Promise<void> {
    // Run AI classification and geocoding in PARALLEL — geocoding must NOT wait for AI model to load
    await Promise.all([
      this.runAIClassification(items, requestId),
      this.runGeocoding(items, requestId),
      this.runSummarization(items, requestId),
    ]);

    if (requestId !== this.rssRequestSeq) {
      console.log('[RSS] Background augmentation dropped for stale request', requestId);
      return;
    }

    this.applyNewsItems(items);

    // Cache the fully augmented results once both are done
    saveNewsToCache(this.newsItems);
    console.log(`[RSS] Pipeline stage 2 (background) complete: AI, Geocoding & Summarization.`);
  }

  private publishAugmentedItemsIfCurrent(items: NewsItem[], requestId: number): void {
    if (requestId !== this.rssRequestSeq) return;
    this.applyNewsItems(items);
  }

  /** Classify items that have no threat yet via AI (slower — model load takes time) */
  private async runAIClassification(items: NewsItem[], requestId: number): Promise<void> {
    try {
      let updated = false;
      const itemsToAI = items.filter(it => !it.threat);
      for (const item of itemsToAI) {
        const aiFallback = await classifyWithAI(item.title, item.summary);
        if (aiFallback) {
          item.threat = aiFallback;
          updated = true;
        }
      }
      if (updated) {
        this.publishAugmentedItemsIfCurrent(items, requestId);
      }
    } catch (err) {
      console.error('[RSS] AI classification failed:', err);
    }
  }

  /** Geocode items without coordinates, batched and throttled */
  private async runGeocoding(items: NewsItem[], requestId: number): Promise<void> {
    try {
      const toGeocode = items.filter((it) => it.lat == null);
      if (toGeocode.length === 0) return;

      const BATCH_SIZE = 5;
      for (let i = 0; i < toGeocode.length; i += BATCH_SIZE) {
        const batch = toGeocode.slice(i, i + BATCH_SIZE);
        let batchUpdated = false;
        await Promise.all(
          batch.map(async (item) => {
            const geo = await geocodeNewsItem(item.title, item.feedRegion);
            if (geo) {
              item.lat = geo.lat;
              item.lon = geo.lon;
              item.locationName = geo.locationName;
              batchUpdated = true;
            }
          }),
        );

        if (batchUpdated) {
          this.publishAugmentedItemsIfCurrent(items, requestId);
        }

        // Small delay between batches
        if (i + BATCH_SIZE < toGeocode.length) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    } catch (err) {
      console.error('[RSS] Geocoding failed:', err);
    }
  }

  /** Summarize items that have no aiSummary yet */
  private async runSummarization(items: NewsItem[], requestId: number): Promise<void> {
    try {
      const toSummarize = items.filter(
        (it) => !it.aiSummary && it.summary && it.aiSummaryStatus !== 'pending' && it.aiSummaryStatus !== 'failed',
      );
      if (toSummarize.length === 0) return;

      const BATCH_SIZE = 3;
      for (let i = 0; i < toSummarize.length; i += BATCH_SIZE) {
        const batch = toSummarize.slice(i, i + BATCH_SIZE);
        let batchUpdated = false;

        for (const item of batch) {
          item.aiSummaryStatus = 'pending';
        }
        this.publishAugmentedItemsIfCurrent(items, requestId);

        await Promise.all(
          batch.map(async (item) => {
            try {
              const sum = await summarizeWithFallback(item.summary!);
              if (sum) {
                item.aiSummary = sum;
                item.aiSummaryStatus = 'done';
                batchUpdated = true;
                return;
              }
            } catch (err) {
              console.warn('[RSS] Summarization item failed:', err);
            }

            item.aiSummaryStatus = 'failed';
            batchUpdated = true;
          }),
        );

        if (batchUpdated) {
          this.publishAugmentedItemsIfCurrent(items, requestId);
        }

        if (i + BATCH_SIZE < toSummarize.length) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    } catch (err) {
      console.error('[RSS] Summarization failed:', err);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DATA LOADERS — Méthodes individuelles pour chargement parallèle
  // ═══════════════════════════════════════════════════════════════════════════

  private async loadEcowatt(): Promise<void> {
    this.statusPanel?.updateSource('Écowatt RTE', { status: 'loading', lastUpdate: null });
    
    const [ecowatt, energyRegions, borderHistory] = await Promise.all([
      fetchEcowatt(),
      fetchEnergyRegions().catch(() => ({ regions: [], flows: [] })),
      fetchBorderHistory(7).catch(() => new Map()),
    ]);

    if (Object.keys(ecowatt.signals).length > 0) {
      this.currentEcowattResponse = ecowatt;
      this.currentEcowattUsesFallback = false;
      await this.mapContainer?.updateEnergy(ecowatt);
      this.mapContainer?.updateEnergyTooltipData(energyRegions.regions, energyRegions.flows, borderHistory);
      this.statusPanel?.updateSource('Écowatt RTE', { status: 'ok', lastUpdate: new Date() });
    } else {
      this.currentEcowattResponse = {
        signals: {},
        mixes: {},
        national: { timestamp: new Date(), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 },
        interconnections: [],
      };
      this.currentEcowattUsesFallback = true;
      await this.mapContainer?.updateEnergy(this.currentEcowattResponse);
      this.mapContainer?.updateEnergyTooltipData(energyRegions.regions, energyRegions.flows, borderHistory);
      this.statusPanel?.updateSource('Écowatt RTE', { status: 'stale', lastUpdate: new Date() });
    }

    if (this.activeLayers.powerGrid) {
      this.energyPanel?.show(this.currentEcowattResponse);
      this.layoutEnergyFloatingPanels();
    }

    await this.refreshHydraulicLayer();
    this.refreshEnergyDataLegends();
    this.refreshFranceIntelPanel();
  }

  private async loadWeather(): Promise<void> {
    this.statusPanel?.updateSource('Météo-France', { status: 'loading', lastUpdate: null });

    const [timeline, alerts] = await Promise.all([
      fetchVigilanceTimeline().catch(() => null),
      fetchVigilanceMeteo().catch(() => []),
    ]);

    this.currentMeteoTimeline = timeline;

    if (alerts.length > 0) {
      this.currentMeteoAlerts = alerts;
      await this.mapContainer?.updateWeather(alerts);
      this.statusPanel?.updateSource('Météo-France', { status: 'ok', lastUpdate: new Date() });
    } else if (timeline && timeline.slots.some((slot) => slot.alerts.length > 0)) {
      const fallbackAlerts = timeline.slots[timeline.currentSlotIndex]?.alerts
        ?? timeline.slots.find((slot) => slot.alerts.length > 0)?.alerts
        ?? [];
      this.currentMeteoAlerts = fallbackAlerts;
      await this.mapContainer?.updateWeather(fallbackAlerts);
      this.statusPanel?.updateSource('Météo-France', { status: 'ok', lastUpdate: new Date() });
    } else {
      this.currentMeteoAlerts = [];
      await this.mapContainer?.updateWeather([]);
      this.statusPanel?.updateSource('Météo-France', { status: 'stale', lastUpdate: new Date() });
    }

    if (this.environmentPanel?.isVisible()) {
      this.environmentPanel.show(this.currentMeteoAlerts, this.currentFloodSegments, this.currentMeteoTimeline ?? undefined);
      this.layoutEnvironmentFloatingPanels();
    }

    await this.refreshHydraulicLayer();
    this.refreshFranceIntelPanel();
  }

  private async loadFloods(): Promise<void> {
    this.statusPanel?.updateSource('Vigicrues', { status: 'loading', lastUpdate: null });
    try {
      const segments = await fetchVigicrues();
      this.currentFloodSegments = segments;
      this.mapContainer?.updateFloods(segments);
      const matchedCount = segments.filter((segment) => segment.geometryFidelity === 'matched').length;
      const corridorCount = segments.filter((segment) => segment.geometryFidelity === 'fallback').length;
      const reconstructedOnly = segments.length > 0 && segments.every((segment) => segment.dataSource !== 'live');

      if (reconstructedOnly) {
        this.activeLayers.environmental = true;
        this.activeLayers.environmentGroup = true;
        this.mapContainer?.setLayerVisibility(this.getEffectiveLayers());
        this.layerPanel?.updateLayers(this.activeLayers);
        const bbox = segments.reduce<[number, number, number, number] | null>((acc, segment) => {
          const next = computeFloodSegmentBbox(segment.displayGeometry);
          if (!acc) return next;
          return [
            Math.min(acc[0], next[0]),
            Math.min(acc[1], next[1]),
            Math.max(acc[2], next[2]),
            Math.max(acc[3], next[3]),
          ];
        }, null);
        if (bbox) this.mapContainer?.fitBounds(bbox, 80);
        this.environmentPanel?.show(this.currentMeteoAlerts, this.currentFloodSegments, this.currentMeteoTimeline ?? undefined);
        this.layoutEnvironmentFloatingPanels();
      }

      if (segments.length > 0) {
        console.info(
          `[App/Vigicrues] Rendering ${segments.length} ${reconstructedOnly ? 'reconstructed' : 'live'} segments ` +
          `(matched=${matchedCount}, corridor=${corridorCount})`,
        );
        this.statusPanel?.updateSource('Vigicrues', {
          status: 'ok',
          lastUpdate: new Date(),
          detail: reconstructedOnly
            ? `${segments.length} tronçons reconstruits`
            : `${matchedCount + corridorCount}/${segments.length} tronçons cartographiés`,
        });
      } else {
        console.info('[App/Vigicrues] No yellow/orange/red segments in current live feed');
        this.statusPanel?.updateSource('Vigicrues', {
          status: 'ok',
          lastUpdate: new Date(),
          detail: 'Aucun tronçon jaune/orange/rouge',
        });
      }
      if (this.environmentPanel?.isVisible()) {
        this.environmentPanel.show(this.currentMeteoAlerts, this.currentFloodSegments, this.currentMeteoTimeline ?? undefined);
        this.layoutEnvironmentFloatingPanels();
      }
      await this.refreshHydraulicLayer();
      this.refreshFranceIntelPanel();
    } catch (error) {
      this.currentFloodSegments = [];
      this.mapContainer?.updateFloods([]);
      console.warn('[App/Vigicrues] Source unavailable', error);
      this.statusPanel?.updateSource('Vigicrues', {
        status: 'stale',
        lastUpdate: new Date(),
        detail: 'Aucun tronçon disponible',
        error: 'Source live indisponible',
      });
      if (this.environmentPanel?.isVisible()) {
        this.environmentPanel.show(this.currentMeteoAlerts, this.currentFloodSegments, this.currentMeteoTimeline ?? undefined);
        this.layoutEnvironmentFloatingPanels();
      }
      await this.refreshHydraulicLayer();
      this.refreshFranceIntelPanel();
    }
  }

  private async loadFires(): Promise<void> {
    this.statusPanel?.updateSource('NASA FIRMS', { status: 'loading', lastUpdate: null });
    const data = await fetchFiresData();
    this.currentActiveFires = data.detections;
    // Transmet les métadonnées sources au panel (header + footer adaptatifs)
    this.firesPanel?.setSourcesInfo(data.sources, data.apiKeyUsed);
    // setRawFires triggers applyFiresFilter + onFilteredFiresCb (updates map) + re-renders panel if open
    this.firesPanel?.setRawFires(data.detections);
    if (data.detections.length > 0) {
      const sourceDetail = data.apiKeyUsed
        ? `${data.sources.join(' + ')} · ${data.detections.length} det. · ${data.incidents.length} incidents`
        : `SNPP (public) · ${data.detections.length} détections`;
      this.statusPanel?.updateSource('NASA FIRMS', { status: 'ok', lastUpdate: new Date(), detail: sourceDetail });
    } else {
      this.statusPanel?.updateSource('NASA FIRMS', { status: 'stale', lastUpdate: new Date() });
    }
    if (this.firesPanel?.isVisible()) this.layoutEnvironmentFloatingPanels();
  }

  private async loadInfrastructure(): Promise<void> {
    const gasInfra = ALL_INFRASTRUCTURE.filter((p) => p.type === 'gas-terminal' || p.type === 'gas-storage');
    this.mapContainer?.updateInfrastructure(gasInfra);
  }

  private async refreshHydraulicLayer(): Promise<void> {
    this.currentHydraulicHydrometry = await fetchHydraulicHydrometrySnapshot(
      this.currentHydraulicAssets.length > 0 ? this.currentHydraulicAssets : buildHydraulicBackboneAssets(null, [], []),
    );
    this.currentHydraulicAssets = buildHydraulicBackboneAssets(
      this.currentEcowattResponse,
      this.currentFloodSegments,
      this.currentMeteoAlerts,
      this.currentHydraulicHydrometry,
    );
    this.mapContainer?.updateHydraulicBackbone(this.currentHydraulicAssets);
    this.hydraulicPanel?.update(this.currentHydraulicAssets, this.currentEcowattResponse);

    const hydrometryLastUpdate = this.currentHydraulicHydrometry.lastUpdated
      ? new Date(this.currentHydraulicHydrometry.lastUpdated)
      : null;
    this.statusPanel?.updateSource('Hub’Eau hydrométrie', {
      status: this.currentHydraulicHydrometry.sourceStatus,
      lastUpdate: hydrometryLastUpdate,
      detail: this.currentHydraulicHydrometry.detail,
    });

    if (this.activeLayers.hydroBackbone && this.hydraulicPanel?.isVisible()) {
      this.layoutEnergyFloatingPanels();
    }
    this.refreshEnergyDataLegends();
  }

  private async loadHydraulic(): Promise<void> {
    await this.refreshHydraulicLayer();
  }

  private async loadEolien(): Promise<void> {
    this.statusPanel?.updateSource('Éolien France', { status: 'loading', lastUpdate: null });

    try {
      const snapshot = await this.eolienTracker.fetchDashboardSnapshot();
      this.currentEolienError = null;
      this.currentEolienLive = snapshot.live;
      this.currentEolienPoints = snapshot.points;
      this.currentEolienParks = snapshot.parks;

      // Update barometer wind score + widget tooltip immediately
      setBarometerEolienLive(snapshot.live);
      this.networkBarometerWidget?.updateEolien(snapshot.live);

      try {
        this.mapContainer?.updateEolien(snapshot.live, [...snapshot.points, ...snapshot.parks]);
      } catch (error) {
        console.error('[App/Eolien] map update failed', error);
      }

      try {
        this.eolienPanel?.update(snapshot.live, snapshot.parks);
      } catch (error) {
        console.error('[App/Eolien] panel update failed', error);
      }

      this.statusPanel?.updateSource('Éolien France', {
        status: 'ok',
        lastUpdate: snapshot.live.timestamp,
        detail: `${snapshot.live.production_gw.toFixed(1)} GW · ${snapshot.parks.length} parcs`,
      });
      if (this.activeLayers.windMonitor && this.eolienPanel?.isVisible()) {
        this.layoutEnergyFloatingPanels();
      }
      this.refreshEnergyDataLegends();
      this.refreshFranceIntelPanel();
    } catch (error) {
      console.warn('[App/Eolien] Source unavailable', error);
      const message = error instanceof Error ? error.message : 'fetch_failed';
      this.currentEolienError = message;
      this.currentEolienLive = null;
      this.currentEolienPoints = [];
      this.currentEolienParks = [];
      this.mapContainer?.updateEolien(null, []);
      this.eolienPanel?.showErrorState(message);
      this.statusPanel?.updateSource('Éolien France', { status: 'stale', lastUpdate: new Date(), detail: message });
      this.refreshEnergyDataLegends();
      this.refreshFranceIntelPanel();
    }
  }

  private async loadNuclear(): Promise<void> {
    this.statusPanel?.updateSource('Nucléaire RTE', { status: 'loading', lastUpdate: null });
    try {
      const [rteResult, iipState] = await Promise.all([
        fetchNuclearUnavailabilities(),
        fetchRTEIIPIncidents(),
      ]);

      const nationalMix = this.currentEcowattResponse?.national;
      const nuclearState = buildNuclearState(
        rteResult,
        iipState,
        nationalMix ? { nuclear: nationalMix.nuclear, total: nationalMix.total } : undefined,
      );
      const unavailabilities = rteResult.items;

      this.currentNuclearState = nuclearState;
      this.networkBarometerWidget?.updateNuclear(nuclearState);

      if (this.activeLayers.nuclearFleet && this.nuclearPanel?.isVisible()) {
        this.nuclearPanel.update(nuclearState, this.currentEcowattResponse);
      }

      this.mapContainer?.updateInfrastructure(buildEnergyInfrastructurePoints(unavailabilities));

      this.statusPanel?.updateSource('Nucléaire RTE', {
        status: nuclearState.rteAvailable ? 'ok' : 'stale',
        lastUpdate: new Date(),
        detail: nuclearState.rteAvailable
          ? `RTE · ${unavailabilities.length} indisponibilités · ${nuclearState.unconfirmedSignals.length} signaux REMIT non confirmés`
          : 'API RTE indisponible',
      });
      this.refreshFranceIntelPanel();
    } catch (err) {
      console.error('[App] loadNuclear failed:', err);
      this.mapContainer?.updateInfrastructure(buildEnergyInfrastructurePoints());
      this.statusPanel?.updateSource('Nucléaire RTE', { status: 'error', lastUpdate: new Date() });
      this.refreshFranceIntelPanel();
    }
  }

  private async loadTraffic(): Promise<void> {
    if (this.trafficLoadPromise) {
      return this.trafficLoadPromise;
    }

    this.trafficLoadPromise = (async () => {
      this.statusPanel?.updateSource('Trafic', { status: 'loading', lastUpdate: null });
      try {
        const incidents = await fetchTrafficIncidents();
        this.trafficDataLoaded = true;

        if (incidents.length > 0) {
          this.currentTrafficIncidents = incidents;
          this.mapContainer?.updateTrafficIncidents(incidents);
          this.statusPanel?.updateSource('Trafic', {
            status: 'ok',
            lastUpdate: new Date(),
            detail: `TomTom · ${incidents.length} incidents affichés`,
            error: undefined,
          });
          this.refreshFranceIntelPanel();
          return;
        }

        this.currentTrafficIncidents = [];
        this.mapContainer?.updateTrafficIncidents([]);
        this.statusPanel?.updateSource('Trafic', {
          status: 'stale',
          lastUpdate: new Date(),
          detail: 'TomTom · aucun incident renvoyé',
          error: undefined,
        });
        this.refreshFranceIntelPanel();
      } catch (error) {
        this.trafficDataLoaded = true;
        const message = error instanceof Error ? error.message : 'Erreur inconnue';
        this.currentTrafficIncidents = [];
        this.mapContainer?.updateTrafficIncidents([]);
        this.statusPanel?.updateSource('Trafic', {
          status: 'error',
          lastUpdate: new Date(),
          detail: 'TomTom · incidents routiers',
          error: message,
        });
        this.refreshFranceIntelPanel();
      }
    })().finally(() => {
      this.trafficLoadPromise = null;
    });

    return this.trafficLoadPromise;
  }

  private ensureTrafficLoaded(): Promise<void> {
    if (this.currentTrafficIncidents.length > 0) {
      this.mapContainer?.updateTrafficIncidents(this.currentTrafficIncidents);
      return Promise.resolve();
    }

    if (!this.trafficDataLoaded && hasFreshTrafficIncidentCache()) {
      return this.loadTraffic();
    }

    if (this.trafficDataLoaded) {
      return Promise.resolve();
    }

    return this.loadTraffic();
  }

  private async loadAirTraffic(): Promise<void> {
    this.statusPanel?.updateSource('Trafic aérien', {
      status: 'loading',
      lastUpdate: null,
      detail: 'OpenSky + airplanes.live · proxy agrégé · 12 s',
      error: undefined,
    });

    const snapshot = await fetchAirTrafficSnapshot();
    const flights = snapshot.flights;
    const openSkyCount = snapshot.sourceCounts?.opensky ?? 0;
    const airplanesLiveCount = snapshot.sourceCounts?.['airplanes.live'] ?? 0;
    const sourceLabel =
      snapshot.source === 'opensky'
        ? 'OpenSky'
        : snapshot.source === 'airplanes.live'
          ? 'airplanes.live'
          : snapshot.source === 'opensky+airplanes.live'
            ? 'OpenSky + airplanes.live'
            : snapshot.source;
    const sourceBreakdown =
      openSkyCount > 0 || airplanesLiveCount > 0
        ? `OpenSky ${openSkyCount} + airplanes.live ${airplanesLiveCount}`
        : sourceLabel;
    this.mapContainer?.updateAirTraffic(flights);

    const rateLimitedAreas = (snapshot.errors || []).filter((entry) => entry.message.includes('429'));
    const degradedDetail =
      rateLimitedAreas.length > 0
        ? ` · ${rateLimitedAreas.length} source${rateLimitedAreas.length > 1 ? 's' : ''} limitée${rateLimitedAreas.length > 1 ? 's' : ''}`
        : '';
    const anomalyDetail = snapshot.anomalyCount ? ` · ${snapshot.anomalyCount} anomalie${snapshot.anomalyCount > 1 ? 's' : ''}` : '';
    const topAirportDetail = Array.isArray(snapshot.topAirports) && snapshot.topAirports.length > 0
      ? ` · ${snapshot.topAirports
          .slice(0, 3)
          .map((airport) => `${airport.iata} ${airport.score}`)
          .join(' · ')}`
      : '';

    if (flights.length > 0) {
      const statusLabel = snapshot.errors && snapshot.errors.length > 0 ? 'DEGRADE' : 'LIVE';
      this.statusPanel?.updateSource('Trafic aérien', {
        status: snapshot.errors && snapshot.errors.length > 0 ? 'stale' : 'ok',
        lastUpdate: new Date(),
        detail: `${statusLabel} · ${sourceBreakdown} = ${flights.length} vols${anomalyDetail}${topAirportDetail}${degradedDetail}`,
        error: undefined,
      });
    } else {
      const statusLabel = snapshot.errors && snapshot.errors.length > 0 ? 'INDISPONIBLE' : 'VIDE';
      this.statusPanel?.updateSource('Trafic aérien', {
        status: snapshot.errors && snapshot.errors.length > 0 ? 'error' : 'stale',
        lastUpdate: new Date(),
        detail: snapshot.errors && snapshot.errors.length > 0
          ? `${statusLabel} · ${sourceBreakdown} · aucune position exploitable`
          : `${statusLabel} · ${sourceBreakdown} · aucun vol dans l’échantillon`,
        error: snapshot.errors && snapshot.errors.length > 0 ? snapshot.errors[0].message : undefined,
      });
    }
  }

  private async loadCyber(): Promise<void> {
    console.log('[App/loadCyber] ========== ENTRY ==========');
    console.log('[App/loadCyber] isCyberPanelEnabled():', isCyberPanelEnabled());

    // Skip if feature flag is disabled
    if (!isCyberPanelEnabled()) {
      console.log('[App/loadCyber] Feature DISABLED, skipping...');
      this.statusPanel?.updateSource('Cyber', { status: 'stale', lastUpdate: null });
      return;
    }

    this.statusPanel?.updateSource('Cyber', { status: 'loading', lastUpdate: null });
    console.log('[App/loadCyber] Calling fetchCyberDashboard()...');

    try {
      const cyberData = await fetchCyberDashboard();
      console.log('[App/loadCyber] Data received!');
      console.log('[App/loadCyber] globalScore:', cyberData.meta.globalScore);
      console.log('[App/loadCyber] alerts.count30d:', cyberData.alerts.count30d);
      console.log('[App/loadCyber] alerts.latest.length:', cyberData.alerts.latest.length);
      console.log('[App/loadCyber] ransomware.total30d:', cyberData.ransomware.total30d);
      console.log('[App/loadCyber] vulnerabilities.criticalCount:', cyberData.vulnerabilities.criticalCount);

      this.currentCyberData = cyberData;
      console.log('[App/loadCyber] this.currentCyberData SET');

      this.refreshFranceIntelPanel();

      // Determine status based on source availability
      const allSourcesUp = cyberData.meta.sources.every(s => s.isUp);
      const someSourcesUp = cyberData.meta.sources.some(s => s.isUp);

      console.log('[App/loadCyber] Sources status:', cyberData.meta.sources.map(s => `${s.source}:${s.isUp}`).join(', '));

      if (allSourcesUp) {
        this.statusPanel?.updateSource('Cyber', { status: 'ok', lastUpdate: new Date() });
      } else if (someSourcesUp) {
        this.statusPanel?.updateSource('Cyber', { status: 'stale', lastUpdate: new Date() });
      } else {
        this.statusPanel?.updateSource('Cyber', { status: 'error', lastUpdate: new Date() });
      }

      // Update panel if visible
      console.log('[App/loadCyber] cyberPanel exists:', !!this.cyberPanel);
      console.log('[App/loadCyber] cyberPanel.isVisible():', this.cyberPanel?.isVisible());
      this.cyberPanel?.update(cyberData);

      console.log(`[App/loadCyber] ========== COMPLETE: Score=${cyberData.meta.globalScore}, Sources=${cyberData.meta.sources.filter(s => s.isUp).length}/3 ==========`);
    } catch (err) {
      console.error('[App/loadCyber] ========== FAILED ==========', err);
      this.statusPanel?.updateSource('Cyber', { status: 'error', lastUpdate: new Date() });
    }
  }

  private async loadGas(): Promise<void> {
    console.log('[App/loadGas] Entry');

    if (!isGasPanelEnabled()) {
      console.log('[App/loadGas] Feature DISABLED, skipping...');
      this.statusPanel?.updateSource('Gaz', { status: 'stale', lastUpdate: null });
      this.currentGasData = null;
      this.refreshEnergyDataLegends();
      return;
    }

    this.statusPanel?.updateSource('Gaz', { status: 'loading', lastUpdate: null });

    try {
      const gasData = await fetchGasNetwork();
      this.currentGasData = gasData;

      // Update map visualization
      await this.mapContainer?.updateGas(gasData);

      // Determine status
      const allOk = Object.values(gasData.sourceStatus).every(s => s === 'ok');
      const someOk = Object.values(gasData.sourceStatus).some(s => s === 'ok');

      if (allOk) {
        this.statusPanel?.updateSource('Gaz', { status: 'ok', lastUpdate: new Date() });
      } else if (someOk) {
        this.statusPanel?.updateSource('Gaz', { status: 'stale', lastUpdate: new Date() });
      } else {
        this.statusPanel?.updateSource('Gaz', { status: 'error', lastUpdate: new Date() });
      }

      // Update panel if visible
      this.gasPanel?.update(gasData);
      this.refreshEnergyDataLegends();

      console.log(`[App/loadGas] Complete: EcoGaz=${gasData.ecogaz.signal}, Fill=${gasData.nationalStats.averageFillLevel.toFixed(1)}%`);
    } catch (err) {
      console.error('[App/loadGas] Failed:', err);
      this.statusPanel?.updateSource('Gaz', { status: 'error', lastUpdate: new Date() });
      this.refreshEnergyDataLegends();
    }
  }

  private async loadOil(): Promise<void> {
    console.log('[App/loadOil] Entry');
    const oilStatusDetail = 'OilNetwork : vue France structurale SDES/CPDP + vue harmonisée JODI/UFIP + signal prix/ruptures carburants';

    if (!isOilPanelEnabled()) {
      console.log('[App/loadOil] Feature DISABLED, skipping...');
      this.statusPanel?.updateSource('Pétrole', {
        status: 'stale',
        lastUpdate: null,
        detail: oilStatusDetail,
      });
      this.currentOilData = null;
      this.currentFuelTensionData = null;
      await this.mapContainer?.updateFuelTension(null);
      this.refreshEnergyDataLegends();
      return;
    }

    this.statusPanel?.updateSource('Pétrole', {
      status: 'loading',
      lastUpdate: null,
      detail: oilStatusDetail,
    });

    try {
      const [oilData, fuelTensionResult] = await Promise.allSettled([
        fetchOilDashboard(),
        fetchFuelTensionDashboard(),
      ]);

      if (oilData.status !== 'fulfilled') {
        throw oilData.reason;
      }

      const resolvedOilData = oilData.value;
      const resolvedFuelTension = fuelTensionResult.status === 'fulfilled'
        ? fuelTensionResult.value
        : buildDegradedFuelTensionDashboard(undefined, fuelTensionResult.reason);

      this.currentFuelTensionData = resolvedFuelTension;
      this.currentOilData = resolvedOilData;

      // Update map visualization (refineries, depots, pipelines, origin-linked flows)
      const oilFlows = this.buildOilFlowsFromDashboard(resolvedOilData);

      await this.mapContainer?.updateOil(oilFlows);
      await this.mapContainer?.updateOilInfrastructure(resolvedOilData);
      await this.mapContainer?.updateFuelTension(this.oilPanel?.isFuelTensionMapVisible() === false ? null : resolvedFuelTension);

      // Try to load pipeline GeoJSON
      await this.mapContainer?.loadOilPipelines();

      // Determine status
      const allOk = Object.values(resolvedOilData.sourceStatus).every(s => s === 'ok');
      const someOk = Object.values(resolvedOilData.sourceStatus).some(s => s === 'ok');

      if (allOk) {
        this.statusPanel?.updateSource('Pétrole', {
          status: 'ok',
          lastUpdate: new Date(),
          detail: oilStatusDetail,
        });
      } else if (someOk) {
        this.statusPanel?.updateSource('Pétrole', {
          status: 'stale',
          lastUpdate: new Date(),
          detail: oilStatusDetail,
        });
      } else {
      this.statusPanel?.updateSource('Pétrole', {
        status: 'error',
        lastUpdate: new Date(),
        detail: oilStatusDetail,
      });
      }

      // Update panel if visible
      this.oilPanel?.update(resolvedOilData, resolvedFuelTension);
      this.refreshEnergyDataLegends();
      this.refreshFranceIntelPanel();

      console.log(`[App/loadOil] Complete: Status=${resolvedOilData.meta.status}, StocksDays=${resolvedOilData.stocks.nationalStocksDays}`);
    } catch (err) {
      console.error('[App/loadOil] Failed:', err);
      this.currentFuelTensionData = buildDegradedFuelTensionDashboard(undefined, err);
      await this.mapContainer?.updateFuelTension(this.currentFuelTensionData);
      this.statusPanel?.updateSource('Pétrole', {
        status: 'error',
        lastUpdate: new Date(),
        detail: 'OilNetwork : SDES pétrole 2025 (données 2024) + séries mensuelles produits pétroliers data.gouv – HYBRID / MONTHLY / STRUCTURAL',
      });
      if (this.currentOilData) {
        this.oilPanel?.update(this.currentOilData, this.currentFuelTensionData);
      }
      this.refreshEnergyDataLegends();
    }
  }

  private buildOilFlowsFromDashboard(oilData: OilDashboard): Array<{
    id: string;
    name: string;
    country?: string;
    flowKbd: number;
    coordinates: [number, number];
    franceCoordinates?: [number, number];
    hubName?: string;
    originSharePct?: number;
    originVolumeMt?: number;
    originReferenceYear?: number;
    originSourceLabel?: string;
    originPartialBreakdown?: boolean;
    originBreakdown?: Array<{
      label: string;
      volumeMt: number;
      sharePct: number;
    }>;
  }> {
    const totalImportKbd = oilData.flows.importTonsPerDay / 136;
    const totalExportKbd = oilData.flows.exportTonsPerDay / 136;
    const origins = oilData.origins.filter((origin) => origin.sharePct > 0);
    const totalShare = origins.reduce((sum, origin) => sum + origin.sharePct, 0) || 100;

    const importFlows = origins.map((origin) => {
      const route = this.resolveOilImportRoute(origin.label);
      return {
        id: `oil-import-${origin.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        name: `Import ${origin.label}`,
        country: origin.label,
        hubName: route.hubName,
        flowKbd: totalImportKbd * (origin.sharePct / totalShare),
        coordinates: route.coordinates,
        franceCoordinates: route.franceCoordinates,
        originSharePct: origin.sharePct,
        originVolumeMt: origin.volumeMt,
        originReferenceYear: origin.referenceYear,
        originSourceLabel: origin.sourceLabel,
        originPartialBreakdown: origin.partialBreakdown,
        originBreakdown: origin.breakdown,
      };
    });

    const exportFlow = {
      id: 'oil-export-est',
      name: 'Export produits raffines',
      country: 'Suisse / Allemagne',
      hubName: 'Couloir Rhone - Est',
      flowKbd: -totalExportKbd,
      coordinates: [8.2, 47.1] as [number, number],
      franceCoordinates: [4.86, 45.67] as [number, number],
    };

    return [...importFlows, exportFlow].filter((flow) => Math.abs(flow.flowKbd) >= 1);
  }

  private resolveOilImportRoute(originLabel: string): {
    coordinates: [number, number];
    franceCoordinates: [number, number];
    hubName: string;
  } {
    const label = originLabel.toLowerCase();

    if (label.includes('mer du nord')) {
      return {
        coordinates: [2.2, 56.0],
        franceCoordinates: [-0.15, 49.67],
        hubName: 'Antifer / Le Havre',
      };
    }

    if (label.includes('moyen-orient')) {
      return {
        coordinates: [40.0, 27.5],
        franceCoordinates: [4.94, 43.43],
        hubName: 'Fos / Lavera',
      };
    }

    if (label.includes('afrique du nord')) {
      return {
        coordinates: [9.5, 31.5],
        franceCoordinates: [4.94, 43.43],
        hubName: 'Fos / Lavera',
      };
    }

    if (label.includes('afrique subsaharienne')) {
      return {
        coordinates: [2.0, 4.0],
        franceCoordinates: [4.94, 43.43],
        hubName: 'Fos / Lavera',
      };
    }

    if (label.includes('afrique')) {
      return {
        coordinates: [2.0, 17.0],
        franceCoordinates: [4.94, 43.43],
        hubName: 'Fos / Lavera',
      };
    }

    if (label.includes('amérique du nord') || label.includes('amerique du nord')) {
      return {
        coordinates: [-72.0, 41.0],
        franceCoordinates: [-0.15, 49.67],
        hubName: 'Antifer / Le Havre',
      };
    }

    if (label.includes('urss') || label.includes('russ')) {
      return {
        coordinates: [36.0, 44.0],
        franceCoordinates: [-0.15, 49.67],
        hubName: 'Antifer / Le Havre',
      };
    }

    return {
      coordinates: [-45.0, 39.0],
      franceCoordinates: [-2.08, 47.30],
      hubName: 'Donges',
    };
  }

  private async loadSncf(): Promise<void> {
    this.statusPanel?.updateSource('SNCF', { status: 'loading', lastUpdate: null });
    const disruptions = await fetchSncfDisruptions((enriched) => {
      // Geocoding + OSM route matching completed in background — refresh map + panel
      this.currentSncfDisruptions = enriched;
      const enrichedRail = buildRailNetworkData(enriched);
      this.currentRailNetworkData = enrichedRail;
      this.mapContainer?.updateRailNetwork(enrichedRail);
      if (this.activeLayers.trafficRail) {
        this.transportPanel?.show(enriched);
      }
      this.refreshFranceIntelPanel();
    });
    this.currentSncfDisruptions = disruptions;
    if (disruptions.length > 0) {
      this.statusPanel?.updateSource('SNCF', { status: 'ok', lastUpdate: new Date() });
    } else {
      this.statusPanel?.updateSource('SNCF', { status: 'stale', lastUpdate: new Date() });
    }
    // Update rail map layer immediately (partial data — geocoding still in progress)
    const railData = buildRailNetworkData(disruptions);
    this.currentRailNetworkData = railData;
    this.mapContainer?.updateRailNetwork(railData);
    this.refreshFranceIntelPanel();
  }

  private resolveRailFocusDisruption(disruption: TransportDisruption | null): TransportDisruption | null {
    if (!disruption || !this.currentRailNetworkData) return disruption;

    const arcFeature = this.currentRailNetworkData.arcs.features.find(
      (feature) => feature.properties.id === disruption.id
    );

    if (!arcFeature || arcFeature.geometry.coordinates.length < 2) {
      return disruption;
    }

    return {
      ...disruption,
      routeGeometry: {
        type: 'LineString',
        coordinates: arcFeature.geometry.coordinates as [number, number][],
      },
      geometryFidelity: (arcFeature.properties.geometryFidelity as TransportDisruption['geometryFidelity'] | undefined) ?? disruption.geometryFidelity,
    };
  }

  private async loadMetropoles(): Promise<void> {
    this.statusPanel?.updateSource('Métropoles', { status: 'loading', lastUpdate: null });
    const metropoles = await fetchMetropoles();
    if (metropoles.length > 0) {
      const nationalLoadMW = this.currentEcowattResponse?.national.total;
      this.mapContainer?.updateMetropoles(metropoles, nationalLoadMW);
      this.statusPanel?.updateSource('Métropoles', { status: 'ok', lastUpdate: new Date() });
    } else {
      this.statusPanel?.updateSource('Métropoles', { status: 'stale', lastUpdate: new Date() });
    }
  }

  private async loadOutages(): Promise<void> {
    this.statusPanel?.updateSource('Télécoms', { status: 'loading', lastUpdate: null });

    // ── Sources rapides (<2s) : télécom, électrique, réseau, infra, IIP RTE ──
    const [telecoms, powers, network, infra, iipResult] = await Promise.all([
      fetchTelecomOutages(),
      fetchPowerOutages(),
      fetchNetworkOutages(),
      fetchInfraNetwork(),
      fetchRTEIIPIncidents().catch(() => null),
    ]);
    this.currentTelecomOutages = telecoms;
    this.currentPowerOutages = powers;
    this.currentNetworkState = network;
    if (infra) this.currentInfraState = infra;
    await this.mapContainer?.updateOutages(telecoms, powers);
    this.mapContainer?.updateNetworkOutages(network);
    if (infra) this.mapContainer?.updateInfraNetwork(infra);

    if (iipResult) {
      this.outagesPanel?.setRTEIIP(iipResult);
    }

    this.outagesPanel?.setArcepFetchedDate(lastArcepDataDate ?? new Date());
    this.outagesPanel?.setOutagesMeta(getPowerOutagesMeta());

    // ── Afficher le panel immédiatement avec les données rapides ─────────────
    if (this.outagesPanel?.isVisible()) {
      this.outagesPanel.show(this.currentPowerOutages, this.currentTelecomOutages, this.currentNetworkState, this.currentInfraState, this.currentCitizenZones ?? undefined);
    }
    this.statusPanel?.updateSource('Télécoms', { status: 'ok', lastUpdate: new Date() });
    this.statusPanel?.updateSource('IODA Internet', {
      status: network.sourcesStatus.ioda === 'ok' ? 'ok' : 'stale',
      lastUpdate: network.lastUpdate,
    });
    this.refreshFranceIntelPanel();

    // ── Zones citoyennes fire-and-forget (scraping HTML ~8-15s) ─────────────
    // Le panel s'est déjà affiché ; on met à jour les zones quand elles arrivent.
    fetchOutageZoneCollection()
      .then(zones => {
        this.currentCitizenZones = zones;
        this.mapContainer?.updateCitizenOutageZones(zones);
        if (this.outagesPanel?.isVisible()) {
          this.outagesPanel.show(this.currentPowerOutages, this.currentTelecomOutages, this.currentNetworkState, this.currentInfraState, zones);
        }
        this.refreshFranceIntelPanel();
      })
      .catch(() => {});
  }

  private async loadHealth(): Promise<void> {
    this.statusPanel?.updateSource('SPF / DREES', { status: 'loading', lastUpdate: null });
    this.statusPanel?.updateSource('Sentinelles', { status: 'loading', lastUpdate: null });
    this.statusPanel?.updateSource('ANSM Médicaments', { status: 'loading', lastUpdate: null });
    const payload = await fetchHealthData();
    this.hasHealthData = payload.departments.length > 0 || payload.regions.length > 0;
    this.currentHealthFeatures = payload.healthFeatures;

    let sentinellesScore = undefined;
    try {
      sentinellesScore = computeSentinellesBarometerFromIndicators(
        payload.healthFeatures.sentinellesIndicators ?? []
      );
    } catch (err) {
      console.error("Failed to load or compute Sentinelles data for Barometer", err);
    }


    // Pass departments (preferred) and regions as fallback, plus healthFeatures
    this.mapContainer?.updateHealth(payload.regions, payload.healthFeatures, payload.departments);

    // Compute and expose barometer — reuses already-loaded data, no extra fetch
    if (payload.departments.length > 0) {
      const metrics = computeHealthBarometer(
        payload.departments,
        payload.healthFeatures,
        this.lastBarometerMetrics ?? undefined,
        sentinellesScore,
      );
      this.lastBarometerMetrics = metrics;

      // Trigger barometer open event if panel is already visible
      if (this.healthBarometerPanel?.isVisible()) {
        this.healthBarometerPanel.show(metrics);
      }

      // Store on window for 'open-health-barometer' event handler
      (window as any).__healthBarometerMetrics = metrics;

      // Update FAB button to show score + ready state
      const fab = document.getElementById('barometer-fab');
      if (fab) {
        const color = metrics.levelColor;
        fab.innerHTML = `🩺 Baromètre Santé — <span style="color:${color}; font-weight:800;">${metrics.globalScore}/100 ${metrics.levelLabel}</span>`;
        fab.style.borderColor = `${color}55`;
      }
    }
    const hasData = payload.departments.length > 0 || payload.regions.length > 0;
    // Show national health panel only if user manually enabled the health layer
    if (hasData && this.activeLayers.health) {
      document.dispatchEvent(new CustomEvent('open-national-health'));
    }
    this.mapLegend?.setCategoryVisibility('health', hasData && this.activeLayers.health);
    const ss = payload.healthFeatures.sourceStatus;
    this.statusPanel?.updateSource('SPF / DREES', {
      status: ss.santePubliqueFrance === 'ok' || ss.drees === 'ok' ? 'ok' : 'stale',
      lastUpdate: new Date()
    });
    this.statusPanel?.updateSource('Sentinelles', {
      status: ss.sentinelles,
      lastUpdate: new Date()
    });
    this.statusPanel?.updateSource('ANSM Médicaments', {
      status: ss.drugShortages,
      lastUpdate: new Date()
    });
  }

  private startHealthPolling(): void {
    if (this._intervalHealth !== null) clearInterval(this._intervalHealth);

    this._intervalHealth = setInterval(() => {
      const isHealthContextActive =
        this.activeLayers.health ||
        this.activeLayers.healthApl ||
        this.activeLayers.healthOscour ||
        this.activeLayers.hospitals ||
        this.nationalHealthPanel?.isVisible() === true ||
        this.healthBarometerPanel?.isVisible() === true;

      if (!isHealthContextActive) return;

      this.loadHealth().catch((err) => {
        console.error('[App] Health poll error', err);
      });
    }, POLL_HEALTH_MS);
  }

  private async refreshHydraulicSignalSources(): Promise<void> {
    const results = await Promise.allSettled([
      this.loadEcowatt(),
      this.loadWeather(),
      this.loadFloods(),
    ]);

    if (results.every((result) => result.status === 'rejected')) {
      await this.refreshHydraulicLayer();
    }
  }

  private startHydraulicPolling(): void {
    if (this._intervalHydraulic !== null) clearInterval(this._intervalHydraulic);

    let inFlight = false;

    const poll = async (): Promise<void> => {
      if (inFlight) return;
      const shouldRefresh =
        this.activeLayers.hydroBackbone ||
        this.hydraulicPanel?.isVisible() === true;

      if (!shouldRefresh) return;

      inFlight = true;
      try {
        await this.refreshHydraulicSignalSources();
      } catch (err) {
        console.error('[App] Hydraulic poll error', err);
      } finally {
        inFlight = false;
      }
    };

    this._intervalHydraulic = setInterval(() => {
      poll().catch((err) => console.error('[App] Hydraulic poll error', err));
    }, POLL_HYDRAULIC_MS);
  }

  private startEolienPolling(): void {
    if (this._intervalEolien !== null) clearInterval(this._intervalEolien);

    let inFlight = false;

    const poll = async (): Promise<void> => {
      if (inFlight) return;
      const shouldRefresh =
        this.activeLayers.windMonitor ||
        this.eolienPanel?.isVisible() === true;

      if (!shouldRefresh) return;

      inFlight = true;
      try {
        await this.loadEolien();
      } catch (err) {
        console.error('[App] Eolien poll error', err);
      } finally {
        inFlight = false;
      }
    };

    this._intervalEolien = setInterval(() => {
      poll().catch((err) => console.error('[App] Eolien poll error', err));
    }, POLL_EOLIEN_MS);
  }

  private async loadHospitals(): Promise<void> {
    this.statusPanel?.updateSource('FINESS (Hôpitaux)', { status: 'loading', lastUpdate: null });
    const hospitals = await fetchHospitalsData();
    // Assuming mapContainer.updateHospitals will be implemented in DeckGLMap
    this.mapContainer?.updateHospitals(hospitals);

    const hasData = hospitals.features.length > 0;
    // Legend visibility follows user's layer toggle, not data availability
    this.mapLegend?.setCategoryVisibility('hospitals', hasData && this.activeLayers.hospitals);

    this.statusPanel?.updateSource('FINESS (Hôpitaux)', { status: hasData ? 'ok' : 'error', lastUpdate: new Date() });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOAD ALL LAYERS — Pattern WorldMonitor (static first, then parallel async)
  // ═══════════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT DATA — 3 priority groups + 1 sync method
  // ═══════════════════════════════════════════════════════════════════════════

  /** Sync — called first, no network, instant display */
  private loadStaticData(): void {
    // ─── STATIC DATA — Affichage immédiat (pas de fetch) ───────────────────
    // Affiche d'abord notre DB statique enrichie (~160 sites)
    this.mapContainer?.updateMilitaryBases(ACTIVE_INSTALLATIONS);
    this.mapContainer?.updateMilitaryZones(RESTRICTED_ZONES);

    // ─── OSM MILITARY DATA — Charge puis fusionne avec la DB statique ──────
    loadStaticOsmFeatures().then((osmFeatures) => {
      if (osmFeatures.length > 0) {
        const merged = mergeWithStaticDb(osmFeatures, ACTIVE_INSTALLATIONS);
        this.mapContainer?.updateMilitaryBases(merged);
        console.log(`[App] Military bases: ${ACTIVE_INSTALLATIONS.length} static + ${osmFeatures.length} OSM = ${merged.length} total`);
      }
    }).catch((err) => {
      console.warn('[App] Failed to load OSM military features:', err);
    });
  }
  /** CRITICAL — awaited in init(). 4 layers that seed the ISNR (energy + weather + floods). */
  private async loadCriticalLayers(): Promise<void> {
    const tasks: Array<{ name: string; task: Promise<void> }> = [
      {
        name: 'ecowatt', task: this.loadEcowatt().catch(() => {
          this.currentEcowattResponse = {
            signals: {},
            mixes: {},
            national: { timestamp: new Date(), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 },
            interconnections: [],
          };
          this.mapContainer?.updateEnergy(this.currentEcowattResponse);
          this.statusPanel?.updateSource('Écowatt RTE', { status: 'error', lastUpdate: new Date() });
        })
      },
      {
        name: 'weather', task: this.loadWeather().catch(() => {
          this.currentMeteoAlerts = [];
          this.mapContainer?.updateWeather([]);
          this.statusPanel?.updateSource('Météo-France', { status: 'error', lastUpdate: new Date() });
        })
      },
      {
        name: 'floods', task: this.loadFloods().catch(() => {
          this.currentFloodSegments = [];
          this.mapContainer?.updateFloods([]);
          this.statusPanel?.updateSource('Vigicrues', { status: 'error', lastUpdate: new Date() });
        })
      },
      {
        name: 'nuclear', task: this.loadNuclear().catch(() => {
          this.currentNuclearState = null;
          this.networkBarometerWidget?.updateNuclear(null);
          this.statusPanel?.updateSource('Nucléaire RTE', { status: 'error', lastUpdate: new Date() });
        })
      },
    ];

    const results = await Promise.allSettled(tasks.map((t) => t.task));
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`[Critical] ${tasks[i]!.name} failed:`, r.reason);
      }
    });
  }
  /** SECONDARY — fire-and-forget. Caller does .then(() => this.updateISNR()). */
  private async loadSecondaryLayers(): Promise<void> {
    const tasks: Array<{ name: string; task: Promise<void> }> = [
      {
        name: 'fires', task: this.loadFires().catch(() => {
          this.mapContainer?.updateFires([]);
          this.statusPanel?.updateSource('NASA FIRMS', { status: 'error', lastUpdate: new Date() });
        })
      },
      {
        name: 'infrastructure', task: this.loadInfrastructure().catch(() => {
          this.mapContainer?.updateInfrastructure(ALL_INFRASTRUCTURE.filter((p) => p.type === 'gas-terminal' || p.type === 'gas-storage'));
        })
      },
      {
        name: 'hydraulic', task: this.loadHydraulic().catch(() => {
          this.currentHydraulicAssets = [];
          this.currentHydraulicHydrometry = null;
          this.mapContainer?.updateHydraulicBackbone([]);
          this.statusPanel?.updateSource('Hub’Eau hydrométrie', { status: 'error', lastUpdate: new Date() });
        })
      },
      {
        name: 'eolien', task: this.loadEolien().catch(() => {
          this.currentEolienLive = null;
          this.currentEolienPoints = [];
          this.currentEolienParks = [];
          this.mapContainer?.updateEolien(null, []);
          this.statusPanel?.updateSource('Éolien France', { status: 'error', lastUpdate: new Date() });
        })
      },
      ...(this.activeLayers.trafficRoad ? [{
        name: 'traffic', task: this.loadTraffic().catch(() => {
          this.mapContainer?.updateTrafficIncidents([]);
          this.statusPanel?.updateSource('Trafic', { status: 'error', lastUpdate: new Date() });
        })
      }] : []),
      {
        name: 'sncf', task: this.loadSncf().catch(() => {
          this.currentSncfDisruptions = [];
          this.currentRailNetworkData = null;
          this.mapContainer?.updateRailNetwork({
            arcs: { type: 'FeatureCollection', features: [] },
            stations: { type: 'FeatureCollection', features: [] },
          });
          this.statusPanel?.updateSource('SNCF', { status: 'error', lastUpdate: new Date() });
        })
      },
      {
        name: 'metropoles', task: this.loadMetropoles().catch(() => {
          this.statusPanel?.updateSource('Métropoles', { status: 'error', lastUpdate: new Date() });
        })
      },
      {
        name: 'outages', task: this.loadOutages().catch(() => {
          this.statusPanel?.updateSource('Télécoms', { status: 'error', lastUpdate: new Date() });
        })
      },
    ];

    const results = await Promise.allSettled(tasks.map((t) => t.task));
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`[Secondary] ${tasks[i]!.name} failed:`, r.reason);
      }
    });
  }
  /** OPTIONAL — fire-and-forget. Slow/heavy APIs that do not affect first visible state. */
  private async loadOptionalLayers(): Promise<void> {
    const tasks: Array<{ name: string; task: Promise<void> }> = [
      {
        name: 'air-traffic', task: this.loadAirTraffic().catch(() => {
          this.mapContainer?.updateAirTraffic([]);
          this.statusPanel?.updateSource('Trafic aérien', {
            status: 'error',
            lastUpdate: new Date(),
            detail: 'airplanes.live · proxy gratuit',
          });
        })
      },
      {
        name: 'health', task: this.loadHealth().catch(() => {
          this.statusPanel?.updateSource('SPF / DREES', { status: 'error', lastUpdate: new Date() });
          this.statusPanel?.updateSource('Sentinelles', { status: 'error', lastUpdate: new Date() });
          this.statusPanel?.updateSource('ANSM Médicaments', { status: 'error', lastUpdate: new Date() });
        })
      },
      {
        name: 'hospitals', task: this.loadHospitals().catch(() => {
          this.statusPanel?.updateSource('FINESS (Hôpitaux)', { status: 'error', lastUpdate: new Date() });
        })
      },
      {
        name: 'cyber', task: this.loadCyber().catch(() => {
          this.statusPanel?.updateSource('Cyber', { status: 'error', lastUpdate: new Date() });
        })
      },
      {
        name: 'space-weather', task: this.loadSpaceWeather().catch(() => {
          this.statusPanel?.updateSource('NOAA SWPC', { status: 'error', lastUpdate: new Date() });
        })
      },
    ];

    const results = await Promise.allSettled(tasks.map((t) => t.task));
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`[Optional] ${tasks[i]!.name} failed:`, r.reason);
      }
    });
  }


  private async loadSpaceWeather(): Promise<void> {
    this.statusPanel?.updateSource('NOAA SWPC', { status: 'loading', lastUpdate: null });

    // Terminator jour/nuit — calcul astronomique pur, instantané
    this.mapContainer?.updateTerminator(computeTerminatorGeoJSON());
    if (this._intervalSpaceWeatherTerminator !== null) {
      clearInterval(this._intervalSpaceWeatherTerminator);
    }
    this._intervalSpaceWeatherTerminator = setInterval(() => {
      this.mapContainer?.updateTerminator(computeTerminatorGeoJSON());
    }, POLL_SPACE_WEATHER_TERMINATOR_MS);

    // Kp index NOAA
    const data = await fetchSpaceWeather();
    this.energyPanel?.updateSpaceWeather(data);
    this.statusPanel?.updateSource('NOAA SWPC', { status: 'ok', lastUpdate: data.fetchedAt });

    // Refresh Kp toutes les 15 min
    if (this._intervalSpaceWeatherRefresh !== null) {
      clearInterval(this._intervalSpaceWeatherRefresh);
    }
    this._intervalSpaceWeatherRefresh = setInterval(async () => {
      const fresh = await fetchSpaceWeather().catch(() => null);
      if (fresh) this.energyPanel?.updateSpaceWeather(fresh);
    }, POLL_SPACE_WEATHER_REFRESH_MS);
  }

  private buildFranceTimeline(lang: 'fr' | 'en'): { days: string[]; lanes: FranceIntelTimelineLane[] } {
    const now = new Date();
    const days = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(now);
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - (6 - index));
      return day;
    });
    const dayKeys = days.map((d) => d.toISOString().slice(0, 10));
    const laneMap = {
      social:    { key: 'social'    as const, label: lang === 'fr' ? 'Social'    : 'Social',    color: '#ef4444', counts: Array(7).fill(0) as number[] },
      security:  { key: 'security'  as const, label: lang === 'fr' ? 'Sécurité'  : 'Security',  color: '#f97316', counts: Array(7).fill(0) as number[] },
      weather:   { key: 'weather'   as const, label: lang === 'fr' ? 'Météo'     : 'Weather',   color: '#facc15', counts: Array(7).fill(0) as number[] },
      transport: { key: 'transport' as const, label: lang === 'fr' ? 'Transport' : 'Transport', color: '#60a5fa', counts: Array(7).fill(0) as number[] },
      cyber:     { key: 'cyber'     as const, label: 'Cyber',                                   color: '#a855f7', counts: Array(7).fill(0) as number[] },
    };

    const cyber = this.currentCyberData ?? null;

    for (const item of this.newsItems) {
      const key = item.pubDate.toISOString().slice(0, 10);
      const dayIndex = dayKeys.indexOf(key);
      if (dayIndex === -1) continue;
      const category = item.threat?.category;
      if (category === 'social') laneMap.social.counts[dayIndex] += 1;
      else if (category === 'security') laneMap.security.counts[dayIndex] += 1;
      else if (
        category === 'weather' || category === 'floods' || category === 'fires' ||
        category === 'energy' || category === 'infrastructure'
      ) laneMap.weather.counts[dayIndex] += 1;
      else if (category === 'transport') laneMap.transport.counts[dayIndex] += 1;
      else if (category === 'cyber') laneMap.cyber.counts[dayIndex] += 1;
    }

    const todayIndex = dayKeys.length - 1;
    laneMap.weather.counts[todayIndex]   += this.currentMeteoAlerts.filter((a) => a.level !== 'green').length;
    laneMap.weather.counts[todayIndex]   += this.currentFloodSegments.filter((a) => a.level !== 'green').length;
    laneMap.transport.counts[todayIndex] += this.currentSncfDisruptions.length + this.currentTrafficIncidents.length;
    laneMap.security.counts[todayIndex]  += this.currentDefenseAlerts.length + this.currentJammingSignals.length;
    laneMap.cyber.counts[todayIndex]     += cyber?.alerts.latest.filter((a) => {
      const ts = new Date(a.date);
      return Number.isFinite(ts.getTime()) && (now.getTime() - ts.getTime()) <= 7 * 24 * 60 * 60 * 1000;
    }).length ?? 0;

    return {
      days: days.map((d) =>
        d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', { month: 'short', day: 'numeric' }),
      ),
      lanes: Object.values(laneMap),
    };
  }

  private buildFranceSnapshot(
    lang: 'fr' | 'en',
    options?: { brief?: string | null; briefFreshness?: 'fresh' | 'cached' },
  ): FranceCountrySnapshot {
    const raw: FranceRawData = {
      newsItems:            this.newsItems,
      isnrData:             this.currentISNRData,
      cyberData:            this.currentCyberData,
      meteoAlerts:          this.currentMeteoAlerts,
      floodSegments:        this.currentFloodSegments,
      sncfDisruptions:      this.currentSncfDisruptions,
      trafficIncidents:     this.currentTrafficIncidents,
      powerOutages:         this.currentPowerOutages,
      telecomOutages:       this.currentTelecomOutages,
      defenseAlerts:        this.currentDefenseAlerts,
      jammingSignals:       this.currentJammingSignals,
      militaryFlightsCount: this.currentMilitaryFlightsCount,
      maritimeCount:        this.currentMaritimeTrafficFranceCount,
      activeFires:          this.currentActiveFires,
      marketData:           this.currentMarketData,
      ecowattResponse:      this.currentEcowattResponse,
      gasState:             this.currentGasData,
      nuclearState:         this.currentNuclearState,
      eolienLive:           this.currentEolienLive,
      aisAnomalies:         this.currentAisAnomalies,
      timeline:             this.buildFranceTimeline(lang),
      briefLang:            lang,
      oilDashboard:         this.currentOilData ?? null,
      fuelTensionDashboard: this.currentFuelTensionData ?? null,
    };
    return buildFranceEngine(raw, options);
  }

  private buildAlertMonitorSituations(): DetectedSituation[] {
    const now = new Date();
    const nowMs = now.getTime();

    const newsSituations = this.newsItems
      .filter((item) => item.threat?.level === 'critical' || item.threat?.level === 'high')
      .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
      .slice(0, ALERT_MONITOR_LIMIT)
      .map((item) => ({
        id: `news-alert-${item.id}`,
        type: 'NEWS_ALERT' as const,
        severity: threatLevelToSituationSeverity(item.threat?.level),
        confidence: item.threat?.confidence ?? 0.8,
        title: truncateLabel(item.title, 88),
        summary: item.aiSummary ?? item.summary ?? item.title,
        affectedZones: [item.locationName ?? item.feedRegion ?? item.source].filter(Boolean),
        drivers: [
          `Source ${item.source}`,
          `Catégorie ${item.threat?.category ?? 'générale'}`,
          `Publication ${item.pubDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`,
        ],
        recommendedActions: [
          { label: 'Vérifier l’article et ses suites locales', ownerHint: 'Veille OSINT', actionType: 'investigate' as const },
          { label: 'Suivre les mises à jour terrain', ownerHint: 'Cellule de suivi', actionType: 'monitor' as const, automatable: true },
        ],
        sourceRefs: [item.source, 'RSS PQR'],
        linkUrl: item.link,
        linkLabel: 'Ouvrir l’article',
        updatedAt: item.pubDate,
      }));

    const surgeSituations = this.currentMilitarySurges
      .slice(0, 3)
      .map((surge) => ({
        id: `military-surge-${surge.type}-${surge.severity}`,
        type: 'MILITARY_SURGE_ALERT' as const,
        severity: (surge.severity === 'alert' ? 'critical' : surge.severity === 'warning' ? 'high' : 'medium') as SituationSeverity,
        confidence: surge.severity === 'alert' ? 0.96 : surge.severity === 'warning' ? 0.86 : 0.72,
        title: truncateLabel(surge.description, 88),
        summary: surge.location
          ? `${surge.description} autour de [${surge.location.lat.toFixed(2)}, ${surge.location.lon.toFixed(2)}].`
          : surge.description,
        affectedZones: [surge.location ? 'Zone aérienne concernée' : 'France'],
        drivers: [
          `${surge.flightCount} aéronef(s) impliqués`,
          ...(surge.flightTypes?.length ? [`Types ${surge.flightTypes.join(', ')}`] : []),
          ...(surge.radius ? [`Rayon estimé ${Math.round(surge.radius)} km`] : []),
        ],
        recommendedActions: [
          { label: 'Confirmer la nature du surge', ownerHint: 'Veille défense', actionType: 'cross-check' as const },
          { label: 'Surveiller la persistance du trafic', ownerHint: 'Cellule air', actionType: 'monitor' as const, automatable: true },
        ],
        sourceRefs: ['Vols militaires', 'ADS-B agrégé'],
        updatedAt: now,
      }));

    const weatherSituations = [...this.currentMeteoAlerts]
      .filter((alert) => alert.level === 'red' || alert.level === 'orange')
      .sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1))
      .slice(0, ALERT_MONITOR_LIMIT)
      .map((alert) => {
        const risks = alert.risks.map((risk) => METEO_RISK_LABELS[risk] ?? risk);
        return {
          id: `weather-alert-${alert.departmentCode}-${alert.level}-${alert.risks.join('-')}`,
          type: 'WEATHER_ALERT' as const,
          severity: alert.level === 'red' ? 'critical' : 'high',
          confidence: alert.level === 'red' ? 0.95 : 0.84,
          title: `Vigilance ${alert.level} · ${alert.department}`,
          summary: risks.length > 0
            ? `Risque principal: ${risks.slice(0, 2).join(', ')}.`
            : `Alerte météo ${alert.level} en cours.`,
          affectedZones: [alert.department],
          drivers: [
            ...(risks.length > 0 ? [`Risques ${risks.join(', ')}`] : []),
            ...(alert.startDate ? [`Début ${alert.startDate.toLocaleString('fr-FR')}`] : []),
            ...(alert.endDate ? [`Fin ${alert.endDate.toLocaleString('fr-FR')}`] : []),
          ],
          recommendedActions: [
            { label: 'Suivre la vigilance départementale', ownerHint: 'Cellule météo', actionType: 'monitor' as const, automatable: true },
            { label: 'Recouper avec les impacts terrain', ownerHint: 'Coordination locale', actionType: 'cross-check' as const },
          ],
          sourceRefs: ['Météo-France'],
          updatedAt: now,
        };
      });

    const defenseSituations = this.currentDefenseAlerts
      .filter((alert) => alert.severity === 'high' || alert.severity === 'medium')
      .slice(0, ALERT_MONITOR_LIMIT)
      .map((alert) => ({
        id: `defense-alert-${alert.shipId}-${alert.cableId}`,
        type: 'DEFENSE_ALERT' as const,
        severity: defenseSeverityToSituationSeverity(alert.severity),
        confidence: alert.severity === 'high' ? 0.93 : 0.81,
        title: truncateLabel(`${alert.shipName} près du câble ${alert.cableName}`, 88),
        summary: `${alert.message} Distance ${Math.round(alert.distanceMeters)} m, vitesse ${alert.speedKnots.toFixed(1)} nd.`,
        affectedZones: [alert.cableName],
        drivers: [
          `Navire ${alert.shipName}`,
          `Distance ${Math.round(alert.distanceMeters)} m`,
          `Vitesse ${alert.speedKnots.toFixed(1)} nd`,
        ],
        recommendedActions: [
          { label: 'Vérifier le comportement du navire', ownerHint: 'Veille maritime', actionType: 'investigate' as const },
          { label: 'Suivre la zone câble en continu', ownerHint: 'Sûreté infrastructures', actionType: 'monitor' as const, automatable: true },
        ],
        sourceRefs: ['AIS maritime', 'Câbles sous-marins'],
        updatedAt: new Date(alert.createdAt),
        lon: alert.coordinates[0],
        lat: alert.coordinates[1],
        activateLayers: ['subseaCables', 'trafficMaritime'],
      }));

    const jammingSituations = this.currentJammingSignals
      .filter((signal) => signal.severity === 'high' || signal.severity === 'medium')
      .sort((a, b) => {
        const severityDelta = (b.severity === 'high' ? 1 : 0) - (a.severity === 'high' ? 1 : 0);
        if (severityDelta !== 0) return severityDelta;
        return b.confidence - a.confidence;
      })
      .slice(0, ALERT_MONITOR_LIMIT)
      .map((signal) => ({
        id: `gps-jamming-${signal.id}`,
        type: 'GPS_JAMMING_ALERT' as const,
        severity: signal.severity === 'high' ? 'critical' : 'high',
        confidence: signal.confidence,
        title: `Suspicion de brouillage GPS (${Math.round(signal.confidence * 100)}%)`,
        summary: signal.reasons[0] ?? 'Signal heuristique ADS-B à confirmer.',
        affectedZones: ['Zone aérienne'],
        drivers: [
          `${signal.affectedIcao24s.length} aéronef(s) affecté(s)`,
          ...(signal.clusterRadius ? [`Rayon estimé ${Math.round(signal.clusterRadius)} km`] : []),
          ...signal.reasons.slice(0, 2),
        ],
        recommendedActions: [
          { label: 'Recouper avec d’autres capteurs', ownerHint: 'Veille guerre électronique', actionType: 'cross-check' as const },
          { label: 'Surveiller l’extension du signal', ownerHint: 'Cellule air', actionType: 'monitor' as const, automatable: true },
        ],
        sourceRefs: ['Vols militaires', 'Détection GPS jamming'],
        updatedAt: new Date(signal.timestamp * 1000),
      }));

    const aisSituations = [...this.currentAisAnomalies]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, ALERT_MONITOR_LIMIT)
      .map((anomaly) => ({
        id: `ais-anomaly-${anomaly.id}`,
        type: 'AIS_ANOMALY_ALERT' as const,
        severity: anomaly.severity === 'high' ? 'high' : 'medium',
        confidence: anomaly.severity === 'high' ? 0.82 : 0.7,
        title: truncateLabel(anomaly.description, 88),
        summary: anomaly.description,
        affectedZones: ['Zone maritime'],
        drivers: [
          `Type ${anomaly.type === 'radio_silence' ? 'silence radio' : 'rendez-vous suspect'}`,
          `${anomaly.mmsis.length} MMSI impliqué(s)`,
        ],
        recommendedActions: [
          { label: 'Vérifier la persistance de l’anomalie', ownerHint: 'Veille maritime', actionType: 'monitor' as const, automatable: true },
          { label: 'Recouper avec le contexte local', ownerHint: 'Sûreté maritime', actionType: 'cross-check' as const },
        ],
        sourceRefs: ['AIS maritime'],
        updatedAt: new Date(anomaly.timestamp),
      }));

    const freshAlerts = [
      ...newsSituations,
      ...surgeSituations,
      ...weatherSituations,
      ...defenseSituations,
      ...jammingSituations,
      ...aisSituations,
    ] as DetectedSituation[];

    for (const alert of freshAlerts) {
      this.alertMonitorCache.set(alert.id, {
        situation: alert,
        expiresAt: getAlertMonitorExpiry(alert, nowMs),
      });
    }

    for (const [id, entry] of this.alertMonitorCache) {
      if (entry.expiresAt <= nowMs) {
        this.alertMonitorCache.delete(id);
      }
    }

    return sortSituations(
      [...this.alertMonitorCache.values()].map((entry) => entry.situation),
    );
  }

  private refreshFranceIntelPanel(): void {
    const lang = this.franceIntelPanel?.getCurrentLang() ?? 'fr';
    const snapshot = this.buildFranceSnapshot(lang);
    this.alertMonitor?.update(this.buildAlertMonitorSituations(), lang);
    this.situationMonitor?.update(snapshot.situations, lang);
    void pushHistorySnapshot(snapshot);
    if (!this.franceIntelPanel?.isVisible()) return;
    this.franceIntelPanel.show(snapshot);
  }

  private async refreshNetworkBarometerWidget(): Promise<void> {
    const result = await fetchNetworkBarometer();
    this.networkBarometerWidget?.update(result);
    this.networkBarometerWidget?.updateNuclear(this.currentNuclearState);
    this.networkBarometerWidget?.updateEolien(this.currentEolienLive);

    const medium = this.newsItems
      .filter(n => ['medium', 'high', 'critical'].includes(n.threat?.level ?? ''))
      .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
      .slice(0, 10);

    const headlines = medium.length >= 3
      ? medium
      : [
          ...medium,
          ...this.newsItems
            .filter(n => n.threat?.level === 'low')
            .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
            .slice(0, 10 - medium.length),
        ];

    const isnrDepts = this.currentISNRData?.scores
      .slice()
      .sort((a, b) => a.score - b.score)
      .slice(0, 5)
      .map(d => ({ name: d.name, score: d.score, social: d.dimensions.social, security: d.dimensions.security }));

    const nuclearBriefing = buildNuclearBriefingContext(this.currentNuclearState);
    const oilBriefing = buildOilBriefingContext(this.currentOilData, this.currentFuelTensionData);

    const eolienBriefing: EolienBriefingContext | undefined = this.currentEolienLive
      ? {
          production_gw: this.currentEolienLive.production_gw,
          puissance_installee: this.currentEolienLive.puissance_installee,
          facteur_charge: this.currentEolienLive.facteur_charge,
          parcs_actifs: this.currentEolienLive.parcs_actifs,
          alertLevel: this.currentEolienLive.alertLevel,
        }
      : undefined;

    const synthesis = await fetchISNRSynthesis(
      result,
      headlines,
      this.currentISNRData?.nationalScore,
      isnrDepts,
      nuclearBriefing,
      eolienBriefing,
      oilBriefing,
    ).catch(() => null);
    this.networkBarometerWidget?.updateBriefing(synthesis);
  }

  private requestFranceIntelBrief(
    snapshot: FranceCountrySnapshot,
    lang: 'fr' | 'en',
    options?: { showLoading?: boolean },
  ): void {
    const requestId = ++this.franceIntelBriefRequestId;
    if (options?.showLoading !== false) {
      this.franceIntelPanel?.showBriefLoading();
    }

    void fetchFranceIntelBrief(snapshot.briefContext, lang).then(({ brief, freshness }) => {
      if (requestId !== this.franceIntelBriefRequestId) return;
      if (!this.franceIntelPanel?.isVisible()) return;
      if (this.franceIntelPanel.getCurrentLang() !== lang) return;
      this.franceIntelPanel.updateBrief(brief, freshness);
    });
  }

  private clearFranceIntelBriefRefresh(): void {
    if (this.franceIntelBriefRefreshTimer) {
      clearInterval(this.franceIntelBriefRefreshTimer);
      this.franceIntelBriefRefreshTimer = null;
    }
  }

  private scheduleFranceIntelBriefRefresh(): void {
    this.clearFranceIntelBriefRefresh();
    this.franceIntelBriefRefreshTimer = setInterval(() => {
      if (!this.franceIntelPanel?.isVisible()) return;
      const lang = this.franceIntelPanel.getCurrentLang();
      const snapshot = this.buildFranceSnapshot(lang);
      this.franceIntelPanel.show(snapshot);
      this.requestFranceIntelBrief(snapshot, lang, { showLoading: false });
    }, FRANCE_INTEL_BRIEF_REFRESH_MS);
  }

  private async openFranceIntelPanel(): Promise<void> {
    if (!this.currentCyberData) void this.loadCyber();
    if (!this.currentISNRData) this.updateISNR();
    if (!this.currentOilData) void this.loadOil();
    void this.refreshNetworkBarometerWidget().catch((err) => {
      console.error('[App] Network barometer refresh on France Intel open failed', err);
    });

    this.environmentPanel?.hide();
    this.energyPanel?.hide();
    this.isnrPanel?.hide();
    this.cyberPanel?.hide();
    this.healthBarometerPanel?.hide();
    this.firesPanel?.hide();
    this.transportPanel?.hide();
    this.trafficPanel?.hide();

    const panel = await this.ensureFranceIntelPanel();
    const lang = panel.getCurrentLang();
    const snapshot = this.buildFranceSnapshot(lang);
    panel.show(snapshot);
    this.requestFranceIntelBrief(snapshot, lang);
    this.scheduleFranceIntelBriefRefresh();
  }

  private updateISNR(): void {
    this.currentISNRData = computeISNR(
      this.newsItems,
      this.currentMeteoAlerts,
      this.currentFloodSegments,
      this.currentEcowattResponse,
      '24h',
      this.currentTelecomOutages,
      this.currentPowerOutages,
    );

    // Update map layer
    this.mapContainer?.updateISNR(this.currentISNRData.scores);

    // Update ISNR panel if visible
    if (this.isnrPanel?.isVisible()) {
      this.isnrPanel.show(this.currentISNRData);
    }

    this.refreshFranceIntelPanel();
  }

  private onFilterChange(filter: FilterState): void {
    this.routeGovernmentContext(filter.categories);
    writeUrlState({
      timeRange: filter.timeRange,
      searchQuery: undefined,
    });
  }

  private routeGovernmentContext(categories: EventCategory[]): void {
    this.pendingGovernmentCategories = categories;
    this.rightSidebar?.setGovernmentContext(categories);
  }

  private routeGovernmentContextForItem(item: NewsItem | null | undefined): void {
    const categories = item?.threat?.category ? [item.threat.category] : [];
    this.routeGovernmentContext(categories);
  }

  // ─── UI helpers ─────────────────────────────────────────────────────────────

  private startClock(): void {
    const clockEl = document.getElementById('clock');
    if (!clockEl) return;
    const update = () => {
      clockEl.textContent = new Date().toLocaleTimeString('fr-FR', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    };
    update();
    this._intervalClock = setInterval(update, 1000);
  }
}
