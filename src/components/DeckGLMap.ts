/**
 * DeckGLMap.ts — Carte desktop 100% MapLibre GL JS
 * Calques : News, Alerts (glow), Energy (régions Ecowatt), Weather (départements),
 *           Floods (tronçons Vigicrues), Infrastructure (centrales/barrages),
 *           Traffic (axes routiers).
 */

import { levelHex } from '../services/vigilance.ts';
import { LYR_ROOM_DEPT_FILL, LYR_ROOM_SERVICES, LYR_ROOM_SERVICES_LETTER, SRC_ROOM_DEPTS, SRC_ROOM_SERVICES } from './deckgl/outages-room-map.ts';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { IconLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { COORDINATE_SYSTEM } from '@deck.gl/core';
import type { MapViewState, AirOverviewResponse, MaritimeSnapshot, RailOverviewResponse, RailTrain, RoadNationalResponse, RoadUrbanResponse, NewsItem, FuelTensionDashboard, InfrastructurePoint, MapLayers, MilitaryBase, AirTrafficFlight, EcowattResponse, AisShipData, OilDashboard, SatelliteViewRequest, HydraulicBackboneAsset } from '../types/index.ts';
import { emsZoneFeatures } from './deckgl/environment-map-ems.ts';
import { PROTEST_LAYERS, PROTEST_LAYER_IDS, protestFeatures } from './deckgl/protests-map.ts';
import { CRIME_CITY_LAYERS, CRIME_LAYERS, CRIME_LAYER_IDS, crimeCityFeatures, crimeDeptFeatures } from './deckgl/crime-map.ts';
import { WEBCAM_LAYERS, WEBCAM_LAYER_IDS, webcamFeatures, webcamSourceSpec } from './deckgl/webcams-map.ts';
import {
  EXPOSURE_LAYERS, EXPOSURE_LAYER_IDS, FLOOD_ASSET_LAYERS, FLOOD_ZONE_LAYER, exposureFeatures, exposureSourceSpec, floodZoneFeatures,
} from './deckgl/exposure-map.ts';
import { POLLEN_LAYERS, POLLEN_LAYER_IDS, SRC_POLLEN, pollenDeptFeatures } from './deckgl/pollen-map.ts';
import type { PollenDay, PollenResponse } from '../types/index.ts';
import { LYR_SEVESO, LYR_SEVESO_CLUSTER, SEVESO_LAYERS, SEVESO_LAYER_IDS, SRC_SEVESO, sevesoFeatures, sevesoSourceSpec } from './deckgl/seveso-map.ts';
import type { Exposure, ExposureAsset } from '../services/environment-exposure.ts';
import { FRANCE_METRO_BOUNDS, visibleFitPadding, type Rect } from './deckgl/france-fit.ts';
import { ENV_CONTEXT_RULES, RADAR_CONTEXT_KEY, SEVESO_CONTEXT_KEY, envContextFilter, envContextRevealed } from './deckgl/env-context.ts';
import { pulsePaint } from './deckgl/pulse.ts';
import type { ExposureResult } from '../services/environment-exposure.ts';
import { FLUX_LAYERS, FLUX_LAYER_IDS, fluxFeatures, fluxSourceSpec, type FluxInstant, type FluxOtherEvent } from './deckgl/flux-pietons-map.ts';
import type { FluxFeature } from '../services/flux-pietons.ts';
import type { FluxPhase } from '../types/index.ts';
import type { WebcamsDataset } from '../types/index.ts';
import { DEFAULT_CRIME_INDICATOR } from '../services/crime.ts';
import { ASNR_RING_LAYER, asnrRingFeatures } from './deckgl/nuclear-map-asnr.ts';
import type { CrimeDataset, CrimeIndicatorKey } from '../types/index.ts';
import type { AirQualityResponse, AsnrResponse, DisastersResponse, ProtestsResponse, DroughtResponse, EmsResponse, EarthquakesResponse, FiresResponse, FloodSection, FloodsResponse, SeaLevelsResponse, VigilanceEcheance, VigilanceResponse } from '../types/index.ts';
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
import {
  alertLabel, alertPriority, categoryIcon, drawnRadius, layoutAlertLabels, NEWS_INFO_HEX, newsLevelHex, newsOffDrawnEvents,
  type EventMapPoint, type LabelBox,
} from '../services/v2-map.ts';
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
  radarPickFeature, topEnvHit, vigilanceDeptFeatures, vigilanceIconFeatures, airDeptFeatures, droughtDeptFeatures, quakeFeatures, tideGaugeFeatures, envBReshowPaints, placeEnvBPoints, disasterFeatures, placeDisasterPoints,
  type EnvBData, type EnvBLayerState,
} from './deckgl/environment-map.ts';
import {
  SOV_HOVER_LAYERS, SOV_LAYERS, SOV_LAYER_KEYS, SOV_OPTION_LAYERS, SOV_SOURCE_IDS, abroadAircraftFeatures, aircraftFeatures, cableAlertFeatures,
  cableFeatures, defenseSiteFeatures, landingFeatures, militaryEmergencyFeatures, navyFeatures, osmWorksFeatures, sovCableColor, sovSourceSpec,
  sovTooltipHtml, topSovHit,
} from './deckgl/sovereignty-map.ts';
import { SOV_B_LAYERS, SOV_B_SOURCE_IDS, droneZoneFeatures, gnssCellFeatures, sovBSourceSpec } from './deckgl/sovereignty-map-b.ts';
import {
  OUT_HOVER_LAYERS, OUT_LAYERS, OUT_LAYER_KEYS, POWER_PLANNED_FILTER, POWER_UNPLANNED_FILTER, OUT_MAINTENANCE_LAYER, OUT_SOURCE_IDS, cloudReferenceFeatures, cloudZoneFeatures, internetFeatures, outSourceSpec,
  outTooltipHtml, powerFeatures, telecomFeatures, topOutHit,
} from './deckgl/outages-map.ts';
import {
  LYR_OUT_INTERNET_FILL, SRC_OUT_CLOUD_REF, SRC_OUT_CLOUD_ZONES, SRC_OUT_INTERNET, SRC_OUT_POWER, SRC_OUT_TELECOM, SRC_SOV_AIRCRAFT, SRC_SOV_AIRCRAFT_ABROAD, SRC_SOV_CABLE_VESSELS, SRC_SOV_DRONES, SRC_SOV_EMERGENCIES, SRC_SOV_GNSS, SRC_SOV_NAVY,
  SRC_SOV_OSM_WORKS,
} from './deckgl/constants.ts';
import { NAVY_HEX, SOV_ABROAD_HEX } from './layer-panel/sovereignty-legend.ts';
import type {
  CablesWatchResponse, CloudOutagesResponse, DefenseOsmWorksFile, DroneZonesFile, GnssResponse, InternetOutagesResponse, MilitaryResponse, PowerOutagesResponse,
  SubseaCablesFile, TelecomOutagesResponse,
} from '../types/index.ts';
import {
  VESSEL_TYPE_HEX, type VesselCategory, airAltitudeHex, vesselCategory, vesselHex, vesselTypeLabel,
} from './layer-panel/traffic-legend.ts';
import { identifyFrenchCallsign, identifyAlliedCallsign } from '../config/military.ts';
import { getAllLiveTraffic, type MilitaryShip } from '../services/military-ships.ts';
import { findShipByKey, isSubmarine } from './layer-panel/navy.ts';
import { OIL_PIPELINE_COLORS } from '../config/oil-infrastructure.ts';
import { resolveFlowDirection, resolveGasFlowDirection } from '../utils/flow-direction.ts';
import { formatUpdateTime } from '../utils/format-date.ts';
import { buildSparklineSVG } from '../utils/sparkline.ts';
import type { LineString, MultiLineString } from 'geojson';
import { computeFloodSegmentBbox, buildEoBrowserUrl } from '../services/copernicus.ts';
import type { EolienLive, EolienParkSummary } from '../services/eolien/types.ts';
import { buildEolienLayerFeatureCollection, buildEolienPopupHtml } from '../services/eolien/mapbox-eolien-layer.ts';
import { getFuelTensionLevelColor } from '../services/fuel-tension.ts';
import { buildDefaultGibsViirsTileUrl, resolveLatestGibsViirsTileUrl } from '../utils/gibs-imagery.ts';
import { fetchMtgFrpMetadata, getMtgFrpTileTemplate } from '../services/mtg-frp.ts';
import type { Radar2dManifest } from '../services/radar-2d.ts';
import { loadDepartementsGeojson } from '../services/departements-geojson.ts';


// ─── Extracted deckgl modules (constants & pure helpers) ───
import { resolveAssetCoords } from './deckgl/iip-geocoding.ts';
import { LYR_SATELLITE, getFrenchStyle } from './deckgl/base-style.ts';
import { getElectricFlowConfig, GAS_FLOW_STYLE, OIL_FLOW_STYLE } from './deckgl/flow-styles.ts';
export { ELECTRIC_FLOW_STYLE, setElectricFlowConfig, getElectricFlowConfig, GAS_FLOW_STYLE, OIL_FLOW_STYLE } from './deckgl/flow-styles.ts';
import { emptyFC, generateArc } from './deckgl/geometry-utils.ts';
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
import { fmIcon, fmStatusDot, type IconName } from './shared/icons.ts';
import {
  buildEnergyKeyModel, companionFilters, discColorExpr, discCompanionLayers, ENERGY_DISC_RADIUS, energyEntriesFrom, glyphColorExpr,
  infraGlyphImageExpr, infraSectorHexExpr, METRO_LABEL_SIZE, oilDepotRadiusExpr, oilDepotStrokeExpr, metroLabelOffsetExpr, metroRadiusExpr, nuclearDiscColorExpr, nuclearOpacityExpr, nuclearRingColorExpr, nuclearRingWidthExpr, type StyleExpr, energyIconImage, energyStateFilter, gasStorageStyle, hydroStyle,
  ENERGY_ICON_NAMES, ENERGY_LAYER_KEYS,
  ENERGY_SHAPE_DIAMOND, ENERGY_SHAPE_SQUARE, shapeIconSvg,
  type EnergyEntry, type EnergyFlowCount, type EnergyKeyModel, type EnergyLayerKey,
} from './deckgl/energy-map.ts';
import { buildFlowFeatures, flowArcFromFeature, kmBetween, type FlowArc } from './deckgl/energy-flows.ts';
import { dimOpacity, fullOpacity, ENERGY_FOCUS_LAYERS, energyFocusLayersOf, flowKindsShown, isEnergyLayerKey } from './deckgl/energy-focus.ts';
import { EnergyPopupController } from './deckgl/energy-popup.ts';
import { OIL_REFINERIES } from '../config/oil-infrastructure.ts';
import {
  effectiveOpacity, ENERGY_HOVER_LAYER_IDS, energyCardFor, oilDepotDetailCard, oilFlowDetailCard, pickEnergyHover, tooltipCardHtml, type EnergyHoverContext, type EnergyHoverKind, type HoverCandidate,
} from './deckgl/energy-hover.ts';
import { ENERGY_CHOKE_HEX, ENERGY_DISC_STATE_HEX, ENERGY_SECTOR_HEX, ENERGY_STATE_HEX, type EnergyFlowKind, fuelTensionVigilance, refineryState, type EnergyState } from '../services/energy-state.ts';
import type { VigilanceLevel } from '../services/vigilance.ts';
import {
  dromEnergyAssetFromProperties,
  renderDromEnergyTooltipHtml,
} from './deckgl/popup-templates.ts';
import {
  SRC,
  SRC_CRITICAL,
  SRC_SEL,
  SRC_POWER_REGIONS,
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
  LYR_FIRES_ICON,
  SRC_FIRES_HIGHLIGHT,
  LYR_FIRES_HIGHLIGHT,
  SRC_FIRES_ABROAD,
  SRC_FLOOD_STATIONS,
  SRC_DROUGHT,
  SRC_AIR_QUALITY,
  SRC_QUAKES,
  SRC_DISASTERS,
  LYR_DISASTER_PULSE,
  LYR_DISASTERS,
  LYR_QUAKE_PULSE,
  LYR_QUAKES,
  SRC_PROTESTS,
  LYR_PROTESTS,
  SRC_CRIME_DEPTS,
  SRC_WEBCAMS,
  LYR_WEBCAMS,
  SRC_EXPOSURE,
  SRC_FLOOD_ZONES,
  SRC_FLOOD_ASSETS,
  LYR_EXPOSURE,
  LYR_FLOOD_ASSETS,
  LYR_FLOOD_ZONES,
  LYR_WEBCAM_CLUSTER,
  SRC_FLUX,
  LYR_FLUX_LINES,
  LYR_FLUX_OTHERS,
  SRC_CRIME_CITIES,
  LYR_CRIME_FILL,
  LYR_CRIME_CITY,
  SRC_EMS_ZONES,
  SRC_TIDE_GAUGES,
  LYR_DROUGHT_FILL,
  LYR_AIR_FILL,
  SRC_RADAR_PICK,
  SRC_FOREST_DANGER,
  SRC_MODIS,
  LYR_MODIS,
  SRC_SENTINEL_SCENE,
  LYR_SENTINEL_SCENE,
  SRC_ASNR_RINGS,
  LYR_ASNR_RING,
  LYR_ENERGY_INFRA_HIGHLIGHT_GLOW,
  LYR_ENERGY_INFRA_HIGHLIGHT_RING,
  LYR_ENERGY_INFRA_CIRCLE,
  LYR_ENERGY_INFRA_LABEL,
  LYR_DROM_ENERGY_HTA_LINES,
  LYR_DROM_ENERGY_HIGHLIGHT,
  LYR_DROM_ENERGY_POINTS,
  LYR_HYDRO_BACKBONE_CIRCLE,
  LYR_HYDRO_BACKBONE_LABEL,
  LYR_WIND_CLUSTER,
  LYR_WIND_CLUSTER_ICON,
  LYR_HYDRO_CLUSTER,
  LYR_HYDRO_CLUSTER_ICON,
  LYR_WIND_TURBINE_CIRCLE,
  LYR_WIND_TURBINE_LABEL,
  LYR_WIND_PARK_CIRCLE,
  LYR_WIND_PARK_LABEL,
  SRC_GAS_NETWORK_GRT,
  SRC_GAS_NETWORK_TEREGA,
  LYR_GAS_NETWORK_GRT,
  LYR_GAS_NETWORK_TEREGA,
  SRC_GAS_VITALS,
  LYR_GAS_TERMINALS,
  LYR_GAS_STORAGES,
  LYR_GAS_STORAGES_LABEL,
  SRC_BIOMETHANE_SITES,
  LYR_BIOMETHANE_CLUSTERS,
  LYR_BIOMETHANE_SITES,
  LYR_BIOMETHANE_SITES_LABEL,
  SRC_FUEL_TENSION,
  LYR_FUEL_TENSION_FILL,
  LYR_FUEL_TENSION_LINE,
  SRC_OIL_PIPELINES,
  SRC_OIL_REFINERIES,
  SRC_OIL_DEPOTS,
  LYR_OIL_PIPELINES,
  LYR_OIL_REFINERIES,
  LYR_OIL_REFINERIES_LABEL,
  LYR_OIL_DEPOTS,
  LYR_OIL_DEPOTS_LABEL,
  LYR_TRAFFIC,
  LYR_TRAIN_ROUTE,
  LYR_TRAIN_STATIONS,
  LYR_TRAIN_STATION_LABELS,
  SRC_METRO_LOAD,
  LYR_METRO_LOAD_CIRCLE,
  LYR_METRO_LOAD_LABEL,
  SRC_MILITARY_BASES,
  SRC_MILITARY_SHIPS_HIGHLIGHT,
  SRC_MILITARY_SHIPS_SELECTED,
  SRC_GLOBAL_TRAFFIC,
  SRC_SUBMARINE_CABLES,
  SRC_SUBMARINE_CABLES_LANDINGS,
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
  DEFAULT_VIEW,
  LYR_OUT_POWER_PLANNED,
  LYR_OUT_POWER_UNPLANNED,
  LYR_OUT_POWER_PULSE,
  LYR_OUT_TELECOM_PULSE,
  LYR_OUT_TELECOM_RECENT,
  SRC_ENERGY_FLOWS,
  SRC_ENERGY_FLOW_HEADS,
  SRC_ENERGY_FLOW_LABELS,
  SRC_ENERGY_CHOKES,
  LYR_ENERGY_FLOW_CASE,
  LYR_ENERGY_FLOW_LINES,
  LYR_ENERGY_FLOW_ANIM,
  LYR_ENERGY_FLOW_HEADS,
  LYR_ENERGY_FLOW_LABELS,
  LYR_ENERGY_CHOKE,
  LYR_ENERGY_CHOKE_LABEL,
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

/** Bouton « Recadrer la France et la Corse » (20/10/2026), au-dessus du zoom. */
/** Niveau L1 d'un tronçon Vigicrues (code officiel 1 à 4), pour l'étiquette de sélection. */
const OFFICIAL_SECTION_LEVEL: Readonly<Record<FloodSection['level'], 'vert' | 'jaune' | 'orange' | 'rouge'>> = { 1: 'vert', 2: 'jaune', 3: 'orange', 4: 'rouge' };

class FranceFitControl {
  private _container: HTMLElement | null = null;
  private _map: DeckGLMap;

  constructor(map: DeckGLMap) { this._map = map; }

  onAdd(_maplibre: maplibregl.Map): HTMLElement {
    this._container = document.createElement('div');
    this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group france-fit-ctrl';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'france-fit-btn';
    btn.title = 'Recadrer la France et la Corse dans la partie visible de la carte';
    btn.setAttribute('aria-label', 'Recadrer la France et la Corse');
    btn.innerHTML = fmIcon('maximize', { size: 16 });
    btn.addEventListener('click', () => this._map.fitFrance());
    this._container.appendChild(btn);
    return this._container;
  }

  onRemove(): void {
    this._container?.remove();
    this._container = null;
  }
}

// Point d'infrastructure enrichi des champs de production électrique (nucléaire RTE, etc.),
// optionnels car absents des points génériques (gaz, dépôts…).
type InfrastructureRenderPoint = InfrastructurePoint & {
  globalAvailability?: number;
  totalPower?: number;
  totalAvailable?: number;
};

/** Pointe des flèches d'échange et motifs de tirets de leur animation (spec 2026-10-16 § 4). */
const ENERGY_FLOW_HEAD_ICON = 'energy-flow-head';
const ENERGY_FLOW_DASH_SEQ: ReadonlyArray<number[]> = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
  [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];

/** Catégorie interne de setLegendHover : les pastilles Énergie allumées. */
const ENERGY_FOCUS_CATEGORY = 'energy-focus';
/** Pastilles mises en avant hors Énergie (Vue générale, onglet Environnement) : union de leurs calques. */
const GENERAL_FOCUS_CATEGORY = 'general-focus';
/** Anneaux pulsants (pulse.ts) : calque de l'anneau et calque des points dont il suit le tamisage. */
type PulseKey = 'disasters' | 'earthquakes' | 'telecomOutage' | 'powerOutage';
const PULSE_LAYERS: Readonly<Record<PulseKey, { pulse: string; base: string }>> = {
  disasters: { pulse: LYR_DISASTER_PULSE, base: LYR_DISASTERS },
  earthquakes: { pulse: LYR_QUAKE_PULSE, base: LYR_QUAKES },
  // Pannes urgentes (21/10/2026) : antennes coupées depuis moins de 24 h, arrêts imprévus de production.
  telecomOutage: { pulse: LYR_OUT_TELECOM_PULSE, base: LYR_OUT_TELECOM_RECENT },
  powerOutage: { pulse: LYR_OUT_POWER_PULSE, base: LYR_OUT_POWER_UNPLANNED },
};
/**
 * Images (raster) des pastilles Environnement, hors ENV_LAYER_KEYS (ajoutées à la demande) : tamisées avec leur pastille (20/10/2026 :
 * l'image radar restait vive sous les autres pastilles).
 */
const ENV_RASTER_LAYERS: Readonly<Record<'weatherRadar' | 'fires', readonly string[]>> = {
  weatherRadar: [RADAR_2D_LAYER_ID, ECHO_TOPS_LAYER_ID],
  fires: [LYR_MODIS, MTG_FRP_LAYER_ID],
};

/** Calques de toutes les couches Énergie, atténués au survol d'une pastille (sans doublon : les flèches sont partagées). */
const ENERGY_FOCUS_ALL: readonly string[] = [...new Set(Object.values(ENERGY_FOCUS_LAYERS).flat())];

/** Rayon des disques de `infra-src` : nucléaire 11 px, autres types 8 px (spec 2026-10-16 § 2.3). */
const INFRA_DISC_RADIUS: maplibregl.ExpressionSpecification = ['match', ['get', 'type'], 'nuclear', ENERGY_DISC_RADIUS.nuclear, ENERGY_DISC_RADIUS.other];

/** Calques énergie masquables par état, avec le filtre propre de leur addLayer (spec 2026-10-15). */
const ENERGY_FILTER_BASES: ReadonlyArray<readonly [string, maplibregl.FilterSpecification | null]> = [
  [LYR_ENERGY_INFRA_CIRCLE, null],
  [LYR_ENERGY_INFRA_LABEL, null],
  [LYR_OUT_POWER_PLANNED, POWER_PLANNED_FILTER],
  [LYR_OUT_POWER_UNPLANNED, POWER_UNPLANNED_FILTER],
  [LYR_GAS_STORAGES, ['==', ['get', 'type'], 'storage']],
  [LYR_GAS_STORAGES_LABEL, ['==', ['get', 'type'], 'storage']],
  [LYR_GAS_TERMINALS, ['==', ['get', 'type'], 'terminal']],
  [LYR_HYDRO_BACKBONE_CIRCLE, ['!', ['has', 'point_count']]],
  [LYR_HYDRO_BACKBONE_LABEL, ['!', ['has', 'point_count']]],
  [LYR_WIND_TURBINE_CIRCLE, ['!', ['has', 'point_count']]],
  [LYR_WIND_PARK_CIRCLE, null],
  [LYR_OIL_REFINERIES, null],
  [LYR_OIL_DEPOTS, null],
  [LYR_DROM_ENERGY_POINTS, null],
  [LYR_METRO_LOAD_CIRCLE, null],
  // Étiquettes : elles suivent leur objet.
  [LYR_WIND_TURBINE_LABEL, ['!', ['has', 'point_count']]],
  [LYR_WIND_PARK_LABEL, ['==', ['get', 'kind'], 'offshore']],
  [LYR_OIL_REFINERIES_LABEL, null],
  [LYR_OIL_DEPOTS_LABEL, null],
  [LYR_METRO_LOAD_LABEL, null],
  [LYR_BIOMETHANE_SITES, ['!', ['has', 'point_count']]],
  [LYR_BIOMETHANE_SITES_LABEL, ['!', ['has', 'point_count']]],
];

/**
 * Disques d'installation qui portent des calques compagnons `-halo` et `-icon` (spec 2026-10-16 § 2.2) : visibilité et
 * masquage par état leur sont recopiés (setVis, applyEnergyStateFilters).
 */
const ENERGY_DISC_IDS: ReadonlySet<string> = new Set([
  LYR_ENERGY_INFRA_CIRCLE, LYR_OUT_POWER_PLANNED, LYR_OUT_POWER_UNPLANNED, LYR_GAS_STORAGES, LYR_GAS_TERMINALS, LYR_OIL_REFINERIES,
  LYR_HYDRO_BACKBONE_CIRCLE, LYR_WIND_PARK_CIRCLE,
]);

/**
 * Groupes (supercluster) : un groupe ne porte pas l'état de ses objets ; il est caché quand tous les états
 * possibles de sa source sont masqués (éoliennes : sans état suivi et hors service ; biométhane : sans état suivi).
 */
const ENERGY_CLUSTER_LAYERS: ReadonlyArray<readonly [string, readonly EnergyState[]]> = [
  [LYR_WIND_CLUSTER, ['nonSuivi', 'maintenance']],
  [LYR_WIND_CLUSTER_ICON, ['nonSuivi', 'maintenance']],
  [LYR_HYDRO_CLUSTER, ['normal', 'reduit', 'tension', 'nonSuivi']],
  [LYR_HYDRO_CLUSTER_ICON, ['normal', 'reduit', 'tension', 'nonSuivi']],
  [LYR_BIOMETHANE_CLUSTERS, ['nonSuivi']],
];

export class DeckGLMap {
  private container: HTMLElement;
  private map: maplibregl.Map | null = null;
  private viewState: MapViewState = { ...DEFAULT_VIEW };
  private newsItems: NewsItem[] = [];
  private itemsById: Map<string, NewsItem> = new Map();
  private hoveredId: number | null = null;
  private onItemClick: ((item: NewsItem, point?: { x: number; y: number }) => void) | null = null;
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
  /** Dernière réponse GDACS (gardée couche masquée, repeinte au réaffichage). */
  private disastersData: DisastersResponse | null = null;
  /** Manifestations : clic sur un point (clé de position), infobulle au survol (spec 2026-10-17 manifestations). */
  private onProtestClick: ((placeKey: string) => void) | null = null;
  private protestHoverPopup: maplibregl.Popup | null = null;
  private protestHoverShown = false;
  private protestsData: ProtestsResponse | null = null;
  /** Criminalité (spec 2026-10-17 criminalité) : fichier annuel, indicateur choisi dans le panneau, infobulle au survol, repeinte différée couche masquée. */
  private crimeData: CrimeDataset | null = null;
  private crimeIndicator: CrimeIndicatorKey = DEFAULT_CRIME_INDICATOR;
  private crimeDirty = false;
  private crimeHoverPopup: maplibregl.Popup | null = null;
  private crimeHoverShown = false;
  private onCrimeCityClick: ((cityCode: string) => void) | null = null;
  /** Webcams : recensement statique, points regroupés aux petites échelles, infobulle au survol, clic relayé à App.ts (fiche). */
  private webcamsData: WebcamsDataset | null = null;
  private exposureData: ExposureResult | null = null;
  private sevesoSites: readonly ExposureAsset[] | null = null;
  private sevesoExposed: readonly Exposure[] | null = null;
  /** Calques tamisés par la mise en avant d'une pastille (setLegendHover) : leur survol est ignoré. */
  private dimmedLegendLayers = new Set<string>();
  private webcamHoverPopup: maplibregl.Popup | null = null;
  private webcamHoverShown = false;
  private onWebcamClick: ((id: string) => void) | null = null;
  /** Flux piétons : objets de l'événement choisi et phase (arrivée ou dispersion) ; infobulle au survol d'une rue. */
  private fluxData: readonly FluxFeature[] | null = null;
  private fluxPhase: FluxPhase = 'arrivee';
  private fluxInstant: FluxInstant | null = null;
  private fluxOthers: readonly FluxOtherEvent[] = [];
  private onFluxEventClick: ((id: string) => void) | null = null;
  private fluxHoverPopup: maplibregl.Popup | null = null;
  private fluxHoverShown = false;
  private emsData: EmsResponse | null = null;
  private asnrData: AsnrResponse | null = null;
  private _forestDangerFill = false;
  private _echoTopsEnabled = false;
  private radarPick: { lat: number; lon: number } | null = null;
  private onRadarPointPick: ((lat: number, lon: number) => void) | null = null;
  private envHoverPopup: maplibregl.Popup | null = null;
  private envHoverShown = false;
  /** Enjeu dont l'infobulle est ouverte : relue quand les enjeux changent, fermée s'il n'est plus exposé (zone inondable allumée). */
  private envPopupAsset: { layer: string; id: string } | null = null;
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
  /** Bulle unique de l'énergie ; épinglée = fiche détaillée ouverte par un clic (spec 2026-10-16 § 6). */
  /** Pastilles Énergie allumées (mise en avant persistante). */
  private energyFocusKeys: EnergyLayerKey[] = [];
  private readonly energyPopup = new EnergyPopupController(
    (pinned) => new maplibregl.Popup({
      closeButton: pinned, closeOnClick: false, maxWidth: pinned ? '320px' : '280px', className: 'dark-popup', offset: 12,
    }),
    (popup) => { if (this.map && popup instanceof maplibregl.Popup) popup.addTo(this.map); },
  );
  private energyHoverRaf = 0;
  private energyCursor = false;
  /** Dernières unités EDF placées (out-power-src), pour la bulle des sites nucléaires. */
  private lastPowerUnits: GeoJSON.Feature[] = [];
  private readonly onEnergyKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.energyPopup.pinned) this.energyPopup.unpin();
  };
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
  // getDepartmentsGeojson(), but updateISNR used to trigger it
  // unconditionally regardless of layer visibility. These two fields (the health layers use healthRegionsDirty/healthDeptsDirty,
  // the vigilance envVigilancePending) hold the most recent args passed while the
  // corresponding layer was inactive, so setLayerVisibility() can replay the
  // same call (cheap: memoized fetch, or first real one) once it's switched on.
  private _pendingIsnrScores: import('../types/index.ts').ISNRScore[] | null = null;
  /** v2 : niveaux de la pression par département gardés tant que la couche est masquée (même règle que l'ISNR). */
  private _pendingPressure: ReadonlyMap<string, import('../services/vigilance.ts').VigilanceLevel> | null = null;
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
  /** Pictos et étiquettes des événements rouges et orange (spec 2026-10-14) : DOM sans pointeur, le clic passe au point Deck.gl. */
  private alertOverlay: HTMLElement | null = null;
  /** Un élément par alerte affichée : au déplacement, seule la position change. */
  private alertEls = new Map<number, { el: HTMLElement; sig: string }>();
  /** Registre de l'énergie (spec 2026-10-15) : objets de chaque couche avec leur état, flux, tension carburants. */
  private energyEntries = new Map<EnergyLayerKey, EnergyEntry[]>();
  private energyFlows = new Map<EnergyLayerKey, EnergyFlowCount>();
  private fuelTensionLevels: VigilanceLevel[] = [];
  private hiddenEnergyStates: ReadonlySet<EnergyState> = new Set();
  private onEnergyKeyChange: ((model: EnergyKeyModel) => void) | null = null;
  private pulseMarkers: Map<string, HTMLElement> = new Map();

  // NOTE: Dynamic dasharray animations disabled due to MapLibre LineAtlas saturation.
  // Using point-based animation for chevrons (true movement along arcs).

  /** Derniers arcs d'échange construits par filière (données d'entrée des flèches, spec 2026-10-16 § 4). */
  private lastFlowArcs: Record<EnergyFlowKind, GeoJSON.Feature[]> = { elec: [], gaz: [], petrole: [] };
  /** Minuterie unique de l'animation des flèches (null = arrêtée). */
  private energyFlowTimer: ReturnType<typeof setInterval> | null = null;
  private energyFlowStep = 0;
  /** Version des arcs d'échange (incrémentée à chaque mise à jour) et dernière signature dessinée : pas de repeinte inutile. */
  private flowArcsVersion = 0;
  private energyFlowSig: string | null = null;

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
  /** Articles reçus d'App, avant le retrait de ceux des événements dessinés (spec 2026-10-14). */
  private rawNewsItems: NewsItem[] = [];
  private drawnEventIds: ReadonlySet<number> = new Set();
  private eventPointsVisible = false;
  private onEventPointClick: ((id: number, x: number, y: number) => void) | null = null;
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
  // Dernier signal Écowatt OFFICIEL reçu (national, RTE) — pour l'info-bulle région, qui
  // n'affiche plus de signal PAR région (Écowatt n'en a jamais eu).
  private lastEcowattOfficial: import('../types/index.ts').EcowattOfficial | null = null;

  // ─── Gas tooltip data ───
  private gasFlowStats = new Map<string, import('../types/index.ts').GasInterconnectionFlowStats>();
  private gasBorderHistory = new Map<string, number[]>(); // sparkline 7j par borderCode

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
    // Ajouté après le zoom : MapLibre empile les contrôles du bas vers le haut, le bouton se place donc au-dessus.
    this.map.addControl(new FranceFitControl(this), 'bottom-right');
    // Cadrage « France » accroché : suivi de la taille de la carte ; tout déplacement ou zoom à la main le décroche.
    this.map.on('movestart', (e: { originalEvent?: unknown }) => { if (e.originalEvent) this.franceFitSticky = false; });
    if (typeof ResizeObserver !== 'undefined') {
      this.franceFitObserver = new ResizeObserver(() => this.refitFrance());
      this.franceFitObserver.observe(this.container);
    }
    // Le conteneur peut déborder de la fenêtre : sa taille ne change pas toujours avec elle, d'où l'écoute de la fenêtre aussi.
    window.addEventListener('resize', () => this.refitFrance());

    await new Promise<void>((r) => this.map!.on('load', r));
    // Carte Sécurité et défense (17/10/2026) : script autonome, actif seulement dans l'onglet Sécurité et défense ; ?maquette=off la coupe.
    if (new URLSearchParams(location.search).get('maquette') !== 'off') {
      void Promise.all([import('./shared/icons'), import('@/config/military-bases-db')]).then(([icons, bases]) => {
        (window as unknown as { __fmMaquette?: object }).__fmMaquette = { fmIcon: icons.fmIcon, ALL_MILITARY_INSTALLATIONS: bases.ALL_MILITARY_INSTALLATIONS };
        // Carte Santé (18/10/2026) : même mécanique, active seulement dans l'onglet Santé.
        for (const name of ['maquette-securite', 'maquette-sante']) {
          const sc = document.createElement('script');
          // Version du build : un déploiement est pris tout de suite (avec la date du jour, l'ancienne version restait la journée).
          sc.src = `/${name}.js?v=${__BUILD_ID__}`;
          document.head.appendChild(sc);
        }
      });
    }
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

    // Échanges avec l'étranger : flèches construites par energy-flows.ts (spec 2026-10-16 § 4).
    this.map.addSource(SRC_ENERGY_FLOWS, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_ENERGY_FLOW_HEADS, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_ENERGY_FLOW_LABELS, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_ENERGY_CHOKES, { type: 'geojson', data: emptyFC() });

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
    this.map.addSource(SRC_PROTESTS, envSourceSpec());
    this.map.addSource(SRC_CRIME_DEPTS, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_CRIME_CITIES, envSourceSpec());
    this.map.addSource(SRC_WEBCAMS, webcamSourceSpec());
    this.map.addSource(SRC_EXPOSURE, exposureSourceSpec());
    this.map.addSource(SRC_FLOOD_ZONES, exposureSourceSpec());
    this.map.addSource(SRC_FLOOD_ASSETS, exposureSourceSpec());
    this.map.addSource(SRC_SEVESO, sevesoSourceSpec());
    this.map.addSource(SRC_POLLEN, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_FLUX, fluxSourceSpec());

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
    this.map.addSource(SRC_ASNR_RINGS, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_INFRA_HIGHLIGHT, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_DROM_ENERGY, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_DROM_ENERGY_HTA_LINES, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_DROM_ENERGY_HIGHLIGHT, { type: 'geojson', data: emptyFC() });
    // Barrages et éoliennes groupés aux petites échelles ; un groupe compte ses objets à l'arrêt ou sous tension (spec 2026-10-16 § 3).
    const alertCount: maplibregl.ExpressionSpecification = ['+', ['case', ['in', ['coalesce', ['get', 'energyState'], 'nonSuivi'], ['literal', ['arret', 'tension']]], 1, 0]];
    this.map.addSource(SRC_HYDRO_BACKBONE, {
      type: 'geojson', data: emptyFC(), cluster: true, clusterRadius: 45, clusterMaxZoom: 7, clusterProperties: { alerts: alertCount },
    });
    this.map.addSource(SRC_WIND_TURBINES, {
      type: 'geojson', data: emptyFC(), cluster: true, clusterRadius: 70, clusterMaxZoom: 8, clusterProperties: { alerts: alertCount },
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
        // Fond de contexte discret : les installations restent au premier plan (spec 2026-10-16 § 5).
        'fill-opacity': 0.16,
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



    // Pointe des flèches d'échange (SDF, teintée par flux).
    await this.createFlowHeadIcon();
    await this.createRefineryTriangleIcon();
    await this.createEnergyShapeIcons();





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
    // Criminalité (deckgl/crime-map.ts) : départements peints sous les points, masqués jusqu'à setLayerVisibility.
    for (const layer of CRIME_LAYERS) this.map.addLayer(layer);
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
    // Picto flamme des foyers confirmés (orange, rouges), teinté par leur niveau ; les pictos qui se chevauchent sont éclaircis.
    this.map.addLayer({
      id: LYR_FIRES_ICON,
      type: 'symbol',
      source: SRC_FIRES,
      filter: ['==', ['get', 'glow'], true],
      layout: {
        'icon-image': envIconImage('flame'), 'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.42, 10, 0.6],
        'icon-allow-overlap': false, 'icon-offset': [0, -22], 'symbol-sort-key': ['-', 0, ['get', 'sortKey']],
      },
      paint: { 'icon-color': ['get', 'color'], 'icon-halo-color': '#0a0a0f', 'icon-halo-width': 1.5 },
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
        // Survol : la couleur du niveau reste, le trait s'épaissit à peine (plus de gros trait blanc, 20/10/2026).
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'],
          4, ['case', ['boolean', ['feature-state', 'hover'], false], 4.5, 3],
          8, ['case', ['boolean', ['feature-state', 'hover'], false], 6.5, 5],
          12, ['case', ['boolean', ['feature-state', 'hover'], false], 10, 8],
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
    // Tronçon sélectionné : liseré blanc fin SOUS le tracé (2 px de chaque côté), la couleur du niveau reste lisible au centre.
    this.map.addLayer({
      id: LYR_FLOODS_HIGHLIGHT,
      type: 'line',
      source: SRC_FLOODS_HIGHLIGHT,
      paint: {
        'line-color': '#ffffff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 6, 8, 8.5, 12, 12],
        'line-opacity': 0.95,
        'line-blur': 0.4,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'visibility': 'none',
      },
    }, LYR_FLOODS);
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
          'critical', 'rgba(255,59,48,0.25)',
          'high', 'rgba(255,149,0,0.20)',
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
          ['>=', ['get', 'maxThreat'], 3], newsLevelHex('high'),
          ['>=', ['get', 'maxThreat'], 2], newsLevelHex('medium'),
          ['>=', ['get', 'maxThreat'], 1], newsLevelHex('low'),
          NEWS_INFO_HEX,
        ],
        // Halo to make it pop like DSFR icons
        'circle-stroke-width': ['case',
          ['boolean', ['feature-state', 'hover'], false], 3, 1],
        'circle-stroke-color': ['case',
          ['boolean', ['feature-state', 'hover'], false],
          '#ffffff',
          'rgba(10,10,15,0.8)'],
        // Taille fixe : le nombre d'articles est écrit au centre (légende sans échelle de taille, spec 2026-10-14).
        'circle-radius': 13,
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
        'text-color': '#0a0a0f',
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
          'critical', newsLevelHex('critical'),
          'high', newsLevelHex('high'),
          'medium', newsLevelHex('medium'),
          'low', newsLevelHex('low'),
          NEWS_INFO_HEX],
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
        // Gazoduc : teinte du gaz, discrète (spec 2026-10-16 § 5).
        'line-color': ENERGY_SECTOR_HEX.gaz,
        'line-opacity': 0.32,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 10, 2.2],
      },
    });

    this.map.addLayer({
      id: LYR_GAS_NETWORK_TEREGA,
      type: 'line',
      source: SRC_GAS_NETWORK_TEREGA,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        // Gazoduc : teinte du gaz, discrète (spec 2026-10-16 § 5).
        'line-color': ENERGY_SECTOR_HEX.gaz,
        'line-opacity': 0.32,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 10, 2.2],
      },
    });


    // ─── Stockages de gaz : carrés à la couleur de l'état du remplissage (spec 2026-10-15) ───
    this.map.addLayer({
      id: LYR_GAS_STORAGES,
      type: 'circle',
      source: SRC_GAS_VITALS,
      filter: ['==', ['get', 'type'], 'storage'],
      paint: {
        'circle-radius': ENERGY_DISC_RADIUS.gas,
        'circle-color': discColorExpr(ENERGY_SECTOR_HEX.gaz),
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#05060a',
      },
    });
    this.addDiscCompanions(LYR_GAS_STORAGES, SRC_GAS_VITALS, ['==', ['get', 'type'], 'storage'], ENERGY_DISC_RADIUS.gas,
      discColorExpr(ENERGY_SECTOR_HEX.gaz), energyIconImage('flame'), glyphColorExpr(false));

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

    // ─── Terminaux méthaniers : carrés gris clair, sans état suivi (spec 2026-10-15) ───
    this.map.addLayer({
      id: LYR_GAS_TERMINALS,
      type: 'circle',
      source: SRC_GAS_VITALS,
      filter: ['==', ['get', 'type'], 'terminal'],
      paint: {
        'circle-radius': ENERGY_DISC_RADIUS.gas,
        'circle-color': discColorExpr(ENERGY_SECTOR_HEX.gaz),
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#05060a',
      },
    });
    this.addDiscCompanions(LYR_GAS_TERMINALS, SRC_GAS_VITALS, ['==', ['get', 'type'], 'terminal'], ENERGY_DISC_RADIUS.gas,
      discColorExpr(ENERGY_SECTOR_HEX.gaz), energyIconImage('flame'), glyphColorExpr(false));






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
        // Biométhane : semis discret de petits points roses, sans nombre (spec 2026-10-16 § 3).
        'circle-radius': ['step', ['get', 'point_count'], 3, 10, 4, 50, 5],
        'circle-color': ENERGY_SECTOR_HEX.gaz,
        'circle-opacity': 0.85,
        'circle-stroke-width': 0.8,
        'circle-stroke-color': '#05060a',
      },
      layout: { visibility: 'none' },
    });


    // Individual unclustered points — amber dots
    this.map.addLayer({
      id: LYR_BIOMETHANE_SITES,
      type: 'circle',
      source: SRC_BIOMETHANE_SITES,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': 3,
        'circle-color': ENERGY_SECTOR_HEX.gaz,
        'circle-opacity': 0.85,
        'circle-stroke-width': 0.8,
        'circle-stroke-color': '#05060a',
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
        'text-color': '#e8e8ec',
        'text-halo-color': '#0a0a0f',
        'text-halo-width': 1.5,
      },
    });

    // ═══════════════════════════════════════════════════════════════
    // OIL/PETROLEUM FLOWS — Brown/anthracite with amber glow, slow dash
    // Thick arcs to suggest viscous flow, ready for future oil data
    // ═══════════════════════════════════════════════════════════════







    // ─── Oil Infrastructure: Pipelines ───
    this.map.addLayer({
      id: LYR_OIL_PIPELINES,
      type: 'line',
      source: SRC_OIL_PIPELINES,
      paint: {
        // Oléoduc : teinte du pétrole en pointillé, gazoduc en trait plein (spec 2026-10-16 § 5).
        'line-color': ENERGY_SECTOR_HEX.petrole,
        'line-width': ['get', 'lineWidth'],
        'line-opacity': 0.5,
        'line-dasharray': [2, 1.5],
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
        // Tension faible : rien ; moyenne à critique : voile croissant (spec 2026-10-16 § 5).
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          0.32,
          ['match', ['get', 'tensionLevel'], 'LOW', 0, 'MEDIUM', 0.12, 'HIGH', 0.18, 0.24],
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
        'line-width': 2.2,
        'line-opacity': ['match', ['get', 'tensionLevel'], 'LOW', 0, 1],
      },
    });

    // ─── Échanges avec l'étranger (spec 2026-10-16 § 4) : liseré sombre, trait, tirets animés, pointe, étiquette ; détroits ───
    this.map.addLayer({ id: LYR_ENERGY_FLOW_CASE, type: 'line', source: SRC_ENERGY_FLOWS, layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': '#05060a', 'line-width': ['+', ['get', 'w'], 3] } });
    this.map.addLayer({ id: LYR_ENERGY_FLOW_LINES, type: 'line', source: SRC_ENERGY_FLOWS, layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'w'], 'line-opacity': 0.45 } });
    this.map.addLayer({ id: LYR_ENERGY_FLOW_ANIM, type: 'line', source: SRC_ENERGY_FLOWS, layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'w'], 'line-dasharray': ENERGY_FLOW_DASH_SEQ[0] } });
    this.map.addLayer({ id: LYR_ENERGY_FLOW_HEADS, type: 'symbol', source: SRC_ENERGY_FLOW_HEADS,
      layout: { 'icon-image': ENERGY_FLOW_HEAD_ICON, 'icon-size': ['get', 'size'], 'icon-rotate': ['get', 'rot'], 'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true, 'icon-ignore-placement': true },
      paint: { 'icon-color': ['get', 'color'], 'icon-halo-color': '#05060a', 'icon-halo-width': 1.5 } });
    this.map.addLayer({ id: LYR_ENERGY_FLOW_LABELS, type: 'symbol', source: SRC_ENERGY_FLOW_LABELS,
      layout: { 'text-field': ['get', 'text'], 'text-font': ['Open Sans Bold'], 'text-size': 12, 'text-offset': [0, 0.6], 'text-anchor': 'top', 'text-padding': 4 },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#05060a', 'text-halo-width': 2 } });
    this.map.addLayer({ id: LYR_ENERGY_CHOKE, type: 'circle', source: SRC_ENERGY_CHOKES,
      paint: { 'circle-radius': 4, 'circle-color': '#05060a', 'circle-stroke-color': ENERGY_CHOKE_HEX, 'circle-stroke-width': 2 } });
    this.map.addLayer({ id: LYR_ENERGY_CHOKE_LABEL, type: 'symbol', source: SRC_ENERGY_CHOKES,
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Bold'], 'text-size': 11, 'text-offset': [0.8, 0], 'text-anchor': 'left' },
      paint: { 'text-color': ENERGY_CHOKE_HEX, 'text-halo-color': '#05060a', 'text-halo-width': 2 } });


    // ─── Oil Infrastructure: Refineries — triangles ▲ (▼ si maintenance) ───
    this.map.addLayer({
      id: LYR_OIL_REFINERIES,
      type: 'circle',
      source: SRC_OIL_REFINERIES,
      paint: {
        'circle-radius': ENERGY_DISC_RADIUS.refinery,
        'circle-color': discColorExpr(ENERGY_SECTOR_HEX.petrole),
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#05060a',
      },
    });
    this.addDiscCompanions(LYR_OIL_REFINERIES, SRC_OIL_REFINERIES, null, ENERGY_DISC_RADIUS.refinery,
      discColorExpr(ENERGY_SECTOR_HEX.petrole), energyIconImage('fuel'), glyphColorExpr(true));

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
        'text-color': '#e8e8ec',
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
        // Dépôts : points du pétrole, stratégiques et terminaux plus gros et cerclés de blanc (spec 2026-10-16 § 3).
        'circle-radius': oilDepotRadiusExpr(),
        'circle-color': ENERGY_SECTOR_HEX.petrole,
        'circle-opacity': 0.95,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': oilDepotStrokeExpr(),
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







    // Avis de sûreté ASNR (spec 2026-10-13) : anneau orange de moins de 7 jours, gris jusqu'à 30 jours.
    this.map.addLayer(ASNR_RING_LAYER);

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
        // Nucléaire : violet gardé, réduit et maintenance par l'anneau ; autres types : teinte de la filière (spec 2026-10-16 § 2).
        'circle-radius': INFRA_DISC_RADIUS,
        'circle-color': ['case', ['==', ['get', 'type'], 'nuclear'], nuclearDiscColorExpr(), discColorExpr(infraSectorHexExpr())],
        'circle-stroke-color': ['case', ['==', ['get', 'type'], 'nuclear'], nuclearRingColorExpr(), '#05060a'],
        'circle-stroke-width': ['case', ['==', ['get', 'type'], 'nuclear'], nuclearRingWidthExpr(), 1.5],
        'circle-opacity': ['case', ['==', ['get', 'type'], 'nuclear'], nuclearOpacityExpr(), 1],
      },
    });
    this.addDiscCompanions(LYR_ENERGY_INFRA_CIRCLE, SRC_INFRA, null, INFRA_DISC_RADIUS,
      ['case', ['==', ['get', 'type'], 'nuclear'], nuclearDiscColorExpr(), discColorExpr(infraSectorHexExpr())], infraGlyphImageExpr(),
      ['match', ['get', 'type'], ['thermal', 'refinery', 'oil-depot'], glyphColorExpr(true), glyphColorExpr(false)]);

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
        // Lignes HTA des outre-mer : réseau, gris neutre (spec 2026-10-15).
        'line-color': '#aeaeb2',
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
        // Outre-mer : disque de l'électricité, couleur de l'état s'il est anormal ; le type se lit à la taille et dans la bulle.
        'circle-color': discColorExpr(ENERGY_SECTOR_HEX.electricite),
        'circle-opacity': 0.92,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#0a0a12',
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

    // Hydraulique : losanges à la couleur de l'état (spec 2026-10-15) ; halo et anneau de signal retirés.
    this.map.addLayer({
      id: LYR_HYDRO_BACKBONE_CIRCLE,
      type: 'circle',
      source: SRC_HYDRO_BACKBONE,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ENERGY_DISC_RADIUS.hydro,
        'circle-color': discColorExpr(ENERGY_SECTOR_HEX.hydraulique),
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#05060a',
      },
    });
    this.addDiscCompanions(LYR_HYDRO_BACKBONE_CIRCLE, SRC_HYDRO_BACKBONE, ['!', ['has', 'point_count']], ENERGY_DISC_RADIUS.hydro,
      discColorExpr(ENERGY_SECTOR_HEX.hydraulique), energyIconImage('droplet'), glyphColorExpr(false));
    // Groupes de barrages : bleu, orange si l'un d'eux est à l'arrêt ou sous tension (spec 2026-10-16 § 3).
    this.map.addLayer({
      id: LYR_HYDRO_CLUSTER,
      type: 'circle',
      source: SRC_HYDRO_BACKBONE,
      filter: ['has', 'point_count'],
      paint: {
        'circle-radius': ['step', ['get', 'point_count'], 9, 5, 12, 15, 15],
        'circle-color': ['case', ['>', ['get', 'alerts'], 0], ENERGY_DISC_STATE_HEX.tension, ENERGY_SECTOR_HEX.hydraulique],
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#05060a',
      },
    });
    this.map.addLayer({
      id: LYR_HYDRO_CLUSTER_ICON,
      type: 'symbol',
      source: SRC_HYDRO_BACKBONE,
      filter: ['has', 'point_count'],
      layout: {
        'icon-image': energyIconImage('droplet'),
        'icon-size': ['step', ['get', 'point_count'], 0.47, 5, 0.6, 15, 0.75],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-color': '#ffffff' },
    });

    this.map.addLayer({
      id: LYR_HYDRO_BACKBONE_LABEL,
      type: 'symbol',
      source: SRC_HYDRO_BACKBONE,
      filter: ['!', ['has', 'point_count']],
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



    // ─── Éolien : cluster bubbles (zoom < 10) ───
    // ─── Éolien : groupes cyan, orange si l'une est à l'arrêt ou sous tension ; le nombre est dans la bulle (spec 2026-10-16 § 3) ───
    this.map.addLayer({
      id: LYR_WIND_CLUSTER,
      type: 'circle',
      source: SRC_WIND_TURBINES,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': ['case', ['>', ['get', 'alerts'], 0], ENERGY_DISC_STATE_HEX.tension, ENERGY_SECTOR_HEX.eolien],
        'circle-radius': ['step', ['get', 'point_count'], 8, 100, 11, 400, 14],
        'circle-opacity': 0.95,
        'circle-stroke-width': 1.2,
        'circle-stroke-color': '#05060a',
      },
    });
    this.map.addLayer({
      id: LYR_WIND_CLUSTER_ICON,
      type: 'symbol',
      source: SRC_WIND_TURBINES,
      filter: ['has', 'point_count'],
      layout: {
        'icon-image': energyIconImage('wind'),
        'icon-size': ['step', ['get', 'point_count'], 0.42, 100, 0.58, 400, 0.74],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-color': '#05262a' },
    });


    this.map.addLayer({
      id: LYR_WIND_TURBINE_CIRCLE,
      type: 'circle',
      source: SRC_WIND_TURBINES,
      filter: ['!', ['has', 'point_count']],
      minzoom: 8,
      paint: {
        'circle-radius': 3,
        'circle-color': discColorExpr(ENERGY_SECTOR_HEX.eolien),
        'circle-stroke-width': 0.8,
        'circle-stroke-color': '#05060a',
      },
    });

    this.map.addLayer({
      id: LYR_WIND_PARK_CIRCLE,
      type: 'circle',
      source: SRC_WIND_PARKS,
      paint: {
        'circle-radius': ENERGY_DISC_RADIUS.windPark,
        'circle-color': discColorExpr(ENERGY_SECTOR_HEX.eolien),
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#05060a',
      },
    });
    this.addDiscCompanions(LYR_WIND_PARK_CIRCLE, SRC_WIND_PARKS, null, ENERGY_DISC_RADIUS.windPark,
      discColorExpr(ENERGY_SECTOR_HEX.eolien), energyIconImage('wind'), glyphColorExpr(true));

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


    // ─── Métropoles: cercle principal ───
    this.map.addLayer({
      id: LYR_METRO_LOAD_CIRCLE,
      type: 'circle',
      source: SRC_METRO_LOAD,
      paint: {
        // Consommation des métropoles : cercle proportionnel (surface ∝ MW), blanc translucide bien cerné, posé sous les
        // installations et les flèches (spec 2026-10-16 § 5).
        'circle-radius': metroRadiusExpr(),
        'circle-color': '#eef2f7',
        'circle-opacity': 0.28,
        'circle-stroke-width': 1.6,
        'circle-stroke-color': '#eef2f7',
        'circle-stroke-opacity': 0.9,
      },
    });

    // ─── Métropoles: labels ───
    this.map.addLayer({
      id: LYR_METRO_LOAD_LABEL,
      type: 'symbol',
      source: SRC_METRO_LOAD,
      layout: {
        'text-field': ['concat', ['get', 'name'], '\n', ['get', 'mwLabel']],
        // Juste sous le bord du cercle proportionnel, quelle que soit sa taille.
        'text-size': METRO_LABEL_SIZE,
        'text-radial-offset': metroLabelOffsetExpr(),
        'text-variable-anchor': ['top'],
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
    // Disques du gaz posés avant les flèches d'échange : remontés au-dessus, comme les autres installations (spec 2026-10-16 § 4).
    for (const id of [LYR_GAS_STORAGES, LYR_GAS_TERMINALS]) {
      for (const layerId of [`${id}-halo`, id, `${id}-icon`]) this.map.moveLayer(layerId, `${LYR_OIL_REFINERIES}-halo`);
    }
    this.map.moveLayer(LYR_GAS_STORAGES_LABEL, `${LYR_OIL_REFINERIES}-halo`);
    // Cercles de consommation des métropoles : sous les flèches et les installations, qu'ils ne doivent pas voiler.
    this.map.moveLayer(LYR_METRO_LOAD_CIRCLE, LYR_ENERGY_FLOW_CASE);
    // Manifestations (deckgl/protests-map.ts) : points regroupés par position, masqués jusqu'à setLayerVisibility.
    for (const layer of PROTEST_LAYERS) this.map.addLayer(layer);
    // Criminalité : ronds des villes au-dessus des surfaces, masqués jusqu'à setLayerVisibility.
    for (const layer of CRIME_CITY_LAYERS) this.map.addLayer(layer);
    // Webcams (deckgl/webcams-map.ts) : groupes et points, masqués jusqu'à setLayerVisibility.
    for (const layer of WEBCAM_LAYERS) this.map.addLayer(layer);
    // Flux piétons (deckgl/flux-pietons-map.ts) : isochrones, rues, rassemblement, masqués jusqu'à setLayerVisibility.
    for (const layer of FLUX_LAYERS) this.map.addLayer(layer);
    // Pollens (deckgl/pollen-map.ts) : remplissage départemental sous les vigilances météo (pas au-dessus des points).
    for (const layer of POLLEN_LAYERS) this.map.addLayer(layer, this.map.getLayer(LYR_WEATHER_FILL) ? LYR_WEATHER_FILL : undefined);
    // Sites Seveso (deckgl/seveso-map.ts), sous les enjeux exposés ; masqués jusqu'à setLayerVisibility.
    for (const layer of SEVESO_LAYERS) this.map.addLayer(layer);
    // Enjeux exposés (deckgl/exposure-map.ts, onglet Environnement) : au-dessus de tout, masqués jusqu'à setLayerVisibility.
    for (const layer of EXPOSURE_LAYERS) this.map.addLayer(layer);
    // Enjeux exposés aux crues (pastille Crues), mêmes points que ceux d'En bref.
    for (const layer of FLOOD_ASSET_LAYERS) this.map.addLayer(layer);
    // Zones inondables des tronçons en crue (pastille Crues) : sous les tracés de crue, pour que le niveau du tronçon reste lisible.
    this.map.addLayer(FLOOD_ZONE_LAYER, this.map.getLayer(LYR_FLOODS) ? LYR_FLOODS : undefined);

    // Séismes et marégraphes (phase B) au-dessus de toutes les surfaces : ajoutés ici, sous la première couche de points qui suit la dernière surface.
    placeEnvBPoints(this.map);
    placeDisasterPoints(this.map);

    // ─── Critical alerts (never clustered, always visible) ───
    // Glow layer for critical points
    this.map.addLayer({
      id: 'news-critical-glow',
      type: 'circle',
      source: SRC_CRITICAL,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 25, 8, 40, 12, 55],
        'circle-color': 'rgba(255,59,48,0.15)',
        'circle-blur': 0.7,
      },
    });
    // Main circle for critical points
    this.map.addLayer({
      id: 'news-critical-pts',
      type: 'circle',
      source: SRC_CRITICAL,
      paint: {
        'circle-color': newsLevelHex('critical'),
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
          'rgba(10,10,15,0.85)'],
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
      const features = this.map.queryRenderedFeatures(bbox, { layers: [LYR_POINTS, 'news-critical-pts'] });

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
        if (item && this.onItemClick) this.onItemClick(item, { x: e.point.x, y: e.point.y });
        return;
      }

      // Raw map click (empty area) — used by élus panel
      if (this.onRawMapClick) {
        this.onRawMapClick(e.lngLat.lat, e.lngLat.lng);
      }

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
    this.initProtestsInteractions();
    this.initCrimeInteractions();
    this.initWebcamsInteractions();
    this.initExposureInteractions();
    this.initSevesoInteractions();
    this.initFluxInteractions();


    // Énergie (spec 2026-10-16 § 6) : un seul survol, une seule bulle, fiche détaillée épinglée au clic.
    this.initEnergyHover();

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
    this.attachAlertOverlay();
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
        this.syncEventAlertMarkers();
      });
    };
    this.map.on('move', schedulePulseUpdate);
    this.map.on('zoom', schedulePulseUpdate);
    // Un redimensionnement (panneau ouvert ou fermé) déplace les points sans événement « move ».
    this.map.on('resize', schedulePulseUpdate);

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
        getRadius: (d: EventMapPoint) => drawnRadius(d),
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
          if (point) this.onEventPointClick?.(point.id, info.x, info.y);
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

  /** Survol unique de l'énergie : l'arbitre choisit un objet, une seule bulle le décrit ; clic = fiche épinglée. */
  private initEnergyHover(): void {
    const map = this.map;
    if (!map) return;
    map.on('mousemove', (e) => {
      if (this.energyPopup.pinned) return;
      cancelAnimationFrame(this.energyHoverRaf);
      this.energyHoverRaf = requestAnimationFrame(() => {
        // Un clic a pu épingler une fiche entre le mouvement et cette image : elle reste.
        if (this.energyPopup.pinned) return;
        const hit = pickEnergyHover(this.energyCandidatesAt(e.point));
        this.setFuelTensionHover(hit?.kind === 'fuelTension' ? String(hit.properties.code ?? '') : null);
        const card = hit ? energyCardFor(hit, this.energyContextFor(hit)) : null;
        if (!card) {
          this.hideEnergyPopup();
          return;
        }
        map.getCanvas().style.cursor = 'pointer';
        this.energyCursor = true;
        this.energyPopup.show([e.lngLat.lng, e.lngLat.lat], tooltipCardHtml(card));
      });
    });
    map.on('click', (e) => {
      cancelAnimationFrame(this.energyHoverRaf);
      const hit = pickEnergyHover(this.energyCandidatesAt(e.point));
      if (!hit) {
        if (this.energyPopup.pinned) this.energyPopup.unpin();
        return;
      }
      const card = energyCardFor(hit, this.energyContextFor(hit));
      const html = this.energyDetailHtml(hit) ?? (card ? tooltipCardHtml(card) : null);
      if (!html) return;
      this.energyPopup.pin([e.lngLat.lng, e.lngLat.lat], html);
    });
    map.getCanvas().addEventListener('mouseleave', () => {
      if (!this.energyPopup.pinned) this.hideEnergyPopup();
    });
    document.addEventListener('keydown', this.onEnergyKeydown);
  }

  /** Objets de l'énergie sous le curseur (±4 px), avec leur distance au curseur et l'opacité de leur calque. */
  private energyCandidatesAt(point: maplibregl.Point): HoverCandidate[] {
    const map = this.map;
    if (!map) return [];
    const layers = ENERGY_HOVER_LAYER_IDS.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
    if (layers.length === 0) return [];
    const feats = map.queryRenderedFeatures([[point.x - 4, point.y - 4], [point.x + 4, point.y + 4]], { layers });
    const seen = new Set<string>();
    const out: HoverCandidate[] = [];
    for (const f of feats) {
      const props = f.properties ?? {};
      const key = `${f.layer.id}|${String(f.id ?? props.id ?? props.cluster_id ?? JSON.stringify(props))}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Lignes et surfaces : distance nominale de 3 px (dans la boîte de ±4 px) ; un point posé dessus et visé passe devant.
      const cand: HoverCandidate = { layerId: f.layer.id, properties: props, distancePx: 3, opacity: this.layerOpacity(f.layer.id, f.layer.type) };
      if (f.geometry.type === 'Point') {
        const [lng, lat] = f.geometry.coordinates;
        const at = map.project([lng, lat]);
        cand.distancePx = Math.hypot(at.x - point.x, at.y - point.y);
        cand.coordinates = [lng, lat];
      }
      out.push(cand);
    }
    // Une webcam (point ou groupe) ou une rue des flux piétons visée passe devant les surfaces de l'énergie (départements en
    // tension, régions) : son infobulle ou sa fiche s'affiche seule.
    const webcamLayers = [LYR_WEBCAMS, LYR_WEBCAM_CLUSTER].filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
    if (webcamLayers.length > 0 && map.queryRenderedFeatures(point, { layers: webcamLayers }).length > 0) return out.filter((c) => c.coordinates !== undefined);
    const fluxBox: [maplibregl.PointLike, maplibregl.PointLike] = [[point.x - 4, point.y - 4], [point.x + 4, point.y + 4]];
    if (map.getLayer(LYR_FLUX_LINES) && map.getLayoutProperty(LYR_FLUX_LINES, 'visibility') !== 'none'
      && map.queryRenderedFeatures(fluxBox, { layers: [LYR_FLUX_LINES] }).length > 0) return out.filter((c) => c.coordinates !== undefined);
    return out;
  }

  /** Opacité effective d'un calque pour l'arbitre : facteur d'atténuation des légendes, rapporté à l'opacité d'origine. */
  private layerOpacity(layerId: string, type: string): number {
    const saved = this.originalOpacities.get(layerId);
    const prop = saved?.prop ?? (type === 'line' ? 'line-opacity' : type === 'fill' ? 'fill-opacity' : type === 'symbol' ? 'icon-opacity' : 'circle-opacity');
    const v: unknown = this.map?.getPaintProperty(layerId, prop);
    return effectiveOpacity(v, saved?.orig ?? v);
  }

  /** Contexte de la bulle : unités EDF d'un site nucléaire (moins de 3 km), bilan RTE d'une région. */
  private energyContextFor(hit: { kind: EnergyHoverKind; properties: Readonly<Record<string, unknown>>; coordinates?: readonly [number, number] }): EnergyHoverContext {
    const p = hit.properties;
    if (hit.kind === 'infra' && p.type === 'nuclear') {
      const site = hit.coordinates;
      const near = (c: [number, number]): boolean => site !== undefined && kmBetween([site[0], site[1]], c) < 3;
      const units = this.lastPowerUnits
        .filter((f) => f.geometry.type === 'Point' && near([f.geometry.coordinates[0], f.geometry.coordinates[1]]))
        .map((f) => ({
          name: String(f.properties?.name ?? ''),
          lostMw: typeof f.properties?.lostMw === 'number' ? f.properties.lostMw : null,
          kind: String(f.properties?.kind ?? ''),
        }));
      return { units };
    }
    if (hit.kind === 'region') {
      const st = this.energyRegionStats.get(String(p.code ?? ''));
      if (!st) return {};
      return { region: { consumptionMw: st.consumptionMW, productionMw: st.production.total, deltaPct: st.consumptionDeltaPct, updatedAt: st.updatedAt } };
    }
    return {};
  }

  /** Fiche détaillée de l'objet cliqué : les fiches existantes ; null pour les groupes, détroits et gazoducs (la bulle suffit). */
  private energyDetailHtml(hit: {
    kind: EnergyHoverKind; layerId: string; properties: Readonly<Record<string, unknown>>; coordinates?: readonly [number, number];
  }): string | null {
    const p: Record<string, unknown> = { ...hit.properties };
    switch (hit.kind) {
      case 'infra': return this.buildInfrastructureHoverHtml(p);
      case 'hydro': return this.buildHydraulicHoverHtml(p);
      case 'wind': return this.buildEolienHoverHtml(p);
      case 'gas': return this.buildGasHoverHtml(p);
      case 'biomethane': return this.buildBiomethaneHoverHtml(p);
      case 'metro': return this.buildMetropoleHoverHtml(p);
      case 'refinery': return this.buildOilRefineryHoverHtml(p);
      case 'oilDepot': return tooltipCardHtml(oilDepotDetailCard(p, this.oilDepotContext(hit.coordinates)));
      case 'oilPipeline': return this.buildOilPipelineHoverHtml(p);
      case 'flow': return this.energyFlowDetailHtml(p);
      case 'region': return this.buildRegionDetailHtml(String(p.code ?? ''));
      case 'fuelTension': return this.buildFuelTensionDetailHtml(p);
      case 'drom': return renderDromEnergyTooltipHtml(dromEnergyAssetFromProperties(p));
      case 'powerUnit': {
        const body = p.body;
        return typeof body === 'string' && body !== '' ? `<div class="hm-tip">${body}</div>` : null;
      }
      default: return null;
    }
  }

  private hideEnergyPopup(): void {
    if (this.energyCursor && this.map) this.map.getCanvas().style.cursor = '';
    this.energyCursor = false;
    if (this.energyPopup.pinned) return;
    this.setFuelTensionHover(null);
    this.energyPopup.hide();
  }

  /** Contour souligné du département en tension survolé (feature-state hover). */
  private setFuelTensionHover(code: string | null): void {
    if (!this.map || code === this._lastHoveredFuelDeptId) return;
    this.clearFuelTensionHoverState();
    if (code) {
      this.map.setFeatureState({ source: SRC_FUEL_TENSION, id: code }, { hover: true });
      this._lastHoveredFuelDeptId = code;
    }
  }

  /** Fiche détaillée d'un département en tension carburants (clic, spec 2026-10-16 § 6.4). */
  private buildFuelTensionDetailHtml(properties: Readonly<Record<string, unknown>>): string {
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
    return html;
  }

  /** Fiche détaillée d'une région (clic, spec 2026-10-16 § 6.4) ; null sans bilan RTE. */
  private buildRegionDetailHtml(code: string): string | null {
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
    const s = this.energyRegionStats.get(code);
    if (!s) return null;

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
    return html;
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
    this.rawNewsItems = items;
    this.applyNewsItems();
  }

  /** Articles dessinés : localisés, et hors des événements dessinés quand la couche Événements est allumée. */
  private applyNewsItems(): void {
    const shown = this.eventPointsVisible ? newsOffDrawnEvents(this.rawNewsItems, this.drawnEventIds) : this.rawNewsItems;
    this.newsItems = shown.filter((i) => i.lat != null && i.lon != null);
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
  /**
   * Pastilles Énergie allumées (spec 2026-10-16 § 7) : leurs couches restent vives et les autres s'atténuent, jusqu'à ce que
   * les pastilles changent. Un survol de légende passe devant le temps du survol, puis on revient ici.
   */
  setEnergyFocus(keys: readonly EnergyLayerKey[]): void {
    this.energyFocusKeys = [...keys];
    this.rebuildEnergyFlows();
    this.setLegendHover(null);
  }

  /**
   * Vue générale (19/10/2026) : pastille mise en avant, retenue ici comme les pastilles Énergie, pour qu'un retour à zéro (fin d'un
   * survol de légende, mise en avant Énergie vidée) la rétablisse au lieu de l'effacer.
   */
  setGeneralFocus(keys: readonly string[]): void {
    this.generalFocusKeys = [...keys];
    this.envRevealed = new Set(keys);
    this.applyEnvContext();
    this.setLegendHover(null);
  }

  // ─── Onglet Environnement : « l'anormal d'abord » (20/10/2026, deckgl/env-context.ts) ───
  private envContextOn = false;
  /** Pastilles survolées ou allumées : leur contexte est révélé. */
  private envRevealed = new Set<string>();
  /** Filtre d'origine de chaque calque réglé par le mode (relu une fois, avant le premier changement). */
  private envBaseFilters = new Map<string, maplibregl.FilterSpecification | null>();

  /** Mode actif dans l'onglet Environnement seulement (App) : ailleurs, chaque couche montre tout ce qu'elle a. */
  setEnvContext(on: boolean): void {
    if (on === this.envContextOn) return;
    this.envContextOn = on;
    this.applyEnvContext();
  }

  private applyEnvContext(): void {
    const map = this.map;
    if (!map) return;
    for (const id of Object.keys(ENV_CONTEXT_RULES)) {
      if (!map.getLayer(id)) continue;
      if (!this.envBaseFilters.has(id)) this.envBaseFilters.set(id, (map.getFilter(id) as maplibregl.FilterSpecification | undefined) ?? null);
      map.setFilter(id, envContextFilter(id, this.envBaseFilters.get(id) ?? null, this.envContextOn, this.envRevealed));
    }
    this.setVis(RADAR_2D_LAYER_ID, this.radar2dShown() ? 'visible' : 'none');
    this.setVis(ECHO_TOPS_LAYER_ID, this.echoTopsShown(this._echoTopsEnabled) ? 'visible' : 'none');
    (map.getSource(SRC_SEVESO) as maplibregl.GeoJSONSource | undefined)?.setData(sevesoFeatures(this.sevesoShownSites(), this.sevesoExposed));
  }

  /** Sites Seveso dessinés : tous si la pastille est révélée (ou hors de l'onglet), sinon les seuls sites exposés. */
  private sevesoShownSites(): readonly ExposureAsset[] | null {
    if (!this.sevesoSites || envContextRevealed(SEVESO_CONTEXT_KEY, this.envContextOn, this.envRevealed)) return this.sevesoSites;
    const exposed = new Set((this.sevesoExposed ?? []).map((e) => e.asset.id));
    return this.sevesoSites.filter((s) => exposed.has(s.id));
  }
  /** Pastilles mises en avant hors Énergie (Vue générale : une ; onglet Environnement : cumulables, 20/10/2026). */
  private generalFocusKeys: string[] = [];

  /** Calques d'une catégorie de légende ou d'une pastille (vide : catégorie sans dessin sur la carte). */
  private legendCategoryLayers(categoryId: string): string[] {
    if (categoryId === ENERGY_FOCUS_CATEGORY) {
      return energyFocusLayersOf(this.energyFocusKeys);
    } else if (isEnergyLayerKey(categoryId)) {
      return [...ENERGY_FOCUS_LAYERS[categoryId]];
    } else if (categoryId === 'health') {
      return [LYR_HEALTH_ALERT_FILL, LYR_HEALTH_ALERT_LINE];
    } else if (categoryId === 'healthApl') {
      return [LYR_HEALTH_APL_FILL, LYR_HEALTH_APL_LINE];
    } else if (categoryId === 'healthOscour') {
      return [LYR_HEALTH_URG_FILL, LYR_HEALTH_URG_LINE];
    } else if (categoryId === 'hospitals') {
      return [LYR_HOSPITALS];
    } else if (categoryId === 'outagesElec') {
      return [...OUT_LAYER_KEYS.outagesElec];
    } else if (categoryId === 'outagesTelecom') {
      return [...OUT_LAYER_KEYS.outagesTelecom];
    } else if (categoryId === 'outagesInternet') {
      return [...OUT_LAYER_KEYS.outagesInternet];
    } else if (categoryId === 'outagesCloud') {
      return [...OUT_LAYER_KEYS.outagesCloud];
    } else if (categoryId === 'protests') {
      return [...PROTEST_LAYER_IDS];
    } else if (categoryId === 'crime') {
      return [...CRIME_LAYER_IDS];
    } else if (categoryId === 'webcams') {
      return [...WEBCAM_LAYER_IDS];
    } else if (categoryId === 'envBrief') {
      return [...EXPOSURE_LAYER_IDS];
    } else if (categoryId === 'seveso') {
      return [...SEVESO_LAYER_IDS];
    } else if (categoryId === 'pollens') {
      return [...POLLEN_LAYER_IDS];
    } else if (categoryId === 'pedestrianFlows') {
      return [...FLUX_LAYER_IDS];
    } else if (categoryId === 'trafficRoad') {
      return [LYR_TRAFFIC, ...TRAFFIC_LAYER_KEYS.trafficRoad];
    } else if (categoryId === 'trafficAir') {
      return [...TRAFFIC_LAYER_KEYS.trafficAir];
    } else if (categoryId === 'trafficRail') {
      return [...TRAFFIC_LAYER_KEYS.trafficRail, LYR_TRAIN_ROUTE, LYR_TRAIN_STATIONS];
    } else if (categoryId === 'trafficMaritime') {
      return [...TRAFFIC_LAYER_KEYS.trafficMaritime];
    } else if (categoryId === 'environmental') {
      return [...ENV_LAYER_KEYS.environmental];
    } else if (categoryId === 'floods') {
      return [...ENV_LAYER_KEYS.floods];
    } else if (categoryId === 'weatherRadar') {
      return [...ENV_LAYER_KEYS.weatherRadar, ...ENV_RASTER_LAYERS.weatherRadar];
    } else if (categoryId === 'fires') {
      return [...ENV_LAYER_KEYS.fires, ...FOREST_DANGER_LAYERS, ...ENV_RASTER_LAYERS.fires];
    } else if (categoryId === 'drought' || categoryId === 'airQuality' || categoryId === 'earthquakes' || categoryId === 'disasters') {
      return [...ENV_LAYER_KEYS[categoryId]];
    }
    return [];
  }

  setLegendHover(categoryId: string | null): void {
    if (!this.map) return;
    // Sans survol en cours, la mise en avant des pastilles allumées s'applique (Énergie, sinon la pastille de la Vue générale).
    if (categoryId === null && this.energyFocusKeys.length > 0) categoryId = ENERGY_FOCUS_CATEGORY;
    if (categoryId === null && this.generalFocusKeys.length > 0) categoryId = GENERAL_FOCUS_CATEGORY;
    const previousCategory = this.legendHoverCategory;
    this.legendHoverCategory = categoryId;
    const allLegendLayers = [
      LYR_HEALTH_ALERT_FILL, LYR_HEALTH_ALERT_LINE,
      LYR_HEALTH_URG_FILL, LYR_HEALTH_URG_LINE,
      LYR_HEALTH_APL_FILL, LYR_HEALTH_APL_LINE,
      LYR_HOSPITALS,
      LYR_TRAFFIC, ...Object.values(TRAFFIC_LAYER_KEYS).flat(), LYR_TRAIN_ROUTE, LYR_TRAIN_STATIONS,
      ...Object.values(ENV_LAYER_KEYS).flat(), ...FOREST_DANGER_LAYERS, ...Object.values(ENV_RASTER_LAYERS).flat(),
      // Pannes réseau : les quatre couches (et les maintenances télécoms) s'atténuent avec les autres au survol d'une légende.
      ...Object.values(OUT_LAYER_KEYS).flat(), OUT_MAINTENANCE_LAYER,
      // Énergie (spec 2026-10-16 § 7) : survol d'une pastille, seule sa couche reste vive.
      ...ENERGY_FOCUS_ALL,
      ...PROTEST_LAYER_IDS,
      ...CRIME_LAYER_IDS,
      ...WEBCAM_LAYER_IDS,
      ...FLUX_LAYER_IDS,
      ...EXPOSURE_LAYER_IDS,
      ...SEVESO_LAYER_IDS,
      ...POLLEN_LAYER_IDS,
    ];

    let activeLayers: string[] = [];
    // L'anneau pulsant des catastrophes, animé à part, suit le tamisage de la couche Catastrophes (calculé plus bas).
    if (categoryId === GENERAL_FOCUS_CATEGORY) {
      activeLayers = [...new Set(this.generalFocusKeys.flatMap((k) => this.legendCategoryLayers(k)))];
      // Pastille sans dessin sur la carte (Vigilance cyber : aucun lieu publié) : tout le reste se tamise.
      if (activeLayers.length === 0) activeLayers = ['__aucun-calque__'];
    } else if (categoryId !== null) {
      activeLayers = this.legendCategoryLayers(categoryId);
    }


    // Calques tamisés par la mise en avant : ils ne répondent plus au survol (infobulles des couches ajoutées le 20/10/2026).
    this.dimmedLegendLayers = categoryId === null || activeLayers.length === 0
      ? new Set<string>() : new Set(allLegendLayers.filter((id) => !activeLayers.includes(id)));
    for (const key of Object.keys(PULSE_LAYERS) as PulseKey[]) {
      this.pulseState[key].dim = categoryId !== null && activeLayers.length > 0 && !activeLayers.includes(PULSE_LAYERS[key].base) ? 0.15 : 1;
    }

    const applyLegendDim = (layerId: string, prop: string, orig: unknown): void => {
      if (categoryId === null || activeLayers.length === 0) {
        // Reset to original
        this.map!.setPaintProperty(layerId, prop, orig);
        return;
      }
      const isTarget = activeLayers.includes(layerId);
      // Couche mise en avant à 100 %, les autres tamisées.
      // Courbe sur le zoom atténuée palier par palier (MapLibre refuse « * » autour du zoom), le reste multiplié.
      // Zones inondables : un fond sous les tronçons, gardé translucide même mis en avant (sinon il couvrait la carte).
      const boost = isTarget && layerId !== LYR_FLOOD_ZONES;
      this.map!.setPaintProperty(layerId, prop, boost ? fullOpacity(orig) : isTarget ? orig : dimOpacity(orig, 0.15));
    };

    allLegendLayers.forEach(layerId => {
      const layer = this.map!.getLayer(layerId);
      if (!layer) return;

      if (!this.originalOpacities.has(layerId)) {
        let prop = 'fill-opacity';
        if (layer.type === 'line') prop = 'line-opacity';
        if (layer.type === 'circle') prop = 'circle-opacity';
        if (layer.type === 'symbol') {
          // getLayoutProperty, pas getLayer().layout (objet interne sans les propriétés) : sinon une couche de pictos était
          // tamisée sur son texte et gardait ses icônes vives (pictos de vigilance, 20/10/2026).
          prop = this.map!.getLayoutProperty(layerId, 'icon-image') ? 'icon-opacity' : 'text-opacity';
        }
        if (layer.type === 'heatmap') prop = 'heatmap-opacity';
        if (layer.type === 'raster') prop = 'raster-opacity';

        const orig = this.map!.getPaintProperty(layerId, prop) ?? 1;
        this.originalOpacities.set(layerId, { prop, orig });
      }

      const { prop, orig } = this.originalOpacities.get(layerId)!;
      applyLegendDim(layerId, prop, orig);
      // Pictos avec étiquette : le texte se tamise avec l'icône.
      if (layer.type === 'symbol' && prop === 'icon-opacity' && this.map!.getLayoutProperty(layerId, 'text-field')) {
        const textKey = `${layerId}::text`;
        if (!this.originalOpacities.has(textKey)) {
          this.originalOpacities.set(textKey, { prop: 'text-opacity', orig: this.map!.getPaintProperty(layerId, 'text-opacity') ?? 1 });
        }
        const text = this.originalOpacities.get(textKey)!;
        applyLegendDim(layerId, text.prop, text.orig);
      }
    });

    // Contours colorés des Trafics (anneau des signalements AIS, aéroports, mouillages, urgences, arrêts du trajet d'un train) :
    // atténués avec leur couche, en plus du remplissage.
    // Toutes les couches de points de la légende aussi : un cercle sans remplissage (stations Vigicrues, en hausse ou en baisse)
    // restait vif sinon.
    for (const layerId of new Set([...TRAFFIC_STROKE_DIM_LAYERS, ...ENERGY_FOCUS_ALL, ...allLegendLayers])) {
      if (!this.map.getLayer(layerId) || this.map.getLayer(layerId)?.type !== 'circle') continue;
      const key = `${layerId}::stroke`;
      if (!this.originalOpacities.has(key)) {
        this.originalOpacities.set(key, { prop: 'circle-stroke-opacity', orig: this.map.getPaintProperty(layerId, 'circle-stroke-opacity') ?? 1 });
      }
      const { prop, orig } = this.originalOpacities.get(key)!;
      applyLegendDim(layerId, prop, orig);
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
  setOnItemClick(h: (item: NewsItem, point?: { x: number; y: number }) => void): void { this.onItemClick = h; }
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

  /** Cadrage « France » accroché (bouton) : recalculé tant que la carte n'a pas été déplacée à la main. */
  private franceFitSticky = false;
  private franceFitObserver: ResizeObserver | null = null;
  private franceFitLast = '';
  private franceFitFrame: number | null = null;

  /** Marges du recadrage : partie de la carte à l'écran, privée de ce qui la recouvre. */
  private franceFitPadding(r: DOMRect): { top: number; right: number; bottom: number; left: number } {
    return visibleFitPadding({ left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }, this.mapOverlays());
  }

  /** Éléments posés sur la carte, mesurés pour les marges du recadrage (petits contrôles exclus). */
  private mapOverlays(): Rect[] {
    // Boutons du bas à droite (zoom, boussole, ce bouton) compris, la Corse passait dessous ; pas les crédits, trop larges.
    const sel = ['.floating-panel-switcher', '#energy-focus-key', '#general-focus-key', '#mqs-focus-key', '#mqh-focus-key', '.lp.is-open', '.map-key',
      '.maplibregl-ctrl-bottom-right .maplibregl-ctrl-group'];
    const out: Rect[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(sel.join(','))) {
      if (el.hidden || el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
    return out;
  }

  /**
   * Métropole et Corse dans la partie visible de la carte (marges = barre des pastilles, panneau ouvert, légendes), vue à plat
   * et nord en haut. Le cadrage reste accroché : taille de la fenêtre ou panneaux qui changent le recalculent (refitFrance).
   */
  fitFrance(animate = true): void {
    if (!this.map) return;
    const r = this.container.getBoundingClientRect();
    const padding = this.franceFitPadding(r);
    this.franceFitSticky = true;
    this.franceFitLast = `${Math.round(r.width)}x${Math.round(r.height)}|${padding.top},${padding.right},${padding.bottom},${padding.left}`;
    const [w, s, e, n] = FRANCE_METRO_BOUNDS;
    this.map.fitBounds([[w, s], [e, n]], { padding, bearing: 0, pitch: 0, duration: animate ? 900 : 0, essential: true });
  }

  /**
   * Recadrage accroché : refait si la carte ou ce qui la recouvre a changé. Vérifié à l'image suivante puis 400 ms plus tard
   * (un panneau qui s'ouvre termine son animation après coup).
   */
  refitFrance(): void {
    if (!this.franceFitSticky) return;
    const check = (): void => {
      if (!this.franceFitSticky || !this.map) return;
      const r = this.container.getBoundingClientRect();
      const padding = this.franceFitPadding(r);
      const key = `${Math.round(r.width)}x${Math.round(r.height)}|${padding.top},${padding.right},${padding.bottom},${padding.left}`;
      if (key !== this.franceFitLast) this.fitFrance(false);
    };
    if (this.franceFitFrame === null) {
      this.franceFitFrame = requestAnimationFrame(() => {
        this.franceFitFrame = null;
        check();
      });
    }
    if (this.franceFitTimer !== null) clearTimeout(this.franceFitTimer);
    this.franceFitTimer = setTimeout(() => {
      this.franceFitTimer = null;
      check();
    }, 400);
  }
  private franceFitTimer: ReturnType<typeof setTimeout> | null = null;

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

        // Create arc features (curved lines from France center to border)
        // Electric flow: OSINT style with configurable colors
        const cfg = getElectricFlowConfig();

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

          return {
            type: 'Feature' as const,
            geometry: { type: 'LineString' as const, coordinates: arcCoords },
            properties: {
              color,
              glowColor,
              lineWidth,
              glowWidth,
              isImport,
              country: ic.country,
              // Valeur propre à chaque pays, reprise par la flèche et sa bulle (spec 2026-10-16 § 4).
              flowValue: flowAbs,
              flowUnit: 'MW',
            }
          };
        });

        this.lastFlowArcs.elec = arcFeatures;
        this.flowArcsVersion += 1;
        const powerImports = arcFeatures.filter((a) => a.properties?.isImport === true).length;
        this.recordEnergyFlows('powerGrid', { exports: arcFeatures.length - powerImports, imports: powerImports });
      } else {
        this.lastFlowArcs.elec = [];
        this.flowArcsVersion += 1;
        this.recordEnergyFlows('powerGrid', { exports: 0, imports: 0 });
      }
      this.rebuildEnergyFlows();
    } catch (e) {
      console.warn('[DeckGLMap] Failed to load regions for energy layer', e);
    }
  }

  /** Flèches d'échange des couches allumées (spec 2026-10-16 § 4) ; l'animation tourne tant qu'une flèche est affichée. */
  private rebuildEnergyFlows(): void {
    if (!this.map) return;
    // Couches allumées ; si des pastilles Énergie sont allumées, seulement leurs filières (« Réseau électrique » : électricité).
    const kinds = flowKindsShown(this.currentLayers ?? {}, this.energyFocusKeys);
    const sig = `${this.flowArcsVersion}:${kinds.join(',')}`;
    if (sig === this.energyFlowSig) return;
    this.energyFlowSig = sig;
    const arcs = kinds
      .flatMap((k) => this.lastFlowArcs[k].map((f) => flowArcFromFeature(k, f)))
      .filter((a): a is FlowArc => a !== null);
    const fc = buildFlowFeatures(arcs);
    const put = (id: string, data: GeoJSON.FeatureCollection): void => {
      (this.map?.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(data);
    };
    put(SRC_ENERGY_FLOWS, fc.lines);
    put(SRC_ENERGY_FLOW_HEADS, fc.heads);
    put(SRC_ENERGY_FLOW_LABELS, fc.labels);
    put(SRC_ENERGY_CHOKES, fc.chokes);
    if (fc.lines.features.length > 0) this.startEnergyFlowAnimation();
    else this.stopEnergyFlowAnimation();
  }

  /** Une seule minuterie : les tirets avancent d'un cran toutes les 70 ms (14 motifs fixes, l'atlas des tirets reste borné). */
  private startEnergyFlowAnimation(): void {
    if (this.energyFlowTimer !== null) return;
    this.energyFlowTimer = setInterval(() => {
      const map = this.map;
      if (!map?.getLayer(LYR_ENERGY_FLOW_ANIM) || map.getLayoutProperty(LYR_ENERGY_FLOW_ANIM, 'visibility') === 'none') return;
      this.energyFlowStep = (this.energyFlowStep + 1) % ENERGY_FLOW_DASH_SEQ.length;
      map.setPaintProperty(LYR_ENERGY_FLOW_ANIM, 'line-dasharray', ENERGY_FLOW_DASH_SEQ[this.energyFlowStep]);
    }, 70);
  }

  private stopEnergyFlowAnimation(): void {
    if (this.energyFlowTimer === null) return;
    clearInterval(this.energyFlowTimer);
    this.energyFlowTimer = null;
  }

  /** Pointe des flèches : triangle blanc SDF 64×64, pointe en haut, teinté par flux. */
  private async createFlowHeadIcon(): Promise<void> {
    if (!this.map || this.map.hasImage(ENERGY_FLOW_HEAD_ICON)) return;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><polygon points="32,6 58,56 6,56" fill="white"/></svg>';
    return new Promise<void>((resolve) => {
      const img = new Image(64, 64);
      img.onload = () => {
        if (this.map && !this.map.hasImage(ENERGY_FLOW_HEAD_ICON)) this.map.addImage(ENERGY_FLOW_HEAD_ICON, img, { sdf: true, pixelRatio: 2 });
        resolve();
      };
      img.onerror = () => resolve();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  /** Imports de pétrole qui arrivent à moins de 30 km d'un dépôt (son port) et raffineries voisines. */
  private oilDepotContext(at: readonly [number, number] | undefined): {
    imports: Array<{ who: string; value: number | null; unit: string }>; refineries: string[];
  } {
    if (!at) return { imports: [], refineries: [] };
    const here: [number, number] = [at[0], at[1]];
    const near = (c: readonly number[] | undefined): boolean => c !== undefined && kmBetween(here, [c[0], c[1]]) < 30;
    const imports = this.lastFlowArcs.petrole.flatMap((f) => {
      const a = flowArcFromFeature('petrole', f);
      if (!a || !a.isImport || !near(a.coordinates[a.coordinates.length - 1])) return [];
      return [{ who: a.country || a.name, value: a.flowValue, unit: a.flowUnit }];
    });
    const refineries = OIL_REFINERIES.filter((r) => near(r.location)).map((r) => r.name);
    return { imports, refineries };
  }

  /** Fiche détaillée d'une flèche d'échange : reprend les fiches existantes, à partir de l'arc d'origine (spec 2026-10-16 § 6.4). */
  private energyFlowDetailHtml(p: Readonly<Record<string, unknown>>): string | null {
    const who = String(p.who ?? '');
    if (p.kind === 'elec') return this.buildInterconnDetailHtml(who);
    const list = p.kind === 'gaz' ? this.lastFlowArcs.gaz : p.kind === 'petrole' ? this.lastFlowArcs.petrole : [];
    const arc = list.find((f) => (String(f.properties?.country ?? '') || String(f.properties?.name ?? '')) === who)?.properties;
    if (!arc) return null;
    if (p.kind === 'gaz') {
      const stats = this.gasFlowStats.get(String(arc.borderCode ?? ''));
      return stats ? this.buildGasFlowTooltipHtml(stats) : this.buildGasPirHoverHtml(arc);
    }
    return tooltipCardHtml(oilFlowDetailCard(arc));
  }

  /** Fiche détaillée d'une interconnexion électrique (clic sur une flèche, spec 2026-10-16 § 6.4) ; null sans statistiques. */
  private buildInterconnDetailHtml(country: string): string | null {
    const flowId = DeckGLMap.COUNTRY_TO_FLOW_ID[country];
    const f = flowId ? this.energyFlowStats.get(flowId) : undefined;
    if (!f) return null;
    const FLOW_COLORS: Record<string, string> = { export: '#34c759', import: '#ff3b30', balanced: '#8e8e93' };
    const FLOW_LABELS: Record<string, string> = { export: `Export ${fmIcon('trending-up')}`, import: `Import ${fmIcon('trending-down')}`, balanced: `Équilibré ${fmIcon('arrow-left-right')}` };
    const utilizationBar = (pct: number, color: string) =>
      `<div style="height:4px;background:rgba(255,255,255,0.1);border-radius:2px;margin-top:4px;overflow:hidden;">` +
      `<div style="width:${Math.min(pct, 100).toFixed(0)}%;height:100%;background:${color};border-radius:2px;"></div></div>`;
    const fmtMWh = (mwh: number) =>
      Math.abs(mwh) >= 1000 ? `${(mwh / 1000).toFixed(2)} TWh` : `${Math.round(mwh)} MWh`;
    const row = (label: string, value: string, valueColor = '#e8e8ec') =>
      `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;padding:2px 0;">` +
      `<span style="color:#9898a8;">${label}</span>` +
      `<span style="color:${valueColor};font-weight:500;">${value}</span></div>`;
    const sep = `<div style="border-top:1px solid rgba(255,255,255,0.08);margin:6px 0;"></div>`;
    const sectionLabel = (txt: string) =>
      `<div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#666;margin-bottom:3px;">${txt}</div>`;

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
    return html;
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

  /** Triangle SDF icon pour les raffineries (▲ actif, ▼ maintenance via icon-rotate). */
  /** Carré (gaz) et losange (hydraulique) en SDF, teintés par la couleur d'état. */
  private async createEnergyShapeIcons(): Promise<void> {
    if (!this.map) return;
    const size = ENV_ICON_SIZE;
    const load = (id: string, svg: string): Promise<void> => new Promise<void>((resolve) => {
      if (!this.map || this.map.hasImage(id)) { resolve(); return; }
      const img = new Image(size, size);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx && this.map && !this.map.hasImage(id)) {
          ctx.drawImage(img, 0, 0, size, size);
          // Vrai champ de distance (comme les pictos) : bords nets et contour `icon-halo` visible.
          const pixels = ctx.getImageData(0, 0, size, size);
          const sdf = alphaToSdf(pixels.data, size);
          for (let i = 0; i < sdf.length; i += 1) {
            pixels.data[i * 4] = 255;
            pixels.data[i * 4 + 1] = 255;
            pixels.data[i * 4 + 2] = 255;
            pixels.data[i * 4 + 3] = sdf[i] ?? 0;
          }
          this.map.addImage(id, pixels, { sdf: true, pixelRatio: 2 });
        }
        resolve();
      };
      img.onerror = () => { console.warn(`[DeckGLMap] Forme ${id} non chargée`); resolve(); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
    await Promise.all([
      load(ENERGY_SHAPE_SQUARE, shapeIconSvg('square', size)),
      load(ENERGY_SHAPE_DIAMOND, shapeIconSvg('diamond', size)),
    ]);
  }

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
            energyState: 'nonSuivi',
          },
        });
      }

      // Storages (color-coded circles by fill level)
      for (const storage of state.storages) {
        // Couleur = état du remplissage ; le contour de tendance (déduite de la saison) est retiré (spec 2026-10-15).
        const { energyState, color: fillColor } = gasStorageStyle(storage.fillMeasured === true ? storage.fillLevel : null);

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
            energyState,
            trend: storage.fillTrend,
          },
        });
      }

      const vitalsSource = this.map.getSource(SRC_GAS_VITALS) as maplibregl.GeoJSONSource;
      vitalsSource?.setData({ type: 'FeatureCollection', features: pointFeatures });
      const biomethane = (this.energyEntries.get('gasNetwork') ?? []).filter((x) => x.id.startsWith('biomethane:'));
      this.recordEnergy('gasNetwork', [...energyEntriesFrom(pointFeatures, 'gaz', 'gas'), ...biomethane]);

      // === Build PIR flow arcs ===
      // Gas flow: Cyan/turquoise with softer glow, rapid dash animation
      const FRANCE_CENTER_GAS: [number, number] = [2.5, 46.5];
      const pirArcFeatures: GeoJSON.Feature[] = [];
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

      const gasFlowCount = { exports: 0, imports: 0 };
      for (const pir of state.interconnections) {
        if (Math.abs(pir.flowGWhDay) < 1) continue; // Skip negligible flows

        const isImport = pir.flowGWhDay > 0;
        if (isImport) gasFlowCount.imports += 1; else gasFlowCount.exports += 1;
        const flowAbs = Math.abs(pir.flowGWhDay);
        // Gas flow colors: Cyan (import) / Teal (export) - visually distinct from electric blue
        const color = isImport ? GAS_FLOW_STYLE.importColor : GAS_FLOW_STYLE.exportColor;
        const glowColor = isImport ? GAS_FLOW_STYLE.glowImportColor : GAS_FLOW_STYLE.glowExportColor;
        // Thinner lines than electricity (gas flows in pipelines)
        const lineWidth = Math.min(maxLineWidth, Math.max(minLineWidth, minLineWidth + flowAbs / lineWidthDivisor));
        const glowWidth = lineWidth * glowMultiplier;

        // Arc from/to France center with gas-specific curvature
        const arcCoords = isImport
          ? generateArc(pir.coordinates, FRANCE_CENTER_GAS, curvature, steps)
          : generateArc(FRANCE_CENTER_GAS, pir.coordinates, curvature, steps);

        pirArcFeatures.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: arcCoords },
          properties: {
            color, glowColor, lineWidth, glowWidth, isImport, country: pir.country, borderCode: pir.id, flowValue: flowAbs, flowUnit: 'GWh/j',
          },
        });

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

      this.recordEnergyFlows('gasNetwork', gasFlowCount);

      this.lastFlowArcs.gaz = pirArcFeatures;
      this.flowArcsVersion += 1;
      this.rebuildEnergyFlows();

      console.log(`[DeckGLMap/Gas] Updated: ${state.terminals.length} terminals, ${state.storages.length} storages, ${pirArcFeatures.length} PIR flows`);
    } catch (e) {
      console.warn('[DeckGLMap/Gas] Update failed:', e);
    }
  }

  /** Sans effet depuis la spec 2026-10-16 § 5 : les gazoducs suivent la couche Gaz. Gardé pour MapContainer. */
  setGasPipelineVisible(_show: boolean): void {
    // Rien : les gazoducs s'affichent avec la couche Gaz.
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
        id: `biomethane:${s.id}`,
        name: s.name,
        commune: s.commune ?? '',
        department: s.department ?? '',
        region: s.region ?? '',
        operator: s.operator ?? '',
        capacityGwh: s.capacityGwhYear ?? 0,
        status: s.status,
        energyState: 'nonSuivi',
      },
    }));

    src.setData({ type: 'FeatureCollection', features });
    // Biométhane : compté avec la couche Gaz, à côté des stockages et terminaux (spec 2026-10-15).
    const vitals = (this.energyEntries.get('gasNetwork') ?? []).filter((x) => !x.id.startsWith('biomethane:'));
    this.recordEnergy('gasNetwork', [...vitals, ...energyEntriesFrom(features, 'gaz', 'biomethane')]);
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
    originPeriodLabel?: string;
    originLastMonth?: { label: string; volumeMt: number; sharePct: number };
    originPartialBreakdown?: boolean;
    originBreakdown?: Array<{ label: string; volumeMt: number; sharePct: number }>;
  }>): Promise<void> {
    if (!this.map) return;

    try {
      const FRANCE_CENTER_OIL: [number, number] = [2.5, 46.5];
      const oilArcFeatures: GeoJSON.Feature[] = [];

      const { minLineWidth, maxLineWidth, lineWidthDivisor, glowMultiplier, curvature, steps } = OIL_FLOW_STYLE;

      const oilFlowCount = { exports: 0, imports: 0 };
      for (const flow of flows) {
        if (Math.abs(flow.flowKbd) < 1) continue; // Skip negligible flows

        const isImport = flow.flowKbd > 0;
        if (isImport) oilFlowCount.imports += 1; else oilFlowCount.exports += 1;
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
        // Thicker lines than gas (viscous flow)
        const lineWidth = Math.min(maxLineWidth, Math.max(minLineWidth, minLineWidth + flowAbs / lineWidthDivisor));
        const glowWidth = lineWidth * glowMultiplier;

        // Arc from/to French hub with oil-specific curvature
        const arcCoords = isImport
          ? generateArc(flow.coordinates, franceTarget, curvature, steps)
          : generateArc(franceTarget, flow.coordinates, curvature, steps);

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
            originPeriodLabel: flow.originPeriodLabel ?? '',
            originLastMonthLabel: flow.originLastMonth?.label ?? '',
            originLastMonthMt: flow.originLastMonth?.volumeMt ?? null,
            originLastMonthPct: flow.originLastMonth?.sharePct ?? null,
            originPartialBreakdown: flow.originPartialBreakdown ? 1 : 0,
            originBreakdown,
            flowValue: flowAbs,
            flowUnit: 'kb/j',
          },
        });
      }
      this.recordEnergyFlows('oilNetwork', oilFlowCount);

      this.lastFlowArcs.petrole = oilArcFeatures;
      this.flowArcsVersion += 1;
      this.rebuildEnergyFlows();

      console.log(`[DeckGLMap/Oil] Updated: ${oilArcFeatures.length} oil flow arcs`);
    } catch (e) {
      console.warn('[DeckGLMap/Oil] Update failed:', e);
    }
  }

  /**
   * Update oil infrastructure on the map (refineries, depots, pipelines).
   * Renders points for refineries/depots with color based on vigilance status.
   */
  async updateOilInfrastructure(data: OilDashboard): Promise<void> {
    if (!this.map) return;

    try {

      // Raffineries : triangles à la couleur de l'état déclaré (spec 2026-10-15)
      const refineryFeatures: GeoJSON.Feature[] = data.refineries.map(r => {
        // Couleur = état (spec 2026-10-15) : statut déclaré dans la configuration, non mesuré ;
        // active = sans état suivi, maintenance ou arrêt = hors service.
        const energyState = refineryState(r.status);
        const fillColor = ENERGY_STATE_HEX[energyState];
        const strokeColor = '#0a0a12';
        const strokeWidth = 1.5;

        // Taille proportionnelle à la capacité — utilisée pour l'icône triangle
        const cap = r.capacityMtPerYear ?? 8;
        const sizeScale = Math.max(0.9, Math.min(1.5, 0.65 + cap * 0.055));
        // Radius du glow (gardé pour la couche circle glow)
        const baseRadius = Math.max(6, Math.min(20, 3 + cap * 0.9));
        // Forme = filière : le triangle ne se retourne plus, l'état est dans la couleur.
        const iconRotation = 0;

        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: r.location },
          properties: {
            id: r.id,
            name: r.name,
            operator: r.operator ?? '',
            capacity: cap,
            status: r.status,
            energyState,
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
        // Dépôts : inventaire sans état suivi, gris clair ; le rôle se lit à la taille et au disque central.
        const fillColor = ENERGY_STATE_HEX.nonSuivi;
        const strokeColor = '#0a0a12';
        const strokeWidth = 1;
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
            capacityM3: d.capacityM3 ?? null,
            operator: d.operator ?? '',
            energyState: 'nonSuivi',
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
      this.recordEnergy('oilNetwork', [
        ...energyEntriesFrom(refineryFeatures, 'petrole', 'refinery'),
        ...energyEntriesFrom(depotFeatures, 'petrole', 'depot'),
      ]);

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
      this.recordFuelTension([]);
      this.clearFuelTensionHoverState();
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
        // Contour à la couleur du niveau (palette de vigilance, spec 2026-10-15).
        const lineColor = fillColor;
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
      this.recordFuelTension(geojson.features.flatMap((feature) => {
        const summary = summariesByCode.get(String(feature.properties?.code ?? ''));
        return summary ? [fuelTensionVigilance(summary.tensionLevel)] : [];
      }));
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
    });
    this.hospitalPopup = popup;
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
      this.setHealthPointer(topHealthHit(visible.length > 0 ? map.queryRenderedFeatures(e.point, { layers: visible }) : [])?.layer.id === LYR_HOSPITALS);
    });
    // Bulle au clic ; un clic sur un hôpital ouvre sa fiche à la place.
    map.on('click', (e) => {
      const visible = HEALTH_HOVER_LAYERS.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
      const hit = topHealthHit(visible.length > 0 ? map.queryRenderedFeatures(e.point, { layers: visible }) : []);
      const onSite = hit?.layer.id === LYR_HOSPITALS;
      const html = hit && !onSite ? healthTooltipHtml(hit.layer.id, hit.properties ?? {}, this.healthMapData()) : null;
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
    map.on('mouseout', () => this.setHealthPointer(false));
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

  /**
   * v2 : pression par département (12/10/2026) sur la même source que l'ISNR. Seuls les départements jaunes ou plus sont
   * colorés, à la couleur de leur niveau ; les autres restent transparents (couche vide quand tout va bien).
   */
  async updateDepartmentPressure(levels: ReadonlyMap<string, import('../services/vigilance.ts').VigilanceLevel>): Promise<void> {
    if (!this.map) return;
    if (!this.currentLayers?.stability) {
      this._pendingPressure = levels;
      return;
    }
    this._pendingPressure = null;
    try {
      const baseGeojson = await this.getDepartmentsGeojson();
      if (!baseGeojson || !this.map) return;
      const geojson = this.cloneDepartmentsGeojson(baseGeojson);
      for (const feat of geojson.features) {
        const code = (feat.properties?.code as string) ?? '';
        feat.id = deptCodeToId(code);
        const level = levels.get(code);
        const color = level && level !== 'vert' ? levelHex(level) : null;
        feat.properties = { ...feat.properties, fillColor: color ?? 'rgba(0, 0, 0, 0)', lineColor: color ?? 'rgba(0, 0, 0, 0)' };
      }
      (this.map.getSource(SRC_ISNR) as maplibregl.GeoJSONSource | undefined)?.setData(geojson);
    } catch (e) {
      console.warn('[DeckGLMap] Failed to load depts for pressure layer', e);
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
    });
    map.on('click', (e) => {
      const visible = TRAFFIC_HOVER_LAYERS.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
      const hit = topTrafficHit(visible.length > 0 ? map.queryRenderedFeatures(e.point, { layers: visible }) : []);
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
    map.on('mouseout', () => this.setTrafficPointer(false));
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

  private _highlightedFloodSegmentId: string | null = null;
  private floodChip: HTMLElement | null = null;

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

  /** Catastrophes (GDACS) : points par niveau, territoire français en couleur, monde en gris. */
  updateDisastersLayer(d: DisastersResponse | null, now: number): void {
    this.disastersData = d;
    if (!this.map) return;
    (this.map.getSource(SRC_DISASTERS) as maplibregl.GeoJSONSource | undefined)?.setData(disasterFeatures(d, now));
    this.hideEnvironmentHover();
    this.syncPulses();
  }

  // ─── Anneaux pulsants : catastrophes en cours, séismes récents en France (20/10/2026, pulse.ts) ───
  private pulseFrame: number | null = null;
  private pulseLast = 0;
  /** Couche affichée (dernière consigne de setLayerVisibility) et facteur de tamisage (1 vive, 0,15 tamisée par une autre pastille). */
  private pulseState: Record<PulseKey, { shown: boolean; dim: number }> = {
    disasters: { shown: false, dim: 1 }, earthquakes: { shown: false, dim: 1 }, telecomOutage: { shown: false, dim: 1 }, powerOutage: { shown: false, dim: 1 },
  };

  /** Anneaux visibles et animés tant que leur couche l'est (jamais si le système demande moins d'animations). */
  private syncPulses(): void {
    if (!this.map || typeof requestAnimationFrame !== 'function') return;
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let any = false;
    for (const key of Object.keys(PULSE_LAYERS) as PulseKey[]) {
      const { pulse } = PULSE_LAYERS[key];
      if (!this.map.getLayer(pulse)) continue;
      const on = !reduced && this.pulseState[key].shown;
      this.setVis(pulse, on ? 'visible' : 'none');
      any ||= on;
    }
    if (!any) {
      if (this.pulseFrame !== null) cancelAnimationFrame(this.pulseFrame);
      this.pulseFrame = null;
      return;
    }
    if (this.pulseFrame !== null) return;
    const step = (ts: number): void => {
      if (!this.map) return;
      // 30 images par seconde suffisent à un anneau qui s'élargit.
      if (ts - this.pulseLast >= 33) {
        this.pulseLast = ts;
        const t = Date.now();
        for (const key of Object.keys(PULSE_LAYERS) as PulseKey[]) {
          const st = this.pulseState[key];
          if (!st.shown || !this.map.getLayer(PULSE_LAYERS[key].pulse)) continue;
          const paint = pulsePaint(t, st.dim);
          this.map.setPaintProperty(PULSE_LAYERS[key].pulse, 'circle-radius', paint.radius as maplibregl.ExpressionSpecification);
          this.map.setPaintProperty(PULSE_LAYERS[key].pulse, 'circle-stroke-opacity', paint.opacity as maplibregl.ExpressionSpecification);
        }
      }
      this.pulseFrame = requestAnimationFrame(step);
    };
    this.pulseFrame = requestAnimationFrame(step);
  }

  // ─── Control room des pannes (onglet Pannes, 21/10/2026) : départements touchés ───
  /** Départements touchés (propriété `level`) ; `null` : calque retiré (sortie de l'onglet). */
  setOutagesRoom(state: { depts: GeoJSON.FeatureCollection; services?: GeoJSON.FeatureCollection } | null): void {
    const map = this.map;
    if (!map) return;
    if (state === null) {
      for (const id of [LYR_ROOM_SERVICES_LETTER, LYR_ROOM_SERVICES, LYR_ROOM_DEPT_FILL]) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of [SRC_ROOM_SERVICES, SRC_ROOM_DEPTS]) if (map.getSource(id)) map.removeSource(id);
      return;
    }
    // Services publics exposés : disque gris sobre, lettre du type, cerclé à la couleur de la panne (au-dessus des départements).
    const services = state.services ?? { type: 'FeatureCollection', features: [] };
    const servicesSrc = map.getSource(SRC_ROOM_SERVICES) as maplibregl.GeoJSONSource | undefined;
    if (servicesSrc) servicesSrc.setData(services);
    else map.addSource(SRC_ROOM_SERVICES, { type: 'geojson', data: services });
    if (!map.getLayer(LYR_ROOM_SERVICES)) {
      map.addLayer({
        id: LYR_ROOM_SERVICES, type: 'circle', source: SRC_ROOM_SERVICES,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 5, 10, 8], 'circle-color': '#3a3f4b',
          'circle-stroke-width': 1.8, 'circle-stroke-color': ['match', ['get', 'level'], 'jaune', levelHex('jaune'), 'orange', levelHex('orange'), levelHex('rouge')],
        },
      });
      map.addLayer({
        id: LYR_ROOM_SERVICES_LETTER, type: 'symbol', source: SRC_ROOM_SERVICES,
        layout: { 'text-field': ['get', 'letter'], 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 7, 10, 10], 'text-font': ['Open Sans Bold'], 'text-allow-overlap': true },
        paint: { 'text-color': '#e8e8ec' },
      });
    }
    const depts = map.getSource(SRC_ROOM_DEPTS) as maplibregl.GeoJSONSource | undefined;
    if (depts) depts.setData(state.depts);
    else map.addSource(SRC_ROOM_DEPTS, { type: 'geojson', data: state.depts });
    if (!map.getLayer(LYR_ROOM_DEPT_FILL)) {
      map.addLayer({
        id: LYR_ROOM_DEPT_FILL, type: 'fill', source: SRC_ROOM_DEPTS,
        paint: { 'fill-color': ['match', ['get', 'level'], 'jaune', levelHex('jaune'), 'orange', levelHex('orange'), levelHex('rouge')], 'fill-opacity': 0.3 },
      }, map.getLayer(LYR_ROOM_SERVICES) ? LYR_ROOM_SERVICES : undefined);
    }
    // L'anti-flash (addLayer patché à l'init) masque toute couche ajoutée : la salle montre les siennes tant qu'elle est montée.
    for (const id of [LYR_ROOM_DEPT_FILL, LYR_ROOM_SERVICES, LYR_ROOM_SERVICES_LETTER]) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
  }

  /** Catastrophes : zones Copernicus EMS des activations françaises en cours (contour violet). */
  updateEmsLayer(e: EmsResponse | null, now: number): void {
    this.emsData = e;
    if (!this.map) return;
    (this.map.getSource(SRC_EMS_ZONES) as maplibregl.GeoJSONSource | undefined)?.setData(emsZoneFeatures(e, now));
    this.hideEnvironmentHover();
  }

  /** Parc nucléaire : anneaux des avis de sûreté ASNR (spec 2026-10-13). */
  updateAsnrLayer(r: AsnrResponse | null, now: number): void {
    this.asnrData = r;
    if (!this.map) return;
    (this.map.getSource(SRC_ASNR_RINGS) as maplibregl.GeoJSONSource | undefined)?.setData(asnrRingFeatures(r, now));
  }

  /** Marégraphes SHOM (couche Vigilance météo) : anneau de la couleur du domaine littoral du jour. */
  updateSeaLevelsLayer(s: SeaLevelsResponse | null, v: VigilanceResponse | null, now: number): void {
    this.envB.seaLevels = s;
    this.envB.vigilance = v;
    if (!this.map) return;
    (this.map.getSource(SRC_TIDE_GAUGES) as maplibregl.GeoJSONSource | undefined)?.setData(tideGaugeFeatures(s, v, now));
    this.hideEnvironmentHover();
  }

  /** Tronçon mis en avant (null : aucun). */
  highlightedFloodSection(): string | null {
    return this._highlightedFloodSegmentId;
  }

  /** Échap : sortie de la sélection d'un tronçon (hors saisie). */
  private readonly onFloodSelectionKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || this._highlightedFloodSegmentId === null) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    this.highlightFloodSection(null);
  };

  /**
   * Étiquette de sélection en bas de la carte : « ● Vistre · orange ✕ ». Le nom recentre, la croix désélectionne. Retirée sans sélection.
   */
  private renderFloodSelectionChip(section: FloodSection | null): void {
    this.floodChip?.remove();
    this.floodChip = null;
    if (typeof document === 'undefined') return;
    document.removeEventListener('keydown', this.onFloodSelectionKeydown);
    if (!section) return;
    const level = OFFICIAL_SECTION_LEVEL[section.level];
    const chip = document.createElement('div');
    chip.className = 'flood-select-chip';
    chip.setAttribute('role', 'status');
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'flood-select-name';
    name.title = 'Recentrer la carte sur ce tronçon';
    name.innerHTML = `<i style="background:${levelHex(level)}"></i>${escapeHtml(section.name)}<span>${escapeHtml(level)}</span>`;
    name.addEventListener('click', () => this.focusFloodSection(section.id));
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'flood-select-close';
    close.title = 'Désélectionner (Échap)';
    close.setAttribute('aria-label', 'Désélectionner le tronçon');
    close.textContent = '\u00d7';
    close.addEventListener('click', () => this.highlightFloodSection(null));
    chip.append(name, close);
    this.container.appendChild(chip);
    this.floodChip = chip;
    document.addEventListener('keydown', this.onFloodSelectionKeydown);
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
      this.renderFloodSelectionChip(null);
      return;
    }
    highlightSrc?.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: section.path }, properties: { id: section.id } }],
    });
    this._highlightedFloodSegmentId = section.id;
    this.setVis(LYR_FLOODS_HIGHLIGHT, envLayerOn(this.currentLayers ?? {}, 'floods') ? 'visible' : 'none');
    this.renderFloodSelectionChip(section);
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
    if (envLayerOn(layers, 'disasters') && !envLayerOn(was, 'disasters') && this.disastersData) {
      (this.map.getSource(SRC_DISASTERS) as maplibregl.GeoJSONSource | undefined)?.setData(disasterFeatures(this.disastersData, Date.now()));
    }
    if (envLayerOn(layers, 'disasters') && !envLayerOn(was, 'disasters') && this.emsData) {
      (this.map.getSource(SRC_EMS_ZONES) as maplibregl.GeoJSONSource | undefined)?.setData(emsZoneFeatures(this.emsData, Date.now()));
    }
    // Parc nucléaire réaffiché : anneaux ASNR recolorés avec l'horloge courante (orange 7 jours, gris 30 jours).
    if (layers.nuclearFleet && !before?.nuclearFleet && this.asnrData) {
      (this.map.getSource(SRC_ASNR_RINGS) as maplibregl.GeoJSONSource | undefined)?.setData(asnrRingFeatures(this.asnrData, Date.now()));
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
      // Même règle pour le remplissage des départements en anomalie Internet (le contour reste cliquable).
      ...ENV_HOVER_LAYERS.filter((id) => id !== LYR_WEATHER_FILL && id !== LYR_FOREST_DANGER_FILL && id !== LYR_DROUGHT_FILL && id !== LYR_AIR_FILL), LYR_WEATHER_ICONS,
      LYR_POINTS, LYR_CLUSTER_CIRCLE, LYR_MILITARY_BASES_CIRCLE, LYR_HOSPITALS, LYR_PROTESTS, LYR_CRIME_CITY, LYR_WEBCAMS, LYR_WEBCAM_CLUSTER, LYR_FLUX_LINES,
      ...Object.values(TRAFFIC_LAYER_KEYS).flat(), ...OUT_HOVER_LAYERS.filter((id) => id !== LYR_OUT_INTERNET_FILL), ...SOV_HOVER_LAYERS,
    ].filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
    return ids.length > 0 && map.queryRenderedFeatures(point, { layers: ids }).length > 0;
  }

  /**
   * Image 2D Météo-France visible : couche Radar météo active. L'argument `enabled` de setRadar2dOverlay ne commande plus
   * l'affichage (l'interrupteur « Réflectivité radar 2D » du panneau Feux est remplacé par la couche Radar météo) ; il reste
   * l'état restauré quand une image échoue.
   */
  private radar2dShown(): boolean {
    // Onglet Environnement : l'image radar est du contexte, montrée quand sa pastille est survolée ou allumée.
    return (this.currentLayers?.weatherRadar ?? false) && envContextRevealed(RADAR_CONTEXT_KEY, this.envContextOn, this.envRevealed);
  }

  /** Sommets d'écho visibles : option cochée et couche Radar ou Feux active. */
  private echoTopsShown(enabled: boolean): boolean {
    return enabled && ((this.currentLayers?.weatherRadar ?? false) || (this.currentLayers?.fires ?? false));
  }

  /** Pictogrammes fmIcon en images SDF (teintés par `icon-color`) : vigilance météo et filières de l'énergie. */
  private registerEnvironmentIcons(): void {
    this.registerSdfIcons([...ENV_ICON_NAMES, 'flame'], envIconImage);
    this.registerSdfIcons(ENERGY_ICON_NAMES, energyIconImage);
  }

  private registerSdfIcons(names: readonly IconName[], idOf: (name: IconName) => string): void {
    if (!this.map) return;
    const SIZE = ENV_ICON_SIZE;
    const GLYPH = ENV_ICON_GLYPH;
    const MARGIN = ENV_ICON_MARGIN;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    for (const name of names) {
      const id = idOf(name);
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
    this.envPopupAsset = null;
    this.envHoverPopup?.remove();
  }

  /** Retient l'enjeu dont l'infobulle s'ouvre (null pour toute autre couche). */
  private rememberEnvPopupAsset(hit: maplibregl.MapGeoJSONFeature | undefined): void {
    const id: unknown = hit?.properties?.['id'];
    const layer = hit?.layer.id;
    this.envPopupAsset = (layer === LYR_EXPOSURE || layer === LYR_FLOOD_ASSETS) && typeof id === 'string' ? { layer, id } : null;
  }

  /** Enjeux redessinés : l'infobulle ouverte suit le nouvel état de son enjeu, ou se ferme s'il n'est plus exposé. */
  private syncEnvPopupAsset(layer: string, fc: GeoJSON.FeatureCollection): void {
    const open = this.envPopupAsset;
    if (!this.envHoverShown || !open || open.layer !== layer) return;
    const f = fc.features.find((x) => x.properties?.['id'] === open.id);
    const html = f ? envTooltipHtml(open.layer, f.properties ?? {}) : null;
    if (html) this.envHoverPopup?.setHTML(html);
    else this.hideEnvironmentHover();
  }

  /**
   * Couches Environnement : une infobulle au survol, celle de la couche dessinée au-dessus (préparée avec la donnée, texte échappé) ;
   * département de la vigilance survolé mis en avant ; clic sur la carte, couche Radar active : point du profil vertical.
   */
  private initEnvironmentInteractions(): void {
    const map = this.map;
    if (!map) return;
    map.on('click', (e) => {
      // Un calque tamisé par la mise en avant d'une pastille ne répond pas (20/10/2026).
      const visible = ENV_HOVER_LAYERS.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none' && !this.dimmedLegendLayers.has(id));
      const hit = topEnvHit(visible.length > 0 ? map.queryRenderedFeatures(e.point, { layers: visible }) : []);
      const html = hit ? envTooltipHtml(hit.layer.id, hit.properties ?? {}) : null;
      if (hit?.layer.id === LYR_WEATHER_FILL && html) this.previewWeatherDepartment(String(hit.properties?.['code'] ?? ''));
      if (!html) {
        this.hideEnvironmentHover();
        return;
      }
      this.envHoverShown = true;
      this.rememberEnvPopupAsset(hit);
      const popup = this.envHoverPopup
        ?? new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, maxWidth: '300px', className: 'dark-popup hm-hover' });
      this.envHoverPopup = popup;
      popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
    });
    // Tronçon cliqué sur la carte : sélectionné ; clic sur un fond vide : sélection quittée.
    map.on('click', (e) => {
      const floodHit = map.getLayer(LYR_FLOODS) && map.getLayoutProperty(LYR_FLOODS, 'visibility') !== 'none' && !this.dimmedLegendLayers.has(LYR_FLOODS)
        ? map.queryRenderedFeatures(e.point, { layers: [LYR_FLOODS] })[0] : undefined;
      const id: unknown = floodHit?.properties?.['id'];
      if (typeof id === 'string') { this.highlightFloodSection(id); return; }
      if (this._highlightedFloodSegmentId !== null && !this.clickHitsInteractiveFeature(e.point)) this.highlightFloodSection(null);
    });
    map.on('click', (e) => {
      if (!this.onRadarPointPick || !(this.currentLayers?.weatherRadar ?? false)) return;
      // Onglet Environnement : le radar est un contexte, son point de profil ne se pose que pastille Radar allumée (20/10/2026).
      if (!envContextRevealed(RADAR_CONTEXT_KEY, this.envContextOn, this.envRevealed)) return;
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
        const color = p.colorOverride ?? INFRA_COLORS[p.type] ?? '#8e8e93';
        const isElectricGeneration = p.type === 'nuclear' || p.type === 'thermal' || p.type === 'hydro';
        const baseRadius =
          p.type === 'nuclear' ? 8
            : p.type === 'thermal' || p.type === 'hydro' || p.type === 'refinery' ? 7
              : p.type === 'gas-terminal' ? 6.8
                : p.type === 'gas-storage' || p.type === 'oil-depot' ? 6.2
                  : 5.8;

        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: p.coordinates },
          properties: {
            id: p.id,
            name: p.name,
            type: p.type,
            color,
            energyState: p.energyState ?? 'nonSuivi',
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
    this.recordEnergy('nuclearFleet', energyEntriesFrom(fc.features.filter((f) => f.properties?.type === 'nuclear'), 'nucleaire', 'nuc'));
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
            energyState: 'nonSuivi',
          },
        })),
    };

    const src = this.map.getSource(SRC_DROM_ENERGY) as maplibregl.GeoJSONSource | undefined;
    src?.setData(fc);
    this.recordEnergy('dromEnergy', energyEntriesFrom(fc.features, 'electricite', 'drom'));

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
        const measured = asset.signals.signalSource === 'DERIVED_REAL_MEASURE_SUPPORT'
          && asset.signals.dataFreshness !== 'stale' && asset.signals.dataFreshness !== 'unavailable';
        const style = hydroStyle(asset.signals.hydro_trend, measured);
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
            id: asset.id,
            color: style.color,
            energyState: style.energyState,
            radius,
          },
        };
      }),
    };

    const src = this.map.getSource(SRC_HYDRO_BACKBONE) as maplibregl.GeoJSONSource | undefined;
    src?.setData(fc);
    this.recordEnergy('hydroBackbone', energyEntriesFrom(fc.features, 'hydraulique', 'hydro'));
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
    this.recordEnergy('windMonitor', [
      ...energyEntriesFrom(clusteredFc.features, 'eolien', 'wind'),
      ...energyEntriesFrom(parksFc.features, 'eolien', 'windpark'),
    ]);
  }

  // ─── Métropoles Layer ───

  updateMetropoles(data: MetropoleConsumption[]): void {
    if (!this.map) return;
    if (data.length === 0) return;

    const classified = classifyMetropoles(data);

    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: classified.map((m) => {
        // Nombre et unité jamais séparés (espaces insécables).
        const mwLabel = `${Math.round(m.loadMW).toLocaleString('fr-FR').replace(/\s/g, '\u00a0')}\u00a0MW`;
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
            loadMw: m.loadMW,
            color: m.color,
            glowColor: m.glowColor,
            sizeClass: m.sizeClass,
            energyState: 'nonSuivi',
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
    this.recordEnergy('metroLoad', energyEntriesFrom(fc.features, 'electricite', 'metro'));
  }

  // ─── Événements consolidés (v2) ───

  setOnEnergyKeyChange(cb: (model: EnergyKeyModel) => void): void {
    this.onEnergyKeyChange = cb;
    this.emitEnergyKey();
  }

  setHiddenEnergyStates(states: ReadonlySet<EnergyState>): void {
    this.hiddenEnergyStates = new Set(states);
    this.applyEnergyStateFilters();
    this.emitEnergyKey();
  }

  private recordEnergy(key: EnergyLayerKey, entries: EnergyEntry[]): void {
    this.energyEntries.set(key, entries);
    this.emitEnergyKey();
  }

  private recordEnergyFlows(key: EnergyLayerKey, flows: EnergyFlowCount): void {
    this.energyFlows.set(key, flows);
    this.emitEnergyKey();
  }

  private recordFuelTension(levels: VigilanceLevel[]): void {
    this.fuelTensionLevels = levels;
    this.emitEnergyKey();
  }

  private emitEnergyKey(): void {
    if (!this.onEnergyKeyChange) return;
    const layers: Partial<Record<EnergyLayerKey, boolean>> = {};
    for (const k of ENERGY_LAYER_KEYS) layers[k] = this.currentLayers?.[k] === true;
    this.onEnergyKeyChange(buildEnergyKeyModel({
      layers, entries: this.energyEntries, flows: this.energyFlows, fuelTension: this.fuelTensionLevels, hiddenStates: this.hiddenEnergyStates,
    }));
  }

  /** Masquage par état ; la couche nucléaire impose `type == nuclear` sur les calques d'infrastructure. */
  private applyEnergyStateFilters(): void {
    if (!this.map) return;
    const nuclear: maplibregl.FilterSpecification = ['==', ['get', 'type'], 'nuclear'];
    for (const [id, base] of ENERGY_FILTER_BASES) {
      if (!this.map.getLayer(id)) continue;
      const own = (id === LYR_ENERGY_INFRA_CIRCLE || id === LYR_ENERGY_INFRA_LABEL) && this.currentLayers?.nuclearFleet ? nuclear : base;
      try {
        const f = energyStateFilter(own, this.hiddenEnergyStates);
        this.map.setFilter(id, f);
        if (ENERGY_DISC_IDS.has(id)) {
          const c = companionFilters(f);
          if (this.map.getLayer(`${id}-halo`)) this.map.setFilter(`${id}-halo`, c.halo);
          if (this.map.getLayer(`${id}-icon`)) this.map.setFilter(`${id}-icon`, c.icon);
        }
      } catch {
        // Calque pas encore prêt : le prochain appel le rattrapera.
      }
    }
    const clusters: maplibregl.FilterSpecification = ['has', 'point_count'];
    for (const [id, states] of ENERGY_CLUSTER_LAYERS) {
      if (!this.map.getLayer(id)) continue;
      const allHidden = states.every((st) => this.hiddenEnergyStates.has(st));
      try {
        this.map.setFilter(id, allHidden ? ['all', clusters, false] : clusters);
      } catch {
        // Calque pas encore prêt.
      }
    }
  }

  setEventPoints(points: EventMapPoint[]): void {
    // Le plus grave en dernier : dessiné au-dessus, c'est lui que le clic atteint quand des points se superposent.
    this.eventPoints = [...points].sort((a, b) => alertPriority(b, a));
    this.drawnEventIds = new Set(points.map((p) => p.id));
    this.applyNewsItems();
    this.scheduleOverlayUpdate();
    this.syncEventAlertMarkers();
  }

  setOnEventPointClick(handler: ((id: number, x: number, y: number) => void) | null): void {
    this.onEventPointClick = handler;
  }

  /** Largeur estimée d'une étiquette (11 px, gras) : sert seulement à éviter les chevauchements. */
  private static readonly LABEL_CHAR_PX = 6.6;

  /** Crée le calque des alertes à la fin de l'initialisation et y place tout de suite les points déjà reçus. */
  private attachAlertOverlay(): void {
    this.alertOverlay = document.createElement('div');
    this.alertOverlay.className = 'event-alert-overlay';
    this.container.appendChild(this.alertOverlay);
    this.alertEls.clear();
    this.syncEventAlertMarkers();
  }

  private syncEventAlertMarkers(): void {
    const overlay = this.alertOverlay;
    if (!overlay) return;
    if (!this.map || !this.eventPointsVisible) {
      overlay.replaceChildren();
      this.alertEls.clear();
      return;
    }
    const map = this.map;
    const bounds = map.getBounds();
    const alerts = this.eventPoints.filter((p) => p.alert && bounds.contains([p.lon, p.lat])).sort(alertPriority);
    const placed = alerts.map((p) => {
      const { x, y } = map.project([p.lon, p.lat]);
      const r = drawnRadius(p);
      const text = alertLabel(p.title);
      const box: LabelBox = { id: p.id, x: x + r + 4, y: y - 9, w: text.length * DeckGLMap.LABEL_CHAR_PX + 14, h: 18 };
      return { p, x, y, r, text, box };
    });
    const labelled = layoutAlertLabels(placed.map((a) => a.box));
    const seen = new Set<number>();
    for (const { p, x, y, r, text } of placed) {
      seen.add(p.id);
      const hex = levelHex(p.level);
      const label = labelled.has(p.id) ? text : '';
      const sig = `${p.level}|${p.hollow ? 1 : 0}|${r}|${p.category}|${label}`;
      let entry = this.alertEls.get(p.id);
      if (!entry || entry.el.parentElement !== overlay) {
        const el = document.createElement('div');
        el.className = 'event-alert';
        el.dataset.id = String(p.id);
        overlay.appendChild(el);
        entry = { el, sig: '' };
        this.alertEls.set(p.id, entry);
      }
      if (entry.sig !== sig) {
        // Rond vide (« à confirmer ») : picto à la couleur du niveau ; rond plein : picto blanc.
        entry.el.style.setProperty('--r', `${r}px`);
        entry.el.style.color = p.hollow ? hex : '#ffffff';
        entry.el.innerHTML = fmIcon(categoryIcon(p.category), { size: Math.round(r * 1.1), className: 'event-alert__icon' })
          + (label ? `<span class="event-alert__label" style="--lvl:${hex}">${escapeHtml(label)}</span>` : '');
        entry.sig = sig;
      }
      entry.el.style.left = `${x.toFixed(1)}px`;
      entry.el.style.top = `${y.toFixed(1)}px`;
    }
    for (const [id, entry] of this.alertEls) {
      if (!seen.has(id)) {
        entry.el.remove();
        this.alertEls.delete(id);
      }
    }
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
    map.on('click', (e) => {
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
    const powerFc = powerFeatures(p, now);
    this.lastPowerUnits = powerFc.features;
    (this.map?.getSource(SRC_OUT_POWER) as maplibregl.GeoJSONSource | undefined)?.setData(powerFc);
    this.recordEnergy('outagesElec', energyEntriesFrom(powerFc.features, 'electricite', 'edf'));
    this.hideOutagesHover();
  }

  /** Départements en anomalie IODA : polygones du fichier versionné (lecture mémoïsée, qui ne rejette jamais) ; fichier illisible : collection vide. */
  updateOutagesInternet(r: InternetOutagesResponse | null, now: number): void {
    void loadDepartementsGeojson().then((geo) => {
      const data = geo ? internetFeatures(r, geo, now) : internetFeatures(null, { type: 'FeatureCollection', features: [] }, now);
      (this.map?.getSource(SRC_OUT_INTERNET) as maplibregl.GeoJSONSource | undefined)?.setData(data);
      this.hideOutagesHover();
    });
  }

  /** Zones des fournisseurs qui publient un état (gris si la page est en retard) et centres du référentiel en teinte neutre (inventaire). */
  updateOutagesCloud(r: CloudOutagesResponse | null, now: number): void {
    (this.map?.getSource(SRC_OUT_CLOUD_ZONES) as maplibregl.GeoJSONSource | undefined)?.setData(cloudZoneFeatures(r, now));
    (this.map?.getSource(SRC_OUT_CLOUD_REF) as maplibregl.GeoJSONSource | undefined)?.setData(cloudReferenceFeatures(r));
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

  /** Manifestations : points regroupés par position (deckgl/protests-map.ts). */
  updateProtestsLayer(r: ProtestsResponse | null): void {
    this.protestsData = r;
    (this.map?.getSource(SRC_PROTESTS) as maplibregl.GeoJSONSource | undefined)?.setData(protestFeatures(r));
    this.hideProtestsHover();
  }

  /** Clic sur un point de la couche Manifestations : App.ts ouvre le panneau sur les lignes de cette commune. */
  setOnProtestClick(handler: (placeKey: string) => void): void {
    this.onProtestClick = handler;
  }

  private hideProtestsHover(): void {
    if (!this.protestHoverShown) return;
    this.protestHoverShown = false;
    this.protestHoverPopup?.remove();
  }

  /** Couche Manifestations : infobulle préparée et échappée au survol, curseur main, clic transmis à App.ts. */
  private initProtestsInteractions(): void {
    const map = this.map;
    if (!map) return;
    const shown = (): boolean => map.getLayer(LYR_PROTESTS) !== undefined && map.getLayoutProperty(LYR_PROTESTS, 'visibility') !== 'none';
    map.on('click', (e) => {
      const hit = shown() ? map.queryRenderedFeatures(e.point, { layers: [LYR_PROTESTS] })[0] : undefined;
      const html = hit ? String(hit.properties?.['body'] ?? '') : '';
      if (!html) {
        this.hideProtestsHover();
        return;
      }
      this.protestHoverShown = true;
      const popup = this.protestHoverPopup
        ?? new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, maxWidth: '300px', className: 'dark-popup hm-hover' });
      this.protestHoverPopup = popup;
      popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
    });
    map.on('click', (e) => {
      if (!this.onProtestClick || !shown()) return;
      const hit = map.queryRenderedFeatures(e.point, { layers: [LYR_PROTESTS] })[0];
      const key = hit ? String(hit.properties?.['place'] ?? '') : '';
      if (key) this.onProtestClick(key);
    });
  }

  /** Flux piétons : objets de l'événement choisi (null : vide la carte) et phase affichée. */
  updateFluxLayer(data: readonly FluxFeature[] | null, phase: FluxPhase, instant: FluxInstant | null = null, others: readonly FluxOtherEvent[] = []): void {
    this.fluxData = data;
    this.fluxPhase = phase;
    this.fluxInstant = instant;
    this.fluxOthers = others;
    (this.map?.getSource(SRC_FLUX) as maplibregl.GeoJSONSource | undefined)?.setData(fluxFeatures(data, phase, instant, others));
    this.hideFluxHover();
  }

  private hideFluxHover(): void {
    if (!this.fluxHoverShown) return;
    this.fluxHoverShown = false;
    this.fluxHoverPopup?.remove();
  }

  /** Clic sur un autre rassemblement prévu : App.ts fait passer la carte et le panneau à lui. */
  setOnFluxEventClick(handler: (id: string) => void): void {
    this.onFluxEventClick = handler;
  }

  /** Couche Flux piétons : infobulle préparée et échappée au survol d'une rue. */
  private initFluxInteractions(): void {
    const map = this.map;
    if (!map) return;
    // Autres rassemblements prévus : main au survol, clic = la carte et le panneau passent à lui.
    map.on('mouseenter', LYR_FLUX_OTHERS, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', LYR_FLUX_OTHERS, () => { map.getCanvas().style.cursor = ''; });
    map.on('click', LYR_FLUX_OTHERS, (e) => {
      const id = e.features?.[0]?.properties?.['id'];
      if (typeof id === 'string' && id) this.onFluxEventClick?.(id);
    });
    const shown = (): boolean => map.getLayer(LYR_FLUX_LINES) !== undefined && map.getLayoutProperty(LYR_FLUX_LINES, 'visibility') !== 'none';
    map.on('click', (e) => {
      // Rues fines : tolérance de 4 px autour du curseur ; la plus chargée l'emporte (tri par sortKey décroissant).
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]];
      const hit = shown()
        ? map.queryRenderedFeatures(box, { layers: [LYR_FLUX_LINES] })
          .sort((a, b) => Number(b.properties?.['sortKey'] ?? 0) - Number(a.properties?.['sortKey'] ?? 0))[0]
        : undefined;
      const html = hit ? String(hit.properties?.['body'] ?? '') : '';
      if (!html) {
        this.hideFluxHover();
        return;
      }
      this.fluxHoverShown = true;
      const popup = this.fluxHoverPopup
        ?? new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, maxWidth: '300px', className: 'dark-popup hm-hover' });
      this.fluxHoverPopup = popup;
      popup.setLngLat(e.lngLat).setHTML(`<div class="hm-tip">${html}</div>`).addTo(map);
    });
  }

  /** Pollens : indice le plus haut du jour choisi (J, J+1, J+2) par département. */
  async updatePollenLayer(p: PollenResponse | null, day: PollenDay, now: number): Promise<void> {
    const geo = await this.getDepartmentsGeojson();
    if (!this.map) return;
    (this.map.getSource(SRC_POLLEN) as maplibregl.GeoJSONSource | undefined)?.setData(geo ? pollenDeptFeatures(geo, p, day, now) : emptyFC());
  }

  /** Sites Seveso et leur exposition (null : vide la carte). */
  updateSevesoLayer(sites: readonly ExposureAsset[] | null, exposed: readonly Exposure[] | null): void {
    this.sevesoSites = sites;
    this.sevesoExposed = exposed;
    (this.map?.getSource(SRC_SEVESO) as maplibregl.GeoJSONSource | undefined)?.setData(sevesoFeatures(this.sevesoShownSites(), exposed));
  }

  /** Sites Seveso : curseur ; infobulle commune de l'Environnement (clic) ; clic sur un groupe = zoom. */
  private initSevesoInteractions(): void {
    const map = this.map;
    if (!map) return;
    map.on('mouseenter', LYR_SEVESO, () => { if (!this.dimmedLegendLayers.has(LYR_SEVESO)) map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', LYR_SEVESO, () => { map.getCanvas().style.cursor = ''; });
    map.on('click', LYR_SEVESO_CLUSTER, (e) => {
      const cluster = e.features?.[0];
      const clusterId = Number(cluster?.properties?.['cluster_id']);
      const source = map.getSource(SRC_SEVESO) as maplibregl.GeoJSONSource | undefined;
      if (!cluster || !Number.isFinite(clusterId) || !source || cluster.geometry.type !== 'Point') return;
      const [lng, lat] = cluster.geometry.coordinates;
      void source.getClusterExpansionZoom(clusterId).then((zoom) => map.easeTo({ center: [lng ?? 0, lat ?? 0], zoom: zoom + 0.5 })).catch(() => undefined);
    });
  }

  /** Zones inondables cartographiées des tronçons en crue (vide : interrupteur éteint ou rien de lu). */
  updateFloodZonesLayer(rings: ReadonlyArray<ReadonlyArray<[number, number]>>): void {
    (this.map?.getSource(SRC_FLOOD_ZONES) as maplibregl.GeoJSONSource | undefined)?.setData(floodZoneFeatures(rings));
  }

  /** Enjeux exposés aux crues (panneau Crues) : un point par enjeu, même rendu que la couche En bref. */
  updateFloodAssetsLayer(nearby: readonly Exposure[]): void {
    const fc = exposureFeatures({ hazards: [], nearby: [...nearby], departmental: [] });
    (this.map?.getSource(SRC_FLOOD_ASSETS) as maplibregl.GeoJSONSource | undefined)?.setData(fc);
    this.syncEnvPopupAsset(LYR_FLOOD_ASSETS, fc);
  }

  /**
   * Recentre sur un point cliqué dans un panneau (enjeu, site) puis ouvre l'infobulle du point dessiné à cet endroit : on voit lequel
   * c'est, même au milieu d'autres. Rien de dessiné là (couche éteinte) : simple recentrage.
   */
  focusPoint(lon: number, lat: number, zoom = 13): void {
    const map = this.map;
    if (!map) return;
    this.flyTo(lon, lat, zoom);
    map.once('moveend', () => {
      const p = map.project([lon, lat]);
      const visible = ENV_HOVER_LAYERS.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none' && !this.dimmedLegendLayers.has(id));
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [[p.x - 6, p.y - 6], [p.x + 6, p.y + 6]];
      const hit = topEnvHit(visible.length > 0 ? map.queryRenderedFeatures(box, { layers: visible }) : []);
      const html = hit ? envTooltipHtml(hit.layer.id, hit.properties ?? {}) : null;
      if (!html) return;
      this.envHoverShown = true;
      this.rememberEnvPopupAsset(hit);
      const popup = this.envHoverPopup
        ?? new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, maxWidth: '300px', className: 'dark-popup hm-hover' });
      this.envHoverPopup = popup;
      popup.setLngLat([lon, lat]).setHTML(html).addTo(map);
    });
  }

  /** Enjeux exposés : croisement de l'onglet Environnement (null : vide la carte). */
  updateExposureLayer(r: ExposureResult | null): void {
    this.exposureData = r;
    const fc = exposureFeatures(r);
    (this.map?.getSource(SRC_EXPOSURE) as maplibregl.GeoJSONSource | undefined)?.setData(fc);
    this.syncEnvPopupAsset(LYR_EXPOSURE, fc);
  }

  /** Enjeux exposés : curseur ; l'infobulle est celle de l'Environnement (clic, une seule bulle, initEnvironmentInteractions). */
  private initExposureInteractions(): void {
    const map = this.map;
    if (!map) return;
    map.on('mouseenter', LYR_EXPOSURE, () => { if (!this.dimmedLegendLayers.has(LYR_EXPOSURE)) map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseenter', LYR_FLOOD_ASSETS, () => { if (!this.dimmedLegendLayers.has(LYR_FLOOD_ASSETS)) map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', LYR_FLOOD_ASSETS, () => { map.getCanvas().style.cursor = ''; });
    map.on('mouseleave', LYR_EXPOSURE, () => { map.getCanvas().style.cursor = ''; });
  }

  /** Webcams : recensement statique (null : vide la carte). */
  updateWebcamsLayer(data: WebcamsDataset | null): void {
    this.webcamsData = data;
    (this.map?.getSource(SRC_WEBCAMS) as maplibregl.GeoJSONSource | undefined)?.setData(webcamFeatures(data));
    this.hideWebcamsHover();
  }

  /** Clic sur une webcam : App.ts ouvre le panneau sur sa fiche. */
  setOnWebcamClick(handler: (id: string) => void): void {
    this.onWebcamClick = handler;
  }

  private hideWebcamsHover(): void {
    if (!this.webcamHoverShown) return;
    this.webcamHoverShown = false;
    this.webcamHoverPopup?.remove();
  }

  /** Couche Webcams : infobulle préparée et échappée au survol d'un point ; clic sur un point relayé, clic sur un groupe = zoom. */
  private initWebcamsInteractions(): void {
    const map = this.map;
    if (!map) return;
    const shown = (): boolean => map.getLayer(LYR_WEBCAMS) !== undefined && map.getLayoutProperty(LYR_WEBCAMS, 'visibility') !== 'none';
    map.on('click', (e) => {
      const hit = shown() ? map.queryRenderedFeatures(e.point, { layers: [LYR_WEBCAMS] })[0] : undefined;
      const html = hit ? String(hit.properties?.['body'] ?? '') : '';
      if (!html) {
        this.hideWebcamsHover();
        return;
      }
      this.webcamHoverShown = true;
      const popup = this.webcamHoverPopup
        ?? new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, maxWidth: '300px', className: 'dark-popup hm-hover' });
      this.webcamHoverPopup = popup;
      popup.setLngLat(e.lngLat).setHTML(`<div class="hm-tip">${html}</div>`).addTo(map);
    });
    map.on('click', (e) => {
      if (!shown()) return;
      const point = map.queryRenderedFeatures(e.point, { layers: [LYR_WEBCAMS] })[0];
      const id = point ? String(point.properties?.['id'] ?? '') : '';
      if (id) {
        this.onWebcamClick?.(id);
        return;
      }
      const cluster = map.queryRenderedFeatures(e.point, { layers: [LYR_WEBCAM_CLUSTER] })[0];
      const clusterId = Number(cluster?.properties?.['cluster_id']);
      const source = map.getSource(SRC_WEBCAMS) as maplibregl.GeoJSONSource | undefined;
      if (!cluster || !Number.isFinite(clusterId) || !source || cluster.geometry.type !== 'Point') return;
      const [lng, lat] = cluster.geometry.coordinates;
      void source.getClusterExpansionZoom(clusterId).then((zoom) => map.easeTo({ center: [lng ?? 0, lat ?? 0], zoom: zoom + 0.5 })).catch(() => undefined);
    });
  }

  /** Criminalité : fichier annuel (null : vide la carte). Repeint à l'affichage si la couche est masquée. */
  updateCrimeLayer(data: CrimeDataset | null): void {
    this.crimeData = data;
    this.hideCrimeHover();
    void this.renderCrime();
  }

  /** Sélecteur d'indicateur du panneau : repeint les départements et les villes. */
  setCrimeIndicator(key: CrimeIndicatorKey): void {
    this.crimeIndicator = key;
    this.hideCrimeHover();
    void this.renderCrime();
  }

  /** Clic sur un rond de ville de la couche Criminalité : App.ts ouvre le panneau sur la ligne de cette ville (code commune). */
  setOnCrimeCityClick(handler: (cityCode: string) => void): void {
    this.onCrimeCityClick = handler;
  }

  private async renderCrime(): Promise<void> {
    if (!this.map || !this.currentLayers?.crime) {
      this.crimeDirty = true;
      return;
    }
    const map = this.map;
    this.crimeDirty = false;
    // Départements : contours lus une fois (mémorisés), peints pour l'indicateur choisi.
    const base = this.crimeData ? await this.getDepartmentsGeojson() : null;
    (map.getSource(SRC_CRIME_DEPTS) as maplibregl.GeoJSONSource | undefined)?.setData(crimeDeptFeatures(base, this.crimeData, this.crimeIndicator));
    (map.getSource(SRC_CRIME_CITIES) as maplibregl.GeoJSONSource | undefined)?.setData(crimeCityFeatures(this.crimeData, this.crimeIndicator));
  }

  private hideCrimeHover(): void {
    if (!this.crimeHoverShown) return;
    this.crimeHoverShown = false;
    this.crimeHoverPopup?.remove();
  }

  /** Couche Criminalité : infobulle préparée et échappée au survol (ville d'abord, puis département), clic sur une ville relayé. */
  private initCrimeInteractions(): void {
    const map = this.map;
    if (!map) return;
    const shown = (): boolean => map.getLayer(LYR_CRIME_CITY) !== undefined && map.getLayoutProperty(LYR_CRIME_CITY, 'visibility') !== 'none';
    map.on('click', (e) => {
      let html = '';
      if (shown()) {
        const city = map.queryRenderedFeatures(e.point, { layers: [LYR_CRIME_CITY] })[0];
        const dept = city ? undefined : map.queryRenderedFeatures(e.point, { layers: [LYR_CRIME_FILL] })[0];
        html = String(city?.properties?.['body'] ?? dept?.properties?.['crimeBody'] ?? '');
      }
      if (!html) {
        this.hideCrimeHover();
        return;
      }
      this.crimeHoverShown = true;
      const popup = this.crimeHoverPopup
        ?? new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, maxWidth: '300px', className: 'dark-popup hm-hover' });
      this.crimeHoverPopup = popup;
      popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
    });
    map.on('click', (e) => {
      if (!this.onCrimeCityClick || !shown()) return;
      const hit = map.queryRenderedFeatures(e.point, { layers: [LYR_CRIME_CITY] })[0];
      const code = hit ? String(hit.properties?.['id'] ?? '') : '';
      if (code) this.onCrimeCityClick(code);
    });
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
    map.on('click', (e) => {
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
      this.applyNewsItems();
      this.scheduleOverlayUpdate();
      this.syncEventAlertMarkers();
    }
    // Update DOM overlay immediately to reflect news toggle
    this.updatePulseMarkerPositions();
    if (!this.map) return;

    if (layers.gasNetwork) {
      void this.ensureGasNetworkSources();
    }

    // Perf audit §6 item 2: replay any department-choropleth update that was
    // skipped (vigilance, updateISNR below ; health layers through their dirty flags)
    // while its layer was hidden, now that it's visible again.
    if (layers.environmental && this.envVigilancePending && this.envVigilance) {
      // Rejeu à l'heure courante (S2) : une carte devenue en retard pendant que la couche était masquée repasse en gris.
      const { v, echeance } = this.envVigilance;
      void this.updateVigilanceLayer(v, echeance, Date.now());
    }
    this.repaintEnvironmentOnShow(before, layers);
    this.repaintSovereigntyOnShow(before, layers);
    if (layers.health && this.healthRegionsDirty) void this.renderHealthRegions();
    if (layers.crime && this.crimeDirty) void this.renderCrime();
    if ((layers.healthOscour || layers.healthApl) && this.healthDeptsDirty) void this.renderHealthDepartments();
    if (layers.stability && this._pendingIsnrScores !== null) {
      const scores = this._pendingIsnrScores;
      void this.updateISNR(scores);
    }
    if (layers.stability && this._pendingPressure !== null) void this.updateDepartmentPressure(this._pendingPressure);

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
    // Flèches d'échange : visibles dès qu'une couche à flux est allumée ; leurs données ne gardent que ces couches (rebuildEnergyFlows).
    const flowsVis = vis(layers.powerGrid || layers.gasNetwork || layers.oilNetwork);
    for (const id of [LYR_ENERGY_FLOW_CASE, LYR_ENERGY_FLOW_LINES, LYR_ENERGY_FLOW_ANIM, LYR_ENERGY_FLOW_HEADS, LYR_ENERGY_FLOW_LABELS]) this.setVis(id, flowsVis);
    this.setVis(LYR_ENERGY_CHOKE, vis(layers.oilNetwork));
    this.setVis(LYR_ENERGY_CHOKE_LABEL, vis(layers.oilNetwork));
    this.rebuildEnergyFlows();
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
    this.pulseState.earthquakes.shown = envLayerOn(layers, 'earthquakes');
    for (const id of ENV_LAYER_KEYS.disasters) this.setVis(id, vis(envLayerOn(layers, 'disasters')));
    this.pulseState.disasters.shown = envLayerOn(layers, 'disasters');
    this.syncPulses();
    for (const id of PROTEST_LAYER_IDS) this.setVis(id, vis(layers.protests ?? false));
    for (const id of CRIME_LAYER_IDS) this.setVis(id, vis(layers.crime ?? false));
    for (const id of WEBCAM_LAYER_IDS) this.setVis(id, vis(layers.webcams ?? false));
    for (const id of EXPOSURE_LAYER_IDS) this.setVis(id, vis(layers.envBrief ?? false));
    for (const id of SEVESO_LAYER_IDS) this.setVis(id, vis(layers.seveso ?? false));
    for (const id of POLLEN_LAYER_IDS) this.setVis(id, vis(layers.pollens ?? false));
    if (layers.seveso) (this.map?.getSource(SRC_SEVESO) as maplibregl.GeoJSONSource | undefined)?.setData(sevesoFeatures(this.sevesoShownSites(), this.sevesoExposed));
    if (layers.envBrief) (this.map?.getSource(SRC_EXPOSURE) as maplibregl.GeoJSONSource | undefined)?.setData(exposureFeatures(this.exposureData));
    for (const id of FLUX_LAYER_IDS) this.setVis(id, vis(layers.pedestrianFlows ?? false));
    this.hideFluxHover();
    if (layers.pedestrianFlows) (this.map?.getSource(SRC_FLUX) as maplibregl.GeoJSONSource | undefined)?.setData(fluxFeatures(this.fluxData, this.fluxPhase, this.fluxInstant, this.fluxOthers));
    this.hideCrimeHover();
    this.hideWebcamsHover();
    if (layers.webcams) (this.map?.getSource(SRC_WEBCAMS) as maplibregl.GeoJSONSource | undefined)?.setData(webcamFeatures(this.webcamsData));
    this.hideProtestsHover();
    // Couche réaffichée ou carte prête après la lecture : points reposés depuis la dernière réponse.
    if (layers.protests) (this.map?.getSource(SRC_PROTESTS) as maplibregl.GeoJSONSource | undefined)?.setData(protestFeatures(this.protestsData));
    this.setVis(RADAR_2D_LAYER_ID, vis(this.radar2dShown()));
    this.setVis(ECHO_TOPS_LAYER_ID, vis(this.echoTopsShown(this._echoTopsEnabled)));
    this.hideEnvironmentHover();
    this.setVis(LYR_ISNR_FILL, vis(layers.stability ?? false));
    this.setVis(LYR_ISNR_LINE, vis(layers.stability ?? false));
    this.setVis(LYR_ASNR_RING, vis(layers.nuclearFleet ?? false));
    this.setVis(LYR_ENERGY_INFRA_HIGHLIGHT_GLOW, vis(layers.nuclearFleet ?? false));
    this.setVis(LYR_ENERGY_INFRA_HIGHLIGHT_RING, vis(layers.nuclearFleet ?? false));
    this.setVis(LYR_ENERGY_INFRA_CIRCLE, vis(layers.nuclearFleet ?? false));
    this.setVis(LYR_ENERGY_INFRA_LABEL, vis(layers.nuclearFleet ?? false));
    this.setVis(LYR_DROM_ENERGY_HTA_LINES, vis(layers.dromEnergy ?? false));
    this.setVis(LYR_DROM_ENERGY_POINTS, vis(layers.dromEnergy ?? false));
    this.setVis(LYR_DROM_ENERGY_HIGHLIGHT, vis(layers.dromEnergy ?? false));
    this.setVis(LYR_HYDRO_BACKBONE_CIRCLE, vis(layers.hydroBackbone ?? false));
    this.setVis(LYR_HYDRO_CLUSTER, vis(layers.hydroBackbone ?? false));
    this.setVis(LYR_HYDRO_CLUSTER_ICON, vis(layers.hydroBackbone ?? false));
    this.setVis(LYR_HYDRO_BACKBONE_LABEL, vis(layers.hydroBackbone ?? false));
    this.setVis(LYR_WIND_CLUSTER,        vis(layers.windMonitor ?? false));
    this.setVis(LYR_WIND_CLUSTER_ICON,   vis(layers.windMonitor ?? false));
    this.setVis(LYR_WIND_TURBINE_CIRCLE,         vis(layers.windMonitor ?? false));
    this.setVis(LYR_WIND_TURBINE_LABEL,          vis(layers.windMonitor ?? false));
    this.setVis(LYR_WIND_PARK_CIRCLE,    vis(layers.windMonitor ?? false));
    this.setVis(LYR_WIND_PARK_LABEL,     vis(layers.windMonitor ?? false));

    this.applyEnergyStateFilters();
    this.emitEnergyKey();
    // Gas layer: réseau + organes vitaux
    const gasVis = vis(layers.gasNetwork ?? false);
    // Gazoducs visibles dès que la couche Gaz est allumée (spec 2026-10-16 § 5).
    this.setVis(LYR_GAS_NETWORK_GRT, gasVis);
    this.setVis(LYR_GAS_NETWORK_TEREGA, gasVis);
    this.setVis(LYR_GAS_TERMINALS, gasVis);
    this.setVis(LYR_GAS_STORAGES, gasVis);
    this.setVis(LYR_GAS_STORAGES_LABEL, gasVis);
    // Biomethane sites: visible when gasNetwork is active (always shown alongside gas infra)
    const biomVis = vis(layers.gasNetwork ?? false);
    this.setVis(LYR_BIOMETHANE_CLUSTERS, biomVis);
    this.setVis(LYR_BIOMETHANE_SITES, biomVis);
    this.setVis(LYR_BIOMETHANE_SITES_LABEL, biomVis);
    // Oil layer (refineries, depots, pipelines, flows)
    const oilVis = vis(layers.oilNetwork ?? false);
    this.setVis(LYR_OIL_PIPELINES, oilVis);
    this.setVis(LYR_OIL_REFINERIES, oilVis);
    this.setVis(LYR_OIL_REFINERIES_LABEL, oilVis);
    this.setVis(LYR_OIL_DEPOTS, oilVis);
    this.setVis(LYR_OIL_DEPOTS_LABEL, oilVis);
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
    this.pulseState.telecomOutage.shown = layers.outagesTelecom ?? false;
    this.pulseState.powerOutage.shown = layers.outagesElec ?? false;
    this.syncPulses();
    for (const id of OUT_LAYER_KEYS.outagesElec) this.setVis(id, vis(layers.outagesElec));
    for (const id of OUT_LAYER_KEYS.outagesInternet) this.setVis(id, vis(layers.outagesInternet));
    for (const id of OUT_LAYER_KEYS.outagesCloud) this.setVis(id, vis(layers.outagesCloud));
    this.setVis(OUT_MAINTENANCE_LAYER, vis(layers.outagesTelecom && this.telecomMaintenanceOn));
    this.hideOutagesHover();
    if (layers.subseaCables) this.startSubseaPulseAnimation();
    else this.stopSubseaPulseAnimation();
    this.hideSovereigntyHover();
  }

  // ═══════════════════════════════════════════════════════════════
  // PRIVATE
  // ═══════════════════════════════════════════════════════════════

  /** Pose `<disque>-halo` juste sous le disque et `<disque>-icon` juste au-dessus (spec 2026-10-16 § 2.2). */
  private addDiscCompanions(discId: string, source: string, filter: maplibregl.FilterSpecification | null, radius: number | StyleExpr,
    color: string | StyleExpr, icon: string | StyleExpr, iconColor: string | StyleExpr): void {
    if (!this.map) return;
    const [halo, iconLayer] = discCompanionLayers({ id: discId, source, filter, radius, color, icon, iconColor });
    this.map.addLayer(halo, discId);
    this.map.addLayer(iconLayer);
  }

  private setVis(layerId: string, visibility: string): void {
    if (!this.map) return;
    // Guard: only style existing layers to avoid MapLibre "Cannot style non-existing layer" errors
    try {
      if (this.map.getLayer(layerId)) {
        this.map.setLayoutProperty(layerId, 'visibility', visibility);
      }
      // Halo et picto d'un disque d'installation suivent sa visibilité.
      if (ENERGY_DISC_IDS.has(layerId)) {
        for (const id of [`${layerId}-halo`, `${layerId}-icon`]) {
          if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', visibility);
        }
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
    this.alertOverlay?.remove();
    this.alertOverlay = null;
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
    this.energyPopup.unpin();
    // Le survol de l'énergie n'existe qu'une fois la carte montée (navigateur).
    if (this.energyHoverRaf !== 0) cancelAnimationFrame(this.energyHoverRaf);
    if (typeof document !== 'undefined') document.removeEventListener('keydown', this.onEnergyKeydown);
    this.renderFloodSelectionChip(null);
    this.trafficHoverPopup?.remove();
    this.trafficJamPopup?.remove();

    // Animation des flèches d'échange
    this.stopEnergyFlowAnimation();
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
