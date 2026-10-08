/**
 * DeckGLMap.ts — Carte desktop 100% MapLibre GL JS
 * Calques : News, Alerts (glow), Energy (régions Ecowatt), Weather (départements),
 *           Floods (tronçons Vigicrues), Infrastructure (centrales/barrages),
 *           Traffic (axes routiers).
 */

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { IconLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { COORDINATE_SYSTEM } from '@deck.gl/core';
import type { MapViewState, AirOverviewResponse, MaritimeSnapshot, RailOverviewResponse, RailTrain, RoadNationalResponse, RoadUrbanResponse, NewsItem, FuelTensionDashboard, InfrastructurePoint, MapLayers, MilitaryBase, AirTrafficFlight, EcowattResponse, TelecomOutage, PowerOutage, AisShipData, OilDashboard, NetworkOutageState, InfraNetworkState, SatelliteViewRequest, HydraulicBackboneAsset } from '../types/index.ts';
import type { AirQualityResponse, DroughtResponse, EarthquakesResponse, FiresResponse, FloodSection, FloodsResponse, SeaLevelsResponse, VigilanceEcheance, VigilanceResponse } from '../types/index.ts';
import { ecowattToday, ecowattLevelLabel } from '../services/ecowatt-official.ts';
import { DATA_FRESHNESS_LABELS } from '../types/index.ts';
import type { AlertLevelsResponse, AplDataset, AplProfession, EmergencySite, HospitalsDataset, SyndromicResponse } from '../types/index.ts';
import type { UrgencesSyndrome } from './layer-panel/health-format.ts';
import {
  HEALTH_HOVER_LAYERS, HEALTH_LAYER_ORDER, HOSPITAL_COLOR, HOSPITAL_RADIUS, aplProp, colorFromProp,
  departmentHealthFeatures, healthTooltipHtml, hospitalFeatures, hospitalPopupHtml, regionAlertFeatures, topHealthHit,
  urgencesProp, type HealthMapData,
} from './deckgl/health-map.ts';
import type { MetropoleConsumption } from '../services/metropoles.ts';
import type { DromEnergyAsset, DromEnergyAssetType, DromEnergyDashboard } from '../services/drom-energy/index.ts';
import { classifyMetropoles } from '../utils/metropolesElectric.ts';
import type { EventMapPoint } from '../services/v2-map.ts';
import { fetchTrafficFlowSegment } from '../services/traffic-road.ts';
import {
  AIR_TWEEN_MIN_ZOOM, TRAFFIC_COLOR, TRAFFIC_HOVER_LAYERS, TRAFFIC_JAM_LAYERS, TRAFFIC_LAYERS, TRAFFIC_LAYER_KEYS, TRAFFIC_SOURCE_IDS,
  TRAFFIC_STROKE_DIM_LAYERS, shouldTweenAirPositions,
  airEmergencyFeatures, airFlightTooltipHtml, airportFeatures, anchorageFeatures, jamPopupHtml, maritimeSignalFeatures, railOverviewLate,
  railStationFeatures, roadEventFeatures, topTrafficHit, trafficSourceSpec, trafficTooltipHtml, traficolorFeatures, trainRouteFeatures,
  urbanJamFeatures,
} from './deckgl/traffic-map.ts';
import {
  ENV_HOVER_LAYERS, ENV_ICON_GLYPH, ENV_ICON_MARGIN, ENV_ICON_NAMES, ENV_ICON_SIZE, ENV_LAYERS, ENV_LAYER_BEFORE, ENV_LAYER_KEYS, ENV_SOURCE_IDS, FOREST_DANGER_LAYERS, alphaToSdf, envIconImage, envLayerOn,
  envSourceSpec, envTooltipHtml, fireAbroadFeatures, fireDetectionFeatures, floodSectionFeatures, floodStationFeatures, forestDangerFeatures,
  radarPickFeature, topEnvHit, vigilanceDeptFeatures, vigilanceIconFeatures, airDeptFeatures, droughtDeptFeatures, quakeFeatures, tideGaugeFeatures, envBReshowPaints, placeEnvBPoints,
  type EnvBData, type EnvBLayerState,
} from './deckgl/environment-map.ts';
import {
  SOV_HOVER_LAYERS, SOV_LAYERS, SOV_LAYER_KEYS, SOV_OPTION_LAYERS, SOV_SOURCE_IDS, abroadAircraftFeatures, aircraftFeatures, cableAlertFeatures,
  cableFeatures, defenseSiteFeatures, landingFeatures, militaryEmergencyFeatures, navyFeatures, osmWorksFeatures, sovCableColor, sovSourceSpec,
  sovTooltipHtml, topSovHit,
} from './deckgl/sovereignty-map.ts';
import { SOV_B_LAYERS, SOV_B_SOURCE_IDS, droneZoneFeatures, gnssCellFeatures, sovBSourceSpec } from './deckgl/sovereignty-map-b.ts';
import {
  OUT_HOVER_LAYERS, OUT_LAYERS, OUT_LAYER_KEYS, OUT_MAINTENANCE_LAYER, OUT_SOURCE_IDS, outSourceSpec, outTooltipHtml, powerFeatures, telecomFeatures, topOutHit,
} from './deckgl/outages-map.ts';
import {
  SRC_OUT_POWER, SRC_OUT_TELECOM, SRC_SOV_AIRCRAFT, SRC_SOV_AIRCRAFT_ABROAD, SRC_SOV_CABLE_VESSELS, SRC_SOV_DRONES, SRC_SOV_EMERGENCIES, SRC_SOV_GNSS, SRC_SOV_NAVY,
  SRC_SOV_OSM_WORKS,
} from './deckgl/constants.ts';
import { NAVY_HEX, SOV_ABROAD_HEX } from './layer-panel/sovereignty-legend.ts';
import type { CablesWatchResponse, DefenseOsmWorksFile, DroneZonesFile, GnssResponse, MilitaryResponse, PowerOutagesResponse, SubseaCablesFile, TelecomOutagesResponse } from '../types/index.ts';
import {
  VESSEL_TYPE_HEX, type VesselCategory, airAltitudeHex, vesselCategory, vesselHex, vesselTypeLabel,
} from './layer-panel/traffic-legend.ts';
import { identifyFrenchCallsign, identifyAlliedCallsign } from '../config/military.ts';
import { getAllLiveTraffic, type MilitaryShip } from '../services/military-ships.ts';
import { findShipByKey, isSubmarine } from './layer-panel/navy.ts';
import { OIL_PIPELINE_COLORS } from '../config/oil-infrastructure.ts';
import type { RTEIIPIncident } from '../services/rte-iip.ts';
import { resolveFlowDirection, resolveGasFlowDirection } from '../utils/flow-direction.ts';
import { formatUpdateTime } from '../utils/format-date.ts';
import { buildSparklineSVG } from '../utils/sparkline.ts';
import type { LineString, MultiLineString } from 'geojson';
import { computeFloodSegmentBbox, buildEoBrowserUrl } from '../services/copernicus.ts';
import type { EolienLive, EolienParkSummary } from '../services/eolien/types.ts';
import { buildEolienLayerFeatureCollection, buildEolienPopupHtml } from '../services/eolien/mapbox-eolien-layer.ts';
import { getFuelTensionLevelColor } from '../services/fuel-tension.ts';
import { buildDatacenterPopupHtml } from '../utils/infra-network-popup.js';
import { buildDefaultGibsViirsTileUrl, resolveLatestGibsViirsTileUrl } from '../utils/gibs-imagery.ts';
import { fetchMtgFrpMetadata, getMtgFrpTileTemplate } from '../services/mtg-frp.ts';
import type { Radar2dManifest } from '../services/radar-2d.ts';
import { loadDepartementsGeojson } from '../services/departements-geojson.ts';


// ─── Extracted deckgl modules (constants & pure helpers) ───
import { resolveAssetCoords, resolveIIPCoords } from './deckgl/iip-geocoding.ts';
import { LYR_SATELLITE, getFrenchStyle } from './deckgl/base-style.ts';
import { ELECTRIC_FLOW_STYLE, getElectricFlowConfig, GAS_FLOW_STYLE, OIL_FLOW_STYLE } from './deckgl/flow-styles.ts';
export { ELECTRIC_FLOW_STYLE, setElectricFlowConfig, getElectricFlowConfig, GAS_FLOW_STYLE, OIL_FLOW_STYLE } from './deckgl/flow-styles.ts';
import { emptyFC, generateArc, computeBearingDegrees } from './deckgl/geometry-utils.ts';
import {
  escapeHtml,
  scoreToISNRColor,
  scoreToISNRLineColor,
  deptCodeToId,
  clamp,
  MTG_FRP_LAYER_ID,
  MTG_FRP_SOURCE_ID,
  RADAR_2D_LAYER_ID,
  RADAR_2D_SOURCE_ID,
  ECHO_TOPS_LAYER_ID,
  ECHO_TOPS_SOURCE_ID,
} from './deckgl/format-utils.ts';
import { fmIcon, fmStatusDot, type FmDotLevel, type IconName } from './shared/icons.ts';
import {
  dromEnergyAssetFromProperties,
  renderDromEnergyTooltipHtml,
} from './deckgl/popup-templates.ts';
import {
  SRC,
  SRC_CRITICAL,
  SRC_SEL,
  SRC_POWER_REGIONS,
  SRC_INTERCONN,
  SRC_WEATHER,
  SRC_HEALTH_REGIONS,
  SRC_HEALTH_DEPTS,
  SRC_FLOODS,
  SRC_FLOODS_HIGHLIGHT,
  SRC_FIRES,
  SRC_INFRA,
  SRC_INFRA_HIGHLIGHT,
  SRC_DROM_ENERGY,
  SRC_DROM_ENERGY_HTA_LINES,
  SRC_DROM_ENERGY_HIGHLIGHT,
  SRC_HYDRO_BACKBONE,
  SRC_WIND_TURBINES,
  SRC_WIND_PARKS,
  SRC_TRAFFIC,
  SRC_TRAIN_ROUTE,
  LYR_GLOW,
  LYR_POINTS,
  LYR_CLUSTER_CIRCLE,
  LYR_CLUSTER_COUNT,
  LYR_SEL_GLOW,
  LYR_SEL_RING,
  LYR_POWER_REGION_FILL,
  LYR_POWER_REGION_LINE,
  LYR_INTERCONN_LINE,
  LYR_INTERCONN_LABEL,
  SRC_INTERCONN_ARCS,
  SRC_INTERCONN_CHEVRON_PTS,
  LYR_INTERCONN_ARC,
  LYR_INTERCONN_ARC_GLOW,
  LYR_INTERCONN_HITAREA,
  LYR_INTERCONN_CHEVRONS,
  LYR_WEATHER_FILL,
  LYR_WEATHER_LINE,
  LYR_WEATHER_LINE_YELLOW,
  LYR_WEATHER_LINE_ORANGE,
  LYR_WEATHER_LINE_RED,
  SRC_WEATHER_ICONS,
  LYR_WEATHER_ICONS,
  LYR_FOREST_DANGER_FILL,
  LYR_HEALTH_ALERT_FILL,
  LYR_HEALTH_ALERT_LINE,
  LYR_HEALTH_URG_FILL,
  LYR_HEALTH_URG_LINE,
  LYR_HEALTH_APL_FILL,
  LYR_HEALTH_APL_LINE,
  SRC_ISNR,
  LYR_ISNR_FILL,
  LYR_ISNR_LINE,
  LYR_FLOODS,
  LYR_FLOODS_HIGHLIGHT,
  LYR_FIRES_GLOW,
  LYR_FIRES_POINTS,
  SRC_FIRES_HIGHLIGHT,
  LYR_FIRES_HIGHLIGHT,
  SRC_FIRES_ABROAD,
  SRC_FLOOD_STATIONS,
  SRC_DROUGHT,
  SRC_AIR_QUALITY,
  SRC_QUAKES,
  SRC_TIDE_GAUGES,
  LYR_DROUGHT_FILL,
  LYR_AIR_FILL,
  SRC_RADAR_PICK,
  SRC_FOREST_DANGER,
  SRC_MODIS,
  LYR_MODIS,
  SRC_SENTINEL_SCENE,
  LYR_SENTINEL_SCENE,
  LYR_ENERGY_INFRA_VITAL_HALO,
  LYR_ENERGY_INFRA_NUCLEAR_RING,
  LYR_ENERGY_INFRA_HIGHLIGHT_GLOW,
  LYR_ENERGY_INFRA_HIGHLIGHT_RING,
  LYR_ENERGY_INFRA_CIRCLE,
  LYR_ENERGY_INFRA_LABEL,
  LYR_DROM_ENERGY_HTA_LINES,
  LYR_DROM_ENERGY_HIGHLIGHT,
  LYR_DROM_ENERGY_POINTS,
  LYR_HYDRO_BACKBONE_HALO,
  LYR_HYDRO_BACKBONE_SIGNAL_RING,
  LYR_HYDRO_BACKBONE_CIRCLE,
  LYR_HYDRO_BACKBONE_LABEL,
  LYR_WIND_CLUSTER,
  LYR_WIND_CLUSTER_COUNT,
  LYR_WIND_TURBINE_HALO,
  LYR_WIND_TURBINE_CIRCLE,
  LYR_WIND_TURBINE_LABEL,
  LYR_WIND_PARK_HALO,
  LYR_WIND_PARK_CIRCLE,
  LYR_WIND_PARK_LABEL,
  SRC_GAS_NETWORK_GRT,
  SRC_GAS_NETWORK_TEREGA,
  LYR_GAS_NETWORK_GRT,
  LYR_GAS_NETWORK_TEREGA,
  SRC_GAS_VITALS,
  SRC_GAS_PIR_ARCS,
  SRC_GAS_PIR_MARKERS,
  LYR_GAS_TERMINALS,
  LYR_GAS_STORAGES_GLOW,
  LYR_GAS_STORAGES,
  LYR_GAS_STORAGES_LABEL,
  LYR_GAS_PIR_ARC_GLOW,
  LYR_GAS_PIR_ARC,
  SRC_GAS_PIR_CHEVRON_PTS,
  LYR_GAS_PIR_CHEVRONS,
  LYR_GAS_PIR_MARKER,
  LYR_GAS_PIR_LABEL,
  SRC_BIOMETHANE_SITES,
  LYR_BIOMETHANE_CLUSTERS,
  LYR_BIOMETHANE_CLUSTER_COUNT,
  LYR_BIOMETHANE_SITES,
  LYR_BIOMETHANE_SITES_LABEL,
  SRC_OIL_FLOW_ARCS,
  SRC_OIL_FLOW_MARKERS,
  SRC_OIL_FLOW_DIRECTION,
  SRC_OIL_FLOW_CHEVRON_PTS,
  SRC_FUEL_TENSION,
  LYR_OIL_FLOW_ARC_GLOW,
  LYR_OIL_FLOW_ARC,
  LYR_OIL_FLOW_CHEVRONS,
  LYR_OIL_FLOW_MARKER,
  LYR_OIL_FLOW_LABEL,
  LYR_FUEL_TENSION_FILL,
  LYR_FUEL_TENSION_LINE,
  SRC_OIL_PIPELINES,
  SRC_OIL_REFINERIES,
  SRC_OIL_DEPOTS,
  LYR_OIL_PIPELINES_GLOW,
  LYR_OIL_PIPELINES,
  LYR_OIL_REFINERIES_GLOW,
  LYR_OIL_REFINERIES,
  LYR_OIL_REFINERIES_LABEL,
  LYR_OIL_DEPOTS,
  LYR_OIL_DEPOTS_TERMINAL_CENTER,
  LYR_OIL_DEPOTS_LABEL,
  LYR_OIL_REFINERIES_HIT,
  LYR_OIL_DEPOTS_HIT,
  LYR_OIL_PIPELINES_HIT,
  LYR_OIL_FLOW_ARC_HIT,
  LYR_OIL_FLOW_MARKER_HIT,
  LYR_TRAFFIC,
  LYR_TRAIN_ROUTE,
  LYR_TRAIN_STATIONS,
  LYR_TRAIN_STATION_LABELS,
  SRC_METRO_LOAD,
  LYR_METRO_LOAD_GLOW,
  LYR_METRO_LOAD_CIRCLE,
  LYR_METRO_LOAD_LABEL,
  SRC_MILITARY_BASES,
  SRC_MILITARY_SHIPS_HIGHLIGHT,
  SRC_MILITARY_SHIPS_SELECTED,
  SRC_GLOBAL_TRAFFIC,
  SRC_SUBMARINE_CABLES,
  SRC_SUBMARINE_CABLES_LANDINGS,
  SRC_TELECOM,
  SRC_POWER,
  SRC_HOSPITALS,
  LYR_MILITARY_BASES_CIRCLE,
  LYR_MILITARY_BASES_LABEL,
  LYR_MILITARY_SHIPS_HIGHLIGHT,
  LYR_MILITARY_SHIPS_SELECTED,
  LYR_SUBMARINE_CABLES,
  LYR_SUBMARINE_CABLES_GLOW,
  LYR_SUBMARINE_CABLES_CORE,
  LYR_SUBMARINE_CABLES_HITAREA,
  LYR_SUBMARINE_CABLES_LANDING,
  LYR_TELECOM_PTS,
  LYR_POWER_FILL,
  LYR_POWER_LINE,
  SRC_CITIZEN_ZONES,
  LYR_CITIZEN_FILL,
  LYR_CITIZEN_LINE,
  SRC_IIP,
  LYR_IIP_GLOW,
  LYR_IIP_CORE,
  SRC_NET_ISP,
  SRC_NET_IODA,
  LYR_NET_ISP_GLOW,
  LYR_NET_ISP_RING,
  LYR_NET_ISP,
  LYR_NET_ISP_CLUSTER,
  LYR_NET_ISP_CLUSTER_COUNT,
  LYR_NET_IODA_GLOW,
  LYR_NET_IODA_CORE,
  LYR_NET_IODA_CLUSTER,
  LYR_NET_IODA_CLUSTER_COUNT,
  SRC_DC,
  SRC_DC_HIGHLIGHT,
  SRC_IXP,
  SRC_IXP_HIGHLIGHT,
  LYR_DC_GLOW,
  LYR_DC_CORE,
  LYR_DC_HIGHLIGHT,
  LYR_DC_CLUSTER,
  LYR_DC_CLUSTER_COUNT,
  LYR_IXP_CLUSTER,
  LYR_IXP_CLUSTER_COUNT,
  LYR_IXP_CIRCLE,
  LYR_IXP_HIGHLIGHT,
  LYR_HOSPITALS,
  SRC_MAIRES_POL,
  LYR_MAIRES_POL,
  LYR_MAIRES_POL_LABEL,
  SRC_RAIL_STATIONS,
  SRC_ROAD_SECTIONS,
  SRC_ROAD_JAMS,
  SRC_ROAD_EVENTS,
  SRC_AIRPORTS,
  SRC_AIR_EMERGENCIES,
  SRC_ANCHORAGES,
  SRC_AIS_SIGNALS,
  REGION_BALANCE_COLORS,
  REGION_BALANCE_LINE_COLORS,
  regionEnergyBalance,
  WEATHER_HIGHLIGHT_STATE,
  AIS_DESTINATION_ALIASES,
  AIS_PORT_LOCODES,
  INFRA_COLORS,
  INFRA_VITAL_HALO_COLOR,
  INFRA_NUCLEAR_RING_COLOR,
  HYDRAULIC_COLORS,
  HYDRAULIC_TREND_COLORS,
  DEFAULT_VIEW,
  FRANCE_CENTER,
} from './deckgl/constants.ts';

// ─── Satellite basemap toggle control ───
class SatelliteBasemapControl {
  private _container: HTMLElement | null = null;
  private _mapBtn: HTMLButtonElement | null = null;
  private _satBtn: HTMLButtonElement | null = null;
  private _map: DeckGLMap;

  constructor(map: DeckGLMap) { this._map = map; }

  private _syncState(): void {
    const sat = this._map.getSatelliteMode();
    this._mapBtn?.classList.toggle('active', !sat);
    this._satBtn?.classList.toggle('active', sat);
    if (this._mapBtn) this._mapBtn.setAttribute('aria-pressed', String(!sat));
    if (this._satBtn) this._satBtn.setAttribute('aria-pressed', String(sat));
  }

  onAdd(_maplibre: maplibregl.Map): HTMLElement {
    this._container = document.createElement('div');
    this._container.className = 'maplibregl-ctrl satellite-basemap-ctrl';
    this._container.setAttribute('role', 'group');
    this._container.setAttribute('aria-label', 'Fond de carte');

    this._mapBtn = document.createElement('button');
    this._mapBtn.type = 'button';
    this._mapBtn.className = 'satellite-basemap-btn satellite-basemap-btn--map';
    this._mapBtn.title = 'Afficher la carte standard';
    this._mapBtn.innerHTML = '<span class="satellite-basemap-btn__label">Carte</span>';
    this._mapBtn.addEventListener('click', () => {
      this._map.setBasemapSatellite(false);
      this._syncState();
    });

    this._satBtn = document.createElement('button');
    this._satBtn.type = 'button';
    this._satBtn.className = 'satellite-basemap-btn satellite-basemap-btn--sat';
    this._satBtn.title = 'Afficher le fond satellite';
    this._satBtn.innerHTML = '<span class="satellite-basemap-btn__label">Satellite</span>';
    this._satBtn.addEventListener('click', () => {
      this._map.setBasemapSatellite(true);
      this._syncState();
    });

    this._container.appendChild(this._mapBtn);
    this._container.appendChild(this._satBtn);
    this._syncState();
    return this._container;
  }

  onRemove(): void {
    this._container?.remove();
    this._container = null;
    this._mapBtn = null;
    this._satBtn = null;
  }
}

// Point d'infrastructure enrichi des champs de production électrique (nucléaire RTE, etc.),
// optionnels car absents des points génériques (gaz, dépôts…).
type InfrastructureRenderPoint = InfrastructurePoint & {
  globalAvailability?: number;
  totalPower?: number;
  totalAvailable?: number;
};

export class DeckGLMap {
  private container: HTMLElement;
  private map: maplibregl.Map | null = null;
  private viewState: MapViewState = { ...DEFAULT_VIEW };
  private newsItems: NewsItem[] = [];
  private itemsById: Map<string, NewsItem> = new Map();
  private hoveredId: number | null = null;
  private onItemClick: ((item: NewsItem) => void) | null = null;
  private onRawMapClick: ((lat: number, lon: number) => void) | null = null;
  private onItemHover:
    | ((item: NewsItem | null, x: number, y: number) => void)
    | null = null;
  private onClusterHover:
    | ((items: NewsItem[], x: number, y: number, clusterCount: number) => void)
    | null = null;
  private onClusterClick:
    | ((items: NewsItem[], center: [number, number]) => void)
    | null = null;
  private onViewChange: ((vs: MapViewState) => void) | null = null;
  private onMilitaryBaseClick: ((base: MilitaryBase, x: number, y: number) => void) | null = null;
  private onSatelliteView: ((request: SatelliteViewRequest) => void) | null = null;
  private _highlightedMmsi: string | null = null;
  private _selectedShipMmsi: string | null = null;
  private _satelliteMode = false;
  private _basemapLayerVisibility: Map<string, 'visible' | 'none'> = new Map();
  private _sentinelBlinkInterval: ReturnType<typeof setInterval> | null = null;
  // In-memory lookup tables for military data (populated by updateMilitary*)
  private airTrafficFlightsById: Map<string, AirTrafficFlight> = new Map();
  private militaryBasesById: Map<string, MilitaryBase> = new Map();
  private militaryShipsById: Map<string, { id: string; name: string; type: string; role: string; mmsi?: string; lat: number; lon: number; speed?: number; heading?: number; port?: string; isLive?: boolean }> = new Map();
  private aisIconDefs: Record<string, { url: string; width: number; height: number; anchorX: number; anchorY: number; mask: boolean }> = {};
  // Lightweight hover tooltip (uses maplibregl.Popup)
  private militaryTooltip: maplibregl.Popup | null = null;
  private aisHoverTooltip: maplibregl.Popup | null = null;
  private healthHoverPopup: maplibregl.Popup | null = null;
  /** Trafics (spec 2026-10-03 trafics § 3) : survol, fiche d'un bouchon, icônes d'avions selon le zoom, retard SNCF du trajet tracé. */
  private trafficHoverPopup: maplibregl.Popup | null = null;
  // Environnement (spec 2026-10-04 environnement § 2) : dernières données reçues (rejeu au réaffichage, surbrillances), options, survol.
  private envVigilance: { v: VigilanceResponse | null; echeance: VigilanceEcheance; now: number } | null = null;
  private envVigilancePending = false;
  private envFloodSections: Map<string, FloodSection> = new Map();
  private envFires: FiresResponse | null = null;
  private envFiresNow = 0;
  private envFloods: FloodsResponse | null = null;
  /** Dernières réponses de la phase B, gardées couche masquée pour le repeint à l'heure courante (S2). */
  private envB: EnvBData = { drought: null, air: null, quakes: null, seaLevels: null, vigilance: null };
  private _forestDangerFill = false;
  private _echoTopsEnabled = false;
  private radarPick: { lat: number; lon: number } | null = null;
  private onRadarPointPick: ((lat: number, lon: number) => void) | null = null;
  private envHoverPopup: maplibregl.Popup | null = null;
  private envHoverShown = false;
  // Souveraineté (spec 2026-10-04 souveraineté § 2 ; contrats § 5) : infobulle, option des ouvrages OSM, clic transmis à App.ts, dernières
  // données (rejeu à l'heure courante au réaffichage, S2), câbles OSM et Shom (cadrage d'un câble choisi).
  private sovHoverPopup: maplibregl.Popup | null = null;
  private sovHoverShown = false;
  private osmWorksVisible = false;
  private droneZonesVisible = false;
  // Pannes réseau (spec 2026-10-08) : infobulle au survol, option des maintenances télécoms (éteinte par défaut).
  private outHoverPopup: maplibregl.Popup | null = null;
  private outHoverShown = false;
  private telecomMaintenanceOn = false;
  private onSovereigntyFeatureClick: ((layerId: string, props: Record<string, unknown>) => void) | null = null;
  private sovCables: SubseaCablesFile | null = null;
  private sovCableWatch: CablesWatchResponse | null = null;
  private sovMilitary: MilitaryResponse | null = null;
  private sovNavy: { ships: readonly MilitaryShip[]; frozen: boolean } | null = null;
  private trafficHoverShown = false;
  private trafficPointer = false;
  private trafficJamPopup: maplibregl.Popup | null = null;
  private railTrafficLate = false;
  /** Trajet tracé : train choisi dans le panneau ; un train survolé le remplace le temps du survol. */
  private chosenTrain: RailTrain | null = null;
  private previewTrain: RailTrain | null = null;
  private dromEnergyHoverPopup: maplibregl.Popup | null = null;
  private fuelTensionHoverPopup: maplibregl.Popup | null = null;
  private _modisOverlayEnabled = false;
  private _modisTilesProbe: Promise<void> | null = null;
  private _mtgFrpEnabled = false;
  private mtgFrpObservedAt: string | null = null;
  private _radar2dEnabled = false;
  private _echoTopsUrl: string | null = null;
  private radar2dManifest: Radar2dManifest | null = null;
  private radar2dObjectUrl: string | null = null;
  private radar2dOperationGeneration = 0;
  private radar2dDestroyed = false;
  private _latestEolienLive: EolienLive | null = null;
  private _mairesPolitiqueData: Array<{c:string;lat:number;lon:number;n:string;nom:string}> | null = null;
  private enrichedHoverPopup: maplibregl.Popup | null = null;
  private _lastHoveredFuelDeptId: string | null = null;
  private _previewedWeatherDeptId: number | null = null;
  private _selectedWeatherDeptId: number | null = null;
  // Perf audit §5 item 4 / §6 item 7: kicked off in init() right after the map
  // is created, in parallel with map style/tile loading, instead of only
  // after map.on('load') fires — this fetch has no dependency on the map.
  private iconMappingPromise: Promise<Record<string, { x: number; y: number; width: number; height: number }>> | null = null;
  // Perf audit §6 item 8: gas network sources start empty and are only
  // fetched the first time the gas layer is switched on.
  private gasNetworkSourcesPromise: Promise<void> | null = null;
  // Perf audit §6 item 2: departements.geojson (3.3 MB) is memoized inside
  // getDepartmentsGeojson(), but updateISNR/updateOutages used to trigger it
  // unconditionally regardless of layer visibility. These two fields (the health layers use healthRegionsDirty/healthDeptsDirty,
  // the vigilance envVigilancePending) hold the most recent args passed while the
  // corresponding layer was inactive, so setLayerVisibility() can replay the
  // same call (cheap: memoized fetch, or first real one) once it's switched on.
  private _pendingIsnrScores: import('../types/index.ts').ISNRScore[] | null = null;
  private _pendingOutagesArgs: { telecoms: TelecomOutage[]; powers: PowerOutage[] } | null = null;
  // Couches santé (spec 2026-10-03 § 3) : dernières données reçues, syndrome et profession choisis dans les panneaux.
  private healthAlerts: AlertLevelsResponse | null = null;
  /** Instant de la dernière relève : règle « en saison » des alertes et retard des urgences (S2). */
  private healthNow = 0;
  private healthSyndromic: SyndromicResponse | null = null;
  private healthApl: AplDataset | null = null;
  private hospitalSites: ReadonlyMap<string, EmergencySite> = new Map();
  private hospitalsVintage: number | null = null;
  private healthUrgencesSyndrome: UrgencesSyndrome = 'ira';
  private healthAplProfession: AplProfession = 'mg';
  // Perf : regions.geojson et departements.geojson ne sont lus qu'avec la couche visible ; setLayerVisibility rejoue.
  private healthRegionsDirty = false;
  private healthDeptsDirty = false;
  private regionsGeojsonPromise: Promise<GeoJSON.FeatureCollection | null> | null = null;
  private hospitalPopup: maplibregl.Popup | null = null;
  /** N° FINESS du site dont la fiche est ouverte : pas d'infobulle de survol par-dessus. */
  private hospitalPopupFiness: string | null = null;
  // Infobulle de survol santé affichée, curseur main posé par les couches santé (et par elles seules).
  private healthHoverShown = false;
  private healthPointer = false;

  // Cluster hover state
  private hoveredClusterId: number | null = null;
  private lastClusterItems: NewsItem[] = [];
  
  private lastClusterCount: number = 0;
  private clusterHideTimeout: ReturnType<typeof setTimeout> | null = null;
  // Batching of deckOverlay.setProps + triggerRepaint via requestAnimationFrame
  private pendingOverlayUpdate = false;
  // Throttle for cluster hover leaves fetching (~100ms)
  private clusterLeavesHoverTimeout: ReturnType<typeof setTimeout> | null = null;
  // Hash of the last news items pushed to the news sources — skips redundant setData
  private lastNewsSourceHash: string | null = null;

  // Pulse overlay for critical/high alerts
  private pulseOverlay: HTMLElement | null = null;
  private pulseMarkers: Map<string, HTMLElement> = new Map();

  // NOTE: Dynamic dasharray animations disabled due to MapLibre LineAtlas saturation.
  // Using point-based animation for chevrons (true movement along arcs).

  // Chevron flow animation (point-based - chevrons move along arc paths)
  private chevronAnimFrame: number | null = null;
  private chevronPhase = 0;  // Animation phase (0 to 1)
  // Stored arc data for chevron animation
  private interconnArcs: Array<{
    coords: [number, number][];
    color: string;
    isImport: boolean;
    mw: number;
  }> = [];

  // Gas PIR chevron animation
  private gasChevronAnimFrame: number | null = null;
  private gasChevronPhase = 0;
  private gasPipelineVisible = false; // controlled by GasPanel toggle only, off by default
  private gasArcs: Array<{
    coords: [number, number][];
    color: string;
    flowGWhDay: number;
  }> = [];

  // Oil flow chevron animation
  private oilChevronAnimFrame: number | null = null;
  private oilChevronPhase = 0;
  private oilArcs: Array<{
    coords: [number, number][];
    color: string;
    flowKbd: number;
    lineWidth: number;
    isImport: boolean;
  }> = [];
  private oilHoveredFlowName: string | null = null;

  // Subsea cable glow pulse animation (uses opacity, not dasharray - safe)
  private subseaPulseAnimFrame: number | null = null;
  private subseaPulsePhase = 0;

  // Deck.gl overlay for AIS traffic
  private deckOverlay: MapboxOverlay | null = null;
  private globalTrafficVisible = true;  // Controlled by military layer toggle
  private globalTrafficData: AisShipData[] = [];
  /** Sillages et noms des navires mémorisés (getAisTrailData, getAisLabelData). */
  private aisTrailCache: { source: AisShipData[]; data: AisShipData[] } | null = null;
  private aisLabelCache: {
    source: AisShipData[]; highlighted: string | null; selected: string | null; all: boolean; data: AisShipData[];
  } | null = null;
  /** Événements consolidés de la v2 (spec 2026-09-29 § 5), déjà filtrés par App (v2-map.ts). */
  private eventPoints: EventMapPoint[] = [];
  private eventPointsVisible = false;
  private onEventPointClick: ((id: number) => void) | null = null;
  private airTrafficVisible = false;
  private civilAirTrafficFlights: AirTrafficFlight[] = [];  // Filtered: excludes military callsigns
  private legendHoverCategory: string | null = null;

  // ─── Civil Air Traffic Animation (tween between snapshots) ───
  private civilAirPrevPositions: Map<string, { lon: number; lat: number; heading: number }> = new Map();
  private civilAirTweenStart = 0;          // performance.now() when snapshot arrived
  private civilAirTweenDuration = 12_000;  // ms — matches AIR_TRAFFIC_POLL_MS in App.ts
  private civilAirAnimFrame: number | null = null;
  private civilAirTweenProgress = 1;       // 0..1 — starts at 1 (settled) until first tween

  // Storing original opacities for legend highlighting
  private originalOpacities: Map<string, { prop: string, orig: unknown }> = new Map();

  // ─── Energy tooltip data ───
  private energyRegionStats = new Map<string, import('../types/index.ts').RegionEnergyStats>();
  private energyFlowStats = new Map<string, import('../types/index.ts').InterconnectionFlowStats>();
  private energyBorderHistory = new Map<string, number[]>();  // sparkline series
  private energyRegionPopup: maplibregl.Popup | null = null;
  private energyFlowPopup: maplibregl.Popup | null = null;
  // Dernier signal Écowatt OFFICIEL reçu (national, RTE) — pour l'info-bulle région, qui
  // n'affiche plus de signal PAR région (Écowatt n'en a jamais eu).
  private lastEcowattOfficial: import('../types/index.ts').EcowattOfficial | null = null;

  // ─── Gas tooltip data ───
  private gasFlowStats = new Map<string, import('../types/index.ts').GasInterconnectionFlowStats>();
  private gasBorderHistory = new Map<string, number[]>(); // sparkline 7j par borderCode
  private gasFlowPopup: maplibregl.Popup | null = null;

  // Correspondance nom pays (propriété GeoJSON arc) → id InterconnectionFlowStats
  private static readonly COUNTRY_TO_FLOW_ID: Record<string, string> = {
    'Royaume-Uni': 'FR-GB',
    'Espagne': 'FR-ES',
    'Italie': 'FR-IT',
    'Suisse': 'FR-CH',
    'All./Bel.': 'FR-DE/BE',
  };

  constructor(container: HTMLElement) {
    this.container = container;
  }

  async init(): Promise<void> {
    this.container.innerHTML = '';

    // Perf audit §5 item 4 / §6 item 7: this fetch doesn't depend on the map
    // at all — start it now instead of after map.on('load') (loadIconAtlas()
    // awaits it below, alongside getFrenchStyle()/map creation).
    this.iconMappingPromise = fetch('/assets/dsfr-mapping.json')
      .then((resp) => resp.json() as Promise<Record<string, { x: number; y: number; width: number; height: number }>>);

    // Fetch style with French labels pre-applied
    const frenchStyle = await getFrenchStyle();

    this.map = new maplibregl.Map({
      container: this.container,
      style: frenchStyle,
      center: [this.viewState.longitude, this.viewState.latitude],
      zoom: this.viewState.zoom,
      minZoom: 3, // Allow zoom out for DROM navigation
      attributionControl: false,
    });
    // debug global
    (window as Window & { _franceMonitorMap?: maplibregl.Map })._franceMonitorMap = this.map;
    this.map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      'bottom-right',
    );
    this.map.addControl(
      new maplibregl.NavigationControl({ showCompass: true, showZoom: true }),
      'bottom-right',
    );
    this.map.addControl(new SatelliteBasemapControl(this), 'top-right');

    await new Promise<void>((r) => this.map!.on('load', r));
    await this.loadIconAtlas();
    this.registerEnvironmentIcons();

    // ═══════════════════════════════════════════════════════════════
    // ANTI-FLASH: Force all custom layers to start HIDDEN
    // App.ts will call setLayerVisibility() immediately after init()
    // to apply the saved state — so we never see a flash of wrong layers.
    // ═══════════════════════════════════════════════════════════════
    const _origAddLayer = this.map!.addLayer.bind(this.map!);
    const patchedAddLayer = (layer: maplibregl.AddLayerObject, beforeId?: string): maplibregl.Map => {
      // Vue structurelle de la couche pour lire l'id et forcer visibility (layout varie selon le type).
      const l = layer as { id?: string; layout?: Record<string, unknown> };
      // Force all our symbol/circle/line/fill layers except basemap labels to start hidden
      if (l.id && !l.id.startsWith('wm-basemap') && !l.id.startsWith('background') && !l.id.startsWith('country') && !l.id.startsWith('water') && !l.id.startsWith('road') && !l.id.startsWith('building') && !l.id.startsWith('landuse') && !l.id.startsWith('place') && !l.id.startsWith('boundary')) {
        l.layout = { ...(l.layout || {}), visibility: 'none' };
      }
      return _origAddLayer(layer, beforeId);
    };
    (this.map! as { addLayer: (layer: maplibregl.AddLayerObject, beforeId?: string) => maplibregl.Map }).addLayer = patchedAddLayer;


    // ═══════════════════════════════════════════════════════════════
    // SOURCES
    // ═══════════════════════════════════════════════════════════════

    // News points (with native MapLibre clustering) — excludes critical
    this.map.addSource(SRC, {
      type: 'geojson',
      data: emptyFC(),
      cluster: true,
      clusterMaxZoom: 12,
      clusterRadius: 50,
      generateId: true, // Auto-generate IDs for setFeatureState support
      // Propagate max threat level to clusters for smart coloring
      clusterProperties: {
        maxThreat: ['max', ['case',
          ['==', ['get', 'level'], 'high'], 3,
          ['==', ['get', 'level'], 'medium'], 2,
          ['==', ['get', 'level'], 'low'], 1,
          0  // info
        ]],
      },
    });

    // Critical alerts (never clustered — always visible)
    this.map.addSource(SRC_CRITICAL, {
      type: 'geojson',
      data: emptyFC(),
      cluster: false,
      generateId: true,
    });

    this.map.addSource(SRC_SEL, { type: 'geojson', data: emptyFC() });

    // Energy regions
    this.map.addSource(SRC_POWER_REGIONS, { type: 'geojson', data: emptyFC() });

    // Interconnections (point markers + arc lines + animated chevron points)
    this.map.addSource(SRC_INTERCONN, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_INTERCONN_ARCS, { type: 'geojson', data: emptyFC(), lineMetrics: true });
    this.map.addSource(SRC_INTERCONN_CHEVRON_PTS, { type: 'geojson', data: emptyFC() });

    // Weather departments
    this.map.addSource(SRC_WEATHER, {
      type: 'geojson',
      data: emptyFC(),
      promoteId: 'code' // Tells MapLibre to use feature.properties.code as feature.id for state
    });

    // Weather risk icons (centroids)
    this.map.addSource(SRC_WEATHER_ICONS, {
      type: 'geojson',
      data: emptyFC(),
    });

    // Santé (spec 2026-10-03 § 3) : régions (alertes Odissé), départements (urgences et APL).
    this.map.addSource(SRC_HEALTH_REGIONS, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_HEALTH_DEPTS, { type: 'geojson', data: emptyFC() });

    // ISNR stability departments
    this.map.addSource(SRC_ISNR, {
      type: 'geojson',
      data: emptyFC(),
      promoteId: 'code'
    });


    // Flood segments
    this.map.addSource(SRC_FLOODS, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_FLOODS_HIGHLIGHT, { type: 'geojson', data: emptyFC() });

    // NASA FIRMS Fires
    this.map.addSource(SRC_FIRES, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_FIRES_HIGHLIGHT, { type: 'geojson', data: emptyFC() });
    // Environnement (spec 2026-10-04 § 2) : météo des forêts, détections hors de France, stations des tronçons, point du profil radar.
    for (const id of ENV_SOURCE_IDS) this.map.addSource(id, envSourceSpec());

    // NASA GIBS — dernière image VIIRS publiée (fumée / cicatrices)
    this.map.addSource(SRC_MODIS, {
      type: 'raster',
      tiles: [buildDefaultGibsViirsTileUrl()],
      tileSize: 256,
      bounds: [-5.5, 41.0, 10.0, 51.5],
      attribution: 'NASA GIBS · VIIRS SNPP Corrected Reflectance'
    });

    this.map.addSource(SRC_SENTINEL_SCENE, {
      type: 'image',
      url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
      coordinates: [
        [-5.5, 51.5],
        [10.0, 51.5],
        [10.0, 41.0],
        [-5.5, 41.0],
      ],
    });


    // Infrastructure
    this.map.addSource(SRC_INFRA, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_INFRA_HIGHLIGHT, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_DROM_ENERGY, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_DROM_ENERGY_HTA_LINES, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_DROM_ENERGY_HIGHLIGHT, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_HYDRO_BACKBONE, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_WIND_TURBINES, {
      type: 'geojson',
      data: emptyFC(),
      cluster: true,
      clusterMaxZoom: 7,   // éclate au zoom 8+
      clusterRadius: 40,
    });
    this.map.addSource(SRC_WIND_PARKS, {
      type: 'geojson',
      data: emptyFC(),
      cluster: false,
    });

    // Réseau de Transport Gaz Pression (GRTgaz, Teréga)
    // Perf audit §5 item 6 / §6 item 8: these used to carry a live
    // odre.opendatasoft.com URL as `data`, which MapLibre fetches immediately
    // on addSource — regardless of whether the gas layer is visible (off by
    // default). Start empty like the other ~30 sources; ensureGasNetworkSources()
    // sets the real URL the first time gasNetwork is switched on.
    this.map.addSource(SRC_GAS_NETWORK_GRT, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_GAS_NETWORK_TEREGA, { type: 'geojson', data: emptyFC() });

    // Gas Vital Organs (terminals, storage, PIR flows)
    this.map.addSource(SRC_GAS_VITALS, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_GAS_PIR_ARCS, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_GAS_PIR_MARKERS, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_GAS_PIR_CHEVRON_PTS, { type: 'geojson', data: emptyFC() });

    // Oil/Petroleum flows (refineries, pipelines, imports)
    this.map.addSource(SRC_OIL_FLOW_ARCS, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_OIL_FLOW_MARKERS, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_OIL_FLOW_DIRECTION, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_OIL_FLOW_CHEVRON_PTS, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_FUEL_TENSION, {
      type: 'geojson',
      data: emptyFC(),
      promoteId: 'code',
    });
    // Oil infrastructure (pipelines, refineries, depots)
    this.map.addSource(SRC_OIL_PIPELINES, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_OIL_REFINERIES, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_OIL_DEPOTS, { type: 'geojson', data: emptyFC() });

    // Traffic (TomTom) — France only.
    // Les tuiles passent par le proxy serveur /api/traffic/tile : la clé TomTom reste
    // côté serveur. Si le serveur n'a pas de clé, les tuiles échouent silencieusement
    // (MapLibre gère). La couche reste masquée par défaut (contrôlée par setVis).
    this.map.addSource(SRC_TRAFFIC, {
      type: 'raster',
      tiles: ['/api/traffic/tile?z={z}&x={x}&y={y}'],
      tileSize: 256,
      bounds: [-5.2, 41.3, 9.6, 51.1] // Tighter bounding box for France métropolitaine
    });

    // Trafics (spec 2026-10-03 trafics § 3) : sections, bouchons, événements, aéroports, urgences, gares, mouillages, signalements.
    for (const id of TRAFFIC_SOURCE_IDS) this.map.addSource(id, trafficSourceSpec());

    // Train route highlight
    this.map.addSource(SRC_TRAIN_ROUTE, { type: 'geojson', data: emptyFC() });

    // Métropoles consumption
    this.map.addSource(SRC_METRO_LOAD, { type: 'geojson', data: emptyFC() });

    // Outages (Telecom endpoints & Power regions)
    this.map.addSource(SRC_TELECOM, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_POWER, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_CITIZEN_ZONES, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_IIP, { type: 'geojson', data: emptyFC() });
    // Internet/BGP outages (IODA + ISP BGP) — clustering activé pour éviter le chevauchement à faible zoom
    this.map.addSource(SRC_NET_ISP, {
      type: 'geojson', data: emptyFC(),
      cluster: true, clusterRadius: 55, clusterMaxZoom: 8,
    });
    this.map.addSource(SRC_NET_IODA, {
      type: 'geojson', data: emptyFC(),
      cluster: true, clusterRadius: 60, clusterMaxZoom: 7,
    });
    // Infra cloud & IXP — clustering activé pour éviter le chevauchement à faible zoom
    this.map.addSource(SRC_DC, {
      type: 'geojson', data: emptyFC(),
      cluster: true, clusterRadius: 50, clusterMaxZoom: 8,
    });
    this.map.addSource(SRC_DC_HIGHLIGHT, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_IXP, {
      type: 'geojson', data: emptyFC(),
      cluster: true, clusterRadius: 50, clusterMaxZoom: 8,
    });
    this.map.addSource(SRC_IXP_HIGHLIGHT, { type: 'geojson', data: emptyFC() });

    // Military
    // Souveraineté, phase B (tâche B27) : mailles GNSS et zones drones DGAC, à la place des rectangles « ZIT ».
    for (const id of SOV_B_SOURCE_IDS) this.map.addSource(id, sovBSourceSpec());
    this.map.addSource(SRC_MILITARY_BASES, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_MILITARY_SHIPS_HIGHLIGHT, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_MILITARY_SHIPS_SELECTED, { type: 'geojson', data: emptyFC() });
    // Souveraineté (spec 2026-10-04 souveraineté § 2) : aéronefs, urgences, Marine nationale, ouvrages OSM, navires près d'un câble.
    for (const id of SOV_SOURCE_IDS) this.map.addSource(id, sovSourceSpec());
    // Pannes réseau (spec 2026-10-08) : sites ARCEP et unités de production en panne.
    for (const id of OUT_SOURCE_IDS) this.map.addSource(id, outSourceSpec());
    this.map.addSource(SRC_GLOBAL_TRAFFIC, { type: 'geojson', data: emptyFC() });

    // Câbles (Connectivité) : vides jusqu'à updateCablesLayer (fichier du Shom et d'OpenStreetMap), l'ancien fichier dessiné à la main n'est plus lu.
    this.map.addSource(SRC_SUBMARINE_CABLES, {
      type: 'geojson',
      data: emptyFC(),
      promoteId: 'id',
    });
    this.map.addSource(SRC_SUBMARINE_CABLES_LANDINGS, { type: 'geojson', data: emptyFC() });

    // Sites d'urgences autorisés (SAE 2025, FINESS)
    this.map.addSource(SRC_HOSPITALS, { type: 'geojson', data: emptyFC() });

    // ═══════════════════════════════════════════════════════════════
    // LAYERS (order matters — bottom to top)
    // ═══════════════════════════════════════════════════════════════


    // ─── Energy: region fill ───
    this.map.addLayer({
      id: LYR_POWER_REGION_FILL,
      type: 'fill',
      source: SRC_POWER_REGIONS,
      paint: {
        'fill-color': ['get', 'fillColor'],
        'fill-opacity': 0.7,
      },
    });
    this.map.addLayer({
      id: LYR_POWER_REGION_LINE,
      type: 'line',
      source: SRC_POWER_REGIONS,
      paint: {
        'line-color': ['get', 'lineColor'],
        'line-width': 1.5,
        'line-opacity': 0.6,
      },
    });

    // ─── Energy: interconnections (curved arcs with flow animation) ───
    // Electric flow: Blue/cyan neon with pronounced glow (plasma effect)
    // Glow layer (thick, blurred effect with separate glow color)
    this.map.addLayer({
      id: LYR_INTERCONN_ARC_GLOW,
      type: 'line',
      source: SRC_INTERCONN_ARCS,
      paint: {
        'line-color': ['coalesce', ['get', 'glowColor'], ['get', 'color']],
        'line-width': ['get', 'glowWidth'],
        'line-opacity': ELECTRIC_FLOW_STYLE.glowOpacity,
        'line-blur': ELECTRIC_FLOW_STYLE.glowBlur
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      }
    });

    // Main arc (solid line, no dash - chevrons will show direction)
    this.map.addLayer({
      id: LYR_INTERCONN_ARC,
      type: 'line',
      source: SRC_INTERCONN_ARCS,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['get', 'lineWidth'],
        'line-opacity': ELECTRIC_FLOW_STYLE.lineOpacity
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      }
    });

    // Create chevron icon for flow direction (must await before adding layer)
    await this.createChevronIcon();
    await this.createRefineryTriangleIcon();
    await this.createDcTriangleIcon();
    await this.createIxpSquareIcon();

    // Chevron symbols as individual animated points along arcs
    // Points are updated each frame to create continuous movement
    this.map.addLayer({
      id: LYR_INTERCONN_CHEVRONS,
      type: 'symbol',
      source: SRC_INTERCONN_CHEVRON_PTS,
      layout: {
        'icon-image': 'chevron-electric',
        'icon-size': ['interpolate', ['linear'], ['zoom'],
          4, ['*', ['get', 'size'], 0.4],
          8, ['*', ['get', 'size'], 0.7],
          12, ['*', ['get', 'size'], 1.0]
        ],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-pitch-alignment': 'map',
        'icon-rotation-alignment': 'map',
        'icon-rotate': ['get', 'rotation']  // Pre-computed rotation per point
      },
      paint: {
        'icon-color': ['get', 'color'],
        'icon-opacity': 0.95
      }
    });

    // Wide invisible hit area — makes arc easier to hover (24px wide, transparent)
    this.map.addLayer({
      id: LYR_INTERCONN_HITAREA,
      type: 'line',
      source: SRC_INTERCONN_ARCS,
      paint: {
        'line-color': 'transparent',
        'line-width': 24,
        'line-opacity': 0,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });

    // Circle marker at border point (endpoint indicator)
    this.map.addLayer({
      id: LYR_INTERCONN_LINE,
      type: 'circle',
      source: SRC_INTERCONN,
      paint: {
        'circle-radius': ['get', 'radius'],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.9,
        'circle-stroke-opacity': 0
      }
    });

    // Label next to marker
    this.map.addLayer({
      id: LYR_INTERCONN_LABEL,
      type: 'symbol',
      source: SRC_INTERCONN,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Open Sans Semibold'],
        'text-size': 12,
        'text-anchor': 'left',
        'text-offset': [1.2, 0],
        'text-max-width': 10
      },
      paint: {
        'text-color': '#fff',
        'text-halo-color': 'rgba(0,0,0,0.85)',
        'text-halo-width': 2
      }
    });

    // ─── Vigilance : remplissage départemental (deckgl/environment-map.ts : couleur portée par chaque département) ───
    this.map.addLayer({
      id: LYR_WEATHER_FILL,
      type: 'fill',
      source: SRC_WEATHER,
      paint: {
        'fill-color': ['get', 'fillColor'],
        'fill-opacity': [
          'case',
          ['boolean', ['get', 'hasAlert'], false],
          [
            'case',
            WEATHER_HIGHLIGHT_STATE,
            0.74,
            [
              'match',
              ['get', 'level'],
              'red', 0.38,
              'orange', 0.30,
              'yellow', 0.16,
              0,
            ],
          ],
          0
        ],
      },
    });
    this.map.addLayer({
      id: LYR_WEATHER_LINE,
      type: 'line',
      source: SRC_WEATHER,
      filter: ['boolean', ['get', 'hasAlert'], false],
      paint: {
        'line-color': 'rgba(255,255,255,0.18)',
        'line-width': [
          'case',
          WEATHER_HIGHLIGHT_STATE,
          1.1,
          0.8,
        ],
        'line-opacity': 0.55,
      },
    });
    this.map.addLayer({
      id: LYR_WEATHER_LINE_YELLOW,
      type: 'line',
      source: SRC_WEATHER,
      filter: ['all', ['boolean', ['get', 'hasAlert'], false], ['==', ['get', 'level'], 'yellow']],
      paint: {
        'line-color': ['get', 'lineColor'],
        'line-width': ['case', WEATHER_HIGHLIGHT_STATE, 2.3, 1.2],
        'line-opacity': ['case', WEATHER_HIGHLIGHT_STATE, 1.0, 0.9],
      },
    });
    this.map.addLayer({
      id: LYR_WEATHER_LINE_ORANGE,
      type: 'line',
      source: SRC_WEATHER,
      filter: ['all', ['boolean', ['get', 'hasAlert'], false], ['==', ['get', 'level'], 'orange']],
      paint: {
        'line-color': ['get', 'lineColor'],
        'line-width': ['case', WEATHER_HIGHLIGHT_STATE, 3.2, 2.4],
        'line-opacity': ['case', WEATHER_HIGHLIGHT_STATE, 1.0, 0.98],
      },
    });
    this.map.addLayer({
      id: LYR_WEATHER_LINE_RED,
      type: 'line',
      source: SRC_WEATHER,
      filter: ['all', ['boolean', ['get', 'hasAlert'], false], ['==', ['get', 'level'], 'red']],
      paint: {
        'line-color': ['get', 'lineColor'],
        'line-width': ['case', WEATHER_HIGHLIGHT_STATE, 3.6, 2.8],
        'line-opacity': 1,
      },
    });


    // NOTE: Weather icons layer is added later (after all fill layers) to ensure visibility

    // ─── Santé (spec 2026-10-03 § 3) : un jeu de couches par panneau ───
    // Veille sanitaire : régions par le plus haut niveau d'alerte en saison, gris clair hors saison.
    this.map.addLayer({
      id: LYR_HEALTH_ALERT_FILL,
      type: 'fill',
      source: SRC_HEALTH_REGIONS,
      paint: { 'fill-color': colorFromProp('hmColor'), 'fill-opacity': 0.45 },
    });
    this.map.addLayer({
      id: LYR_HEALTH_ALERT_LINE,
      type: 'line',
      source: SRC_HEALTH_REGIONS,
      paint: { 'line-color': 'rgba(255, 255, 255, 0.35)', 'line-width': 1 },
    });
    // Urgences : départements par le niveau saisonnier du syndrome choisi dans le panneau.
    this.map.addLayer({
      id: LYR_HEALTH_URG_FILL,
      type: 'fill',
      source: SRC_HEALTH_DEPTS,
      paint: { 'fill-color': colorFromProp(urgencesProp(this.healthUrgencesSyndrome)), 'fill-opacity': 0.5 },
    });
    this.map.addLayer({
      id: LYR_HEALTH_URG_LINE,
      type: 'line',
      source: SRC_HEALTH_DEPTS,
      paint: { 'line-color': 'rgba(255, 255, 255, 0.25)', 'line-width': 0.6 },
    });
    // Accès aux soins : départements par l'APL de la profession choisie dans le panneau.
    this.map.addLayer({
      id: LYR_HEALTH_APL_FILL,
      type: 'fill',
      source: SRC_HEALTH_DEPTS,
      paint: { 'fill-color': colorFromProp(aplProp(this.healthAplProfession)), 'fill-opacity': 0.5 },
    });
    this.map.addLayer({
      id: LYR_HEALTH_APL_LINE,
      type: 'line',
      source: SRC_HEALTH_DEPTS,
      paint: { 'line-color': 'rgba(255, 255, 255, 0.25)', 'line-width': 0.6 },
    });
    // ─── ISNR: stability department fill ───
    this.map.addLayer({
      id: LYR_ISNR_FILL,
      type: 'fill',
      source: SRC_ISNR,
      paint: {
        'fill-color': ['get', 'fillColor'],
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          0.85,
          0.65
        ],
      },
    });
    this.map.addLayer({
      id: LYR_ISNR_LINE,
      type: 'line',
      source: SRC_ISNR,
      paint: {
        'line-color': ['get', 'lineColor'],
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          2.5,
          1
        ],
        'line-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          1.0,
          0.5
        ],
      },
    });

    // ─── MODIS Corrected Reflectance overlay (NASA GIBS) ───
    this.map.addLayer({
      id: LYR_MODIS,
      type: 'raster',
      source: SRC_MODIS,
      paint: {
        'raster-opacity': 0.75,
        'raster-resampling': 'linear'
      },
      layout: { visibility: 'none' }
    });

    this.map.addLayer({
      id: LYR_SENTINEL_SCENE,
      type: 'raster',
      source: SRC_SENTINEL_SCENE,
      paint: {
        'raster-opacity': 0.72,
        'raster-resampling': 'linear',
      },
      layout: { visibility: 'none' }
    });

    // ─── Fires (NASA FIRMS) ───
    this.map.addLayer({
      id: LYR_FIRES_GLOW,
      type: 'circle',
      source: SRC_FIRES,
      // Halo : foyers orange ou rouges seulement (propriété `glow`, deckgl/environment-map.ts).
      filter: ['==', ['get', 'glow'], true],
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          5, 10,
          10, 30
        ],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.3,
        'circle-blur': 0.8
      }
    });
    this.map.addLayer({
      id: LYR_FIRES_POINTS,
      type: 'circle',
      source: SRC_FIRES,
      layout: { 'circle-sort-key': ['get', 'sortKey'] },
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          5, ['get', 'radius'],
          10, ['*', ['get', 'radius'], 1.6],
        ],
        // Couleur du foyer, portée par chaque détection (deckgl/environment-map.ts) : confiance faible jamais rouge.
        'circle-color': ['get', 'color'],
        'circle-stroke-width': 1,
        'circle-stroke-color': 'rgba(0,0,0,0.5)',
        'circle-opacity': 0.9,
      }
    });
    this.map.addLayer({
      id: LYR_FIRES_HIGHLIGHT,
      type: 'circle',
      source: SRC_FIRES_HIGHLIGHT,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 10, 10, 18],
        'circle-color': 'transparent',
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 1,
      }
    });

    // ─── Traffic: TomTom Raster (via proxy /api/traffic/tile) ───
    // Visibilité pilotée par setVis(LYR_TRAFFIC, …) selon l'état du layer trafficRoad ;
    // si le serveur n'a pas de clé TomTom, les tuiles échouent silencieusement.
    this.map.addLayer({
      id: LYR_TRAFFIC,
      type: 'raster',
      source: SRC_TRAFFIC,
      minzoom: 10,
      paint: {
        'raster-opacity': 0.8,
        'raster-resampling': 'nearest'
      }
    });

    // ─── Trafics (spec 2026-10-03 trafics § 3) : couches de deckgl/traffic-map.ts, masquées jusqu'à setLayerVisibility ───
    for (const layer of TRAFFIC_LAYERS) this.map.addLayer(layer);

    // ─── Train route highlight ───
    this.map.addLayer({
      id: LYR_TRAIN_ROUTE,
      type: 'line',
      source: SRC_TRAIN_ROUTE,
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: {
        'line-color': TRAFFIC_COLOR,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 4, 8, 6, 12, 8],
        'line-opacity': 0.96,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        visibility: 'none',
      },
    });
    this.map.addLayer({
      id: LYR_TRAIN_STATIONS,
      type: 'circle',
      source: SRC_TRAIN_ROUTE,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 10, 8, 15, 12, 20],
        'circle-color': TRAFFIC_COLOR,
        'circle-stroke-width': 4,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 1,
      },
      layout: {
        visibility: 'none',
      },
    });
    this.map.addLayer({
      id: LYR_TRAIN_STATION_LABELS,
      type: 'symbol',
      source: SRC_TRAIN_ROUTE,
      filter: ['==', ['geometry-type'], 'Point'],
      layout: {
        'text-field': ['concat', ['case', ['==', ['get', 'role'], 'departure'], 'Départ · ', 'Arrivée · '], ['get', 'name']],
        'text-size': 11,
        'text-offset': [0, 1.7],
        'text-anchor': 'top',
        'text-font': ['Noto Sans Bold'],
        visibility: 'none',
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#07111f',
        'text-halo-width': 2,
        'text-opacity': 0.95,
      },
    });


    // ─── Crues : tronçons jaunes, orange et rouges, tracé publié par Vigicrues ───
    this.map.addLayer({
      id: LYR_FLOODS,
      type: 'line',
      source: SRC_FLOODS,
      paint: {
        'line-color': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          '#ffffff',
          ['get', 'color'],
        ],
        'line-width': ['interpolate', ['linear'], ['zoom'],
          4, ['case', ['boolean', ['feature-state', 'hover'], false], 8, 3],
          8, ['case', ['boolean', ['feature-state', 'hover'], false], 12, 5],
          12, ['case', ['boolean', ['feature-state', 'hover'], false], 16, 8],
        ],
        'line-opacity': ['case',
          ['boolean', ['feature-state', 'hover'], false], 1,
          0.92,
        ],
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });
    this.map.addLayer({
      id: LYR_FLOODS_HIGHLIGHT,
      type: 'line',
      source: SRC_FLOODS_HIGHLIGHT,
      paint: {
        'line-color': '#ffffff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 8, 8, 12, 12, 16],
        'line-opacity': 1,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'visibility': 'none',
      },
    });
    // ─── Environnement (spec 2026-10-04 § 2) : couches nouvelles de deckgl/environment-map.ts, masquées jusqu'à setLayerVisibility ───
    for (const layer of ENV_LAYERS) {
      const before = ENV_LAYER_BEFORE[layer.id];
      this.map.addLayer(layer, before && this.map.getLayer(before) ? before : undefined);
    }

    // ─── L1: News glow (critical/high only) ───
    this.map.addLayer({
      id: LYR_GLOW,
      type: 'circle',
      source: SRC,
      filter: ['in', ['get', 'level'], ['literal', ['critical', 'high']]],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 30, 8, 45, 12, 60],
        'circle-color': ['match', ['get', 'level'],
          'critical', 'rgba(255,45,85,0.25)',
          'high', 'rgba(255,107,53,0.20)',
          'rgba(0,0,0,0)'],
        'circle-blur': 0.8,
      },
    });

    // ─── Cluster circles (colored by max threat level) ───
    this.map.addLayer({
      id: LYR_CLUSTER_CIRCLE,
      type: 'circle',
      source: SRC,
      filter: ['has', 'point_count'],
      paint: {
        // Color by max threat level in cluster with better opacity for DSFR map
        'circle-color': ['case',
          ['>=', ['get', 'maxThreat'], 3], 'rgba(255,107,53,1)',  // high
          ['>=', ['get', 'maxThreat'], 2], 'rgba(255,204,0,1)',   // medium
          ['>=', ['get', 'maxThreat'], 1], 'rgba(52,199,89,1)',   // low
          'rgba(90,200,250,1)'  // info
        ],
        // Halo to make it pop like DSFR icons
        'circle-stroke-width': ['case',
          ['boolean', ['feature-state', 'hover'], false], 3, 0],
        'circle-stroke-color': ['case',
          ['boolean', ['feature-state', 'hover'], false],
          '#ffffff',
          'rgba(0,0,0,0)'],
        'circle-radius': [
          'step', ['get', 'point_count'],
          18,     // < 5
          5, 24,  // 5-15
          15, 32, // 15-50
          50, 42, // 50+
        ],
        'circle-opacity': 0.9,
      },
    });

    // ─── Cluster count labels ───
    this.map.addLayer({
      id: LYR_CLUSTER_COUNT,
      type: 'symbol',
      source: SRC,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-size': 13,
        'text-font': ['Open Sans Bold'],
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#ffffff',
      },
    });

    // ─── L2: News points (unclustered only) ───
    // Homogeneous point rendering: color encodes severity, not category shape.
    this.map.addLayer({
      id: LYR_POINTS,
      type: 'circle',
      source: SRC,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['match', ['get', 'level'],
          'critical', 'rgba(255,45,85,1)',
          'high', 'rgba(255,107,53,1)',
          'medium', 'rgba(255,204,0,1)',
          'low', 'rgba(52,199,89,1)',
          'rgba(90,200,250,1)'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          4, ['match', ['get', 'level'], 'critical', 5.5, 'high', 5, 'medium', 4.5, 4],
          7, ['match', ['get', 'level'], 'critical', 7, 'high', 6.5, 'medium', 5.5, 5],
          10, ['match', ['get', 'level'], 'critical', 8.5, 'high', 7.5, 'medium', 6.5, 5.5],
        ],
        'circle-stroke-width': ['case',
          ['boolean', ['feature-state', 'hover'], false], 3, 1.4],
        'circle-stroke-color': ['case',
          ['boolean', ['feature-state', 'hover'], false],
          '#ffffff',
          'rgba(10,10,15,0.7)'],
        'circle-opacity': ['interpolate', ['linear'], ['zoom'],
          4, ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0.7],
          8, ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0.9],
          12, ['case', ['boolean', ['feature-state', 'hover'], false], 1, 1],
        ],
      },
    });

    // ─── Infrastructure: Réseau gazier (GRTgaz / Teréga) ───
    this.map.addLayer({
      id: LYR_GAS_NETWORK_GRT,
      type: 'line',
      source: SRC_GAS_NETWORK_GRT,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#115E59',
        'line-opacity': 0.72,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1, 10, 3]
      }
    });

    this.map.addLayer({
      id: LYR_GAS_NETWORK_TEREGA,
      type: 'line',
      source: SRC_GAS_NETWORK_TEREGA,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#115E59',
        'line-opacity': 0.72,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1, 10, 3]
      }
    });

    // ─── Gas Vital Organs: Storage glow ───
    this.map.addLayer({
      id: LYR_GAS_STORAGES_GLOW,
      type: 'circle',
      source: SRC_GAS_VITALS,
      filter: ['==', ['get', 'type'], 'storage'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'capacity'], 1, 15, 7, 35],
        'circle-color': ['get', 'fillColor'],
        'circle-blur': 0.6,
        'circle-opacity': 0.4,
      },
    });

    // ─── Gas Vital Organs: Storage circles ───
    this.map.addLayer({
      id: LYR_GAS_STORAGES,
      type: 'circle',
      source: SRC_GAS_VITALS,
      filter: ['==', ['get', 'type'], 'storage'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'capacity'], 1, 8, 7, 18],
        'circle-color': ['get', 'fillColor'],
        'circle-opacity': 0.85,
        'circle-stroke-width': 4,
        'circle-stroke-color': ['get', 'strokeColor'],
      },
    });

    // ─── Gas Vital Organs: Storage labels (zoom > 7) ───
    this.map.addLayer({
      id: LYR_GAS_STORAGES_LABEL,
      type: 'symbol',
      source: SRC_GAS_VITALS,
      filter: ['==', ['get', 'type'], 'storage'],
      minzoom: 7,
      layout: {
        'text-field': ['concat', ['get', 'name'], '\n', ['get', 'fillLabel']],
        'text-size': 10,
        'text-offset': [0, 2],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#e8e8ec',
        'text-halo-color': '#0a0a0f',
        'text-halo-width': 1.5,
      },
    });

    // ─── Gas Vital Organs: Terminal markers ───
    this.map.addLayer({
      id: LYR_GAS_TERMINALS,
      type: 'circle',
      source: SRC_GAS_VITALS,
      filter: ['==', ['get', 'type'], 'terminal'],
      paint: {
        'circle-radius': 10,
        'circle-color': '#A78BFA',
        'circle-opacity': 0.9,
      },
    });

    // ─── Gas PIR: Arc glow ───
    // Softer glow than electricity, cyan/teal tones for gas pipeline feel
    this.map.addLayer({
      id: LYR_GAS_PIR_ARC_GLOW,
      type: 'line',
      source: SRC_GAS_PIR_ARCS,
      paint: {
        'line-color': ['coalesce', ['get', 'glowColor'], ['get', 'color']],
        'line-width': ['get', 'glowWidth'],
        'line-opacity': GAS_FLOW_STYLE.glowOpacity,
        'line-blur': GAS_FLOW_STYLE.glowBlur,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });

    // ─── Gas PIR: Arc (trait plein, chevrons animés pour indiquer le sens) ───
    this.map.addLayer({
      id: LYR_GAS_PIR_ARC,
      type: 'line',
      source: SRC_GAS_PIR_ARCS,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['get', 'lineWidth'],
        'line-opacity': GAS_FLOW_STYLE.lineOpacity,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });

    // ─── Gas PIR: Animated chevrons (reuse SDF icon, tinted cyan/teal) ───
    this.map.addLayer({
      id: LYR_GAS_PIR_CHEVRONS,
      type: 'symbol',
      source: SRC_GAS_PIR_CHEVRON_PTS,
      layout: {
        'icon-image': 'chevron-electric',
        'icon-size': ['interpolate', ['linear'], ['zoom'],
          4, ['*', ['get', 'size'], 0.3],
          8, ['*', ['get', 'size'], 0.55],
          12, ['*', ['get', 'size'], 0.8],
        ],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-pitch-alignment': 'map',
        'icon-rotation-alignment': 'map',
        'icon-rotate': ['get', 'rotation'],
      },
      paint: {
        'icon-color': ['get', 'color'],
        'icon-opacity': 0.88,
      },
    });

    // ─── Gas PIR: Endpoint markers ───
    this.map.addLayer({
      id: LYR_GAS_PIR_MARKER,
      type: 'circle',
      source: SRC_GAS_PIR_MARKERS,
      paint: {
        'circle-radius': ['get', 'radius'],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.9,
      },
    });

    // ─── Gas PIR: Labels ───
    this.map.addLayer({
      id: LYR_GAS_PIR_LABEL,
      type: 'symbol',
      source: SRC_GAS_PIR_MARKERS,
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 11,
        'text-anchor': 'left',
        'text-offset': [1.2, 0],
      },
      paint: {
        'text-color': '#e8e8ec',
        'text-halo-color': '#0a0a0f',
        'text-halo-width': 1.5,
      },
    });

    // ═══════════════════════════════════════════════════════════════
    // BIOMETHANE INJECTION SITES — GRDF OpenData, 833 sites, amber dots
    // ═══════════════════════════════════════════════════════════════
    this.map.addSource(SRC_BIOMETHANE_SITES, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: 10,
      clusterRadius: 45,
    });

    // Cluster circles — amber, sized by point count
    this.map.addLayer({
      id: LYR_BIOMETHANE_CLUSTERS,
      type: 'circle',
      source: SRC_BIOMETHANE_SITES,
      filter: ['has', 'point_count'],
      paint: {
        'circle-radius': ['step', ['get', 'point_count'], 12, 10, 16, 50, 22],
        'circle-color': '#F59E0B',
        'circle-opacity': 0.7,
        'circle-stroke-width': 2,
        'circle-stroke-color': 'rgba(245, 158, 11, 0.4)',
      },
      layout: { visibility: 'none' },
    });

    // Cluster count labels
    this.map.addLayer({
      id: LYR_BIOMETHANE_CLUSTER_COUNT,
      type: 'symbol',
      source: SRC_BIOMETHANE_SITES,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-size': 11,
        'text-font': ['Noto Sans Bold'],
        visibility: 'none',
      },
      paint: {
        'text-color': '#000',
      },
    });

    // Individual unclustered points — amber dots
    this.map.addLayer({
      id: LYR_BIOMETHANE_SITES,
      type: 'circle',
      source: SRC_BIOMETHANE_SITES,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['get', 'capacityGwh'],
          0, 3,
          10, 4,
          40, 6,
        ],
        'circle-color': '#F59E0B',
        'circle-opacity': 0.85,
        'circle-stroke-width': 1,
        'circle-stroke-color': 'rgba(245, 158, 11, 0.3)',
      },
      layout: { visibility: 'none' },
    });

    // Labels for individual sites at high zoom
    this.map.addLayer({
      id: LYR_BIOMETHANE_SITES_LABEL,
      type: 'symbol',
      source: SRC_BIOMETHANE_SITES,
      filter: ['!', ['has', 'point_count']],
      minzoom: 11,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 10,
        'text-anchor': 'left',
        'text-offset': [1, 0],
        visibility: 'none',
      },
      paint: {
        'text-color': '#F59E0B',
        'text-halo-color': '#0a0a0f',
        'text-halo-width': 1.5,
      },
    });

    // ═══════════════════════════════════════════════════════════════
    // OIL/PETROLEUM FLOWS — Brown/anthracite with amber glow, slow dash
    // Thick arcs to suggest viscous flow, ready for future oil data
    // ═══════════════════════════════════════════════════════════════

    // ─── Oil Flow: Arc glow ───
    this.map.addLayer({
      id: LYR_OIL_FLOW_ARC_GLOW,
      type: 'line',
      source: SRC_OIL_FLOW_ARCS,
      paint: {
        'line-color': ['coalesce', ['get', 'glowColor'], ['get', 'color']],
        'line-width': ['get', 'glowWidth'],
        'line-opacity': OIL_FLOW_STYLE.glowOpacity,
        'line-blur': OIL_FLOW_STYLE.glowBlur,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });

    // ─── Oil Flow: Animated arc ───
    // Slow dash animation to suggest viscous/heavy flow
    this.map.addLayer({
      id: LYR_OIL_FLOW_ARC,
      type: 'line',
      source: SRC_OIL_FLOW_ARCS,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['get', 'lineWidth'],
        'line-opacity': OIL_FLOW_STYLE.lineOpacity,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });

    this.map.addLayer({
      id: LYR_OIL_FLOW_CHEVRONS,
      type: 'symbol',
      source: SRC_OIL_FLOW_CHEVRON_PTS,
      layout: {
        'icon-image': 'chevron-electric',
        'icon-size': ['interpolate', ['linear'], ['zoom'],
          4, ['*', ['get', 'size'], 0.55],
          8, ['*', ['get', 'size'], 0.90],
          12, ['*', ['get', 'size'], 1.25],
        ],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-pitch-alignment': 'map',
        'icon-rotation-alignment': 'map',
        'icon-rotate': ['get', 'rotation'],
      },
      paint: {
        'icon-color': ['get', 'color'],
        'icon-opacity': 0.90,
      },
    });

    // ─── Oil Flow: Endpoint markers ───
    this.map.addLayer({
      id: LYR_OIL_FLOW_MARKER,
      type: 'circle',
      source: SRC_OIL_FLOW_MARKERS,
      paint: {
        'circle-radius': ['get', 'radius'],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.9,
        'circle-stroke-color': '#1c1917',  // Stone-900 for dark border
        'circle-stroke-width': 2,
      },
    });

    // ─── Oil Flow: Labels ───
    this.map.addLayer({
      id: LYR_OIL_FLOW_LABEL,
      type: 'symbol',
      source: SRC_OIL_FLOW_MARKERS,
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 12,
        'text-anchor': 'left',
        'text-offset': [1.2, 0],
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#fef3c7',  // Amber-100 for warm text
        'text-halo-color': '#1c1917',
        'text-halo-width': 1.8,
      },
    });

    // ─── Oil Infrastructure: Pipeline glow ───
    this.map.addLayer({
      id: LYR_OIL_PIPELINES_GLOW,
      type: 'line',
      source: SRC_OIL_PIPELINES,
      paint: {
        'line-color': '#d97706',  // Amber-600 glow
        'line-width': 6,
        'line-opacity': 0.3,
        'line-blur': 4,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });

    // ─── Oil Infrastructure: Pipelines ───
    this.map.addLayer({
      id: LYR_OIL_PIPELINES,
      type: 'line',
      source: SRC_OIL_PIPELINES,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['get', 'lineWidth'],
        'line-opacity': 0.85,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });

    // ─── Fuel tension pilot: department tint + red outline ───
    this.map.addLayer({
      id: LYR_FUEL_TENSION_FILL,
      type: 'fill',
      source: SRC_FUEL_TENSION,
      paint: {
        'fill-color': ['get', 'fillColor'],
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          0.32,
          ['coalesce', ['get', 'fillOpacity'], 0.18],
        ],
      },
    });
    this.map.addLayer({
      id: LYR_FUEL_TENSION_LINE,
      type: 'line',
      source: SRC_FUEL_TENSION,
      paint: {
        'line-color': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          '#FFFFFF',
          ['get', 'lineColor'],
        ],
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          1.9,
          ['coalesce', ['get', 'lineWidth'], 1.0],
        ],
        'line-opacity': 0.95,
      },
    });

    // ─── Oil Infrastructure: Refinery glow (halo ambiant derrière le triangle) ───
    this.map.addLayer({
      id: LYR_OIL_REFINERIES_GLOW,
      type: 'circle',
      source: SRC_OIL_REFINERIES,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          4, ['*', ['get', 'sizeScale'], 12],
          8, ['*', ['get', 'sizeScale'], 22],
          12, ['*', ['get', 'sizeScale'], 34],
        ],
        'circle-color': ['get', 'fillColor'],
        'circle-opacity': 0.20,
        'circle-blur': 0.85,
      },
    });

    // ─── Oil Infrastructure: Refineries — triangles ▲ (▼ si maintenance) ───
    this.map.addLayer({
      id: LYR_OIL_REFINERIES,
      type: 'symbol',
      source: SRC_OIL_REFINERIES,
      layout: {
        'icon-image': 'triangle-refinery',
        'icon-size': ['interpolate', ['linear'], ['zoom'],
          4, ['*', ['get', 'sizeScale'], 0.25],
          8, ['*', ['get', 'sizeScale'], 0.45],
          12, ['*', ['get', 'sizeScale'], 0.70],
        ],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'center',
        'icon-rotate': ['get', 'iconRotation'],
      },
      paint: {
        'icon-color': ['get', 'fillColor'],
        'icon-opacity': 0.95,
        'icon-halo-color': ['get', 'strokeColor'],
        'icon-halo-width': ['get', 'strokeWidth'],
      },
    });

    // ─── Oil Infrastructure: Refinery labels ───
    this.map.addLayer({
      id: LYR_OIL_REFINERIES_LABEL,
      type: 'symbol',
      source: SRC_OIL_REFINERIES,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 11,
        'text-anchor': 'left',
        'text-offset': [1.2, 0],
        'text-font': ['Open Sans Semibold'],
      },
      paint: {
        'text-color': '#fef3c7',
        'text-halo-color': '#1c1917',
        'text-halo-width': 1.5,
      },
    });

    // ─── Oil Infrastructure: Depots ───
    this.map.addLayer({
      id: LYR_OIL_DEPOTS,
      type: 'circle',
      source: SRC_OIL_DEPOTS,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          4, ['*', ['get', 'baseRadius'], 0.65],
          8, ['get', 'baseRadius'],
          12, ['*', ['get', 'baseRadius'], 1.4],
        ],
        'circle-color': ['get', 'fillColor'],
        'circle-opacity': ['get', 'opacity'],
        'circle-stroke-color': ['get', 'strokeColor'],
        'circle-stroke-width': ['get', 'strokeWidth'],
      },
    });

    // ─── Oil Infrastructure: Terminal inner ring (dark center disc) ───
    // Drawn on top of the bright depot disc → creates "rond dans le rond" effect
    this.map.addLayer({
      id: LYR_OIL_DEPOTS_TERMINAL_CENTER,
      type: 'circle',
      source: SRC_OIL_DEPOTS,
      filter: ['==', ['get', 'role'], 'terminal'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          4, ['*', ['get', 'baseRadius'], 0.30],
          8, ['*', ['get', 'baseRadius'], 0.48],
          12, ['*', ['get', 'baseRadius'], 0.62],
        ],
        'circle-color': '#1C0800',
        'circle-opacity': 0.95,
      },
    });

    // ─── Oil Infrastructure: Depot labels ───
    this.map.addLayer({
      id: LYR_OIL_DEPOTS_LABEL,
      type: 'symbol',
      source: SRC_OIL_DEPOTS,
      minzoom: 7,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 10,
        'text-anchor': 'left',
        'text-offset': [0.8, 0],
        'text-font': ['Open Sans Regular'],
      },
      paint: {
        'text-color': '#fde68a',
        'text-halo-color': '#1c1917',
        'text-halo-width': 1,
      },
    });

    // ─── Oil: Couches hit invisibles (zones de hover élargies) ───
    this.map.addLayer({
      id: LYR_OIL_REFINERIES_HIT,
      type: 'circle',
      source: SRC_OIL_REFINERIES,
      paint: {
        // Rayon fixe large indépendant du baseRadius — facilite le hover à tous les zooms
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          4, 24,
          8, 32,
          12, 44,
        ],
        'circle-opacity': 0,
        'circle-stroke-width': 0,
      },
    });

    this.map.addLayer({
      id: LYR_OIL_DEPOTS_HIT,
      type: 'circle',
      source: SRC_OIL_DEPOTS,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          4, ['*', ['get', 'baseRadius'], 2.5],
          8, ['*', ['get', 'baseRadius'], 3.0],
          12, ['*', ['get', 'baseRadius'], 3.5],
        ],
        'circle-opacity': 0,
        'circle-stroke-width': 0,
      },
    });

    this.map.addLayer({
      id: LYR_OIL_PIPELINES_HIT,
      type: 'line',
      source: SRC_OIL_PIPELINES,
      paint: { 'line-width': 22, 'line-opacity': 0 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });

    this.map.addLayer({
      id: LYR_OIL_FLOW_ARC_HIT,
      type: 'line',
      source: SRC_OIL_FLOW_ARCS,
      paint: { 'line-width': 22, 'line-opacity': 0 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });

    this.map.addLayer({
      id: LYR_OIL_FLOW_MARKER_HIT,
      type: 'circle',
      source: SRC_OIL_FLOW_MARKERS,
      paint: { 'circle-radius': 22, 'circle-opacity': 0, 'circle-stroke-width': 0 },
    });

    // ─── Infrastructure: vital halo commun ───
    this.map.addLayer({
      id: LYR_ENERGY_INFRA_VITAL_HALO,
      type: 'circle',
      source: SRC_INFRA,
      filter: ['!=', ['get', 'type'], 'nuclear'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          4, ['*', ['get', 'baseRadius'], 1.35],
          8, ['*', ['get', 'baseRadius'], 1.75],
          12, ['*', ['get', 'baseRadius'], 2.10],
        ],
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 4, 1.5, 8, 2.1, 12, 2.8],
        'circle-stroke-opacity': 0.96,
        'circle-stroke-color': INFRA_VITAL_HALO_COLOR,
      },
    });

    // ─── Infrastructure: nuclear accent ring ───
    this.map.addLayer({
      id: LYR_ENERGY_INFRA_NUCLEAR_RING,
      type: 'circle',
      source: SRC_INFRA,
      filter: ['==', ['get', 'type'], 'nuclear'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          4, ['*', ['get', 'baseRadius'], 1.00],
          8, ['*', ['get', 'baseRadius'], 1.22],
          12, ['*', ['get', 'baseRadius'], 1.42],
        ],
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 4, 1.6, 8, 2.2, 12, 2.9],
        'circle-stroke-opacity': 0.98,
        'circle-stroke-color': INFRA_NUCLEAR_RING_COLOR,
      },
    });

    this.map.addLayer({
      id: LYR_ENERGY_INFRA_HIGHLIGHT_GLOW,
      type: 'circle',
      source: SRC_INFRA_HIGHLIGHT,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 18, 8, 26, 12, 34],
        'circle-color': 'rgba(255,255,255,0.14)',
        'circle-blur': 0.6,
      },
    });

    this.map.addLayer({
      id: LYR_ENERGY_INFRA_HIGHLIGHT_RING,
      type: 'circle',
      source: SRC_INFRA_HIGHLIGHT,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 10, 8, 14, 12, 18],
        'circle-color': 'transparent',
        'circle-stroke-width': 2.6,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 0.96,
      },
    });

    // ─── Infrastructure: circles ───
    this.map.addLayer({
      id: LYR_ENERGY_INFRA_CIRCLE,
      type: 'circle',
      source: SRC_INFRA,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          4, ['*', ['get', 'baseRadius'], 0.72],
          8, ['get', 'baseRadius'],
          12, ['*', ['get', 'baseRadius'], 1.20],
        ],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.92,
        'circle-stroke-width': 0,
        'circle-stroke-color': 'rgba(0,0,0,0)',
      },
    });

    // ─── Infrastructure: labels (zoom > 9) ───
    this.map.addLayer({
      id: LYR_ENERGY_INFRA_LABEL,
      type: 'symbol',
      source: SRC_INFRA,
      minzoom: 9,
      layout: {
        'text-field': [
          'case',
          ['==', ['get', 'type'], 'nuclear'],
          ['concat', ['get', 'name'], '\n', ['get', 'available'], ' / ', ['get', 'power'], ' MW'],
          ['get', 'name']
        ],
        'text-size': 11,
        'text-offset': [0, 1.5],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#e8e8ec',
        'text-halo-color': '#0a0a0f',
        'text-halo-width': 1.5,
      },
    });

    this.map.addLayer({
      id: LYR_DROM_ENERGY_HTA_LINES,
      type: 'line',
      source: SRC_DROM_ENERGY_HTA_LINES,
      paint: {
        'line-color': '#7DD3FC',
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.42, 11, 0.72],
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.1, 11, 2.1, 14, 3],
      },
    });

    this.map.addLayer({
      id: LYR_DROM_ENERGY_POINTS,
      type: 'circle',
      source: SRC_DROM_ENERGY,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          4,
          ['match', ['get', 'assetType'], 'source_substation', 5.2, 'htb_pylon', 4.4, 'production_site', 4.8, 4.6],
          8,
          ['match', ['get', 'assetType'], 'source_substation', 7.2, 'htb_pylon', 5.8, 'production_site', 6.5, 6],
          12,
          ['match', ['get', 'assetType'], 'source_substation', 8.8, 'htb_pylon', 7, 'production_site', 7.8, 7.2],
        ],
        'circle-color': [
          'match',
          ['get', 'assetType'],
          'source_substation', '#4FD1FF',
          'htb_pylon', '#3B82F6',
          'production_site', '#2DD4BF',
          '#60A5FA',
        ],
        'circle-opacity': 0.92,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': [
          'match',
          ['get', 'assetType'],
          'source_substation', '#E0F2FE',
          'htb_pylon', '#BFDBFE',
          'production_site', '#CCFBF1',
          '#DBEAFE',
        ],
      },
    });

    this.map.addLayer({
      id: LYR_DROM_ENERGY_HIGHLIGHT,
      type: 'circle',
      source: SRC_DROM_ENERGY_HIGHLIGHT,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 12, 8, 18, 12, 24],
        'circle-color': 'rgba(56, 189, 248, 0.18)',
        'circle-stroke-width': 3,
        'circle-stroke-color': '#E0F2FE',
        'circle-opacity': 0.98,
        'circle-blur': 0.15,
      },
    });

    this.map.addLayer({
      id: LYR_HYDRO_BACKBONE_HALO,
      type: 'circle',
      source: SRC_HYDRO_BACKBONE,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          4, ['+', 4, ['/', ['get', 'radius'], 2.2]],
          8, ['+', 5, ['/', ['get', 'radius'], 1.5]],
          12, ['+', 6, ['/', ['get', 'radius'], 1.1]],
        ],
        'circle-color': ['get', 'color'],
        'circle-opacity': [
          'case',
          ['==', ['get', 'hydroTrend'], 'stress'], 0.24,
          ['==', ['get', 'hydroTrend'], 'high'], 0.18,
          ['==', ['get', 'hydroTrend'], 'low'], 0.10,
          0.12,
        ],
        'circle-blur': 0.7,
      },
    });

    this.map.addLayer({
      id: LYR_HYDRO_BACKBONE_SIGNAL_RING,
      type: 'circle',
      source: SRC_HYDRO_BACKBONE,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          4, ['+', ['*', ['get', 'radius'], 0.88], ['*', ['get', 'signalRadiusBoost'], 0.62]],
          8, ['+', ['*', ['get', 'radius'], 1.02], ['*', ['get', 'signalRadiusBoost'], 0.72]],
          12, ['+', ['*', ['get', 'radius'], 1.16], ['*', ['get', 'signalRadiusBoost'], 0.82]],
        ],
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': ['get', 'signalColor'],
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'],
          4, ['get', 'signalStrokeWidth'],
          8, ['*', ['get', 'signalStrokeWidth'], 1.12],
          12, ['*', ['get', 'signalStrokeWidth'], 1.24],
        ],
        'circle-opacity': ['get', 'signalOpacity'],
      },
    });

    this.map.addLayer({
      id: LYR_HYDRO_BACKBONE_CIRCLE,
      type: 'circle',
      source: SRC_HYDRO_BACKBONE,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          4, ['*', ['get', 'radius'], 0.75],
          8, ['get', 'radius'],
          12, ['*', ['get', 'radius'], 1.22],
        ],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.94,
        'circle-stroke-width': 0,
        'circle-stroke-color': 'rgba(0,0,0,0)',
      },
    });

    this.map.addLayer({
      id: LYR_HYDRO_BACKBONE_LABEL,
      type: 'symbol',
      source: SRC_HYDRO_BACKBONE,
      minzoom: 8,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 11,
        'text-offset': [0, 1.5],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#e8eef5',
        'text-halo-color': '#0a0a0f',
        'text-halo-width': 1.4,
      },
    });

    this.map.addLayer({
      id: LYR_WIND_TURBINE_HALO,
      type: 'circle',
      source: SRC_WIND_TURBINES,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          4, ['+', 4.5, ['/', ['get', 'radius'], 2.4]],
          8, ['+', 5.5, ['/', ['get', 'radius'], 1.7]],
          12, ['+', 6.4, ['/', ['get', 'radius'], 1.2]],
        ],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.16,
        'circle-blur': 0.75,
      },
    });

    this.map.addLayer({
      id: LYR_WIND_PARK_HALO,
      type: 'circle',
      source: SRC_WIND_PARKS,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          4, ['+', 4.5, ['/', ['get', 'radius'], 2.4]],
          8, ['+', 5.5, ['/', ['get', 'radius'], 1.7]],
          12, ['+', 6.4, ['/', ['get', 'radius'], 1.2]],
        ],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.16,
        'circle-blur': 0.75,
      },
    });

    // ─── Éolien : cluster bubbles (zoom < 10) ───
    this.map.addLayer({
      id: LYR_WIND_CLUSTER,
      type: 'circle',
      source: SRC_WIND_TURBINES,
      filter: ['has', 'point_count'],
      maxzoom: 8,
      paint: {
        'circle-color': [
          'step', ['get', 'point_count'],
          '#7DD3FC',   // 1-49
          50,  '#2563EB',  // 50-199
          200, '#1E3A8A',  // 200+
        ],
        'circle-radius': [
          'step', ['get', 'point_count'],
          14,
          50,  20,
          200, 28,
        ],
        'circle-opacity': 0.88,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': 'rgba(255,255,255,0.35)',
      },
    });

    this.map.addLayer({
      id: LYR_WIND_CLUSTER_COUNT,
      type: 'symbol',
      source: SRC_WIND_TURBINES,
      filter: ['has', 'point_count'],
      maxzoom: 8,
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-size': 11,
        'text-font': ['Open Sans Bold'],
      },
      paint: { 'text-color': '#ffffff' },
    });

    this.map.addLayer({
      id: LYR_WIND_TURBINE_CIRCLE,
      type: 'circle',
      source: SRC_WIND_TURBINES,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          4, ['*', ['get', 'radius'], 0.78],
          8, ['get', 'radius'],
          12, ['*', ['get', 'radius'], 1.22],
        ],
        'circle-color': ['get', 'color'],
        'circle-opacity': ['get', 'opacity'],
        'circle-stroke-width': 0,
        'circle-stroke-color': 'rgba(0,0,0,0)',
      },
    });

    this.map.addLayer({
      id: LYR_WIND_PARK_CIRCLE,
      type: 'circle',
      source: SRC_WIND_PARKS,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          4, ['*', ['get', 'radius'], 0.78],
          8, ['get', 'radius'],
          12, ['*', ['get', 'radius'], 1.22],
        ],
        'circle-color': ['get', 'color'],
        'circle-opacity': ['get', 'opacity'],
        'circle-stroke-width': 0,
        'circle-stroke-color': 'rgba(0,0,0,0)',
      },
    });

    this.map.addLayer({
      id: LYR_WIND_TURBINE_LABEL,
      type: 'symbol',
      source: SRC_WIND_TURBINES,
      filter: ['!', ['has', 'point_count']],
      minzoom: 8,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 11,
        'text-offset': [0, 1.55],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#e8eef5',
        'text-halo-color': '#08111b',
        'text-halo-width': 1.4,
      },
    });

    this.map.addLayer({
      id: LYR_WIND_PARK_LABEL,
      type: 'symbol',
      source: SRC_WIND_PARKS,
      filter: ['==', ['get', 'kind'], 'offshore'],
      minzoom: 8,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 11,
        'text-offset': [0, 1.55],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#e8eef5',
        'text-halo-color': '#08111b',
        'text-halo-width': 1.4,
      },
    });

    // ─── Métropoles: halo de fond ───
    this.map.addLayer({
      id: LYR_METRO_LOAD_GLOW,
      type: 'circle',
      source: SRC_METRO_LOAD,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          4, ['/', ['get', 'radius'], 1.6],
          7, ['get', 'radius'],
          10, ['*', ['get', 'radius'], 1.55],
        ],
        'circle-color': ['get', 'glowColor'],
        'circle-blur': 0.55,
        'circle-opacity': 1,
      },
    });

    // ─── Métropoles: cercle principal ───
    this.map.addLayer({
      id: LYR_METRO_LOAD_CIRCLE,
      type: 'circle',
      source: SRC_METRO_LOAD,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          4, ['/', ['get', 'radius'], 2.1],
          7, ['/', ['get', 'radius'], 1.2],
          10, ['get', 'radius'],
        ],
        'circle-color': ['get', 'color'],
        'circle-opacity': 1,
        'circle-stroke-width': 1.4,
        'circle-stroke-color': 'rgba(255,255,255,0.34)',
      },
    });

    // ─── Métropoles: labels ───
    this.map.addLayer({
      id: LYR_METRO_LOAD_LABEL,
      type: 'symbol',
      source: SRC_METRO_LOAD,
      layout: {
        'text-field': ['concat', ['get', 'name'], '\n', ['get', 'mwLabel']],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 8, 12, 11, 13],
        'text-offset': [0, 1.6],
        'text-anchor': 'top',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-font': ['Open Sans Regular'],
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#0a0a0f',
        'text-halo-width': 1.6,
        'text-opacity': 0.96,
      },
    });

    // ─── Military ───
    // Souveraineté, phase B (tâche B27) : zones drones DGAC (option) puis mailles GNSS, surfaces sous les points.
    for (const layer of SOV_B_LAYERS) this.map.addLayer(layer);

    // Sites d'urgences (spec § 3.4) : couleur = catégorie, surface = passages annuels.
    this.map.addLayer({
      id: LYR_HOSPITALS,
      type: 'circle',
      source: SRC_HOSPITALS,
      paint: {
        'circle-color': HOSPITAL_COLOR,
        'circle-radius': HOSPITAL_RADIUS,
        'circle-opacity': 0.9,
        'circle-stroke-color': '#0a0a0f',
        'circle-stroke-width': 1,
      },
    });

    // ─── Military Bases — triangle ▲ coloré par type ───
    this.map.addLayer({
      id: LYR_MILITARY_BASES_CIRCLE,   // id conservé pour les event handlers
      type: 'symbol',
      source: SRC_MILITARY_BASES,
      layout: {
        'icon-image': [
          'match', ['get', 'type'],
          'air', 'mil-base-air',
          'navy', 'mil-base-navy',
          'army', 'mil-base-army',
          'joint', 'mil-base-joint',
          'fortification', 'mil-base-fortification',
          'other', 'mil-base-other',
          'mil-base-other'
        ],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.25, 8, 0.35, 12, 0.45],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'bottom',
      },
      paint: {},
    });
    this.map.addLayer({
      id: LYR_MILITARY_BASES_LABEL,
      type: 'symbol',
      source: SRC_MILITARY_BASES,
      minzoom: 8,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 11,
        'text-offset': [0, 0.5],
        'text-anchor': 'top',
        'text-allow-overlap': false,
        'text-font': ['Open Sans Semibold'],
      },
      paint: {
        'text-color': [
          'match', ['get', 'type'],
          'air', '#4a9eff',
          'navy', '#00d4c8',
          'army', '#22c55e',
          'joint', '#a855f7',
          '#9898a8'
        ],
        'text-halo-color': '#0a0a0f',
        'text-halo-width': 2,
      },
    });

    // ─── Global AIS Traffic (civils/étrangers) ───
    // NOW RENDERED VIA DECK.GL TextLayer (see getDeckLayers())
    // Commented out MapLibre symbol layer:
    /*
    this.map.addLayer({
      id: LYR_GLOBAL_TRAFFIC,
      type: 'symbol',
      source: SRC_GLOBAL_TRAFFIC,
      layout: {
        'text-field': '◆',
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 8, 8, 12, 12, 16],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-font': ['Open Sans Bold'],
      },
      paint: {
        'text-color': [
          'match', ['get', 'shipCategory'],
          'tanker', '#ff6b6b',
          'cargo', '#ffd93d',
          'passenger', '#6bcb77',
          'fishing', '#4d96ff',
          'military', '#00d4c8',
          '#aaaaaa'
        ],
        'text-opacity': 0.85,
        'text-halo-color': '#000000',
        'text-halo-width': 1,
      },
    });
    */

    // Marine nationale : dessinée par la couche Souveraineté (SRC_SOV_NAVY, updateNavyLayer) ; restent la sélection et la surbrillance
    // d'un bâtiment, partagées avec le Trafic maritime.
    this.map.addLayer({
      id: LYR_MILITARY_SHIPS_SELECTED,
      type: 'circle',
      source: SRC_MILITARY_SHIPS_SELECTED,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 10, 8, 14, 12, 18],
        'circle-color': 'rgba(90,200,250,0.18)',
        'circle-stroke-width': 3,
        'circle-stroke-color': '#5ac8fa',
        'circle-opacity': 0.95,
      },
    });
    this.map.addLayer({
      id: LYR_MILITARY_SHIPS_HIGHLIGHT,
      type: 'circle',
      source: SRC_MILITARY_SHIPS_HIGHLIGHT,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 8, 8, 12, 12, 15],
        'circle-color': 'rgba(255,255,255,0.12)',
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 0.95,
      },
    });

    // ─── Submarine Cables (Defense Infrastructure) ───
    // Glow effect layer (below main line)
    this.map.addLayer({
      id: LYR_SUBMARINE_CABLES_GLOW,
      type: 'line',
      source: SRC_SUBMARINE_CABLES,
      paint: {
        'line-color': sovCableColor('#5fdcff'),
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          3, 10,
          8, 15,
          12, 22,
        ],
        'line-opacity': 0.3,
        'line-blur': 6,
      },
    });

    // Invisible hit area to make hover acquisition easier on thin lines.
    this.map.addLayer({
      id: LYR_SUBMARINE_CABLES_HITAREA,
      type: 'line',
      source: SRC_SUBMARINE_CABLES,
      paint: {
        'line-color': '#ffffff',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          3, 16,
          8, 22,
          12, 28,
        ],
        'line-opacity': 0.01,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });

    // Main cable line
    this.map.addLayer({
      id: LYR_SUBMARINE_CABLES,
      type: 'line',
      source: SRC_SUBMARINE_CABLES,
      paint: {
        'line-color': sovCableColor('#22c7ff'),
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2.8, 8, 4.2, 12, 5.8],
        'line-opacity': 0.96,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });

    // Crisp core line above the main stroke so the cable stays legible over the glow.
    this.map.addLayer({
      id: LYR_SUBMARINE_CABLES_CORE,
      type: 'line',
      source: SRC_SUBMARINE_CABLES,
      paint: {
        'line-color': sovCableColor('#f4fdff'),
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.4, 8, 2.1, 12, 2.8],
        'line-opacity': 0.98,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });

    // Landing points
    this.map.addLayer({
      id: LYR_SUBMARINE_CABLES_LANDING,
      type: 'circle',
      source: SRC_SUBMARINE_CABLES_LANDINGS,
      paint: {
        'circle-radius': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          7.5,
          5.5
        ],
        'circle-color': [
          'case',
          ['==', ['get', 'outOfService'], true],
          SOV_ABROAD_HEX,
          ['>=', ['coalesce', ['to-number', ['get', 'capacity_tbps']], 0], 100],
          '#b9ecff',
          '#7dd3fc'
        ],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2.2,
        'circle-stroke-opacity': 0.95,
        'circle-opacity': 0.98,
      },
    });

    // Lock stack order explicitly: glow below, cable strokes above, hit area above all for hover capture.
    this.map.moveLayer(LYR_SUBMARINE_CABLES_GLOW);
    this.map.moveLayer(LYR_SUBMARINE_CABLES, undefined);
    this.map.moveLayer(LYR_SUBMARINE_CABLES_CORE, undefined);
    this.map.moveLayer(LYR_SUBMARINE_CABLES_LANDING, undefined);
    this.map.moveLayer(LYR_SUBMARINE_CABLES_HITAREA, undefined);

    // ─── Souveraineté (contrats § 5) : couches de deckgl/sovereignty-map.ts, au-dessus des câbles, masquées jusqu'à setLayerVisibility ───
    for (const layer of SOV_LAYERS) this.map.addLayer(layer);
    // Pannes réseau (deckgl/outages-map.ts) : même rang, masquées jusqu'à setLayerVisibility.
    for (const layer of OUT_LAYERS) this.map.addLayer(layer);

    // ─── Citizen Outage Zones (crowd-sourced clusters) ───
    // Toujours violet (matching légende) — l'intensité varie selon severity
    this.map.addLayer({
      id: LYR_CITIZEN_FILL,
      type: 'fill',
      source: SRC_CITIZEN_ZONES,
      paint: {
        'fill-color': '#b400ff',
        'fill-opacity': [
          'match', ['get', 'severity'],
          'critical', 0.40,
          'high', 0.30,
          'medium', 0.22,
          /* low */ 0.15,
        ],
      },
    });
    this.map.addLayer({
      id: LYR_CITIZEN_LINE,
      type: 'line',
      source: SRC_CITIZEN_ZONES,
      paint: {
        'line-color': '#b400ff',
        'line-width': 2,
        'line-opacity': 0.9,
        'line-dasharray': [3, 2],
      },
    });

    // ─── Outages (Telecom & Power) ───
    this.map.addLayer({
      id: LYR_POWER_FILL,
      type: 'fill',
      source: SRC_POWER,
      paint: {
        'fill-color': ['get', 'fillColor'],
        'fill-opacity': ['get', 'fillOpacity'],
      },
    });
    this.map.addLayer({
      id: LYR_POWER_LINE,
      type: 'line',
      source: SRC_POWER,
      paint: {
        'line-color': ['get', 'lineColor'],
        'line-width': 1.5,
      },
    });
    this.map.addLayer({
      id: LYR_TELECOM_PTS,
      type: 'circle',
      source: SRC_TELECOM,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3, 10, 5],
        'circle-color': [
          'match',
          ['get', 'status'],
          'HS', '#EF4444',  // rouge vif — antenne hors service
          'Degraded', '#FF8C00',  // orange saturé — antenne dégradée
          '#2D1A0E'               // très sombre — antenne OK (discret)
        ],
        'circle-stroke-width': 1,
        'circle-stroke-color': '#0a0a0f',
      },
    });
    // Séismes et marégraphes (phase B) au-dessus de toutes les surfaces : ajoutés ici, sous la première couche de points qui suit la dernière surface.
    placeEnvBPoints(this.map);

    // ─── Internet / BGP outages ───
    // Glow ring for IODA outage events — couleur teal (cyan) pour distinguer d'internet
    // ── Clusters IODA ──
    this.map.addLayer({
      id: LYR_NET_IODA_CLUSTER,
      type: 'circle',
      source: SRC_NET_IODA,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#6366f1',
        'circle-radius': ['step', ['get', 'point_count'], 13, 3, 17, 6, 21],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#0a0a0f',
        'circle-opacity': 0.88,
      },
    });
    this.map.addLayer({
      id: LYR_NET_IODA_CLUSTER_COUNT,
      type: 'symbol',
      source: SRC_NET_IODA,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-size': 11,
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
      },
      paint: { 'text-color': '#ffffff' },
    });
    // ── Points individuels IODA ──
    this.map.addLayer({
      id: LYR_NET_IODA_GLOW,
      type: 'circle',
      source: SRC_NET_IODA,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 28, 8, 44, 12, 58],
        'circle-color': [
          'interpolate', ['linear'], ['get', 'score'],
          0, 'rgba(16,185,129,0.09)',
          50, 'rgba(245,158,11,0.15)',
          80, 'rgba(239,68,68,0.18)',
        ],
        'circle-blur': 0.7,
        'circle-stroke-width': 0,
      },
    });
    // Core dot for IODA outage events
    this.map.addLayer({
      id: LYR_NET_IODA_CORE,
      type: 'circle',
      source: SRC_NET_IODA,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 6, 10, 10],
        'circle-color': [
          'interpolate', ['linear'], ['get', 'score'],
          0, '#10B981',
          50, '#F59E0B',
          80, '#EF4444',
        ],
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#0a0a0f',
        'circle-opacity': ['case', ['get', 'isOngoing'], 1.0, 0.55],
      },
    });
    // ── Clusters ISP ──
    this.map.addLayer({
      id: LYR_NET_ISP_CLUSTER,
      type: 'circle',
      source: SRC_NET_ISP,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#10B981',
        'circle-radius': ['step', ['get', 'point_count'], 13, 3, 17, 6, 21],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#0a0a0f',
        'circle-opacity': 0.88,
      },
    });
    this.map.addLayer({
      id: LYR_NET_ISP_CLUSTER_COUNT,
      type: 'symbol',
      source: SRC_NET_ISP,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-size': 11,
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
      },
      paint: { 'text-color': '#0a0a0f' },
    });
    // ISP BGP status — anneaux (distinct des cercles pleins télécom)
    // 1. Halo ambiant
    this.map.addLayer({
      id: LYR_NET_ISP_GLOW,
      type: 'circle',
      source: SRC_NET_ISP,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 18, 10, 30],
        'circle-color': [
          'match', ['get', 'status'],
          'outage', 'rgba(239,68,68,0.13)',
          'degraded', 'rgba(245,158,11,0.15)',
          'rgba(16,185,129,0.10)',
        ],
        'circle-blur': 0.75,
        'circle-stroke-width': 0,
      },
    });
    // 2. Anneau creux (fill transparent + stroke coloré)
    this.map.addLayer({
      id: LYR_NET_ISP_RING,
      type: 'circle',
      source: SRC_NET_ISP,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 8, 10, 14],
        'circle-color': 'rgba(0,0,0,0)',
        'circle-opacity': 0,
        'circle-stroke-width': 2.5,
        'circle-stroke-color': [
          'match', ['get', 'status'],
          'outage', '#EF4444',
          'degraded', '#F59E0B',
          '#10B981',
        ],
        'circle-stroke-opacity': 0.90,
      },
    });
    // 3. Point central
    this.map.addLayer({
      id: LYR_NET_ISP,
      type: 'circle',
      source: SRC_NET_ISP,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3, 10, 5],
        'circle-color': [
          'match', ['get', 'status'],
          'outage', '#EF4444',
          'degraded', '#F59E0B',
          '#10B981',
        ],
        'circle-stroke-width': 1,
        'circle-stroke-color': '#0a0a0f',
        'circle-opacity': 0.95,
      },
    });

    // ─── Datacenter status — palette bleu acier (infra cloud) ───
    // ── Clusters DC ──
    this.map.addLayer({
      id: LYR_DC_CLUSTER,
      type: 'circle',
      source: SRC_DC,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': 'rgba(96,165,250,0.18)',
        'circle-radius': ['step', ['get', 'point_count'], 18, 3, 24, 6, 30, 10, 36],
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#60A5FA',
        'circle-opacity': 0.96,
      },
    });
    this.map.addLayer({
      id: LYR_DC_CLUSTER_COUNT,
      type: 'symbol',
      source: SRC_DC,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-size': 12,
        'text-font': ['Noto Sans Bold'],
      },
      paint: { 'text-color': '#DBEAFE' },
    });
    // Glow halo (cercle doux pour l'ambiance visuelle)
    this.map.addLayer({
      id: LYR_DC_GLOW,
      type: 'circle',
      source: SRC_DC,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 14, 10, 22],
        'circle-color': 'rgba(96,165,250,0.06)',
        'circle-blur': 0.35,
        'circle-stroke-width': 0,
      },
    });
    // Core datacenters — triangles bleu acier SDF (▲), colorisés par statut
    this.map.addLayer({
      id: LYR_DC_CORE,
      type: 'symbol',
      source: SRC_DC,
      filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': 'triangle-dc',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.28, 10, 0.50],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-color': [
          'case',
          ['==', ['get', 'operationalStateKey'], 'fast-track'], '#9C27B0',
          ['==', ['get', 'operationalStateKey'], 'en construction'], '#F97316',
          ['==', ['get', 'operationalStateKey'], 'en projet'], '#EAB308',
          ['==', ['get', 'operationalStateKey'], 'site existant'], '#60A5FA',
          ['match', ['get', 'status'],
            'operational', '#60A5FA',
            'degraded', '#3B82F6',
            'partial', '#2563EB',
            'outage', '#1D4ED8',
            'maintenance', '#93C5FD',
            'unknown', '#94A3B8',
            '#94A3B8',
          ],
        ],
        'icon-opacity': 0.98,
        'icon-halo-color': '#111827',
        'icon-halo-width': 0.8,
      },
    });
    this.map.addLayer({
      id: LYR_DC_HIGHLIGHT,
      type: 'symbol',
      source: SRC_DC_HIGHLIGHT,
      layout: {
        'icon-image': 'triangle-dc',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.28, 10, 0.50],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-color': '#FFFFFF',
        'icon-opacity': 1,
        'icon-halo-color': '#60A5FA',
        'icon-halo-width': 2.2,
      },
    });

    // ─── IXP — carrés bleu pâle/gris (infra exchange) ───
    // ── Clusters IXP ──
    this.map.addLayer({
      id: LYR_IXP_CLUSTER,
      type: 'circle',
      source: SRC_IXP,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': 'rgba(148,163,184,0.18)',
        'circle-radius': ['step', ['get', 'point_count'], 16, 3, 22, 6, 28, 10, 34],
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#93C5FD',
        'circle-opacity': 0.94,
      },
    });
    this.map.addLayer({
      id: LYR_IXP_CLUSTER_COUNT,
      type: 'symbol',
      source: SRC_IXP,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-size': 11,
        'text-font': ['Noto Sans Bold'],
      },
      paint: { 'text-color': '#E2E8F0' },
    });
    this.map.addLayer({
      id: LYR_IXP_CIRCLE,
      type: 'symbol',
      source: SRC_IXP,
      filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': 'square-ixp',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.18, 10, 0.34],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-color': [
          'match', ['get', 'status'],
          'outage', '#64748B',
          'degraded', '#93C5FD',
          '#BFDBFE',
        ],
        'icon-opacity': 0.96,
        'icon-halo-color': '#0F172A',
        'icon-halo-width': 0.6,
      },
    });
    this.map.addLayer({
      id: LYR_IXP_HIGHLIGHT,
      type: 'symbol',
      source: SRC_IXP_HIGHLIGHT,
      layout: {
        'icon-image': 'square-ixp',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.18, 10, 0.34],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-color': '#FFFFFF',
        'icon-opacity': 1,
        'icon-halo-color': '#BFDBFE',
        'icon-halo-width': 2,
      },
    });

    // ─── Critical alerts (never clustered, always visible) ───
    // Glow layer for critical points
    this.map.addLayer({
      id: 'news-critical-glow',
      type: 'circle',
      source: SRC_CRITICAL,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 25, 8, 40, 12, 55],
        'circle-color': 'rgba(255,45,85,0.15)',
        'circle-blur': 0.7,
      },
    });
    // Main circle for critical points
    this.map.addLayer({
      id: 'news-critical-pts',
      type: 'circle',
      source: SRC_CRITICAL,
      paint: {
        'circle-color': 'rgba(255,45,85,1)',
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          4, 6.5,
          7, 8.5,
          10, 10.5,
        ],
        'circle-stroke-width': ['case',
          ['boolean', ['feature-state', 'hover'], false], 3, 1.8],
        'circle-stroke-color': ['case',
          ['boolean', ['feature-state', 'hover'], false],
          '#ffffff',
          'rgba(255,159,10,0.9)'],
        'circle-opacity': 1,  // Always fully visible
      },
    });

    // ─── Selection glow ───
    this.map.addLayer({
      id: LYR_SEL_GLOW,
      type: 'circle',
      source: SRC_SEL,
      paint: {
        'circle-radius': 30,
        'circle-color': 'rgba(108,140,255,0.12)',
        'circle-blur': 0.4,
      },
    });
    this.map.addLayer({
      id: LYR_SEL_RING,
      type: 'circle',
      source: SRC_SEL,
      paint: {
        'circle-radius': 20,
        'circle-color': 'transparent',
        'circle-stroke-width': 3,
        'circle-stroke-color': 'rgba(108,140,255,0.9)',
      },
    });



    // ─── Incidents HTB RTE IIP ───
    this.map.addLayer({
      id: LYR_IIP_GLOW,
      type: 'circle',
      source: SRC_IIP,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 14, 10, 22],
        'circle-color': '#6c8cff',
        'circle-opacity': 0.18,
        'circle-blur': 0.7,
      },
    });
    this.map.addLayer({
      id: LYR_IIP_CORE,
      type: 'circle',
      source: SRC_IIP,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 6, 10, 10],
        'circle-color': [
          'match', ['get', 'incidentType'],
          'transmission', '#a0b4ff',
          /* production */ '#6c8cff',
        ],
        'circle-opacity': 0.9,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': 0.6,
      },
    });

    // ─── Citizen zones au-dessus de tous les calques ───
    // moveLayer sans beforeId = déplace au sommet du stack MapLibre
    this.map.moveLayer(LYR_CITIZEN_FILL);
    this.map.moveLayer(LYR_CITIZEN_LINE);
    this.map.moveLayer(LYR_IIP_GLOW);
    this.map.moveLayer(LYR_IIP_CORE);

    // ═══════════════════════════════════════════════════════════════
    // EVENT HANDLERS
    // ═══════════════════════════════════════════════════════════════

    // ─── GLOBAL mousemove ───
    this.map.on('mousemove', (e) => {
      if (!this.map) return;
      const pad = 12;
      const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
        [e.point.x - pad, e.point.y - pad],
        [e.point.x + pad, e.point.y + pad],
      ];
      const features = this.map.queryRenderedFeatures(bbox, { layers: [LYR_POINTS, 'news-critical-pts', LYR_TELECOM_PTS] });

      // Clear previous hover state
      if (this.hoveredId !== null) {
        try {
          this.map.setFeatureState({ source: SRC, id: this.hoveredId }, { hover: false });
        } catch { /* feature may no longer exist */ }
        this.hoveredId = null;
      }

      if (features.length > 0) {
        // Hovering an individual point
        const feat = features[0];
        const fid = feat.id;
        if (fid != null) {
          this.hoveredId = fid as number;
          try {
            this.map.setFeatureState({ source: SRC, id: fid }, { hover: true });
          } catch { /* ignore */ }
        }
        this.map.getCanvas().style.cursor = 'pointer';
        this.hoveredClusterId = null;
        this.lastClusterItems = [];
        this.lastClusterCount = 0;
        // Cancel any pending cluster hide
        if (this.clusterHideTimeout) {
          clearTimeout(this.clusterHideTimeout);
          this.clusterHideTimeout = null;
        }
        const itemId = feat.properties?.itemId as string | undefined;
        const item = itemId ? this.itemsById.get(itemId) ?? null : null;
        if (this.onItemHover) {
          this.onItemHover(item, e.point.x, e.point.y);
        }
        // Clear cluster hover immediately when hovering a point
        if (this.onClusterHover) this.onClusterHover([], 0, 0, 0);
      } else {
        // Check if hovering a cluster
        const clusterFeats = this.map.queryRenderedFeatures(bbox, { layers: [LYR_CLUSTER_CIRCLE] });
        if (clusterFeats.length > 0) {
          // Cancel any pending hide - we're still over a cluster
          if (this.clusterHideTimeout) {
            clearTimeout(this.clusterHideTimeout);
            this.clusterHideTimeout = null;
          }

          this.map.getCanvas().style.cursor = 'pointer';
          const clusterId = clusterFeats[0].properties?.cluster_id as number | undefined;
          const pointCount = clusterFeats[0].properties?.point_count as number | undefined;

          // Fetch leaves if cluster changed — throttled (~100ms) so rapid
          // mousemove across clusters doesn't spam getClusterLeaves().
          if (clusterId != null && clusterId !== this.hoveredClusterId) {
            this.hoveredClusterId = clusterId;
            if (this.clusterLeavesHoverTimeout) {
              clearTimeout(this.clusterLeavesHoverTimeout);
            }
            const hoverX = e.point.x;
            const hoverY = e.point.y;
            this.clusterLeavesHoverTimeout = setTimeout(() => {
              this.clusterLeavesHoverTimeout = null;
              // Only fetch if this cluster is still the hovered one
              if (!this.map || this.hoveredClusterId !== clusterId) return;
              const src = this.map.getSource(SRC) as maplibregl.GeoJSONSource;

              // Get cluster leaves (up to 20 items for preview)
              src.getClusterLeaves(clusterId, 20, 0).then((leaves) => {
                if (!this.onClusterHover || this.hoveredClusterId !== clusterId) return;
                const items: NewsItem[] = [];
                for (const leaf of leaves) {
                  const leafItemId = leaf.properties?.itemId as string | undefined;
                  if (leafItemId) {
                    const item = this.itemsById.get(leafItemId);
                    if (item) items.push(item);
                  }
                }
                // Cache items for re-use when same cluster
                this.lastClusterItems = items;
                this.lastClusterCount = pointCount ?? items.length;
                this.onClusterHover(items, hoverX, hoverY, this.lastClusterCount);
              }).catch(() => { /* ignore */ });
            }, 100);
          } else if (this.lastClusterItems.length > 0 && this.onClusterHover) {
            // Same cluster - update position only with cached items
            this.onClusterHover(this.lastClusterItems, e.point.x, e.point.y, this.lastClusterCount);
          }
          // Clear single item hover
          if (this.onItemHover) this.onItemHover(null, 0, 0);
        } else {
          // Not hovering a cluster - schedule hide with delay
          this.map.getCanvas().style.cursor = '';

          if (this.hoveredClusterId !== null && !this.clusterHideTimeout) {
            // Delay hiding to prevent flicker when moving within cluster area
            this.clusterHideTimeout = setTimeout(() => {
              this.hoveredClusterId = null;
              this.lastClusterItems = [];
              this.lastClusterCount = 0;
              this.clusterHideTimeout = null;
              if (this.onClusterHover) this.onClusterHover([], 0, 0, 0);
            }, 150); // 150ms delay before hiding
          }

          if (this.onItemHover) this.onItemHover(null, 0, 0);
        }
      }
    });

    // ─── GLOBAL click ───
    this.map.on('click', (e) => {
      if (!this.map) return;
      const pad = 10;
      const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
        [e.point.x - pad, e.point.y - pad],
        [e.point.x + pad, e.point.y + pad],
      ];

      // Click on cluster → zoom to expand or show all items if max zoom reached
      const clusterFeatures = this.map.queryRenderedFeatures(bbox, { layers: [LYR_CLUSTER_CIRCLE] });
      if (clusterFeatures.length > 0) {
        const clusterId = clusterFeatures[0].properties?.cluster_id as number;
        const pointCount = clusterFeatures[0].properties?.point_count as number;
        const geom = clusterFeatures[0].geometry as GeoJSON.Point;
        const center = geom.coordinates as [number, number];
        const src = this.map.getSource(SRC) as maplibregl.GeoJSONSource;
        const currentZoom = this.map.getZoom();

        src.getClusterExpansionZoom(clusterId).then((expansionZoom) => {
          if (!this.map) return;

          // If expansion zoom is close to or below current zoom, we're at max expansion
          // Show all cluster items in a panel instead of zooming
          const ZOOM_THRESHOLD = 0.5;
          const MAX_USEFUL_ZOOM = 16; // Beyond this, zooming doesn't help

          if (expansionZoom <= currentZoom + ZOOM_THRESHOLD || currentZoom >= MAX_USEFUL_ZOOM) {
            // At max zoom or cluster can't expand further
            // Fetch ALL leaves and trigger cluster click callback
            console.log(`[DeckGLMap] Cluster at max zoom (expansion: ${expansionZoom}, current: ${currentZoom}). Showing ${pointCount} items.`);

            src.getClusterLeaves(clusterId, pointCount, 0).then((leaves) => {
              const items: NewsItem[] = [];
              for (const leaf of leaves) {
                const itemId = leaf.properties?.itemId as string | undefined;
                if (itemId) {
                  const item = this.itemsById.get(itemId);
                  if (item) items.push(item);
                }
              }
              // Sort by date (most recent first)
              items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

              if (this.onClusterClick) {
                this.onClusterClick(items, center);
              }
            }).catch((err) => {
              console.warn('[DeckGLMap] Failed to get cluster leaves:', err);
            });
          } else {
            // Zoom to expand with cinematic animation
            console.log(`[DeckGLMap] Expanding cluster: zoom ${currentZoom} → ${expansionZoom + 0.5}`);

            // Calculate distance for adaptive duration
            const currentCenter = this.map.getCenter();
            const dx = center[0] - currentCenter.lng;
            const dy = center[1] - currentCenter.lat;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const duration = Math.min(1800, Math.max(600, distance * 200));

            this.map.flyTo({
              center,
              zoom: expansionZoom + 0.5, // Slightly beyond expansion point for smooth transition
              curve: 1.2,                 // Moderate arc
              speed: 1.5,                 // Slightly faster than normal flyTo
              easing: (t) => t * (2 - t), // Ease-out quadratic
              essential: true,
              duration,
            });
          }
        }).catch((err) => {
          console.warn('[DeckGLMap] Failed to get cluster expansion zoom:', err);
        });
        return;
      }

      // Click on individual point (including critical points)
      const features = this.map.queryRenderedFeatures(bbox, { layers: [LYR_POINTS, 'news-critical-pts'] });
      if (features.length > 0) {
        const itemId = features[0].properties?.itemId as string | undefined;
        const item = itemId ? this.itemsById.get(itemId) ?? null : null;
        console.log('[DeckGLMap] Click on point:', itemId, item?.title, item?.link);
        if (item && this.onItemClick) this.onItemClick(item);
        return;
      }

      // Raw map click (empty area) — used by élus panel
      if (this.onRawMapClick) {
        this.onRawMapClick(e.lngLat.lat, e.lngLat.lng);
      }

    });

    // ─── Telecom Outages Interactions ───
    this.map.on('mouseenter', LYR_TELECOM_PTS, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', LYR_TELECOM_PTS, () => {
      if (this.map) this.map.getCanvas().style.cursor = '';
    });
    this.map.on('click', LYR_TELECOM_PTS, (e) => {
      if (!this.map || !e.features || e.features.length === 0) return;
      const feat = e.features[0];
      const p = feat.properties || {};
      const coords = (feat.geometry as GeoJSON.Point).coordinates as [number, number];

      const html = `
        <div style="color:#e8e8ec; font-family:sans-serif; min-width:180px;">
          <h4 style="margin:0 0 2px; font-weight:700; font-size: 15px; color: #ffffff;">
            ${p.city && p.city !== 'null' ? p.city : 'Ville Inconnue'} <span style="font-size:12px; font-weight:normal; color:#9898a8;">${p.department && p.department !== 'null' && p.department !== 'Inconnu' ? `(${p.department.trim()})` : ''}</span>
          </h4>
          <div style="margin:0 0 8px; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size: 13px; font-weight: 600; color: #6c8cff;">${p.operator}</span>
            <span style="font-size:10px; padding:2px 6px; border-radius:4px; font-weight:700; color:white; background:${p.status === 'HS' ? '#ff3b30' : '#ff9f0a'}">${p.status}</span>
          </div>
          
          <div style="font-size:12px; margin-bottom: 8px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:4px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 4px;">
              <span style="color:#9898a8">Voix (2G/3G) :</span>
              <span style="font-weight:600; color:${p.voiceStatus === 'OK' ? '#34c759' : (p.voiceStatus === 'HS' ? '#ff3b30' : '#ff9f0a')}">
                ${p.voiceStatus === 'HS' ? 'Hors Service' : (p.voiceStatus === 'Degraded' ? 'Dégradé' : 'OK')}
              </span>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span style="color:#9898a8">Internet (4G/5G) :</span>
              <span style="font-weight:600; color:${p.dataStatus === 'OK' ? '#34c759' : (p.dataStatus === 'HS' ? '#ff3b30' : '#ff9f0a')}">
                ${p.dataStatus === 'HS' ? 'Hors Service' : (p.dataStatus === 'Degraded' ? 'Dégradé' : 'OK')}
              </span>
            </div>
          </div>
          
          ${p.reason && p.reason !== 'null' && p.reason.trim() !== '' ? `<p style="margin:6px 0 0 0; font-size: 11px; opacity: 0.8; color:#a1a1aa; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 6px;"><i>${p.reason}</i></p>` : ''}
        </div>
      `;

      new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '300px', className: 'dark-popup' })
        .setLngLat(coords)
        .setHTML(html)
        .addTo(this.map);
    });

    // ─── Feux : curseur sur une détection ; infobulle (satellite exact, confiance, FRP, âge) de initEnvironmentInteractions ───
    this.map.on('mouseenter', LYR_FIRES_POINTS, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', LYR_FIRES_POINTS, () => {
      if (this.map) this.map.getCanvas().style.cursor = '';
    });

    // Couches santé : infobulle au survol et fiche de site au clic (initHealthInteractions).
    this.initHealthInteractions();

    // Couches Trafics : infobulle au survol, vitesse du tronçon au clic sur un bouchon (initTrafficInteractions).
    this.initTrafficInteractions();

    // Couches Environnement : infobulle au survol, point du profil radar au clic (initEnvironmentInteractions).
    this.initEnvironmentInteractions();
    // Couches Souveraineté : infobulle au survol, clic transmis à App.ts (initSovereigntyInteractions).
    this.initSovereigntyInteractions();
    this.initOutagesInteractions();


    this.map.on('mouseenter', LYR_DROM_ENERGY_POINTS, () => {
      if (!this.map) return;
      this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', LYR_DROM_ENERGY_POINTS, () => {
      if (!this.map) return;
      this.map.getCanvas().style.cursor = '';
      this.dromEnergyHoverPopup?.remove();
      this.dromEnergyHoverPopup = null;
    });
    this.map.on('mousemove', LYR_DROM_ENERGY_POINTS, (e) => {
      if (!this.map) return;
      const feature = e.features?.[0];
      if (!feature) return;

      this.dromEnergyHoverPopup?.remove();
      this.dromEnergyHoverPopup = null;
      const asset = dromEnergyAssetFromProperties((feature.properties ?? {}) as Record<string, unknown>);
      const html = renderDromEnergyTooltipHtml(asset);

      if (!this.dromEnergyHoverPopup) {
        this.dromEnergyHoverPopup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          maxWidth: '280px',
          className: 'dark-popup',
        }).addTo(this.map);
      }

      this.dromEnergyHoverPopup
        .setLngLat(e.lngLat)
        .setHTML(html);
    });
    this.map.on('click', LYR_DROM_ENERGY_POINTS, (e) => {
      if (!this.map) return;
      const feature = e.features?.[0];
      if (!feature) return;

      const asset = dromEnergyAssetFromProperties((feature.properties ?? {}) as Record<string, unknown>);
      const html = renderDromEnergyTooltipHtml(asset);

      new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '280px', className: 'dark-popup' })
        .setLngLat(e.lngLat)
        .setHTML(html)
        .addTo(this.map);
    });

    // ─── Citizen outage zone — hover tooltip élargi ───
    let citizenHoverPopup: maplibregl.Popup | null = null;

    const severityMeta: Record<string, { label: string; color: string }> = {
      critical: { label: 'Critique', color: '#b400ff' },
      high: { label: 'Élevé', color: '#c060ff' },
      medium: { label: 'Modéré', color: '#9b30e8' },
      low: { label: 'Faible', color: '#7a22c8' },
    };

    this.map.on('mousemove', LYR_CITIZEN_FILL, (e) => {
      if (!this.map || !e.features || e.features.length === 0) return;
      this.map.getCanvas().style.cursor = 'crosshair';

      const p = e.features[0].properties;
      if (!p) return;

      const sev = severityMeta[p.severity] ?? { label: p.severity, color: '#888' };
      const sevLevel: FmDotLevel = (p.severity === 'critical' || p.severity === 'high' || p.severity === 'medium' || p.severity === 'low') ? p.severity : 'info';
      let sources: string[];
      try { sources = Array.isArray(p.sources) ? p.sources : JSON.parse(p.sources ?? '[]'); } catch { sources = []; }

      const radiusKm = Number(p.radiusKm ?? 0).toFixed(1);
      const density = Number(p.density ?? 0).toFixed(2);
      const reports = Number(p.totalReports ?? 0);
      const updatedAt = p.createdAt ? new Date(p.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'n.d.';
      const areaKm2 = Math.round(Math.PI * Math.pow(Number(p.radiusKm ?? 0), 2));

      const html = `
        <div style="font-family:var(--font-sans,sans-serif);color:#e8e8ec;min-width:240px;max-width:300px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.1);">
            <span style="font-size:13px;font-weight:700;color:#fff;">${fmStatusDot(sevLevel)} Zone de coupures : ${sev.label}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;font-size:12px;margin-bottom:10px;">
            <div>
              <div style="color:#9898a8;font-size:10px;text-transform:uppercase;letter-spacing:.05em;">Signalements</div>
              <div style="font-size:16px;font-weight:800;color:${sev.color};">${reports}</div>
            </div>
            <div>
              <div style="color:#9898a8;font-size:10px;text-transform:uppercase;letter-spacing:.05em;">Densité</div>
              <div style="font-size:16px;font-weight:800;color:${sev.color};">${density}<span style="font-size:11px;font-weight:400;color:#9898a8;">/km²</span></div>
            </div>
            <div>
              <div style="color:#9898a8;font-size:10px;text-transform:uppercase;letter-spacing:.05em;">Rayon estimé</div>
              <div style="font-weight:600;">~${radiusKm} km</div>
            </div>
            <div>
              <div style="color:#9898a8;font-size:10px;text-transform:uppercase;letter-spacing:.05em;">Surface</div>
              <div style="font-weight:600;">~${areaKm2} km²</div>
            </div>
          </div>
          ${sources.length > 0 ? `<div style="font-size:10px;color:#9898a8;margin-bottom:5px;">Sources : ${sources.map((s: string) => `<span style="background:rgba(255,255,255,0.08);padding:1px 5px;border-radius:4px;">${s}</span>`).join(' ')}</div>` : ''}
          <div style="font-size:10px;color:#9898a8;">${fmIcon('hourglass')} Mis à jour ${updatedAt}</div>
        </div>`;

      if (!citizenHoverPopup) {
        citizenHoverPopup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          maxWidth: '320px',
          className: 'dark-popup',
          offset: 12,
        }).addTo(this.map);
      }
      citizenHoverPopup.setLngLat(e.lngLat).setHTML(html);
    });

    this.map.on('mouseleave', LYR_CITIZEN_FILL, () => {
      if (this.map) this.map.getCanvas().style.cursor = '';
      citizenHoverPopup?.remove();
      citizenHoverPopup = null;
    });

    // ─── IIP incidents — hover tooltip ───
    let iipHoverPopup: maplibregl.Popup | null = null;
    this.map.on('mousemove', LYR_IIP_CORE, (e) => {
      if (!this.map || !e.features || e.features.length === 0) return;
      this.map.getCanvas().style.cursor = 'crosshair';
      const p = e.features[0].properties;
      if (!p) return;

      const typeLabel = p.incidentType === 'transmission' ? 'Réseau HTB' : 'Production';
      const typeColor = p.incidentType === 'transmission' ? '#a0b4ff' : '#6c8cff';
      const statusLabel = p.status === 'active' ? '● Actif' : p.status === 'inactive' ? '◯ Terminé' : '⊘ Retiré';
      const statusColor = p.status === 'active' ? '#f97316' : p.status === 'inactive' ? '#6b7280' : '#6b7280';
      const startFmt = p.startDate ? new Date(p.startDate).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'n.d.';
      const endFmt   = p.endDate   ? new Date(p.endDate).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'n.d.';

      const html = `
        <div style="font-family:var(--font-sans,sans-serif);color:#e8e8ec;min-width:240px;max-width:320px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.1);">
            <span style="font-size:13px;font-weight:700;color:#fff;line-height:1.3;">${p.assetLabel ?? p.title}</span>
            <span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:${typeColor}22;color:${typeColor};white-space:nowrap;">${typeLabel}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:12px;">
            <span style="color:${statusColor};font-weight:600;">${statusLabel}</span>
            ${p.cause ? `<span style="color:#9898a8;">· ${p.cause}</span>` : ''}
            ${p.capacityMW ? `<span style="color:#9898a8;">· <strong style="color:#fff;">${p.capacityMW} MW</strong></span>` : ''}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:11px;color:#9898a8;margin-bottom:8px;">
            <div>Début <strong style="color:#e8e8ec;">${startFmt}</strong></div>
            <div>Fin prév. <strong style="color:#e8e8ec;">${endFmt}</strong></div>
          </div>
          <div style="font-size:10px;color:#6b7280;border-top:1px solid rgba(255,255,255,0.08);padding-top:6px;">IIP RTE · REMIT · Temps réel</div>
        </div>`;

      if (!iipHoverPopup) {
        iipHoverPopup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          maxWidth: '340px',
          className: 'dark-popup',
          offset: 14,
        }).addTo(this.map);
      }
      iipHoverPopup.setLngLat(e.lngLat).setHTML(html);
    });

    this.map.on('mouseleave', LYR_IIP_CORE, () => {
      if (this.map) this.map.getCanvas().style.cursor = '';
      iipHoverPopup?.remove();
      iipHoverPopup = null;
    });

    [LYR_POWER_FILL].forEach(lyr => {
      this.map!.on('mouseenter', lyr, () => { if (this.map) this.map.getCanvas().style.cursor = 'pointer'; });
      this.map!.on('mouseleave', lyr, () => { if (this.map) this.map.getCanvas().style.cursor = ''; });
    });
    this.map.on('click', LYR_POWER_FILL, (e) => {
      if (!this.map || !e.features || e.features.length === 0) return;
      const feat = e.features[0];
      const pStr = feat.properties?.powerOutage;
      let p;
      try {
        p = typeof pStr === 'string' ? JSON.parse(pStr) : pStr;
      } catch (e) {
        return;
      }
      if (!p) return;

      // Couleur identique à computePowerOutageStyle pour cohérence visuelle
      const count = p.offGridCount || 0;
      const deptColor = count >= 10000 ? '#EF4444' : count >= 5000 ? '#F97316' : count >= 1000 ? '#F59E0B' : '#EAB308';
      const pdlPct = Math.round((count / (p.totalPDL || 1)) * 100);
      const trendColor = p.trend === 'improving' ? '#34c759' : p.trend === 'worsening' ? '#ff3b30' : '#9898a8';
      const trendLabel = p.trend === 'improving' ? `${fmIcon('trending-down')} Amélioration` : p.trend === 'worsening' ? `${fmIcon('trending-up')} Aggravation` : '→ Stable';

      const html = `
        <div style="color:#e8e8ec; font-family:sans-serif; min-width:220px;">
          <h4 style="margin:0 0 4px; font-weight:700; font-size:15px; color:#fff; display:flex; justify-content:space-between; align-items:center;">
            ${p.departmentName || 'Département'} <span style="font-size:12px; font-weight:normal; color:#9898a8;">(${p.departmentCode})</span>
          </h4>
          <div style="margin:0 0 10px; font-size:12px; font-weight:600; color:${deptColor};">${fmIcon('zap')} Tension réseau électrique</div>
          <div style="font-size:13px; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
              <span style="color:#9898a8">PDL hors réseau :</span>
              <span style="font-weight:700; color:${deptColor};">${count.toLocaleString('fr-FR')}</span>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
              <span style="color:#9898a8">Part du département :</span>
              <span style="font-weight:600; color:${deptColor};">${pdlPct} %</span>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span style="color:#9898a8">Tendance :</span>
              <span style="font-weight:600; color:${trendColor};">${trendLabel}</span>
            </div>
          </div>
          ${p.eventCause ? `<p style="margin:8px 0 0; font-size:11px; color:#a1a1aa; border-top:1px solid rgba(255,255,255,0.06); padding-top:8px; line-height:1.5;"><i>${p.eventCause}</i></p>` : ''}
        </div>
      `;

      new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '300px', className: 'dark-popup' })
        .setLngLat(e.lngLat)
        .setHTML(html)
        .addTo(this.map);
    });

    // ─── Datacenter & IXP interactions ───
    [LYR_DC_CORE, LYR_IXP_CIRCLE].forEach(lyr => {
      this.map!.on('mouseenter', lyr, () => { if (this.map) this.map.getCanvas().style.cursor = 'pointer'; });
      this.map!.on('mouseleave', lyr, () => { if (this.map) this.map.getCanvas().style.cursor = ''; });
    });

    // Cluster click: zoom in to expand (Promise API — MapLibre v2+)
    [
      { cluster: LYR_DC_CLUSTER, src: SRC_DC },
      { cluster: LYR_IXP_CLUSTER, src: SRC_IXP },
    ].forEach(({ cluster, src }) => {
      this.map!.on('mouseenter', cluster, () => { if (this.map) this.map.getCanvas().style.cursor = 'pointer'; });
      this.map!.on('mouseleave', cluster, () => { if (this.map) this.map.getCanvas().style.cursor = ''; });
      this.map!.on('click', cluster, (e) => {
        if (!this.map || !e.features?.length) return;
        const clusterId = e.features[0].properties?.cluster_id as number;
        const coords = (e.features[0].geometry as GeoJSON.Point).coordinates as [number, number];
        const source = this.map.getSource(src) as maplibregl.GeoJSONSource;
        source.getClusterExpansionZoom(clusterId)
          .then(zoom => {
            const targetZoom = Math.max(zoom + 1, 9);
            this.map?.flyTo({ center: coords, zoom: targetZoom, duration: 700, essential: true });
          })
          .catch(() => {
            const fallbackZoom = Math.max((this.map?.getZoom() ?? 5) + 3, 9);
            this.map?.flyTo({ center: coords, zoom: fallbackZoom, duration: 700, essential: true });
          });
      });
    });

    this.map.on('click', LYR_DC_CORE, (e) => {
      if (!this.map || !e.features?.length) return;
      const p = e.features[0].properties ?? {};
      const incidents: Array<{ title: string; severity: string }> = (() => { try { return JSON.parse(p.incidents ?? '[]'); } catch { return []; } })();
      const html = buildDatacenterPopupHtml({
        name: String(p.name ?? 'Datacenter'),
        provider: String(p.provider ?? ''),
        region: String(p.region ?? ''),
        city: String(p.city ?? ''),
        address: String(p.address ?? ''),
        status: String(p.status ?? 'unknown'),
        incidents,
        operationalState: String(p.operationalState ?? ''),
        powerBand: String(p.powerBand ?? ''),
        source: String(p.source ?? ''),
        lastUpdated: String(p.lastUpdated ?? ''),
        realLng: Number(p.realLng ?? e.lngLat.lng),
        realLat: Number(p.realLat ?? e.lngLat.lat),
        offsetMeters: Number(p.offsetMeters ?? 0),
      });
      new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '280px', className: 'dark-popup' })
        .setLngLat(e.lngLat).setHTML(html).addTo(this.map);
    });

    this.map.on('click', LYR_IXP_CIRCLE, (e) => {
      if (!this.map || !e.features?.length) return;
      const p = e.features[0].properties ?? {};
      const stCol = p.status === 'operational' ? '#2DD4BF' : p.status === 'outage' ? '#0F766E' : '#14B8A6';
      const stLbl = p.status === 'operational' ? 'Opérationnel' : p.status === 'outage' ? 'En panne' : 'Dégradé';
      const realLng = Number(p.realLng ?? e.lngLat.lng);
      const realLat = Number(p.realLat ?? e.lngLat.lat);
      const offsetMeters = Number(p.offsetMeters ?? 0);
      const updatedLabel = p.lastUpdated ? new Date(String(p.lastUpdated)).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'n.d.';
      const html = `
        <div style="color:#e8e8ec;font-family:sans-serif;min-width:200px;">
          <h4 style="margin:0 0 2px;font-weight:700;font-size:14px;color:#fff;">${p.name ?? 'IXP'}</h4>
          <div style="font-size:11px;color:#6366f1;margin-bottom:10px;">Point d'échange Internet · ${p.city ?? ''}</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;">
            <span style="color:#9898a8">Statut :</span>
            <span style="font-weight:700;color:${stCol}">${stLbl}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;">
            <span style="color:#9898a8">Membres :</span>
            <span style="font-weight:600">${Number(p.peersCount ?? 0).toLocaleString('fr-FR')} opérateurs</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:13px;">
            <span style="color:#9898a8">Capacité :</span>
            <span style="font-weight:600">${p.speedGbps ?? 'n.d.'} Gbps</span>
          </div>
          <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px;margin-top:10px;font-size:11px;">
            <span style="color:#9898a8">Coord. réelle</span>
            <span>${realLat.toFixed(4)}, ${realLng.toFixed(4)}</span>
            <span style="color:#9898a8">Décalage affichage</span>
            <span>${offsetMeters > 0 ? `${Math.round(offsetMeters)} m` : 'Aucun'}</span>
            <span style="color:#9898a8">Mis à jour</span>
            <span>${updatedLabel}</span>
          </div>
          <div style="margin-top:8px;font-size:10px;color:#6b7280;border-top:1px solid rgba(255,255,255,0.06);padding-top:6px;">Source : PeeringDB</div>
        </div>`;
      new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '260px', className: 'dark-popup' })
        .setLngLat(e.lngLat).setHTML(html).addTo(this.map);
    });

    // ─── Internet / BGP outage interactions ───
    [LYR_NET_ISP, LYR_NET_ISP_RING, LYR_NET_IODA_CORE, LYR_NET_ISP_CLUSTER, LYR_NET_IODA_CLUSTER].forEach(lyr => {
      this.map!.on('mouseenter', lyr, () => { if (this.map) this.map.getCanvas().style.cursor = 'pointer'; });
      this.map!.on('mouseleave', lyr, () => { if (this.map) this.map.getCanvas().style.cursor = ''; });
    });

    // Clic sur un cluster ISP → zoom in pour dé-agréger
    this.map.on('click', LYR_NET_ISP_CLUSTER, (e) => {
      if (!this.map || !e.features?.length) return;
      const clusterId = e.features[0].properties?.cluster_id as number;
      const coords = (e.features[0].geometry as GeoJSON.Point).coordinates as [number, number];
      (this.map.getSource(SRC_NET_ISP) as maplibregl.GeoJSONSource)
        .getClusterExpansionZoom(clusterId)
        .then(zoom => { this.map?.flyTo({ center: coords, zoom: zoom + 0.5, duration: 600, essential: true }); })
        .catch(() => { this.map?.flyTo({ center: coords, zoom: (this.map.getZoom() ?? 5) + 2, duration: 600, essential: true }); });
    });

    // Clic sur un cluster IODA → zoom in pour dé-agréger
    this.map.on('click', LYR_NET_IODA_CLUSTER, (e) => {
      if (!this.map || !e.features?.length) return;
      const clusterId = e.features[0].properties?.cluster_id as number;
      const coords = (e.features[0].geometry as GeoJSON.Point).coordinates as [number, number];
      (this.map.getSource(SRC_NET_IODA) as maplibregl.GeoJSONSource)
        .getClusterExpansionZoom(clusterId)
        .then(zoom => { this.map?.flyTo({ center: coords, zoom: zoom + 0.5, duration: 600, essential: true }); })
        .catch(() => { this.map?.flyTo({ center: coords, zoom: (this.map.getZoom() ?? 5) + 2, duration: 600, essential: true }); });
    });

    this.map.on('click', LYR_NET_ISP, (e) => {
      if (!this.map || !e.features?.length) return;
      const p = e.features[0].properties ?? {};
      const visColor = p.status === 'outage' ? '#EF4444' : p.status === 'degraded' ? '#F59E0B' : '#10B981';
      const statusLabel = p.status === 'outage' ? 'Panne' : p.status === 'degraded' ? 'Dégradé' : 'Normal';
      const ixList: string[] = (() => { try { return JSON.parse(p.ixList ?? '[]'); } catch { return []; } })();
      const v4 = Number(p.prefixV4 ?? 0);
      const v6 = Number(p.prefixV6 ?? 0);
      const totalPfx = v4 + v6;
      const ipv6Pct = totalPfx > 0 ? Math.round((v6 / totalPfx) * 100) : 0;

      // Section helper
      const row = (label: string, value: string, valueColor = '') =>
        `<div style="display:flex;justify-content:space-between;margin-bottom:5px;font-size:12px;">
          <span style="color:#9898a8">${label}</span>
          <span style="font-weight:600;color:${valueColor || '#e8e8ec'}">${value}</span>
        </div>`;

      const html = `
        <div style="color:#e8e8ec;font-family:sans-serif;min-width:260px;max-width:300px;">
          <div style="margin-bottom:10px;">
            <div style="font-weight:700;font-size:15px;color:#fff;margin-bottom:2px;">${p.ispName ?? `AS${p.asn}`}</div>
            <div style="font-size:10px;color:#6366f1;">AS${p.asn} · ${p.networkType ?? 'Réseau'}</div>
          </div>

          <div style="background:${visColor}18;border:1px solid ${visColor}40;border-radius:8px;padding:8px 10px;margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:11px;color:${visColor};font-weight:700;text-transform:uppercase;">Statut BGP : ${statusLabel}</span>
              <span style="font-size:13px;font-weight:800;color:${visColor}">${p.visibility ?? 'n.d.'} %</span>
            </div>
            <div style="height:3px;background:rgba(255,255,255,0.08);border-radius:2px;margin-top:5px;overflow:hidden;">
              <div style="height:100%;width:${p.visibility ?? 100}%;background:${visColor};border-radius:2px;"></div>
            </div>
          </div>

          <div style="margin-bottom:10px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:6px;">Routage BGP</div>
            ${row('Préfixes actifs', `${Number(p.prefixCount ?? 0).toLocaleString('fr-FR')} / ${Number(p.prefixCountNormal ?? 0).toLocaleString('fr-FR')}`)}
            ${row('IPv4 annoncés', v4.toLocaleString('fr-FR'))}
            ${row('IPv6 annoncés', `${v6.toLocaleString('fr-FR')} (${ipv6Pct} %)`, ipv6Pct >= 30 ? '#10B981' : '#9898a8')}
            ${p.trafficEstimation ? row('Capacité estimée', p.trafficEstimation, '#a78bfa') : ''}
            ${row('Politique peering', p.peeringPolicy ?? 'N/A')}
          </div>

          ${ixList.length > 0 ? `
          <div style="margin-bottom:10px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:5px;">Points d'échange (IX)</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;">
              ${ixList.map(ix => `<span style="font-size:10px;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);border-radius:4px;padding:2px 6px;color:#a5b4fc;">${ix}</span>`).join('')}
            </div>
          </div>` : ''}

          ${(p.arcepFiber || p.mobile) ? `
          <div style="margin-bottom:10px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:6px;">Réseau FR (ARCEP)</div>
            ${p.arcepFiber ? row('Fibre (locaux éligibles)', p.arcepFiber, '#10B981') : ''}
            ${p.mobile && p.mobile !== 'N/A' ? row('Mobile', p.mobile) : ''}
          </div>` : ''}

          ${p.ipv6Label ? `
          <div style="margin-bottom:10px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:4px;">IPv6</div>
            <div style="font-size:11px;color:#6ee7b7;">${p.ipv6Label}</div>
          </div>` : ''}

          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);">
            ${p.lookingGlass ? `<a href="${p.lookingGlass}" target="_blank" rel="noopener" style="font-size:10px;color:#6366f1;text-decoration:none;">${fmIcon('search')} Looking Glass</a>` : ''}
            ${p.noc ? `<a href="mailto:${p.noc}" style="font-size:10px;color:#6b7280;text-decoration:none;">${fmIcon('mail')} NOC</a>` : ''}
            <span style="font-size:10px;color:#6b7280;margin-left:auto;">BGPView · ARCEP</span>
          </div>
        </div>`;
      new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '320px', className: 'dark-popup' })
        .setLngLat(e.lngLat).setHTML(html).addTo(this.map);
    });

    this.map.on('click', LYR_NET_IODA_CORE, (e) => {
      if (!this.map || !e.features?.length) return;
      const p = e.features[0].properties ?? {};
      const scoreNum = Number(p.score ?? 0);
      const scoreColor = scoreNum >= 80 ? '#EF4444' : scoreNum >= 50 ? '#F59E0B' : '#6366f1';
      const sources: string[] = (() => { try { return JSON.parse(p.datasources ?? '[]'); } catch { return []; } })();
      const durMin = Math.round(Number(p.duration ?? 0) / 60);
      const durStr = durMin >= 60 ? `${Math.floor(durMin / 60)}h${String(durMin % 60).padStart(2, '0')}` : `${durMin} min`;
      const html = `
        <div style="color:#e8e8ec;font-family:sans-serif;min-width:220px;">
          <h4 style="margin:0 0 4px;font-weight:700;font-size:14px;color:#fff;">${p.entityName ?? p.entityCode}</h4>
          <div style="font-size:11px;color:#6366f1;margin-bottom:10px;">Panne Internet · IODA / CAIDA</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;">
            <span style="color:#9898a8">Score IODA :</span>
            <span style="font-weight:700;color:${scoreColor}">${scoreNum.toFixed(0)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;">
            <span style="color:#9898a8">Durée :</span>
            <span style="font-weight:600">${p.isOngoing ? `${fmIcon('hourglass')} En cours` : durStr}</span>
          </div>
          ${sources.length ? `<div style="font-size:11px;color:#9898a8;margin-bottom:4px;">Signaux : ${sources.join(', ')}</div>` : ''}
          <div style="margin-top:8px;font-size:10px;color:#6b7280;border-top:1px solid rgba(255,255,255,0.06);padding-top:6px;">Source : IODA (Georgia Tech / CAIDA)</div>
        </div>`;
      new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '280px', className: 'dark-popup' })
        .setLngLat(e.lngLat).setHTML(html).addTo(this.map);
    });

    // ─── Enriched Energy Hover Tooltips ───
    const hideEnrichedHover = () => {
      if (this.map) this.map.getCanvas().style.cursor = '';
      this.hideEnrichedHoverPopup();
    };

    this.map.on('mouseenter', LYR_ENERGY_INFRA_CIRCLE, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mousemove', LYR_ENERGY_INFRA_CIRCLE, (e) => {
      if (!this.map || !e.features?.length) return;
      const p = e.features[0].properties || {};
      this.showEnrichedHoverPopup(e.lngLat, this.buildInfrastructureHoverHtml(p));
    });
    this.map.on('mouseleave', LYR_ENERGY_INFRA_CIRCLE, hideEnrichedHover);

    this.map.on('mouseenter', LYR_HYDRO_BACKBONE_CIRCLE, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mousemove', LYR_HYDRO_BACKBONE_CIRCLE, (e) => {
      if (!this.map || !e.features?.length) return;
      const p = e.features[0].properties || {};
      this.showEnrichedHoverPopup(e.lngLat, this.buildHydraulicHoverHtml(p));
    });
    this.map.on('mouseleave', LYR_HYDRO_BACKBONE_CIRCLE, hideEnrichedHover);

    this.map.on('mouseenter', LYR_WIND_TURBINE_CIRCLE, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mousemove', LYR_WIND_TURBINE_CIRCLE, (e) => {
      if (!this.map || !e.features?.length) return;
      const p = e.features[0].properties || {};
      this.showEnrichedHoverPopup(e.lngLat, this.buildEolienHoverHtml(p));
    });
    this.map.on('mouseleave', LYR_WIND_TURBINE_CIRCLE, hideEnrichedHover);

    this.map.on('mouseenter', LYR_WIND_PARK_CIRCLE, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mousemove', LYR_WIND_PARK_CIRCLE, (e) => {
      if (!this.map || !e.features?.length) return;
      const p = e.features[0].properties || {};
      this.showEnrichedHoverPopup(e.lngLat, this.buildEolienHoverHtml(p));
    });
    this.map.on('mouseleave', LYR_WIND_PARK_CIRCLE, hideEnrichedHover);

    this.map.on('mouseenter', LYR_GAS_TERMINALS, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mousemove', LYR_GAS_TERMINALS, (e) => {
      if (!this.map || !e.features?.length) return;
      const p = e.features[0].properties || {};
      this.showEnrichedHoverPopup(e.lngLat, this.buildGasHoverHtml(p));
    });
    this.map.on('mouseleave', LYR_GAS_TERMINALS, hideEnrichedHover);

    this.map.on('mouseenter', LYR_BIOMETHANE_SITES, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mousemove', LYR_BIOMETHANE_SITES, (e) => {
      if (!this.map || !e.features?.length) return;
      const p = e.features[0].properties || {};
      this.showEnrichedHoverPopup(e.lngLat, this.buildBiomethaneHoverHtml(p));
    });
    this.map.on('mouseleave', LYR_BIOMETHANE_SITES, () => {
      if (this.map) this.map.getCanvas().style.cursor = '';
      hideEnrichedHover();
    });

    this.map.on('mouseenter', LYR_GAS_STORAGES, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mousemove', LYR_GAS_STORAGES, (e) => {
      if (!this.map || !e.features?.length) return;
      const p = e.features[0].properties || {};
      this.showEnrichedHoverPopup(e.lngLat, this.buildGasHoverHtml(p));
    });
    this.map.on('mouseleave', LYR_GAS_STORAGES, hideEnrichedHover);

    this.map.on('mouseenter', LYR_GAS_PIR_MARKER, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mousemove', LYR_GAS_PIR_MARKER, (e) => {
      if (!this.map || !e.features?.length) return;
      const p = e.features[0].properties || {};
      const borderCode = String(p.borderCode ?? '');
      const stats = this.gasFlowStats.get(borderCode);
      if (stats) {
        // Tooltip enrichi via popup dédié (évite chevauchement avec enrichedHoverPopup)
        this.hideEnrichedHoverPopup();
        if (!this.gasFlowPopup) {
          this.gasFlowPopup = new maplibregl.Popup({
            closeButton: false, closeOnClick: false,
            offset: 14, maxWidth: '280px', className: 'dark-popup',
          });
        }
        this.gasFlowPopup.setLngLat(e.lngLat).setHTML(this.buildGasFlowTooltipHtml(stats)).addTo(this.map);
      } else {
        this.showEnrichedHoverPopup(e.lngLat, this.buildGasPirHoverHtml(p));
      }
    });
    this.map.on('mouseleave', LYR_GAS_PIR_MARKER, () => {
      if (this.map) this.map.getCanvas().style.cursor = '';
      this.gasFlowPopup?.remove();
      this.gasFlowPopup = null;
      this.hideEnrichedHoverPopup();
    });

    // Hover sur les arcs PIR (même logique que le marker)
    const showGasArcHover = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!this.map || !e.features?.length) return;
      const p = e.features[0].properties || {};
      const borderCode = String(p.borderCode ?? '');
      const stats = this.gasFlowStats.get(borderCode);
      if (!stats) return;
      this.hideEnrichedHoverPopup();
      this.energyRegionPopup?.remove(); this.energyRegionPopup = null;
      if (!this.gasFlowPopup) {
        this.gasFlowPopup = new maplibregl.Popup({
          closeButton: false, closeOnClick: false,
          offset: 14, maxWidth: '280px', className: 'dark-popup',
        });
      }
      this.gasFlowPopup.setLngLat(e.lngLat).setHTML(this.buildGasFlowTooltipHtml(stats)).addTo(this.map);
    };
    this.map.on('mouseenter', LYR_GAS_PIR_ARC, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'crosshair';
    });
    this.map.on('mousemove', LYR_GAS_PIR_ARC, showGasArcHover);
    this.map.on('mouseleave', LYR_GAS_PIR_ARC, () => {
      if (this.map) this.map.getCanvas().style.cursor = '';
      this.gasFlowPopup?.remove();
      this.gasFlowPopup = null;
    });

    this.map.on('mouseenter', LYR_METRO_LOAD_CIRCLE, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mousemove', LYR_METRO_LOAD_CIRCLE, (e) => {
      if (!this.map || !e.features?.length) return;
      const p = e.features[0].properties || {};
      this.showEnrichedHoverPopup(e.lngLat, this.buildMetropoleHoverHtml(p));
    });
    this.map.on('mouseleave', LYR_METRO_LOAD_CIRCLE, hideEnrichedHover);

    // Symbol layers: écouter directement sur le layer + bbox élargie pour near-miss
    this.map.on('mouseenter', LYR_OIL_REFINERIES, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mousemove', LYR_OIL_REFINERIES, (e) => {
      if (!this.map) return;
      // bbox 28px autour du curseur pour couvrir toute la surface du triangle
      const r = 28;
      const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
        [e.point.x - r, e.point.y - r],
        [e.point.x + r, e.point.y + r],
      ];
      const feats = this.map.queryRenderedFeatures(bbox, { layers: [LYR_OIL_REFINERIES] });
      const p = feats[0]?.properties ?? e.features?.[0]?.properties ?? {};
      if (Object.keys(p).length === 0) return;
      this.showEnrichedHoverPopup(e.lngLat, this.buildOilRefineryHoverHtml(p));
    });
    this.map.on('mouseleave', LYR_OIL_REFINERIES, hideEnrichedHover);

    this.map.on('mouseenter', LYR_OIL_DEPOTS_HIT, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mousemove', LYR_OIL_DEPOTS_HIT, (e) => {
      if (!e.features?.length) return;
      const p = e.features[0].properties || {};
      this.showEnrichedHoverPopup(e.lngLat, this.buildOilDepotHoverHtml(p));
    });
    this.map.on('mouseleave', LYR_OIL_DEPOTS_HIT, hideEnrichedHover);

    this.map.on('mouseenter', LYR_OIL_PIPELINES_HIT, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mousemove', LYR_OIL_PIPELINES_HIT, (e) => {
      if (!e.features?.length) return;
      const p = e.features[0].properties || {};
      this.showEnrichedHoverPopup(e.lngLat, this.buildOilPipelineHoverHtml(p));
    });
    this.map.on('mouseleave', LYR_OIL_PIPELINES_HIT, hideEnrichedHover);

    this.map.on('mouseenter', LYR_OIL_FLOW_MARKER_HIT, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mousemove', LYR_OIL_FLOW_MARKER_HIT, (e) => {
      if (!e.features?.length) return;
      const p = e.features[0].properties as Record<string, unknown>;
      this.oilHoveredFlowName = String(p.name ?? '');
      this.updateOilArcHighlight();
      this.showEnrichedHoverPopup(e.lngLat, this.buildOilFlowHoverHtml(p));
    });
    this.map.on('mouseleave', LYR_OIL_FLOW_MARKER_HIT, () => {
      this.oilHoveredFlowName = null;
      this.updateOilArcHighlight();
      hideEnrichedHover();
    });

    this.map.on('mouseenter', LYR_OIL_FLOW_ARC_HIT, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mousemove', LYR_OIL_FLOW_ARC_HIT, (e) => {
      if (!e.features?.length) return;
      const p = e.features[0].properties as Record<string, unknown>;
      this.oilHoveredFlowName = String(p.name ?? '');
      this.updateOilArcHighlight();
      this.showEnrichedHoverPopup(e.lngLat, this.buildOilFlowHoverHtml(p));
    });
    this.map.on('mouseleave', LYR_OIL_FLOW_ARC_HIT, () => {
      this.oilHoveredFlowName = null;
      this.updateOilArcHighlight();
      hideEnrichedHover();
    });

    // ─── Crues : curseur sur un tronçon ; infobulle de initEnvironmentInteractions ; clic : images satellite avant / après (Sentinel-2) ───
    this.map.on('mouseenter', LYR_FLOODS, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', LYR_FLOODS, () => {
      if (this.map) this.map.getCanvas().style.cursor = '';
    });
    this.map.on('click', LYR_FLOODS, (e) => {
      if (!this.map || !e.features || e.features.length === 0) return;
      const feat = e.features[0];
      const name = String(feat.properties?.name ?? 'Tronçon Vigicrues');
      // Emprise du tracé publié par Vigicrues, pour le lien EO Browser et le panneau satellite.
      const geom = feat.geometry;
      const hasLineGeom = geom !== null && (geom.type === 'LineString' || geom.type === 'MultiLineString');
      const aoBbox: [number, number, number, number] = hasLineGeom
        ? computeFloodSegmentBbox(geom as LineString | MultiLineString)
        : [e.lngLat.lng - 0.05, e.lngLat.lat - 0.05, e.lngLat.lng + 0.05, e.lngLat.lat + 0.05];
      const eoBrowserUrl = buildEoBrowserUrl(aoBbox, 'sentinel-2-l2a');
      const ctaHtml = this.onSatelliteView
        ? `<button class="satellite-cta-btn" type="button" data-action="satellite-panel">Avant / après</button>`
        : `<a class="satellite-cta-btn" href="${eoBrowserUrl}" target="_blank" rel="noopener noreferrer">Avant / après ${fmIcon('external-link')}</a>`;
      this.hideEnvironmentHover();
      this.fitBounds(aoBbox, 80);
      const popup = new maplibregl.Popup({
        closeButton: true, closeOnClick: true, maxWidth: '300px', className: 'dark-popup',
      })
        .setLngLat(e.lngLat)
        .setHTML(`<div class="hm-tip"><b>${escapeHtml(name)}</b><div class="hm-sub">Vigicrues · images satellite du tronçon</div>${ctaHtml}</div>`)
        .addTo(this.map);
      if (this.onSatelliteView) {
        const button = popup.getElement().querySelector<HTMLElement>('[data-action="satellite-panel"]');
        button?.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.onSatelliteView?.({
            bbox: aoBbox,
            sourceType: 'flood',
            title: name,
            geometry: hasLineGeom ? geom as LineString | MultiLineString : undefined,
            preferredCollection: 'sentinel-2-l2a',
          });
          popup.remove();
        });
      }
    });

    // ─── Vigilance : curseur sur un département en vigilance ; infobulle et mise en avant de initEnvironmentInteractions ───
    this.map.on('mousemove', LYR_WEATHER_FILL, (e) => {
      if (!this.map) return;
      const hasAlert = e.features?.[0]?.properties?.hasAlert === true;
      this.map.getCanvas().style.cursor = hasAlert ? 'pointer' : '';
      if (!hasAlert) this.previewWeatherDepartment(null);
    });
    this.map.on('mouseleave', LYR_WEATHER_FILL, () => {
      if (this.map) this.map.getCanvas().style.cursor = '';
      this.previewWeatherDepartment(null);
    });

    // ─── Fuel tension department interactions ───
    this.map.on('mouseenter', LYR_FUEL_TENSION_FILL, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', LYR_FUEL_TENSION_FILL, () => {
      if (this.map) this.map.getCanvas().style.cursor = '';
      this.fuelTensionHoverPopup?.remove();
      this.clearFuelTensionHoverState();
    });
    this.map.on('mousemove', LYR_FUEL_TENSION_FILL, (e) => {
      if (!this.map || !e.features || e.features.length === 0) return;

      const feature = e.features[0];
      const properties = feature.properties ?? {};
      const code = String(properties.code ?? '');
      const departmentName = String(properties.nom ?? properties.name ?? 'Département');
      const tensionLevel = String(properties.tensionLevel ?? 'LOW');
      const stationCount = Number(properties.stationCount ?? 0);
      const anomalyShare = Number(properties.anomalyShare ?? 0);
      const avgUpdateAgeMinutes = Number(properties.avgUpdateAgeMinutes ?? Number.NaN);
      const deltaPrice7d = Number(properties.deltaPrice7d ?? Number.NaN);
      const freshnessBadge = String(properties.freshnessBadge ?? DATA_FRESHNESS_LABELS.TEMPS_REEL);
      const lineColor = String(properties.lineColor ?? '#EF4444');

      const deltaHtml = Number.isFinite(deltaPrice7d)
        ? `${deltaPrice7d > 0 ? '+' : ''}${deltaPrice7d.toFixed(1)} cts/L`
        : 'n.d.';
      const freshnessHtml = Number.isFinite(avgUpdateAgeMinutes)
        ? avgUpdateAgeMinutes < 60 ? `${Math.round(avgUpdateAgeMinutes)} min`
          : avgUpdateAgeMinutes < 24 * 60 ? `${(avgUpdateAgeMinutes / 60).toFixed(1)} h`
          : `${(avgUpdateAgeMinutes / (24 * 60)).toFixed(1)} j`
        : 'n.d.';

      const html = `
        <div style="color:#e8e8ec; font-family:sans-serif; min-width:230px; padding:4px;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding-bottom:8px; margin-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.10);">
            <div style="font-size:10px; letter-spacing:0.08em; text-transform:uppercase; color:#FBBF24; font-weight:800;">Tension carburants</div>
            <div style="width:8px; height:8px; border-radius:999px; background:${lineColor}; box-shadow:0 0 12px ${lineColor}; flex-shrink:0;"></div>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:8px;">
            <div>
              <strong style="font-size:14px; color:#fff;">${escapeHtml(departmentName)}</strong>
              <div style="font-size:11px; color:#9898a8;">Département ${escapeHtml(code)}</div>
            </div>
            <span style="font-size:10px; padding:2px 8px; border-radius:999px; font-weight:700; color:#fff; background:${lineColor};">${escapeHtml(tensionLevel)}</span>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <div style="background:rgba(255,255,255,0.06); border-radius:6px; padding:6px;">
              <div style="font-size:10px; color:#9898a8;">Delta 7j</div>
              <div style="font-size:12px; color:#fff; font-weight:700;">${deltaHtml}</div>
            </div>
            <div style="background:rgba(255,255,255,0.06); border-radius:6px; padding:6px;">
              <div style="font-size:10px; color:#9898a8;">Anomalies</div>
              <div style="font-size:12px; color:#fff; font-weight:700;">${anomalyShare.toFixed(1)}%</div>
            </div>
            <div style="background:rgba(255,255,255,0.06); border-radius:6px; padding:6px;">
              <div style="font-size:10px; color:#9898a8;">Stations</div>
              <div style="font-size:12px; color:#fff; font-weight:700;">${stationCount}</div>
            </div>
            <div style="background:rgba(255,255,255,0.06); border-radius:6px; padding:6px;">
              <div style="font-size:10px; color:#9898a8;">Fraîcheur</div>
              <div style="font-size:12px; color:#fff; font-weight:700;">${freshnessBadge} · ${freshnessHtml}</div>
            </div>
          </div>
        </div>
      `;

      if (!this.fuelTensionHoverPopup) {
        this.fuelTensionHoverPopup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 16,
          maxWidth: '340px',
          className: 'dark-popup',
        });
      }
      this.fuelTensionHoverPopup.setLngLat(e.lngLat).setHTML(html).addTo(this.map);

      if (this._lastHoveredFuelDeptId !== null && this._lastHoveredFuelDeptId !== code) {
        this.map.setFeatureState({ source: SRC_FUEL_TENSION, id: this._lastHoveredFuelDeptId }, { hover: false });
      }
      this.map.setFeatureState({ source: SRC_FUEL_TENSION, id: code }, { hover: true });
      this._lastHoveredFuelDeptId = code;
    });

    // ─── Energy Region Interactions (tooltip on hover) ───
    const co2Color = (v: number) => v < 100 ? '#34c759' : v < 300 ? '#ff9500' : '#ff3b30';
    const fmtMW = (mw: number) => mw >= 1000 ? `${(mw / 1000).toFixed(1)} GW` : `${Math.round(mw)} MW`;
    const fmtDelta = (p: number) => `${p >= 0 ? '+' : ''}${p.toFixed(1)} %`;
    const row = (label: string, value: string, valueColor = '#e8e8ec') =>
      `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;padding:2px 0;">` +
      `<span style="color:#9898a8;">${label}</span>` +
      `<span style="color:${valueColor};font-weight:500;">${value}</span></div>`;
    const sep = `<div style="border-top:1px solid rgba(255,255,255,0.08);margin:6px 0;"></div>`;
    const sectionLabel = (txt: string) =>
      `<div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#666;margin-bottom:3px;">${txt}</div>`;

    this.map.on('mouseenter', LYR_POWER_REGION_FILL, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'crosshair';
    });
    this.map.on('mouseleave', LYR_POWER_REGION_FILL, () => {
      if (this.map) this.map.getCanvas().style.cursor = '';
      this.energyRegionPopup?.remove();
      this.energyRegionPopup = null;
    });
    this.map.on('mousemove', LYR_POWER_REGION_FILL, (e) => {
      if (!this.map || !e.features?.length) return;
      // Arc or gas feature takes priority over the region fill
      const overrideFeats = this.map.queryRenderedFeatures(e.point, {
        layers: [LYR_INTERCONN_HITAREA, LYR_GAS_TERMINALS, LYR_GAS_STORAGES, LYR_GAS_PIR_MARKER, LYR_HYDRO_BACKBONE_CIRCLE],
      });
      if (overrideFeats.length) {
        this.energyRegionPopup?.remove();
        this.energyRegionPopup = null;
        return;
      }
      const code = String(e.features[0].properties?.code ?? '');
      const s = this.energyRegionStats.get(code);
      if (!s) return;

      const p = s.production;
      const total = p.total || 1;
      // Écowatt est un signal NATIONAL (RTE) : dernier `official` reçu par updateEnergy, jamais
      // dérivé des données de la région survolée.
      const natLevel = ecowattToday(this.lastEcowattOfficial, Date.now());
      const natLabel = natLevel ? ecowattLevelLabel(natLevel) : 'indisponible';
      const natColor = natLevel === 'red' ? '#ff3b30' : natLevel === 'orange' ? '#ff9500' : natLevel === 'green' ? '#34c759' : '#888';
      const deltaColor = s.consumptionDeltaPct <= 0 ? '#34c759' : '#ff3b30';

      const prodRows: [string, number][] = [
        [`${fmIcon('atom')} Nucléaire`, p.nuclear],
        [`${fmIcon('droplet')} Hydraulique`, p.hydro],
        [`${fmIcon('wind')} Éolien`, p.wind],
        [`${fmIcon('sun')} Solaire`, p.solar],
        [`${fmIcon('flame')} Thermique`, p.gas],
      ].filter(([, v]) => (v as number) > 0) as [string, number][];

      const prodRowsHTML = prodRows.map(([lbl, mw]) =>
        row(lbl, `${fmtMW(mw)} (${((mw / total) * 100).toFixed(0)} %)`)
      ).join('');

      const html = `
        <div style="color:#e8e8ec;font-family:sans-serif;min-width:200px;padding:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px;">
            <strong style="font-size:13px;color:#fff;">${s.regionName}</strong>
            <span style="font-size:10px;color:#666;">${formatUpdateTime(s.updatedAt)}</span>
          </div>
          ${row('Écowatt (signal national RTE)', natLabel, natColor)}
          ${sep}
          ${sectionLabel('Consommation')}
          ${row('Actuelle', fmtMW(s.consumptionMW))}
          ${row('Vs J-1', fmtDelta(s.consumptionDeltaPct), deltaColor)}
          ${sep}
          ${sectionLabel(`Production : ${fmtMW(p.total)}`)}
          ${prodRowsHTML}
          ${row('Bas-carbone', `${s.lowCarbonPct.toFixed(0)} %`, '#34c759')}
          ${sep}
          ${row(`${fmIcon('zap')} Intensité CO₂`, `${Math.round(s.carbonIntensity)} gCO₂/kWh`, co2Color(s.carbonIntensity))}
        </div>`;

      if (!this.energyRegionPopup) {
        this.energyRegionPopup = new maplibregl.Popup({
          closeButton: false, closeOnClick: false,
          offset: 16, maxWidth: '260px', className: 'dark-popup',
        });
      }
      this.energyRegionPopup.setLngLat(e.lngLat).setHTML(html).addTo(this.map);
    });

    // ─── Energy Flow (Arc) Interactions ───
    const FLOW_COLORS: Record<string, string> = { export: '#34c759', import: '#ff3b30', balanced: '#8e8e93' };
    const FLOW_LABELS: Record<string, string> = { export: `Export ${fmIcon('trending-up')}`, import: `Import ${fmIcon('trending-down')}`, balanced: `Équilibré ${fmIcon('arrow-left-right')}` };
    const utilizationBar = (pct: number, color: string) =>
      `<div style="height:4px;background:rgba(255,255,255,0.1);border-radius:2px;margin-top:4px;overflow:hidden;">` +
      `<div style="width:${Math.min(pct, 100).toFixed(0)}%;height:100%;background:${color};border-radius:2px;"></div></div>`;
    const fmtMWh = (mwh: number) =>
      Math.abs(mwh) >= 1000 ? `${(mwh / 1000).toFixed(2)} TWh` : `${Math.round(mwh)} MWh`;

    const showFlowHover = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!this.map || !e.features?.length) return;
      const country = String(e.features[0].properties?.country ?? '');
      const flowId = DeckGLMap.COUNTRY_TO_FLOW_ID[country];
      const f = flowId ? this.energyFlowStats.get(flowId) : undefined;
      if (!f) return;
      // Dismiss gas/infra tooltip so flow arc never stacks with enriched
      this.hideEnrichedHoverPopup();

      const color = FLOW_COLORS[f.direction] ?? '#8e8e93';
      const absMW = Math.abs(f.powerMW);
      const dailyDelta = f.dailyBalanceMWh - f.dailyBalancePrevMWh;
      const deltaColor = dailyDelta >= 0 ? '#34c759' : '#ff3b30';
      const deltaSign = dailyDelta >= 0 ? '+' : '';

      // Sparkline 7 jours (vide si historique pas encore chargé)
      // éCO2mix : >0 = import INTO France. Sparkline convention : >0 = export FR = vert.
      // On inverse le signe pour aligner les deux : export FR affiché en vert, import en rouge.
      const rawSeries = flowId ? (this.energyBorderHistory.get(flowId) ?? []) : [];
      const series = rawSeries.map(v => -v);
      const sparkline = series.length > 2
        ? `${sep}
           <div style="margin-top:2px;">
             <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#666;margin-bottom:4px;">7 derniers jours</div>
             ${buildSparklineSVG(series, { width: 220, height: 44 })}
             <div style="display:flex;justify-content:space-between;font-size:9px;color:#555;margin-top:2px;">
               <span>J-7</span><span>↑ export · ↓ import</span><span>Maintenant</span>
             </div>
           </div>`
        : '';

      const html = `
        <div style="color:#e8e8ec;font-family:sans-serif;min-width:220px;padding:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
            <strong style="font-size:13px;color:#fff;">${f.label}</strong>
            <span style="font-size:11px;padding:2px 7px;border-radius:4px;font-weight:700;color:#000;background:${color};">${FLOW_LABELS[f.direction]}</span>
          </div>
          ${sectionLabel('Puissance temps réel')}
          ${row('Actuelle', absMW >= 1000 ? `${(absMW / 1000).toFixed(2)} GW` : `${Math.round(absMW)} MW`, color)}
          ${row('Capacité NTC', f.capacityMW >= 1000 ? `${(f.capacityMW / 1000).toFixed(1)} GW` : `${f.capacityMW} MW`)}
          ${row('Utilisation', `${f.utilizationPct.toFixed(0)} %`)}
          ${utilizationBar(f.utilizationPct, color)}
          ${sep}
          ${sectionLabel('Solde journalier')}
          ${row('J en cours', fmtMWh(f.dailyBalanceMWh))}
          ${row('Vs veille', `${deltaSign}${fmtMWh(dailyDelta)}`, deltaColor)}
          ${sparkline}
          ${f.summary ? `${sep}<div style="font-size:11px;color:#9898a8;font-style:italic;line-height:1.4;">${escapeHtml(f.summary)}</div>` : ''}
          ${formatUpdateTime(f.updatedAt) !== '-' ? `<div style="font-size:10px;color:#555;margin-top:6px;">Mis à jour ${formatUpdateTime(f.updatedAt)}</div>` : ''}
        </div>`;

      if (!this.energyFlowPopup) {
        this.energyFlowPopup = new maplibregl.Popup({
          closeButton: false, closeOnClick: false,
          offset: 16, maxWidth: '280px', className: 'dark-popup',
        });
      }
      this.energyFlowPopup.setLngLat(e.lngLat).setHTML(html).addTo(this.map);
    };

    this.map.on('mouseenter', LYR_INTERCONN_HITAREA, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'crosshair';
      // Close region popup when entering arc hit area
      this.energyRegionPopup?.remove();
      this.energyRegionPopup = null;
    });
    this.map.on('mouseleave', LYR_INTERCONN_HITAREA, () => {
      if (this.map) this.map.getCanvas().style.cursor = '';
      this.energyFlowPopup?.remove();
      this.energyFlowPopup = null;
    });
    this.map.on('mousemove', LYR_INTERCONN_HITAREA, showFlowHover);

    // ─── Sites de défense : curseur ; infobulle échappée de initSovereigntyInteractions ; clic : fiche du site (onMilitaryBaseClick) ───
    this.map.on('mouseenter', LYR_MILITARY_BASES_CIRCLE, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', LYR_MILITARY_BASES_CIRCLE, () => {
      if (this.map) this.map.getCanvas().style.cursor = '';
    });
    this.map.on('click', LYR_MILITARY_BASES_CIRCLE, (e) => {
      if (!this.map || !e.features || e.features.length === 0) return;
      const feat = e.features[0];
      const baseId = feat.properties?.id as string | undefined;
      if (!baseId || !this.onMilitaryBaseClick) return;
      const base = this.militaryBasesById.get(baseId);
      if (!base) return;
      this.militaryTooltip?.remove();
      this.militaryTooltip = null;
      const pt = this.map.project(e.lngLat);
      this.onMilitaryBaseClick(base, pt.x, pt.y);
    });

    // ─── Civil Air Traffic interactions ───
    // Hover events are handled directly by DeckGL's IconLayer `onHover` handler.


    // ─── Câbles (Connectivité) : curseur ; infobulle et clic de initSovereigntyInteractions (câbles du Shom et d'OpenStreetMap) ───
    for (const layerId of [LYR_SUBMARINE_CABLES_HITAREA, LYR_SUBMARINE_CABLES_LANDING]) {
      this.map.on('mouseenter', layerId, () => {
        if (this.map) this.map.getCanvas().style.cursor = 'pointer';
      });
      this.map.on('mouseleave', layerId, () => {
        if (this.map) this.map.getCanvas().style.cursor = '';
      });
    }

    // Track view state
    this.map.on('moveend', () => {
      if (!this.map) return;
      const c = this.map.getCenter();
      this.viewState = {
        longitude: c.lng, latitude: c.lat,
        zoom: this.map.getZoom(), pitch: this.map.getPitch(), bearing: this.map.getBearing(),
      };
      // Avions : icônes à tous les zooms ; sous le zoom 7, une animation en cours s'arrête sur les positions du dernier relevé.
      if (this.viewState.zoom < AIR_TWEEN_MIN_ZOOM && this.civilAirAnimFrame !== null) {
        this.stopCivilAirTween();
        this.scheduleOverlayUpdate();
      }
      this.onViewChange?.(this.viewState);
    });

    // ═══════════════════════════════════════════════════════════════
    // PULSE OVERLAY (CSS animations for critical/high alerts)
    // ═══════════════════════════════════════════════════════════════
    this.initPulseOverlay();
    // Halo des câbles : animé seulement quand la couche Connectivité est visible (setLayerVisibility, audit 30).

    // Update pulse markers on map move — throttled via requestAnimationFrame
    // so DOM style updates happen at most once per frame (≤ 16 ms) instead of
    // firing on every pixel of a pan gesture.
    let pulseRafId: number | null = null;
    const schedulePulseUpdate = (): void => {
      if (pulseRafId !== null) return;
      pulseRafId = requestAnimationFrame(() => {
        pulseRafId = null;
        this.updatePulseMarkerPositions();
      });
    };
    this.map.on('move', schedulePulseUpdate);
    this.map.on('zoom', schedulePulseUpdate);

    // Couches santé au-dessus des autres remplissages : contours, marqueurs, puis les sites d'urgences.
    try {
      // Même ordre que le survol (HEALTH_HOVER_LAYERS en est l'inverse) : la couche vue au-dessus répond.
      for (const id of HEALTH_LAYER_ORDER) this.map.moveLayer(id);
    } catch {
      // Ordre des couches pas encore réglable.
    }

    // ═══════════════════════════════════════════════════════════════
    // DECK.GL OVERLAY (dynamic traffic layers)
    // ═══════════════════════════════════════════════════════════════

    this.deckOverlay = new MapboxOverlay({
      interleaved: false,  // Separate canvas on top (required for visibility)
      layers: this.buildAisLayers(),
    });
    this.map.addControl(this.deckOverlay as unknown as maplibregl.IControl);

    // Force deck canvas z-index - keep pointerEvents: none so map interaction works
    setTimeout(() => {
      const canvases = this.container.querySelectorAll('canvas');
      if (canvases.length > 1) {
        const deckCanvas = canvases[1] as HTMLCanvasElement;
        deckCanvas.style.zIndex = '10';
        // pointerEvents stays 'none' - Deck.gl handles picking internally
      }
    }, 100);

  }

  /**
   * Build Deck.gl layers for dynamic traffic overlays.
   * WorldMonitor uses Deck.gl for dynamic feeds; align road incidents and civil air traffic here too.
   */
  private buildAisLayers() {
    const maritimeDeckOpacity =
      this.legendHoverCategory == null
        ? 1
        : this.legendHoverCategory === 'trafficMaritime'
          ? 1
          : ['trafficRoad', 'trafficAir', 'trafficRail', 'health', 'healthApl', 'healthOscour', 'hospitals'].includes(this.legendHoverCategory)
            ? 0.15
            : 1;
    const airDeckOpacity =
      this.legendHoverCategory == null
        ? 1
        : this.legendHoverCategory === 'trafficAir'
          ? 1
          : ['trafficRoad', 'trafficMaritime', 'trafficRail', 'health', 'healthApl', 'healthOscour', 'hospitals'].includes(this.legendHoverCategory)
            ? 0.15
            : 1;

    const getShipTypeNumber = (d: AisShipData): number => {
      const raw = (d.shipType ?? (d as { ShipType?: unknown }).ShipType ?? (d as { type?: unknown }).type);
      const value = raw == null ? NaN : Number(raw);
      return Number.isFinite(value) ? value : 0;
    };
    // Teinte d'un navire : son type déclaré, même classement que les comptes du serveur et la légende (traffic-legend.ts) ;
    // navire survolé ou choisi : teintes propres.
    const getAisIconColor = (d: AisShipData): string => {
      if (d.mmsi && d.mmsi === this._highlightedMmsi) return '#ffffff';
      if (d.mmsi && d.mmsi === this._selectedShipMmsi) return '#5ac8fa';
      return vesselHex(getShipTypeNumber(d), d.navStatus);
    };
    // Sillage : teinte du type, plus discrète ; type inconnu en gris léger.
    const getAisTrailColor = (d: AisShipData): [number, number, number, number] => {
      const hex = vesselHex(getShipTypeNumber(d), d.navStatus);
      const alpha = hex === VESSEL_TYPE_HEX.inconnu ? 120 : 180;
      return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), alpha];
    };
    const getAisSize = (d: AisShipData): number => {
      if (d.mmsi && d.mmsi === this._highlightedMmsi) return 22;
      if (d.mmsi && d.mmsi === this._selectedShipMmsi) return 18;
      return 14;
    };
    const getAisAngle = (d: AisShipData): number => this.getAisDeckAngle(d);
    const maritimeLabelData = this.getAisLabelData();
    const maritimeTrailData = this.getAisTrailData();
    return [
      new PathLayer<AisShipData>({
        id: 'deck-ais-trails',
        data: maritimeTrailData,
        visible: this.globalTrafficVisible,
        opacity: maritimeDeckOpacity * 0.5,
        coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        getPath: (d: AisShipData) => (d.trail ?? []) as [number, number][],
        getColor: getAisTrailColor,
        getWidth: 1.5,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        widthMaxPixels: 3,
        updateTriggers: {
          getPath: this.globalTrafficData,
          getColor: this.globalTrafficData,
        },
      }),
      new IconLayer({
        id: 'deck-ais-traffic',
        data: this.globalTrafficData,
        visible: this.globalTrafficVisible,
        opacity: maritimeDeckOpacity,
        coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        getPosition: (d: AisShipData) => [Number(d.lon), Number(d.lat)],
        getIcon: (d: AisShipData) => this.getAisIconDef(getAisIconColor(d)),
        getColor: () => [255, 255, 255, 255],
        getSize: getAisSize,
        getAngle: getAisAngle,
        sizeUnits: 'pixels',
        sizeMinPixels: 10,
        sizeMaxPixels: 26,
        billboard: true,
        pickable: true,
        onHover: (info) => this.handleAisHover(info),
        parameters: { depthTest: false },
        updateTriggers: {
          getPosition: this.globalTrafficData,
          getColor: [this.globalTrafficData, this._highlightedMmsi, this._selectedShipMmsi],
          getSize: [this.globalTrafficData, this._highlightedMmsi, this._selectedShipMmsi],
          getAngle: this.globalTrafficData,
          getIcon: [this.globalTrafficData, this._highlightedMmsi, this._selectedShipMmsi],
        },
      }),
      new TextLayer<AisShipData>({
        id: 'deck-ais-traffic-labels',
        data: maritimeLabelData,
        visible: this.globalTrafficVisible,
        opacity: maritimeDeckOpacity,
        coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        getPosition: (d: AisShipData) => [Number(d.lon), Number(d.lat)],
        getText: (d: AisShipData) => d.name,
        getColor: (d: AisShipData) => {
          if (d.mmsi && d.mmsi === this._selectedShipMmsi) return [90, 200, 250, 255];
          if (d.mmsi && d.mmsi === this._highlightedMmsi) return [255, 255, 255, 255];
          return [214, 222, 235, 230];
        },
        getSize: (d: AisShipData) => (d.mmsi === this._selectedShipMmsi ? 13 : this.viewState.zoom >= 10 ? 11 : 10),
        getPixelOffset: [0, 16],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'top',
        billboard: true,
        fontFamily: 'IBM Plex Sans, sans-serif',
        characterSet: 'auto',
        background: false,
        outlineWidth: 2,
        outlineColor: [10, 12, 18, 220],
        updateTriggers: {
          getPosition: maritimeLabelData,
          getText: maritimeLabelData,
          getColor: [maritimeLabelData, this._highlightedMmsi, this._selectedShipMmsi],
          getSize: [maritimeLabelData, this._highlightedMmsi, this._selectedShipMmsi, this.viewState.zoom],
        },
      }),
      // OSINT: Civil air traffic only (military flights shown in DÉFENSE layer)
      // Uses tweened positions for smooth animation between snapshots
      new IconLayer<AirTrafficFlight>({
        id: 'deck-air-traffic',
        data: this.civilAirTrafficFlights,
        visible: this.airTrafficVisible,
        opacity: airDeckOpacity,
        coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        getPosition: (d: AirTrafficFlight) => this.projectAirTrafficPosition(d),
        // Couleur selon l'altitude (tranches de traffic-legend.ts, une icône mise en cache par couleur).
        getIcon: (d: AirTrafficFlight) => this.getAirTrafficIconDef(airAltitudeHex(d.altitude)),
        getColor: () => [255, 255, 255, 255],
        getSize: (d: AirTrafficFlight) => (d.altitude > 30000 ? 20 : d.altitude > 15000 ? 18 : 16),
        getAngle: (d: AirTrafficFlight) => this.headingToDeckAngle(this.getTweenedHeading(d)),
        sizeUnits: 'pixels',
        sizeMinPixels: 12,
        sizeMaxPixels: 24,
        billboard: true,
        pickable: true,
        onHover: (info) => {
          this.handleAirTrafficHover(info);
        },
        updateTriggers: {
          getPosition: [this.civilAirTrafficFlights, this.civilAirTweenProgress],
          getSize: this.civilAirTrafficFlights,
          getAngle: [this.civilAirTrafficFlights, this.civilAirTweenProgress],
          getIcon: this.civilAirTrafficFlights,
        },
      }),
      new ScatterplotLayer<EventMapPoint>({
        id: 'deck-news-events',
        data: this.eventPoints,
        visible: this.eventPointsVisible,
        coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        getPosition: (d: EventMapPoint) => [d.lon, d.lat],
        radiusUnits: 'pixels',
        getRadius: (d: EventMapPoint) => d.radius,
        filled: true,
        getFillColor: (d: EventMapPoint) => (d.hollow ? [0, 0, 0, 0] : [...d.color, 220]) as [number, number, number, number],
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: (d: EventMapPoint) => (d.hollow ? 2 : 1),
        getLineColor: (d: EventMapPoint) => (d.hollow ? [...d.color, 255] : [10, 12, 18, 230]) as [number, number, number, number],
        pickable: true,
        onHover: (info) => {
          const point = info.object as EventMapPoint | undefined;
          const canvas = this.map?.getCanvas();
          if (canvas) canvas.title = point ? point.title : '';
        },
        onClick: (info) => {
          const point = info.object as EventMapPoint | undefined;
          if (point) this.onEventPointClick?.(point.id);
        },
        updateTriggers: {
          getFillColor: this.eventPoints,
          getLineColor: this.eventPoints,
          getLineWidth: this.eventPoints,
          getRadius: this.eventPoints,
        },
      }),
    ];
  }

  /** Navires à sillage : tableau gardé tant que `globalTrafficData` est le même (deck.gl ne régénère pas ses attributs). */
  private getAisTrailData(): AisShipData[] {
    const source = this.globalTrafficData;
    if (this.aisTrailCache?.source !== source) {
      this.aisTrailCache = { source, data: source.filter((d) => d.trail && d.trail.length >= 2) };
    }
    return this.aisTrailCache.data;
  }

  /**
   * Noms des navires : tous à partir du zoom 10, sinon le navire survolé ou choisi seulement (lisibilité) ; tableau gardé tant que
   * la donnée, le navire survolé, le navire choisi et ce seuil de zoom ne changent pas.
   */
  private getAisLabelData(): AisShipData[] {
    const source = this.globalTrafficData;
    const highlighted = this._highlightedMmsi;
    const selected = this._selectedShipMmsi;
    const all = this.viewState.zoom >= 10;
    const cache = this.aisLabelCache;
    if (cache && cache.source === source && cache.highlighted === highlighted && cache.selected === selected && cache.all === all) {
      return cache.data;
    }
    const data = source.filter((ship) => {
      if (!ship.name || ship.name.trim().length === 0) return false;
      if (ship.mmsi && (ship.mmsi === highlighted || ship.mmsi === selected)) return true;
      return all;
    });
    this.aisLabelCache = { source, highlighted, selected, all, data };
    return data;
  }

  /**
   * Re-render Deck.gl AIS layers.
   */
  private refreshAisLayers(): void {
    if (!this.deckOverlay) return;
    this.deckOverlay.setProps({ layers: this.buildAisLayers() });
    // CRITICAL: Deck.gl MapboxOverlay only renders when MapLibre repaints.
    // Forces map to draw incoming WebSocket maritime ships immediately.
    this.map?.triggerRepaint();
  }

  /**
   * Batched variant of refreshAisLayers(): coalesces multiple overlay updates
   * within the same frame into a single setProps + triggerRepaint via
   * requestAnimationFrame. Use this for high-frequency callers (moveend,
   * data refreshes, layer toggles); use refreshAisLayers() when an immediate
   * synchronous render is required (e.g. first render).
   */
  private scheduleOverlayUpdate(): void {
    if (!this.deckOverlay || this.pendingOverlayUpdate) return;
    this.pendingOverlayUpdate = true;
    requestAnimationFrame(() => {
      this.pendingOverlayUpdate = false;
      if (!this.deckOverlay) return;
      this.deckOverlay.setProps({ layers: this.buildAisLayers() });
      this.map?.triggerRepaint();
    });
  }

  private normalizeFlightHeading(heading?: number): number {
    if (!Number.isFinite(heading)) return 0;
    const normalized = (heading ?? 0) % 360;
    return normalized < 0 ? normalized + 360 : normalized;
  }

  private headingToDeckAngle(heading?: number): number {
    return -this.normalizeFlightHeading(heading);
  }

  private getAisDeckAngle(ship: AisShipData): number {
    const speed = Number(ship.speed ?? 0);
    const trailHeading = speed > 0.5 ? this.getAisTrailHeading(ship.trail) : null;
    const cog = this.normalizeAngle(ship.cog);
    const heading = this.normalizeAngle(ship.heading);
    const course = speed > 0.5
      ? (trailHeading ?? cog ?? heading ?? 0)
      : (heading ?? cog ?? trailHeading ?? 0);
    return this.headingToDeckAngle(course);
  }

  private getAisTrailHeading(trail?: Array<[number, number]>): number | null {
    if (!trail || trail.length < 2) return null;

    for (let i = trail.length - 1; i >= 1; i -= 1) {
      const prev = trail[i - 1];
      const next = trail[i];
      if (!prev || !next) continue;

      const dx = next[0] - prev[0];
      const dy = next[1] - prev[1];
      if (Math.abs(dx) < 0.00001 && Math.abs(dy) < 0.00001) continue;

      const heading = (Math.atan2(dx, dy) * 180) / Math.PI;
      return this.normalizeAngle(heading < 0 ? heading + 360 : heading);
    }

    return null;
  }

  private projectAirTrafficPosition(flight: AirTrafficFlight): [number, number] {
    const newLon = Number(flight.longitude);
    const newLat = Number(flight.latitude);
    if (!Number.isFinite(newLon) || !Number.isFinite(newLat)) {
      return [0, 0];
    }

    // Interpolate from previous position if we have one and tween is in progress
    const prev = this.civilAirPrevPositions.get(flight.id);
    if (prev && this.civilAirTweenProgress < 1) {
      const t = this.civilAirTweenProgress;
      const lon = prev.lon + (newLon - prev.lon) * t;
      const lat = prev.lat + (newLat - prev.lat) * t;
      return [lon, lat];
    }

    return [newLon, newLat];
  }

  /**
   * Get interpolated heading for a civil flight during tween.
   * Handles wrap-around (e.g. 350° → 10°) via shortest-arc lerp.
   */
  private getTweenedHeading(flight: AirTrafficFlight): number {
    const newH = this.normalizeFlightHeading(flight.heading);
    const prev = this.civilAirPrevPositions.get(flight.id);
    if (prev && this.civilAirTweenProgress < 1) {
      const oldH = prev.heading;
      let diff = newH - oldH;
      // Shortest arc: keep diff in [-180, 180]
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      const h = oldH + diff * this.civilAirTweenProgress;
      return ((h % 360) + 360) % 360;
    }
    return newH;
  }

  private handleAisHover(info: { object?: unknown; coordinate?: number[]; x?: number; y?: number }): void {
    if (!this.map) return;
    const ship = info.object as AisShipData | undefined;
    if (!ship) {
      this.map.getCanvas().style.cursor = '';
      this.hideAisHoverTooltip();
      return;
    }
    this.map.getCanvas().style.cursor = 'pointer';
    const coord = info.coordinate;
    const lngLat =
      coord && coord.length >= 2
        ? new maplibregl.LngLat(coord[0], coord[1])
        : this.map.unproject([info.x ?? 0, info.y ?? 0]);
    const html = this.getAisTooltipHtml(ship);
    this.showAisHoverTooltip(lngLat, html);
  }

  private handleAirTrafficHover(info: { object?: unknown; coordinate?: number[]; x?: number; y?: number }): void {
    if (!this.map) return;
    const flight = info.object as AirTrafficFlight | undefined;
    if (!flight) {
      this.map.getCanvas().style.cursor = '';
      this.militaryTooltip?.remove();
      this.militaryTooltip = null;
      return;
    }

    this.map.getCanvas().style.cursor = 'pointer';
    const coord = info.coordinate;
    const lngLat =
      coord && coord.length >= 2
        ? new maplibregl.LngLat(coord[0], coord[1])
        : this.map.unproject([info.x ?? 0, info.y ?? 0]);

    this.showMilitaryTooltip(lngLat, airFlightTooltipHtml(flight));
  }

  private showAisHoverTooltip(lngLat: maplibregl.LngLat, html: string): void {
    if (!this.map) return;
    if (!this.aisHoverTooltip) {
      this.aisHoverTooltip = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: 'ais-tooltip dark-popup',
        offset: 8,
        maxWidth: '360px',
      });
    }
    this.aisHoverTooltip.setLngLat(lngLat).setHTML(html).addTo(this.map);
    const el = this.aisHoverTooltip.getElement();
    el.style.zIndex = '2000';
    el.style.pointerEvents = 'none';
  }

  private hideAisHoverTooltip(): void {
    this.aisHoverTooltip?.remove();
    this.aisHoverTooltip = null;
  }

  private getEnrichedHoverPopup(): maplibregl.Popup {
    if (!this.enrichedHoverPopup) {
      this.enrichedHoverPopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        maxWidth: '320px',
        className: 'dark-popup',
        offset: 10,
      });
    }
    return this.enrichedHoverPopup;
  }

  private showEnrichedHoverPopup(lngLat: maplibregl.LngLatLike, html: string): void {
    if (!this.map) return;
    // Dismiss energy tooltips so gas/oil/infra never stack with them
    this.energyRegionPopup?.remove(); this.energyRegionPopup = null;
    this.energyFlowPopup?.remove(); this.energyFlowPopup = null;
    const popup = this.getEnrichedHoverPopup();
    popup.setLngLat(lngLat).setHTML(html).addTo(this.map);
    const el = popup.getElement();
    el.style.pointerEvents = 'none';
    el.style.zIndex = '2000';
  }

  private hideEnrichedHoverPopup(): void {
    this.enrichedHoverPopup?.remove();
  }

  private buildInfrastructureHoverHtml(properties: Record<string, unknown>): string {
    const type = String(properties.type ?? 'infrastructure');
    const typeLabels: Record<string, string> = {
      nuclear: 'Centrale nucléaire',
      thermal: 'Grande centrale thermique',
      hydro: 'Grande centrale hydro / STEP',
      substation: 'Poste RTE 400 kV',
      'gas-terminal': 'Terminal méthanier',
      'gas-storage': 'Stockage souterrain gaz',
      refinery: 'Raffinerie',
      'oil-depot': 'Dépôt pétrolier majeur',
    };
    const availabilityRatio = Number(properties.availabilityRatio ?? 1);
    const power = Number(properties.power ?? 0);
    const available = Number(properties.available ?? 0);
    const capacity = Number(properties.capacity ?? 0);
    const capacityUnit = String(properties.capacityUnit ?? 'MW');
    const operator = String(properties.operator ?? '');
    const status = String(properties.status ?? '');
    const voltageKv = Number(properties.voltageKv ?? 0);
    const fuelType = String(properties.fuelType ?? '');
    const storageCapacityHm3 = Number(properties.storageCapacityHm3 ?? 0);
    const throughputKbpd = Number(properties.throughputKbpd ?? 0);
    const notes = String(properties.notes ?? '');
    const hasEnergyData = Number.isFinite(power) && power > 0;
    const statusLabel =
      type === 'nuclear'
        ? status === 'maintenance' ? 'Sous contrainte'
          : status === 'shutdown' ? 'Arrêté'
          : 'En service'
        : '';
    const statusColor =
      type === 'nuclear'
        ? status === 'maintenance' ? '#E74C3C'
          : status === 'shutdown' ? '#6B7280'
          : '#2ECC71'
        : '#9898a8';

    return `
      <div style="color:#e8e8ec; font-family:sans-serif; min-width:220px;">
        <div style="font-size:14px; font-weight:700; color:#fff;">${this.escapeHtml(String(properties.name ?? 'Infrastructure'))}</div>
        <div style="margin:2px 0 10px; font-size:12px; font-weight:600; color:${this.escapeHtml(String(properties.color ?? '#e8e8ec'))};">
          ${this.escapeHtml(typeLabels[type] ?? type)}
        </div>
        <div style="display:grid; grid-template-columns:1fr auto; gap:6px 10px; font-size:12px;">
          ${operator ? `<span style="color:#9898a8;">Opérateur</span><strong>${this.escapeHtml(operator)}</strong>` : ''}
          ${statusLabel ? `<span style="color:#9898a8;">Statut</span><strong style="color:${statusColor};">${this.escapeHtml(statusLabel)}</strong>` : ''}
          ${capacity > 0 ? `<span style="color:#9898a8;">Capacité</span><strong>${capacity.toLocaleString('fr-FR', { maximumFractionDigits: capacity < 100 ? 1 : 0 })} ${this.escapeHtml(capacityUnit)}</strong>` : ''}
          ${hasEnergyData ? `<span style="color:#9898a8;">Disponible</span><strong>${Math.round(available).toLocaleString('fr-FR')} MW</strong>` : ''}
          ${hasEnergyData ? `<span style="color:#9898a8;">Disponibilité</span><strong>${Math.round(Math.max(0, Math.min(1, availabilityRatio)) * 100)} %</strong>` : ''}
          ${voltageKv > 0 ? `<span style="color:#9898a8;">Tension</span><strong>${voltageKv} kV</strong>` : ''}
          ${storageCapacityHm3 > 0 ? `<span style="color:#9898a8;">Retenue</span><strong>${storageCapacityHm3.toLocaleString('fr-FR')} hm3</strong>` : ''}
          ${throughputKbpd > 0 ? `<span style="color:#9898a8;">Débit</span><strong>${throughputKbpd.toLocaleString('fr-FR')} kb/j</strong>` : ''}
          ${fuelType ? `<span style="color:#9898a8;">Matière</span><strong>${this.escapeHtml(fuelType)}</strong>` : ''}
        </div>
        ${notes ? `<div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.08); font-size:11px; color:#a1a1aa;">${this.escapeHtml(notes)}</div>` : ''}
      </div>
    `;
  }

  private buildHydraulicHoverHtml(properties: Record<string, unknown>): string {
    const type = String(properties.type ?? 'hydro_production');
    const subtype = String(properties.subtype ?? 'dam');
    const typeLabel =
      type === 'step_storage' ? 'STEP / pompage'
        : type === 'water_regulation' ? 'Régulation / retenue'
          : 'Hydro production';
    const subtypeLabel =
      subtype === 'pumped_storage' ? 'Pumped storage'
        : subtype === 'run_of_river' ? "Fil de l'eau"
          : subtype === 'reservoir' ? 'Réservoir'
            : 'Barrage';
    const criticalityScore = Number(properties.criticalityScore ?? 0);
    const capacityMw = Number(properties.capacityMw ?? 0);
    const reservoirVolume = Number(properties.reservoirVolume ?? 0);
    const operator = String(properties.operator ?? '');
    const river = String(properties.river ?? '');
    const commune = String(properties.commune ?? '');
    const department = String(properties.department ?? '');
    const technology = String(properties.technology ?? '');
    const locationAccuracy = String(properties.locationAccuracy ?? '');
    const sourceDate = String(properties.sourceDate ?? '');
    const hydroTrend = String(properties.hydroTrend ?? 'normal');
    const lastUpdate = String(properties.lastUpdate ?? '');
    const signalSource = String(properties.signalSource ?? 'DERIVED_CONTEXT_ONLY');
    const dataFreshness = String(properties.dataFreshness ?? 'unavailable');
    const measuredSupportLevel = String(properties.measuredSupportLevel ?? 'none');
    const observationTrend = String(properties.observationTrend ?? 'unavailable');
    const observationTimestamp = String(properties.observationTimestamp ?? '');
    const confidence = Number(properties.confidence ?? 0.25);
    const measuredStationCount = Number(properties.measuredStationCount ?? 0);
    const sourceDetail = String(properties.sourceDetail ?? '');
    const region = String(properties.region ?? '');

    const trendColors: Record<string, string> = {
      low: '#60A5FA',
      normal: '#A5B4FC',
      high: '#2563EB',
      stress: '#EF4444',
    };
    const trendLabels: Record<string, string> = {
      low: 'Bas',
      normal: 'Normal',
      high: 'Haut',
      stress: 'Stress',
    };
    const sourceLabels: Record<string, string> = {
      DERIVED_CONTEXT_ONLY: 'Dérivé contexte, pas de station Hub’Eau liée',
      DERIVED_REAL_MEASURE_SUPPORT: 'Dérivé appuyé sur mesures hydrométriques Hub’Eau',
    };
    const freshnessLabels: Record<string, string> = {
      fresh: 'fraîche',
      aging: 'à confirmer',
      stale: 'ancienne',
      unavailable: 'indisponible',
    };
    const supportLabels: Record<string, string> = {
      none: 'aucun appui',
      partial: 'appui partiel',
      strong: 'appui fort',
    };
    const observationTrendLabels: Record<string, string> = {
      rising: 'hausse',
      falling: 'baisse',
      stable: 'stable',
      mixed: 'mixte',
      unavailable: 'n/d',
    };
    const trendColor = trendColors[hydroTrend] ?? '#A5B4FC';

    return `
      <div style="color:#e8e8ec; font-family:sans-serif; min-width:230px; max-width:300px;">
        <div style="font-size:14px; font-weight:700; color:#fff;">${this.escapeHtml(String(properties.name ?? 'Actif hydraulique'))}</div>
        <div style="margin:2px 0 10px; font-size:12px; font-weight:600; color:${this.escapeHtml(String(properties.color ?? '#3B82F6'))};">
          ${this.escapeHtml(typeLabel)} · ${this.escapeHtml(subtypeLabel)}
        </div>
        <div style="display:grid; grid-template-columns:1fr auto; gap:6px 10px; font-size:12px;">
          ${region ? `<span style="color:#9898a8;">Région</span><strong>${this.escapeHtml(region)}</strong>` : ''}
          ${commune ? `<span style="color:#9898a8;">Commune</span><strong>${this.escapeHtml(commune)}${department ? ` (${this.escapeHtml(department)})` : ''}</strong>` : ''}
          ${operator ? `<span style="color:#9898a8;">Opérateur</span><strong>${this.escapeHtml(operator)}</strong>` : ''}
          ${technology ? `<span style="color:#9898a8;">Technologie</span><strong>${this.escapeHtml(technology)}</strong>` : ''}
          ${river ? `<span style="color:#9898a8;">Cours d’eau</span><strong>${this.escapeHtml(river)}</strong>` : ''}
          ${capacityMw > 0 ? `<span style="color:#9898a8;">Capacité</span><strong>${capacityMw.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} MW</strong>` : ''}
          ${reservoirVolume > 0 ? `<span style="color:#9898a8;">Retenue</span><strong>${reservoirVolume.toLocaleString('fr-FR')} hm3</strong>` : ''}
          <span style="color:#9898a8;">Criticité</span><strong>${criticalityScore}/100</strong>
          <span style="color:#9898a8;">Stress hydro</span><strong style="color:${trendColor};">${this.escapeHtml(trendLabels[hydroTrend] ?? hydroTrend)}</strong>
          <span style="color:#9898a8;">Taxonomie</span><strong>${this.escapeHtml(sourceLabels[signalSource] ?? signalSource)}</strong>
          <span style="color:#9898a8;">Appui mesuré</span><strong>${this.escapeHtml(supportLabels[measuredSupportLevel] ?? measuredSupportLevel)}</strong>
          <span style="color:#9898a8;">Tendance obs.</span><strong>${this.escapeHtml(observationTrendLabels[observationTrend] ?? observationTrend)}</strong>
          <span style="color:#9898a8;">Confiance</span><strong>${Math.round(clamp(confidence, 0, 1) * 100)}%</strong>
        </div>
        <div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.08); font-size:11px; color:#a1a1aa;">
          ${this.escapeHtml(
            measuredSupportLevel !== 'none'
              ? `Stress hydro : ${trendLabels[hydroTrend] ?? hydroTrend} – dérivé appuyé sur mesures hydrométriques Hub’Eau.`
              : `Stress hydro : ${trendLabels[hydroTrend] ?? hydroTrend} – dérivé contexte, pas de station Hub’Eau liée.`,
          )}
          ${locationAccuracy ? `<div style="margin-top:4px;">Précision point : ${this.escapeHtml(locationAccuracy)}</div>` : ''}
          ${sourceDate ? `<div style="margin-top:4px;">Référence registre : ${this.escapeHtml(sourceDate)}</div>` : ''}
          ${lastUpdate ? `<div style="margin-top:4px;">Signal recalculé : ${this.escapeHtml(lastUpdate)}</div>` : ''}
          <div style="margin-top:4px;">Fraîcheur mesures : ${this.escapeHtml(freshnessLabels[dataFreshness] ?? dataFreshness)}</div>
          ${measuredStationCount > 0 ? `<div style="margin-top:4px;">Stations liées : ${measuredStationCount}</div>` : ''}
          ${observationTimestamp ? `<div style="margin-top:4px;">Dernière observation : ${this.escapeHtml(observationTimestamp)}</div>` : ''}
          ${sourceDetail ? `<div style="margin-top:4px;">Source : ${this.escapeHtml(sourceDetail)}</div>` : ''}
        </div>
      </div>
    `;
  }

  private buildEolienHoverHtml(properties: Record<string, unknown>): string {
    const live = this._latestEolienLive;
    return buildEolienPopupHtml({
      id: String(properties.id ?? ''),
      name: String(properties.name ?? 'Parc éolien'),
      status: String(properties.status ?? 'unknown') as 'operating' | 'construction' | 'authorized' | 'project' | 'inactive' | 'unknown',
      kind: String(properties.kind ?? 'unknown') as 'onshore' | 'offshore' | 'unknown',
      capacityMw: Number(properties.capacityMw ?? 0),
      turbineCount: Number(properties.turbineCount ?? 0) || null,
      commissioningYear: Number(properties.commissioningYear ?? 0) || null,
      operator: String(properties.operator ?? '') || null,
      commune: String(properties.commune ?? '') || null,
      department: String(properties.department ?? '') || null,
      region: String(properties.region ?? '') || null,
      estimatedProductionMw: Number(properties.estimatedProductionMw ?? 0),
      radius: Number(properties.radius ?? 0),
      color: String(properties.color ?? '#38BDF8'),
      ringColor: String(properties.ringColor ?? '#93C5FD'),
      glowColor: String(properties.glowColor ?? '#38BDF855'),
      opacity: Number(properties.opacity ?? 0.9),
    }, live);
  }

  private buildGasHoverHtml(properties: Record<string, unknown>): string {
    const type = String(properties.type ?? 'gas');
    const isTerminal = type === 'terminal';
    const operator = String(properties.operator ?? 'n/d');
    const capacity = Number(properties.capacity ?? 0);
    const fillLevel = Number(properties.fillLevel ?? NaN);
    const trend = String(properties.trend ?? '');
    const trendLabel = trend === 'withdrawing' ? 'Soutirage'
      : trend === 'filling' ? 'Remplissage'
        : 'Stable';

    const currentStockTWh = Number(properties.currentStockTWh ?? NaN);
    const flowRate = Number(properties.flowRateGWhDay ?? NaN);
    const sendOut = Number(properties.currentSendOut ?? NaN);
    const utilPct = Number(properties.utilizationPct ?? NaN);
    const inventoryPct = Number(properties.inventoryPct ?? NaN);
    const inventory = Number(properties.inventory ?? NaN);
    // Journée gazière des chiffres GIE ALSI (YYYY-MM-DD) : sans elle, valeurs de configuration.
    const dataDate = typeof properties.dataDate === 'string' ? properties.dataDate : '';
    const dataDateLabel = /^\d{4}-\d{2}-\d{2}$/.test(dataDate) ? `${dataDate.slice(8, 10)}/${dataDate.slice(5, 7)}` : '';

    return `
      <div style="color:#e8e8ec; font-family:sans-serif; min-width:240px; padding:2px;">
        <div style="font-size:14px; font-weight:700; color:#fff;">${this.escapeHtml(String(properties.name ?? 'Site gaz'))}</div>
        <div style="margin:2px 0 10px; font-size:12px; font-weight:600; color:${isTerminal ? '#A78BFA' : '#2DD4BF'};">
          ${isTerminal ? 'Terminal GNL' : 'Stockage gaz'}
        </div>
        <div style="display:grid; grid-template-columns:1fr auto; gap:6px 12px; font-size:12px;">
          <span style="color:#9898a8;">Opérateur</span><strong>${this.escapeHtml(operator)}</strong>
          ${capacity > 0 ? `<span style="color:#9898a8;">Capacité max</span><strong>${capacity.toLocaleString('fr-FR')} ${isTerminal ? 'GWh/j' : 'TWh'}</strong>` : ''}

          ${!isTerminal && Number.isFinite(fillLevel) ? `<div style="grid-column: 1 / -1; height:1px; background:rgba(255,255,255,0.1); margin:4px 0;"></div>` : ''}
          ${!isTerminal && Number.isFinite(fillLevel) ? `<span style="color:#9898a8;">Remplissage</span><strong>${fillLevel.toFixed(1)} %</strong>` : ''}
          ${!isTerminal && Number.isFinite(currentStockTWh) ? `<span style="color:#9898a8;">Volume stocké</span><strong>${currentStockTWh.toFixed(2)} TWh</strong>` : ''}
          ${!isTerminal && Number.isFinite(flowRate) ? `<span style="color:#9898a8;">Débit net</span><strong style="color:${flowRate > 0 ? '#22C55E' : '#EF4444'}">${flowRate > 0 ? '+' : ''}${flowRate.toFixed(0)} GWh/j</strong>` : ''}
          ${!isTerminal && !Number.isFinite(flowRate) ? `<span style="color:#9898a8;">Tendance</span><strong style="color:${trend === 'filling' ? '#22C55E' : trend === 'withdrawing' ? '#EF4444' : '#6B7280'}">${this.escapeHtml(trendLabel)}</strong>` : ''}

          ${isTerminal && (Number.isFinite(sendOut) || Number.isFinite(utilPct) || Number.isFinite(inventoryPct)) ? `<div style="grid-column: 1 / -1; height:1px; background:rgba(255,255,255,0.1); margin:4px 0;"></div>` : ''}
          ${isTerminal && Number.isFinite(inventoryPct) ? `<span style="color:#9898a8;">Remplissage cuves</span><strong>${inventoryPct.toFixed(1)} %</strong>` : ''}
          ${isTerminal && Number.isFinite(inventory) ? `<span style="color:#9898a8;">Stock GNL</span><strong>${inventory.toFixed(0)} GWh</strong>` : ''}
          ${isTerminal && Number.isFinite(sendOut) ? `<span style="color:#9898a8;">Émission réseau</span><strong>${sendOut.toFixed(0)} GWh/j</strong>` : ''}
          ${isTerminal && Number.isFinite(utilPct) ? `<span style="color:#9898a8;">Taux d'utilisation</span><strong>${utilPct.toFixed(1)} %</strong>` : ''}
          ${isTerminal ? `<span style="color:#9898a8;">Source</span><strong>${dataDateLabel ? `GIE ALSI · jour gazier ${dataDateLabel}` : 'Configuration (GIE ALSI indisponible)'}</strong>` : ''}
        </div>
      </div>
    `;
  }


  private buildBiomethaneHoverHtml(properties: Record<string, unknown>): string {
    const name = String(properties.name ?? 'Site biométhane');
    const commune = String(properties.commune ?? '');
    const department = String(properties.department ?? '');
    const operator = String(properties.operator ?? '');
    const capacityGwh = Number(properties.capacityGwh ?? 0);
    const location = [commune, department].filter(Boolean).join(', ');

    return `
      <div style="color:#e8e8ec; font-family:sans-serif; min-width:200px; padding:2px;">
        <div style="font-size:14px; font-weight:700; color:#fff;">${this.escapeHtml(name)}</div>
        <div style="margin:2px 0 10px; font-size:12px; font-weight:600; color:#F59E0B;">Site injection biométhane</div>
        <div style="display:grid; grid-template-columns:1fr auto; gap:6px 12px; font-size:12px;">
          ${location ? `<span style="color:#9898a8;">Localisation</span><strong>${this.escapeHtml(location)}</strong>` : ''}
          ${operator ? `<span style="color:#9898a8;">Opérateur</span><strong>${this.escapeHtml(operator)}</strong>` : ''}
          ${capacityGwh > 0 ? `<span style="color:#9898a8;">Production</span><strong>${capacityGwh.toLocaleString('fr-FR')} GWh/an</strong>` : ''}
        </div>
      </div>
    `;
  }

  private buildGasPirHoverHtml(properties: Record<string, unknown>): string {
    // Enriched tooltip si les stats sont disponibles
    const borderCode = String(properties.borderCode ?? '');
    const stats = this.gasFlowStats.get(borderCode);
    if (stats) return this.buildGasFlowTooltipHtml(stats);

    // Fallback minimal (stats pas encore chargées)
    const country = String(properties.country ?? 'Interconnexion');
    const labelRaw = String(properties.label ?? '').split('\n');
    const flow = labelRaw[1] ?? '';
    const isImp = flow.startsWith('+');
    return `
      <div style="color:#e8e8ec;font-family:sans-serif;min-width:180px;padding:4px;">
        <div style="font-size:14px;font-weight:700;color:#fff;">${this.escapeHtml(country)}</div>
        <div style="margin:2px 0 8px;font-size:12px;font-weight:600;color:${isImp ? '#A855F7' : '#06B6D4'};">
          ${isImp ? `Import gaz ${fmIcon('trending-down')}` : `Export gaz ${fmIcon('trending-up')}`}
        </div>
        ${flow ? `<div style="font-size:12px;color:#9898a8;">Flux <strong style="color:#fff;">${this.escapeHtml(flow)}</strong></div>` : ''}
      </div>`;
  }

  private buildGasFlowTooltipHtml(f: import('../types/index.ts').GasInterconnectionFlowStats): string {
    const IMP_COLOR = '#A855F7'; // violet — import
    const EXP_COLOR = '#06B6D4'; // cyan   — export
    const color = f.direction === 'import' ? IMP_COLOR : EXP_COLOR;

    const row = (lbl: string, val: string, c?: string) =>
      `<div style="display:flex;justify-content:space-between;gap:12px;font-size:12px;margin-bottom:2px;">` +
      `<span style="color:#9898a8;">${lbl}</span>` +
      `<strong style="color:${c ?? '#e8e8ec'};">${val}</strong></div>`;
    const sep = `<div style="border-top:1px solid rgba(255,255,255,0.08);margin:6px 0;"></div>`;
    const sectionLabel = (t: string) =>
      `<div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#555;margin-bottom:3px;">${t}</div>`;

    // Barre d'utilisation — palette gaz : cyan (ok) → violet clair → violet vif (saturé)
    const uPct = Math.min(f.utilizationPct, 100);
    const uColor = uPct < 70 ? EXP_COLOR : uPct < 90 ? '#C084FC' : IMP_COLOR;
    const uBar =
      `<div style="height:4px;background:rgba(255,255,255,0.1);border-radius:2px;margin-top:4px;overflow:hidden;">` +
      `<div style="width:${uPct.toFixed(0)}%;height:100%;background:${uColor};border-radius:2px;"></div></div>`;

    // Soldes — cyan = export FR net, violet = import FR net
    const d7Color = f.sevenDayNetGWh >= 0 ? EXP_COLOR : IMP_COLOR;
    const dColor = f.dailyNetGWh >= 0 ? EXP_COLOR : IMP_COLOR;
    const fmtGWh = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)} GWh`;

    // Tendance stockage — cyan = remplissage (bonne nouvelle), violet = soutirage
    const trendLabel: Record<string, string> = { filling: `Remplissage ${fmIcon('trending-up')}`, withdrawing: `Soutirage ${fmIcon('trending-down')}`, stable: 'Stable →' };
    const trendColor: Record<string, string> = { filling: EXP_COLOR, withdrawing: IMP_COLOR, stable: '#8e8e93' };

    // Signal EcoGaz — cyan (vert→jaune) vers violet (orange→rouge)
    const ecoColors: Record<string, string> = {
      vert: EXP_COLOR,   // cyan  — réseau détendu
      jaune: '#67E8F9',   // cyan clair — vigilance légère
      orange: '#C084FC',   // violet clair — tension
      rouge: IMP_COLOR,   // violet vif  — alerte
    };
    const ecoLabel: Record<string, string> = { vert: 'Vert', jaune: 'Jaune', orange: 'Orange', rouge: 'Rouge' };
    const ecoColor = ecoColors[f.ecogazSignal] ?? '#8e8e93';

    // Sparkline (série déjà en convention >0=export FR = vert)
    const sparklineBlock = f.sevenDaySeries.length > 2
      ? `${sep}
         <div>
           ${sectionLabel('7 derniers jours : solde GWh/j')}
           ${buildSparklineSVG(f.sevenDaySeries, { width: 222, height: 44 })}
           <div style="display:flex;justify-content:space-between;font-size:9px;color:#555;margin-top:2px;">
             <span>J-7</span><span>↑ export FR · ↓ import FR</span><span>Maintenant</span>
           </div>
         </div>`
      : '';

    return `
      <div style="color:#e8e8ec;font-family:sans-serif;min-width:230px;padding:4px;">

        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
          <strong style="font-size:13px;color:#fff;">${this.escapeHtml(f.originLabel)} → ${this.escapeHtml(f.destinationLabel)}</strong>
          <span style="font-size:11px;padding:2px 7px;border-radius:4px;font-weight:700;color:#000;background:${color};">
            ${f.direction === 'import' ? `Import ${fmIcon('trending-down')}` : `Export ${fmIcon('trending-up')}`}
          </span>
        </div>

        <!-- Puissance -->
        ${sectionLabel('Flux temps réel')}
        ${row('Actuel', `${f.currentFlowGWhPerDay.toFixed(0)} GWh/j`, color)}
        ${row('Capacité NTC', `${f.capacityGWhPerDay.toFixed(0)} GWh/j`)}
        ${row('Utilisation', `${uPct.toFixed(0)} %`, uColor)}
        ${uBar}

        ${sep}

        <!-- Soldes -->
        ${sectionLabel('Soldes')}
        ${row('Aujourd\'hui', fmtGWh(f.dailyNetGWh), dColor)}
        ${row('7 jours', fmtGWh(f.sevenDayNetGWh), d7Color)}

        ${sep}

        <!-- Contexte national -->
        ${sectionLabel('Contexte national')}
        ${row('Stockage FR', `${f.nationalStorageLevelPct.toFixed(0)} %`)}
        ${row('Tendance', trendLabel[f.storageTrend] ?? f.storageTrend, trendColor[f.storageTrend] ?? '#8e8e93')}
        <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
          <span style="width:8px;height:8px;border-radius:50%;background:${ecoColor};display:inline-block;flex-shrink:0;"></span>
          <span style="font-size:12px;color:${ecoColor};font-weight:600;">EcoGaz ${ecoLabel[f.ecogazSignal] ?? f.ecogazSignal}</span>
        </div>

        ${sparklineBlock}

        <div style="font-size:10px;color:#444;margin-top:6px;">Mis à jour ${formatUpdateTime(f.updatedAt)}</div>
      </div>`;
  }

  private buildOilRefineryHoverHtml(properties: Record<string, unknown>): string {
    const operator = String(properties.operator ?? 'n/d');
    const capacity = Number(properties.capacity ?? 0);
    const status = String(properties.status ?? 'unknown');
    // Labels alignés sur la légende
    const subtitleLabel = status === 'active' ? 'Raffinerie (active)'
      : status === 'maintenance' ? 'Raffinerie (maintenance)'
        : status === 'shutdown' ? "Raffinerie (à l'arrêt)"
          : 'Raffinerie';
    const subtitleColor = status === 'active' ? '#FCD34D'   // Amber-300 — "soleil"
      : status === 'maintenance' ? '#D97706'   // Amber-600 — intermédiaire
        : '#92400E';  // Amber-800 terne — arrêt
    const statusLabel = status === 'active' ? 'Active'
      : status === 'maintenance' ? 'Maintenance'
        : status === 'shutdown' ? "À l'arrêt"
          : 'Inconnu';
    const statusColor = status === 'active' ? '#FCD34D'
      : status === 'maintenance' ? '#D97706'
        : '#92400E';

    return `
      <div style="color:#e8e8ec; font-family:sans-serif; min-width:220px;">
        <div style="font-size:14px; font-weight:700; color:#fff;">${this.escapeHtml(String(properties.name ?? 'Raffinerie'))}</div>
        <div style="margin:2px 0 10px; font-size:12px; font-weight:600; color:${subtitleColor};">${subtitleLabel}</div>
        <div style="display:grid; grid-template-columns:1fr auto; gap:6px 10px; font-size:12px;">
          <span style="color:#9898a8;">Opérateur</span><strong>${this.escapeHtml(operator)}</strong>
          ${capacity > 0 ? `<span style="color:#9898a8;">Capacité</span><strong>${capacity.toLocaleString('fr-FR')} Mt/an</strong>` : ''}
          <span style="color:#9898a8;">Statut</span><strong style="color:${statusColor};">${this.escapeHtml(statusLabel)}</strong>
        </div>
        <div style="margin-top:10px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.08); font-size:11px; color:#9898a8; line-height:1.45;">
          Raffinerie – couche structurelle, signal mensuel agrégé (SDES). Pas de télémesure site par site.
        </div>
      </div>
    `;
  }

  private buildOilDepotHoverHtml(properties: Record<string, unknown>): string {
    const role = String(properties.role ?? 'distribution');
    // Labels et couleurs alignés sur la légende
    const roleLabel = role === 'strategic' ? 'Dépôt stratégique'
      : role === 'terminal' ? 'Terminal pétrolier'
        : 'Dépôt de distribution';
    const roleColor = role === 'strategic' ? 'rgba(254,249,195,0.65)'   // Couleur exacte de la légende
      : role === 'terminal' ? '#F59E0B'   // Amber-500 — anneau lumineux
        : '#D97706';  // Amber-600 — distribution

    return `
      <div style="color:#e8e8ec; font-family:sans-serif; min-width:220px;">
        <div style="font-size:14px; font-weight:700; color:#fff;">${this.escapeHtml(String(properties.name ?? 'Dépôt pétrolier'))}</div>
        <div style="margin:2px 0 10px; font-size:12px; font-weight:600; color:${roleColor};">${this.escapeHtml(roleLabel)}</div>
        <div style="font-size:11px; color:#9898a8; line-height:1.45;">
          ${role === 'strategic'
            ? 'Dépôt stratégique – élément structurel, suivi via indicateurs mensuels de stocks/flux.'
            : 'Dépôt pétrolier – élément structurel, suivi via indicateurs mensuels de stocks/flux.'}
        </div>
      </div>
    `;
  }

  private buildOilPipelineHoverHtml(properties: Record<string, unknown>): string {
    const kind = String(properties.kind ?? 'products');
    // Labels alignés sur la légende
    const kindLabel = kind === 'crude' ? 'Oléoduc (pétrole brut)' : 'Oléoduc (produits raffinés)';
    const kindColor = kind === 'crude' ? '#92400E'   // Amber-800 — brut sombre, lisible sur fond sombre
      : '#A16207';  // Amber-700 — produits raffinés
    const operator = String(properties.operator ?? '');
    const name = String(properties.name ?? properties.id ?? 'Oléoduc');

    return `
      <div style="color:#e8e8ec; font-family:sans-serif; min-width:220px;">
        <div style="font-size:14px; font-weight:700; color:#fff;">${this.escapeHtml(name)}</div>
        <div style="margin:2px 0 10px; font-size:12px; font-weight:600; color:${kindColor};">${this.escapeHtml(kindLabel)}</div>
        ${operator ? `<div style="font-size:12px;"><span style="color:#9898a8;">Opérateur</span> <strong>${this.escapeHtml(operator)}</strong></div>` : ''}
      </div>
    `;
  }

  private buildOilFlowHoverHtml(properties: Record<string, unknown>): string {
    const country = String(properties.country ?? properties.name ?? 'Flux pétrolier');
    const hubName = String(properties.hubName ?? '');
    // isImport stocké directement dans les properties — pas de parsing fragile du label
    const isImport = properties.isImport === true || properties.isImport === 1 || properties.isImport === 'true';
    const label = String(properties.label ?? '').split('\n');
    const flow = label.length > 1 ? label[1] : '';
    const originSharePct = Number(properties.originSharePct ?? Number.NaN);
    const originVolumeMt = Number(properties.originVolumeMt ?? Number.NaN);
    const originReferenceYear = Number(properties.originReferenceYear ?? Number.NaN);
    const originSourceLabel = String(properties.originSourceLabel ?? '').trim();
    const originPartialBreakdown = Number(properties.originPartialBreakdown ?? 0) === 1;
    const hasOriginShare = Number.isFinite(originSharePct);
    const hasOriginVolume = Number.isFinite(originVolumeMt);
    const hasReferenceYear = Number.isFinite(originReferenceYear);
    let rawBreakdown: unknown[] = [];
    if (Array.isArray(properties.originBreakdown)) {
      rawBreakdown = properties.originBreakdown as unknown[];
    } else if (typeof properties.originBreakdown === 'string' && properties.originBreakdown.trim()) {
      try {
        const parsed = JSON.parse(properties.originBreakdown);
        if (Array.isArray(parsed)) {
          rawBreakdown = parsed;
        }
      } catch {
        rawBreakdown = [];
      }
    }
    const breakdown = rawBreakdown
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const item = entry as Record<string, unknown>;
        const itemLabel = String(item.label ?? '').trim();
        const itemVolumeMt = Number(item.volumeMt ?? Number.NaN);
        const itemSharePct = Number(item.sharePct ?? Number.NaN);
        if (!itemLabel || !Number.isFinite(itemVolumeMt) || !Number.isFinite(itemSharePct)) {
          return null;
        }
        return {
          label: itemLabel,
          volumeMt: itemVolumeMt,
          sharePct: itemSharePct,
        };
      })
      .filter((entry): entry is { label: string; volumeMt: number; sharePct: number } => entry !== null);
    const breakdownHtml = breakdown.length > 0
      ? `
        <div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.08);">
          <div style="font-size:12px; margin-bottom:6px; color:#9898a8;">Détail pays</div>
          ${breakdown.map((entry) => `
            <div style="display:flex; justify-content:space-between; gap:10px; font-size:11px; margin-bottom:4px;">
              <span style="color:#e8e8ec;">${this.escapeHtml(entry.label)}</span>
              <span style="color:#b9bac7; white-space:nowrap;">${entry.sharePct.toFixed(1)}% · ${entry.volumeMt.toFixed(1)} Mt</span>
            </div>
          `).join('')}
          ${originPartialBreakdown ? `<div style="font-size:11px; margin-top:6px; color:#fbbf24;">Détail partiel: ventilation pays incomplète sur cette catégorie</div>` : ''}
        </div>
      `
      : originPartialBreakdown
        ? `<div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.08); font-size:11px; color:#fbbf24;">Détail partiel: ventilation pays incomplète sur cette catégorie</div>`
        : '';

    return `
      <div style="color:#e8e8ec; font-family:sans-serif; min-width:190px; max-width:300px;">
        <div style="font-size:14px; font-weight:700; color:#fff;">${this.escapeHtml(country)}</div>
        <div style="margin:2px 0 10px; font-size:12px; font-weight:600; color:${isImport ? '#C2410C' : '#F59E0B'};">
          ${isImport ? `Flux import ${fmIcon('trending-down')}` : `Flux export ${fmIcon('trending-up')}`}
        </div>
        ${hubName ? `<div style="font-size:12px; margin-bottom:6px;"><span style="color:#9898a8;">Hub</span> <strong>${this.escapeHtml(hubName)}</strong></div>` : ''}
        ${hasOriginShare ? `<div style="font-size:12px; margin-bottom:6px;"><span style="color:#9898a8;">Part origine</span> <strong>${originSharePct.toFixed(1)}%</strong></div>` : ''}
        ${hasOriginVolume ? `<div style="font-size:12px; margin-bottom:6px;"><span style="color:#9898a8;">Volume annuel</span> <strong>${originVolumeMt.toFixed(1)} Mt</strong></div>` : ''}
        ${hasReferenceYear ? `<div style="font-size:12px; margin-bottom:6px;"><span style="color:#9898a8;">Année de référence</span> <strong>${originReferenceYear}</strong></div>` : ''}
        ${flow ? `<div style="font-size:12px;"><span style="color:#9898a8;">Flux</span> <strong>${this.escapeHtml(flow)}</strong></div>` : ''}
        ${originSourceLabel ? `<div style="font-size:11px; margin-top:8px; color:#9898a8;">Source: ${this.escapeHtml(originSourceLabel)}</div>` : ''}
        ${breakdownHtml}
      </div>
    `;
  }

  private buildMetropoleHoverHtml(properties: Record<string, unknown>): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const name = esc(String(properties.name ?? 'Métropole'));
    const mwLabel = esc(String(properties.mwLabel ?? 'n/d'));
    const updatedAt = esc(String(properties.updatedAt ?? ''));
    const nationalShare = properties.nationalSharePct != null
      ? `${properties.nationalSharePct} %`
      : null;
    const delta = properties.deltaVsJ1Pct != null
      ? Number(properties.deltaVsJ1Pct)
      : null;

    let deltaHtml = '';
    if (delta != null) {
      const sign = delta > 0 ? '+' : '';
      const isUp = delta > 0.2;
      const isDown = delta < -0.2;
      const deltaLabel = isUp ? 'Hausse vs J-1' : isDown ? 'Baisse vs J-1' : 'Stable vs J-1';
      const deltaArrow = isUp ? '↑' : isDown ? '↓' : '→';
      const dColor = isUp ? '#FF8A7A' : isDown ? '#6EDC8C' : '#D2D6DE';
      const dBg = isUp ? 'rgba(255,90,72,0.16)' : isDown ? 'rgba(52,199,89,0.16)' : 'rgba(210,214,222,0.10)';
      deltaHtml = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
          <span style="color:#9898a8; font-size:11px;">${deltaLabel}</span>
          <strong style="font-size:11px; color:${dColor}; background:${dBg}; border:1px solid ${dColor}33; border-radius:999px; padding:2px 8px;">
            ${deltaArrow} ${sign}${delta} %
          </strong>
        </div>`;
    }

    const shareHtml = nationalShare
      ? `<div style="display:flex; justify-content:space-between; margin-top:4px;">
          <span style="color:#9898a8; font-size:11px;">Part nationale</span>
          <strong style="font-size:11px; color:#c8c8d0;">${esc(nationalShare)}</strong>
        </div>`
      : '';

    const timeHtml = updatedAt
      ? `<div style="margin-top:8px; font-size:10px; color:rgba(255,255,255,0.22); text-align:right;">${updatedAt}</div>`
      : '';

    return `
      <div style="color:#e8e8ec; font-family:sans-serif; min-width:190px;">
        <div style="font-size:13px; font-weight:700; color:#fff; margin-bottom:2px;">${name}</div>
        <div style="font-size:10px; font-weight:600; color:#6ea8d4; letter-spacing:.8px; text-transform:uppercase; margin-bottom:8px;">Métropole électrique</div>
        <div style="display:flex; justify-content:space-between; align-items:baseline;">
          <span style="color:#9898a8; font-size:11px;">Consommation</span>
          <strong style="font-size:13px; color:#fff;">${mwLabel}</strong>
        </div>
        ${deltaHtml}
        ${shareHtml}
        ${timeHtml}
      </div>
    `;
  }

  private getAisTooltipHtml(ship: AisShipData): string {
    const shipType = Number.isFinite(ship.shipType) ? ship.shipType : 0;
    const category = vesselCategory(shipType);
    const fishingByStatus = category === 'inconnu' && ship.navStatus === 7;

    // Libellé et icône du type : même classement que la teinte de la carte, la légende et les comptes du serveur (traffic-legend.ts).
    const typeLabel = fishingByStatus ? 'Pêche (statut)' : vesselTypeLabel(category);
    const typeIcon = fmIcon(fishingByStatus ? 'fish' : this.getShipTypeIcon(category));

    const nameColor = '#fff';
    const typeColor = '#9898a8';

    const name = this.escapeHtml((ship.name || 'Inconnu').trim());
    const callSign = ship.callSign ? this.escapeHtml(String(ship.callSign).trim()) : '';
    const mmsi = ship.mmsi ? this.escapeHtml(String(ship.mmsi)) : '';
    const imo = ship.imoNumber && ship.imoNumber > 0 ? String(ship.imoNumber) : '';
    const navStatus = this.getNavStatusLabel(ship.navStatus);
    const dimensions = this.formatDimensions(ship.dimensions);
    const eta = this.formatEta(ship.eta);
    const route = this.decodeRoute(ship.destination);
    const countryRaw = (ship as unknown as { country?: string }).country ?? '';
    const countryParts = countryRaw.split('|');
    const countryIso2 = countryParts.length === 2 ? countryParts[0] : '';
    const countryName = countryParts.length === 2 ? this.escapeHtml(countryParts[1]) : this.escapeHtml(countryRaw);
    const countryHtml = countryIso2 && countryName
      ? `<span style="display:inline-block;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:3px;padding:0 5px;font-size:10px;font-family:monospace;letter-spacing:.5px;vertical-align:middle;line-height:16px">${this.escapeHtml(countryIso2)}</span> ${countryName}`
      : countryName;
    const lastSeen = ship.lastSeen ? this.formatLastSeen(ship.lastSeen) : '';
    const dataAgeMs = ship.lastSeen ? Date.now() - ship.lastSeen : null;
    const isStale = dataAgeMs != null && dataAgeMs > 120_000; // > 2 minutes
    const stalenessLabel = dataAgeMs == null ? '' : dataAgeMs < 60_000
      ? `${Math.round(dataAgeMs / 1000)}s`
      : dataAgeMs < 3_600_000
        ? `${Math.round(dataAgeMs / 60_000)} min`
        : `${Math.round(dataAgeMs / 3_600_000)} h`;
    const stalenessHtml = stalenessLabel
      ? `<span style="color:${isStale ? '#f59e0b' : '#6f7080'}; font-size:10px;">${isStale ? fmStatusDot('medium') + ' ' : ''}${stalenessLabel}</span>`
      : '';
    const draught = ship.draught != null && ship.draught > 0 ? `${ship.draught.toFixed(1)} m` : '';
    const headingValue = this.normalizeAngle(ship.heading);
    const cogValue = this.normalizeAngle(ship.cog);
    const heading = headingValue != null ? `${headingValue}°` : '';
    const cog = cogValue != null ? `${cogValue}°` : '';
    const speedText = ship.speed > 0 ? `${ship.speed.toFixed(1)} kn` : 'À l\'arrêt';

    const row = (label: string, value?: string): string => {
      if (!value) return '';
      return `
        <div style="display:flex; justify-content:space-between; gap:12px; margin-top:2px;">
          <span style="color:#7a7a8a; font-size:11px;">${label}</span>
          <span style="color:#e8e8ec; font-size:11px;">${value}</span>
        </div>
      `;
    };

    const wrapperStyle = [
      'padding:10px 14px',
      'background:rgba(18, 18, 26, 0.95)',
      'color:#e8e8ec',
      'border-radius:8px',
      'font-size:12px',
      'font-family:system-ui,-apple-system,sans-serif',
      'border:1px solid rgba(255,255,255,0.15)',
      'box-shadow:0 4px 12px rgba(0,0,0,0.4)',
      'min-width:140px',
    ].join(';');

    return `
      <div style="${wrapperStyle}">
        <div style="font-weight: 600; font-size: 13px; margin-bottom: 6px; color: ${nameColor};">
          ${name}
        </div>
        <div style="color: ${typeColor}; margin-bottom: 4px;">
          ${typeIcon} ${typeLabel}
          ${shipType > 0 ? `<span style="color:#6f7080; font-size:11px;"> (${shipType})</span>` : ''}
        </div>
        <div style="display: flex; justify-content: space-between; gap: 12px;">
          <span style="color: #6c8cff;">
            ${speedText}
          </span>
          ${mmsi ? `<span style="color: #666; font-size: 10px;">MMSI ${mmsi}</span>` : ''}
        </div>
        ${countryHtml ? row('Pavillon', countryHtml) : ''}
        ${callSign ? row('Callsign', callSign) : ''}
        ${imo ? row('IMO', imo) : ''}
        ${navStatus ? row('Statut', navStatus) : ''}
        ${cog || heading ? row('COG/HDG', `${cog || 'n.d.'} / ${heading || 'n.d.'}`) : ''}
        ${draught ? row('Tirant d\'eau', draught) : ''}
        ${dimensions ? row('Dimensions', dimensions) : ''}
        ${eta ? row('ETA (UTC)', eta) : ''}
        ${route ? `<div style="color:#7a7a8a; font-size:11px; margin-top:4px;">${route}</div>` : ''}
        ${stalenessHtml ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">${stalenessHtml}${lastSeen ? `<span style="color:#6f7080;font-size:10px;">${lastSeen}</span>` : ''}</div>` : lastSeen ? `<div style="color:#6f7080; font-size:10px; margin-top:4px;">${lastSeen}</div>` : ''}
      </div>
      `;
  }

  private getNavStatusLabel(status?: number): string {
    if (status == null || !Number.isFinite(status)) return '';
    switch (status) {
      case 0: return 'En route (moteur)';
      case 1: return 'Au mouillage';
      case 2: return 'Non maître de sa manœuvre';
      case 3: return 'Manœuvrabilité restreinte';
      case 4: return 'Contrainte par tirant d\'eau';
      case 5: return 'Amarré';
      case 6: return 'Échoué';
      case 7: return 'Pêche';
      case 8: return 'Voile';
      case 9: return 'Réservé';
      case 10: return 'Réservé';
      case 11: return 'Réservé';
      case 12: return 'Réservé';
      case 13: return 'Réservé';
      case 14: return 'AIS-SART';
      case 15: return 'Indéfini';
      default: return `Statut ${status}`;
    }
  }

  private formatDimensions(dim?: AisShipData['dimensions']): string {
    if (!dim) return '';
    const length = dim.length ?? (dim.a != null && dim.b != null ? dim.a + dim.b : undefined);
    const width = dim.width ?? (dim.c != null && dim.d != null ? dim.c + dim.d : undefined);
    const parts: string[] = [];
    if (length != null && width != null) {
      parts.push(`L ${Math.round(length)} m × l ${Math.round(width)} m`);
    }
    const abcd = [dim.a, dim.b, dim.c, dim.d].every(v => v != null)
      ? `A/B/C/D ${Math.round(dim.a ?? 0)}/${Math.round(dim.b ?? 0)}/${Math.round(dim.c ?? 0)}/${Math.round(dim.d ?? 0)}`
      : '';
    if (abcd) parts.push(abcd);
    return parts.join(' · ');
  }

  private formatEta(eta?: AisShipData['eta']): string {
    if (!eta) return '';
    const month = eta.month;
    const day = eta.day;
    const hour = eta.hour;
    const minute = eta.minute;
    const validDate = month != null && day != null && month >= 1 && month <= 12 && day >= 1 && day <= 31;
    if (!validDate) return '';
    const date = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
    const validTime = hour != null && minute != null && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
    if (!validTime) return date;
    return `${date} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  private formatLastSeen(ts: number): string {
    const time = new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return `Vu ${time}`;
  }

  private normalizeAngle(value?: number): number | null {
    if (!Number.isFinite(value)) return null;
    const raw = Number(value);
    if (raw < 0 || raw > 360) return null;
    return Math.round(raw === 360 ? 0 : raw);
  }

  private decodeRoute(destination?: string): string {
    if (!destination) return '';
    const raw = destination.replace(/\s+/g, ' ').trim();
    if (!raw) return '';
    const normalized = raw.replace(/\s+/g, '');
    const parts = normalized.split(/>|-|→|\/|·|•|\./).filter(Boolean);
    if (parts.length >= 2) {
      const from = this.decodePortToken(parts[0]);
      const to = this.decodePortToken(parts[1]);
      if (from && to) return `Origine: ${from} → Destination: ${to}`;
    }
    const single = this.decodePortToken(raw);
    return single ? `Destination: ${single}` : '';
  }

  private decodePortToken(token: string): string {
    const cleaned = token.replace(/\s+/g, ' ').trim();
    if (!cleaned) return '';
    return this.decodeDestination(cleaned) || this.escapeHtml(cleaned);
  }

  private decodeDestination(destination?: string): string {
    if (!destination) return '';
    const raw = destination.replace(/\s+/g, ' ').trim();
    if (!raw) return '';
    const upper = raw.toUpperCase();
    const compact = upper.replace(/\s+/g, '');
    const locodeMatch = upper.match(/([A-Z]{2}[A-Z0-9]{3})/) ?? compact.match(/([A-Z]{2}[A-Z0-9]{3})/);
    const locode = locodeMatch?.[1];
    if (locode) {
      const info = AIS_PORT_LOCODES[locode];
      if (info) return this.escapeHtml(`${info.name} (${info.country}) · ${locode}`);
      return this.escapeHtml(`${raw} · ${locode}`);
    }
    const normalized = upper.replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const alias = AIS_DESTINATION_ALIASES[normalized];
    return this.escapeHtml(alias ?? raw);
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private async loadIconAtlas(): Promise<void> {
    if (!this.map) return;
    try {
      // Reuse the mapping fetch started in init() alongside map creation;
      // fall back to a fresh fetch if init() somehow didn't kick it off.
      const mapping = await (this.iconMappingPromise ?? fetch('/assets/dsfr-mapping.json').then(
        (resp) => resp.json() as Promise<Record<string, { x: number; y: number; width: number; height: number }>>,
      ));

      const { data: image } = await this.map.loadImage('/assets/dsfr-atlas.png');

      // Need a canvas context to split the sprite image into individual icons
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      for (const [iconName, rect] of Object.entries(mapping)) {
        canvas.width = rect.width;
        canvas.height = rect.height;
        ctx.clearRect(0, 0, rect.width, rect.height);

        // MapLibre's loadImage returns an ImageBitmap or HTMLImageElement
        ctx.drawImage(image as CanvasImageSource, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
        const imgData = ctx.getImageData(0, 0, rect.width, rect.height);

        if (!this.map.hasImage(iconName)) {
          this.map.addImage(iconName, imgData, {
            pixelRatio: 1,
            sdf: true
          });
        }
      }
      console.log('[DeckGLMap] DSFR Icon Atlas loaded from PNG');
    } catch (e) {
      console.error('[DeckGLMap] Failed to load icon atlas', e);
    }

    // ─── Military custom SVG icons (rendered via offscreen canvas) ───
    this.loadMilitaryIcons();
  }

  /** Render SVG strings into ImageData and register as SDF images for military layers */
  private loadMilitaryIcons(): void {
    if (!this.map) return;

    const SIZE = 64;
    const svgs: Record<string, string> = {
      // ─── Bases militaires (triangles) ───
      'mil-base-air': this.buildSvg(SIZE, `<polygon points="32,6 58,56 6,56" fill="#4a9eff"/>`),
      'mil-base-navy': this.buildSvg(SIZE, `<polygon points="32,6 58,56 6,56" fill="#00d4c8"/>`),
      'mil-base-army': this.buildSvg(SIZE, `<polygon points="32,6 58,56 6,56" fill="#22c55e"/>`),
      'mil-base-joint': this.buildSvg(SIZE, `<polygon points="32,6 58,56 6,56" fill="#a855f7"/>`),
      'mil-base-fortification': this.buildSvg(SIZE, `<polygon points="32,6 58,56 6,56" fill="#78716c"/>`),
      'mil-base-other': this.buildSvg(SIZE, `<polygon points="32,6 58,56 6,56" fill="#f59e0b"/>`),

      // ─── Avions par OPÉRATEUR (legacy, pour compatibilité) ───
      'mil-flight-air': this.buildSvg(SIZE, this.svgFighter('#4a9eff')),
      'mil-flight-marine': this.buildSvg(SIZE, this.svgPatrol('#00d4c8')),
      'mil-flight-gendarmerie': this.buildSvg(SIZE, this.svgHelicopter('#a855f7')),
      'mil-flight-alat': this.buildSvg(SIZE, this.svgHelicopter('#22c55e')),
      'mil-flight-securite-civile': this.buildSvg(SIZE, this.svgPatrol('#ff6b35')),
      'mil-flight-douanes': this.buildSvg(SIZE, this.svgPatrol('#eab308')),
      'mil-flight-unknown': this.buildSvg(SIZE, this.svgPlane('#ffcc00')),

      // ─── Avions par TYPE (nouvelles icônes différenciées) ───
      'mil-type-fighter': this.buildSvg(SIZE, this.svgFighter('#ff3b30')),
      'mil-type-transport': this.buildSvg(SIZE, this.svgTransport('#4a9eff')),
      'mil-type-tanker': this.buildSvg(SIZE, this.svgTanker('#ff9500')),
      'mil-type-awacs': this.buildSvg(SIZE, this.svgAwacs('#a855f7')),
      'mil-type-patrol': this.buildSvg(SIZE, this.svgPatrol('#00d4c8')),
      'mil-type-helicopter': this.buildSvg(SIZE, this.svgHelicopter('#22c55e')),
      'mil-type-drone': this.buildSvg(SIZE, this.svgDrone('#ff6b9d')),
      'mil-type-trainer': this.buildSvg(SIZE, this.svgTrainer('#ffcc00')),
      'mil-type-liaison': this.buildSvg(SIZE, this.svgLiaison('#9898a8')),
      'mil-type-unknown': this.buildSvg(SIZE, this.svgPlane('#9898a8')),
      'air-traffic-flight': this.buildSvg(SIZE, this.svgPlane('#7dd3fc')),

      // ─── Squawk emergency (glow rouge) ───
      'mil-emergency': this.buildSvg(SIZE, this.svgEmergency()),

      // ─── Navire militaire ───
      'mil-ship': this.buildSvg(SIZE, this.svgAnchor('#00d4c8')),
      // ─── Marine nationale (souveraineté) : port base, position de référence (contour pointillé) ; vu en AIS, flux figé (gris) ───
      'mil-ship-ref': this.buildSvg(SIZE, `<circle cx="32" cy="32" r="29" fill="none" stroke="${NAVY_HEX}" stroke-width="3" stroke-dasharray="6 5"/>${this.svgAnchor(NAVY_HEX)}`),
      'mil-ship-stale': this.buildSvg(SIZE, this.svgAnchor(SOV_ABROAD_HEX)),
    };

    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    for (const [name, svgStr] of Object.entries(svgs)) {
      if (this.map?.hasImage(name)) continue;
      const img = new Image(SIZE, SIZE);
      const blob = new Blob([svgStr], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        const imgData = ctx.getImageData(0, 0, SIZE, SIZE);
        URL.revokeObjectURL(url);
        if (this.map && !this.map.hasImage(name)) {
          this.map.addImage(name, imgData, { pixelRatio: 2, sdf: false });
        }
      };
      img.src = url;
    }
  }

  private buildSvg(size: number, inner: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${inner}</svg>`;
  }

  private getAisIconDef(color: string): { url: string; width: number; height: number; anchorX: number; anchorY: number; mask: boolean } {
    const key = color.toLowerCase();
    if (!this.aisIconDefs[key]) {
      const SIZE = 64;
      const triangle = `<polygon points="32,6 58,58 32,48 6,58" fill="${color}"/>`;
      const svg = this.buildSvg(SIZE, triangle);
      const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
      this.aisIconDefs[key] = {
        url,
        width: SIZE,
        height: SIZE,
        anchorX: SIZE / 2,
        anchorY: SIZE / 2,
        mask: false,
      };
    }
    return this.aisIconDefs[key];
  }

  private getAirTrafficIconDef(colorHex: string): { url: string; width: number; height: number; anchorX: number; anchorY: number; mask: boolean } {
    const key = `__air-traffic-${colorHex}`;
    if (!this.aisIconDefs[key]) {
      const SIZE = 64;
      // Inject the hex color directly into the SVG
      const svg = this.buildSvg(SIZE, this.svgPlane(colorHex));
      const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
      this.aisIconDefs[key] = {
        url,
        width: SIZE,
        height: SIZE,
        anchorX: SIZE / 2,
        anchorY: SIZE / 2,
        mask: false,
      };
    }
    return this.aisIconDefs[key];
  }

  // ─── Generic plane (fallback) ───
  private svgPlane(color: string): string {
    return `<g fill="${color}">
      <polygon points="32,4 38,28 58,36 38,34 38,52 44,56 32,52 20,56 26,52 26,34 6,36 26,28" />
    </g>`;
  }

  // ─── Fighter jet (delta wings, aggressive) ───
  private svgFighter(color: string): string {
    return `<g fill="${color}">
      <polygon points="32,2 40,24 60,32 40,30 40,50 46,58 32,52 18,58 24,50 24,30 4,32 24,24" />
    </g>`;
  }

  // ─── Transport (big fuselage, straight wings) ───
  private svgTransport(color: string): string {
    return `<g fill="${color}">
      <ellipse cx="32" cy="32" rx="8" ry="26" />
      <rect x="4" y="28" width="56" height="8" rx="2" />
      <polygon points="26,54 32,62 38,54" />
    </g>`;
  }

  // ─── Tanker (transport with boom) ───
  private svgTanker(color: string): string {
    return `<g fill="${color}">
      <ellipse cx="32" cy="30" rx="7" ry="22" />
      <rect x="6" y="26" width="52" height="7" rx="2" />
      <line x1="32" y1="52" x2="32" y2="62" stroke="${color}" stroke-width="3"/>
      <polygon points="28,60 32,62 36,60" />
    </g>`;
  }

  // ─── AWACS (with rotodome) ───
  private svgAwacs(color: string): string {
    return `<g fill="${color}">
      <ellipse cx="32" cy="34" rx="7" ry="20" />
      <rect x="8" y="30" width="48" height="7" rx="2" />
      <ellipse cx="32" cy="22" rx="14" ry="4" fill="${color}" opacity="0.7"/>
      <rect x="30" y="18" width="4" height="8" />
    </g>`;
  }

  // ─── Maritime patrol (long wings) ───
  private svgPatrol(color: string): string {
    return `<g fill="${color}">
      <ellipse cx="32" cy="32" rx="6" ry="24" />
      <rect x="2" y="28" width="60" height="6" rx="2" />
      <polygon points="28,54 32,60 36,54" />
    </g>`;
  }

  // ─── Helicopter (rotor visible) ───
  private svgHelicopter(color: string): string {
    return `<g fill="${color}">
      <ellipse cx="32" cy="36" rx="10" ry="16" />
      <rect x="30" y="52" width="4" height="8" />
      <rect x="20" y="58" width="24" height="3" rx="1" />
      <line x1="32" y1="20" x2="32" y2="12" stroke="${color}" stroke-width="2"/>
      <line x1="14" y1="12" x2="50" y2="12" stroke="${color}" stroke-width="3" stroke-linecap="round"/>
    </g>`;
  }

  // ─── Drone/UAV (slim, long wings) ───
  private svgDrone(color: string): string {
    return `<g fill="${color}">
      <ellipse cx="32" cy="32" rx="4" ry="20" />
      <rect x="4" y="30" width="56" height="4" rx="1" />
      <polygon points="30,50 32,58 34,50" />
      <polygon points="28,14 32,6 36,14" fill="${color}" opacity="0.6"/>
    </g>`;
  }

  // ─── Trainer (small, simple) ───
  private svgTrainer(color: string): string {
    return `<g fill="${color}">
      <ellipse cx="32" cy="32" rx="6" ry="18" />
      <rect x="12" y="28" width="40" height="6" rx="2" />
      <polygon points="28,48 32,54 36,48" />
    </g>`;
  }

  // ─── Liaison (very small) ───
  private svgLiaison(color: string): string {
    return `<g fill="${color}">
      <ellipse cx="32" cy="32" rx="5" ry="14" />
      <rect x="16" y="30" width="32" height="4" rx="1" />
      <polygon points="30,44 32,50 34,44" />
    </g>`;
  }

  // ─── Emergency (pulsing glow) ───
  private svgEmergency(): string {
    return `<g>
      <circle cx="32" cy="32" r="28" fill="rgba(255,59,48,0.3)"/>
      <circle cx="32" cy="32" r="20" fill="rgba(255,59,48,0.5)"/>
      <polygon points="32,8 38,26 56,32 38,30 38,48 42,54 32,50 22,54 26,48 26,30 8,32 26,26" fill="#ff3b30"/>
    </g>`;
  }

  private svgAnchor(color: string): string {
    return `<g fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="32" cy="12" r="5" />
    
    <line x1="32" y1="17" x2="32" y2="48" />
    
    <line x1="18" y1="24" x2="46" y2="24" />
    
    <path d="M14 40 C 14 54, 50 54, 50 40" />
    <path fill="${color}" stroke="none" d="M14 42 l-4 -6 l8 0 z" /> <path fill="${color}" stroke="none" d="M50 42 l-4 -6 l8 0 z" /> </g>`;
  }


  /**
   * Create the DOM overlay container for pulse animations.
   */
  private initPulseOverlay(): void {
    this.pulseOverlay = document.createElement('div');
    this.pulseOverlay.className = 'pulse-overlay';
    this.container.appendChild(this.pulseOverlay);
  }

  /**
   * Sync pulse markers with critical/high news items.
   * Called after updateNews() to create/update DOM markers.
   */
  private syncPulseMarkers(): void {
    if (!this.pulseOverlay || !this.map) return;

    // Get critical and high items with coordinates
    const alertItems = this.newsItems.filter(
      (item) =>
        item.lat != null &&
        item.lon != null &&
        (item.threat?.level === 'critical' || item.threat?.level === 'high')
    );

    // Remove markers for items no longer in the list
    const currentIds = new Set(alertItems.map((i) => i.id));
    for (const [id, marker] of this.pulseMarkers) {
      if (!currentIds.has(id)) {
        marker.remove();
        this.pulseMarkers.delete(id);
      }
    }

    // Create or update markers
    for (const item of alertItems) {
      let marker = this.pulseMarkers.get(item.id);
      if (!marker) {
        marker = this.createPulseMarker(item);
        this.pulseOverlay.appendChild(marker);
        this.pulseMarkers.set(item.id, marker);
      }
      // Update position
      const pos = this.map.project([item.lon!, item.lat!]);
      marker.style.left = `${pos.x}px`;
      marker.style.top = `${pos.y}px`;

      // Hide if clustered (zoom < 12 and point is in a cluster area)
      const zoom = this.map.getZoom();
      const isVisible = (this.currentLayers?.news ?? true) && zoom >= 10;
      marker.style.display = isVisible ? 'block' : 'none';
    }
  }

  /**
   * Create a pulse marker DOM element for a critical/high alert.
   */
  private createPulseMarker(item: NewsItem): HTMLElement {
    const marker = document.createElement('div');
    const level = item.threat?.level ?? 'high';
    marker.className = `pulse-marker ${level === 'critical' ? '' : 'pulse-marker--high'}`;
    marker.innerHTML = `
      <div class="pulse-marker__ring"></div>
      <div class="pulse-marker__ring pulse-marker__ring--delayed"></div>
    `;
    return marker;
  }

  /**
   * Update positions of all pulse markers (called on map move/zoom).
   */
  private updatePulseMarkerPositions(): void {
    if (!this.map) return;

    const zoom = this.map.getZoom();
    const bounds = this.map.getBounds();
    const layerVisible = (this.currentLayers?.news ?? true) && zoom >= 10;

    for (const [id, marker] of this.pulseMarkers) {
      const item = this.itemsById.get(id);
      if (item && item.lon != null && item.lat != null) {
        // Skip projecting markers that are hidden or outside the viewport
        if (!layerVisible || !bounds.contains([item.lon, item.lat])) {
          marker.style.display = 'none';
          continue;
        }
        const pos = this.map.project([item.lon, item.lat]);
        marker.style.left = `${pos.x}px`;
        marker.style.top = `${pos.y}px`;
        marker.style.display = 'block';
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  updateNews(items: NewsItem[]): void {
    this.newsItems = items.filter((i) => i.lat != null && i.lon != null);
    this.itemsById.clear();
    for (const it of this.newsItems) this.itemsById.set(it.id, it);
    this.syncNewsSource();
    // Sync pulse markers for critical/high alerts
    this.syncPulseMarkers();
  }

  selectItem(item: NewsItem | null): void {
    if (!this.map) return;
    const src = this.map.getSource(SRC_SEL) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (item && item.lat != null && item.lon != null) {
      src.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [item.lon, item.lat] },
          properties: {},
        }],
      });
    } else {
      src.setData(emptyFC());
    }
  }

  // ─── Legend Highlight (Hover) ───
  setLegendHover(categoryId: string | null): void {
    if (!this.map) return;
    const previousCategory = this.legendHoverCategory;
    this.legendHoverCategory = categoryId;
    const explicitOpacityLayers: Array<{ layerId: string; prop: string }> = [
      { layerId: LYR_NET_IODA_CLUSTER, prop: 'circle-opacity' },
      { layerId: LYR_NET_IODA_CLUSTER_COUNT, prop: 'text-opacity' },
      { layerId: LYR_NET_IODA_GLOW, prop: 'circle-opacity' },
      { layerId: LYR_NET_IODA_CORE, prop: 'circle-opacity' },
      { layerId: LYR_NET_ISP_CLUSTER, prop: 'circle-opacity' },
      { layerId: LYR_NET_ISP_CLUSTER_COUNT, prop: 'text-opacity' },
      { layerId: LYR_NET_ISP_GLOW, prop: 'circle-opacity' },
      { layerId: LYR_NET_ISP_RING, prop: 'circle-stroke-opacity' },
      { layerId: LYR_NET_ISP, prop: 'circle-opacity' },
      { layerId: LYR_DC_CLUSTER, prop: 'circle-opacity' },
      { layerId: LYR_DC_CLUSTER_COUNT, prop: 'text-opacity' },
      { layerId: LYR_DC_GLOW, prop: 'circle-opacity' },
      { layerId: LYR_DC_CORE, prop: 'icon-opacity' },
      { layerId: LYR_IXP_CLUSTER, prop: 'circle-opacity' },
      { layerId: LYR_IXP_CLUSTER_COUNT, prop: 'text-opacity' },
      { layerId: LYR_IXP_CIRCLE, prop: 'icon-opacity' },
    ];

    const allLegendLayers = [
      LYR_HEALTH_ALERT_FILL, LYR_HEALTH_ALERT_LINE,
      LYR_HEALTH_URG_FILL, LYR_HEALTH_URG_LINE,
      LYR_HEALTH_APL_FILL, LYR_HEALTH_APL_LINE,
      LYR_HOSPITALS,
      LYR_POWER_FILL, LYR_POWER_LINE,
      LYR_CITIZEN_FILL, LYR_CITIZEN_LINE,
      LYR_TELECOM_PTS,
      LYR_NET_IODA_CLUSTER, LYR_NET_IODA_CLUSTER_COUNT, LYR_NET_IODA_GLOW, LYR_NET_IODA_CORE,
      LYR_NET_ISP_CLUSTER, LYR_NET_ISP_CLUSTER_COUNT, LYR_NET_ISP_GLOW, LYR_NET_ISP_RING, LYR_NET_ISP,
      LYR_DC_CLUSTER, LYR_DC_CLUSTER_COUNT, LYR_DC_GLOW, LYR_DC_CORE,
      LYR_IXP_CLUSTER, LYR_IXP_CLUSTER_COUNT, LYR_IXP_CIRCLE,
      LYR_TRAFFIC, ...Object.values(TRAFFIC_LAYER_KEYS).flat(), LYR_TRAIN_ROUTE, LYR_TRAIN_STATIONS,
      ...Object.values(ENV_LAYER_KEYS).flat(), ...FOREST_DANGER_LAYERS,
    ];

    let activeLayers: string[] = [];
    if (categoryId === 'health') {
      activeLayers = [LYR_HEALTH_ALERT_FILL, LYR_HEALTH_ALERT_LINE];
    } else if (categoryId === 'healthApl') {
      activeLayers = [LYR_HEALTH_APL_FILL, LYR_HEALTH_APL_LINE];
    } else if (categoryId === 'healthOscour') {
      activeLayers = [LYR_HEALTH_URG_FILL, LYR_HEALTH_URG_LINE];
    } else if (categoryId === 'hospitals') {
      activeLayers = [LYR_HOSPITALS];
    } else if (categoryId === 'outagesElec') {
      activeLayers = [LYR_POWER_FILL, LYR_POWER_LINE, LYR_CITIZEN_FILL, LYR_CITIZEN_LINE];
    } else if (categoryId === 'outagesTelecom') {
      activeLayers = [LYR_TELECOM_PTS];
    } else if (categoryId === 'outagesInternet') {
      activeLayers = [
        LYR_NET_IODA_CLUSTER, LYR_NET_IODA_CLUSTER_COUNT, LYR_NET_IODA_GLOW, LYR_NET_IODA_CORE,
        LYR_NET_ISP_CLUSTER, LYR_NET_ISP_CLUSTER_COUNT, LYR_NET_ISP_GLOW, LYR_NET_ISP_RING, LYR_NET_ISP,
      ];
    } else if (categoryId === 'outagesCloud') {
      activeLayers = [
        LYR_DC_CLUSTER, LYR_DC_CLUSTER_COUNT, LYR_DC_GLOW, LYR_DC_CORE,
        LYR_IXP_CLUSTER, LYR_IXP_CLUSTER_COUNT, LYR_IXP_CIRCLE,
      ];
    } else if (categoryId === 'trafficRoad') {
      activeLayers = [LYR_TRAFFIC, ...TRAFFIC_LAYER_KEYS.trafficRoad];
    } else if (categoryId === 'trafficAir') {
      activeLayers = [...TRAFFIC_LAYER_KEYS.trafficAir];
    } else if (categoryId === 'trafficRail') {
      activeLayers = [...TRAFFIC_LAYER_KEYS.trafficRail, LYR_TRAIN_ROUTE, LYR_TRAIN_STATIONS];
    } else if (categoryId === 'trafficMaritime') {
      activeLayers = [...TRAFFIC_LAYER_KEYS.trafficMaritime];
    } else if (categoryId === 'environmental') {
      activeLayers = [...ENV_LAYER_KEYS.environmental];
    } else if (categoryId === 'floods') {
      activeLayers = [...ENV_LAYER_KEYS.floods];
    } else if (categoryId === 'weatherRadar') {
      activeLayers = [...ENV_LAYER_KEYS.weatherRadar];
    } else if (categoryId === 'fires') {
      activeLayers = [...ENV_LAYER_KEYS.fires, ...FOREST_DANGER_LAYERS];
    } else if (categoryId === 'drought' || categoryId === 'airQuality' || categoryId === 'earthquakes') {
      activeLayers = [...ENV_LAYER_KEYS[categoryId]];
    }

    const applyLegendDim = (layerId: string, prop: string, orig: unknown): void => {
      if (categoryId === null || activeLayers.length === 0) {
        // Reset to original
        this.map!.setPaintProperty(layerId, prop, orig);
        return;
      }
      const isTarget = activeLayers.includes(layerId);
      // If original is an expression, wrap it down to smaller scale
      if (Array.isArray(orig)) {
        this.map!.setPaintProperty(layerId, prop, ['*', orig, isTarget ? 1 : 0.15]);
      } else {
        this.map!.setPaintProperty(layerId, prop, isTarget ? orig : Number(orig) * 0.15);
      }
    };

    allLegendLayers.forEach(layerId => {
      const layer = this.map!.getLayer(layerId);
      if (!layer) return;

      if (!this.originalOpacities.has(layerId)) {
        let prop = 'fill-opacity';
        if (layer.type === 'line') prop = 'line-opacity';
        if (layer.type === 'circle') prop = 'circle-opacity';
        if (layer.type === 'symbol') {
          const symbolLayout = (layer as { layout?: Record<string, unknown> }).layout;
          prop = symbolLayout?.['icon-image'] ? 'icon-opacity' : 'text-opacity';
        }
        if (layer.type === 'heatmap') prop = 'heatmap-opacity';
        if (layer.type === 'raster') prop = 'raster-opacity';
        if (layerId === LYR_NET_ISP_RING) prop = 'circle-stroke-opacity';

        const orig = this.map!.getPaintProperty(layerId, prop) ?? 1;
        this.originalOpacities.set(layerId, { prop, orig });
      }

      const { prop, orig } = this.originalOpacities.get(layerId)!;
      applyLegendDim(layerId, prop, orig);
    });

    // Contours colorés des Trafics (anneau des signalements AIS, aéroports, mouillages, urgences, arrêts du trajet d'un train) :
    // atténués avec leur couche, en plus du remplissage.
    for (const layerId of TRAFFIC_STROKE_DIM_LAYERS) {
      if (!this.map.getLayer(layerId)) continue;
      const key = `${layerId}::stroke`;
      if (!this.originalOpacities.has(key)) {
        this.originalOpacities.set(key, { prop: 'circle-stroke-opacity', orig: this.map.getPaintProperty(layerId, 'circle-stroke-opacity') ?? 1 });
      }
      const { prop, orig } = this.originalOpacities.get(key)!;
      applyLegendDim(layerId, prop, orig);
    }

    const outageFocusGroups: Record<string, string[]> = {
      outagesInternet: [
        LYR_NET_IODA_CLUSTER, LYR_NET_IODA_CLUSTER_COUNT, LYR_NET_IODA_GLOW, LYR_NET_IODA_CORE,
        LYR_NET_ISP_CLUSTER, LYR_NET_ISP_CLUSTER_COUNT, LYR_NET_ISP_GLOW, LYR_NET_ISP_RING, LYR_NET_ISP,
      ],
      outagesCloud: [
        LYR_DC_CLUSTER, LYR_DC_CLUSTER_COUNT, LYR_DC_GLOW, LYR_DC_CORE,
        LYR_IXP_CLUSTER, LYR_IXP_CLUSTER_COUNT, LYR_IXP_CIRCLE,
      ],
    };

    const focusedOutageLayers = categoryId ? outageFocusGroups[categoryId] : undefined;
    if (focusedOutageLayers) {
      explicitOpacityLayers.forEach(({ layerId, prop }) => {
        const layer = this.map!.getLayer(layerId);
        if (!layer) return;
        const base = this.originalOpacities.get(layerId)?.orig ?? this.map!.getPaintProperty(layerId, prop) ?? 1;
        const isTarget = focusedOutageLayers.includes(layerId);
        if (Array.isArray(base)) {
          this.map!.setPaintProperty(layerId, prop, ['*', base, isTarget ? 1 : 0.28]);
        } else {
          this.map!.setPaintProperty(layerId, prop, isTarget ? base : Number(base) * 0.28);
        }
      });
    }

    if (previousCategory !== categoryId) {
      this.refreshAisLayers();
      this.map.triggerRepaint();
    }
  }

  // ─── Satellite basemap ───

  /**
   * Toggle between Carto Dark Matter (default) and Esri World Imagery satellite basemap.
   * When satellite is active, Carto fill/background layers are hidden so imagery is
   * fully visible; road lines and symbol labels remain on top for context.
   */
  setBasemapSatellite(enabled: boolean): void {
    if (!this.map) return;
    if (this._satelliteMode === enabled) return;
    this._satelliteMode = enabled;

    this.map.setLayoutProperty(LYR_SATELLITE, 'visibility', enabled ? 'visible' : 'none');

    const style = this.map.getStyle();
    for (const layer of style.layers ?? []) {
      if (layer.id === LYR_SATELLITE) continue;
      if (layer.id.startsWith('wm-')) continue; // never touch our custom data layers
      if (!(layer.type === 'fill' || layer.type === 'background' || layer.type === 'fill-extrusion')) continue;

      if (enabled) {
        const currentVisibility = this.map.getLayoutProperty(layer.id, 'visibility');
        this._basemapLayerVisibility.set(
          layer.id,
          currentVisibility === 'none' ? 'none' : 'visible',
        );
        this.map.setLayoutProperty(layer.id, 'visibility', 'none');
        continue;
      }

      const previousVisibility = this._basemapLayerVisibility.get(layer.id) ?? 'visible';
      this.map.setLayoutProperty(layer.id, 'visibility', previousVisibility);
    }

    if (!enabled) this._basemapLayerVisibility.clear();
  }

  getSatelliteMode(): boolean { return this._satelliteMode; }

  // ─── Events ───
  setOnItemClick(h: (item: NewsItem) => void): void { this.onItemClick = h; }
  setOnRawMapClick(h: (lat: number, lon: number) => void): void { this.onRawMapClick = h; }
  setOnItemHover(h: (item: NewsItem | null, x: number, y: number) => void): void { this.onItemHover = h; }
  setOnViewChange(h: (vs: MapViewState) => void): void { this.onViewChange = h; }
  /**
   * Set callback for cluster hover - receives list of items in the cluster.
   * Called when user hovers over a cluster with up to 20 preview items.
   */
  setOnClusterHover(h: (items: NewsItem[], x: number, y: number, totalCount: number) => void): void {
    this.onClusterHover = h;
  }

  /**
   * Set callback for cluster click at max zoom - receives ALL items in the cluster.
   * Called when cluster can't expand further (zoom max reached).
   */
  setOnClusterClick(h: (items: NewsItem[], center: [number, number]) => void): void {
    this.onClusterClick = h;
  }

  setOnSatelliteView(handler: (request: SatelliteViewRequest) => void): void {
    this.onSatelliteView = handler;
  }

  project(longitude: number, latitude: number): { x: number; y: number } | null {
    if (!this.map) return null;
    const point = this.map.project([longitude, latitude]);
    return { x: point.x, y: point.y };
  }

  /**
   * Fly-to cinématographique avec arc parabolique et easing fluide.
   * Crée une expérience visuelle engageante lorsque l'utilisateur clique sur un article.
   */
  /** Retourne [minLng, minLat, maxLng, maxLat] de la vue courante, ou null si la carte n'est pas prête. */
  getBounds(): [number, number, number, number] | null {
    if (!this.map) return null;
    const b = this.map.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  }

  flyTo(longitude: number, latitude: number, zoom = 10): void {
    if (!this.map) return;

    // Calculer la distance pour ajuster la durée
    const currentCenter = this.map.getCenter();
    const dx = longitude - currentCenter.lng;
    const dy = latitude - currentCenter.lat;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Durée adaptative : plus long pour les grandes distances
    // Min 1.2s (local), max 2.5s (traversée France)
    const duration = Math.min(2500, Math.max(1200, distance * 300));

    this.map.flyTo({
      center: [longitude, latitude],
      zoom,
      pitch: 0,                           // Vue à plat
      curve: 1.42,                        // Arc parabolique (hauteur du survol)
      speed: 1.2,                         // Vitesse relative fluide
      easing: (t) => t * (2 - t),         // Ease-out quadratique (décélération douce)
      essential: true,                    // Priorité animation (ignore prefers-reduced-motion)
      duration,
    });
  }

  fitBounds(bounds: [number, number, number, number], padding = 60): void {
    if (!this.map) return;
    this.map.fitBounds(
      [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
      { padding, duration: 1200, essential: true, pitch: 0 },
    );
  }

  getViewState(): MapViewState { return { ...this.viewState }; }

  // ─── Energy Layer ───

  async updateEnergy(ecowatt: EcowattResponse): Promise<void> {
    if (!this.map) return;
    try {
      // Le signal Écowatt officiel est NATIONAL (pas de signal par région) : conservé pour
      // l'info-bulle région (une seule ligne « signal national »), jamais pour la couleur des
      // régions ci-dessous.
      this.lastEcowattOfficial = ecowatt.official ?? null;
      const mixes = ecowatt.mixes ?? {};
      const interconnections = ecowatt.interconnections ?? [];

      const resp = await fetch('/data/regions.geojson');
      if (!resp.ok) return;
      const geojson = await resp.json() as GeoJSON.FeatureCollection;
      // Couleur des régions : solde production/consommation éco2mix, indicatif — PAS une
      // vigilance. Palette bleue/violette neutre (jamais vert/orange/rouge).
      for (const feat of geojson.features) {
        const code = (feat.properties?.code as string) ?? '';
        const productionTotalMW = mixes[code]?.total;
        const consumptionMW = this.energyRegionStats.get(code)?.consumptionMW;
        const balance = regionEnergyBalance(consumptionMW, productionTotalMW);
        feat.properties = {
          ...feat.properties,
          fillColor: REGION_BALANCE_COLORS[balance],
          lineColor: REGION_BALANCE_LINE_COLORS[balance],
          regionBalance: balance,
        };
      }
      const src = this.map.getSource(SRC_POWER_REGIONS) as maplibregl.GeoJSONSource;
      src?.setData(geojson);

      // --- Interconnections (curved arcs + endpoint markers) ---
      if (interconnections && interconnections.length > 0) {
        // Border point coordinates for each interconnection
        const borderCoords: Record<string, [number, number]> = {
          'Royaume-Uni': [0.8, 50.8],      // Near Calais / Channel
          'Espagne': [-0.5, 42.8],         // Western Pyrénées
          'Italie': [7.6, 44.0],           // Alpes (Monaco/Vintimille)
          'Suisse': [6.8, 46.8],           // Geneva/Basel area
          'All./Bel.': [7.2, 49.4],        // Lorraine/Luxembourg area
        };

        // Create point features for endpoint markers
        // Use ELECTRIC_FLOW_STYLE colors: bright cyan/neon green
        const pointFeatures: GeoJSON.Feature[] = interconnections.map(ic => {
          const coords = borderCoords[ic.country] || ic.coordinates;
          const { isImport, color } = resolveFlowDirection(
            ic.flowMW, ic.country, coords,
            ELECTRIC_FLOW_STYLE.exportColor, ELECTRIC_FLOW_STYLE.importColor,
            ELECTRIC_FLOW_STYLE.glowExportColor, ELECTRIC_FLOW_STYLE.glowImportColor,
          );
          const flowAbs = Math.abs(ic.flowMW);
          const sign = isImport ? '+' : '-';
          const label = `${ic.country}\n${sign}${flowAbs} MW`;
          const radius = Math.min(14, Math.max(6, 6 + flowAbs / 1000));

          return {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: coords },
            properties: { color, radius, label }
          };
        });

        // Create arc features (curved lines from France center to border)
        // Electric flow: OSINT style with configurable colors
        const cfg = getElectricFlowConfig();
        this.interconnArcs = [];  // Reset stored arcs

        const arcFeatures: GeoJSON.Feature[] = interconnections.map(ic => {
          const coords = borderCoords[ic.country] || ic.coordinates;
          const { isImport, color, glowColor, arcFrom, arcTo } = resolveFlowDirection(
            ic.flowMW, ic.country, coords,
            cfg.exportColor, cfg.importColor,
            cfg.glowExportColor, cfg.glowImportColor,
          );
          const flowAbs = Math.abs(ic.flowMW);

          const { minLineWidth, maxLineWidth, lineWidthDivisor, glowIntensity } = cfg;
          const lineWidth = Math.min(maxLineWidth, Math.max(minLineWidth, minLineWidth + flowAbs / lineWidthDivisor));
          const glowWidth = lineWidth * glowIntensity;

          const arcCoords = generateArc(arcFrom, arcTo, cfg.curvature, cfg.steps);

          this.interconnArcs.push({
            coords: arcCoords,
            color,
            isImport,
            mw: flowAbs
          });

          return {
            type: 'Feature' as const,
            geometry: { type: 'LineString' as const, coordinates: arcCoords },
            properties: {
              color,
              glowColor,
              lineWidth,
              glowWidth,
              isImport,
              country: ic.country
            }
          };
        });

        // Update sources
        const intSrc = this.map.getSource(SRC_INTERCONN) as maplibregl.GeoJSONSource;
        intSrc?.setData({ type: 'FeatureCollection', features: pointFeatures });

        const arcSrc = this.map.getSource(SRC_INTERCONN_ARCS) as maplibregl.GeoJSONSource;
        arcSrc?.setData({ type: 'FeatureCollection', features: arcFeatures });

        // Start arc flow animation (generates chevron points)
        this.startInterconnAnimation();
      } else {
        const intSrc = this.map.getSource(SRC_INTERCONN) as maplibregl.GeoJSONSource;
        intSrc?.setData(emptyFC());
        const arcSrc = this.map.getSource(SRC_INTERCONN_ARCS) as maplibregl.GeoJSONSource;
        arcSrc?.setData(emptyFC());
        const chevSrc = this.map.getSource(SRC_INTERCONN_CHEVRON_PTS) as maplibregl.GeoJSONSource;
        chevSrc?.setData(emptyFC());
        this.interconnArcs = [];
        this.stopInterconnAnimation();
      }
    } catch (e) {
      console.warn('[DeckGLMap] Failed to load regions for energy layer', e);
    }
  }

  /** Met à jour les données d'info-bulles énergie (régions + flux). */
  updateEnergyTooltipData(
    regions: import('../types/index.ts').RegionEnergyStats[],
    flows: import('../types/index.ts').InterconnectionFlowStats[],
    history?: import('../services/energy-regions.ts').BorderHistory,
  ): void {
    this.energyRegionStats.clear();
    for (const r of regions) this.energyRegionStats.set(r.regionCode, r);
    this.energyFlowStats.clear();
    for (const f of flows) this.energyFlowStats.set(f.id, f);
    if (history) {
      this.energyBorderHistory.clear();
      for (const [id, series] of history) this.energyBorderHistory.set(id, series);
    }
  }

  /**
   * Create chevron icon for electric flow visualization.
   * Uses canvas to draw a simple chevron arrow.
   */
  private async createChevronIcon(): Promise<void> {
    if (!this.map) return;
    if (this.map.hasImage('chevron-electric')) return;

    // Create chevron SVG - clean arrow pointing RIGHT (0° rotation)
    const size = 32;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <path d="M8,6 L20,16 L8,26" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

    return new Promise<void>((resolve) => {
      const img = new Image(size, size);
      img.onload = () => {
        if (!this.map) { resolve(); return; }
        if (this.map.hasImage('chevron-electric')) { resolve(); return; }
        this.map.addImage('chevron-electric', img, { sdf: true });
        resolve();
      };
      img.onerror = () => {
        console.warn('[DeckGLMap] Failed to load chevron icon');
        resolve();
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  /** Triangle SDF icon pour les raffineries (▲ actif, ▼ maintenance via icon-rotate). */
  private async createRefineryTriangleIcon(): Promise<void> {
    if (!this.map) return;
    if (this.map.hasImage('triangle-refinery')) return;

    const size = 64;
    // Triangle équilatéral pointant vers le haut, centré dans le canvas
    const margin = 3;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <polygon points="${size / 2},${margin} ${size - margin},${size - margin} ${margin},${size - margin}"
               fill="white"/>
    </svg>`;

    return new Promise<void>((resolve) => {
      const img = new Image(size, size);
      img.onload = () => {
        if (!this.map) { resolve(); return; }
        if (this.map.hasImage('triangle-refinery')) { resolve(); return; }
        this.map.addImage('triangle-refinery', img, { sdf: true });
        resolve();
      };
      img.onerror = () => {
        console.warn('[DeckGLMap] Failed to load triangle-refinery icon');
        resolve();
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  /** Triangle SDF icon pour les datacenters (▲). */
  private async createDcTriangleIcon(): Promise<void> {
    if (!this.map) return;
    if (this.map.hasImage('triangle-dc')) return;
    const size = 64;
    const margin = 4;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <polygon points="${size / 2},${margin} ${size - margin},${size - margin} ${margin},${size - margin}" fill="white"/>
    </svg>`;
    return new Promise<void>((resolve) => {
      const img = new Image(size, size);
      img.onload = () => {
        if (!this.map) { resolve(); return; }
        if (this.map.hasImage('triangle-dc')) { resolve(); return; }
        this.map.addImage('triangle-dc', img, { sdf: true });
        resolve();
      };
      img.onerror = () => { console.warn('[DeckGLMap] Failed to load triangle-dc icon'); resolve(); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  /** Square SDF icon pour les IXP (■). */
  private async createIxpSquareIcon(): Promise<void> {
    if (!this.map) return;
    if (this.map.hasImage('square-ixp')) return;
    const size = 64;
    const m = 5;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect x="${m}" y="${m}" width="${size - m * 2}" height="${size - m * 2}" fill="white"/>
    </svg>`;
    return new Promise<void>((resolve) => {
      const img = new Image(size, size);
      img.onload = () => {
        if (!this.map) { resolve(); return; }
        if (this.map.hasImage('square-ixp')) { resolve(); return; }
        this.map.addImage('square-ixp', img, { sdf: true });
        resolve();
      };
      img.onerror = () => { console.warn('[DeckGLMap] Failed to load square-ixp icon'); resolve(); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  /**
   * Start the chevron animation for interconnection arcs.
   * Generates point features that move continuously along arc paths.
   * Uses requestAnimationFrame for smooth 60fps-friendly rendering.
   */
  private startInterconnAnimation(): void {
    if (this.chevronAnimFrame !== null) return;
    if (!this.map) return;

    let lastUpdate = 0;

    const animate = (timestamp: number) => {
      if (!this.map) return;

      const cfg = getElectricFlowConfig();
      const deltaMs = lastUpdate === 0 ? 16 : Math.min(48, timestamp - lastUpdate);
      lastUpdate = timestamp;

      // Advance animation phase from elapsed time so motion stays smooth and speed-stable.
      this.chevronPhase = (this.chevronPhase + cfg.chevronSpeed * deltaMs * 0.00045) % 1;

      // Generate chevron point features for each arc
      const chevronFeatures: GeoJSON.Feature[] = [];

      for (const arc of this.interconnArcs) {
        const { coords, color, mw } = arc;
        if (coords.length < 2) continue;

        // Number of chevrons based on arc length and spacing config
        // More MW = slightly more chevrons
        const arcLen = coords.length;
        const baseCount = Math.max(3, Math.floor(arcLen / (cfg.chevronSpacing / 2)));
        const mwBonus = Math.min(2, Math.floor(mw / 2000));
        const numChevrons = baseCount + mwBonus;

        // Size based on MW (proportional, with min/max) - increased base size
        const sizeBase = cfg.chevronSize * (1.0 + Math.min(0.5, mw / 4000));

        for (let i = 0; i < numChevrons; i++) {
          // Position along arc (0 to 1), offset by animation phase
          // Arc direction: imports go border→center, exports go center→border
          // Both move in direction of increasing t (following the arc)
          const t = (i / numChevrons + this.chevronPhase) % 1;

          // Get point on arc
          const [lng, lat] = this.interpolateArcPoint(coords, t);

          // Use the projected tangent so the chevron orientation follows the visible curve.
          const rotation = this.computeArcScreenRotation(coords, t);

          chevronFeatures.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: { color, rotation, size: sizeBase }
          });
        }
      }

      // Update chevron points source
      try {
        const src = this.map.getSource(SRC_INTERCONN_CHEVRON_PTS) as maplibregl.GeoJSONSource;
        src?.setData({ type: 'FeatureCollection', features: chevronFeatures });
      } catch {
        // Source may not be ready
      }

      this.chevronAnimFrame = requestAnimationFrame(animate);
    };

    this.chevronAnimFrame = requestAnimationFrame(animate);
  }

  /**
   * Stop the interconnection arc animation.
   */
  private stopInterconnAnimation(): void {
    if (this.chevronAnimFrame !== null) {
      cancelAnimationFrame(this.chevronAnimFrame);
      this.chevronAnimFrame = null;
    }
  }

  private interpolateArcPoint(coords: [number, number][], t: number): [number, number] {
    if (coords.length === 0) return FRANCE_CENTER;
    if (coords.length === 1) return coords[0] as [number, number];

    const clampedT = Math.max(0, Math.min(1, t));
    const scaledIndex = clampedT * (coords.length - 1);
    const idx = Math.min(Math.floor(scaledIndex), coords.length - 2);
    const frac = scaledIndex - idx;
    const p1 = coords[idx] as [number, number];
    const p2 = coords[idx + 1] as [number, number];

    return [
      p1[0] + frac * (p2[0] - p1[0]),
      p1[1] + frac * (p2[1] - p1[1])
    ];
  }

  private computeArcScreenRotation(coords: [number, number][], t: number): number {
    if (!this.map || coords.length < 2) return 0;

    const tangentOffset = 1 / Math.max(24, coords.length - 1);
    const t0 = Math.max(0, t - tangentOffset);
    const t1 = Math.min(1, t + tangentOffset);
    if (t0 === t1) return 0;

    const from = this.interpolateArcPoint(coords, t0);
    const to = this.interpolateArcPoint(coords, t1);
    const fromPx = this.map.project(from);
    const toPx = this.map.project(to);

    return (Math.atan2(toPx.y - fromPx.y, toPx.x - fromPx.x) * 180) / Math.PI;
  }

  // ─── Gas Vital Organs Layer ───

  async updateGas(state: import('../types').GasNetworkState): Promise<void> {
    if (!this.map) return;

    try {
      // === Build point features for terminals + storages ===
      const pointFeatures: GeoJSON.Feature[] = [];

      // Terminals (blue circles)
      for (const terminal of state.terminals) {
        pointFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: terminal.coordinates },
          properties: {
            id: terminal.id,
            type: 'terminal',
            name: terminal.name,
            operator: terminal.operator,
            capacity: terminal.capacityGWh,
            currentSendOut: terminal.currentSendOut,
            utilizationPct: terminal.utilizationPct,
            inventory: terminal.inventory,
            inventoryPct: terminal.inventoryPct,
            dataDate: terminal.dataDate,
            status: terminal.status,
          },
        });
      }

      // Storages (color-coded circles by fill level)
      for (const storage of state.storages) {
        const fillColor = this.getStorageFillColor(storage.fillLevel);
        const strokeColor = storage.fillTrend === 'withdrawing' ? '#EF4444' :
          storage.fillTrend === 'filling' ? '#22C55E' : '#6B7280';

        pointFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: storage.coordinates },
          properties: {
            id: storage.id,
            type: 'storage',
            name: storage.name,
            operator: storage.operator,
            capacity: storage.capacityTWh,
            fillLevel: storage.fillLevel,
            currentStockTWh: storage.currentStockTWh,
            flowRateGWhDay: storage.flowRateGWhDay,
            fillLabel: `${storage.fillLevel.toFixed(0)}%`,
            fillColor,
            strokeColor,
            trend: storage.fillTrend,
          },
        });
      }

      const vitalsSource = this.map.getSource(SRC_GAS_VITALS) as maplibregl.GeoJSONSource;
      vitalsSource?.setData({ type: 'FeatureCollection', features: pointFeatures });

      // === Build PIR flow arcs ===
      // Gas flow: Cyan/turquoise with softer glow, rapid dash animation
      const FRANCE_CENTER_GAS: [number, number] = [2.5, 46.5];
      const pirMarkerFeatures: GeoJSON.Feature[] = [];
      const pirArcFeatures: GeoJSON.Feature[] = [];
      this.gasArcs = [];  // Reset stored arcs for animation
      this.gasFlowStats.clear();

      const { minLineWidth, maxLineWidth, lineWidthDivisor, glowMultiplier, curvature, steps } = GAS_FLOW_STYLE;

      // Données nationales pour le contexte de chaque tooltip
      const storageLevelPct = state.nationalStats.averageFillLevel;
      const storageTrend = state.nationalStats.storageTrend;
      const ecogazRaw = state.ecogaz.signal; // 'green'|'yellow'|'orange'|'red'
      const ecogazSignalMap: Record<string, 'vert' | 'jaune' | 'orange' | 'rouge'> = {
        green: 'vert', yellow: 'jaune', orange: 'orange', red: 'rouge',
      };
      const ecogazSignal = ecogazSignalMap[ecogazRaw] ?? 'vert';

      for (const pir of state.interconnections) {
        if (Math.abs(pir.flowGWhDay) < 1) continue; // Skip negligible flows

        const isImport = pir.flowGWhDay > 0;
        const flowAbs = Math.abs(pir.flowGWhDay);
        // Gas flow colors: Cyan (import) / Teal (export) - visually distinct from electric blue
        const color = isImport ? GAS_FLOW_STYLE.importColor : GAS_FLOW_STYLE.exportColor;
        const glowColor = isImport ? GAS_FLOW_STYLE.glowImportColor : GAS_FLOW_STYLE.glowExportColor;
        const sign = isImport ? '+' : '-';
        const label = `${pir.country}\n${sign}${flowAbs.toFixed(0)} GWh/j`;
        const radius = Math.min(12, Math.max(5, 5 + flowAbs / 50));
        // Thinner lines than electricity (gas flows in pipelines)
        const lineWidth = Math.min(maxLineWidth, Math.max(minLineWidth, minLineWidth + flowAbs / lineWidthDivisor));
        const glowWidth = lineWidth * glowMultiplier;

        // Marker at border point
        pirMarkerFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: pir.coordinates },
          properties: { color, radius, label, country: pir.country, borderCode: pir.id },
        });

        // Arc from/to France center with gas-specific curvature
        const arcCoords = isImport
          ? generateArc(pir.coordinates, FRANCE_CENTER_GAS, curvature, steps)
          : generateArc(FRANCE_CENTER_GAS, pir.coordinates, curvature, steps);

        pirArcFeatures.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: arcCoords },
          properties: { color, glowColor, lineWidth, glowWidth, isImport, country: pir.country, borderCode: pir.id },
        });

        this.gasArcs.push({ coords: arcCoords, color, flowGWhDay: flowAbs });

        // Alimentation du tooltip enrichi
        const gasDir = resolveGasFlowDirection(pir.flowGWhDay, pir.country);
        const capacityGWhPerDay = pir.maxCapacityGWhDay || flowAbs * 1.5; // fallback estimé
        this.gasFlowStats.set(pir.id, {
          borderCode: pir.id,
          originLabel: gasDir.originLabel,
          destinationLabel: gasDir.destinationLabel,
          direction: gasDir.direction,
          currentFlowGWhPerDay: flowAbs,
          capacityGWhPerDay,
          utilizationPct: capacityGWhPerDay > 0 ? (flowAbs / capacityGWhPerDay) * 100 : 0,
          dailyNetGWh: pir.flowGWhDay,   // signe conservé (>0=import FR)
          sevenDayNetGWh: pir.flowGWhDay * 7, // branchement API réel ici
          nationalStorageLevelPct: storageLevelPct,
          storageTrend,
          ecogazSignal,
          updatedAt: state.lastUpdate,
          sevenDaySeries: this.gasBorderHistory.get(pir.id) ?? [],
        });
      }

      const pirMarkerSrc = this.map.getSource(SRC_GAS_PIR_MARKERS) as maplibregl.GeoJSONSource;
      pirMarkerSrc?.setData({ type: 'FeatureCollection', features: pirMarkerFeatures });

      const pirArcSrc = this.map.getSource(SRC_GAS_PIR_ARCS) as maplibregl.GeoJSONSource;
      pirArcSrc?.setData({ type: 'FeatureCollection', features: pirArcFeatures });

      // Start flow animation if we have arcs
      if (pirArcFeatures.length > 0) {
        this.startGasPirAnimation();
      } else {
        this.stopGasPirAnimation();
      }

      console.log(`[DeckGLMap/Gas] Updated: ${state.terminals.length} terminals, ${state.storages.length} storages, ${pirArcFeatures.length} PIR flows`);
    } catch (e) {
      console.warn('[DeckGLMap/Gas] Update failed:', e);
    }
  }

  setGasPipelineVisible(show: boolean): void {
    this.gasPipelineVisible = show;
    if (this.currentLayers?.gasNetwork) {
      const v = show ? 'visible' : 'none';
      this.setVis(LYR_GAS_NETWORK_GRT, v);
      this.setVis(LYR_GAS_NETWORK_TEREGA, v);
    }
  }

  private getStorageFillColor(fillLevel: number): string {
    if (fillLevel < 30) return '#1E3A8A';
    if (fillLevel < 50) return '#0891B2';
    if (fillLevel < 70) return '#2DD4BF';
    return '#6EE7B7';
  }

  /** Animated chevrons along gas PIR arcs (point-based, same technique as electricity). */
  private startGasPirAnimation(): void {
    if (this.gasChevronAnimFrame !== null) return;
    if (!this.map) return;

    let lastUpdate = 0;

    const animate = (timestamp: number) => {
      if (!this.map) return;

      const deltaMs = lastUpdate === 0 ? 16 : Math.min(48, timestamp - lastUpdate);
      lastUpdate = timestamp;

      // Slightly faster than electricity (gas flows more rapidly in pipelines)
      this.gasChevronPhase = (this.gasChevronPhase + GAS_FLOW_STYLE.animationSpeed * deltaMs * 0.00045) % 1;

      const chevronFeatures: GeoJSON.Feature[] = [];

      for (const arc of this.gasArcs) {
        const { coords, color, flowGWhDay } = arc;
        if (coords.length < 2) continue;

        const arcLen = coords.length;
        const baseCount = Math.max(3, Math.floor(arcLen / 8));
        const numChevrons = baseCount + Math.min(2, Math.floor(flowGWhDay / 100));
        const sizeBase = 0.8 * (1.0 + Math.min(0.4, flowGWhDay / 500));

        for (let i = 0; i < numChevrons; i++) {
          const t = (i / numChevrons + this.gasChevronPhase) % 1;
          const [lng, lat] = this.interpolateArcPoint(coords, t);
          const rotation = this.computeArcScreenRotation(coords, t);
          chevronFeatures.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: { color, rotation, size: sizeBase },
          });
        }
      }

      try {
        const src = this.map.getSource(SRC_GAS_PIR_CHEVRON_PTS) as maplibregl.GeoJSONSource;
        src?.setData({ type: 'FeatureCollection', features: chevronFeatures });
      } catch { /* source not ready */ }

      this.gasChevronAnimFrame = requestAnimationFrame(animate);
    };

    this.gasChevronAnimFrame = requestAnimationFrame(animate);
  }

  private stopGasPirAnimation(): void {
    if (this.gasChevronAnimFrame !== null) {
      cancelAnimationFrame(this.gasChevronAnimFrame);
      this.gasChevronAnimFrame = null;
    }
    const src = this.map?.getSource(SRC_GAS_PIR_CHEVRON_PTS) as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: 'FeatureCollection', features: [] });
  }

  private startSubseaPulseAnimation(): void {
    if (!this.map || this.subseaPulseAnimFrame !== null) return;

    const animate = () => {
      if (!this.map || !this.map.getLayer(LYR_SUBMARINE_CABLES_GLOW)) {
        this.subseaPulseAnimFrame = null;
        return;
      }

      this.subseaPulsePhase = (this.subseaPulsePhase + 0.035) % (Math.PI * 2);
      const pulse = (Math.sin(this.subseaPulsePhase) + 1) / 2;

      this.map.setPaintProperty(LYR_SUBMARINE_CABLES_GLOW, 'line-opacity', 0.24 + pulse * 0.1);
      this.map.setPaintProperty(LYR_SUBMARINE_CABLES_GLOW, 'line-width', [
        'interpolate', ['linear'], ['zoom'],
        3, 9.2 + pulse * 1.6,
        8, 14.0 + pulse * 2.2,
        12, 20.5 + pulse * 3.2,
      ]);

      this.subseaPulseAnimFrame = requestAnimationFrame(animate);
    };

    this.subseaPulseAnimFrame = requestAnimationFrame(animate);
  }

  private stopSubseaPulseAnimation(): void {
    if (this.subseaPulseAnimFrame !== null) {
      cancelAnimationFrame(this.subseaPulseAnimFrame);
      this.subseaPulseAnimFrame = null;
    }
  }

  // ─── Oil/Petroleum Flow Layer ───

  /**
   * Update biomethane injection sites on the map.
   * Renders 833 GRDF OpenData sites as amber dots sized by annual capacity (GWh/year).
   */
  updateBiomethaneSites(sites: import('../types/index.ts').BiomethaneSite[]): void {
    const src = this.map?.getSource(SRC_BIOMETHANE_SITES) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    const features: GeoJSON.Feature[] = sites.map(s => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [s.longitude, s.latitude],
      },
      properties: {
        name: s.name,
        commune: s.commune ?? '',
        department: s.department ?? '',
        region: s.region ?? '',
        operator: s.operator ?? '',
        capacityGwh: s.capacityGwhYear ?? 0,
        status: s.status,
      },
    }));

    src.setData({ type: 'FeatureCollection', features });
  }

  /**
   * Update oil flow arcs on the map.
   * Oil flows use OIL_FLOW_STYLE: brown/anthracite with amber glow, slow viscous animation.
   * @param flows Array of oil flow data (from future oil data service)
   *        Each flow has: id, name, country?, flowKbd (thousands barrels/day), coordinates
   */
  async updateOil(flows: Array<{
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
    originBreakdown?: Array<{ label: string; volumeMt: number; sharePct: number }>;
  }>): Promise<void> {
    if (!this.map) return;

    try {
      const FRANCE_CENTER_OIL: [number, number] = [2.5, 46.5];
      const oilMarkerFeatures: GeoJSON.Feature[] = [];
      const oilArcFeatures: GeoJSON.Feature[] = [];
      const oilDirectionFeatures: GeoJSON.Feature[] = [];
      this.oilArcs = [];

      const { minLineWidth, maxLineWidth, lineWidthDivisor, glowMultiplier, curvature, steps } = OIL_FLOW_STYLE;

      for (const flow of flows) {
        if (Math.abs(flow.flowKbd) < 1) continue; // Skip negligible flows

        const isImport = flow.flowKbd > 0;
        const flowAbs = Math.abs(flow.flowKbd);
        const originBreakdown = JSON.stringify(flow.originBreakdown ?? []);
        // Oil flow colors: Amber/brown tones for viscous petroleum feel
        const color = isImport ? OIL_FLOW_STYLE.importColor : OIL_FLOW_STYLE.exportColor;
        const glowColor = isImport ? OIL_FLOW_STYLE.glowImportColor : OIL_FLOW_STYLE.glowExportColor;
        const sign = isImport ? '+' : '-';
        const arrow = isImport ? '⬈' : '⬊';
        const franceTarget = flow.franceCoordinates ?? FRANCE_CENTER_OIL;
        const label = flow.country
          ? `${arrow} ${flow.country}\n${sign}${flowAbs.toFixed(0)} kbd`
          : `${arrow} ${flow.name}\n${sign}${flowAbs.toFixed(0)} kbd`;
        const radius = Math.min(14, Math.max(6, 6 + flowAbs / 30));
        // Thicker lines than gas (viscous flow)
        const lineWidth = Math.min(maxLineWidth, Math.max(minLineWidth, minLineWidth + flowAbs / lineWidthDivisor));
        const glowWidth = lineWidth * glowMultiplier;

        // Marker at source/destination point
        oilMarkerFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: flow.coordinates },
          properties: {
            color,
            radius,
            label,
            arrow,
            name: flow.name,
            country: flow.country || '',
            isImport,
            hubName: flow.hubName || '',
            originSharePct: flow.originSharePct ?? null,
            originVolumeMt: flow.originVolumeMt ?? null,
            originReferenceYear: flow.originReferenceYear ?? null,
            originSourceLabel: flow.originSourceLabel ?? '',
            originPartialBreakdown: flow.originPartialBreakdown ? 1 : 0,
            originBreakdown,
          },
        });

        // Arc from/to French hub with oil-specific curvature
        const arcCoords = isImport
          ? generateArc(flow.coordinates, franceTarget, curvature, steps)
          : generateArc(franceTarget, flow.coordinates, curvature, steps);

        const directionIndex = Math.max(1, Math.min(arcCoords.length - 2, Math.floor(arcCoords.length * 0.68)));
        const directionCoord = arcCoords[directionIndex] as [number, number];
        const bearing = computeBearingDegrees(
          arcCoords[directionIndex - 1] as [number, number],
          arcCoords[directionIndex + 1] as [number, number]
        );

        oilArcFeatures.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: arcCoords },
          properties: {
            color,
            glowColor,
            lineWidth,
            glowWidth,
            isImport,
            name: flow.name,
            country: flow.country || '',
            hubName: flow.hubName || '',
            label,
            originSharePct: flow.originSharePct ?? null,
            originVolumeMt: flow.originVolumeMt ?? null,
            originReferenceYear: flow.originReferenceYear ?? null,
            originSourceLabel: flow.originSourceLabel ?? '',
            originPartialBreakdown: flow.originPartialBreakdown ? 1 : 0,
            originBreakdown,
          },
        });

        oilDirectionFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: directionCoord },
          properties: { bearing },
        });

        // Store arc for chevron animation
        this.oilArcs.push({
          coords: arcCoords as [number, number][],
          color,
          flowKbd: flowAbs,
          lineWidth,
          isImport,
        });
      }

      const oilMarkerSrc = this.map.getSource(SRC_OIL_FLOW_MARKERS) as maplibregl.GeoJSONSource;
      oilMarkerSrc?.setData({ type: 'FeatureCollection', features: oilMarkerFeatures });

      const oilArcSrc = this.map.getSource(SRC_OIL_FLOW_ARCS) as maplibregl.GeoJSONSource;
      oilArcSrc?.setData({ type: 'FeatureCollection', features: oilArcFeatures });

      const oilDirectionSrc = this.map.getSource(SRC_OIL_FLOW_DIRECTION) as maplibregl.GeoJSONSource;
      oilDirectionSrc?.setData({ type: 'FeatureCollection', features: oilDirectionFeatures });

      // Start flow animation if we have arcs
      if (oilArcFeatures.length > 0) {
        this.startOilFlowAnimation();
      } else {
        this.stopOilFlowAnimation();
      }

      console.log(`[DeckGLMap/Oil] Updated: ${oilArcFeatures.length} oil flow arcs`);
    } catch (e) {
      console.warn('[DeckGLMap/Oil] Update failed:', e);
    }
  }

  /**
   * Start the animation for oil flow arcs.
   * NOTE: Dynamic line-dasharray animation is DISABLED due to MapLibre LineAtlas
   * saturation issue ("LineAtlas out of space"). Static dash pattern is used.
   */
  private startOilFlowAnimation(): void {
    if (this.oilChevronAnimFrame !== null) return;
    if (!this.map) return;

    let lastUpdate = 0;

    const animate = (timestamp: number) => {
      if (!this.map) return;

      const deltaMs = lastUpdate === 0 ? 16 : Math.min(48, timestamp - lastUpdate);
      lastUpdate = timestamp;

      // Slower than gas — pétrole visqueux
      this.oilChevronPhase = (this.oilChevronPhase + OIL_FLOW_STYLE.animationSpeed * deltaMs * 0.00045) % 1;

      const chevronFeatures: GeoJSON.Feature[] = [];

      for (const arc of this.oilArcs) {
        const { coords, color, flowKbd, lineWidth, isImport } = arc;
        if (coords.length < 2) continue;

        const arcLen = coords.length;
        // Pour les arcs longs (import intercontinentaux), on multiplie les chevrons
        // afin qu'il y en ait toujours quelques-uns dans le viewport France.
        const baseCount = Math.max(8, Math.floor(arcLen / 5));
        const rawCount = baseCount + Math.min(4, Math.floor(flowKbd / 150));
        const numChevrons = isImport
          ? Math.max(4, Math.round(rawCount * 2 / 3))
          : Math.max(2, Math.round(rawCount * 2 / 9));  // exports : -33% vs import/3
        // Taille proportionnelle à l'épaisseur du trait : chevron ≈ 3× lineWidth à zoom France
        // Export plus petits (vers est/Suisse) pour ne pas saturer
        const sizeBase = isImport ? lineWidth / 7 : lineWidth / 9;

        for (let i = 0; i < numChevrons; i++) {
          const t = (i / numChevrons + this.oilChevronPhase) % 1;
          const [lng, lat] = this.interpolateArcPoint(coords, t);
          const rotation = this.computeArcScreenRotation(coords, t);
          chevronFeatures.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: { color, rotation, size: sizeBase },
          });
        }
      }

      try {
        const src = this.map.getSource(SRC_OIL_FLOW_CHEVRON_PTS) as maplibregl.GeoJSONSource;
        src?.setData({ type: 'FeatureCollection', features: chevronFeatures });
      } catch { /* source not ready */ }

      this.oilChevronAnimFrame = requestAnimationFrame(animate);
    };

    this.oilChevronAnimFrame = requestAnimationFrame(animate);
  }

  /** Highlight the hovered oil flow arc, desaturate others. */
  private updateOilArcHighlight(): void {
    if (!this.map) return;
    const name = this.oilHoveredFlowName;
    if (name) {
      this.map.setPaintProperty(LYR_OIL_FLOW_ARC, 'line-opacity',
        ['case', ['==', ['get', 'name'], name], 1.0, 0.18]);
      this.map.setPaintProperty(LYR_OIL_FLOW_ARC_GLOW, 'line-opacity',
        ['case', ['==', ['get', 'name'], name], 0.55, 0.04]);
      this.map.setPaintProperty(LYR_OIL_FLOW_CHEVRONS, 'icon-opacity', 0.25);
    } else {
      this.map.setPaintProperty(LYR_OIL_FLOW_ARC, 'line-opacity', OIL_FLOW_STYLE.lineOpacity);
      this.map.setPaintProperty(LYR_OIL_FLOW_ARC_GLOW, 'line-opacity', OIL_FLOW_STYLE.glowOpacity);
      this.map.setPaintProperty(LYR_OIL_FLOW_CHEVRONS, 'icon-opacity', 0.90);
    }
  }

  private stopOilFlowAnimation(): void {
    if (this.oilChevronAnimFrame !== null) {
      cancelAnimationFrame(this.oilChevronAnimFrame);
      this.oilChevronAnimFrame = null;
    }
    const src = this.map?.getSource(SRC_OIL_FLOW_CHEVRON_PTS) as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: 'FeatureCollection', features: [] });
  }

  /**
   * Update oil infrastructure on the map (refineries, depots, pipelines).
   * Renders points for refineries/depots with color based on vigilance status.
   */
  async updateOilInfrastructure(data: OilDashboard): Promise<void> {
    if (!this.map) return;

    try {

      // Build refinery features — fill in orange/amber, stroke encodes status
      const refineryFeatures: GeoJSON.Feature[] = data.refineries.map(r => {
        const isActive = r.status === 'active';
        const isMaint = r.status === 'maintenance';

        // Active = "soleil" : ambre extrêmement clair et saturé, contour fin très sombre
        // Maintenance = "goutte foncée" : ambre très sombre/brun, contour clair épais
        const fillColor = isActive ? '#FCD34D'   // Amber-300 — le plus lumineux, "soleil"
          : isMaint ? '#78350F'   // Amber-900 — très sombre, "goutte foncée"
            : '#44403C';  // Stone-700 — arrêt

        const strokeColor = isActive ? '#1C1917'   // Stone-950 — contour fin très sombre
          : isMaint ? '#FCD34D'   // Amber-300 — contour clair épais
            : '#44403C';  // Stone-700

        const strokeWidth = isActive ? 2 : isMaint ? 5 : 1;

        // Taille proportionnelle à la capacité — utilisée pour l'icône triangle
        const cap = r.capacityMtPerYear ?? 8;
        const sizeScale = Math.max(0.9, Math.min(1.5, 0.65 + cap * 0.055));
        // Radius du glow (gardé pour la couche circle glow)
        const baseRadius = Math.max(6, Math.min(20, 3 + cap * 0.9));
        // ▲ actif, ▼ maintenance (triangle inversé = "goutte")
        const iconRotation = isMaint ? 180 : 0;

        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: r.location },
          properties: {
            id: r.id,
            name: r.name,
            operator: r.operator ?? '',
            capacity: cap,
            status: r.status,
            fillColor,
            strokeColor,
            strokeWidth,
            baseRadius,
            sizeScale,
            iconRotation,
          },
        };
      });

      // Build depot features
      // Stratégique : jaune presque blanc (plus clair que raffinerie active), opacité réduite
      // Terminal    : anneau lumineux amber + disque central sombre (couche séparée)
      // Distribution: amber intermédiaire
      const depotFeatures: GeoJSON.Feature[] = data.depots.map(d => {
        const fillColor = d.role === 'strategic' ? '#FEF9C3'   // Yellow-100 — presque blanc, léger
          : d.role === 'terminal' ? '#F59E0B'   // Amber-500 — anneau lumineux
            : '#D97706';  // Amber-600 — distribution

        const strokeColor = d.role === 'strategic' ? 'transparent'  // Pas d'anneau
          : d.role === 'terminal' ? '#1C1917'      // Stone-950 — contour minimal
            : '#92400E';     // Amber-800 dim

        const strokeWidth = d.role === 'strategic' ? 0 : d.role === 'terminal' ? 1.0 : 1.5;
        const baseRadius = d.role === 'strategic' ? 10 : d.role === 'terminal' ? 6 : 6;
        // Stratégique = spot clair mais léger (opacité réduite)
        const opacity = d.role === 'strategic' ? 0.65 : 0.95;

        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: d.location },
          properties: {
            id: d.id,
            name: d.name,
            role: d.role,
            fillColor,
            strokeColor,
            strokeWidth,
            baseRadius,
            opacity,
          },
        };
      });

      const refSrc = this.map.getSource(SRC_OIL_REFINERIES) as maplibregl.GeoJSONSource;
      refSrc?.setData({ type: 'FeatureCollection', features: refineryFeatures });

      const depotSrc = this.map.getSource(SRC_OIL_DEPOTS) as maplibregl.GeoJSONSource;
      depotSrc?.setData({ type: 'FeatureCollection', features: depotFeatures });

      console.log(`[DeckGLMap/Oil] Infrastructure updated: ${refineryFeatures.length} refineries, ${depotFeatures.length} depots`);
    } catch (e) {
      console.warn('[DeckGLMap/Oil] Infrastructure update failed:', e);
    }
  }

  /**
   * Load and render oil pipelines from GeoJSON file.
   * Pipeline data is loaded from /data/oil_pipelines.geojson if available.
   */
  async loadOilPipelines(): Promise<void> {
    if (!this.map) return;

    try {
      // Try to load pipeline GeoJSON (may not exist yet)
      const resp = await fetch('/data/oil_pipelines.geojson');
      if (!resp.ok) {
        console.log('[DeckGLMap/Oil] No pipeline GeoJSON found, skipping');
        return;
      }

      const geojson = await resp.json() as GeoJSON.FeatureCollection;

      // Enrich features with styling properties
      for (const feature of geojson.features) {
        const kind = (feature.properties?.kind as string) || 'products';
        feature.properties = {
          ...feature.properties,
          color: kind === 'crude' ? OIL_PIPELINE_COLORS.crude : OIL_PIPELINE_COLORS.products,
          lineWidth: kind === 'crude' ? 4 : 3,
        };
      }

      const pipeSrc = this.map.getSource(SRC_OIL_PIPELINES) as maplibregl.GeoJSONSource;
      pipeSrc?.setData(geojson);

      console.log(`[DeckGLMap/Oil] Loaded ${geojson.features.length} pipeline segments`);
    } catch (e) {
      console.warn('[DeckGLMap/Oil] Failed to load pipelines:', e);
    }
  }

  // ─── Gas Network Sources (lazy) ───

  /**
   * Perf audit §6 item 8: sets the real odre.opendatasoft.com URLs on the gas
   * network sources the first time the gas layer is switched on. Memoized —
   * a no-op after the first successful call, matching getDepartmentsGeojson()'s
   * pattern. Called from setLayerVisibility().
   */
  private ensureGasNetworkSources(): Promise<void> {
    if (!this.gasNetworkSourcesPromise) {
      this.gasNetworkSourcesPromise = (async () => {
        if (!this.map) return;
        try {
          const grtSrc = this.map.getSource(SRC_GAS_NETWORK_GRT) as maplibregl.GeoJSONSource | undefined;
          const teregaSrc = this.map.getSource(SRC_GAS_NETWORK_TEREGA) as maplibregl.GeoJSONSource | undefined;
          grtSrc?.setData('https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/trace-du-reseau-grt-250/exports/geojson');
          teregaSrc?.setData('https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/terega-trace-du-reseau/exports/geojson');
        } catch (error) {
          console.warn('[DeckGLMap] Failed to load gas network sources', error);
          this.gasNetworkSourcesPromise = null; // allow retry next time the layer is toggled on
        }
      })();
    }
    return this.gasNetworkSourcesPromise;
  }

  // ─── Weather Layer ───

  private getDepartmentsGeojson(): Promise<GeoJSON.FeatureCollection | null> {
    // Chargeur partagé avec l'index des départements du fil (v2) : un seul téléchargement.
    return loadDepartementsGeojson();
  }

  private cloneDepartmentsGeojson(base: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: base.features.map((feature) => ({
        ...feature,
        id: feature.id,
        properties: { ...(feature.properties ?? {}) },
      })),
    };
  }

  previewWeatherDepartment(departmentCode: string | null): void {
    if (!this.map) return;
    if (this._previewedWeatherDeptId !== null) {
      this.map.setFeatureState(
        { source: SRC_WEATHER, id: this._previewedWeatherDeptId },
        { preview: false },
      );
    }

    this._previewedWeatherDeptId = departmentCode ? deptCodeToId(departmentCode) : null;
    if (this._previewedWeatherDeptId !== null) {
      this.map.setFeatureState(
        { source: SRC_WEATHER, id: this._previewedWeatherDeptId },
        { preview: true },
      );
    }
  }

  selectWeatherDepartment(departmentCode: string | null): void {
    if (!this.map) return;
    if (this._selectedWeatherDeptId !== null) {
      this.map.setFeatureState(
        { source: SRC_WEATHER, id: this._selectedWeatherDeptId },
        { selected: false },
      );
    }

    this._selectedWeatherDeptId = departmentCode ? deptCodeToId(departmentCode) : null;
    if (this._selectedWeatherDeptId !== null) {
      this.map.setFeatureState(
        { source: SRC_WEATHER, id: this._selectedWeatherDeptId },
        { selected: true },
      );
    }
  }

  private clearFuelTensionHoverState(): void {
    if (!this.map) return;
    if (this._lastHoveredFuelDeptId !== null) {
      this.map.setFeatureState(
        { source: SRC_FUEL_TENSION, id: this._lastHoveredFuelDeptId },
        { hover: false },
      );
      this._lastHoveredFuelDeptId = null;
    }
  }

  async updateFuelTensionDepartments(dashboard: FuelTensionDashboard | null): Promise<void> {
    if (!this.map) return;

    const src = this.map.getSource(SRC_FUEL_TENSION) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    if (!dashboard || dashboard.summaries.length === 0) {
      src.setData(emptyFC());
      this.clearFuelTensionHoverState();
      this.fuelTensionHoverPopup?.remove();
      return;
    }

    const summariesByCode = new Map(dashboard.summaries.map((summary) => [summary.departmentCode, summary]));

    try {
      const baseGeojson = await this.getDepartmentsGeojson();
      if (!baseGeojson) return;
      const geojson = this.cloneDepartmentsGeojson(baseGeojson);
      geojson.features = geojson.features.filter((feature) => {
        const code = String(feature.properties?.code ?? '');
        return summariesByCode.has(code);
      });

      for (const feature of geojson.features) {
        const code = String(feature.properties?.code ?? '');
        const summary = summariesByCode.get(code);
        if (!summary) continue;
        const fillColor = getFuelTensionLevelColor(summary.tensionLevel);
        const lineColor =
          summary.tensionLevel === 'CRITICAL' ? '#FF4D4F' :
          summary.tensionLevel === 'HIGH' ? '#FF5A5F' :
          '#EF4444';
        const lineWidth =
          summary.tensionLevel === 'CRITICAL' ? 1.25 :
          summary.tensionLevel === 'HIGH' ? 1.15 :
          summary.tensionLevel === 'MEDIUM' ? 1.05 :
          0.95;
        const fillOpacity =
          summary.tensionLevel === 'CRITICAL' ? 0.26 :
          summary.tensionLevel === 'HIGH' ? 0.20 :
          summary.tensionLevel === 'MEDIUM' ? 0.15 :
          0.10;

        feature.id = code;
        feature.properties = {
          ...feature.properties,
          fillColor,
          lineColor,
          lineWidth,
          fillOpacity,
          tensionLevel: summary.tensionLevel,
          anomalyShare: summary.anomalyShare,
          stationCount: summary.stationCount,
          avgUpdateAgeMinutes: summary.avgUpdateAgeMinutes,
          deltaPrice7d: summary.deltaPrice7d,
          freshnessBadge: summary.freshness.badge,
        };
      }

      src.setData(geojson);
    } catch (error) {
      console.warn('[DeckGLMap] Failed to update fuel tension departments', error);
    }
  }

  // ─── Santé (spec 2026-10-03 § 3) ───

  /** Veille sanitaire : alertes Odissé par région (§ 3.1) ; `now` sert à la règle « en saison ». */
  updateHealthAlerts(alerts: AlertLevelsResponse | null, now: number): void {
    this.healthAlerts = alerts;
    this.healthNow = now;
    this.hideHealthHover();
    void this.renderHealthRegions();
  }

  /**
   * Urgences (§ 3.2) et APL (§ 3.3) : une source départementale, une propriété de couleur par syndrome et par profession ;
   * `now` sert au retard des urgences (S2 : en retard, aucune couleur de niveau).
   */
  updateHealthDepartments(syndromic: SyndromicResponse | null, apl: AplDataset | null, now: number): void {
    this.healthSyndromic = syndromic;
    this.healthApl = apl;
    this.healthNow = now;
    this.hideHealthHover();
    void this.renderHealthDepartments();
  }

  /** Sélecteur du panneau Urgences : change la propriété peinte, sans nouvel envoi de données. */
  setHealthUrgencesSyndrome(syndrome: UrgencesSyndrome): void {
    this.healthUrgencesSyndrome = syndrome;
    this.hideHealthHover();
    if (this.map?.getLayer(LYR_HEALTH_URG_FILL)) this.map.setPaintProperty(LYR_HEALTH_URG_FILL, 'fill-color', colorFromProp(urgencesProp(syndrome)));
  }

  /** Sélecteur du panneau Accès aux soins : change la propriété peinte, sans nouvel envoi de données. */
  setHealthAplProfession(profession: AplProfession): void {
    this.healthAplProfession = profession;
    this.hideHealthHover();
    if (this.map?.getLayer(LYR_HEALTH_APL_FILL)) this.map.setPaintProperty(LYR_HEALTH_APL_FILL, 'fill-color', colorFromProp(aplProp(profession)));
  }

  /** Hôpitaux (§ 3.4) : sites placés, index par n° FINESS (infobulle, fiche, panneau). */
  updateHospitals(data: HospitalsDataset | null): void {
    this.hospitalSites = new Map((data?.sites ?? []).map((s): [string, EmergencySite] => [s.finess, s]));
    this.hospitalsVintage = data?.vintage ?? null;
    this.hideHealthHover();
    const src = this.map?.getSource(SRC_HOSPITALS) as maplibregl.GeoJSONSource | undefined;
    src?.setData(hospitalFeatures(data));
  }

  /** Site choisi dans le panneau Hôpitaux : la carte s'y centre et ouvre sa fiche. */
  focusHospital(site: EmergencySite): void {
    if (!this.map) return;
    this.flyTo(site.lon, site.lat, Math.max(this.map.getZoom(), 9));
    this.openHospitalPopup(site);
  }

  private async renderHealthRegions(): Promise<void> {
    if (!this.map) return;
    if (!this.currentLayers?.health) {
      this.healthRegionsDirty = true;
      return;
    }
    this.healthRegionsDirty = false;
    const geo = await this.getRegionsGeojson();
    const src = this.map?.getSource(SRC_HEALTH_REGIONS) as maplibregl.GeoJSONSource | undefined;
    if (geo) src?.setData(regionAlertFeatures(geo, this.healthAlerts?.levels ?? [], this.healthNow));
  }

  private async renderHealthDepartments(): Promise<void> {
    if (!this.map) return;
    if (!this.currentLayers?.healthOscour && !this.currentLayers?.healthApl) {
      this.healthDeptsDirty = true;
      return;
    }
    this.healthDeptsDirty = false;
    const base = await this.getDepartmentsGeojson();
    const src = this.map?.getSource(SRC_HEALTH_DEPTS) as maplibregl.GeoJSONSource | undefined;
    if (base) src?.setData(departmentHealthFeatures(base, this.healthSyndromic, this.healthApl, this.healthNow));
  }

  /** Contours des régions (18, DROM compris), lus une fois ; un échec est relu au prochain affichage. */
  private getRegionsGeojson(): Promise<GeoJSON.FeatureCollection | null> {
    this.regionsGeojsonPromise ??= fetch('/data/regions.geojson')
      .then((r) => (r.ok ? (r.json() as Promise<GeoJSON.FeatureCollection>) : null))
      .catch(() => null)
      .then((geo) => {
        if (!geo) this.regionsGeojsonPromise = null;
        return geo;
      });
    return this.regionsGeojsonPromise;
  }

  private healthMapData(): HealthMapData {
    return {
      alerts: this.healthAlerts?.levels ?? [], now: this.healthNow, syndromic: this.healthSyndromic, apl: this.healthApl,
      hospitals: this.hospitalSites, hospitalsVintage: this.hospitalsVintage,
      syndrome: this.healthUrgencesSyndrome, profession: this.healthAplProfession,
    };
  }

  private openHospitalPopup(site: EmergencySite): void {
    if (!this.map) return;
    this.hideHealthHover();
    this.hospitalPopup?.remove();
    const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '320px', className: 'dark-popup' });
    popup.on('close', () => {
      if (this.hospitalPopup !== popup) return;
      this.hospitalPopup = null;
      this.hospitalPopupFiness = null;
    });
    this.hospitalPopup = popup;
    this.hospitalPopupFiness = site.finess;
    popup
      .setLngLat([site.lon, site.lat])
      .setHTML(hospitalPopupHtml(site, this.hospitalsVintage))
      .addTo(this.map);
  }

  /** Ferme l'infobulle de survol santé (souris hors de la carte, sélecteur, nouvelles données, couches changées). */
  private hideHealthHover(): void {
    if (!this.healthHoverShown) return;
    this.healthHoverShown = false;
    this.healthHoverPopup?.remove();
  }

  /** Curseur main sur un site seulement ; remis à zéro uniquement s'il a été posé ici (les autres couches gardent le leur). */
  private setHealthPointer(on: boolean): void {
    if (!this.map || on === this.healthPointer) return;
    this.healthPointer = on;
    this.map.getCanvas().style.cursor = on ? 'pointer' : '';
  }

  /**
   * Couches santé : une infobulle au survol, celle de la couche dessinée au-dessus (site, APL, urgences, région) ; clic sur un
   * site : sa fiche, sans infobulle par-dessus. Seules les couches visibles sont interrogées ; l'infobulle se ferme quand la
   * souris quitte la carte (panneau, légende, en-tête).
   */
  private initHealthInteractions(): void {
    const map = this.map;
    if (!map) return;
    map.on('mousemove', (e) => {
      const visible = HEALTH_HOVER_LAYERS.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
      const hit = topHealthHit(visible.length > 0 ? map.queryRenderedFeatures(e.point, { layers: visible }) : []);
      const onSite = hit?.layer.id === LYR_HOSPITALS;
      this.setHealthPointer(onSite);
      const ficheOpen = onSite && String(hit?.properties?.['finess'] ?? '') === this.hospitalPopupFiness;
      const html = hit && !ficheOpen ? healthTooltipHtml(hit.layer.id, hit.properties ?? {}, this.healthMapData()) : null;
      if (!html) {
        this.hideHealthHover();
        return;
      }
      this.healthHoverShown = true;
      const popup = this.healthHoverPopup
        ?? new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, maxWidth: '300px', className: 'dark-popup hm-hover' });
      this.healthHoverPopup = popup;
      popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
    });
    map.on('mouseout', () => {
      this.setHealthPointer(false);
      this.hideHealthHover();
    });
    map.on('click', LYR_HOSPITALS, (e) => {
      const site = this.hospitalSites.get(String(e.features?.[0]?.properties?.['finess'] ?? ''));
      if (site) this.openHospitalPopup(site);
    });
  }

  // ─── ISNR Stability Layer ───

  async updateISNR(scores: import('../types/index.ts').ISNRScore[]): Promise<void> {
    if (!this.map) return;

    // Perf audit §6 item 2: skip the departments.geojson-backed choropleth
    // while the stability layer is hidden; replayed by setLayerVisibility()
    // once it's switched on.
    if (!this.currentLayers?.stability) {
      this._pendingIsnrScores = scores;
      return;
    }
    this._pendingIsnrScores = null;

    const scoresByCode = new Map<string, import('../types/index.ts').ISNRScore>();
    for (const s of scores) scoresByCode.set(s.code, s);

    try {
      const baseGeojson = await this.getDepartmentsGeojson();
      if (!baseGeojson) return;
      const geojson = this.cloneDepartmentsGeojson(baseGeojson);

      // Include all departments, color by score (default stable if no score)
      for (let i = 0; i < geojson.features.length; i++) {
        const feat = geojson.features[i];
        const code = (feat.properties?.code as string) ?? '';
        feat.id = deptCodeToId(code);
        const scoreData = scoresByCode.get(code);
        const score = scoreData?.score ?? 0;

        feat.properties = {
          ...feat.properties,
          score,
          fillColor: scoreToISNRColor(score),
          lineColor: scoreToISNRLineColor(score),
          scoreLabel: `${Math.round(score)}`,
        };
      }

      const src = this.map.getSource(SRC_ISNR) as maplibregl.GeoJSONSource;
      src?.setData(geojson);
    } catch (e) {
      console.warn('[DeckGLMap] Failed to load depts for ISNR layer', e);
    }
  }

  highlightISNRDepartment(departmentCode: string | null): void {
    if (!this.map) return;

    // Reset previous hovered state if any
    if (this._lastHoveredISNRDeptId !== null) {
      this.map.setFeatureState(
        { source: SRC_ISNR, id: this._lastHoveredISNRDeptId },
        { hover: false }
      );
    }

    if (departmentCode !== null) {
      const numericId = deptCodeToId(departmentCode);
      this.map.setFeatureState(
        { source: SRC_ISNR, id: numericId },
        { hover: true }
      );
      this._lastHoveredISNRDeptId = numericId;
    } else {
      this._lastHoveredISNRDeptId = null;
    }
  }
  private _lastHoveredISNRDeptId: number | null = null;

  // ─── Trafics (spec 2026-10-03 trafics § 3) ───

  /** Route : sections Traficolor, bouchons TomTom et événements DIR ; `now` sert au retard (S2 : couleurs retirées). */
  updateRoadTraffic(national: RoadNationalResponse | null, urban: RoadUrbanResponse | null, now: number): void {
    this.setTrafficSource(SRC_ROAD_SECTIONS, traficolorFeatures(national, now));
    this.setTrafficSource(SRC_ROAD_JAMS, urbanJamFeatures(urban, now));
    this.setTrafficSource(SRC_ROAD_EVENTS, roadEventFeatures(national, now));
  }

  /** Aérien : aéroports (surface selon les départs) et urgences en vol ; les positions des avions passent par updateAirTraffic. */
  updateAirOverview(overview: AirOverviewResponse | null, now: number): void {
    this.setTrafficSource(SRC_AIRPORTS, airportFeatures(overview, now));
    this.setTrafficSource(SRC_AIR_EMERGENCIES, airEmergencyFeatures(overview, now));
  }

  /** Rail : gares des trains perturbés en cours ; le retard des données SNCF retire aussi la couleur du trajet tracé. */
  updateRailTraffic(overview: RailOverviewResponse | null, now: number): void {
    this.railTrafficLate = railOverviewLate(overview, now);
    this.setTrafficSource(SRC_RAIL_STATIONS, railStationFeatures(overview, now));
    // Trajet tracé : retard relu dans la nouvelle donnée ; train qui n'y figure plus (arrivé, retiré) : trajet effacé.
    const fresh = (t: RailTrain | null): RailTrain | null => (t ? overview?.trains.find((x) => x.id === t.id) ?? null : null);
    this.chosenTrain = fresh(this.chosenTrain);
    this.previewTrain = fresh(this.previewTrain);
    this.drawTrainRoute();
  }

  /** Maritime : mouillages devant les ports et signalements croisés (T3) ; les navires restent dans la couche Deck.gl du WebSocket. */
  updateMaritimeSnapshot(snapshot: MaritimeSnapshot | null, now: number): void {
    this.setTrafficSource(SRC_ANCHORAGES, anchorageFeatures(snapshot, now));
    this.setTrafficSource(SRC_AIS_SIGNALS, maritimeSignalFeatures(snapshot, now));
  }

  /** Train choisi dans le panneau ferroviaire : trajet par ses arrêts, couleur de son retard ; null efface. */
  highlightTrainRoute(train: RailTrain | null): void {
    this.chosenTrain = train;
    this.drawTrainRoute();
  }

  /** Train survolé dans le panneau : son trajet le temps du survol ; null rend le trajet du train choisi (ou rien). */
  previewTrainRoute(train: RailTrain | null): void {
    this.previewTrain = train;
    this.drawTrainRoute();
  }

  private drawTrainRoute(): void {
    const train = this.previewTrain ?? this.chosenTrain;
    const src = this.map?.getSource(SRC_TRAIN_ROUTE) as maplibregl.GeoJSONSource | undefined;
    src?.setData(trainRouteFeatures(train, this.railTrafficLate));
  }

  private setTrafficSource(id: string, data: GeoJSON.FeatureCollection): void {
    this.hideTrafficHover();
    const src = this.map?.getSource(id) as maplibregl.GeoJSONSource | undefined;
    src?.setData(data);
  }

  /** Ferme l'infobulle de survol des Trafics (souris hors de la carte, nouvelles données, couches changées). */
  private hideTrafficHover(): void {
    if (!this.trafficHoverShown) return;
    this.trafficHoverShown = false;
    this.trafficHoverPopup?.remove();
  }

  /** Curseur main sur un bouchon (cliquable) seulement ; remis à zéro uniquement s'il a été posé ici. */
  private setTrafficPointer(on: boolean): void {
    if (!this.map || on === this.trafficPointer) return;
    this.trafficPointer = on;
    this.map.getCanvas().style.cursor = on ? 'pointer' : '';
  }

  /**
   * Couches Trafics : une infobulle au survol, celle de la couche dessinée au-dessus (préparée avec la donnée, texte échappé) ;
   * clic sur un bouchon TomTom : vitesse du tronçon (/api/traffic/flow, budget serveur du jour).
   */
  private initTrafficInteractions(): void {
    const map = this.map;
    if (!map) return;
    map.on('mousemove', (e) => {
      const visible = TRAFFIC_HOVER_LAYERS.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
      const hit = topTrafficHit(visible.length > 0 ? map.queryRenderedFeatures(e.point, { layers: visible }) : []);
      this.setTrafficPointer(hit !== undefined && TRAFFIC_JAM_LAYERS.includes(hit.layer.id));
      const html = hit ? trafficTooltipHtml(hit.layer.id, hit.properties ?? {}) : null;
      if (!html) {
        this.hideTrafficHover();
        return;
      }
      this.trafficHoverShown = true;
      const popup = this.trafficHoverPopup
        ?? new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, maxWidth: '300px', className: 'dark-popup hm-hover' });
      this.trafficHoverPopup = popup;
      popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
    });
    map.on('mouseout', () => {
      this.setTrafficPointer(false);
      this.hideTrafficHover();
    });
    for (const id of TRAFFIC_JAM_LAYERS) {
      map.on('click', id, (e) => {
        const props = e.features?.[0]?.properties ?? {};
        const body = typeof props['body'] === 'string' ? props['body'] : '';
        const lat = Number(props['lat']);
        const lon = Number(props['lon']);
        if (body !== '' && Number.isFinite(lat) && Number.isFinite(lon)) void this.openJamPopup(e.lngLat, body, lat, lon);
      });
    }
  }

  /** Fiche d'un bouchon : son infobulle et la vitesse du tronçon (ou « indisponible », budget du jour atteint compris). */
  private async openJamPopup(at: maplibregl.LngLat, body: string, lat: number, lon: number): Promise<void> {
    const flow = await fetchTrafficFlowSegment(lat, lon, this.map?.getZoom() ?? 10);
    if (!this.map) return;
    this.hideTrafficHover();
    this.trafficJamPopup?.remove();
    this.trafficJamPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '320px', className: 'dark-popup' })
      .setLngLat(at)
      .setHTML(jamPopupHtml(body, flow))
      .addTo(this.map);
  }

  // ─── Outages (Telecom & Power) ───
  async updateOutages(telecoms: TelecomOutage[], powers: PowerOutage[]): Promise<void> {
    if (!this.map) return;

    // 1. Telecom GEOJSON
    const telecomFC = emptyFC();
    telecomFC.features = telecoms.map(t => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: t.coordinates },
      properties: {
        id: t.id,
        operator: t.operator,
        city: t.city,
        department: t.department,
        status: t.voiceStatus === 'HS' || t.dataStatus === 'HS' ? 'HS' : 'Degraded',
        voiceStatus: t.voiceStatus,
        dataStatus: t.dataStatus,
        reason: t.reason
      }
    }));
    (this.map.getSource(SRC_TELECOM) as maplibregl.GeoJSONSource)?.setData(telecomFC);

    // 2. Power GEOJSON with data-driven styling
    // Perf audit §6 item 2: skip the departments.geojson-backed power/tension
    // choropleths while the outages layer is hidden — the telecom points
    // above still render regardless. Replayed by setLayerVisibility() once
    // the layer is switched on.
    if (!this.currentLayers?.outages) {
      this._pendingOutagesArgs = { telecoms, powers };
      return;
    }
    this._pendingOutagesArgs = null;

    const powersByCode = new Map<string, PowerOutage>();
    for (const p of powers) powersByCode.set(p.departmentCode, p);

    try {
      const baseGeojson = await this.getDepartmentsGeojson();
      if (!baseGeojson) return;
      const geojson = this.cloneDepartmentsGeojson(baseGeojson);

      // Filter to departments with actual measured outages only
      geojson.features = geojson.features.filter(f => {
        const code = (f.properties?.code as string) ?? '';
        const pout = powersByCode.get(code);
        return !!pout && pout.offGridCount > 0;
      });

      for (const feat of geojson.features) {
        const code = (feat.properties?.code as string) ?? '';
        const pout = powersByCode.get(code);
        if (!pout) continue;

        // Data-driven styling based on affected count and source
        const { fillColor, lineColor, opacity } = this.computePowerOutageStyle(pout);

        feat.properties = {
          ...feat.properties,
          fillColor,
          fillOpacity: opacity,
          lineColor,
          // Store outage data for tooltip
          powerOutage: pout,
          affectedCount: pout.offGridCount,
          isRealtime: pout.eventCause.includes('temps réel'),
          severity: this.computePowerSeverity(pout.offGridCount),
        };
      }

      const powerSrc = this.map.getSource(SRC_POWER) as maplibregl.GeoJSONSource;
      powerSrc?.setData(geojson);
    } catch (e) {
      console.warn('[DeckGLMap] Error mapping power outages', e);
    }
  }

  /** Render citizen outage zones (crowd-sourced DBSCAN clusters) on the map. */
  updateCitizenOutageZones(zones: GeoJSON.FeatureCollection): void {
    (this.map?.getSource(SRC_CITIZEN_ZONES) as maplibregl.GeoJSONSource)?.setData(zones);
  }

  /** Render IIP RTE HTB incidents as blue points on the map. */
  updateIIPIncidents(incidents: RTEIIPIncident[]): void {
    const features: GeoJSON.Feature[] = [];
    for (const inc of incidents) {
      const coords = resolveIIPCoords(inc);
      if (!coords) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coords },
        properties: {
          id: inc.id,
          assetLabel: inc.assetLabel,
          title: inc.title,
          incidentType: inc.type,
          status: inc.status,
          cause: inc.cause,
          capacityMW: inc.capacityMW,
          startDate: inc.startDate?.toISOString() ?? null,
          endDate: inc.endDate?.toISOString() ?? null,
        },
      });
    }
    (this.map?.getSource(SRC_IIP) as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features,
    });
  }

  /** Highlight/unhighlight an IIP incident point by id (no fly-to). */
  highlightIIPIncident(id: string | null): void {
    if (!this.map) return;
    if (id !== null) {
      this.map.setPaintProperty(LYR_IIP_CORE, 'circle-stroke-color', [
        'case', ['==', ['get', 'id'], id], '#ffffff', '#ffffff',
      ]);
      this.map.setPaintProperty(LYR_IIP_CORE, 'circle-stroke-width', [
        'case', ['==', ['get', 'id'], id], 3, 1.5,
      ]);
      this.map.setPaintProperty(LYR_IIP_CORE, 'circle-stroke-opacity', [
        'case', ['==', ['get', 'id'], id], 1, 0.6,
      ]);
    } else {
      this.map.setPaintProperty(LYR_IIP_CORE, 'circle-stroke-width', 1.5);
      this.map.setPaintProperty(LYR_IIP_CORE, 'circle-stroke-opacity', 0.6);
    }
  }

  /** Highlight a specific department on the power outages layer. */
  highlightPowerDept(deptCode: string | null): void {
    if (!this.map) return;
    if (deptCode) {
      this.map.setPaintProperty(LYR_POWER_FILL, 'fill-color', [
        'case', ['==', ['get', 'code'], deptCode], 'rgba(255,255,255,0.35)', ['get', 'fillColor'],
      ]);
      this.map.setPaintProperty(LYR_POWER_LINE, 'line-color', [
        'case', ['==', ['get', 'code'], deptCode], '#FFFFFF', ['get', 'lineColor'],
      ]);
    } else {
      this.map.setPaintProperty(LYR_POWER_FILL, 'fill-color', ['get', 'fillColor']);
      this.map.setPaintProperty(LYR_POWER_LINE, 'line-color', ['get', 'lineColor']);
    }
  }

  /** Highlight a specific citizen outage zone by clusterId. */
  highlightCitizenZone(clusterId: number | null): void {
    if (!this.map) return;
    if (clusterId !== null) {
      this.map.setPaintProperty(LYR_CITIZEN_FILL, 'fill-color', [
        'case', ['==', ['get', 'clusterId'], clusterId],
        'rgba(255,255,255,0.25)',
        'rgba(180,0,255,0.15)',
      ]);
      this.map.setPaintProperty(LYR_CITIZEN_LINE, 'line-color', [
        'case', ['==', ['get', 'clusterId'], clusterId],
        '#FFFFFF',
        '#b400ff',
      ]);
    } else {
      this.map.setPaintProperty(LYR_CITIZEN_FILL, 'fill-color', 'rgba(180,0,255,0.15)');
      this.map.setPaintProperty(LYR_CITIZEN_LINE, 'line-color', '#b400ff');
    }
  }

  /** Highlight a specific ISP point and fly to it. */
  highlightIsp(data: { asn: string; coordinates: [number, number] } | null): void {
    if (!this.map) return;
    const statusColor = ['match', ['get', 'status'], 'outage', '#EF4444', 'degraded', '#F59E0B', '#10B981'] as maplibregl.ExpressionSpecification;
    if (data) {
      // Anneau : blanc sur le point sélectionné, dim pour les autres
      this.map.setPaintProperty(LYR_NET_ISP_RING, 'circle-stroke-color', [
        'case', ['==', ['get', 'asn'], data.asn], '#FFFFFF', statusColor,
      ]);
      this.map.setPaintProperty(LYR_NET_ISP_RING, 'circle-radius', [
        'case', ['==', ['get', 'asn'], data.asn],
        ['interpolate', ['linear'], ['zoom'], 4, 12, 10, 20],
        ['interpolate', ['linear'], ['zoom'], 4, 8, 10, 14],
      ]);
      this.map.setPaintProperty(LYR_NET_ISP_RING, 'circle-stroke-opacity', [
        'case', ['==', ['get', 'asn'], data.asn], 1, 0.35,
      ]);
      // Point central : blanc sur le sélectionné
      this.map.setPaintProperty(LYR_NET_ISP, 'circle-color', [
        'case', ['==', ['get', 'asn'], data.asn], '#FFFFFF', statusColor,
      ]);
    } else {
      this.map.setPaintProperty(LYR_NET_ISP_RING, 'circle-stroke-color', statusColor);
      this.map.setPaintProperty(LYR_NET_ISP_RING, 'circle-radius', ['interpolate', ['linear'], ['zoom'], 4, 8, 10, 14]);
      this.map.setPaintProperty(LYR_NET_ISP_RING, 'circle-stroke-opacity', 0.90);
      this.map.setPaintProperty(LYR_NET_ISP, 'circle-color', statusColor);
    }
  }

  /** Highlight a specific IODA event and fly to it. */
  highlightIoda(data: { id: string; coordinates: [number, number] } | null): void {
    if (!this.map) return;
    if (data) {
      this.map.setPaintProperty(LYR_NET_IODA_CORE, 'circle-stroke-color', [
        'case', ['==', ['get', 'id'], data.id], '#FFFFFF', '#0a0a0f',
      ]);
      this.map.setPaintProperty(LYR_NET_IODA_CORE, 'circle-stroke-width', [
        'case', ['==', ['get', 'id'], data.id], 3, 1.5,
      ]);
      this.map.setPaintProperty(LYR_NET_IODA_GLOW, 'circle-opacity', [
        'case', ['==', ['get', 'id'], data.id], 0.9, 0.5,
      ]);
    } else {
      this.map.setPaintProperty(LYR_NET_IODA_CORE, 'circle-stroke-color', '#0a0a0f');
      this.map.setPaintProperty(LYR_NET_IODA_CORE, 'circle-stroke-width', 1.5);
      this.map.setPaintProperty(LYR_NET_IODA_GLOW, 'circle-opacity', 1);
    }
  }

  /** Highlight a specific datacenter triangle and fly to it. */
  highlightDc(data: { id: string; coordinates: [number, number] } | null): void {
    if (!this.map) return;
    const highlightSrc = this.map.getSource(SRC_DC_HIGHLIGHT) as maplibregl.GeoJSONSource | undefined;
    if (data) {
      highlightSrc?.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: data.coordinates },
          properties: { id: data.id },
        }],
      });
    } else {
      highlightSrc?.setData(emptyFC());
    }
  }

  /** Highlight a specific IXP diamond and fly to it. */
  highlightIxp(data: { id: string; coordinates: [number, number] } | null): void {
    if (!this.map) return;
    const highlightSrc = this.map.getSource(SRC_IXP_HIGHLIGHT) as maplibregl.GeoJSONSource | undefined;
    if (data) {
      highlightSrc?.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: data.coordinates },
          properties: { id: data.id },
        }],
      });
    } else {
      highlightSrc?.setData(emptyFC());
    }
  }

  /** Render IODA internet outage events + ISP BGP status on the map. */
  updateNetworkOutages(state: NetworkOutageState): void {
    if (!this.map) return;

    // ── ISP circles ──
    const ispFC = emptyFC();
    ispFC.features = state.ispStatus.map(isp => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: isp.coordinates },
      properties: {
        asn:               isp.asn,
        ispName:           isp.ispName,
        prefixCount:       isp.prefixCount,
        prefixCountNormal: isp.prefixCountNormal,
        prefixV4:          isp.prefixV4,
        prefixV6:          isp.prefixV6,
        visibility:        isp.visibility,
        status:            isp.status,
        trafficEstimation: isp.trafficEstimation ?? null,
        lookingGlass:      isp.lookingGlass ?? null,
        ixList:            JSON.stringify(isp.ixList ?? []),
        peerCount:         isp.peerCount ?? 0,
        networkType:       isp.networkType ?? '',
        peeringPolicy:     isp.peeringPolicy ?? '',
        arcepFiber:        isp.arcepFiber ?? null,
        mobile:            isp.mobile ?? null,
        noc:               isp.noc ?? null,
        ipv6Label:         isp.ipv6Label ?? null,
      },
    }));
    (this.map.getSource(SRC_NET_ISP) as maplibregl.GeoJSONSource)?.setData(ispFC);

    // ── IODA event circles ──
    const iodaFC = emptyFC();
    iodaFC.features = state.iodaEvents.map(ev => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: ev.coordinates },
      properties: {
        id: ev.id,
        entityCode: ev.entityCode,
        entityName: ev.entityName,
        entityType: ev.entityType,
        score: ev.score,
        duration: ev.duration,
        isOngoing: ev.isOngoing,
        datasources: JSON.stringify(ev.datasources),
      },
    }));
    (this.map.getSource(SRC_NET_IODA) as maplibregl.GeoJSONSource)?.setData(iodaFC);
  }

  /** Render datacenter & IXP status on the map. */
  updateInfraNetwork(state: InfraNetworkState): void {
    if (!this.map) return;

    // Datacenters
    const dcFC = emptyFC();
    dcFC.features = state.datacenters.map(dc => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: dc.coordinates },
      properties: {
        id: dc.id,
        name: dc.name,
        provider: dc.provider,
        region: dc.region,
        city: dc.city ?? '',
        address: dc.address ?? '',
        status: dc.status,
        incidents: JSON.stringify(dc.incidents),
        operationalState: dc.operationalState ?? '',
        operationalStateKey: dc.operationalStateKey ?? '',
        powerBand: dc.powerBand ?? '',
        powerDetail: dc.powerDetail ?? '',
        detailSummary: dc.detailSummary ?? '',
        rawSource: dc.rawSource ?? '',
        sourceUrl: dc.sourceUrl ?? '',
        source: dc.source ?? '',
        lastUpdated: dc.lastUpdated,
        realLng: dc.coordinates[0],
        realLat: dc.coordinates[1],
        offsetMeters: 0,
      },
    }));
    (this.map.getSource(SRC_DC) as maplibregl.GeoJSONSource)?.setData(dcFC);

    // IXPs
    const ixpFC = emptyFC();
    ixpFC.features = state.ixps.map(ixp => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: ixp.coordinates },
      properties: {
        id: ixp.id,
        name: ixp.name,
        city: ixp.city,
        peersCount: ixp.peersCount,
        speedGbps: ixp.speedGbps,
        status: ixp.status,
        lastUpdated: ixp.lastUpdated,
        realLng: ixp.coordinates[0],
        realLat: ixp.coordinates[1],
        offsetMeters: 0,
      },
    }));
    (this.map.getSource(SRC_IXP) as maplibregl.GeoJSONSource)?.setData(ixpFC);
  }

  /**
   * Compute fill/line color and opacity for power outages.
   * Uses an amber → orange → red severity scale to distinguish electricity
   * clearly from other network types (télécom=blue, internet=teal, cloud=purple).
   */
  private computePowerOutageStyle(outage: PowerOutage): {
    fillColor: string;
    lineColor: string;
    opacity: number;
  } {
    const count = outage.offGridCount;

    let fillColor: string;
    let lineColor: string;
    let opacity: number;

    if (count >= 10000) {
      fillColor = '#EF4444'; lineColor = '#EF4444'; opacity = 0.70; // rouge critique
    } else if (count >= 5000) {
      fillColor = '#F97316'; lineColor = '#F97316'; opacity = 0.55; // orange élevé
    } else if (count >= 1000) {
      fillColor = '#F59E0B'; lineColor = '#F59E0B'; opacity = 0.42; // ambre modéré
    } else {
      fillColor = '#EAB308'; lineColor = '#EAB308'; opacity = 0.28; // jaune-ambre faible
    }

    return { fillColor, lineColor, opacity };
  }

  /**
   * Compute severity level for power outage (used in tooltips/legends).
   */
  private computePowerSeverity(count: number): 'critical' | 'high' | 'medium' | 'low' {
    if (count >= 10000) return 'critical';
    if (count >= 5000) return 'high';
    if (count >= 1000) return 'medium';
    return 'low';
  }



  private _highlightedFloodSegmentId: string | null = null;

  // ─── Environnement (spec 2026-10-04 environnement § 2 ; contrats § 5) ───

  /** Vigilance de l'échéance choisie (J ou J+1), datée ; couche masquée : gardée, puis peinte à son réaffichage. */
  async updateVigilanceLayer(v: VigilanceResponse | null, echeance: VigilanceEcheance, now: number): Promise<void> {
    this.envVigilance = { v, echeance, now };
    if (!this.map) return;
    if (!this.currentLayers?.environmental) {
      this.envVigilancePending = true;
      return;
    }
    this.envVigilancePending = false;
    const geo = await this.getDepartmentsGeojson();
    if (!this.map) return;
    (this.map.getSource(SRC_WEATHER) as maplibregl.GeoJSONSource | undefined)?.setData(geo ? vigilanceDeptFeatures(geo, v, echeance, now) : emptyFC());
    (this.map.getSource(SRC_WEATHER_ICONS) as maplibregl.GeoJSONSource | undefined)?.setData(vigilanceIconFeatures(v, echeance, now));
    this.hideEnvironmentHover();
  }

  /** Tronçons jaunes, orange, rouges (aussi en v2) et stations des tronçons en vigilance, datés. */
  updateFloodsLayer(f: FloodsResponse | null, now: number): void {
    if (!this.map) return;
    this.envFloods = f;
    const kept = this._highlightedFloodSegmentId;
    this.envFloodSections = new Map((f?.sections ?? []).map((s) => [s.id, s]));
    // Le tronçon mis en avant est gardé tant qu'il existe dans les nouvelles données.
    this.highlightFloodSection(kept !== null && this.envFloodSections.has(kept) ? kept : null);
    (this.map.getSource(SRC_FLOODS) as maplibregl.GeoJSONSource | undefined)?.setData(floodSectionFeatures(f, now));
    (this.map.getSource(SRC_FLOOD_STATIONS) as maplibregl.GeoJSONSource | undefined)?.setData(floodStationFeatures(f, now));
    this.hideEnvironmentHover();
  }

  // ─── Environnement, phase B (spec 2026-10-04 § 3) ───

  /** Sécheresse : niveau le plus haut des arrêtés par département (VigiEau) ; départements lus une fois (getDepartmentsGeojson). */
  async updateDroughtLayer(d: DroughtResponse | null, now: number): Promise<void> {
    this.envB.drought = d;
    const geo = await this.getDepartmentsGeojson();
    if (!this.map) return;
    (this.map.getSource(SRC_DROUGHT) as maplibregl.GeoJSONSource | undefined)?.setData(geo ? droughtDeptFeatures(geo, d, now) : emptyFC());
    this.hideEnvironmentHover();
  }

  /** Qualité de l'air : indice ATMO le plus haut du jour par département (palette L1). */
  async updateAirQualityLayer(a: AirQualityResponse | null, now: number): Promise<void> {
    this.envB.air = a;
    const geo = await this.getDepartmentsGeojson();
    if (!this.map) return;
    (this.map.getSource(SRC_AIR_QUALITY) as maplibregl.GeoJSONSource | undefined)?.setData(geo ? airDeptFeatures(geo, a, now) : emptyFC());
    this.hideEnvironmentHover();
  }

  /** Séismes des 7 derniers jours : cercles proportionnels à la magnitude. */
  updateEarthquakesLayer(q: EarthquakesResponse | null, now: number): void {
    this.envB.quakes = q;
    if (!this.map) return;
    (this.map.getSource(SRC_QUAKES) as maplibregl.GeoJSONSource | undefined)?.setData(quakeFeatures(q, now));
    this.hideEnvironmentHover();
  }

  /** Marégraphes SHOM (couche Vigilance météo) : anneau de la couleur du domaine littoral du jour. */
  updateSeaLevelsLayer(s: SeaLevelsResponse | null, v: VigilanceResponse | null, now: number): void {
    this.envB.seaLevels = s;
    this.envB.vigilance = v;
    if (!this.map) return;
    (this.map.getSource(SRC_TIDE_GAUGES) as maplibregl.GeoJSONSource | undefined)?.setData(tideGaugeFeatures(s, v, now));
    this.hideEnvironmentHover();
  }

  /** Tronçon du panneau Crues mis en avant (null : aucun). */
  highlightFloodSection(id: string | null): void {
    if (!this.map) return;
    const highlightSrc = this.map.getSource(SRC_FLOODS_HIGHLIGHT) as maplibregl.GeoJSONSource | undefined;
    const section = id === null ? undefined : this.envFloodSections.get(id);
    if (!section) {
      highlightSrc?.setData(emptyFC());
      this.setVis(LYR_FLOODS_HIGHLIGHT, 'none');
      this._highlightedFloodSegmentId = null;
      return;
    }
    highlightSrc?.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: section.path }, properties: { id: section.id } }],
    });
    this._highlightedFloodSegmentId = section.id;
    this.setVis(LYR_FLOODS_HIGHLIGHT, envLayerOn(this.currentLayers ?? {}, 'floods') ? 'visible' : 'none');
  }

  /** Recentre la carte sur un tronçon (clic dans le panneau Crues) et le met en avant. */
  focusFloodSection(id: string): void {
    const section = this.envFloodSections.get(id);
    if (!section || section.path.length === 0) return;
    this.highlightFloodSection(id);
    this.fitBounds(computeFloodSegmentBbox({ type: 'MultiLineString', coordinates: section.path }), 80);
  }

  /** Détections de France par foyer, détections hors de France, météo des forêts (option, éteinte par défaut), datées. */
  updateFiresLayer(f: FiresResponse | null, now: number, opts: { forestDangerFill: boolean }): void {
    this.envFires = f;
    this.envFiresNow = now;
    this._forestDangerFill = opts.forestDangerFill;
    if (!this.map) return;
    (this.map.getSource(SRC_FIRES) as maplibregl.GeoJSONSource | undefined)?.setData(fireDetectionFeatures(f, now));
    (this.map.getSource(SRC_FIRES_ABROAD) as maplibregl.GeoJSONSource | undefined)?.setData(fireAbroadFeatures(f));
    const firesOn = envLayerOn(this.currentLayers ?? {}, 'fires');
    for (const id of FOREST_DANGER_LAYERS) this.setVis(id, firesOn && opts.forestDangerFill ? 'visible' : 'none');
    void this.paintForestDanger();
    this.hideEnvironmentHover();
  }

  /** Remplissage de la météo des forêts : polygones lus seulement quand l'option est cochée. */
  private async paintForestDanger(): Promise<void> {
    const src = this.map?.getSource(SRC_FOREST_DANGER) as maplibregl.GeoJSONSource | undefined;
    if (!this._forestDangerFill) {
      src?.setData(emptyFC());
      return;
    }
    const geo = await this.getDepartmentsGeojson();
    if (!this.map || !this._forestDangerFill) return;
    (this.map.getSource(SRC_FOREST_DANGER) as maplibregl.GeoJSONSource | undefined)?.setData(
      geo ? forestDangerFeatures(geo, this.envFires, this.envFiresNow) : emptyFC(),
    );
  }

  /** Détections d'un foyer mises en avant (survol d'un foyer dans le panneau) ; null : aucune. */
  highlightFoyer(id: string | null): void {
    if (!this.map) return;
    const points = id === null ? [] : (this.envFires?.detections ?? []).filter((d) => d.foyerId === id);
    (this.map.getSource(SRC_FIRES_HIGHLIGHT) as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: points.map((d) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [d.lon, d.lat] }, properties: {} })),
    });
  }

  /** Point du profil vertical radar (null : effacé). */
  setRadarPick(point: { lat: number; lon: number } | null): void {
    this.radarPick = point;
    if (!this.map) return;
    (this.map.getSource(SRC_RADAR_PICK) as maplibregl.GeoJSONSource | undefined)?.setData(point ? radarPickFeature(point.lat, point.lon) : emptyFC());
    const shown = point !== null && envLayerOn(this.currentLayers ?? {}, 'weatherRadar');
    for (const id of ENV_LAYER_KEYS.weatherRadar) this.setVis(id, shown ? 'visible' : 'none');
  }

  /** Clic sur la carte, couche Radar active : point du profil vertical (App.ts lit la colonne). */
  setOnRadarPointPick(handler: (lat: number, lon: number) => void): void {
    this.onRadarPointPick = handler;
  }

  /** Couches crues ou feux réaffichées : couleurs recalculées avec l'horloge courante (S2), jamais celle du dernier rafraîchissement. */
  private repaintEnvironmentOnShow(before: MapLayers | null | undefined, layers: MapLayers): void {
    if (!this.map) return;
    const was = before ?? {};
    if (envLayerOn(layers, 'floods') && !envLayerOn(was, 'floods') && this.envFloods) {
      const now = Date.now();
      (this.map.getSource(SRC_FLOODS) as maplibregl.GeoJSONSource | undefined)?.setData(floodSectionFeatures(this.envFloods, now));
      (this.map.getSource(SRC_FLOOD_STATIONS) as maplibregl.GeoJSONSource | undefined)?.setData(floodStationFeatures(this.envFloods, now));
    }
    if (envLayerOn(layers, 'fires') && !envLayerOn(was, 'fires') && this.envFires) {
      this.envFiresNow = Date.now();
      (this.map.getSource(SRC_FIRES) as maplibregl.GeoJSONSource | undefined)?.setData(fireDetectionFeatures(this.envFires, this.envFiresNow));
      void this.paintForestDanger();
    }
    void this.repaintEnvironmentBOnShow(was, layers);
  }

  /** Phase B réaffichée (sécheresse, qualité de l'air, séismes, marégraphes avec la vigilance) : repeinte à l'heure courante (S2). */
  private async repaintEnvironmentBOnShow(was: EnvBLayerState, layers: EnvBLayerState): Promise<void> {
    const needGeo = ((layers.drought ?? false) && !(was.drought ?? false)) || ((layers.airQuality ?? false) && !(was.airQuality ?? false));
    const geo = needGeo ? await this.getDepartmentsGeojson() : null;
    if (!this.map) return;
    for (const p of envBReshowPaints(was, layers, this.envB, geo, Date.now())) {
      (this.map.getSource(p.source) as maplibregl.GeoJSONSource | undefined)?.setData(p.data);
    }
    this.hideEnvironmentHover();
  }

  /** Clic sur un objet d'une autre couche interactive : le point du profil radar ne se pose que sur la carte vide ou l'image radar. */
  private clickHitsInteractiveFeature(point: maplibregl.PointLike): boolean {
    const map = this.map;
    if (!map) return false;
    const ids = [
      // Surfaces départementales exclues (comme la vigilance et la météo des forêts) : elles couvrent la carte et bloqueraient le profil radar ; séismes et marégraphes restent.
      ...ENV_HOVER_LAYERS.filter((id) => id !== LYR_WEATHER_FILL && id !== LYR_FOREST_DANGER_FILL && id !== LYR_DROUGHT_FILL && id !== LYR_AIR_FILL), LYR_WEATHER_ICONS,
      LYR_POINTS, LYR_CLUSTER_CIRCLE, LYR_TELECOM_PTS, LYR_MILITARY_BASES_CIRCLE, LYR_HOSPITALS,
      ...Object.values(TRAFFIC_LAYER_KEYS).flat(), ...OUT_HOVER_LAYERS, ...SOV_HOVER_LAYERS,
    ].filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
    return ids.length > 0 && map.queryRenderedFeatures(point, { layers: ids }).length > 0;
  }

  /**
   * Image 2D Météo-France visible : couche Radar météo active. L'argument `enabled` de setRadar2dOverlay ne commande plus
   * l'affichage (l'interrupteur « Réflectivité radar 2D » du panneau Feux est remplacé par la couche Radar météo) ; il reste
   * l'état restauré quand une image échoue.
   */
  private radar2dShown(): boolean {
    return this.currentLayers?.weatherRadar ?? false;
  }

  /** Sommets d'écho visibles : option cochée et couche Radar ou Feux active. */
  private echoTopsShown(enabled: boolean): boolean {
    return enabled && ((this.currentLayers?.weatherRadar ?? false) || (this.currentLayers?.fires ?? false));
  }

  /** Pictogrammes des phénomènes de la vigilance en images SDF (teintés par la couleur de l'objet). */
  private registerEnvironmentIcons(): void {
    if (!this.map) return;
    const SIZE = ENV_ICON_SIZE;
    const GLYPH = ENV_ICON_GLYPH;
    const MARGIN = ENV_ICON_MARGIN;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    for (const name of ENV_ICON_NAMES) {
      const id = envIconImage(name);
      if (this.map.hasImage(id)) continue;
      const svg = fmIcon(name, { size: GLYPH }).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replace('stroke="currentColor"', 'stroke="#ffffff"');
      const img = new Image(GLYPH, GLYPH);
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      img.onload = () => {
        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.drawImage(img, MARGIN, MARGIN, GLYPH, GLYPH);
        URL.revokeObjectURL(url);
        // Vrai champ de distance (alphaToSdf) : l'alpha brut du dessin en SDF donnerait des bords crénelés.
        const pixels = ctx.getImageData(0, 0, SIZE, SIZE);
        const sdf = alphaToSdf(pixels.data, SIZE);
        for (let i = 0; i < sdf.length; i += 1) {
          pixels.data[i * 4] = 255;
          pixels.data[i * 4 + 1] = 255;
          pixels.data[i * 4 + 2] = 255;
          pixels.data[i * 4 + 3] = sdf[i] ?? 0;
        }
        if (this.map && !this.map.hasImage(id)) this.map.addImage(id, pixels, { pixelRatio: 2, sdf: true });
      };
      img.src = url;
    }
  }

  /** Ferme l'infobulle de l'environnement (souris hors de la carte, nouvelles données, couches changées). */
  private hideEnvironmentHover(): void {
    if (!this.envHoverShown) return;
    this.envHoverShown = false;
    this.envHoverPopup?.remove();
  }

  /**
   * Couches Environnement : une infobulle au survol, celle de la couche dessinée au-dessus (préparée avec la donnée, texte échappé) ;
   * département de la vigilance survolé mis en avant ; clic sur la carte, couche Radar active : point du profil vertical.
   */
  private initEnvironmentInteractions(): void {
    const map = this.map;
    if (!map) return;
    map.on('mousemove', (e) => {
      const visible = ENV_HOVER_LAYERS.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
      const hit = topEnvHit(visible.length > 0 ? map.queryRenderedFeatures(e.point, { layers: visible }) : []);
      const html = hit ? envTooltipHtml(hit.layer.id, hit.properties ?? {}) : null;
      if (hit?.layer.id === LYR_WEATHER_FILL && html) this.previewWeatherDepartment(String(hit.properties?.['code'] ?? ''));
      if (!html) {
        this.hideEnvironmentHover();
        return;
      }
      this.envHoverShown = true;
      const popup = this.envHoverPopup
        ?? new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, maxWidth: '300px', className: 'dark-popup hm-hover' });
      this.envHoverPopup = popup;
      popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
    });
    map.on('mouseout', () => this.hideEnvironmentHover());
    map.on('click', (e) => {
      if (!this.onRadarPointPick || !(this.currentLayers?.weatherRadar ?? false)) return;
      if (this.clickHitsInteractiveFeature(e.point)) return;
      this.onRadarPointPick(e.lngLat.lat, e.lngLat.lng);
    });
  }

  // ─── Feux : imagerie satellite (GIBS) et MTG-FRP, options de la couche ───

  setModisOverlayVisible(enabled: boolean): void {
    this._modisOverlayEnabled = enabled;
    this.setVis(LYR_MODIS, enabled ? 'visible' : 'none');
    if (enabled) this._modisTilesProbe ??= this.swapModisTilesToLatest();
  }

  private async swapModisTilesToLatest(): Promise<void> {
    try {
      const tileUrl = await resolveLatestGibsViirsTileUrl();
      if (!this.map) return;
      const source = this.map.getSource(SRC_MODIS) as
        | { setTiles?: (tiles: string[]) => void }
        | undefined;
      source?.setTiles?.([tileUrl]);
    } catch (error) {
      console.warn('[DeckGLMap] sondage imagerie GIBS impossible', error);
    }
  }

  setMtgFrpEnabled(enabled: boolean): void {
    this._mtgFrpEnabled = enabled;
    if (!enabled) {
      this.setVis(MTG_FRP_LAYER_ID, 'none');
      return;
    }

    void this.ensureMtgFrpLayer().catch((error) => {
      console.error('[DeckGLMap] MTG-FRP layer unavailable', error);
    });
  }

  async ensureMtgFrpLayer(force = false): Promise<void> {
    if (!this.map) return;

    // Fetch first so a metadata failure never removes the last valid raster.
    const metadata = await fetchMtgFrpMetadata(force);
    const sourceExists = this.map.getSource(MTG_FRP_SOURCE_ID) !== undefined;
    const layerExists = this.map.getLayer(MTG_FRP_LAYER_ID) !== undefined;
    if (metadata.observedAt === this.mtgFrpObservedAt && sourceExists && layerExists) {
      this.setVis(MTG_FRP_LAYER_ID, this._mtgFrpEnabled ? 'visible' : 'none');
      return;
    }

    const previousObservedAt = this.mtgFrpObservedAt;
    this.removeMtgFrpLayer();
    try {
      this.addMtgFrpLayer(metadata.observedAt);
      this.mtgFrpObservedAt = metadata.observedAt;
    } catch (error) {
      this.removeMtgFrpLayer();
      if (previousObservedAt) {
        try {
          this.addMtgFrpLayer(previousObservedAt);
          this.mtgFrpObservedAt = previousObservedAt;
        } catch (rollbackError) {
          this.mtgFrpObservedAt = null;
          console.error('[DeckGLMap] Failed to restore previous MTG-FRP layer', rollbackError);
        }
      }
      throw error;
    }
  }

  private addMtgFrpLayer(observedAt: string): void {
    if (!this.map) return;
    const separator = getMtgFrpTileTemplate().includes('?') ? '&' : '?';
    const tileUrl = `${getMtgFrpTileTemplate()}${separator}time=${encodeURIComponent(observedAt)}`;
    this.map.addSource(MTG_FRP_SOURCE_ID, {
      type: 'raster',
      tiles: [tileUrl],
      tileSize: 256,
      // Sur-zoom au-delà de z10 : symboles nets et discrets en vue large,
      // agrandis progressivement en vue rapprochée — cohérent avec
      // l'emprise réelle (~2 km) d'une cellule Meteosat.
      maxzoom: 10,
      attribution: 'EUMETSAT LSA SAF · CC BY 4.0',
    });
    const layer: maplibregl.RasterLayerSpecification = {
      id: MTG_FRP_LAYER_ID,
      type: 'raster',
      source: MTG_FRP_SOURCE_ID,
      layout: { visibility: this._mtgFrpEnabled ? 'visible' : 'none' },
      paint: {
        'raster-opacity': 0.82,
        'raster-fade-duration': 0,
      },
    };
    // Au sommet de la pile : les cellules FRP et leurs valeurs en MW doivent
    // rester lisibles au-dessus des marqueurs FIRMS.
    this.map.addLayer(layer);
    this.setVis(MTG_FRP_LAYER_ID, this._mtgFrpEnabled ? 'visible' : 'none');
  }

  private removeMtgFrpLayer(): void {
    if (!this.map) return;
    if (this.map.getLayer(MTG_FRP_LAYER_ID)) this.map.removeLayer(MTG_FRP_LAYER_ID);
    if (this.map.getSource(MTG_FRP_SOURCE_ID)) this.map.removeSource(MTG_FRP_SOURCE_ID);
  }

  setEchoTopsOverlay(manifest: Radar2dManifest | null, enabled: boolean): void {
    this._echoTopsEnabled = enabled;
    if (!this.map) return;
    const url = manifest?.echoTopImageUrl;
    if (!url) {
      this.setVis(ECHO_TOPS_LAYER_ID, 'none');
      return;
    }
    const [west, south, east, north] = manifest.bounds;
    const coordinates = [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ] as [[number, number], [number, number], [number, number], [number, number]];
    if (!this.map.getSource(ECHO_TOPS_SOURCE_ID)) {
      this.map.addSource(ECHO_TOPS_SOURCE_ID, { type: 'image', url, coordinates });
      this.map.addLayer(
        {
          id: ECHO_TOPS_LAYER_ID,
          type: 'raster',
          source: ECHO_TOPS_SOURCE_ID,
          layout: { visibility: this.echoTopsShown(enabled) ? 'visible' : 'none' },
          paint: {
            'raster-opacity': 0.62,
            'raster-resampling': 'linear',
            'raster-fade-duration': 0,
          },
        },
        this.map.getLayer(LYR_WEATHER_FILL) ? LYR_WEATHER_FILL : undefined,
      );
    } else if (this._echoTopsUrl !== url) {
      const source = this.map.getSource(ECHO_TOPS_SOURCE_ID) as
        | { updateImage?: (options: { url: string; coordinates: typeof coordinates }) => void }
        | undefined;
      source?.updateImage?.({ url, coordinates });
    }
    this._echoTopsUrl = url;
    this.setVis(ECHO_TOPS_LAYER_ID, this.echoTopsShown(enabled) ? 'visible' : 'none');
  }

  async setRadar2dOverlay(manifest: Radar2dManifest | null, enabled: boolean): Promise<void> {
    if (this.radar2dDestroyed) return;
    const operationGeneration = ++this.radar2dOperationGeneration;
    if (!this.map) {
      this._radar2dEnabled = enabled;
      return;
    }
    const operationMap = this.map;
    if (!manifest) {
      this.removeRadar2dLayer();
      this.revokeRadar2dObjectUrl(this.radar2dObjectUrl);
      this.radar2dObjectUrl = null;
      this.radar2dManifest = null;
      this._radar2dEnabled = enabled;
      return;
    }

    const sourceExists = this.map.getSource(RADAR_2D_SOURCE_ID) !== undefined;
    const layerExists = this.map.getLayer(RADAR_2D_LAYER_ID) !== undefined;
    if (manifest.observedAt === this.radar2dManifest?.observedAt && sourceExists && layerExists) {
      this._radar2dEnabled = enabled;
      this.setVis(RADAR_2D_LAYER_ID, this.radar2dShown() ? 'visible' : 'none');
      return;
    }

    const previous = this.radar2dManifest;
    const previousObjectUrl = this.radar2dObjectUrl;
    const previousEnabled = this._radar2dEnabled;
    // Fetch the remote asset exactly once, then validate and install the same
    // local Blob URL. The image source can no longer trigger a second network
    // request whose asynchronous failure would escape this transaction.
    const candidateObjectUrl = await this.prepareRadar2dImage(
      manifest.imageUrl,
      operationMap,
      operationGeneration,
    );
    let committed = false;
    try {
      this.assertRadar2dOperationCurrent(operationMap, operationGeneration);
      this.removeRadar2dLayer();
      this._radar2dEnabled = enabled;
      this.addRadar2dLayer(manifest, candidateObjectUrl);
      this.assertRadar2dOperationCurrent(operationMap, operationGeneration);
      this.radar2dManifest = manifest;
      this.radar2dObjectUrl = candidateObjectUrl;
      committed = true;
      this.revokeRadar2dObjectUrl(previousObjectUrl);
    } catch (error) {
      this._radar2dEnabled = previousEnabled;
      try {
        this.removeRadar2dLayer();
        if (previous && previousObjectUrl) {
          this.addRadar2dLayer(previous, previousObjectUrl);
          this.radar2dManifest = previous;
          this.radar2dObjectUrl = previousObjectUrl;
        } else {
          this.radar2dManifest = null;
          this.radar2dObjectUrl = null;
        }
      } catch (rollbackError) {
        console.error('[DeckGLMap] Failed to restore previous radar 2D layer', rollbackError);
      }
      throw error;
    } finally {
      if (!committed) this.revokeRadar2dObjectUrl(candidateObjectUrl);
    }
  }

  private async prepareRadar2dImage(
    url: string,
    operationMap: maplibregl.Map,
    operationGeneration: number,
  ): Promise<string> {
    const timeoutMs = 10_000;
    const maxBytes = 16 * 1024 * 1024;
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let objectUrl: string | null = null;
    try {
      const blob = await Promise.race([
        (async () => {
          const response = await fetch(url, {
            headers: { Accept: 'image/webp, image/png' },
            mode: 'cors',
            redirect: 'error',
            signal: controller.signal,
          });
          this.assertRadar2dOperationCurrent(operationMap, operationGeneration);
          if (!response.ok) throw new Error(`Radar 2D image HTTP ${response.status}`);
          const contentType = (response.headers.get('Content-Type') ?? '').split(';', 1)[0]?.trim().toLowerCase();
          if (contentType !== 'image/webp' && contentType !== 'image/png') {
            throw new Error(`Unsupported radar 2D image type: ${contentType || 'missing'}`);
          }
          const declaredLength = Number(response.headers.get('Content-Length'));
          if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
            throw new Error('Radar 2D image exceeds 16 MiB');
          }
          const reader = response.body?.getReader();
          if (!reader) throw new Error('Radar 2D image body is unavailable');
          const parts: BlobPart[] = [];
          let receivedBytes = 0;
          try {
            while (true) {
              const { done, value } = await reader.read();
              this.assertRadar2dOperationCurrent(operationMap, operationGeneration);
              if (done) break;
              receivedBytes += value.byteLength;
              if (receivedBytes > maxBytes) {
                await reader.cancel();
                throw new Error('Radar 2D image exceeds 16 MiB');
              }
              parts.push(value.buffer.slice(
                value.byteOffset,
                value.byteOffset + value.byteLength,
              ) as ArrayBuffer);
            }
          } finally {
            reader.releaseLock();
          }
          return new Blob(parts, { type: contentType });
        })(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => {
              const error = new Error(`Radar 2D image fetch timed out after ${timeoutMs}ms`);
              controller.abort(error);
              reject(error);
            },
            timeoutMs,
          );
        }),
      ]);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      this.assertRadar2dOperationCurrent(operationMap, operationGeneration);

      objectUrl = URL.createObjectURL(blob);
      const decoded = operationMap.loadImage(objectUrl).then(({ data }) => {
        this.closeRadar2dDecodedImage(data);
      });
      await Promise.race([
        decoded,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error(`Radar 2D image decode timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
      this.assertRadar2dOperationCurrent(operationMap, operationGeneration);
      return objectUrl;
    } catch (error) {
      if (objectUrl) this.revokeRadar2dObjectUrl(objectUrl);
      throw error;
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  private assertRadar2dOperationCurrent(
    operationMap: maplibregl.Map,
    operationGeneration: number,
  ): void {
    if (
      this.radar2dDestroyed
      || this.map !== operationMap
      || this.radar2dOperationGeneration !== operationGeneration
    ) {
      throw new Error('Radar 2D operation cancelled or superseded');
    }
  }

  private closeRadar2dDecodedImage(image: HTMLImageElement | ImageBitmap): void {
    try {
      (image as { close?: () => void }).close?.();
    } catch {
      // Decoding was only a validation probe; cleanup must not break the swap.
    }
  }

  private addRadar2dLayer(manifest: Radar2dManifest, imageUrl: string): void {
    if (!this.map) return;
    const [west, south, east, north] = manifest.bounds;
    const source = {
      type: 'image' as const,
      url: imageUrl,
      coordinates: [
        [west, north],
        [east, north],
        [east, south],
        [west, south],
      ] as [[number, number], [number, number], [number, number], [number, number]],
    };
    this.map.addSource(RADAR_2D_SOURCE_ID, source as maplibregl.SourceSpecification);
    this.map.addLayer({
      id: RADAR_2D_LAYER_ID,
      type: 'raster',
      source: RADAR_2D_SOURCE_ID,
      layout: { visibility: this.radar2dShown() ? 'visible' : 'none' },
      paint: {
        'raster-opacity': 0.58,
        // Mosaïque de 1 km : pixels nets à tous les zooms utiles (spec § 2.3), jamais lissés.
        'raster-resampling': 'nearest',
        'raster-fade-duration': 0,
      },
    }, this.map.getLayer(ECHO_TOPS_LAYER_ID) ? ECHO_TOPS_LAYER_ID : this.map.getLayer(LYR_WEATHER_FILL) ? LYR_WEATHER_FILL : undefined);
    // DeckGLMap's anti-flash wrapper hides newly added layers during startup.
    this.setVis(RADAR_2D_LAYER_ID, this.radar2dShown() ? 'visible' : 'none');
  }

  private removeRadar2dLayer(): void {
    if (!this.map) return;
    if (this.map.getLayer(RADAR_2D_LAYER_ID)) this.map.removeLayer(RADAR_2D_LAYER_ID);
    if (this.map.getSource(RADAR_2D_SOURCE_ID)) this.map.removeSource(RADAR_2D_SOURCE_ID);
  }

  private revokeRadar2dObjectUrl(url: string | null): void {
    if (url) URL.revokeObjectURL(url);
  }

  setSentinelSceneOverlay(scene: { thumbnailUrl?: string; bbox: [number, number, number, number] } | null): void {
    if (!this.map) return;
    this.stopSentinelSceneBlink();

    if (!scene?.thumbnailUrl) {
      this.setVis(LYR_SENTINEL_SCENE, 'none');
      return;
    }

    const source = this.map.getSource(SRC_SENTINEL_SCENE) as maplibregl.ImageSource | undefined;
    const [minLng, minLat, maxLng, maxLat] = scene.bbox;
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [minLng, maxLat],
      [maxLng, maxLat],
      [maxLng, minLat],
      [minLng, minLat],
    ];

    source?.updateImage({
      url: scene.thumbnailUrl,
      coordinates,
    });

    this.setVis(LYR_SENTINEL_SCENE, 'visible');
  }

  startSentinelSceneBlink(
    afterScene: { thumbnailUrl?: string; bbox: [number, number, number, number] },
    beforeScene: { thumbnailUrl?: string; bbox: [number, number, number, number] },
    intervalMs = 900,
  ): void {
    if (!this.map || !afterScene.thumbnailUrl || !beforeScene.thumbnailUrl) return;
    this.stopSentinelSceneBlink();

    const scenes = [afterScene, beforeScene];
    let index = 0;
    this.setSentinelSceneOverlay(scenes[index]);

    this._sentinelBlinkInterval = setInterval(() => {
      index = (index + 1) % scenes.length;
      const scene = scenes[index];
      const source = this.map?.getSource(SRC_SENTINEL_SCENE) as maplibregl.ImageSource | undefined;
      if (!this.map || !source || !scene.thumbnailUrl) return;
      const [minLng, minLat, maxLng, maxLat] = scene.bbox;
      source.updateImage({
        url: scene.thumbnailUrl,
        coordinates: [
          [minLng, maxLat],
          [maxLng, maxLat],
          [maxLng, minLat],
          [minLng, minLat],
        ],
      });
      this.setVis(LYR_SENTINEL_SCENE, 'visible');
    }, intervalMs);
  }

  stopSentinelSceneBlink(): void {
    if (this._sentinelBlinkInterval !== null) {
      clearInterval(this._sentinelBlinkInterval);
      this._sentinelBlinkInterval = null;
    }
  }

  async setMairesPolitiqueVisible(enabled: boolean): Promise<void> {
    const map = this.map;
    if (!map) return;

    if (!enabled) {
      this.setVis(LYR_MAIRES_POL, 'none');
      this.setVis(LYR_MAIRES_POL_LABEL, 'none');
      return;
    }

    // Chargement lazy du dataset
    if (!this._mairesPolitiqueData) {
      try {
        const res = await fetch('/data/maires-politique.json');
        this._mairesPolitiqueData = await res.json() as Array<{c:string;lat:number;lon:number;n:string;nom:string}>;
      } catch { return; }
    }

    const features = this._mairesPolitiqueData.map(m => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [m.lon, m.lat] },
      properties: { nuance: m.n, nom: m.nom, code: m.c },
    }));

    const src = map.getSource(SRC_MAIRES_POL) as import('maplibre-gl').GeoJSONSource | undefined;
    if (src) {
      src.setData({ type: 'FeatureCollection', features });
    } else {
      map.addSource(SRC_MAIRES_POL, { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({
        id: LYR_MAIRES_POL,
        type: 'circle',
        source: SRC_MAIRES_POL,
        minzoom: 8,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 12, 7],
          'circle-color': [
            'match', ['get', 'nuance'],
            'LSOC', '#cf3245', 'LDVG', '#e05252', 'LVE', '#43a85a',
            'LFI', '#c0392b', 'LCOM', '#8b0000', 'LREM', '#f0b800',
            'LDVC', '#a0a040', 'LLR', '#2980b9', 'LDVD', '#4a90d9',
            'LRN', '#1a1a6e', 'LFN', '#0d0d55', 'LREG', '#8e44ad',
            '#7f8c8d',
          ],
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(0,0,0,0.4)',
          'circle-opacity': 0.85,
        },
      });
      map.addLayer({
        id: LYR_MAIRES_POL_LABEL,
        type: 'symbol',
        source: SRC_MAIRES_POL,
        minzoom: 11,
        layout: {
          'text-field': ['get', 'nom'],
          'text-size': 10,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
        },
        paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(0,0,0,0.7)', 'text-halo-width': 1 },
      });
    }
    this.setVis(LYR_MAIRES_POL, 'visible');
    this.setVis(LYR_MAIRES_POL_LABEL, 'visible');
  }

  // ─── Infrastructure Layer ───

  updateInfrastructure(points: InfrastructureRenderPoint[]): void {
    if (!this.map) return;
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: points.filter((p) => p.status !== 'shutdown').map((p) => {
        let color = p.colorOverride ?? INFRA_COLORS[p.type] ?? '#8e8e93';
        const isElectricGeneration = p.type === 'nuclear' || p.type === 'thermal' || p.type === 'hydro';
        const baseRadius =
          p.type === 'nuclear' ? 8
            : p.type === 'thermal' || p.type === 'hydro' || p.type === 'refinery' ? 7
              : p.type === 'gas-terminal' ? 6.8
                : p.type === 'gas-storage' || p.type === 'oil-depot' ? 6.2
                  : 5.8;

        if (!p.colorOverride && p.type === 'nuclear' && p.status === 'maintenance') color = '#B7D6E7';

        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: p.coordinates },
          properties: {
            name: p.name,
            type: p.type,
            color,
            baseRadius,
            capacity: p.capacity ?? 0,
            capacityUnit: p.capacityUnit ?? '',
            availabilityRatio: p.type === 'nuclear' ? (p.globalAvailability ?? 1) : 1,
            power: isElectricGeneration ? (p.totalPower ?? p.capacity ?? 0) : 0,
            available: isElectricGeneration ? (p.totalAvailable ?? p.capacity ?? 0) : 0,
            operator: p.operator ?? '',
            voltageKv: p.voltageKv ?? 0,
            fuelType: p.fuelType ?? '',
            storageCapacityHm3: p.storageCapacityHm3 ?? 0,
            throughputKbpd: p.throughputKbpd ?? 0,
            notes: p.notes ?? '',
          },
        };
      }),
    };
    const src = this.map.getSource(SRC_INFRA) as maplibregl.GeoJSONSource;
    src?.setData(fc);
  }

  updateDromEnergy(dashboard: DromEnergyDashboard): void {
    if (!this.map) return;

    const territories = new Map(dashboard.territories.map((territory) => [territory.code, territory.name]));
    const datasetLabels = new Map(dashboard.datasets.map((dataset) => [dataset.id, dataset.label]));
    const supportedTypes = new Set<DromEnergyAssetType>(['source_substation', 'htb_pylon', 'production_site']);
    const typeLabels: Record<DromEnergyAssetType, string> = {
      source_substation: 'Poste source',
      htb_pylon: 'Pylône HTB',
      production_site: 'Site de production',
      storage_site: 'Stockage',
      hosting_capacity_point: "Capacité d'accueil",
    };
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: dashboard.assets
        .filter((asset) => supportedTypes.has(asset.type) && asset.coordinates)
        .map((asset) => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: asset.coordinates!,
          },
          properties: {
            id: asset.id,
            name: asset.name,
            territoryCode: asset.territoryCode,
            territoryName: territories.get(asset.territoryCode) ?? asset.territoryCode,
            assetType: asset.type,
            typeLabel: typeLabels[asset.type],
            sourceDatasetId: asset.sourceDatasetId,
            datasetLabel: datasetLabels.get(asset.sourceDatasetId) ?? asset.sourceDatasetId,
            communeName: asset.communeName ?? '',
            operator: asset.operator ?? '',
            voltageKv: asset.voltageKv ?? null,
            capacityMw: asset.capacityMw ?? null,
            availableCapacityMw: asset.availableCapacityMw ?? null,
            productionType: asset.productionType ?? '',
          },
        })),
    };

    const src = this.map.getSource(SRC_DROM_ENERGY) as maplibregl.GeoJSONSource | undefined;
    src?.setData(fc);

    const linesSrc = this.map.getSource(SRC_DROM_ENERGY_HTA_LINES) as maplibregl.GeoJSONSource | undefined;
    const reunionHtaLines = (dashboard as DromEnergyDashboard & {
      gridLines?: { reunionHta?: ReturnType<typeof emptyFC> };
    }).gridLines?.reunionHta;
    linesSrc?.setData(reunionHtaLines ?? emptyFC());

    const visibility = this.currentLayers?.dromEnergy ? 'visible' : 'none';
    this.setVis(LYR_DROM_ENERGY_HTA_LINES, visibility);
    this.setVis(LYR_DROM_ENERGY_POINTS, visibility);
    this.setVis(LYR_DROM_ENERGY_HIGHLIGHT, visibility);
  }

  highlightDromEnergyAsset(asset: DromEnergyAsset | null): void {
    if (!this.map) return;
    const src = this.map.getSource(SRC_DROM_ENERGY_HIGHLIGHT) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    if (!asset?.coordinates) {
      src.setData(emptyFC());
      return;
    }

    src.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: asset.coordinates,
        },
        properties: {
          id: asset.id,
          name: asset.name,
          type: asset.type,
        },
      }],
    });
  }

  updateHydraulicBackbone(assets: HydraulicBackboneAsset[]): void {
    if (!this.map) return;

    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: assets.map((asset) => {
        const radius = clamp(4.5 + asset.criticality_score * 0.08, 5, 14);
        const observationTimestamp = asset.signals.observationTimestamp
          ? new Date(asset.signals.observationTimestamp).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
          : '';
        return {
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [asset.location.lon, asset.location.lat] as [number, number],
          },
          properties: {
            name: asset.name,
            type: asset.type,
            subtype: asset.subtype,
            region: asset.location.region,
            capacityMw: asset.capacity_mw ?? 0,
            reservoirVolume: asset.reservoir_volume ?? 0,
            operator: asset.operator ?? '',
            river: asset.river ?? '',
            commune: asset.commune ?? '',
            department: asset.department ?? '',
            technology: asset.technology ?? '',
            locationAccuracy: asset.location_accuracy ?? '',
            sourceDate: asset.source_date ?? '',
            signalColor: HYDRAULIC_TREND_COLORS[asset.signals.hydro_trend] ?? '#BFDBFE',
            signalOpacity:
              asset.signals.hydro_trend === 'stress' ? 0.98
                : asset.signals.hydro_trend === 'high' ? 0.92
                  : asset.signals.hydro_trend === 'low' ? 0.72
                    : 0.58,
            signalStrokeWidth:
              asset.signals.hydro_trend === 'stress' ? 3.2
                : asset.signals.hydro_trend === 'high' ? 2.6
                  : asset.signals.hydro_trend === 'low' ? 1.9
                    : 1.5,
            signalRadiusBoost:
              asset.signals.hydro_trend === 'stress' ? 5.6
                : asset.signals.hydro_trend === 'high' ? 4.4
                  : asset.signals.hydro_trend === 'low' ? 3.2
                    : 2.6,
            criticalityScore: asset.criticality_score,
            hydroTrend: asset.signals.hydro_trend,
            lastUpdate: asset.signals.last_update,
            signalSource: asset.signals.signalSource,
            dataFreshness: asset.signals.dataFreshness,
            measuredSupportLevel: asset.signals.measuredSupportLevel,
            observationTrend: asset.signals.hydroTrend,
            observationTimestamp,
            confidence: asset.signals.confidence,
            measuredStationCount: asset.signals.measuredStationCount,
            sourceDetail: asset.signals.sourceDetail ?? '',
            color: HYDRAULIC_COLORS[asset.type] ?? '#3B82F6',
            radius,
          },
        };
      }),
    };

    const src = this.map.getSource(SRC_HYDRO_BACKBONE) as maplibregl.GeoJSONSource | undefined;
    src?.setData(fc);
  }

  updateEolien(live: EolienLive | null, parks: EolienParkSummary[]): void {
    if (!this.map) return;
    this._latestEolienLive = live;
    const clusteredPoints = parks.filter((park) => park.kind !== 'offshore');
    const standaloneParks = parks.filter((park) => park.kind === 'offshore');
    const clusteredFc = buildEolienLayerFeatureCollection(live, clusteredPoints);
    const parksFc = buildEolienLayerFeatureCollection(live, standaloneParks);
    const src = this.map.getSource(SRC_WIND_TURBINES) as maplibregl.GeoJSONSource | undefined;
    const parksSrc = this.map.getSource(SRC_WIND_PARKS) as maplibregl.GeoJSONSource | undefined;
    src?.setData(clusteredFc);
    parksSrc?.setData(parksFc);
  }

  // ─── Métropoles Layer ───

  updateMetropoles(data: MetropoleConsumption[]): void {
    if (!this.map) return;
    if (data.length === 0) return;

    const classified = classifyMetropoles(data);

    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: classified.map((m) => {
        const mwLabel = `${Math.round(m.loadMW).toLocaleString('fr-FR')} MW`;
        // Format update time for tooltip use
        let updatedAt = '';
        try {
          const d = new Date(m.date_heure);
          updatedAt = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) +
            ' · ' + d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
        } catch { /* ignore */ }

        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [m.lon, m.lat] },
          properties: {
            code: m.code,
            name: m.name,
            radius: m.circleRadius,
            color: m.color,
            glowColor: m.glowColor,
            sizeClass: m.sizeClass,
            mwLabel,
            nationalSharePct: m.nationalSharePct ?? null,
            deltaVsJ1Pct: m.deltaVsJ1Pct ?? null,
            updatedAt,
          },
        };
      }),
    };

    const src = this.map.getSource(SRC_METRO_LOAD) as maplibregl.GeoJSONSource;
    src?.setData(fc);
  }

  // ─── Événements consolidés (v2) ───

  setEventPoints(points: EventMapPoint[]): void {
    this.eventPoints = points;
    this.scheduleOverlayUpdate();
  }

  setOnEventPointClick(handler: ((id: number) => void) | null): void {
    this.onEventPointClick = handler;
  }

  // ─── Souveraineté (spec 2026-10-04 souveraineté § 2 ; contrats § 5) ───

  /** Aéronefs militaires au-dessus de la France (français en bleu, autres en rose), hors de France en gris, urgences cerclées par niveau ; relevé en retard : gris. */
  updateMilitaryLayer(m: MilitaryResponse | null, now: number): void {
    this.sovMilitary = m;
    if (!this.map) return;
    this.paintMilitary(m, now);
    this.hideSovereigntyHover();
  }

  private paintMilitary(m: MilitaryResponse | null, now: number): void {
    if (!this.map) return;
    (this.map.getSource(SRC_SOV_AIRCRAFT) as maplibregl.GeoJSONSource | undefined)?.setData(aircraftFeatures(m, now));
    (this.map.getSource(SRC_SOV_AIRCRAFT_ABROAD) as maplibregl.GeoJSONSource | undefined)?.setData(abroadAircraftFeatures(m));
    (this.map.getSource(SRC_SOV_EMERGENCIES) as maplibregl.GeoJSONSource | undefined)?.setData(militaryEmergencyFeatures(m, now));
  }

  /** Marine nationale : vus en AIS (heure en étiquette ; flux figé : gris) et ports base de référence (icône à part) ; jamais un SNLE ni un SNA (O11). */
  updateNavyLayer(ships: readonly MilitaryShip[], frozen: boolean, now: number): void {
    // O11 : un sous-marin n'entre jamais dans la table (surbrillance et sélection par MMSI).
    const shown = ships.filter((s) => !isSubmarine(s));
    this.sovNavy = { ships: shown, frozen };
    if (!this.map) return;
    // Surbrillance et sélection du Trafic maritime : un bâtiment au port est retrouvé par son MMSI dans cette table.
    this.militaryShipsById.clear();
    for (const s of shown) this.militaryShipsById.set(s.id, s);
    (this.map.getSource(SRC_SOV_NAVY) as maplibregl.GeoJSONSource | undefined)?.setData(navyFeatures(shown, frozen, now));
    this.updateMilitaryShipMarkerSource(SRC_MILITARY_SHIPS_HIGHLIGHT, this._highlightedMmsi);
    this.updateMilitaryShipMarkerSource(SRC_MILITARY_SHIPS_SELECTED, this._selectedShipMmsi);
  }

  /** Sites de la liste interne (triangles par catégorie), sans fusion OpenStreetMap. */
  updateDefenseSites(bases: readonly MilitaryBase[]): void {
    if (!this.map) return;
    this.militaryBasesById.clear();
    for (const b of bases) this.militaryBasesById.set(b.id, b);
    (this.map.getSource(SRC_MILITARY_BASES) as maplibregl.GeoJSONSource | undefined)?.setData(defenseSiteFeatures(bases));
  }

  /** Ouvrages OpenStreetMap (option de la couche Défense, éteinte par défaut). */
  updateOsmWorks(file: DefenseOsmWorksFile | null): void {
    (this.map?.getSource(SRC_SOV_OSM_WORKS) as maplibregl.GeoJSONSource | undefined)?.setData(osmWorksFeatures(file));
  }

  setOsmWorksVisible(on: boolean): void {
    this.osmWorksVisible = on;
    const shown = on && (this.currentLayers?.military ?? false);
    for (const id of SOV_OPTION_LAYERS.osmWorks) this.setVis(id, shown ? 'visible' : 'none');
  }

  /** Câbles télécom du Shom et d'OpenStreetMap (tracés, atterrages) et navires lents signalés, datés. */
  updateCablesLayer(file: SubseaCablesFile | null, watch: CablesWatchResponse | null, now: number): void {
    this.sovCables = file;
    this.sovCableWatch = watch;
    if (!this.map) return;
    (this.map.getSource(SRC_SUBMARINE_CABLES) as maplibregl.GeoJSONSource | undefined)?.setData(cableFeatures(file));
    (this.map.getSource(SRC_SUBMARINE_CABLES_LANDINGS) as maplibregl.GeoJSONSource | undefined)?.setData(landingFeatures(file));
    (this.map.getSource(SRC_SOV_CABLE_VESSELS) as maplibregl.GeoJSONSource | undefined)?.setData(cableAlertFeatures(watch, now));
    this.hideSovereigntyHover();
  }

  /** Câble choisi dans le panneau Connectivité : la carte se cale sur l'emprise de son tracé ; null : rien ne bouge. */
  highlightCable(id: string | null): void {
    const cable = id === null ? undefined : this.sovCables?.cables.find((c) => c.id === id);
    const points = cable ? cable.path.flat() : [];
    if (points.length === 0) return;
    const lons = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    this.fitBounds([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], 80);
  }

  /** Clic sur un objet Souveraineté : App.ts ouvre le panneau de sa couche ou la fiche d'un navire. */
  setOnSovereigntyFeatureClick(handler: (layerId: string, props: Record<string, unknown>) => void): void {
    this.onSovereigntyFeatureClick = handler;
  }

  /** Défense ou Connectivité réaffichée : couleurs recalculées avec l'horloge courante (S2), jamais celle du dernier rafraîchissement. */
  private repaintSovereigntyOnShow(before: MapLayers | null | undefined, layers: MapLayers): void {
    if (!this.map) return;
    const was = before ?? ({} as Partial<MapLayers>);
    const now = Date.now();
    if (layers.military && !was.military) {
      if (this.sovMilitary) this.paintMilitary(this.sovMilitary, now);
      if (this.sovNavy) (this.map.getSource(SRC_SOV_NAVY) as maplibregl.GeoJSONSource | undefined)?.setData(navyFeatures(this.sovNavy.ships, this.sovNavy.frozen, now));
    }
    if (layers.subseaCables && !was.subseaCables && this.sovCableWatch) {
      (this.map.getSource(SRC_SOV_CABLE_VESSELS) as maplibregl.GeoJSONSource | undefined)?.setData(cableAlertFeatures(this.sovCableWatch, now));
    }
  }

  private hideSovereigntyHover(): void {
    if (!this.sovHoverShown) return;
    this.sovHoverShown = false;
    this.sovHoverPopup?.remove();
  }

  /** Couches Souveraineté : une infobulle préparée avec la donnée (couche du dessus, texte échappé) ; clic transmis à App.ts. */
  private initSovereigntyInteractions(): void {
    const map = this.map;
    if (!map) return;
    const visibleLayers = (): string[] => SOV_HOVER_LAYERS.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
    map.on('mousemove', (e) => {
      const layers = visibleLayers();
      const hit = topSovHit(layers.length > 0 ? map.queryRenderedFeatures(e.point, { layers }) : []);
      const html = hit ? sovTooltipHtml(hit.layer.id, hit.properties ?? {}) : null;
      if (!html) {
        this.hideSovereigntyHover();
        return;
      }
      this.sovHoverShown = true;
      const popup = this.sovHoverPopup
        ?? new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, maxWidth: '300px', className: 'dark-popup hm-hover' });
      this.sovHoverPopup = popup;
      popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
    });
    map.on('mouseout', () => this.hideSovereigntyHover());
    map.on('click', (e) => {
      if (!this.onSovereigntyFeatureClick) return;
      const layers = visibleLayers();
      const hit = topSovHit(layers.length > 0 ? map.queryRenderedFeatures(e.point, { layers }) : []);
      if (hit) this.onSovereigntyFeatureClick(hit.layer.id, { ...(hit.properties ?? {}) });
    });
  }

  // ─── Pannes réseau (spec 2026-10-08 § 2.1, § 2.2) : carte WebGL seulement ───

  /** Sites ARCEP du dernier fichier lu : récents en rouge, plus anciens en orange, maintenances en option ; fichier en retard : gris. */
  updateOutagesTelecom(t: TelecomOutagesResponse | null, now: number): void {
    (this.map?.getSource(SRC_OUT_TELECOM) as maplibregl.GeoJSONSource | undefined)?.setData(telecomFeatures(t, now));
    this.hideOutagesHover();
  }

  /** Unités de production en arrêt imprévu ou en maintenance, placées par la liste d'emplacements (sans emplacement : non dessinées). */
  updateOutagesPower(p: PowerOutagesResponse | null, now: number): void {
    (this.map?.getSource(SRC_OUT_POWER) as maplibregl.GeoJSONSource | undefined)?.setData(powerFeatures(p, now));
    this.hideOutagesHover();
  }

  /** Option « maintenances » de la couche Télécoms, éteinte par défaut : visible seulement couche active. */
  setTelecomMaintenanceVisible(on: boolean): void {
    this.telecomMaintenanceOn = on;
    this.setVis(OUT_MAINTENANCE_LAYER, on && (this.currentLayers?.outagesTelecom ?? false) ? 'visible' : 'none');
  }

  /** Unité de production cliquée dans le panneau Électricité : la carte se centre sur son emplacement connu, sinon rien (jamais une position inventée). */
  flyToAsset(label: string): void {
    const coords = resolveAssetCoords(label);
    if (coords) this.flyTo(coords[0], coords[1], 9);
  }

  private hideOutagesHover(): void {
    if (!this.outHoverShown) return;
    this.outHoverShown = false;
    this.outHoverPopup?.remove();
  }

  /** Couches Pannes réseau : une infobulle préparée avec la donnée (couche du dessus, texte échappé). */
  private initOutagesInteractions(): void {
    const map = this.map;
    if (!map) return;
    map.on('mousemove', (e) => {
      const layers = OUT_HOVER_LAYERS.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
      const hit = topOutHit(layers.length > 0 ? map.queryRenderedFeatures(e.point, { layers }) : []);
      const html = hit ? outTooltipHtml(hit.layer.id, hit.properties ?? {}) : null;
      if (!html) {
        this.hideOutagesHover();
        return;
      }
      this.outHoverShown = true;
      const popup = this.outHoverPopup
        ?? new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, maxWidth: '300px', className: 'dark-popup hm-hover' });
      this.outHoverPopup = popup;
      popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
    });
    map.on('mouseout', () => this.hideOutagesHover());
  }

  // ─── Military Layers ───

  /** Mailles GNSS jaunes et orange du jour UTC précédent (hors de France en gris, dégradation générale du jour en contour seul). */
  updateGnssLayer(g: GnssResponse | null, now: number): void {
    (this.map?.getSource(SRC_SOV_GNSS) as maplibregl.GeoJSONSource | undefined)?.setData(gnssCellFeatures(g, now));
    this.hideSovereigntyHover();
  }

  /** Zones drones DGAC du fichier publié (lu une fois par session par App.ts). */
  updateDroneZones(file: DroneZonesFile | null): void {
    (this.map?.getSource(SRC_SOV_DRONES) as maplibregl.GeoJSONSource | undefined)?.setData(droneZoneFeatures(file));
  }

  /** Option « zones drones » de la couche Défense, éteinte par défaut : visible seulement couche active. */
  setDroneZonesVisible(on: boolean): void {
    this.droneZonesVisible = on;
    const shown = on && (this.currentLayers?.military ?? false);
    for (const id of SOV_OPTION_LAYERS.droneZones) this.setVis(id, shown ? 'visible' : 'none');
  }

  updateAirTraffic(flights: AirTrafficFlight[]): void {
    if (!this.map) return;

    // Update lookup map for tooltip/click handlers
    this.airTrafficFlightsById.clear();
    for (const flight of flights) this.airTrafficFlightsById.set(flight.id, flight);

    // OSINT: Filter out military flights for the civil traffic layer
    // Aéronefs militaires : couche Défense (adsb.lol, collecte du serveur, deckgl/sovereignty-map.ts)
    const newCivil = flights.filter(f => {
      const cs = f.callsign?.trim() ?? '';
      return !identifyFrenchCallsign(cs) && !identifyAlliedCallsign(cs);
    });

    // ─── Capture previous positions for tween animation ───
    // Save current (target) positions as the "previous" for the next tween.
    // If this is the first snapshot (no previous data), skip animation.
    const hadPreviousData = this.civilAirTrafficFlights.length > 0;
    if (hadPreviousData) {
      // Build previous positions from the OLD civilAirTrafficFlights data
      // (i.e. the target positions from the last snapshot, which are now "old")
      const newPrev = new Map<string, { lon: number; lat: number; heading: number }>();
      for (const f of this.civilAirTrafficFlights) {
        const lon = Number(f.longitude);
        const lat = Number(f.latitude);
        if (Number.isFinite(lon) && Number.isFinite(lat)) {
          newPrev.set(f.id, { lon, lat, heading: this.normalizeFlightHeading(f.heading) });
        }
      }
      this.civilAirPrevPositions = newPrev;
    }

    this.civilAirTrafficFlights = newCivil;

    // Animation des positions (12 s) : couche active, zoom 7 ou plus, jamais au premier relevé. Sous le zoom 7, les icônes restent
    // dessinées et leurs positions sont posées d'un coup : une seule reconstruction des couches par relevé, aucune par image.
    if (shouldTweenAirPositions(hadPreviousData, this.airTrafficVisible, this.viewState.zoom)) {
      this.startCivilAirTween();
    } else {
      this.stopCivilAirTween();
    }

    this.refreshAisLayers();
  }

  // ─── Civil Air Traffic Tween Animation ───────────────────────────────

  /**
   * Start the tween animation from old positions to new positions.
   * Uses requestAnimationFrame to smoothly interpolate over ~12s.
   */
  private startCivilAirTween(): void {
    // Cancel any running tween
    if (this.civilAirAnimFrame != null) {
      cancelAnimationFrame(this.civilAirAnimFrame);
      this.civilAirAnimFrame = null;
    }

    this.civilAirTweenStart = performance.now();
    this.civilAirTweenProgress = 0;

    const FRAME_INTERVAL = 33; // ~30fps — sufficient for smooth flight movement
    let lastFrame = 0;

    const tick = () => {
      const now = performance.now();

      // Throttle to ~30fps (no need for 60fps on slowly-moving aircraft)
      if (now - lastFrame < FRAME_INTERVAL) {
        this.civilAirAnimFrame = requestAnimationFrame(tick);
        return;
      }
      lastFrame = now;

      const elapsed = now - this.civilAirTweenStart;
      const t = Math.min(elapsed / this.civilAirTweenDuration, 1);

      // Apply ease-out for smoother feel: t' = 1 - (1-t)^2
      this.civilAirTweenProgress = 1 - (1 - t) * (1 - t);

      // Re-render the Deck.gl layers with updated interpolated positions
      this.refreshAisLayers();

      // CRITICAL: MapboxOverlay only renders when MapLibre repaints.
      // Without triggerRepaint(), the Deck overlay never draws the new positions.
      this.map?.triggerRepaint();

      if (t < 1) {
        this.civilAirAnimFrame = requestAnimationFrame(tick);
      } else {
        this.civilAirAnimFrame = null;
      }
    };

    this.civilAirAnimFrame = requestAnimationFrame(tick);
  }

  /**
   * Stop any running civil air traffic tween animation.
   */
  private stopCivilAirTween(): void {
    if (this.civilAirAnimFrame != null) {
      cancelAnimationFrame(this.civilAirAnimFrame);
      this.civilAirAnimFrame = null;
    }
    this.civilAirTweenProgress = 1;
  }

  setOnMilitaryBaseClick(handler: (base: MilitaryBase, x: number, y: number) => void): void {
    this.onMilitaryBaseClick = handler;
  }

  setHighlightedShip(mmsi: string | null): void {
    this._highlightedMmsi = mmsi;
    this.updateMilitaryShipMarkerSource(SRC_MILITARY_SHIPS_HIGHLIGHT, mmsi);
    this.syncHighlightedShipTooltip(mmsi);
    this.refreshAisLayers();
  }

  setHighlightedInfrastructurePoint(coordinates: [number, number] | null): void {
    if (!this.map) return;
    const src = this.map.getSource(SRC_INFRA_HIGHLIGHT) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (!coordinates) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    src.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates },
        properties: {},
      }],
    });
  }

  setSelectedShip(mmsi: string | null): void {
    this._selectedShipMmsi = mmsi;
    this.updateMilitaryShipMarkerSource(SRC_MILITARY_SHIPS_SELECTED, mmsi);
    this.refreshAisLayers();
  }

  private updateMilitaryShipMarkerSource(sourceId: string, mmsi: string | null): void {
    if (!this.map) return;
    const src = this.map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (!mmsi) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const ship = findShipByKey<{ id: string; mmsi?: string; lat: number; lon: number }>(mmsi, Array.from(this.militaryShipsById.values()), this.globalTrafficData, getAllLiveTraffic());
    if (!ship) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    src.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [ship.lon, ship.lat] },
        properties: { id: ship.id, mmsi: ship.mmsi ?? '' },
      }],
    });
  }

  private syncHighlightedShipTooltip(mmsi: string | null): void {
    if (!this.map) return;
    if (!mmsi) {
      this.hideAisHoverTooltip();
      return;
    }
    const globalShip = this.globalTrafficData.find((s) => s.mmsi === mmsi);
    const rawShip = globalShip ? null : getAllLiveTraffic().find((s) => s.mmsi === mmsi);
    const ship = globalShip ?? (rawShip ? {
      id: rawShip.id,
      name: rawShip.name,
      type: rawShip.type,
      shipType: rawShip.shipType ?? 0,
      shipCategory: this.getShipCategory(rawShip.type),
      lat: Number(rawShip.lat),
      lon: Number(rawShip.lon),
      speed: rawShip.speed ?? 0,
      heading: rawShip.heading ?? 0,
      cog: rawShip.cog,
      navStatus: rawShip.navStatus,
      callSign: rawShip.callSign,
      imoNumber: rawShip.imoNumber,
      draught: rawShip.draught,
      dimensions: rawShip.dimensions,
      eta: rawShip.eta,
      mmsi: rawShip.mmsi ?? '',
      destination: rawShip.destination,
      lastSeen: rawShip.lastSeen,
      country: rawShip.country,
      trail: rawShip.trail,
    } satisfies AisShipData : null);
    if (!ship) {
      this.hideAisHoverTooltip();
      return;
    }
    this.showAisHoverTooltip(
      new maplibregl.LngLat(Number(ship.lon), Number(ship.lat)),
      this.getAisTooltipHtml(ship)
    );
  }

  /**
   * Met à jour le trafic AIS mondial (civils/étrangers).
   * Utilise Deck.gl MapboxLayer (WorldMonitor pattern) pour le rendu haute performance.
   *
   * @param ships - Tous les navires AIS reçus (via getAllLiveTraffic)
   * @param navyMmsiSet - Set des MMSI Marine Nationale (pour exclusion)
   */
  updateGlobalTraffic(
    ships: Array<{
      id: string;
      name: string;
      type: string;
      role: string;
      mmsi?: string;
      lat: number;
      lon: number;
      speed?: number;
      heading?: number;
      cog?: number;
      navStatus?: number;
      callSign?: string;
      imoNumber?: number;
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
      port?: string;
      lastSeen?: number;
      isLive?: boolean;
      shipType?: number;
      destination?: string;
    }>,
    navyMmsiSet: Set<string>
  ): void {
    // Exclure les navires militaires (affichés sur le layer Défense, pas maritime)
    // — MMSI Marine Nationale connus (navyMmsiSet)
    // — Tout navire avec shipType 35 (Military) ou 36 (Law enforcement / auxiliary navy)
    // Pas de filtre viewport : Deck.gl gère 20k+ points nativement à 60fps
    const MAX_AIS_SHIPS = 20_000;
    let filteredShips = ships.filter(s => {
      if (s.mmsi && navyMmsiSet.has(s.mmsi)) return false;
      const t = s.shipType;
      if (t === 35 || t === 36) return false;
      return true;
    });

    // Si dépassement du cap, garder les plus récents
    if (filteredShips.length > MAX_AIS_SHIPS) {
      filteredShips = filteredShips
        .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0))
        .slice(0, MAX_AIS_SHIPS);
    }

    // Transform to Deck.gl format with explicit Number coercion
    this.globalTrafficData = filteredShips.map(s => {
      const mmsi = s.mmsi ?? '';
      const rawShipType = (s.shipType ?? (s as { ShipType?: unknown }).ShipType ?? (s as { type?: unknown }).type);
      const shipTypeNumber = rawShipType == null ? NaN : Number(rawShipType);
      const shipType = Number.isFinite(shipTypeNumber) ? shipTypeNumber : 0;

      return {
        id: s.id,
        name: s.name,
        type: s.type,
        shipType,
        shipCategory: this.getShipCategory(s.type),
        lat: Number(s.lat),
        lon: Number(s.lon),
        speed: s.speed ?? 0,
        heading: s.heading ?? 0,
        cog: s.cog,
        navStatus: s.navStatus,
        callSign: s.callSign,
        imoNumber: s.imoNumber,
        draught: s.draught,
        dimensions: s.dimensions,
        eta: s.eta,
        mmsi,
        destination: s.destination,
        lastSeen: s.lastSeen,
        country: (s as { country?: string }).country,
        trail: (s as { trail?: Array<[number, number]> }).trail,
      };
    });

    if (!this.deckOverlay) {
      return;
    }

    // Update overlay with new data
    this.refreshAisLayers();
  }

  /**
   * Convertit le type de navire en catégorie pour le styling (legacy).
   */
  private getShipCategory(type: string): string {
    const t = type.toLowerCase();
    if (t.includes('tanker') || t.includes('pétrolier')) return 'tanker';
    if (t.includes('cargo') || t.includes('container')) return 'cargo';
    if (t.includes('passager') || t.includes('passenger') || t.includes('ferry')) return 'passenger';
    if (t.includes('pêche') || t.includes('fishing')) return 'fishing';
    if (t.includes('militaire') || t.includes('military') || t.includes('navy')) return 'military';
    return 'other';
  }

  /** Icône du type d'un navire, par catégorie (classement de traffic-legend.ts). */
  private getShipTypeIcon(category: VesselCategory): IconName {
    switch (category) {
      case 'petrolier': return 'fuel';
      case 'cargo': return 'package';
      case 'peche': return 'fish';
      case 'remorqueur': return 'anchor';
      case 'plaisance': return 'waves';
      case 'grande-vitesse': return 'zap';
      case 'service': return 'life-buoy';
      case 'militaire': return 'shield';
      default: return 'ship';
    }
  }


  /** Show a lightweight tooltip near a lngLat on the map */
  private showMilitaryTooltip(lngLat: maplibregl.LngLat, html: string): void {
    if (!this.map) return;
    this.militaryTooltip?.remove();
    this.militaryTooltip = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'military-tooltip dark-popup',
      offset: 8,
      maxWidth: '240px',
    })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(this.map);
    const el = this.militaryTooltip.getElement();
    el.style.zIndex = '99999';
    el.style.pointerEvents = 'none';
  }

  // ─── Layer Visibility Toggle ───

  private currentLayers?: MapLayers;

  setLayerVisibility(layers: MapLayers): void {
    const before = this.currentLayers;
    this.currentLayers = layers;
    const eventsVisible = layers.events === true;
    if (eventsVisible !== this.eventPointsVisible) {
      this.eventPointsVisible = eventsVisible;
      this.scheduleOverlayUpdate();
    }
    // Update DOM overlay immediately to reflect news toggle
    this.updatePulseMarkerPositions();
    if (!this.map) return;

    if (layers.gasNetwork) {
      void this.ensureGasNetworkSources();
    }

    // Perf audit §6 item 2: replay any department-choropleth update that was
    // skipped (vigilance, updateISNR/updateOutages below ; health layers through their dirty flags)
    // while its layer was hidden, now that it's visible again.
    if (layers.environmental && this.envVigilancePending && this.envVigilance) {
      // Rejeu à l'heure courante (S2) : une carte devenue en retard pendant que la couche était masquée repasse en gris.
      const { v, echeance } = this.envVigilance;
      void this.updateVigilanceLayer(v, echeance, Date.now());
    }
    this.repaintEnvironmentOnShow(before, layers);
    this.repaintSovereigntyOnShow(before, layers);
    if (layers.health && this.healthRegionsDirty) void this.renderHealthRegions();
    if ((layers.healthOscour || layers.healthApl) && this.healthDeptsDirty) void this.renderHealthDepartments();
    if (layers.stability && this._pendingIsnrScores !== null) {
      const scores = this._pendingIsnrScores;
      void this.updateISNR(scores);
    }
    if (layers.outages && this._pendingOutagesArgs) {
      const { telecoms, powers } = this._pendingOutagesArgs;
      void this.updateOutages(telecoms, powers);
    }

    const vis = (visible: boolean) => visible ? 'visible' : 'none';

    // News layers (all must be toggled together)
    this.setVis(LYR_POINTS, vis(layers.news));
    this.setVis(LYR_CLUSTER_CIRCLE, vis(layers.news));
    this.setVis(LYR_CLUSTER_COUNT, vis(layers.news));
    this.setVis('news-critical-glow', vis(layers.news));
    this.setVis('news-critical-pts', vis(layers.news));
    this.setVis(LYR_SEL_GLOW, vis(layers.news));
    this.setVis(LYR_SEL_RING, vis(layers.news));
    this.setVis(LYR_GLOW, vis(layers.alerts && layers.news)); // Glow only if both alerts AND news
    this.setVis(LYR_POWER_REGION_FILL, vis(layers.powerGrid));
    this.setVis(LYR_POWER_REGION_LINE, vis(layers.powerGrid));
    this.setVis(LYR_INTERCONN_ARC, vis(layers.powerGrid));
    this.setVis(LYR_INTERCONN_ARC_GLOW, vis(layers.powerGrid));
    this.setVis(LYR_INTERCONN_HITAREA, vis(layers.powerGrid));
    this.setVis(LYR_INTERCONN_CHEVRONS, vis(layers.powerGrid));
    this.setVis(LYR_INTERCONN_LINE, vis(layers.powerGrid));
    this.setVis(LYR_INTERCONN_LABEL, vis(layers.powerGrid));
    // Environnement (spec 2026-10-04 § 2) : couches de deckgl/environment-map.ts, par couche.
    for (const id of ENV_LAYER_KEYS.environmental) this.setVis(id, vis(envLayerOn(layers, 'environmental')));
    // Santé (spec 2026-10-03 § 3) : un jeu de couches par panneau.
    this.setVis(LYR_HEALTH_ALERT_FILL, vis(layers.health ?? false));
    this.setVis(LYR_HEALTH_ALERT_LINE, vis(layers.health ?? false));
    this.setVis(LYR_HEALTH_URG_FILL, vis(layers.healthOscour ?? false));
    this.setVis(LYR_HEALTH_URG_LINE, vis(layers.healthOscour ?? false));
    this.setVis(LYR_HEALTH_APL_FILL, vis(layers.healthApl ?? false));
    this.setVis(LYR_HEALTH_APL_LINE, vis(layers.healthApl ?? false));
    this.setVis(LYR_HOSPITALS, vis(layers.hospitals ?? false));
    // Couches changées : l'infobulle de survol se recalcule au prochain mouvement ; Hôpitaux éteinte : sa fiche se ferme.
    this.hideHealthHover();
    if (!layers.hospitals) this.hospitalPopup?.remove();
    const floodsOn = envLayerOn(layers, 'floods');
    for (const id of ENV_LAYER_KEYS.floods) this.setVis(id, vis(floodsOn));
    this.setVis(LYR_FLOODS_HIGHLIGHT, vis(floodsOn && this._highlightedFloodSegmentId !== null));
    const firesOn = envLayerOn(layers, 'fires');
    this.setVis(LYR_MODIS, vis(firesOn && this._modisOverlayEnabled));
    for (const id of ENV_LAYER_KEYS.fires) this.setVis(id, vis(firesOn));
    for (const id of FOREST_DANGER_LAYERS) this.setVis(id, vis(firesOn && this._forestDangerFill));
    for (const id of ENV_LAYER_KEYS.weatherRadar) this.setVis(id, vis(envLayerOn(layers, 'weatherRadar') && this.radarPick !== null));
    for (const id of ENV_LAYER_KEYS.drought) this.setVis(id, vis(envLayerOn(layers, 'drought')));
    for (const id of ENV_LAYER_KEYS.airQuality) this.setVis(id, vis(envLayerOn(layers, 'airQuality')));
    for (const id of ENV_LAYER_KEYS.earthquakes) this.setVis(id, vis(envLayerOn(layers, 'earthquakes')));
    this.setVis(RADAR_2D_LAYER_ID, vis(this.radar2dShown()));
    this.setVis(ECHO_TOPS_LAYER_ID, vis(this.echoTopsShown(this._echoTopsEnabled)));
    this.hideEnvironmentHover();
    this.setVis(LYR_ISNR_FILL, vis(layers.stability ?? false));
    this.setVis(LYR_ISNR_LINE, vis(layers.stability ?? false));
    this.setVis(LYR_ENERGY_INFRA_VITAL_HALO, 'none');
    this.setVis(LYR_ENERGY_INFRA_NUCLEAR_RING, vis(layers.nuclearFleet ?? false));
    this.setVis(LYR_ENERGY_INFRA_HIGHLIGHT_GLOW, vis(layers.nuclearFleet ?? false));
    this.setVis(LYR_ENERGY_INFRA_HIGHLIGHT_RING, vis(layers.nuclearFleet ?? false));
    this.setVis(LYR_ENERGY_INFRA_CIRCLE, vis(layers.nuclearFleet ?? false));
    this.setVis(LYR_ENERGY_INFRA_LABEL, vis(layers.nuclearFleet ?? false));
    this.setVis(LYR_DROM_ENERGY_HTA_LINES, vis(layers.dromEnergy ?? false));
    this.setVis(LYR_DROM_ENERGY_POINTS, vis(layers.dromEnergy ?? false));
    this.setVis(LYR_DROM_ENERGY_HIGHLIGHT, vis(layers.dromEnergy ?? false));
    this.setVis(LYR_HYDRO_BACKBONE_HALO, vis(layers.hydroBackbone ?? false));
    this.setVis(LYR_HYDRO_BACKBONE_SIGNAL_RING, vis(layers.hydroBackbone ?? false));
    this.setVis(LYR_HYDRO_BACKBONE_CIRCLE, vis(layers.hydroBackbone ?? false));
    this.setVis(LYR_HYDRO_BACKBONE_LABEL, vis(layers.hydroBackbone ?? false));
    this.setVis(LYR_WIND_CLUSTER,        vis(layers.windMonitor ?? false));
    this.setVis(LYR_WIND_CLUSTER_COUNT,  vis(layers.windMonitor ?? false));
    this.setVis(LYR_WIND_TURBINE_HALO,           vis(layers.windMonitor ?? false));
    this.setVis(LYR_WIND_TURBINE_CIRCLE,         vis(layers.windMonitor ?? false));
    this.setVis(LYR_WIND_TURBINE_LABEL,          vis(layers.windMonitor ?? false));
    this.setVis(LYR_WIND_PARK_HALO,      vis(layers.windMonitor ?? false));
    this.setVis(LYR_WIND_PARK_CIRCLE,    vis(layers.windMonitor ?? false));
    this.setVis(LYR_WIND_PARK_LABEL,     vis(layers.windMonitor ?? false));

    if (this.map) {
      try {
        if (this.map.getLayer(LYR_ENERGY_INFRA_CIRCLE) && this.map.getLayer(LYR_ENERGY_INFRA_LABEL)) {
          if (layers.nuclearFleet) {
            this.map.setFilter(LYR_ENERGY_INFRA_CIRCLE, ['==', ['get', 'type'], 'nuclear']);
            this.map.setFilter(LYR_ENERGY_INFRA_LABEL, ['==', ['get', 'type'], 'nuclear']);
          }
        }
      } catch {
        // Silently ignore if layers are not ready
      }
    }
    // Gas layer: réseau + organes vitaux
    const gasVis = vis(layers.gasNetwork ?? false);
    const pipeVis = (gasVis === 'visible' && this.gasPipelineVisible) ? 'visible' : 'none';
    this.setVis(LYR_GAS_NETWORK_GRT, pipeVis);
    this.setVis(LYR_GAS_NETWORK_TEREGA, pipeVis);
    this.setVis(LYR_GAS_TERMINALS, gasVis);
    this.setVis(LYR_GAS_STORAGES_GLOW, gasVis);
    this.setVis(LYR_GAS_STORAGES, gasVis);
    this.setVis(LYR_GAS_STORAGES_LABEL, gasVis);
    this.setVis(LYR_GAS_PIR_ARC_GLOW, gasVis);
    this.setVis(LYR_GAS_PIR_ARC, gasVis);
    this.setVis(LYR_GAS_PIR_CHEVRONS, gasVis);
    this.setVis(LYR_GAS_PIR_MARKER, gasVis);
    this.setVis(LYR_GAS_PIR_LABEL, gasVis);
    // Biomethane sites: visible when gasNetwork is active (always shown alongside gas infra)
    const biomVis = vis(layers.gasNetwork ?? false);
    this.setVis(LYR_BIOMETHANE_CLUSTERS, biomVis);
    this.setVis(LYR_BIOMETHANE_CLUSTER_COUNT, biomVis);
    this.setVis(LYR_BIOMETHANE_SITES, biomVis);
    this.setVis(LYR_BIOMETHANE_SITES_LABEL, biomVis);
    // Oil layer (refineries, depots, pipelines, flows)
    const oilVis = vis(layers.oilNetwork ?? false);
    this.setVis(LYR_OIL_PIPELINES_GLOW, oilVis);
    this.setVis(LYR_OIL_PIPELINES, oilVis);
    this.setVis(LYR_OIL_REFINERIES_GLOW, oilVis);
    this.setVis(LYR_OIL_REFINERIES, oilVis);
    this.setVis(LYR_OIL_REFINERIES_LABEL, oilVis);
    this.setVis(LYR_OIL_DEPOTS, oilVis);
    this.setVis(LYR_OIL_DEPOTS_TERMINAL_CENTER, oilVis);
    this.setVis(LYR_OIL_DEPOTS_LABEL, oilVis);
    // LYR_OIL_REFINERIES_HIT supprimé — hover géré directement sur le symbol layer
    this.setVis(LYR_OIL_DEPOTS_HIT, oilVis);
    this.setVis(LYR_OIL_PIPELINES_HIT, oilVis);
    this.setVis(LYR_OIL_FLOW_ARC_HIT, oilVis);
    this.setVis(LYR_OIL_FLOW_MARKER_HIT, oilVis);
    this.setVis(LYR_OIL_FLOW_ARC_GLOW, oilVis);
    this.setVis(LYR_OIL_FLOW_ARC, oilVis);
    this.setVis(LYR_OIL_FLOW_CHEVRONS, oilVis);
    this.setVis(LYR_OIL_FLOW_MARKER, oilVis);
    this.setVis(LYR_OIL_FLOW_LABEL, oilVis);
    this.setVis(LYR_FUEL_TENSION_FILL, oilVis);
    this.setVis(LYR_FUEL_TENSION_LINE, oilVis);
    this.setVis(LYR_TRAFFIC, vis(layers.trafficRoad));
    // Trafics (spec 2026-10-03 trafics § 3) : couches de deckgl/traffic-map.ts, par couche.
    for (const id of TRAFFIC_LAYER_KEYS.trafficRoad) this.setVis(id, vis(layers.trafficRoad));
    for (const id of TRAFFIC_LAYER_KEYS.trafficAir) this.setVis(id, vis(layers.trafficAir));
    for (const id of TRAFFIC_LAYER_KEYS.trafficMaritime) this.setVis(id, vis(layers.trafficMaritime));
    const railVis = vis(layers.trafficRail ?? false);
    for (const id of TRAFFIC_LAYER_KEYS.trafficRail) this.setVis(id, railVis);
    this.hideTrafficHover();
    this.setVis(LYR_TRAIN_ROUTE,        railVis);
    this.setVis(LYR_TRAIN_STATIONS,     railVis);
    this.setVis(LYR_TRAIN_STATION_LABELS, railVis);
    this.setVis(LYR_METRO_LOAD_GLOW, vis(layers.metroLoad));
    this.setVis(LYR_METRO_LOAD_CIRCLE, vis(layers.metroLoad));
    this.setVis(LYR_METRO_LOAD_LABEL, vis(layers.metroLoad));

    // Military layers : couches Souveraineté de deckgl/sovereignty-map.ts (aéronefs, urgences, Marine nationale, sites, zones) ; option des
    // ouvrages OpenStreetMap éteinte par défaut. Sélection et surbrillance d'un bâtiment : partagées avec le Trafic maritime.
    for (const id of SOV_LAYER_KEYS.military) this.setVis(id, vis(layers.military));
    for (const id of SOV_OPTION_LAYERS.osmWorks) this.setVis(id, vis(layers.military && this.osmWorksVisible));
    for (const id of SOV_OPTION_LAYERS.droneZones) this.setVis(id, vis(layers.military && this.droneZonesVisible));
    this.setVis(LYR_MILITARY_SHIPS_HIGHLIGHT, vis(layers.trafficMaritime || layers.military));
    this.setVis(LYR_MILITARY_SHIPS_SELECTED, vis(layers.trafficMaritime || layers.military));
    // AIS traffic layer (Deck.gl IconLayer)
    this.globalTrafficVisible = layers.trafficMaritime;
    this.airTrafficVisible = layers.trafficAir;
    if (!this.airTrafficVisible) this.stopCivilAirTween();
    this.refreshAisLayers();
    // Connectivité : câbles du Shom et d'OpenStreetMap, atterrages, navires signalés ; halo animé seulement couche visible (audit 30).
    for (const id of SOV_LAYER_KEYS.subseaCables) this.setVis(id, vis(layers.subseaCables));
    // Pannes réseau : Télécoms (sites récents et anciens ; maintenances en option) et Électricité (unités en arrêt imprévu et en maintenance).
    for (const id of OUT_LAYER_KEYS.outagesTelecom) this.setVis(id, vis(layers.outagesTelecom));
    for (const id of OUT_LAYER_KEYS.outagesElec) this.setVis(id, vis(layers.outagesElec));
    this.setVis(OUT_MAINTENANCE_LAYER, vis(layers.outagesTelecom && this.telecomMaintenanceOn));
    this.hideOutagesHover();
    if (layers.subseaCables) this.startSubseaPulseAnimation();
    else this.stopSubseaPulseAnimation();
    this.hideSovereigntyHover();
    this.setVis(LYR_POWER_FILL, vis(layers.outagesElec));
    this.setVis(LYR_POWER_LINE, vis(layers.outagesElec));
    this.setVis(LYR_CITIZEN_FILL, vis(layers.outagesElec));
    this.setVis(LYR_CITIZEN_LINE, vis(layers.outagesElec));
    this.setVis(LYR_IIP_GLOW, vis(layers.outagesElec));
    this.setVis(LYR_IIP_CORE, vis(layers.outagesElec));
    this.setVis(LYR_TELECOM_PTS, vis(layers.outagesTelecom));
    this.setVis(LYR_NET_IODA_CLUSTER,       vis(layers.outagesInternet));
    this.setVis(LYR_NET_IODA_CLUSTER_COUNT, vis(layers.outagesInternet));
    this.setVis(LYR_NET_IODA_GLOW,          vis(layers.outagesInternet));
    this.setVis(LYR_NET_IODA_CORE,          vis(layers.outagesInternet));
    this.setVis(LYR_NET_ISP_CLUSTER,        vis(layers.outagesInternet));
    this.setVis(LYR_NET_ISP_CLUSTER_COUNT,  vis(layers.outagesInternet));
    this.setVis(LYR_NET_ISP_GLOW,           vis(layers.outagesInternet));
    this.setVis(LYR_NET_ISP_RING,           vis(layers.outagesInternet));
    this.setVis(LYR_NET_ISP,                vis(layers.outagesInternet));
    // Cloud/IXP clusters
    this.setVis(LYR_DC_CLUSTER, vis(layers.outagesCloud));
    this.setVis(LYR_DC_CLUSTER_COUNT, vis(layers.outagesCloud));
    this.setVis(LYR_IXP_CLUSTER, vis(layers.outagesCloud));
    this.setVis(LYR_IXP_CLUSTER_COUNT, vis(layers.outagesCloud));
    // Cloud/IXP individual markers (hidden by cluster filter when zoomed out)
    this.setVis(LYR_DC_GLOW, vis(layers.outagesCloud));
    this.setVis(LYR_DC_CORE, vis(layers.outagesCloud));
    this.setVis(LYR_DC_HIGHLIGHT, vis(layers.outagesCloud));
    this.setVis(LYR_IXP_CIRCLE, vis(layers.outagesCloud));
    this.setVis(LYR_IXP_HIGHLIGHT, vis(layers.outagesCloud));
  }

  // ═══════════════════════════════════════════════════════════════
  // PRIVATE
  // ═══════════════════════════════════════════════════════════════

  private setVis(layerId: string, visibility: string): void {
    if (!this.map) return;
    // Guard: only style existing layers to avoid MapLibre "Cannot style non-existing layer" errors
    try {
      if (this.map.getLayer(layerId)) {
        this.map.setLayoutProperty(layerId, 'visibility', visibility);
      }
    } catch {
      // Silently ignore - layer may not exist yet during initialization
    }
  }

  private syncNewsSource(): void {
    if (!this.map) return;

    // Cheap diff: skip the feature rebuild + setData when the news set is
    // unchanged (same ids / levels / categories / flags / coordinates).
    const hash = this.newsItems
      .map((item) =>
        `${item.id}:${item.threat?.level ?? ''}:${item.threat?.category ?? ''}:${item.isAlert ? 1 : 0}:${item.lon},${item.lat}`)
      .join('|');

    const src = this.map.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
    const criticalSrc = this.map.getSource(SRC_CRITICAL) as maplibregl.GeoJSONSource | undefined;

    // Only honour the cached hash when both sources exist; otherwise the data
    // was never applied and must be retried on the next call.
    if (src && criticalSrc && hash === this.lastNewsSourceHash) return;

    // Separate critical items (never clustered) from others
    const criticalItems = this.newsItems.filter(
      (item) => item.threat?.level === 'critical'
    );
    const otherItems = this.newsItems.filter(
      (item) => item.threat?.level !== 'critical'
    );

    // Helper to create feature
    const toFeature = (item: NewsItem): GeoJSON.Feature => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [item.lon!, item.lat!] },
      properties: {
        itemId: item.id,
        level: item.threat?.level ?? 'info',
        category: item.threat?.category ?? 'general',
        isAlert: item.isAlert ? 1 : 0,
      },
    });

    // Update main source (clusterable, excludes critical)
    if (src) {
      src.setData({
        type: 'FeatureCollection',
        features: otherItems.map(toFeature),
      });
    }

    // Update critical source (never clustered)
    if (criticalSrc) {
      criticalSrc.setData({
        type: 'FeatureCollection',
        features: criticalItems.map(toFeature),
      });
    }

    // Record the hash only once both sources actually received the data
    if (src && criticalSrc) {
      this.lastNewsSourceHash = hash;
    }
  }

  destroy(): void {
    this.radar2dDestroyed = true;
    this.radar2dOperationGeneration += 1;
    // Cleanup timeouts
    if (this.clusterHideTimeout) {
      clearTimeout(this.clusterHideTimeout);
      this.clusterHideTimeout = null;
    }
    if (this.clusterLeavesHoverTimeout) {
      clearTimeout(this.clusterLeavesHoverTimeout);
      this.clusterLeavesHoverTimeout = null;
    }

    // Cleanup pulse overlay
    this.pulseOverlay?.remove();
    this.pulseOverlay = null;
    this.pulseMarkers.clear();

    // Cleanup energy/gas tooltips
    this.energyRegionPopup?.remove();
    this.energyFlowPopup?.remove();
    this.gasFlowPopup?.remove();
    this.dromEnergyHoverPopup?.remove();
    this.dromEnergyHoverPopup = null;
    this.trafficHoverPopup?.remove();
    this.trafficJamPopup?.remove();

    // Cleanup interconnection animation
    this.stopInterconnAnimation();
    this.stopGasPirAnimation();
    this.stopOilFlowAnimation();
    this.stopSubseaPulseAnimation();

    // Cleanup civil air traffic tween animation
    this.stopCivilAirTween();
    this.stopSentinelSceneBlink();

    this.revokeRadar2dObjectUrl(this.radar2dObjectUrl);
    this.radar2dObjectUrl = null;
    this.radar2dManifest = null;
    this._radar2dEnabled = false;
    this.map?.remove();
    this.map = null;
  }
}
