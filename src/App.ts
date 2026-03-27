/**
 * App.ts — Orchestrateur principal de France Monitor.
 * Phase 2 : pipeline RSS réel + classifier + géocodeur.
 */

import { MapContainer } from './components/MapContainer.ts';
import { MapPopup } from './components/MapPopup.ts';
import { MapLegend, type LegendCategory } from './components/MapLegend.ts';
import { UnderMapNewsFeed } from './components/UnderMapNewsFeed.ts';
import { StatusPanel } from './components/StatusPanel.ts';
import { SearchModal } from './components/SearchModal.ts';
import { ToastNotification } from './components/ToastNotification.ts';
import { WeatherPanel } from './components/WeatherPanel.ts';
import { EnergyPanel } from './components/EnergyPanel.ts';
import { TransportPanel } from './components/TransportPanel.ts';
import { FloodsPanel } from './components/FloodsPanel.ts';
import { FiresPanel } from './components/FiresPanel.ts';
import { ElusPanel } from './components/ElusPanel.ts';
import { TrafficPanel } from './components/TrafficPanel.ts';
import { FinancePanel } from './components/FinancePanel.ts';
import { MarketStrip } from './components/MarketStrip.ts';
import { CommodityStrip } from './components/CommodityStrip.ts';
import { fetchCommodityData } from './services/commodities.ts';
import { ISNRPanel } from './components/ISNRPanel.ts';
import { CyberPanel } from './components/CyberPanel.ts';
import { GasPanel } from './components/GasPanel.ts';
import { OilPanel } from './components/OilPanel.ts';
import { DayNightPanel } from './components/DayNightPanel.ts';
import { OutagesPanel } from './components/OutagesPanel.ts';
import { DefensePanel } from './components/DefensePanel.ts';
import { NationalHealthPanel } from './components/NationalHealthPanel.ts';
import { HealthBarometerPanel } from './components/HealthBarometerPanel.ts';
import { MaritimePanel } from './components/MaritimePanel.ts';
import { BarometerWidget } from './components/BarometerWidget.ts';
import { SatellitePanel } from './components/SatellitePanel.ts';
import { buildEoBrowserUrl } from './services/copernicus.ts';
import type { SatelliteViewRequest } from './types/index.ts';
import { fetchNetworkBarometer } from './services/network-barometer.ts';
import { LayerPanel } from './components/LayerPanel.ts';
import { computeISNR, DEPARTMENTS } from './services/stability-index.ts';
import {
  MOCK_ECOWATT_REGIONS,
  MOCK_METEO_ALERTS,
  MOCK_FLOOD_SEGMENTS,
} from './config/mock-data.ts';
import { ALL_INFRASTRUCTURE } from './config/infrastructure.ts';
import { RESTRICTED_ZONES, detectMilitarySurges } from './config/military.ts';
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
import { fetchSncfDisruptions } from './services/transport.ts';
import { fetchNuclearPlantsStatus } from './services/energy.ts';
import { fetchActiveFires } from './services/fires.ts';
import { fetchTrafficIncidents, filterOsintTrafficIncidents, type TrafficIncident } from './services/traffic.ts';
import { fetchAirTrafficSnapshot } from './services/air-traffic.ts';
import { fetchMarketData } from './services/finance.ts';
import { fetchTelecomOutages, fetchPowerOutages } from './services/outages.ts';
import { fetchOutageZoneCollection } from './services/outages-scraper.ts';
import { fetchNetworkOutages } from './services/internet-outages.ts';
import { fetchSpaceWeather, computeTerminatorGeoJSON } from './services/space-weather.ts';
import { fetchInfraNetwork } from './services/infra-network.ts';
import { fetchHealthData } from './services/health.ts';
import { computeHealthBarometer } from './services/health-barometer.ts';
import type { HealthBarometerMetrics } from './services/health-barometer.ts';
import { fetchCyberDashboard, isCyberPanelEnabled } from './services/cyber.ts';
import { fetchGasNetwork, isGasPanelEnabled } from './services/gas.ts';
import { fetchOilDashboard, isOilPanelEnabled } from './services/oil.ts';
import { computeSentinellesBarometerFromIndicators } from './services/sentinellesService.ts';
import { readUrlState, writeUrlState } from './utils/urlState.ts';
import { loadNewsFromCache, saveNewsToCache } from './utils/newsCache.ts';
import type { NewsItem, FilterState, MapLayers, MeteoAlert, EcowattResponse, TransportDisruption, FloodSegment, ISNRData, LayerConfig, CyberState, OilDashboard, PowerOutage, NetworkOutageState, InfraNetworkState, TelecomOutage, EventCategory, AisAnomaly } from './types/index.ts';
import { APL_LEVELS, OSCOUR_LEVELS } from './types/index.ts';
import { fetchISNRSynthesis } from './services/isnr-synthesis.ts';
import { GOUVERNEMENT } from './config/government.ts';


const RSS_POLL_INTERVAL_MS = 5 * 60_000; // 5 min

// Default layer visibility (alerts remain implicitly enabled)
const DEFAULT_LAYERS: MapLayers = {
  newsGroup: false,
  news: false,
  alerts: true,
  energyGroup: false,
  energy: false,
  health: false,
  healthOscour: false,
  healthApl: false,
  hospitals: false,
  environmentGroup: false,
  environmental: false,
  fires: false,
  infrastructure: false,
  traffic: false,
  trafficRoad: false,
  trafficMaritime: false,
  trafficAir: false,
  metropoles: false,
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
  gas: false,
  oil: false,
  dayNight: false,
  elus: false,
};

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
  columns: 2,
  items: [
    { id: 'road-flow', label: 'Flux routier', color: '#4fc3f7', shape: 'square' },
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
  id: 'energy',
  title: 'Énergie — Écowatt (Électricité)',
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
    'Dépôts stratégiques affichés : principaux sites souterrains et hubs de stockage (sélection non exhaustive)',
  ],
};

const INFRASTRUCTURE_LEGEND: LegendCategory = {
  id: 'infrastructure',
  title: 'Infras Vitales',
  type: 'categorical',
  columns: 2,
  splitIndex: 4,
  items: [
    { id: 'nuclear', label: 'Nucléaire', color: '#8FC8E8', shape: 'circle', borderColor: '#E8F2FA', borderWidth: 2 },
    { id: 'electric-generation', label: 'Thermique / hydro', color: '#74B6DC', shape: 'circle' },
    { id: 'substation', label: 'Poste RTE 400 kV', color: '#5EA6D6', shape: 'circle' },
    { id: 'gas-terminal', label: 'Terminal méthanier', color: '#8EDFD8', shape: 'circle' },
    { id: 'gas-storage', label: 'Stockage gaz', color: '#C0F0E8', shape: 'circle' },
    { id: 'refinery', label: 'Raffinerie', color: '#E7BE98', shape: 'circle' },
    { id: 'oil-depot', label: 'Dépôt pétrolier majeur', color: '#F1D6BA', shape: 'circle' },
    { id: 'vital-halo', label: 'Anneau vital', color: '#F2F4F7', shape: 'ring' },
  ],
  source: {
    label: 'EDF / RTE / GRTgaz / stockages et hubs consolidés',
  },
  refresh: {
    label: 'Mixte: nucléaire dynamique, autres points majoritairement statiques'
  },
  notes: [
    'Sélection volontairement restreinte aux nœuds énergétiques structurants.',
    'Palette pastel dédiée pour rester en retrait des layers énergie spécialisés.',
  ],
};

const METROPOLES_ELECTRIC_LEGEND: LegendCategory = {
  id: 'metropoles',
  title: 'Métropoles électriques',
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
  id: 'gas',
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
    label: 'GRTgaz / ODRE / Teréga',
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
  id: 'oil',
  title: 'Réseau Pétrole',
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
    label: 'Stocks pétroliers / tracés et points consolidés',
  },
  refresh: {
    label: '~15 min pour l’état, tracés majoritairement statiques'
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
  items: [
    { id: 'ioda-critical', label: 'Anomalie BGP ≥ 80',   color: '#EF4444', shape: 'ring' },
    { id: 'ioda-severe',   label: 'Anomalie BGP 50–79',  color: '#F59E0B', shape: 'ring' },
    { id: 'ioda-low',      label: 'Anomalie BGP < 50',   color: '#10B981', shape: 'ring' },
    { id: 'isp-outage',    label: 'Opérateur en panne',  color: '#EF4444', shape: 'ring' },
    { id: 'isp-degraded',  label: 'Opérateur dégradé',   color: '#F59E0B', shape: 'ring' },
    { id: 'isp-normal',    label: 'Opérateur normal',    color: '#10B981', shape: 'ring' },
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
    { id: 'dc-ok',   label: 'Datacenter opérationnel', color: '#A78BFA', shape: 'triangle-up', borderColor: '#0a0a0f', borderWidth: 1 },
    { id: 'dc-deg',  label: 'Datacenter dégradé',      color: '#F59E0B', shape: 'triangle-up', borderColor: '#0a0a0f', borderWidth: 1 },
    { id: 'dc-out',  label: 'Datacenter en panne',     color: '#EF4444', shape: 'triangle-up', borderColor: '#0a0a0f', borderWidth: 1 },
    { id: 'ixp-ok',  label: 'Point d\'échange (IXP)',  color: '#C4B5FD', shape: 'square',     borderColor: '#0a0a0f', borderWidth: 1 },
    { id: 'ixp-out', label: 'IXP dégradé / hors service', color: '#EF4444', shape: 'square', borderColor: '#0a0a0f', borderWidth: 1 },
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
  // ─── Energy Group ───
  {
    id: 'energyGroup',
    groupId: 'energy',
    role: 'groupMaster',
    dependsOnGroup: false,
    label: 'Énergie',
  },
  {
    id: 'energy',
    groupId: 'energy',
    role: 'child',
    dependsOnGroup: true,
    label: 'Électricité / Écowatt',
    legend: ENERGY_ECOWATT_LEGEND,
  },
  {
    id: 'gas',
    groupId: 'energy',
    role: 'child',
    dependsOnGroup: true,
    label: 'Réseau Gaz',
    legend: GAS_LEGEND,
  },
  {
    id: 'oil',
    groupId: 'energy',
    role: 'child',
    dependsOnGroup: true,
    label: 'Réseau Pétrole',
    legend: OIL_LEGEND,
  },
  {
    id: 'infrastructure',
    groupId: 'energy',
    role: 'child',
    dependsOnGroup: true,
    label: 'Infras Vitales',
    legend: INFRASTRUCTURE_LEGEND,
  },
  {
    id: 'metropoles',
    groupId: 'energy',
    role: 'standalone',
    dependsOnGroup: false,
    label: 'Métropoles électriques',
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
  // ─── Élus & Représentants ───
  {
    id: 'elus',
    role: 'standalone',
    label: '🏛️ Élus & Représentants',
  },
];

export class App {

  private container: HTMLElement;
  private mapContainer: MapContainer | null = null;
  private mapPopup: MapPopup | null = null;
  private mapLegend: MapLegend | null = null;
  private newsPanel: UnderMapNewsFeed | null = null;
  private statusPanel: StatusPanel | null = null;
  private weatherPanel: WeatherPanel | null = null;
  private energyPanel: EnergyPanel | null = null;
  private transportPanel: TransportPanel | null = null;
  private floodsPanel: FloodsPanel | null = null;
  private firesPanel: FiresPanel | null = null;
  private elusPanel: ElusPanel | null = null;
  private maritimePanel: MaritimePanel | null = null;
  private currentActiveFires: import('./types/index.ts').ActiveFire[] = [];
  private trafficPanel: TrafficPanel | null = null;
  private financePanel: FinancePanel | null = null;
  private marketStrip: MarketStrip | null = null;
  private commodityStrip: CommodityStrip | null = null;
  private _intervalCommodities: ReturnType<typeof setInterval> | null = null;
  private isnrPanel: ISNRPanel | null = null;
  private cyberPanel: CyberPanel | null = null;
  private currentCyberData: CyberState | null = null;
  private gasPanel: GasPanel | null = null;
  private currentGasData: import('./types').GasNetworkState | null = null;
  private oilPanel: OilPanel | null = null;
  private currentOilData: OilDashboard | null = null;
  private dayNightPanel: DayNightPanel | null = null;
  private outagesPanel: OutagesPanel | null = null;
  private currentPowerOutages: PowerOutage[] = [];
  private currentTelecomOutages: TelecomOutage[] = [];
  private currentNetworkState: NetworkOutageState | null = null;
  private currentInfraState: InfraNetworkState | null = null;
  private currentCitizenZones: import('./types/index.ts').OutageZoneCollection | null = null;
  private defensePanel: DefensePanel | null = null;
  private currentDefenseAlerts: DefenseAlert[] = [];
  private submarineCablesData: GeoJSON.FeatureCollection<GeoJSON.LineString> | null = null;
  private nationalHealthPanel: NationalHealthPanel | null = null;
  private healthBarometerPanel: HealthBarometerPanel | null = null;
  private lastBarometerMetrics: HealthBarometerMetrics | null = null;
  private hasHealthData = false;
  private searchModal: SearchModal | null = null;
  private toastNotification: ToastNotification | null = null;
  private satellitePanel: SatellitePanel | null = null;
  private layerPanel: LayerPanel | null = null;
  private newsItems: NewsItem[] = [];
  private currentISNRData: ISNRData | null = null;
  private seenItemIds: Set<string> = new Set(); // Track seen items for toast notifications
  private currentMeteoAlerts: MeteoAlert[] = [];
  private _aisZeroWarnLogged = false; // Avoid spamming "0 ships" warning
  private _aisLoaderEl: HTMLElement | null = null; // Loader overlay while AIS connects
  private _showAisLoaderFn: (() => void) | null = null; // Ref so onLayerToggle can trigger it
  private currentMeteoTimeline: VigilanceTimeline | null = null;
  private currentEcowattResponse: EcowattResponse | null = null;
  private currentEcowattUsesFallback = false;

  private currentSncfDisruptions: TransportDisruption[] = [];
  private currentFloodSegments: FloodSegment[] = [];
  private currentTrafficIncidents: TrafficIncident[] = [];
  private activeLayers: MapLayers = { ...DEFAULT_LAYERS };

  private _intervalRSS: ReturnType<typeof setInterval> | null = null;
  private _intervalMilitaryFlights: ReturnType<typeof setInterval> | null = null;
  private _intervalShips: ReturnType<typeof setInterval> | null = null;
  private _intervalFinance: ReturnType<typeof setInterval> | null = null;
  private _intervalAirTraffic: ReturnType<typeof setInterval> | null = null;
  private _intervalHealth: ReturnType<typeof setInterval> | null = null;
  private _intervalClock: ReturnType<typeof setInterval> | null = null;
  private networkBarometerWidget: BarometerWidget | null = null;
  private _intervalNetworkBarometer: ReturnType<typeof setInterval> | null = null;

  public destroy(): void {
    if (this._intervalRSS !== null) { clearInterval(this._intervalRSS); this._intervalRSS = null; }
    if (this._intervalMilitaryFlights !== null) { clearInterval(this._intervalMilitaryFlights); this._intervalMilitaryFlights = null; }
    if (this._intervalShips !== null) { clearInterval(this._intervalShips); this._intervalShips = null; }
    if (this._intervalFinance !== null) { clearInterval(this._intervalFinance); this._intervalFinance = null; }
    if (this._intervalCommodities !== null) { clearInterval(this._intervalCommodities); this._intervalCommodities = null; }
    if (this._intervalAirTraffic !== null) { clearInterval(this._intervalAirTraffic); this._intervalAirTraffic = null; }
    if (this._intervalHealth !== null) { clearInterval(this._intervalHealth); this._intervalHealth = null; }
    if (this._intervalClock !== null) { clearInterval(this._intervalClock); this._intervalClock = null; }
    if (this._intervalNetworkBarometer !== null) {
      clearInterval(this._intervalNetworkBarometer);
      this._intervalNetworkBarometer = null;
    }
    this.networkBarometerWidget?.destroy();
    this.networkBarometerWidget = null;
    this.satellitePanel?.destroy();
    this.satellitePanel = null;
  }

  private isPanelVisible(element: HTMLElement | null): boolean {
    return !!element && element.style.display !== 'none';
  }

  private layoutEnergyFloatingPanels(): void {
    requestAnimationFrame(() => {
      const energyEl = this.container.querySelector<HTMLElement>('.energy-panel-modal');
      const gasEl = this.container.querySelector<HTMLElement>('.gas-panel-modal');
      const defaultTop = 'var(--right-panel-top)';

      if (!energyEl || !gasEl) return;

      energyEl.style.top = defaultTop;
      energyEl.style.right = '20px';
      energyEl.style.left = 'auto';
      energyEl.style.bottom = 'auto';

      if (!this.isPanelVisible(gasEl)) {
        return;
      }

      gasEl.style.right = '20px';
      gasEl.style.left = 'auto';
      gasEl.style.bottom = 'auto';

      if (this.isPanelVisible(energyEl)) {
        const stackedTop = energyEl.offsetTop + energyEl.offsetHeight + 16;
        gasEl.style.top = `${stackedTop}px`;
      } else {
        gasEl.style.top = defaultTop;
      }
    });
  }

  private syncTrafficGroupState(): void {
    this.activeLayers.traffic =
      this.activeLayers.trafficRoad ||
      this.activeLayers.trafficMaritime ||
      this.activeLayers.trafficAir;
  }

  private refreshTrafficLegend(): void {
    if (!this.mapLegend) return;

    this.mapLegend.setCategoryVisibility('trafficRoad', this.activeLayers.traffic && this.activeLayers.trafficRoad);
    this.mapLegend.setCategoryVisibility('trafficMaritime', this.activeLayers.traffic && this.activeLayers.trafficMaritime);
    this.mapLegend.setCategoryVisibility('trafficAir', this.activeLayers.traffic && this.activeLayers.trafficAir);
  }

  private formatLegendSourceStatus(status: 'ok' | 'stale' | 'error'): string {
    switch (status) {
      case 'ok':
        return 'réel';
      case 'stale':
        return 'partiel / fallback';
      default:
        return 'indisponible';
    }
  }

  private refreshEnergyDataLegends(): void {
    if (!this.mapLegend) return;

    const electricityNotes = this.currentEcowattResponse
      ? this.currentEcowattUsesFallback
        ? [
            'Qualité des données : signal électrique en fallback mock',
            'Mix/interconnexions : indisponibles ou partiels',
          ]
        : [
            'Qualité des données : signal, mix et interconnexions réels (eco2mix/ODRE)',
            'Détail réacteurs nucléaires : non inclus ici',
          ]
      : [
          'Qualité des données : chargement en cours',
        ];

    const gasNotes = this.currentGasData
      ? [
          `EcoGaz : ${this.formatLegendSourceStatus(this.currentGasData.sourceStatus.ecogaz)}`,
          'Stockages/flux : ODRE réels quand disponibles, fallback visuel sinon',
          'Terminaux et sites : statiques enrichis localement',
        ]
      : [
          'Qualité des données : chargement en cours',
        ];

    const oilNotes = this.currentOilData
      ? [
          `Dashboard pétrole : SDES/Insee/UFIP ${Object.values(this.currentOilData.sourceStatus).every((s) => s === 'ok') ? 'réel' : 'mixte'}`,
          'Pipelines, dépôts et raffineries : fond carto statique consolidé',
          'Arcs : projection OSINT à partir des parts d’origine, pas du port-à-port mesuré',
        ]
      : [
          'Qualité des données : chargement en cours',
        ];

    const infraNotes = [
      'Sites et tracés : majoritairement statiques',
      'Détail nucléaire réacteur par réacteur : mock / démonstrateur',
    ];

    this.mapLegend.addCategory(cloneLegend(ENERGY_ECOWATT_LEGEND, { notes: electricityNotes }));
    this.mapLegend.addCategory(cloneLegend(GAS_LEGEND, { notes: gasNotes }));
    this.mapLegend.addCategory(cloneLegend(OIL_LEGEND, { notes: oilNotes }));
    this.mapLegend.addCategory(cloneLegend(INFRASTRUCTURE_LEGEND, { notes: infraNotes }));
  }

  constructor(container: HTMLElement) {
    this.container = container;
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
      merged.traffic = merged.trafficRoad || merged.trafficMaritime || merged.trafficAir;
      merged.energyGroup = merged.energy || merged.gas || merged.oil || merged.infrastructure || merged.metropoles;
      merged.environmentGroup = merged.environmental || merged.fires || (merged.dayNight ?? false);
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

    // Initialize toast notification system
    this.toastNotification = new ToastNotification();
    this.toastNotification.setOnItemClick((item) => {
      // Fly to item location and select it
      if (item.lat != null && item.lon != null) {
        this.mapContainer?.flyTo(item.lon, item.lat, 12);
        this.mapContainer?.selectItem(item);
        this.newsPanel?.selectItem(item.id);
      }
    });
    // ── CHARGEMENT DYNAMIQUE DU JSON (Depuis /public) ──
    // --- CHARGEMENT DYNAMIQUE DU JSON (Depuis /public) ---
    try {
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
    } catch (err) {
      console.error("Erreur APL:", err);
    }
    // Handle military surge toast clicks - fly to surge location
    this.toastNotification.setOnSurgeClick((surge) => {
      if (surge.location) {
        // Ensure military layer is visible
        if (!this.activeLayers.military) {
          this.activeLayers.military = true;
          this.mapContainer?.setLayerVisibility(this.getEffectiveLayers());
          this.layerPanel?.updateLayers(this.activeLayers);
        }
        // Fly to surge location with appropriate zoom
        const zoom = surge.type === 'concentration' ? 9 : 10;
        this.mapContainer?.flyTo(surge.location.lon, surge.location.lat, zoom);
      }
    });

    // Handle GPS jamming toast clicks - activate military layer and fly to zone
    this.toastNotification.setOnJammingSignalClick((signal) => {
      if (!this.activeLayers.military) {
        this.onLayerToggle('military', true);
        this.layerPanel?.updateLayers(this.activeLayers);
      }
      // Cluster : zoom out proportionnel au rayon ; signal individuel : zoom serré
      const zoom = signal.clusterRadius != null
        ? (signal.clusterRadius > 50 ? 8 : 9)
        : 11;
      this.mapContainer?.flyTo(signal.position[0], signal.position[1], zoom);
    });

    // Handle defense alert toast clicks - fly to threat location and show panel
    this.toastNotification.setOnDefenseAlertClick((alert) => {
      // Fly to the threat coordinates
      this.mapContainer?.flyTo(alert.coordinates[0], alert.coordinates[1], 10);
      // Open the defense panel with current alerts
      if (this.defensePanel) {
        this.defensePanel.show(this.currentDefenseAlerts);
      }
    });

    // Handle AIS anomaly toast clicks - fly to ship location and open maritime alerts tab
    this.toastNotification.setOnAisAnomalyClick((anomaly: AisAnomaly) => {
      this.mapContainer?.flyTo(anomaly.position[0], anomaly.position[1], 10);
      this.maritimePanel?.openAlertsTab();
    });

    // Apply URL view if present
    if (urlState.lng != null && urlState.lat != null) {
      this.mapContainer?.flyTo(urlState.lng, urlState.lat, urlState.zoom ?? 6);
    }

    // Charger le cache local (affichage instantané)
    const cached = loadNewsFromCache();
    if (cached && cached.length > 0) {
      this.newsItems = cached;
      // Mark cached items as "seen" to avoid showing toasts for old articles
      for (const item of cached) {
        this.seenItemIds.add(item.id);
      }
      this.mapContainer?.updateNews(this.newsItems);
      this.newsPanel?.updateItems(this.newsItems);
      this.statusPanel?.updateSource('RSS PQR', { status: 'ok', lastUpdate: new Date() });
      console.log(`[Init] ${cached.length} articles chargés depuis le cache`);
    } else {
      this.newsItems = [];
    }

    await this.loadAllLayers();

    // Start RSS pipeline en arrière-plan (rafraîchit le cache)
    this.startRSSPipeline();
    // Start military polling
    this.startMilitaryPolling();
    // Start finance polling
    this.startFinancePolling();
    this.startCommodityPolling();
    // Start civilian air traffic polling (free-tier friendly cadence)
    this.startAirTrafficPolling();
    this.startHealthPolling();
    console.log('[FranceMonitor] App initialized — Phase 4 (cache + clustering + URL state)');
  }

  // ─── Shell Layout ───────────────────────────────────────────────────────────

  private renderShell(): void {
    // ── Header ──
    const header = document.createElement('header');
    header.className = 'header';
    header.innerHTML = `
      <div class="header-title">France <span>Monitor</span></div>
      <div class="header-center" id="region-presets"></div>
      <div class="header-status">
        <div id="header-data-sources"></div>
        <span class="header-clock" id="clock"></span>
        <span class="header-live-dot" title="En direct"></span>
      </div>
    `;
    this.container.appendChild(header);

    // Badge Premier Ministre dans le header (lecture statique GOUVERNEMENT)
    const pm = GOUVERNEMENT.find(m => m.isPM);
    if (pm) {
      const pmBadge = document.createElement('span');
      pmBadge.id = 'header-pm-badge';
      pmBadge.title = pm.titre;
      pmBadge.style.cssText = [
        'font-size:11px',
        'color:var(--text-secondary)',
        'border:1px solid var(--border-color)',
        'border-radius:4px',
        'padding:2px 7px',
        'white-space:nowrap',
        'letter-spacing:0.2px',
      ].join(';');
      pmBadge.textContent = `PM · ${pm.prenom[0]}. ${pm.nom}`;
      const clock = header.querySelector('#clock');
      if (clock) clock.before(pmBadge);
    }

    this.renderRegionPresets(document.getElementById('region-presets')!);
    const headerDataSources = document.getElementById('header-data-sources');
    if (headerDataSources) {
      this.statusPanel = new StatusPanel(headerDataSources, { variant: 'dropdown', icon: '' });
      this.statusPanel.setOnSourceClick((name) => this.handleSourcePanelClick(name));
      this.statusPanel.mount();
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

    // Mobile toggle button — only visible on small screens via CSS
    const mobileToggle = document.createElement('button');
    mobileToggle.className = 'right-sidebar-mobile-toggle';
    mobileToggle.setAttribute('aria-label', 'Ouvrir le panneau latéral');
    mobileToggle.textContent = '☰';
    mobileToggle.addEventListener('click', () => {
      const isOpen = rightSidebarEl.classList.toggle('open');
      mobileToggle.setAttribute('aria-label', isOpen ? 'Fermer le panneau latéral' : 'Ouvrir le panneau latéral');
    });
    mapArea.appendChild(mobileToggle);

    this.container.appendChild(main);

    // ── Mount sidebar panels ──
    const sidebarEl = document.getElementById('sidebar-content')!;

    // Baromètre Pannes Réseau (premier élément de la sidebar, avant les couches)
    this.networkBarometerWidget = new BarometerWidget(sidebarEl);
    this.networkBarometerWidget.mount();

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

    // Moitié droite : Flux actualités
    const newsFeedContainer = document.createElement('div');
    underMapGrid.appendChild(newsFeedContainer);
    this.newsPanel = new UnderMapNewsFeed(newsFeedContainer);
    this.newsPanel.setOnFilterChange((filter) => this.onFilterChange(filter));
    this.newsPanel.setOnItemClick((item) => {
      this.mapContainer?.selectItem(item);
      if (item.lon != null && item.lat != null) {
        this.mapContainer?.flyTo(item.lon, item.lat, 12);
      }
      if (item.threat?.category) {
        this.elusPanel?.setGovernmentContext([item.threat.category as EventCategory]);
      }
    });
    this.newsPanel.mount();
    const initialUrlState = readUrlState();
    this.newsPanel.setFilter({
      timeRange: initialUrlState.timeRange === '1h' || initialUrlState.timeRange === '6h' || initialUrlState.timeRange === '24h' || initialUrlState.timeRange === '48h' || initialUrlState.timeRange === '7d' || initialUrlState.timeRange === 'all'
        ? initialUrlState.timeRange
        : '24h',
      searchQuery: initialUrlState.searchQuery ?? '',
    });

    // Floating panels (mounted to App root container)
    const floatContainer = document.createElement('div');
    this.container.appendChild(floatContainer);

    this.weatherPanel = new WeatherPanel(floatContainer);
    this.weatherPanel.setOnHoverDepartment((code) => {
      this.mapContainer?.highlightWeatherDepartment(code);
    });
    this.weatherPanel.setOnSlotChange((_slotIndex, alerts) => {
      // Update map when user selects a different time slot
      this.currentMeteoAlerts = alerts;
      this.mapContainer?.updateWeather(alerts);
    });
    this.weatherPanel.mount();

    this.energyPanel = new EnergyPanel(floatContainer);
    this.energyPanel.setOnClose(() => {
      this.activeLayers.energy = false;
      this.layerPanel?.updateLayers(this.activeLayers);
      this.layoutEnergyFloatingPanels();
    });
    this.energyPanel.mount();

    this.isnrPanel = new ISNRPanel(floatContainer);
    this.isnrPanel.setOnHoverDepartment((code) => {
      this.mapContainer?.highlightISNRDepartment(code);
    });
    this.isnrPanel.setOnClickDepartment((code) => {
      const dept = DEPARTMENTS[code];
      if (dept) {
        // Fly to department centroid (approximate)
        this.mapContainer?.flyTo(2.2, 46.6, 8); // Default, will be overridden by actual coords
      }
    });
    this.isnrPanel.mount();

    this.nationalHealthPanel = new NationalHealthPanel(floatContainer);
    this.nationalHealthPanel.mount();

    this.healthBarometerPanel = new HealthBarometerPanel(floatContainer);
    this.healthBarometerPanel.mount();

    const refreshNetworkBarometer = async (): Promise<void> => {
      const result = await fetchNetworkBarometer();
      this.networkBarometerWidget?.update(result);

      // Headline filtering: medium/high first (dense signal), fallback to low
      // to confirm stability when no high-impact events are present
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

      const synthesis = await fetchISNRSynthesis(result, headlines, this.currentISNRData?.nationalScore, isnrDepts).catch(() => null);
      this.networkBarometerWidget?.updateBriefing(synthesis);
    };
    void refreshNetworkBarometer();
    this._intervalNetworkBarometer = setInterval(
      () => refreshNetworkBarometer().catch(err => console.error('[App] Network barometer poll error', err)),
      5 * 60_000
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
          this.weatherPanel?.hide();
          this.energyPanel?.hide();
          this.transportPanel?.hide();
          this.floodsPanel?.hide();
          this.firesPanel?.hide();
          this.elusPanel?.hide();
          this.trafficPanel?.hide();
          this.isnrPanel?.hide();

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
        this.weatherPanel?.hide();
        this.energyPanel?.hide();
        this.transportPanel?.hide();
        this.floodsPanel?.hide();
        this.firesPanel?.hide();
        this.elusPanel?.hide();
        this.trafficPanel?.hide();
        this.isnrPanel?.hide();
        // Remove nationalHealthPanel?.hide() to allow both panels to be open simultaneously
        this.healthBarometerPanel?.show(metrics);
      }
    });

    this.transportPanel = new TransportPanel(floatContainer);
    this.transportPanel.setOnHover((departure, arrival) => {
      this.mapContainer?.highlightTrainRoute(departure, arrival);
      // Fly to midpoint if route exists
      if (departure) {
        if (arrival) {
          const midLon = (departure[0] + arrival[0]) / 2;
          const midLat = (departure[1] + arrival[1]) / 2;
          this.mapContainer?.flyTo(midLon, midLat, 7);
        } else {
          this.mapContainer?.flyTo(departure[0], departure[1], 10);
        }
      }
    });
    this.transportPanel.mount();

    this.floodsPanel = new FloodsPanel(floatContainer);
    this.floodsPanel.mount();

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
    this.firesPanel.setOnModisToggle((enabled) => {
      this.mapContainer?.setModisOverlayVisible(enabled);
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

    this.elusPanel = new ElusPanel(floatContainer);
    this.elusPanel.mount();

    // Cyber Panel (Cybersecurity Dashboard)
    this.cyberPanel = new CyberPanel(floatContainer);
    this.cyberPanel.setOnClose(() => {
      // Optional: could update StatusPanel state here
    });
    this.cyberPanel.mount();

    // Gas Panel (EcoGaz + Vital Organs Dashboard)
    this.gasPanel = new GasPanel(floatContainer);
    this.gasPanel.setOnClose(() => {
      this.activeLayers.gas = false;
      this.layerPanel?.updateLayers(this.activeLayers);
      this.layoutEnergyFloatingPanels();
    });
    this.gasPanel.mount();

    // Oil Panel (Vigilance Pétrole - Raffineries, Stocks, Flux)
    this.oilPanel = new OilPanel(floatContainer);
    this.oilPanel.setOnClose(() => {
      this.activeLayers.oil = false;
      this.layerPanel?.updateLayers(this.activeLayers);
    });
    this.oilPanel.mount();

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
    this.outagesPanel.mount();

    // Defense Panel (Cable threats) - positioned below CyberPanel
    this.defensePanel = new DefensePanel(floatContainer);
    this.defensePanel.setOnClose(() => {
      // Optional: could update StatusPanel state here
    });
    this.defensePanel.setOnAlertClick((alert) => {
      // Fly to the threat location when clicking on an alert item
      this.mapContainer?.flyTo(alert.coordinates[0], alert.coordinates[1], 10);
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
    this.searchModal = new SearchModal(this.container);
    this.searchModal.setOnFlyTo((lon, lat, zoom, item) => {
      this.mapContainer?.flyTo(lon, lat, zoom);
      if (item) {
        this.mapContainer?.selectItem(item);
        this.newsPanel?.selectItem(item.id);
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
    container.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;';
    for (const key of presets) {
      const preset = VIEW_PRESETS[key];
      if (!preset) continue;
      const btn = document.createElement('button');
      btn.className = 'region-preset-btn';
      btn.textContent = preset.name;
      btn.addEventListener('click', () => {
        this.mapContainer?.flyTo(preset.center[0], preset.center[1], preset.zoom);
      });
      container.appendChild(btn);
    }
  }

  private handleSourcePanelClick(name: string): void {
    this.weatherPanel?.hide();
    this.energyPanel?.hide();
    this.transportPanel?.hide();
    this.floodsPanel?.hide();
    this.firesPanel?.hide();
    this.elusPanel?.hide();
    this.trafficPanel?.hide();
    this.isnrPanel?.hide();
    this.nationalHealthPanel?.hide();

    if (name === 'Météo-France') {
      this.weatherPanel?.show(this.currentMeteoAlerts, this.currentMeteoTimeline ?? undefined);
    } else if (name === 'SNCF') {
      this.transportPanel?.show(this.currentSncfDisruptions);
    } else if (name === 'Vigicrues') {
      this.floodsPanel?.show(this.currentFloodSegments);
    } else if (name === 'NASA FIRMS') {
      this.firesPanel?.show(this.currentActiveFires);
    } else if (name === 'Trafic') {
      this.trafficPanel?.show(this.currentTrafficIncidents);
    } else if (name === 'Cyber') {
      this.cyberPanel?.show(this.currentCyberData);
    }
  }

  private getEffectiveLayers(): MapLayers {
    const effective: MapLayers = { ...this.activeLayers };
    effective.traffic =
      effective.trafficRoad ||
      effective.trafficMaritime ||
      effective.trafficAir;
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

  private onLayerToggle(key: keyof MapLayers, enabled: boolean): void {
    this.activeLayers[key] = enabled;
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
      this.activeLayers.sovereignty = this.activeLayers.military || this.activeLayers.subseaCables || this.activeLayers.cyber;
    }
    if (key === 'energy' || key === 'gas' || key === 'oil' || key === 'infrastructure' || key === 'metropoles') {
      this.activeLayers.energyGroup =
        this.activeLayers.energy ||
        this.activeLayers.gas ||
        this.activeLayers.oil ||
        this.activeLayers.infrastructure ||
        this.activeLayers.metropoles;
    }
    if (key === 'environmental' || key === 'fires' || key === 'dayNight') {
      this.activeLayers.environmentGroup =
        this.activeLayers.environmental ||
        this.activeLayers.fires ||
        (this.activeLayers.dayNight ?? false);
    }
    if (key === 'trafficRoad' || key === 'trafficMaritime' || key === 'trafficAir') {
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

    this.mapContainer?.setLayerVisibility(this.getEffectiveLayers());

    // Dynamic legend visibility using group logic
    const groupsOn = new Set(
      LAYER_CONFIGS
        .filter(l => l.role === "groupMaster" && this.activeLayers[l.id])
        .map(l => l.groupId)
    );

    for (const config of LAYER_CONFIGS) {
      if (config.legend) {
        let isVisible = false;
        if (this.activeLayers[config.id]) {
          if (config.role === 'child' && config.dependsOnGroup) {
            isVisible = groupsOn.has(config.groupId);
          } else {
            isVisible = true; // standalone or dependsOnGroup=false
          }
        }
        this.mapLegend?.setCategoryVisibility(config.legend.id, isVisible);
      }
    }
    this.refreshTrafficLegend();

    // Persist layer state to localStorage for next session
    try {
      localStorage.setItem('fm-active-layers', JSON.stringify(this.activeLayers));
    } catch (err) {
      console.warn('[App] localStorage quota exceeded, could not persist layer state', err);
    }
    // Also update URL
    writeUrlState({ layers: this.activeLayers });

    // ➡️ 1. AJOUT : Mise à jour du bouton flottant (FAB)
    this.updateBarometerFabVisibility();

    // Masquer le loader AIS si le layer maritime est désactivé
    if (key === 'trafficMaritime' && !enabled && this._aisLoaderEl) {
      this._aisLoaderEl.remove();
      this._aisLoaderEl = null;
    }
    // Afficher le loader AIS si le layer est activé et qu'on n'a pas encore de navires
    if (key === 'trafficMaritime' && enabled && getAllLiveTraffic().length === 0) {
      this._showAisLoaderFn?.();
    }
    // Show/hide MaritimePanel with layer
    if (key === 'trafficMaritime') {
      if (enabled) this.maritimePanel?.show();
      else this.maritimePanel?.hide();
    }

    // Show/hide ISNR panel when stability layer is toggled
    if (key === 'stability') {
      if (this.activeLayers.stability && this.currentISNRData) {
        this.isnrPanel?.show(this.currentISNRData);
      } else {
        this.isnrPanel?.hide();
      }
    } else if (key === 'energyGroup') {
      if (!this.activeLayers.energyGroup) {
        this.energyPanel?.hide();
        this.layoutEnergyFloatingPanels();
      }
    } else if (key === 'environmentGroup') {
      if (!this.activeLayers.environmentGroup) {
        this.firesPanel?.hide();
        this.dayNightPanel?.hide();
      }
    } else if (key === 'health' || key === 'healthApl' || key === 'healthOscour' || key === 'hospitals') {
      const isAnyHealthLayerActive =
        this.activeLayers.health ||
        this.activeLayers.healthApl ||
        this.activeLayers.healthOscour ||
        this.activeLayers.hospitals;

      if (enabled && !this.hasHealthData) {
        this.loadHealth().catch((error) => {
          console.error('[App] Failed to reload health layers', error);
        });
      }

      if (enabled && isAnyHealthLayerActive) {
        document.dispatchEvent(new CustomEvent('open-national-health'));
      } else if (!isAnyHealthLayerActive) {
        this.healthBarometerPanel?.hide();
        this.nationalHealthPanel?.hide();
      }
    } else if (key === 'sovereignty') {
      if (!this.activeLayers.sovereignty) {
        this.cyberPanel?.hide();
        this.defensePanel?.hide();
      } else {
        if (this.activeLayers.cyber) {
          if (!this.currentCyberData) {
            this.loadCyber();
          }
          this.cyberPanel?.show(this.currentCyberData);
        }
        if (this.activeLayers.military) {
          this.defensePanel?.show(this.currentDefenseAlerts);
        }
      }
    } else if (key === 'cyber') {
      console.log('[App/onLayerToggle] cyber toggle:', this.activeLayers.cyber);
      if (this.activeLayers.cyber && this.activeLayers.sovereignty) {
        console.log('[App/onLayerToggle] Cyber layer ENABLED');
        // Load data if not yet fetched
        if (!this.currentCyberData) {
          console.log('[App/onLayerToggle] No data yet, calling loadCyber()...');
          this.loadCyber();
        }
        this.cyberPanel?.show(this.currentCyberData);
      } else {
        console.log('[App/onLayerToggle] Cyber layer DISABLED, hiding panel');
        this.cyberPanel?.hide();
      }
    } else if (key === 'military') {
      if (this.activeLayers.military && this.activeLayers.sovereignty) {
        this.defensePanel?.show(this.currentDefenseAlerts);
      } else {
        this.defensePanel?.hide();
      }
    } else if (key === 'subseaCables') {
      // No panel to toggle: layer is visual-only, threat panel remains tied to defense alerts.
    } else if (key === 'energy') {
      if (this.activeLayers.energy) {
        this.energyPanel?.show(this.currentEcowattResponse);
        this.layoutEnergyFloatingPanels();
      } else {
        this.energyPanel?.hide();
        this.layoutEnergyFloatingPanels();
      }
    } else if (key === 'gas') {
      console.log('[App/onLayerToggle] gas toggle:', this.activeLayers.gas);
      if (this.activeLayers.gas) {
        // Load data if not yet fetched
        if (!this.currentGasData) {
          this.loadGas();
        }
        this.gasPanel?.show(this.currentGasData);
        this.layoutEnergyFloatingPanels();
      } else {
        this.gasPanel?.hide();
        this.layoutEnergyFloatingPanels();
      }
    } else if (key === 'oil') {
      console.log('[App/onLayerToggle] oil toggle:', this.activeLayers.oil);
      if (this.activeLayers.oil) {
        // Load data if not yet fetched
        if (!this.currentOilData) {
          this.loadOil();
        }
        this.oilPanel?.show(this.currentOilData);
      } else {
        this.oilPanel?.hide();
      }
    } else if (key === 'fires') {
      if (this.activeLayers.fires) {
        this.firesPanel?.show(this.currentActiveFires);
      } else {
        this.firesPanel?.hide();
      }
    } else if (key === 'dayNight') {
      if (enabled) {
        this.dayNightPanel?.show();
      } else {
        this.dayNightPanel?.hide();
      }
    } else if (key === 'elus') {
      void this.mapContainer?.setMairesPolitiqueVisible(enabled);
      if (enabled) {
        this.elusPanel?.showPlaceholder();
      } else {
        this.elusPanel?.hide();
      }
    } else if (key === 'outages') {
      // Parent master: si désactivé, ferme le panneau
      if (!this.activeLayers.outages) {
        this.outagesPanel?.hide();
      }
    } else if (key === 'outagesElec' || key === 'outagesTelecom' || key === 'outagesInternet' || key === 'outagesCloud') {
      if (this.activeLayers.outages) {
        // Auto-switch tab only when exactly one sub-layer is active
        const activeCount = [
          this.activeLayers.outagesElec,
          this.activeLayers.outagesTelecom,
          this.activeLayers.outagesInternet,
          this.activeLayers.outagesCloud,
        ].filter(Boolean).length;
        let autoTab: 'electric' | 'telecom' | 'internet' | 'cloud' | undefined;
        if (activeCount === 1) {
          if (this.activeLayers.outagesElec)      autoTab = 'electric';
          else if (this.activeLayers.outagesTelecom)  autoTab = 'telecom';
          else if (this.activeLayers.outagesInternet) autoTab = 'internet';
          else if (this.activeLayers.outagesCloud)    autoTab = 'cloud';
        }
        this.outagesPanel?.show(this.currentPowerOutages, this.currentTelecomOutages, this.currentNetworkState, this.currentInfraState, this.currentCitizenZones ?? undefined, autoTab);
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

      // Show toast notification with cluster info
      if (this.toastNotification) {
        // Create a synthetic item for the toast
        const clusterToast = {
          ...firstItem,
          title: `${items.length} articles au même endroit`,
          threat: { ...firstItem.threat!, level: 'high' as const },
        };
        this.toastNotification.show(clusterToast);
      }
    });


    // Raw map click → élus panel (clic direct sur la carte, hors articles/clusters)
    this.mapContainer.setOnRawMapClick((lat, lon) => {
      if (this.activeLayers.elus) this.elusPanel?.show(lat, lon);
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
    this.mapPopup = new MapPopup(mapEl);

    // ─── Satellite Panel ───
    this.satellitePanel = new SatellitePanel(this.container);

    const openSatelliteView = (req: SatelliteViewRequest): void => {
      // Mobile guard: open EO Browser directly, no panel
      if (window.innerWidth < 768) {
        const eoBrowserUrl = buildEoBrowserUrl(
          req.bbox,
          req.preferredCollection ?? 'sentinel-2-l2a',
          new Date(),  // explicit date — avoids missing toTime in S2 URL
        );
        window.open(eoBrowserUrl, '_blank', 'noopener');
        return;
      }
      this.satellitePanel?.show(req);
    };

    // Wire callbacks: mapContainer relays to deckMap; mapPopup has its own setter
    this.mapContainer?.setOnSatelliteView(openSatelliteView);
    this.mapPopup?.setOnSatelliteView(openSatelliteView);

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
    this.mapLegend.addCategory(HEALTH_ISS_LEGEND);
    this.mapLegend.addCategory(HEALTH_APL_LEGEND);
    this.mapLegend.addCategory(HEALTH_OSCOUR_LEGEND);
    this.mapLegend.addCategory(HOSPITALS_LEGEND);
    this.mapLegend.addCategory(ENERGY_ECOWATT_LEGEND);
    this.mapLegend.addCategory(GAS_LEGEND);
    this.mapLegend.addCategory(OIL_LEGEND);
    this.mapLegend.addCategory(INFRASTRUCTURE_LEGEND);
    this.mapLegend.addCategory(METROPOLES_ELECTRIC_LEGEND);
    this.mapLegend.addCategory(MILITARY_LEGEND);
    this.mapLegend.addCategory(SUBSEA_CABLES_LEGEND);
    this.mapLegend.addCategory(CYBER_LEGEND);
    this.mapLegend.addCategory(OUTAGES_ELEC_LEGEND);
    this.mapLegend.addCategory(OUTAGES_TELECOM_LEGEND);
    this.mapLegend.addCategory(OUTAGES_INTERNET_LEGEND);
    this.mapLegend.addCategory(OUTAGES_CLOUD_LEGEND);
    this.refreshEnergyDataLegends();

    // Initialize legend visibility using the same logic
    const groupsOn = new Set(
      LAYER_CONFIGS
        .filter(l => l.role === "groupMaster" && this.activeLayers[l.id])
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
        this.mapLegend.setCategoryVisibility(config.legend.id, isVisible);
      }
    }
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
        const flights = await fetchMilitaryFlights();
        this.mapContainer?.updateMilitaryFlights(flights);

        // Detect and display military surges (WorldMonitor pattern)
        const surges = detectMilitarySurges(
          flights.map((f) => ({
            latitude: f.latitude,
            longitude: f.longitude,
            aircraftType: f.aircraftType,
            squawkAlert: f.squawkAlert,
          }))
        );
        if (surges.length > 0) {
          this.toastNotification?.showMilitarySurges(surges);

          // If emergency surge, also update status panel
          const emergencies = surges.filter((s) => s.type === 'emergency');
          if (emergencies.length > 0) {
            this.statusPanel?.updateSource('Military', {
              status: 'error',
              lastUpdate: new Date(),
              error: emergencies[0].description,
            });
          }
        }

        // Détection brouillage GPS / guerre électronique (heuristique ADS-B)
        const jammingSignals = detectGpsJammingSignals(flights);
        if (jammingSignals.length > 0) {
          this.toastNotification?.showJammingSignals(jammingSignals);
        }
      } catch (err) {
        console.error('[Military] Failed to fetch flights', err);
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
        const aisDetail = `${AIS_RELAY_URL} · ${aisStatus.shipCount} navire${aisStatus.shipCount > 1 ? 's' : ''} · ${aisStatus.messageCount} msg`;
        this.statusPanel?.updateSource('AIS maritime', {
          status: aisStatus.connected ? (aisStatus.shipCount > 0 ? 'ok' : 'loading') : 'stale',
          lastUpdate: aisStatus.connected ? new Date() : null,
          detail: aisStatus.connected ? aisDetail : `${AIS_RELAY_URL} · relais déconnecté`,
          error: undefined,
        });

        // Navires Marine Nationale pour l'affichage sur la carte (icônes dédiées)
        const militaryShips = getMilitaryShips();
        this.mapContainer?.updateMilitaryShips(militaryShips);

        // Use exported NAVY_MMSI_SET (sovereign whitelist) - more reliable than runtime-built set
        const navyMmsiSet = NAVY_MMSI_SET;

        // Tout le trafic AIS mondial (civils, étrangers, etc.)
        const allTraffic = getAllLiveTraffic();

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
        const aisAnomalies = detectAisAnomalies(getAllLiveTraffic());
        for (const anomaly of aisAnomalies) {
          this.toastNotification?.showAisAnomaly(anomaly);
        }

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
          detail: AIS_RELAY_URL,
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
        this.defensePanel.update(this.currentDefenseAlerts);
      }

      // Show toast notifications for high/medium severity alerts
      if (this.currentDefenseAlerts.length > 0) {
        this.toastNotification?.showDefenseAlerts(this.currentDefenseAlerts);
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
        this.marketStrip?.update(data);
        if (data.length > 0) {
          this.financePanel?.show(data);
        }
      } catch (err) {
        console.error('[Finance] Polling failed', err);
      }
    };
    fetchFinance();
    this._intervalFinance = setInterval(() => fetchFinance().catch(err => console.error('[App] Finance poll error', err)), 5 * 60_000); // 5 min
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
      15 * 60_000,
    );
  }

  private startAirTrafficPolling(): void {
    const AIR_TRAFFIC_POLL_MS = 12_000;
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
    }, AIR_TRAFFIC_POLL_MS);
  }

  private async fetchAndProcessRSS(): Promise<void> {
    try {
      this.statusPanel?.updateSource('RSS PQR', { status: 'loading', lastUpdate: null });
      const rawItems = await fetchAllFeeds(ALL_FEEDS);
      console.log(`[RSS] Fetched ${rawItems.length} raw items`);

      if (rawItems.length === 0) {
        this.statusPanel?.updateSource('RSS PQR', { status: 'stale', lastUpdate: new Date() });
        return; // Keep mock data
      }

      // 1. Classify by keywords IMMEDIATELY
      for (const item of rawItems) {
        if (!item.threat) {
          // Fast local keyword approach initially
          item.threat = classifyByKeywords(item.title, item.summary);
        }
      }

      // Update news items directly with RSS results (fast path)
      this.newsItems = [...rawItems].sort(
        (a, b) => b.pubDate.getTime() - a.pubDate.getTime(),
      );

      // Update UI immediately with keywords
      this.mapContainer?.updateNews(this.newsItems);
      this.newsPanel?.updateItems(this.newsItems);
      this.searchModal?.updateNewsItems(this.newsItems);
      this.statusPanel?.updateSource('RSS PQR', { status: 'ok', lastUpdate: new Date() });

      // Detect new critical items and show toast notifications
      const newCriticalItems = rawItems.filter((item) => {
        if (this.seenItemIds.has(item.id)) return false;
        this.seenItemIds.add(item.id);
        return item.threat?.level === 'critical' || item.threat?.level === 'high';
      });
      if (newCriticalItems.length > 0 && this.toastNotification) {
        this.toastNotification.showForNewCriticalItems(newCriticalItems);
      }

      console.log(`[RSS] Pipeline stage 1 complete: ${rawItems.length} items parsed and classified by keywords.`);

      // 2. Background processing for AI & Geocoding
      // We don't await this so it doesn't block the next UI updates or user interactions
      this.augmentItemsInBackground([...this.newsItems]);

    } catch (err) {
      console.error('[RSS] Pipeline failed:', err);
      this.statusPanel?.updateSource('RSS PQR', { status: 'error', lastUpdate: new Date() });
    }
  }

  // ─── Background AI & Geocoding ─────────────────────────────────────────────

  private async augmentItemsInBackground(items: NewsItem[]): Promise<void> {
    // Run AI classification and geocoding in PARALLEL — geocoding must NOT wait for AI model to load
    await Promise.all([
      this.runAIClassification(items),
      this.runGeocoding(items),
      this.runSummarization(items),
    ]);

    // Cache the fully augmented results once both are done
    saveNewsToCache(this.newsItems);
    console.log(`[RSS] Pipeline stage 2 (background) complete: AI, Geocoding & Summarization.`);
  }

  /** Classify items that have no threat yet via AI (slower — model load takes time) */
  private async runAIClassification(items: NewsItem[]): Promise<void> {
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
        this.newsItems = [...items].sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
        this.mapContainer?.updateNews(this.newsItems);
        this.newsPanel?.updateItems(this.newsItems);
        this.searchModal?.updateNewsItems(this.newsItems);
      }
    } catch (err) {
      console.error('[RSS] AI classification failed:', err);
    }
  }

  /** Geocode items without coordinates, batched and throttled */
  private async runGeocoding(items: NewsItem[]): Promise<void> {
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
          this.newsItems = [...items].sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
          this.mapContainer?.updateNews(this.newsItems);
          this.newsPanel?.updateItems(this.newsItems);
          this.searchModal?.updateNewsItems(this.newsItems);
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
  private async runSummarization(items: NewsItem[]): Promise<void> {
    try {
      const toSummarize = items.filter((it) => !it.aiSummary && it.summary);
      if (toSummarize.length === 0) return;

      const BATCH_SIZE = 3;
      for (let i = 0; i < toSummarize.length; i += BATCH_SIZE) {
        const batch = toSummarize.slice(i, i + BATCH_SIZE);
        let batchUpdated = false;
        await Promise.all(
          batch.map(async (item) => {
            const sum = await summarizeWithFallback(item.summary!);
            if (sum) {
              item.aiSummary = sum;
              batchUpdated = true;
            }
          }),
        );

        if (batchUpdated) {
          this.newsItems = [...items].sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
          this.mapContainer?.updateNews(this.newsItems);
          this.newsPanel?.updateItems(this.newsItems);
          this.searchModal?.updateNewsItems(this.newsItems);
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
      this.currentEcowattResponse = { signals: MOCK_ECOWATT_REGIONS, mixes: {}, national: { timestamp: new Date(), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 }, interconnections: [] };
      this.currentEcowattUsesFallback = true;
      await this.mapContainer?.updateEnergy(this.currentEcowattResponse);
      this.mapContainer?.updateEnergyTooltipData(energyRegions.regions, energyRegions.flows, borderHistory);
      this.statusPanel?.updateSource('Écowatt RTE', { status: 'stale', lastUpdate: new Date() });
    }

    if (this.activeLayers.energy) {
      this.energyPanel?.show(this.currentEcowattResponse);
      this.layoutEnergyFloatingPanels();
    }

    this.refreshEnergyDataLegends();
  }

  private async loadWeather(): Promise<void> {
    this.statusPanel?.updateSource('Météo-France', { status: 'loading', lastUpdate: null });

    // Fetch timeline with all time slots
    const timeline = await fetchVigilanceTimeline();
    this.currentMeteoTimeline = timeline;

    // Get alerts for current time slot
    const currentAlerts = timeline.slots[timeline.currentSlotIndex]?.alerts ?? [];

    if (currentAlerts.length > 0 || timeline.slots.some(s => s.alerts.length > 0)) {
      this.currentMeteoAlerts = currentAlerts;
      await this.mapContainer?.updateWeather(currentAlerts);
      this.statusPanel?.updateSource('Météo-France', { status: 'ok', lastUpdate: new Date() });
    } else {
      // Fallback to simple fetch if timeline is empty
      const alerts = await fetchVigilanceMeteo();
      if (alerts.length > 0) {
        this.currentMeteoAlerts = alerts;
        await this.mapContainer?.updateWeather(alerts);
        this.statusPanel?.updateSource('Météo-France', { status: 'ok', lastUpdate: new Date() });
      } else {
        this.currentMeteoAlerts = MOCK_METEO_ALERTS;
        await this.mapContainer?.updateWeather(MOCK_METEO_ALERTS);
        this.statusPanel?.updateSource('Météo-France', { status: 'stale', lastUpdate: new Date() });
      }
    }
  }

  private async loadFloods(): Promise<void> {
    this.statusPanel?.updateSource('Vigicrues', { status: 'loading', lastUpdate: null });
    const segments = await fetchVigicrues();
    if (segments.length > 0) {
      this.currentFloodSegments = segments;
      this.mapContainer?.updateFloods(segments);
      this.statusPanel?.updateSource('Vigicrues', { status: 'ok', lastUpdate: new Date() });
    } else {
      this.currentFloodSegments = MOCK_FLOOD_SEGMENTS;
      this.mapContainer?.updateFloods(MOCK_FLOOD_SEGMENTS);
      this.statusPanel?.updateSource('Vigicrues', { status: 'stale', lastUpdate: new Date() });
    }
  }

  private async loadFires(): Promise<void> {
    this.statusPanel?.updateSource('NASA FIRMS', { status: 'loading', lastUpdate: null });
    const fires = await fetchActiveFires();
    this.currentActiveFires = fires;
    // setRawFires triggers applyFiresFilter + onFilteredFiresCb (updates map) + re-renders panel if open
    this.firesPanel?.setRawFires(fires);
    if (fires.length > 0) {
      this.statusPanel?.updateSource('NASA FIRMS', { status: 'ok', lastUpdate: new Date() });
    } else {
      this.statusPanel?.updateSource('NASA FIRMS', { status: 'stale', lastUpdate: new Date() });
    }
  }

  private async loadInfrastructure(): Promise<void> {
    const statuses = await fetchNuclearPlantsStatus();
    const staticInfrastructure = ALL_INFRASTRUCTURE.filter((point) => point.type !== 'nuclear');
    this.mapContainer?.updateInfrastructure([...statuses, ...staticInfrastructure]);
  }

  private async loadTraffic(): Promise<void> {
    this.statusPanel?.updateSource('Trafic', { status: 'loading', lastUpdate: null });
    try {
      const incidents = await fetchTrafficIncidents();
      const osintIncidents = filterOsintTrafficIncidents(incidents);
      if (osintIncidents.length > 0) {
        this.currentTrafficIncidents = osintIncidents;
        this.mapContainer?.updateTrafficIncidents(osintIncidents);
        this.statusPanel?.updateSource('Trafic', {
          status: 'ok',
          lastUpdate: new Date(),
          detail: `${osintIncidents.length}/${incidents.length} signaux OSINT`,
          error: undefined,
        });
        return;
      }

      this.mapContainer?.updateTrafficIncidents([]);
      this.statusPanel?.updateSource('Trafic', {
        status: incidents.length > 0 ? 'stale' : 'stale',
        lastUpdate: new Date(),
        detail: incidents.length > 0 ? `TomTom · ${incidents.length} incidents, aucun retenu OSINT` : 'TomTom · aucun incident renvoyé',
        error: undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      this.currentTrafficIncidents = [];
      this.mapContainer?.updateTrafficIncidents([]);
      this.statusPanel?.updateSource('Trafic', {
        status: 'error',
        lastUpdate: new Date(),
        detail: 'TomTom · incidents routiers',
        error: message,
      });
    }
  }

  private async loadAirTraffic(): Promise<void> {
    this.statusPanel?.updateSource('Trafic aérien', {
      status: 'loading',
      lastUpdate: null,
      detail: 'OpenSky primaire · airplanes.live fallback · 12 s',
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
    const signalDetail = snapshot.signalCount ? ` · ${snapshot.signalCount} signal${snapshot.signalCount > 1 ? 'aux' : ''} OSINT` : '';
    const topAirportDetail = Array.isArray(snapshot.topAirports) && snapshot.topAirports.length > 0
      ? ` · ${snapshot.topAirports
          .slice(0, 3)
          .map((airport) => `${airport.iata} ${airport.score}`)
          .join(' · ')}`
      : '';

    if (flights.length > 0) {
      this.statusPanel?.updateSource('Trafic aérien', {
        status: 'ok',
        lastUpdate: new Date(),
        detail: `${sourceBreakdown} = ${flights.length} vols${anomalyDetail}${signalDetail}${topAirportDetail}${degradedDetail}`,
        error: undefined,
      });
    } else {
      this.statusPanel?.updateSource('Trafic aérien', {
        status: snapshot.errors && snapshot.errors.length > 0 ? 'error' : 'stale',
        lastUpdate: new Date(),
        detail: snapshot.errors && snapshot.errors.length > 0
          ? `${sourceBreakdown} · aucune position exploitable`
          : `${sourceBreakdown} · aucun vol dans l’échantillon`,
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

    if (!isOilPanelEnabled()) {
      console.log('[App/loadOil] Feature DISABLED, skipping...');
      this.statusPanel?.updateSource('Pétrole', { status: 'stale', lastUpdate: null });
      this.currentOilData = null;
      this.refreshEnergyDataLegends();
      return;
    }

    this.statusPanel?.updateSource('Pétrole', { status: 'loading', lastUpdate: null });

    try {
      const oilData = await fetchOilDashboard();
      this.currentOilData = oilData;

      // Update map visualization (refineries, depots, pipelines, origin-linked flows)
      const oilFlows = this.buildOilFlowsFromDashboard(oilData);

      await this.mapContainer?.updateOil(oilFlows);
      await this.mapContainer?.updateOilInfrastructure(oilData);

      // Try to load pipeline GeoJSON
      await this.mapContainer?.loadOilPipelines();

      // Determine status
      const allOk = Object.values(oilData.sourceStatus).every(s => s === 'ok');
      const someOk = Object.values(oilData.sourceStatus).some(s => s === 'ok');

      if (allOk) {
        this.statusPanel?.updateSource('Pétrole', { status: 'ok', lastUpdate: new Date() });
      } else if (someOk) {
        this.statusPanel?.updateSource('Pétrole', { status: 'stale', lastUpdate: new Date() });
      } else {
      this.statusPanel?.updateSource('Pétrole', { status: 'error', lastUpdate: new Date() });
      }

      // Update panel if visible
      this.oilPanel?.update(oilData);
      this.refreshEnergyDataLegends();

      console.log(`[App/loadOil] Complete: Status=${oilData.meta.status}, StocksDays=${oilData.stocks.nationalStocksDays}`);
    } catch (err) {
      console.error('[App/loadOil] Failed:', err);
      this.statusPanel?.updateSource('Pétrole', { status: 'error', lastUpdate: new Date() });
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

    if (label.includes('afrique')) {
      return {
        coordinates: [2.0, 17.0],
        franceCoordinates: [4.94, 43.43],
        hubName: 'Fos / Lavera',
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
    const disruptions = await fetchSncfDisruptions();
    this.currentSncfDisruptions = disruptions;
    if (disruptions.length > 0) {
      this.statusPanel?.updateSource('SNCF', { status: 'ok', lastUpdate: new Date() });
      console.log(`[SNCF] ${disruptions.length} perturbations chargées`);
    } else {
      this.statusPanel?.updateSource('SNCF', { status: 'stale', lastUpdate: new Date() });
    }
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

    // Citizen zones (scraping HTML ~8-15s) lancé indépendamment pour ne pas bloquer les autres sources
    const citizenZonesPromise = fetchOutageZoneCollection()
      .then(zones => {
        this.currentCitizenZones = zones;
        this.mapContainer?.updateCitizenOutageZones(zones);
      })
      .catch(() => {});

    // Sources rapides (<2s) : télécom, électrique, réseau, infra
    const [telecoms, powers, network, infra] = await Promise.all([
      fetchTelecomOutages(),
      fetchPowerOutages(),
      fetchNetworkOutages(),
      fetchInfraNetwork(),
    ]);
    this.currentTelecomOutages = telecoms;
    this.currentPowerOutages = powers;
    this.currentNetworkState = network;
    if (infra) this.currentInfraState = infra;
    await this.mapContainer?.updateOutages(telecoms, powers);
    this.mapContainer?.updateNetworkOutages(network);
    if (infra) this.mapContainer?.updateInfraNetwork(infra);

    // Attendre les zones citoyennes pour que loadOutages ne se termine pas avant elles
    await citizenZonesPromise;
    if (this.outagesPanel?.isVisible()) {
      this.outagesPanel.show(this.currentPowerOutages, this.currentTelecomOutages, this.currentNetworkState, this.currentInfraState, this.currentCitizenZones ?? undefined);
    }
    this.statusPanel?.updateSource('Télécoms', { status: 'ok', lastUpdate: new Date() });
    this.statusPanel?.updateSource('IODA Internet', {
      status: network.sourcesStatus.ioda === 'ok' ? 'ok' : 'stale',
      lastUpdate: network.lastUpdate,
    });
  }

  private async loadHealth(): Promise<void> {
    this.statusPanel?.updateSource('SPF / DREES', { status: 'loading', lastUpdate: null });
    this.statusPanel?.updateSource('Sentinelles', { status: 'loading', lastUpdate: null });
    this.statusPanel?.updateSource('ANSM Médicaments', { status: 'loading', lastUpdate: null });
    const payload = await fetchHealthData();
    this.hasHealthData = payload.departments.length > 0 || payload.regions.length > 0;

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
    }, 15 * 60_000);
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

  private async loadAllLayers(): Promise<void> {
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



    // ─── ASYNC DATA — Chargement parallèle ─────────────────────────────────
    const tasks: Array<{ name: string; task: Promise<void> }> = [
      {
        name: 'ecowatt', task: this.loadEcowatt().catch(() => {
          this.currentEcowattResponse = { signals: MOCK_ECOWATT_REGIONS, mixes: {}, national: { timestamp: new Date(), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 }, interconnections: [] };
          this.mapContainer?.updateEnergy(this.currentEcowattResponse);
          this.statusPanel?.updateSource('Écowatt RTE', { status: 'error', lastUpdate: new Date() });
        })
      },
      {
        name: 'weather', task: this.loadWeather().catch(() => {
          this.currentMeteoAlerts = MOCK_METEO_ALERTS;
          this.mapContainer?.updateWeather(MOCK_METEO_ALERTS);
          this.statusPanel?.updateSource('Météo-France', { status: 'error', lastUpdate: new Date() });
        })
      },
      {
        name: 'floods', task: this.loadFloods().catch(() => {
          this.currentFloodSegments = MOCK_FLOOD_SEGMENTS;
          this.mapContainer?.updateFloods(MOCK_FLOOD_SEGMENTS);
          this.statusPanel?.updateSource('Vigicrues', { status: 'error', lastUpdate: new Date() });
        })
      },
      {
        name: 'fires', task: this.loadFires().catch(() => {
          this.mapContainer?.updateFires([]);
          this.statusPanel?.updateSource('NASA FIRMS', { status: 'error', lastUpdate: new Date() });
        })
      },
      {
        name: 'infrastructure', task: this.loadInfrastructure().catch(() => {
          this.mapContainer?.updateInfrastructure(ALL_INFRASTRUCTURE);
        })
      },
      {
        name: 'traffic', task: this.loadTraffic().catch(() => {
          this.mapContainer?.updateTrafficIncidents([]);
          this.statusPanel?.updateSource('Trafic', { status: 'error', lastUpdate: new Date() });
        })
      },
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
        name: 'sncf', task: this.loadSncf().catch(() => {
          this.currentSncfDisruptions = [];
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

    const results = await Promise.allSettled(tasks.map(t => t.task));
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`[LoadAll] ${tasks[i].name} failed:`, r.reason);
      }
    });

    // ─── ISNR — Calculé après que toutes les données sont chargées ─────────
    this.updateISNR();
  }

  private async loadSpaceWeather(): Promise<void> {
    this.statusPanel?.updateSource('NOAA SWPC', { status: 'loading', lastUpdate: null });

    // Terminator jour/nuit — calcul astronomique pur, instantané
    this.mapContainer?.updateTerminator(computeTerminatorGeoJSON());
    setInterval(() => {
      this.mapContainer?.updateTerminator(computeTerminatorGeoJSON());
    }, 60_000); // recalcule chaque minute (le terminateur se déplace ~0.25°/min)

    // Kp index NOAA
    const data = await fetchSpaceWeather();
    this.energyPanel?.updateSpaceWeather(data);
    this.statusPanel?.updateSource('NOAA SWPC', { status: 'ok', lastUpdate: data.fetchedAt });

    // Refresh Kp toutes les 15 min
    setInterval(async () => {
      const fresh = await fetchSpaceWeather().catch(() => null);
      if (fresh) this.energyPanel?.updateSpaceWeather(fresh);
    }, 15 * 60_000);
  }

  private updateISNR(): void {
    this.currentISNRData = computeISNR(
      this.newsItems,
      this.currentMeteoAlerts,
      this.currentFloodSegments,
      this.currentEcowattResponse,
      '24h', // Default time range for ISNR calculation
    );

    // Update map layer
    this.mapContainer?.updateISNR(this.currentISNRData.scores);

    // Update panel if visible
    if (this.isnrPanel?.isVisible()) {
      this.isnrPanel.show(this.currentISNRData);
    }
  }

  private onFilterChange(filter: FilterState): void {
    writeUrlState({
      timeRange: filter.timeRange,
      searchQuery: filter.searchQuery || undefined,
    });
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
