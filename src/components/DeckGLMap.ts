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
import { DayNightLayer } from '../layers/DayNightLayer.ts';
import type { MapViewState, NewsItem, EcowattSignal, MeteoAlert, FloodSegment, InfrastructurePoint, MapLayers, MilitaryBase, RestrictedZone, MilitaryFlight, AirTrafficFlight, EcowattResponse, ActiveFire, TelecomOutage, PowerOutage, HealthRegionMetric, HealthDepartmentMetric, HealthFeatures, ISSLevel, AisShipData, OilDashboard, NetworkOutageState, InfraNetworkState, SatelliteViewRequest } from '../types/index.ts';
import { ISS_LEVELS, APL_LEVELS, OSCOUR_LEVELS } from '../types/index.ts';
import type { MetropoleConsumption } from '../services/metropoles.ts';
import { classifyMetropoles } from '../utils/metropolesElectric.ts';
import { fetchTrafficFlowSegment, type TrafficFlowSegment, type TrafficIncident } from '../services/traffic.ts';
import { identifyFrenchCallsign, identifyAlliedCallsign } from '../config/military.ts';
import { interpolateFlightPosition } from '../services/military-flights.ts';
import { getAllLiveTraffic, getMilitaryShips, type MilitaryShip } from '../services/military-ships.ts';
import { OIL_PIPELINE_COLORS } from '../config/oil-infrastructure.ts';
import { resolveFlowDirection, resolveGasFlowDirection } from '../utils/flow-direction.ts';
import { formatUpdateTime } from '../utils/format-date.ts';
import { buildSparklineSVG } from '../utils/sparkline.ts';
import type { LineString, MultiLineString } from 'geojson';
import { computeFloodSegmentBbox, buildEoBrowserUrl } from '../services/copernicus.ts';

// ─── Base map style ───
// Carto Dark Matter - French labels applied via setMapLanguage after style load
const BASE_STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// Satellite basemap layer ID — injected into Carto style at init, toggled by setBasemapSatellite()
const LYR_SATELLITE = 'wm-basemap-satellite';

/**
 * Fetch and modify style to use French labels before applying to map.
 * This is more reliable than post-hoc modification.
 */
async function getFrenchStyle(): Promise<maplibregl.StyleSpecification> {
  const response = await fetch(BASE_STYLE_URL);
  const style = await response.json() as maplibregl.StyleSpecification;

  // Modify all symbol layers to use French names
  for (const layer of style.layers || []) {
    if (layer.type !== 'symbol') continue;
    const layout = (layer as maplibregl.SymbolLayerSpecification).layout;
    if (!layout || !('text-field' in layout)) continue;

    const textField = layout['text-field'];
    const textFieldStr = JSON.stringify(textField);

    // Skip layers that don't reference 'name'
    if (!textFieldStr.includes('name')) continue;

    // Replace with French-first coalesce expression
    layout['text-field'] = ['coalesce',
      ['get', 'name:fr'],
      ['get', 'name_fr'],
      ['get', 'name']
    ] as maplibregl.ExpressionSpecification;
  }

  // ─── Inject Esri World Imagery satellite source ───
  // MVP: Esri tiles are free for display use, no API key needed.
  // Upgrade path: swap the tile URL for a self-hosted raster tile service.
  (style.sources as Record<string, maplibregl.SourceSpecification>)['esri-satellite'] = {
    type: 'raster',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256,
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP',
    maxzoom: 19,
  };

  // Insert satellite raster layer right after 'background' — below all Carto fills but above
  // the map background.  setBasemapSatellite() hides the opaque Carto fill layers when active
  // so the satellite imagery is fully visible with roads/labels rendered on top.
  const bgIdx = (style.layers || []).findIndex((l) => l.id === 'background');
  const insertAt = bgIdx >= 0 ? bgIdx + 1 : 0;
  (style.layers as maplibregl.LayerSpecification[]).splice(insertAt, 0, {
    id: LYR_SATELLITE,
    type: 'raster',
    source: 'esri-satellite',
    layout: { visibility: 'none' },
  } as maplibregl.RasterLayerSpecification);

  return style;
}

// ─── Source & Layer IDs ───
const SRC = 'news-src';              // Clusterable news (excludes critical)
const SRC_CRITICAL = 'news-critical-src';  // Critical alerts (never clustered)
const SRC_SEL = 'news-sel-src';
const SRC_ENERGY = 'energy-regions-src';
const SRC_INTERCONN = 'interconn-src';
const SRC_WEATHER = 'weather-depts-src';
const SRC_HEALTH = 'health-regions-src';
const SRC_HEALTH_MARKERS = 'health-markers-src';
const SRC_FLOODS = 'flood-segments-src';
const SRC_FLOODS_HIGHLIGHT = 'flood-segments-highlight-src';
const SRC_TOPAGE_VIS = 'topage-visual-src';     // réseau hydro décoratif (fond)
const SRC_FIRES = 'fires-points-src';
const SRC_INFRA = 'infra-src';
const SRC_TRAFFIC = 'traffic-flow-src';
const SRC_TRAFFIC_INCIDENTS = 'traffic-incidents-src';
const SRC_TRAIN_ROUTE = 'train-route-src';

const LYR_GLOW = 'news-glow';
const LYR_POINTS = 'news-pts';
const LYR_CLUSTER_CIRCLE = 'news-cluster-circle';
const LYR_CLUSTER_COUNT = 'news-cluster-count';
const LYR_SEL_GLOW = 'news-sel-glow';
const LYR_SEL_RING = 'news-sel-ring';
const LYR_ENERGY_FILL = 'energy-fill';
const LYR_ENERGY_LINE = 'energy-line';
const LYR_INTERCONN_LINE = 'interconn-line';
const LYR_INTERCONN_LABEL = 'interconn-label';
const SRC_INTERCONN_ARCS = 'interconn-arcs-src';
const SRC_INTERCONN_CHEVRON_PTS = 'interconn-chevron-pts-src';  // Animated chevron points
const LYR_INTERCONN_ARC = 'interconn-arc';
const LYR_INTERCONN_ARC_GLOW = 'interconn-arc-glow';
const LYR_INTERCONN_HITAREA = 'interconn-arc-hitarea';
const LYR_INTERCONN_CHEVRONS = 'interconn-chevrons';  // Animated chevrons for flow direction
const LYR_WEATHER_FILL = 'weather-fill';
const LYR_WEATHER_LINE = 'weather-line';
const SRC_WEATHER_ICONS = 'weather-icons-src';
const LYR_WEATHER_ICONS = 'weather-icons';
const LYR_HEALTH_FILL = 'health-fill';
const LYR_HEALTH_LINE = 'health-line';
const LYR_HEALTH_MARKERS = 'health-markers';
const LYR_HEALTH_APL_FILL = 'health-apl-fill';
const LYR_HEALTH_APL_LINE = 'health-apl-line';
const LYR_HEALTH_OSCOUR_CIRCLES = 'health-oscour-circles';
const SRC_ISNR = 'isnr-depts-src';
const LYR_ISNR_FILL = 'isnr-fill';
const LYR_ISNR_LINE = 'isnr-line';
const LYR_TOPAGE_VIS = 'topage-visual-line';    // réseau hydro décoratif (fond)
const LYR_FLOODS_RAW = 'flood-lines-raw';       // tronçons sans Topage, pointillés
const LYR_FLOODS = 'flood-lines';
const LYR_FLOODS_HIGHLIGHT = 'flood-lines-highlight';
const LYR_FIRES_GLOW = 'fires-glow';
const LYR_FIRES_POINTS = 'fires-pts';
const SRC_FIRES_HIGHLIGHT = 'fires-highlight-src';
const LYR_FIRES_HIGHLIGHT = 'fires-highlight';
const SRC_MODIS = 'modis-overlay-src';
const LYR_MODIS = 'modis-overlay';
const SRC_SENTINEL_SCENE = 'sentinel-scene-src';
const LYR_SENTINEL_SCENE = 'sentinel-scene-overlay';
const LYR_INFRA_VITAL_HALO = 'infra-vital-halo';
const LYR_INFRA_NUCLEAR_RING = 'infra-nuclear-ring';
const LYR_INFRA_CIRCLE = 'infra-circles';
const LYR_INFRA_LABEL = 'infra-labels';
const SRC_GAS_NETWORK_GRT = 'gas-network-grt-src';
const SRC_GAS_NETWORK_TEREGA = 'gas-network-terega-src';
const LYR_GAS_NETWORK_GRT = 'gas-network-grt-line';
const LYR_GAS_NETWORK_TEREGA = 'gas-network-terega-line';
// Gas Vital Organs (terminals, storage, PIR flows)
const SRC_GAS_VITALS = 'gas-vitals-src';
const SRC_GAS_PIR_ARCS = 'gas-pir-arcs-src';
const SRC_GAS_PIR_MARKERS = 'gas-pir-markers-src';
const LYR_GAS_TERMINALS = 'gas-terminals';
const LYR_GAS_STORAGES_GLOW = 'gas-storages-glow';
const LYR_GAS_STORAGES = 'gas-storages';
const LYR_GAS_STORAGES_LABEL = 'gas-storages-label';
const LYR_GAS_PIR_ARC_GLOW = 'gas-pir-arc-glow';
const LYR_GAS_PIR_ARC = 'gas-pir-arc';
const SRC_GAS_PIR_CHEVRON_PTS = 'gas-pir-chevron-pts-src';
const LYR_GAS_PIR_CHEVRONS = 'gas-pir-chevrons';
const LYR_GAS_PIR_MARKER = 'gas-pir-marker';
const LYR_GAS_PIR_LABEL = 'gas-pir-label';
// Oil/Petroleum flows (refineries, pipelines, imports)
const SRC_OIL_FLOW_ARCS = 'oil-flow-arcs-src';
const SRC_OIL_FLOW_MARKERS = 'oil-flow-markers-src';
const SRC_OIL_FLOW_DIRECTION = 'oil-flow-direction-src';
const SRC_OIL_FLOW_CHEVRON_PTS = 'oil-flow-chevron-pts-src';
const LYR_OIL_FLOW_ARC_GLOW = 'oil-flow-arc-glow';
const LYR_OIL_FLOW_ARC = 'oil-flow-arc';
const LYR_OIL_FLOW_CHEVRONS = 'oil-flow-chevrons';
const LYR_OIL_FLOW_MARKER = 'oil-flow-marker';
const LYR_OIL_FLOW_LABEL = 'oil-flow-label';
// Oil infrastructure (pipelines, refineries, depots)
const SRC_OIL_PIPELINES = 'oil-pipelines-src';
const SRC_OIL_REFINERIES = 'oil-refineries-src';
const SRC_OIL_DEPOTS = 'oil-depots-src';
const LYR_OIL_PIPELINES_GLOW = 'oil-pipelines-glow';
const LYR_OIL_PIPELINES = 'oil-pipelines';
const LYR_OIL_REFINERIES_GLOW = 'oil-refineries-glow';
const LYR_OIL_REFINERIES = 'oil-refineries';
const LYR_OIL_REFINERIES_LABEL = 'oil-refineries-label';
const LYR_OIL_DEPOTS = 'oil-depots';
const LYR_OIL_DEPOTS_TERMINAL_CENTER = 'oil-depots-terminal-center';
const LYR_OIL_DEPOTS_LABEL = 'oil-depots-label';
// Couches hit invisibles — zone de hover élargie
const LYR_OIL_REFINERIES_HIT = 'oil-refineries-hit';
const LYR_OIL_DEPOTS_HIT = 'oil-depots-hit';
const LYR_OIL_PIPELINES_HIT = 'oil-pipelines-hit';
const LYR_OIL_FLOW_ARC_HIT = 'oil-flow-arc-hit';
const LYR_OIL_FLOW_MARKER_HIT = 'oil-flow-marker-hit';
const LYR_TRAFFIC = 'traffic-flow';
const LYR_TRAFFIC_INCIDENTS = 'traffic-incidents';
const LYR_TRAIN_ROUTE = 'train-route-line';
const LYR_TRAIN_STATIONS = 'train-stations';
const SRC_METROPOLES = 'metropoles-src';
const LYR_METROPOLES_GLOW = 'metropoles-glow';
const LYR_METROPOLES_CIRCLE = 'metropoles-circles';
const LYR_METROPOLES_LABEL = 'metropoles-labels';

const SRC_MILITARY_ZONES = 'military-zones-src';
const SRC_MILITARY_BASES = 'military-bases-src';
const SRC_MILITARY_FLIGHTS = 'military-flights-src';
const SRC_MILITARY_FLIGHT_TRAILS = 'military-flight-trails-src';
const SRC_AIR_TRAFFIC = 'air-traffic-src';
const SRC_MILITARY_SHIPS = 'military-ships-src';
const SRC_MILITARY_SHIPS_HIGHLIGHT = 'military-ships-highlight-src';
const SRC_MILITARY_SHIPS_SELECTED = 'military-ships-selected-src';
const SRC_GLOBAL_TRAFFIC = 'global-traffic-src';    // Trafic AIS mondial (civils/étrangers)
const SRC_SUBMARINE_CABLES = 'submarine-cables-src';
const SRC_SUBMARINE_CABLES_LANDINGS = 'submarine-cables-landings-src';
const SRC_TELECOM = 'telecom-src';
const SRC_POWER = 'power-src';
const SRC_HOSPITALS = 'hospitals-src';

const LYR_MILITARY_ZONES_FILL = 'military-zones-fill';
const LYR_MILITARY_ZONES_LINE = 'military-zones-line';
const LYR_MILITARY_BASES_CIRCLE = 'military-bases-circle';
const LYR_MILITARY_BASES_LABEL = 'military-bases-label';
const LYR_MILITARY_FLIGHT_TRAILS = 'military-flight-trails';
const LYR_MILITARY_FLIGHTS = 'military-flights';
const LYR_MILITARY_FLIGHTS_LABEL = 'military-flights-label';
const LYR_AIR_TRAFFIC_LABEL = 'air-traffic-label';
const LYR_MILITARY_SHIPS = 'military-ships';
const LYR_MILITARY_SHIPS_HIGHLIGHT = 'military-ships-highlight';
const LYR_MILITARY_SHIPS_SELECTED = 'military-ships-selected';
// const LYR_GLOBAL_TRAFFIC = 'global-traffic-pts'; // Now rendered via Deck.gl TextLayer
const LYR_SUBMARINE_CABLES = 'submarine-cables-line';
const LYR_SUBMARINE_CABLES_GLOW = 'submarine-cables-glow';
const LYR_SUBMARINE_CABLES_CORE = 'submarine-cables-core';
const LYR_SUBMARINE_CABLES_HITAREA = 'submarine-cables-hitarea';
const LYR_SUBMARINE_CABLES_LANDING = 'submarine-cables-landing';
const LYR_TELECOM_PTS = 'telecom-pts';
const LYR_POWER_FILL = 'power-fill';
const LYR_POWER_LINE = 'power-line';
const SRC_POWER_TENSION = 'power-tension-src';
const LYR_POWER_TENSION_FILL = 'power-tension-fill';
const LYR_POWER_TENSION_LINE = 'power-tension-line';
const SRC_CITIZEN_ZONES = 'citizen-zones-src';
const LYR_CITIZEN_FILL = 'citizen-zones-fill';
const LYR_CITIZEN_LINE = 'citizen-zones-line';
const SRC_TERMINATOR = 'terminator-src';
const LYR_TERMINATOR = 'terminator-fill';
const SRC_NET_ISP = 'net-isp-src';
const SRC_NET_IODA = 'net-ioda-src';
const LYR_NET_ISP_GLOW = 'net-isp-glow';   // halo ambiant
const LYR_NET_ISP_RING = 'net-isp-ring';   // anneau creux
const LYR_NET_ISP = 'net-isp-pts';    // point central
const LYR_NET_IODA_GLOW = 'net-ioda-glow';
const LYR_NET_IODA_CORE = 'net-ioda-core';
const SRC_DC = 'infra-dc-src';
const SRC_IXP = 'infra-ixp-src';
const LYR_DC_GLOW = 'infra-dc-glow';
const LYR_DC_CORE = 'infra-dc-core';
const LYR_IXP_CIRCLE = 'infra-ixp-circle';
const LYR_HOSPITALS_CHU = 'hospitals-chu';
const LYR_HOSPITALS_CH = 'hospitals-ch';
const LYR_HOSPITALS_LABEL = 'hospitals-label';
const SRC_MAIRES_POL = 'maires-pol-src';
const LYR_MAIRES_POL = 'maires-pol';
const LYR_MAIRES_POL_LABEL = 'maires-pol-label';


// ─── Ecowatt signal → color ───
const ECOWATT_COLORS: Record<EcowattSignal, string> = {
  green: 'rgba(52,199,89,0.15)',
  orange: 'rgba(255,149,0,0.25)',
  red: 'rgba(255,59,48,0.30)',
};

// ─── Météo vigilance → color ───
const METEO_COLORS: Record<string, string> = {
  green: 'rgba(52,199,89,0.08)',
  yellow: 'rgba(255,204,0,0.20)',
  orange: 'rgba(255,149,0,0.28)',
  red: 'rgba(255,59,48,0.35)',
  violet: 'rgba(175,82,222,0.35)',
};

// ─── Météo risk pictograms ───
const WEATHER_RISK_EMOJIS: Record<string, string> = {
  'wind': '💨',
  'rain-flood': '🌧️',
  'thunderstorm': '⛈️',
  'flood': '🌊',
  'snow-ice': '❄️',
  'heat': '🌡️',
  'cold': '🥶',
  'avalanche': '🏔️',
  'wave-surge': '🌊',
};

// ═══════════════════════════════════════════════════════════════════════════
// ENERGY FLOW STYLES — Distinct visual styles for electricity, gas, and oil
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Electric flow style: Red/green neon with pronounced glow effect
 * Continuous plasma-like appearance, bright and energetic
 */
export const ELECTRIC_FLOW_STYLE = {
  // Colors: OSINT style — red/orange import, green export
  importColor: '#FF4B4B',      // Rouge-orange for import (into France)
  exportColor: '#16A34A',      // Vert un peu plus fonce pour export (out of France)
  glowImportColor: '#FF6B6B',  // Softer red glow
  glowExportColor: '#15803D',  // Deeper green glow
  // Line properties
  minLineWidth: 3,
  maxLineWidth: 10,
  lineWidthDivisor: 600,       // flowMW / 600 for width scaling
  glowIntensity: 3.0,          // Glow width multiplier (configurable)
  glowOpacity: 0.4,
  glowBlur: 10,
  lineOpacity: 0.95,
  // Chevron animation
  chevronSpacing: 50,          // Distance between chevrons (px)
  chevronSpeed: 0.5,           // Animation speed (0.1 = slow, 1.0 = fast)
  chevronSize: 1.2,            // Base chevron size multiplier (bigger)
  // Arc geometry
  curvature: 0.25,
  steps: 50,
};

// Mutable config for runtime updates
let electricFlowConfig = { ...ELECTRIC_FLOW_STYLE };

/** Update electric flow config at runtime */
export function setElectricFlowConfig(config: Partial<typeof ELECTRIC_FLOW_STYLE>): void {
  electricFlowConfig = { ...electricFlowConfig, ...config };
}

/** Get current electric flow config */
export function getElectricFlowConfig(): typeof ELECTRIC_FLOW_STYLE {
  return electricFlowConfig;
}

/**
 * Gas flow style: Cyan/turquoise with softer glow
 * Thinner arcs, rapid dash animation to suggest pipeline flow
 */
export const GAS_FLOW_STYLE = {
  // Colors: import = violet électrique, export = cyan électrique
  importColor: '#A855F7',      // Purple-500 : import (FR reçoit)
  exportColor: '#06B6D4',      // Cyan-500   : export (FR envoie)
  glowImportColor: '#7C3AED',  // Violet-600 : halo import
  glowExportColor: '#0891B2',  // Cyan-600   : halo export
  // Line properties: Thinner than electricity
  minLineWidth: 2,
  maxLineWidth: 6,
  lineWidthDivisor: 80,        // flowGWhDay / 80 for width scaling
  glowMultiplier: 2.0,         // Softer glow (2x line width)
  glowOpacity: 0.25,
  glowBlur: 6,
  lineOpacity: 0.85,
  // Animation: chevron points (no dasharray)
  animationSpeed: 0.8,         // Faster than electricity
  animationCycle: 16,
  // Arc geometry
  curvature: 0.22,
  steps: 45,
} as const;

/**
 * Oil flow style: Brown/anthracite with amber glow
 * Thick arcs, slow dash animation to suggest viscous flow
 */
export const OIL_FLOW_STYLE = {
  // Colors: Amber lumineux (export) / Rouille sombre (import) — palette pétrole
  exportColor: '#F59E0B',      // Amber-500 — ambre chaud lumineux
  importColor: '#C2410C',      // Orange-700 — rouille sombre (distinct de l'élec rouge)
  glowExportColor: '#FCD34D',  // Amber-300 — glow doré léger
  glowImportColor: '#EA580C',  // Orange-600 — glow rouille
  // Line properties: Thicker than others (viscous feel)
  minLineWidth: 4,
  maxLineWidth: 12,
  lineWidthDivisor: 50,        // flowKbd / 50 for width scaling (thousands barrels/day)
  glowMultiplier: 2.2,
  glowOpacity: 0.3,
  glowBlur: 6,
  lineOpacity: 0.9,
  // Animation: Slow chevrons to suggest heavy/viscous flow
  animationSpeed: 0.45,        // Assez visible (arcs longs = peu de chevrons à l'écran)
  // Arc geometry
  curvature: 0.28,
  steps: 50,
} as const;

type SubmarineCableProperties = {
  id?: string;
  name?: string;
  landing_points?: string[] | string;
  length_km?: number | string;
  rfs_year?: number | string;
  owner?: string;
  capacity_tbps?: number | string;
};

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function normalizeLandingPoints(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v)).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(v => String(v)).filter(Boolean) : [value];
    } catch {
      return value.split(/[,;]+/).map(v => v.trim()).filter(Boolean);
    }
  }
  return [];
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function buildSubmarineLandingPoints(
  data: GeoJSON.FeatureCollection<GeoJSON.LineString>
): GeoJSON.FeatureCollection<GeoJSON.Point, Record<string, unknown>> {
  return {
    type: 'FeatureCollection',
    features: data.features.flatMap((feature) => {
      const coordinates = feature.geometry?.coordinates ?? [];
      if (coordinates.length < 2) return [];
      const props = (feature.properties ?? {}) as SubmarineCableProperties;
      const landingPoints = normalizeLandingPoints(props.landing_points);
      const cableName = props.name ?? 'Câble';
      const shared = {
        cableId: props.id ?? cableName,
        name: cableName,
        owner: props.owner ?? '',
        capacity_tbps: props.capacity_tbps ?? null,
        rfs_year: props.rfs_year ?? null,
        length_km: props.length_km ?? null,
      };

      return [
        {
          type: 'Feature' as const,
          id: `${shared.cableId}-landing-a`,
          geometry: { type: 'Point' as const, coordinates: coordinates[0] },
          properties: { ...shared, landingLabel: landingPoints[0] ?? 'Atterrage 1', landingSide: 'A' },
        },
        {
          type: 'Feature' as const,
          id: `${shared.cableId}-landing-b`,
          geometry: { type: 'Point' as const, coordinates: coordinates[coordinates.length - 1] },
          properties: { ...shared, landingLabel: landingPoints[landingPoints.length - 1] ?? 'Atterrage 2', landingSide: 'B' },
        },
      ];
    }),
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildSubseaCableTooltip(properties: Record<string, unknown>): string {
  const p = properties as SubmarineCableProperties & { landingLabel?: string };
  const name = p.name ?? p.landingLabel ?? 'Liaison sous-marine';
  const landingPoints = normalizeLandingPoints(p.landing_points);
  const lengthKm = toNumber(p.length_km);
  const rfsYear = toNumber(p.rfs_year);
  const capacityTbps = toNumber(p.capacity_tbps);
  const owners = String(p.owner ?? '')
    .split(',')
    .map((owner) => owner.trim())
    .filter(Boolean);

  const meta: string[] = [];
  if (lengthKm != null) meta.push(`${new Intl.NumberFormat('fr-FR').format(lengthKm)} km`);
  if (capacityTbps != null) meta.push(`${capacityTbps} Tbps`);
  if (rfsYear != null) meta.push(`RFS ${rfsYear}`);

  const derived: string[] = [];
  if (landingPoints.length > 0) derived.push(`${landingPoints.length} point${landingPoints.length > 1 ? 's' : ''} d’atterrage`);
  if (owners.length > 0) derived.push(`${owners.length} opérateur${owners.length > 1 ? 's' : ''}`);
  if (rfsYear != null) {
    const age = new Date().getFullYear() - rfsYear;
    if (age >= 0) derived.push(age === 0 ? 'mise en service cette année' : `${age} an${age > 1 ? 's' : ''} d’ancienneté`);
  }

  return `
    <div style="display:flex; flex-direction:column; gap:6px;">
      <div>
        <strong style="color:#7dd3fc;">${escapeHtml(name)}</strong>
        ${landingPoints.length > 0 ? `<div style="color:#cbd5e1; font-size:11px; margin-top:2px;">${escapeHtml(landingPoints.join(' ↔ '))}</div>` : ''}
      </div>
      ${meta.length > 0 ? `<div style="color:#94a3b8; font-size:10px;">${escapeHtml(meta.join(' · '))}</div>` : ''}
      ${owners.length > 0 ? `<div style="color:#e2e8f0; font-size:10px;">Consortium: ${escapeHtml(owners.slice(0, 3).join(', '))}${owners.length > 3 ? ` +${owners.length - 3}` : ''}</div>` : ''}
      ${derived.length > 0 ? `<div style="color:#67e8f9; font-size:10px;">${escapeHtml(derived.join(' · '))}</div>` : ''}
    </div>
  `;
}

const AIS_DESTINATION_ALIASES: Record<string, string> = {
  // ─── France ───
  'ST NAZAIRE': 'Saint-Nazaire',
  'SAINT NAZAIRE': 'Saint-Nazaire',
  'ST MALO': 'Saint-Malo',
  'SAINT MALO': 'Saint-Malo',
  'ST MALO FRANCE': 'Saint-Malo',
  'LE HAVRE': 'Le Havre',
  'LE HAVRE FRANCE': 'Le Havre',
  'LEHAVRE': 'Le Havre',
  'MARSEILLE': 'Marseille',
  'MARSEILLE FR': 'Marseille',
  'TOULON': 'Toulon',
  'BREST': 'Brest',
  'BREST FRANCE': 'Brest',
  'ROUEN': 'Rouen',
  'ROUEN FRANCE': 'Rouen',
  'DUNKERQUE': 'Dunkerque',
  'DUNKIRK': 'Dunkerque',
  'CALAIS': 'Calais',
  'BOULOGNE': 'Boulogne-sur-Mer',
  'BOULOGNE SUR MER': 'Boulogne-sur-Mer',
  'CHERBOURG': 'Cherbourg',
  'DIEPPE': 'Dieppe',
  'LA ROCHELLE': 'La Rochelle',
  'LA ROCHELLE FR': 'La Rochelle',
  'BORDEAUX': 'Bordeaux',
  'LORIENT': 'Lorient',
  'NANTES': 'Nantes',
  'SETE': 'Sète',
  'FOS SUR MER': 'Fos-sur-Mer',
  'FOS': 'Fos-sur-Mer',
  'NICE': 'Nice',
  'CANNES': 'Cannes',
  'AJACCIO': 'Ajaccio',
  'BASTIA': 'Bastia',
  'BAYONNE': 'Bayonne',
  'PORT VENDRES': 'Port-Vendres',
  'LA HAVRE': 'Le Havre',       // faute fréquente en AIS
  // ─── Belgique / Pays-Bas ───
  'ANTWERP': 'Anvers',
  'ANTWERPEN': 'Anvers',
  'ZEEBRUGGE': 'Zeebrugge',
  'ROTTERDAM': 'Rotterdam',
  'AMSTERDAM': 'Amsterdam',
  'VLISSINGEN': 'Flessingue',
  'FLUSHING': 'Flessingue',
  'TERNEUZEN': 'Terneuzen',
  'DEN HAAG': 'La Haye',
  'DENHAAG': 'La Haye',
  'DEN HAAG NL': 'La Haye',
  'THE HAGUE': 'La Haye',
  'IJMUIDEN': 'IJmuiden',
  // ─── Allemagne ───
  'HAMBURG': 'Hambourg',
  'HAMBURG DE': 'Hambourg',
  'BREMERHAVEN': 'Bremerhaven',
  'BREMEN': 'Brême',
  'KIEL': 'Kiel',
  'ROSTOCK': 'Rostock',
  'LUBECK': 'Lübeck',
  // ─── Royaume-Uni ───
  'SOUTHAMPTON': 'Southampton',
  'SOUTHAMPTON UK': 'Southampton',
  'FELIXSTOWE': 'Felixstowe',
  'TILBURY': 'Tilbury',
  'LONDON': 'Londres',
  'LIVERPOOL': 'Liverpool',
  'HULL': 'Hull',
  'IMMINGHAM': 'Immingham',
  'PORTSMOUTH': 'Portsmouth',
  'DOVER': 'Douvres',
  'NEWHAVEN': 'Newhaven',
  'HARWICH': 'Harwich',
  'ABERDEEN': 'Aberdeen',
  'GLASGOW': 'Glasgow',
  'BRISTOL': 'Bristol',
  'FALMOUTH': 'Falmouth',
  'PLYMOUTH': 'Plymouth',
  // ─── Espagne ───
  'BARCELONA': 'Barcelone',
  'ALGECIRAS': 'Algésiras',
  'VALENCIA': 'Valence',
  'BILBAO': 'Bilbao',
  'VIGO': 'Vigo',
  'LAS PALMAS': 'Las Palmas',
  'CADIZ': 'Cadix',
  // ─── Portugal ───
  'LISBON': 'Lisbonne',
  'LISBOA': 'Lisbonne',
  'PORTO': 'Porto',
  'LEIXOES': 'Leixões',
  'SETUBAL': 'Setúbal',
  // ─── Italie ───
  'GENOA': 'Gênes',
  'GENES': 'Gênes',
  'LIVORNO': 'Livourne',
  'NAPLES': 'Naples',
  'NAPOLI': 'Naples',
  'VENICE': 'Venise',
  'VENEZIA': 'Venise',
  'TRIESTE': 'Trieste',
  'ANCONA': 'Ancône',
  'PALERMO': 'Palerme',
  'CIVITAVECCHIA': 'Civitavecchia',
  'TARANTO': 'Tarente',
  // ─── Grèce / Turquie ───
  'PIRAEUS': 'Pirée',
  'PIREUS': 'Pirée',
  'THESSALONIKI': 'Thessalonique',
  'ISTANBUL': 'Istanbul',
  'MERSIN': 'Mersin',
  'IZMIR': 'Izmir',
  // ─── Mer du Nord / Baltique ───
  'GOTHENBURG': 'Göteborg',
  'GOTEBORG': 'Göteborg',
  'STOCKHOLM': 'Stockholm',
  'OSLO': 'Oslo',
  'BERGEN': 'Bergen',
  'COPENHAGEN': 'Copenhague',
  'KOBENHAVN': 'Copenhague',
  'HELSINKI': 'Helsinki',
  'TALLINN': 'Tallinn',
  'RIGA': 'Riga',
  'KLAIPEDA': 'Klaipėda',
  'GDANSK': 'Gdańsk',
  'GDYNIA': 'Gdynia',
  'ST PETERSBURG': 'Saint-Pétersbourg',
  'SAINT PETERSBURG': 'Saint-Pétersbourg',
  // ─── Méditerranée / Afrique du Nord ───
  'TUNIS': 'Tunis',
  'ALGIERS': 'Alger',
  'ALGER': 'Alger',
  'CASABLANCA': 'Casablanca',
  'TANGER': 'Tanger',
  'TANGIER': 'Tanger',
  'TRIPOLI': 'Tripoli',
  'ALEXANDRIA': 'Alexandrie',
  'PORT SAID': 'Port-Saïd',
  'SUEZ': 'Suez',
  // ─── Moyen-Orient ───
  'DUBAI': 'Dubaï',
  'JEBEL ALI': 'Jebel Ali',
  'ABU DHABI': 'Abu Dhabi',
  'JEDDAH': 'Djeddah',
  'DJEDDA': 'Djeddah',
  'KUWAIT': 'Koweït',
  'DOHA': 'Doha',
  'BANDAR ABBAS': 'Bandar Abbas',
  // ─── Asie ───
  'SINGAPORE': 'Singapour',
  'HONG KONG': 'Hong Kong',
  'SHANGHAI': 'Shanghai',
  'SHENZHEN': 'Shenzhen',
  'NINGBO': 'Ningbo',
  'TIANJIN': 'Tianjin',
  'QINGDAO': 'Qingdao',
  'GUANGZHOU': 'Guangzhou',
  'TOKYO': 'Tokyo',
  'OSAKA': 'Osaka',
  'KOBE': 'Kobe',
  'NAGOYA': 'Nagoya',
  'BUSAN': 'Busan',
  'INCHEON': 'Incheon',
  'KAOHSIUNG': 'Kaohsiung',
  'MUMBAI': 'Mumbai',
  'BOMBAY': 'Mumbai',
  'NHAVA SHEVA': 'Nhava Sheva',
  'CHENNAI': 'Chennai',
  'MADRAS': 'Chennai',
  'BANGKOK': 'Bangkok',
  'LAEM CHABANG': 'Laem Chabang',
  'HO CHI MINH': 'Ho Chi Minh-Ville',
  'HOCHIMINH': 'Ho Chi Minh-Ville',
  'HAIPHONG': 'Haïphong',
  'PORT KLANG': 'Port Klang',
  'PENANG': 'Penang',
  'MANILA': 'Manille',
  // ─── Amériques ───
  'NEW YORK': 'New York',
  'LOS ANGELES': 'Los Angeles',
  'HOUSTON': 'Houston',
  'NEW ORLEANS': 'La Nouvelle-Orléans',
  'MIAMI': 'Miami',
  'SAVANNAH': 'Savannah',
  'BALTIMORE': 'Baltimore',
  'NORFOLK': 'Norfolk',
  'BOSTON': 'Boston',
  'CHARLESTON': 'Charleston',
  'MONTREAL': 'Montréal',
  'VANCOUVER': 'Vancouver',
  'HALIFAX': 'Halifax',
  'VERACRUZ': 'Veracruz',
  'SANTOS': 'Santos',
  'RIO DE JANEIRO': 'Rio de Janeiro',
  'BUENOS AIRES': 'Buenos Aires',
  'VALPARAISO': 'Valparaíso',
  'CALLAO': 'Callao',
  // ─── Afrique subsaharienne ───
  'LAGOS': 'Lagos',
  'CAPE TOWN': 'Le Cap',
  'DURBAN': 'Durban',
  'MOMBASA': 'Mombasa',
  'DAR ES SALAAM': 'Dar Es Salaam',
  'DJIBOUTI': 'Djibouti',
  // ─── Océanie ───
  'SYDNEY': 'Sydney',
  'MELBOURNE': 'Melbourne',
  'BRISBANE': 'Brisbane',
  'FREMANTLE': 'Fremantle',
  'AUCKLAND': 'Auckland',
};

const AIS_PORT_LOCODES: Record<string, { name: string; country: string }> = {
  // ─── France métropolitaine ───
  FRLEH: { name: 'Le Havre', country: 'FR' },
  FRROU: { name: 'Rouen', country: 'FR' },
  FRHON: { name: 'Honfleur', country: 'FR' },
  FRCAL: { name: 'Calais', country: 'FR' },
  FRDKK: { name: 'Dunkerque', country: 'FR' },
  FRBLT: { name: 'Boulogne-sur-Mer', country: 'FR' },
  FRDIE: { name: 'Dieppe', country: 'FR' },
  FRCHB: { name: 'Cherbourg', country: 'FR' },
  FRCBR: { name: 'Cherbourg-Octeville', country: 'FR' },
  FRGRA: { name: 'Granville', country: 'FR' },
  FRSML: { name: 'Saint-Malo', country: 'FR' },
  FRQUI: { name: 'Quimper', country: 'FR' },
  FRBRE: { name: 'Brest', country: 'FR' },
  FRBES: { name: 'Brest', country: 'FR' },
  FRULH: { name: 'Lorient', country: 'FR' },
  FRLRT: { name: 'Lorient', country: 'FR' },
  FRVAN: { name: 'Vannes', country: 'FR' },
  FRSTN: { name: 'Saint-Nazaire', country: 'FR' },
  FRSNI: { name: 'Saint-Nazaire', country: 'FR' },
  FRNTS: { name: 'Nantes', country: 'FR' },
  FRNTE: { name: 'Nantes', country: 'FR' },
  FRLRH: { name: 'La Rochelle', country: 'FR' },
  FRLRX: { name: 'La Rochelle', country: 'FR' },
  FRROS: { name: 'Rochefort', country: 'FR' },
  FRBAY: { name: 'Bayonne', country: 'FR' },
  FRBOD: { name: 'Bordeaux', country: 'FR' },
  FRLCR: { name: 'La Cotinière', country: 'FR' },
  FRMRS: { name: 'Marseille', country: 'FR' },
  FRFOS: { name: 'Fos-sur-Mer', country: 'FR' },
  FRSET: { name: 'Sète', country: 'FR' },
  FRAGO: { name: 'Agde', country: 'FR' },
  FRPLN: { name: 'Port-la-Nouvelle', country: 'FR' },
  FRTLN: { name: 'Toulon', country: 'FR' },
  FRCRY: { name: 'Cannes', country: 'FR' },
  FRANT: { name: 'Antibes', country: 'FR' },
  FRNCL: { name: 'Nice', country: 'FR' },
  FRNCE: { name: 'Nice', country: 'FR' },
  FRMNC: { name: 'Monaco', country: 'MC' },
  FRSRG: { name: 'Strasbourg', country: 'FR' },
  FRSTR: { name: 'Strasbourg', country: 'FR' },
  FRLIO: { name: 'Lyon', country: 'FR' },
  FRTPE: { name: 'Port de Trompeloup', country: 'FR' },
  // ─── France — Corse ───
  FRAIS: { name: 'Ajaccio', country: 'FR' },
  FRBST: { name: 'Bastia', country: 'FR' },
  FRPRY: { name: 'Propriano', country: 'FR' },
  FRBN: { name: 'Bonifacio', country: 'FR' },
  FRILE: { name: 'Île-Rousse', country: 'FR' },
  FRCAL2: { name: 'Calvi', country: 'FR' },
  FRPVC: { name: 'Porto-Vecchio', country: 'FR' },
  // ─── France — DROM ───
  FRPTP: { name: 'Pointe-à-Pitre', country: 'FR' },
  FRMAR: { name: 'Fort-de-France', country: 'FR' },
  FRKYR: { name: 'Cayenne', country: 'FR' },
  FRRUN: { name: 'La Réunion', country: 'FR' },
  FRMAM: { name: 'Mamoudzou', country: 'FR' },
  // ─── Belgique ───
  BEANR: { name: 'Anvers', country: 'BE' },
  BEZEE: { name: 'Zeebrugge', country: 'BE' },
  BEGNE: { name: 'Gand', country: 'BE' },
  BEOST: { name: 'Ostende', country: 'BE' },
  // ─── Pays-Bas ───
  NLRTM: { name: 'Rotterdam', country: 'NL' },
  NLAMS: { name: 'Amsterdam', country: 'NL' },
  NLTBU: { name: 'Terneuzen', country: 'NL' },
  NLFLS: { name: 'Flessingue', country: 'NL' },
  NLVLI: { name: 'Vlissingen', country: 'NL' },
  // ─── Allemagne ───
  DEHAM: { name: 'Hambourg', country: 'DE' },
  DEBRE: { name: 'Brême', country: 'DE' },
  DEBRV: { name: 'Bremerhaven', country: 'DE' },
  DEKIL: { name: 'Kiel', country: 'DE' },
  DELBC: { name: 'Lübeck', country: 'DE' },
  DEROS: { name: 'Rostock', country: 'DE' },
  // ─── Royaume-Uni ───
  GBSOU: { name: 'Southampton', country: 'GB' },
  GBFXT: { name: 'Felixstowe', country: 'GB' },
  GBTIL: { name: 'Tilbury', country: 'GB' },
  GBIMM: { name: 'Immingham', country: 'GB' },
  GBHUL: { name: 'Hull', country: 'GB' },
  GBGOO: { name: 'Goole', country: 'GB' },
  GBLON: { name: 'Londres', country: 'GB' },
  GBLIV: { name: 'Liverpool', country: 'GB' },
  GBMAN: { name: 'Manchester', country: 'GB' },
  GBABZ: { name: 'Aberdeen', country: 'GB' },
  GBEDI: { name: 'Édimbourg', country: 'GB' },
  GBBRS: { name: 'Bristol', country: 'GB' },
  GBPLY: { name: 'Plymouth', country: 'GB' },
  GBFAL: { name: 'Falmouth', country: 'GB' },
  GBDVR: { name: 'Douvres', country: 'GB' },
  GBHRW: { name: 'Harwich', country: 'GB' },
  GBNHV: { name: 'Newhaven', country: 'GB' },
  GBPME: { name: 'Portsmouth', country: 'GB' },
  // ─── Espagne ───
  ESBCN: { name: 'Barcelone', country: 'ES' },
  ESALG: { name: 'Algésiras', country: 'ES' },
  ESVLC: { name: 'Valence', country: 'ES' },
  ESBIO: { name: 'Bilbao', country: 'ES' },
  ESVGO: { name: 'Vigo', country: 'ES' },
  ESCAD: { name: 'Cadix', country: 'ES' },
  ESCAR: { name: 'Carthagène', country: 'ES' },
  ESALC: { name: 'Alicante', country: 'ES' },
  ESPAS: { name: 'Las Palmas', country: 'ES' },
  ESSAG: { name: 'Sagunto', country: 'ES' },
  // ─── Portugal ───
  PTLIS: { name: 'Lisbonne', country: 'PT' },
  PTOPB: { name: 'Porto', country: 'PT' },
  PTSET: { name: 'Setúbal', country: 'PT' },
  PTFNC: { name: 'Funchal', country: 'PT' },
  // ─── Italie ───
  ITGOA: { name: 'Gênes', country: 'IT' },
  ITLIV: { name: 'Livourne', country: 'IT' },
  ITNAP: { name: 'Naples', country: 'IT' },
  ITTRS: { name: 'Trieste', country: 'IT' },
  ITVCE: { name: 'Venise', country: 'IT' },
  ITCVV: { name: 'Civitavecchia', country: 'IT' },
  ITPAL: { name: 'Palerme', country: 'IT' },
  ITAUG: { name: 'Augusta', country: 'IT' },
  ITTSO: { name: 'Tarante', country: 'IT' },
  ITANC: { name: 'Ancône', country: 'IT' },
  // ─── Grèce ───
  GRPIR: { name: 'Pirée', country: 'GR' },
  GRTHE: { name: 'Thessalonique', country: 'GR' },
  GRPAT: { name: 'Patras', country: 'GR' },
  GRIRA: { name: 'Héraklion', country: 'GR' },
  // ─── Turquie ───
  TRIST: { name: 'Istanbul', country: 'TR' },
  TRMER: { name: 'Mersin', country: 'TR' },
  TRIZM: { name: 'Izmir', country: 'TR' },
  // ─── Scandinavie ───
  SESTO: { name: 'Stockholm', country: 'SE' },
  SEGOT: { name: 'Göteborg', country: 'SE' },
  SEMMA: { name: 'Malmö', country: 'SE' },
  NOBGO: { name: 'Bergen', country: 'NO' },
  NOOSL: { name: 'Oslo', country: 'NO' },
  NOSVG: { name: 'Stavanger', country: 'NO' },
  DKAAR: { name: 'Aarhus', country: 'DK' },
  DKCPH: { name: 'Copenhague', country: 'DK' },
  FIHEL: { name: 'Helsinki', country: 'FI' },
  FITKU: { name: 'Turku', country: 'FI' },
  // ─── Baltique ───
  PLGDN: { name: 'Gdańsk', country: 'PL' },
  PLSZZ: { name: 'Szczecin', country: 'PL' },
  RULED: { name: 'Saint-Pétersbourg', country: 'RU' },
  RUULU: { name: 'Ust-Luga', country: 'RU' },
  EETAL: { name: 'Tallinn', country: 'EE' },
  LVRIX: { name: 'Riga', country: 'LV' },
  LTKLJ: { name: 'Klaipėda', country: 'LT' },
  // ─── Mer Noire ───
  UAODS: { name: 'Odessa', country: 'UA' },
  BGSOF: { name: 'Varna', country: 'BG' },
  ROBRA: { name: 'Constanţa', country: 'RO' },
  // ─── Afrique du Nord ───
  TNTUN: { name: 'Tunis', country: 'TN' },
  TNSFA: { name: 'Sfax', country: 'TN' },
  DZALG: { name: 'Alger', country: 'DZ' },
  DZAAE: { name: 'Annaba', country: 'DZ' },
  MACAS: { name: 'Casablanca', country: 'MA' },
  MATNG: { name: 'Tanger', country: 'MA' },
  LYTRP: { name: 'Tripoli', country: 'LY' },
  EGPSD: { name: 'Port-Saïd', country: 'EG' },
  EGALY: { name: 'Alexandrie', country: 'EG' },
  EGSUZ: { name: 'Suez', country: 'EG' },
  // ─── Moyen-Orient ───
  AEDXB: { name: 'Dubaï', country: 'AE' },
  AEJEA: { name: 'Jebel Ali', country: 'AE' },
  AEAUH: { name: 'Abu Dhabi', country: 'AE' },
  SAJUB: { name: 'Jubail', country: 'SA' },
  SAJED: { name: 'Djeddah', country: 'SA' },
  KWKWI: { name: 'Koweït', country: 'KW' },
  IQBSR: { name: 'Bassora', country: 'IQ' },
  IRBAN: { name: 'Bandar Abbas', country: 'IR' },
  OMMSQ: { name: 'Mascate', country: 'OM' },
  QADHB: { name: 'Doha', country: 'QA' },
  // ─── Asie ───
  CNSHA: { name: 'Shanghai', country: 'CN' },
  CNNGB: { name: 'Ningbo', country: 'CN' },
  CNQIN: { name: 'Qingdao', country: 'CN' },
  CNSZN: { name: 'Shenzhen', country: 'CN' },
  CNTSN: { name: 'Tianjin', country: 'CN' },
  CNCAN: { name: 'Guangzhou', country: 'CN' },
  CNGZH: { name: 'Guangzhou', country: 'CN' },
  CNTAO: { name: 'Qingdao', country: 'CN' },
  HKHKG: { name: 'Hong Kong', country: 'HK' },
  SGSIN: { name: 'Singapour', country: 'SG' },
  JPOSA: { name: 'Osaka', country: 'JP' },
  JPTYO: { name: 'Tokyo', country: 'JP' },
  JPNGO: { name: 'Nagoya', country: 'JP' },
  JPKOB: { name: 'Kobe', country: 'JP' },
  KRBSA: { name: 'Busan', country: 'KR' },
  KRICN: { name: 'Incheon', country: 'KR' },
  TWKHH: { name: 'Kaohsiung', country: 'TW' },
  TWTPE: { name: 'Taipei', country: 'TW' },
  INBOM: { name: 'Mumbai', country: 'IN' },
  INNHV: { name: 'Nhava Sheva', country: 'IN' },
  INMAA: { name: 'Chennai', country: 'IN' },
  INNSA: { name: 'Nhava Sheva', country: 'IN' },
  THBKK: { name: 'Bangkok', country: 'TH' },
  THLCB: { name: 'Laem Chabang', country: 'TH' },
  VNSGN: { name: 'Ho Chi Minh-Ville', country: 'VN' },
  VNHPH: { name: 'Haiphong', country: 'VN' },
  PHMNL: { name: 'Manille', country: 'PH' },
  IDBTH: { name: 'Batam', country: 'ID' },
  IDBLW: { name: 'Belawan', country: 'ID' },
  MYPKG: { name: 'Port Klang', country: 'MY' },
  MYPEN: { name: 'Penang', country: 'MY' },
  MYSRB: { name: 'Kota Kinabalu', country: 'MY' },
  // ─── Amériques ───
  USNYC: { name: 'New York', country: 'US' },
  USLAX: { name: 'Los Angeles', country: 'US' },
  USHOU: { name: 'Houston', country: 'US' },
  USNOR: { name: 'Norfolk', country: 'US' },
  USSAV: { name: 'Savannah', country: 'US' },
  USBOS: { name: 'Boston', country: 'US' },
  USBAL: { name: 'Baltimore', country: 'US' },
  USNOA: { name: 'La Nouvelle-Orléans', country: 'US' },
  USMIA: { name: 'Miami', country: 'US' },
  USCHA: { name: 'Charleston', country: 'US' },
  CAHAL: { name: 'Halifax', country: 'CA' },
  CAMTR: { name: 'Montréal', country: 'CA' },
  CAVCR: { name: 'Vancouver', country: 'CA' },
  MXVER: { name: 'Veracruz', country: 'MX' },
  MXLZC: { name: 'Lázaro Cárdenas', country: 'MX' },
  PABAQ: { name: 'Balboa (Panamá)', country: 'PA' },
  BRSSZ: { name: 'Santos', country: 'BR' },
  BRRIO: { name: 'Rio de Janeiro', country: 'BR' },
  BRSFS: { name: 'São Luís', country: 'BR' },
  ARBUE: { name: 'Buenos Aires', country: 'AR' },
  ARROS: { name: 'Rosario', country: 'AR' },
  CLVAL: { name: 'Valparaíso', country: 'CL' },
  PECLL: { name: 'Callao (Lima)', country: 'PE' },
  COBAQ: { name: 'Barranquilla', country: 'CO' },
  // ─── Afrique subsaharienne ───
  NGAPP: { name: 'Lagos (Apapa)', country: 'NG' },
  ZACPT: { name: 'Le Cap', country: 'ZA' },
  ZADUR: { name: 'Durban', country: 'ZA' },
  TZDAR: { name: 'Dar Es Salaam', country: 'TZ' },
  KEMBA: { name: 'Mombasa', country: 'KE' },
  DJJIB: { name: 'Djibouti', country: 'DJ' },
  // ─── Océanie ───
  AUSYD: { name: 'Sydney', country: 'AU' },
  AUMEL: { name: 'Melbourne', country: 'AU' },
  AUBNE: { name: 'Brisbane', country: 'AU' },
  AUFRM: { name: 'Fremantle', country: 'AU' },
  AUDLP: { name: 'Darwin', country: 'AU' },
  NZAKL: { name: 'Auckland', country: 'NZ' },
  NZWLG: { name: 'Wellington', country: 'NZ' },
  // ─── Pseudo-LOCODEs fréquents en AIS (abréviations non-standard) ───
  DENHA: { name: 'La Haye', country: 'NL' },       // "DEN HAAG" tronqué dans l'AIS
  NLIJD: { name: 'IJmuiden', country: 'NL' },
  NLFJL: { name: 'Flessingue', country: 'NL' },
  GBGRK: { name: 'Grangemouth', country: 'GB' },
  GBLEI: { name: 'Leith (Édimbourg)', country: 'GB' },
  GBDVS: { name: 'Douvres', country: 'GB' },
  FRLTQ: { name: 'Le Touquet', country: 'FR' },
  FRCHN: { name: 'Cherbourg', country: 'FR' },
  FRLOR: { name: 'Lorient', country: 'FR' },
};

/** Get emoji for primary risk */
function getWeatherRiskEmoji(risks: string[]): string {
  if (risks.length === 0) return '⚠️';
  return WEATHER_RISK_EMOJIS[risks[0]] ?? '⚠️';
}

// ─── Météo department centroids [lng, lat] ───
const WEATHER_DEPT_CENTROIDS: Record<string, [number, number]> = {
  '01': [5.22, 46.00], '02': [3.62, 49.47], '03': [3.19, 46.39], '04': [6.24, 44.08],
  '05': [6.26, 44.66], '06': [7.12, 43.94], '07': [4.42, 44.75], '08': [4.62, 49.62],
  '09': [1.60, 42.92], '10': [4.08, 48.30], '11': [2.42, 43.11], '12': [2.67, 44.28],
  '13': [5.05, 43.54], '14': [-0.37, 49.09], '15': [2.67, 45.05], '16': [0.19, 45.72],
  '17': [-0.83, 45.75], '18': [2.50, 47.07], '19': [1.87, 45.35], '21': [4.90, 47.42],
  '22': [-2.97, 48.44], '23': [2.07, 46.08], '24': [0.75, 45.14], '25': [6.36, 47.17],
  '26': [5.17, 44.68], '27': [0.97, 49.11], '28': [1.38, 48.31], '29': [-4.10, 48.26],
  '2A': [8.92, 41.86], '2B': [9.29, 42.40], '30': [4.18, 43.99], '31': [1.18, 43.35],
  '32': [0.45, 43.69], '33': [-0.58, 44.83], '34': [3.58, 43.59], '35': [-1.68, 48.11],
  '36': [1.57, 46.78], '37': [0.69, 47.26], '38': [5.58, 45.26], '39': [5.69, 46.73],
  '40': [-0.77, 43.89], '41': [1.41, 47.62], '42': [4.16, 45.73], '43': [3.85, 45.11],
  '44': [-1.68, 47.36], '45': [2.10, 47.91], '46': [1.62, 44.62], '47': [0.46, 44.34],
  '48': [3.50, 44.52], '49': [-0.56, 47.39], '50': [-1.32, 49.08], '51': [4.07, 48.96],
  '52': [5.14, 48.11], '53': [-0.77, 48.07], '54': [6.17, 48.79], '55': [5.38, 49.00],
  '56': [-2.82, 47.74], '57': [6.67, 49.04], '58': [3.50, 47.11], '59': [3.22, 50.45],
  '60': [2.42, 49.42], '61': [0.11, 48.62], '62': [2.28, 50.51], '63': [3.13, 45.73],
  '64': [-0.77, 43.26], '65': [0.15, 43.05], '66': [2.53, 42.60], '67': [7.55, 48.67],
  '68': [7.21, 47.86], '69': [4.61, 45.87], '70': [6.08, 47.62], '71': [4.53, 46.64],
  '72': [0.20, 47.93], '73': [6.39, 45.49], '74': [6.42, 46.04], '75': [2.35, 48.86],
  '76': [0.97, 49.66], '77': [2.99, 48.62], '78': [1.83, 48.83], '79': [-0.33, 46.52],
  '80': [2.28, 49.92], '81': [2.17, 43.79], '82': [1.29, 44.08], '83': [6.22, 43.47],
  '84': [5.19, 44.05], '85': [-1.29, 46.68], '86': [0.46, 46.56], '87': [1.24, 45.89],
  '88': [6.37, 48.17], '89': [3.56, 47.84], '90': [6.92, 47.63], '91': [2.24, 48.52],
  '92': [2.24, 48.84], '93': [2.48, 48.91], '94': [2.47, 48.78], '95': [2.12, 49.08],
  // DROM-COM
  '971': [-61.55, 16.25], '972': [-61.02, 14.64], '973': [-53.13, 3.92],
  '974': [55.54, -21.12], '976': [45.15, -12.84],
};

// ─── ISS (Indice de Stress Sanitaire) → color helpers ───

function issToFillColor(iss: number): string {
  const lvl = ISS_LEVELS.find(l => iss >= l.range[0] && iss <= l.range[1]) ?? ISS_LEVELS[0];
  return lvl.fillColor;
}

function issToLineColor(iss: number): string {
  const lvl = ISS_LEVELS.find(l => iss >= l.range[0] && iss <= l.range[1]) ?? ISS_LEVELS[0];
  return lvl.lineColor;
}

function issToColor(iss: number): string {
  const lvl = ISS_LEVELS.find(l => iss >= l.range[0] && iss <= l.range[1]) ?? ISS_LEVELS[0];
  return lvl.color;
}

function getISSSemio(iss: number): { icon: string; name: string; label: string; color: string; level: ISSLevel } {
  const lvl = ISS_LEVELS.find(l => iss >= l.range[0] && iss <= l.range[1]) ?? ISS_LEVELS[0];
  return { icon: lvl.icon, name: lvl.name, label: lvl.label, color: lvl.color, level: lvl.level };
}

function getHealthSourceLabel(source: string): string {
  switch (source) {
    case 'spf-epid': return 'Santé Publique France';
    case 'drees': return 'DREES';
    case 'sentinelles': return 'Sentinelles';
    case 'composite': return 'Multi-sources';
    case 'ansm': return 'ANSM';
    case 'oscour': return 'OSCOUR';
    case 'sos-medecins': return 'SOS Médecins';
    default: return 'SPF / DREES';
  }
}

// ─── Flood vigilance → color ───
const FLOOD_COLORS: Record<string, string> = {
  green: '#34c759',
  yellow: '#ffcc00',
  orange: '#ff9500',
  red: '#ff3b30',
};

// ─── ISNR stability → color ───
const ISNR_COLORS: Record<string, string> = {
  critical: 'rgba(255,59,48,0.40)',   // Rouge : 81-100
  high: 'rgba(255,149,0,0.35)',       // Orange : 61-80
  medium: 'rgba(255,204,0,0.25)',     // Jaune : 41-60
  low: 'rgba(52,199,89,0.20)',        // Vert : 21-40
  stable: 'rgba(52,199,89,0.10)',     // Vert clair : 0-20
};

function scoreToISNRColor(score: number): string {
  if (score >= 80) return ISNR_COLORS.critical;
  if (score >= 60) return ISNR_COLORS.high;
  if (score >= 40) return ISNR_COLORS.medium;
  if (score >= 20) return ISNR_COLORS.low;
  return ISNR_COLORS.stable;
}

function scoreToISNRLineColor(score: number): string {
  if (score >= 80) return 'rgba(255,59,48,0.8)';
  if (score >= 60) return 'rgba(255,149,0,0.7)';
  if (score >= 40) return 'rgba(255,204,0,0.6)';
  if (score >= 20) return 'rgba(52,199,89,0.5)';
  return 'rgba(52,199,89,0.3)';
}


// ─── Infras vitales: palette pastel volontairement secondaire ───
const INFRA_COLORS: Record<string, string> = {
  nuclear: '#8FC8E8',
  thermal: '#74B6DC',
  hydro: '#B7DAEE',
  substation: '#5EA6D6',
  'gas-terminal': '#8EDFD8',
  'gas-storage': '#C0F0E8',
  refinery: '#E7BE98',
  'oil-depot': '#F1D6BA',
};

const INFRA_VITAL_HALO_COLOR = 'rgba(242, 244, 247, 0.94)';
const INFRA_NUCLEAR_RING_COLOR = 'rgba(232, 242, 250, 0.98)';

const DEFAULT_VIEW: MapViewState = {
  longitude: 2.2,
  latitude: 46.6,
  zoom: 6,
  pitch: 0,
  bearing: 0,
};

function deptCodeToId(code: string): number {
  if (code === '2A') return 200;
  if (code === '2B') return 201;
  const n = parseInt(code, 10);
  return isNaN(n) ? 999 : n;
}

function getFeatureCenter(feature: GeoJSON.Feature): [number, number] | null {
  const geom = feature.geometry;
  if (!geom) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  const push = (coord: number[]) => {
    if (coord.length < 2) return;
    const lng = coord[0];
    const lat = coord[1];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  };
  const walk = (node: any): void => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === 'number') {
      push(node as number[]);
      return;
    }
    for (const child of node) walk(child);
  };
  walk((geom as any).coordinates);
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLng) || !Number.isFinite(maxLat)) {
    return null;
  }
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

/**
 * Generate a curved arc between two points using a quadratic bezier.
 * The curve bows perpendicular to the line connecting the points.
 * @param from Starting coordinates [lng, lat]
 * @param to Ending coordinates [lng, lat]
 * @param curvature How much the curve bows (0.2-0.4 recommended)
 * @param steps Number of points to generate
 */
function generateArc(
  from: [number, number],
  to: [number, number],
  curvature = 0.3,
  steps = 40
): [number, number][] {
  const [x1, y1] = from;
  const [x2, y2] = to;

  // Midpoint
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;

  // Perpendicular direction (rotated 90 degrees)
  const dx = x2 - x1;
  const dy = y2 - y1;

  // Control point offset perpendicular to the line
  const offsetX = -dy * curvature;
  const offsetY = dx * curvature;

  // Control point for quadratic bezier
  const cx = mx + offsetX;
  const cy = my + offsetY;

  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    // Quadratic bezier formula
    const x = u * u * x1 + 2 * u * t * cx + t * t * x2;
    const y = u * u * y1 + 2 * u * t * cy + t * t * y2;
    points.push([x, y]);
  }
  return points;
}

function computeBearingDegrees(from: [number, number], to: [number, number]): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

// France center for interconnection arcs
const FRANCE_CENTER: [number, number] = [2.5, 46.5];

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
  private onMilitaryFlightClick: ((flight: MilitaryFlight, x: number, y: number) => void) | null = null;
  private onMilitaryBaseClick: ((base: MilitaryBase, x: number, y: number) => void) | null = null;
  private onMilitaryShipClick: ((ship: ReturnType<typeof import('../services/military-ships.ts').getMilitaryShips>[0], x: number, y: number) => void) | null = null;
  private _onMaritimeShipClick: ((ship: MilitaryShip, x: number, y: number) => void) | null = null;
  private onSatelliteView: ((request: SatelliteViewRequest) => void) | null = null;
  private _highlightedMmsi: string | null = null;
  private _selectedShipMmsi: string | null = null;
  private _satelliteMode = false;
  private _basemapLayerVisibility: Map<string, 'visible' | 'none'> = new Map();
  private _sentinelBlinkInterval: ReturnType<typeof setInterval> | null = null;
  // In-memory lookup tables for military data (populated by updateMilitary*)
  private militaryFlightsById: Map<string, MilitaryFlight> = new Map();
  private airTrafficFlightsById: Map<string, AirTrafficFlight> = new Map();
  private militaryBasesById: Map<string, MilitaryBase> = new Map();
  private militaryShipsById: Map<string, { id: string; name: string; type: string; role: string; mmsi?: string; lat: number; lon: number; speed?: number; heading?: number; port?: string; isLive?: boolean }> = new Map();
  private aisIconDefs: Record<string, { url: string; width: number; height: number; anchorX: number; anchorY: number; mask: boolean }> = {};
  // Lightweight hover tooltip (uses maplibregl.Popup)
  private militaryTooltip: maplibregl.Popup | null = null;
  private hoveredSubseaCableId: string | number | null = null;
  private hoveredSubseaLandingId: string | number | null = null;
  private aisHoverTooltip: maplibregl.Popup | null = null;
  private floodHoverPopup: maplibregl.Popup | null = null;
  private healthHoverPopup: maplibregl.Popup | null = null;
  private weatherHoverPopup: maplibregl.Popup | null = null;
  private firesHoverPopup: maplibregl.Popup | null = null;
  private _flightInterpolTick: ReturnType<typeof setInterval> | null = null;
  private _modisOverlayEnabled = false;
  private _mairesPolitiqueData: Array<{c:string;lat:number;lon:number;n:string;nom:string}> | null = null;
  private trafficIncidentPopup: maplibregl.Popup | null = null;
  private enrichedHoverPopup: maplibregl.Popup | null = null;
  private trafficIncidentHoverTimer: ReturnType<typeof setTimeout> | null = null;
  private hoveredTrafficIncidentId: string | null = null;
  private _lastHoveredHealthId: number | null = null;
  private latestHealthFeatures: HealthFeatures | null = null;
  private floodSegmentsById: Map<string, FloodSegment> = new Map();

  public getHealthFeatures(): HealthFeatures | null {
    return this.latestHealthFeatures;
  }

  // Cluster hover state
  private hoveredClusterId: number | null = null;
  private lastClusterItems: NewsItem[] = [];
  private lastClusterCount: number = 0;
  private clusterHideTimeout: ReturnType<typeof setTimeout> | null = null;

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
  private roadTrafficVisible = false;
  private airTrafficVisible = false;
  private dayNightVisible = false;
  private dayNightOptions = {
    showNight: true,
    showTwilight: true,
    showSunIcon: true,
    timestamp: 0, // 0 = utilise Date.now() à chaque rendu
  };
  private roadTrafficIncidents: TrafficIncident[] = [];
  private civilAirTrafficFlights: AirTrafficFlight[] = [];  // Filtered: excludes military callsigns
  private legendHoverCategory: string | null = null;

  // ─── Civil Air Traffic Animation (tween between snapshots) ───
  private civilAirPrevPositions: Map<string, { lon: number; lat: number; heading: number }> = new Map();
  private civilAirTweenStart = 0;          // performance.now() when snapshot arrived
  private civilAirTweenDuration = 12_000;  // ms — matches AIR_TRAFFIC_POLL_MS in App.ts
  private civilAirAnimFrame: number | null = null;
  private civilAirTweenProgress = 1;       // 0..1 — starts at 1 (settled) until first tween

  // Storing original opacities for legend highlighting
  private originalOpacities: Map<string, { prop: string, orig: any }> = new Map();

  // ─── Energy tooltip data ───
  private energyRegionStats = new Map<string, import('../types/index.ts').RegionEnergyStats>();
  private energyFlowStats = new Map<string, import('../types/index.ts').InterconnectionFlowStats>();
  private energyBorderHistory = new Map<string, number[]>();  // sparkline series
  private energyRegionPopup: maplibregl.Popup | null = null;
  private energyFlowPopup: maplibregl.Popup | null = null;

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
    ; (window as any)._franceMonitorMap = this.map;
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

    // ═══════════════════════════════════════════════════════════════
    // ANTI-FLASH: Force all custom layers to start HIDDEN
    // App.ts will call setLayerVisibility() immediately after init()
    // to apply the saved state — so we never see a flash of wrong layers.
    // ═══════════════════════════════════════════════════════════════
    const _origAddLayer = this.map!.addLayer.bind(this.map!);
    (this.map as any).addLayer = (layer: maplibregl.LayerSpecification | (maplibregl.LayerSpecification & { source: object }), beforeId?: string) => {
      const l = layer as any;
      // Force all our symbol/circle/line/fill layers except basemap labels to start hidden
      if (l.id && !l.id.startsWith('wm-basemap') && !l.id.startsWith('background') && !l.id.startsWith('country') && !l.id.startsWith('water') && !l.id.startsWith('road') && !l.id.startsWith('building') && !l.id.startsWith('landuse') && !l.id.startsWith('place') && !l.id.startsWith('boundary')) {
        l.layout = { ...(l.layout || {}), visibility: 'none' };
      }
      return _origAddLayer(l, beforeId);
    };


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
    this.map.addSource(SRC_ENERGY, { type: 'geojson', data: emptyFC() });

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

    // Health regions
    this.map.addSource(SRC_HEALTH, {
      type: 'geojson',
      data: emptyFC(),
      promoteId: 'code'
    });
    this.map.addSource(SRC_HEALTH_MARKERS, {
      type: 'geojson',
      data: emptyFC(),
    });

    // ISNR stability departments
    this.map.addSource(SRC_ISNR, {
      type: 'geojson',
      data: emptyFC(),
      promoteId: 'code'
    });

    // Topage visual (réseau hydro décoratif, fond)
    this.map.addSource(SRC_TOPAGE_VIS, { type: 'geojson', data: emptyFC() });

    // Flood segments
    this.map.addSource(SRC_FLOODS, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_FLOODS_HIGHLIGHT, { type: 'geojson', data: emptyFC() });

    // NASA FIRMS Fires
    this.map.addSource(SRC_FIRES, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_FIRES_HIGHLIGHT, { type: 'geojson', data: emptyFC() });

    // NASA GIBS — MODIS Terra Corrected Reflectance overlay (fumée / cicatrices)
    this.map.addSource(SRC_MODIS, {
      type: 'raster',
      tiles: [
        `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${this._buildGibsDate()}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`
      ],
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

    // Réseau de Transport Gaz Pression (GRTgaz, Teréga)
    this.map.addSource(SRC_GAS_NETWORK_GRT, {
      type: 'geojson',
      data: 'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/trace-du-reseau-grt-250/exports/geojson'
    });
    this.map.addSource(SRC_GAS_NETWORK_TEREGA, {
      type: 'geojson',
      data: 'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/terega-trace-du-reseau/exports/geojson'
    });

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
    // Oil infrastructure (pipelines, refineries, depots)
    this.map.addSource(SRC_OIL_PIPELINES, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_OIL_REFINERIES, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_OIL_DEPOTS, { type: 'geojson', data: emptyFC() });

    // Traffic (TomTom API) - France only
    const tomtomKey = import.meta.env.VITE_TOMTOM_API_KEY;
    if (tomtomKey) {
      this.map.addSource(SRC_TRAFFIC, {
        type: 'raster',
        tiles: [`https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?tileSize=256&key=${tomtomKey}`],
        tileSize: 256,
        bounds: [-5.2, 41.3, 9.6, 51.1] // Tighter bounding box for France métropolitaine
      });
    } else {
      this.map.addSource(SRC_TRAFFIC, { type: 'geojson', data: emptyFC() });
    }

    // Traffic Incidents (TomTom temps réel)
    this.map.addSource(SRC_TRAFFIC_INCIDENTS, { type: 'geojson', data: emptyFC() });

    // Train route highlight
    this.map.addSource(SRC_TRAIN_ROUTE, { type: 'geojson', data: emptyFC() });

    // Métropoles consumption
    this.map.addSource(SRC_METROPOLES, { type: 'geojson', data: emptyFC() });

    // Outages (Telecom endpoints & Power regions)
    this.map.addSource(SRC_TELECOM, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_POWER, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_POWER_TENSION, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_CITIZEN_ZONES, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_TERMINATOR, { type: 'geojson', data: emptyFC() });
    // Internet/BGP outages (IODA + ISP BGP)
    this.map.addSource(SRC_NET_ISP, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_NET_IODA, { type: 'geojson', data: emptyFC() });
    // Infra cloud & IXP
    this.map.addSource(SRC_DC, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_IXP, { type: 'geojson', data: emptyFC() });

    // Military
    this.map.addSource(SRC_MILITARY_ZONES, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_MILITARY_BASES, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_MILITARY_FLIGHTS, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_MILITARY_FLIGHT_TRAILS, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_AIR_TRAFFIC, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_MILITARY_SHIPS, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_MILITARY_SHIPS_HIGHLIGHT, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_MILITARY_SHIPS_SELECTED, { type: 'geojson', data: emptyFC() });
    this.map.addSource(SRC_GLOBAL_TRAFFIC, { type: 'geojson', data: emptyFC() });

    let submarineCablesData = emptyFC() as GeoJSON.FeatureCollection<GeoJSON.LineString>;
    try {
      const submarineCablesResponse = await fetch('/data/submarine-cables.json');
      if (submarineCablesResponse.ok) {
        submarineCablesData = await submarineCablesResponse.json() as GeoJSON.FeatureCollection<GeoJSON.LineString>;
      }
    } catch (err) {
      console.warn('[DeckGLMap] Failed to load submarine cables data:', err);
    }

    // Submarine cables
    this.map.addSource(SRC_SUBMARINE_CABLES, {
      type: 'geojson',
      data: submarineCablesData,
      promoteId: 'id',
    });
    this.map.addSource(SRC_SUBMARINE_CABLES_LANDINGS, {
      type: 'geojson',
      data: buildSubmarineLandingPoints(submarineCablesData),
    });

    // Hospitals (FINESS)
    this.map.addSource(SRC_HOSPITALS, { type: 'geojson', data: emptyFC() });

    // ═══════════════════════════════════════════════════════════════
    // LAYERS (order matters — bottom to top)
    // ═══════════════════════════════════════════════════════════════

    // ─── Terminateur jour/nuit (premier layer — sous tout le reste) ───
    this.map.addLayer({
      id: LYR_TERMINATOR,
      type: 'fill',
      source: SRC_TERMINATOR,
      paint: {
        'fill-color': '#0a0e2a',
        'fill-opacity': 0.45,
      },
    });

    // ─── Energy: region fill ───
    this.map.addLayer({
      id: LYR_ENERGY_FILL,
      type: 'fill',
      source: SRC_ENERGY,
      paint: {
        'fill-color': ['get', 'fillColor'],
        'fill-opacity': 0.7,
      },
    });
    this.map.addLayer({
      id: LYR_ENERGY_LINE,
      type: 'line',
      source: SRC_ENERGY,
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

    // ─── Weather: department fill ───
    this.map.addLayer({
      id: LYR_WEATHER_FILL,
      type: 'fill',
      source: SRC_WEATHER,
      paint: {
        'fill-color': ['get', 'fillColor'],
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          0.8,
          0.6
        ],
      },
    });
    this.map.addLayer({
      id: LYR_WEATHER_LINE,
      type: 'line',
      source: SRC_WEATHER,
      paint: {
        'line-color': ['get', 'lineColor'],
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          3,
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

    // NOTE: Weather icons layer is added later (after all fill layers) to ensure visibility

    // ─── Health: regional epidemiology fill ───
    this.map.addLayer({
      id: LYR_HEALTH_FILL,
      type: 'fill',
      source: SRC_HEALTH,
      paint: {
        'fill-color': ['get', 'fillColor'],
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          0.85,
          [
            'interpolate',
            ['linear'],
            ['coalesce', ['get', 'healthStressIndex'], 0],
            0, 0.35,
            100, 0.7
          ]
        ],
      },
    });

    this.map.addLayer({
      id: LYR_HEALTH_APL_FILL,
      type: 'fill',
      source: SRC_HEALTH,
      paint: {
        'fill-color': [
          'match',
          ['get', 'aplCategory'],
          ...APL_LEVELS.flatMap(lvl => [lvl.category, lvl.color]),
          'transparent'
        ] as any,
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          0.30,
          0.15
        ],
      },
    });

    this.map.addLayer({
      id: LYR_HEALTH_APL_LINE,
      type: 'line',
      source: SRC_HEALTH,
      paint: {
        'line-color': [
          'match',
          ['get', 'aplCategory'],
          ...APL_LEVELS.flatMap(lvl => [lvl.category, lvl.color]),
          'transparent'
        ] as any,
        'line-width': 2,
        'line-opacity': 0.6
      },
    });

    this.map.addLayer({
      id: LYR_HEALTH_OSCOUR_CIRCLES,
      type: 'circle',
      source: SRC_HEALTH_MARKERS,
      filter: ['==', ['get', 'isDepartmental'], 1],
      paint: {
        'circle-color': [
          'step',
          ['get', 'oscourMaxTrend'],
          OSCOUR_LEVELS[0].color,
          OSCOUR_LEVELS[1].threshold, OSCOUR_LEVELS[1].color,
          OSCOUR_LEVELS[2].threshold, OSCOUR_LEVELS[2].color,
          OSCOUR_LEVELS[3].threshold, OSCOUR_LEVELS[3].color
        ] as any,
        'circle-radius': [
          'interpolate', ['linear'], ['get', 'oscourMaxTrend'],
          OSCOUR_LEVELS[0].threshold, OSCOUR_LEVELS[0].radius,
          OSCOUR_LEVELS[1].threshold, OSCOUR_LEVELS[1].radius,
          OSCOUR_LEVELS[2].threshold, OSCOUR_LEVELS[2].radius,
          OSCOUR_LEVELS[3].threshold, OSCOUR_LEVELS[3].radius
        ] as any,
        'circle-stroke-color': '#000000',
        'circle-stroke-width': 1.5,
      },
    });

    this.map.addLayer({
      id: LYR_HEALTH_LINE,
      type: 'line',
      source: SRC_HEALTH,
      paint: {
        'line-color': ['get', 'lineColor'],
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          2.2,
          1
        ],
        'line-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          1.0,
          0.85
        ],
      },
    });
    this.map.addLayer({
      id: LYR_HEALTH_MARKERS,
      type: 'circle',
      source: SRC_HEALTH_MARKERS,
      filter: ['!=', ['get', 'isDepartmental'], 1],
      minzoom: 4.8,
      paint: {
        'circle-color': ['coalesce', ['get', 'healthIconColor'], '#34c759'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4.8, 4, 7, 6, 10, 8],
        'circle-opacity': 0.95,
        'circle-stroke-width': 0,
        'circle-stroke-opacity': 0,
      },
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
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          5, 10,
          10, 30
        ],
        'circle-color': '#ff3b30',
        'circle-opacity': 0.3,
        'circle-blur': 0.8
      }
    });
    this.map.addLayer({
      id: LYR_FIRES_POINTS,
      type: 'circle',
      source: SRC_FIRES,
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          5, 3,
          10, 5
        ],
        'circle-color': [
          'match', ['get', 'confidence'],
          'high', '#ffd60a',
          'nominal', '#ff9500',
          'low', '#ff3b30',
          '#ff9500'
        ],
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

    // ─── Traffic: TomTom Raster ───
    if (import.meta.env.VITE_TOMTOM_API_KEY) {
      this.map.addLayer({
        id: LYR_TRAFFIC,
        type: 'raster',
        source: SRC_TRAFFIC,
        paint: {
          'raster-opacity': 0.8,
          'raster-resampling': 'nearest'
        }
      });
    } else {
      // Fallback empty layer
      this.map.addLayer({
        id: LYR_TRAFFIC,
        type: 'raster',
        source: SRC_TRAFFIC,
        paint: { 'raster-opacity': 0 }
      });
    }

    // ─── Traffic Incidents (TomTom) ───
    this.map.addLayer({
      id: LYR_TRAFFIC_INCIDENTS,
      type: 'circle',
      source: SRC_TRAFFIC_INCIDENTS,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 5, 10, 10],
        'circle-color': [
          'match',
          ['get', 'severity'],
          'high', '#ff3b30',
          'medium', '#ff9500',
          '#ffcc00'
        ],
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#111',
        'circle-opacity': 0.9,
      }
    });

    // ─── Train route highlight ───
    this.map.addLayer({
      id: LYR_TRAIN_ROUTE,
      type: 'line',
      source: SRC_TRAIN_ROUTE,
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: {
        'line-color': '#af52de', // Purple for trains
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 3, 8, 5, 12, 7],
        'line-opacity': 0.9,
        'line-dasharray': [2, 1],
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });
    this.map.addLayer({
      id: LYR_TRAIN_STATIONS,
      type: 'circle',
      source: SRC_TRAIN_ROUTE,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 6, 8, 10, 12, 14],
        'circle-color': '#af52de',
        'circle-stroke-width': 3,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 1,
      },
    });

    // ─── Topage visual : réseau hydro de fond (bleu clair discret) ───
    this.map.addLayer({
      id: LYR_TOPAGE_VIS,
      type: 'line',
      source: SRC_TOPAGE_VIS,
      paint: {
        'line-color': '#4fc3f7',
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 10, 1.2, 14, 2],
        'line-opacity': 0.45,
      },
      layout: { 'line-cap': 'round', 'line-join': 'round', 'visibility': 'none' },
    });

    // ─── Floods: tronçons raw (Topage indisponible) — pointillés discrets ───
    this.map.addLayer({
      id: LYR_FLOODS_RAW,
      type: 'line',
      source: SRC_FLOODS,
      filter: ['==', ['get', 'geometryFidelity'], 'raw'],
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 2,
        'line-opacity': 0.45,
        'line-dasharray': [2, 4],
      },
      layout: { 'line-cap': 'butt' },
    });

    // ─── Floods: segment lines (matched + fallback uniquement) ───
    this.map.addLayer({
      id: LYR_FLOODS,
      type: 'line',
      source: SRC_FLOODS,
      filter: ['!=', ['get', 'geometryFidelity'], 'raw'],
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
          ['==', ['get', 'geometryFidelity'], 'fallback'], 0.88,
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
        'circle-stroke-width': 2,
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
      id: LYR_INFRA_VITAL_HALO,
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
      id: LYR_INFRA_NUCLEAR_RING,
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

    // ─── Infrastructure: circles ───
    this.map.addLayer({
      id: LYR_INFRA_CIRCLE,
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
      id: LYR_INFRA_LABEL,
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

    // ─── Métropoles: halo de fond ───
    this.map.addLayer({
      id: LYR_METROPOLES_GLOW,
      type: 'circle',
      source: SRC_METROPOLES,
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
      id: LYR_METROPOLES_CIRCLE,
      type: 'circle',
      source: SRC_METROPOLES,
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

    // ─── Métropoles: labels (zoom > 7) ───
    this.map.addLayer({
      id: LYR_METROPOLES_LABEL,
      type: 'symbol',
      source: SRC_METROPOLES,
      minzoom: 7,
      layout: {
        'text-field': ['concat', ['get', 'name'], '\n', ['get', 'mwLabel']],
        'text-size': ['interpolate', ['linear'], ['zoom'], 7, 9, 11, 11],
        'text-offset': [0, 2.0],
        'text-anchor': 'top',
        'text-allow-overlap': false,
        'text-font': ['Open Sans Regular'],
      },
      paint: {
        'text-color': '#e8eef5',
        'text-halo-color': '#0a0a0f',
        'text-halo-width': 1.4,
        'text-opacity': 0.96,
      },
    });

    // ─── Military ───
    this.map.addLayer({
      id: LYR_MILITARY_ZONES_FILL,
      type: 'fill',
      source: SRC_MILITARY_ZONES,
      paint: {
        'fill-color': '#ff2d55',
        'fill-opacity': 0.15,
      },
    });
    this.map.addLayer({
      id: LYR_MILITARY_ZONES_LINE,
      type: 'line',
      source: SRC_MILITARY_ZONES,
      paint: {
        'line-color': '#ff2d55',
        'line-width': 2,
        'line-opacity': 0.8,
        'line-dasharray': [4, 4]
      },
    });

    // CHU : jaune #F4D03F (pour représenter la centralisation et la tension)
    this.map.addLayer({
      id: LYR_HOSPITALS_CHU,
      type: 'circle',
      source: SRC_HOSPITALS,
      filter: ['==', ['get', 'type'], 'CHU'],
      paint: {
        'circle-color': '#F4D03F',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 7, 8, 11, 12, 16],
        'circle-opacity': 0.92,
      },
    });
    // CH / Clinique Privée : bleu/cyan #1ABC9C (capacité normale)
    this.map.addLayer({
      id: LYR_HOSPITALS_CH,
      type: 'circle',
      source: SRC_HOSPITALS,
      filter: ['!=', ['get', 'type'], 'CHU'],
      paint: {
        'circle-color': '#1ABC9C',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4, 8, 7, 12, 10],
        'circle-opacity': 0.95,
      },
    });
    // Label hôpitaux au zoom 10+
    this.map.addLayer({
      id: LYR_HOSPITALS_LABEL,
      type: 'symbol',
      source: SRC_HOSPITALS,
      minzoom: 10,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 10,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-allow-overlap': false,
        'text-font': ['Open Sans Regular'],
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#0a0a0f',
        'text-halo-width': 1.5,
        'text-opacity': 0.85,
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

    // ─── Military Flight Trails — lignes de trajectoire ───
    this.map.addLayer({
      id: LYR_MILITARY_FLIGHT_TRAILS,
      type: 'line',
      source: SRC_MILITARY_FLIGHT_TRAILS,
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': [
          'match', ['get', 'aircraftType'],
          'fighter', '#ff3b30',
          'transport', '#4a9eff',
          'tanker', '#ff9500',
          'awacs', '#a855f7',
          'patrol', '#00d4c8',
          'helicopter', '#22c55e',
          'drone', '#ff6b9d',
          'trainer', '#ffcc00',
          'liaison', '#9898a8',
          '#9898a8'  // unknown
        ],
        'line-width': 2,
        'line-opacity': 0.6,
      },
    });

    // ─── Military Flights — icône par TYPE d'avion, orientée par cap ───
    this.map.addLayer({
      id: LYR_MILITARY_FLIGHTS,
      type: 'symbol',
      source: SRC_MILITARY_FLIGHTS,
      layout: {
        'icon-image': [
          'case',
          // Emergency squawk → red pulsing icon
          ['==', ['get', 'squawkSeverity'], 'critical'], 'mil-emergency',
          // Otherwise, match by aircraft type
          ['match', ['get', 'aircraftType'],
            'fighter', 'mil-type-fighter',
            'transport', 'mil-type-transport',
            'tanker', 'mil-type-tanker',
            'awacs', 'mil-type-awacs',
            'patrol', 'mil-type-patrol',
            'helicopter', 'mil-type-helicopter',
            'drone', 'mil-type-drone',
            'trainer', 'mil-type-trainer',
            'liaison', 'mil-type-liaison',
            'mil-type-unknown'
          ]
        ],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.30, 8, 0.40, 12, 0.55],
        'icon-rotate': ['get', 'heading'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {},
    });
    this.map.addLayer({
      id: LYR_MILITARY_FLIGHTS_LABEL,
      type: 'symbol',
      source: SRC_MILITARY_FLIGHTS,
      minzoom: 7,
      layout: {
        'text-field': ['concat',
          ['get', 'callsign'],
          '\n',
          ['case', ['>', ['get', 'altitude'], 0],
            ['concat', 'FL', ['to-string', ['round', ['/', ['get', 'altitude'], 100]]]],
            'Sol'
          ]
        ],
        'text-size': 10,
        'text-offset': [0, 2.0],
        'text-anchor': 'top',
        'text-allow-overlap': false,
        'text-font': ['Open Sans Semibold'],
      },
      paint: {
        'text-color': [
          'match', ['get', 'operator'],
          'armee-air', '#4a9eff',
          'marine', '#00d4c8',
          'gendarmerie', '#a855f7',
          'alat', '#22c55e',
          'securite-civile', '#ff6b35',
          'douanes', '#eab308',
          '#ffcc00'
        ],
        'text-halo-color': '#000000',
        'text-halo-width': 1.5,
      },
    });

    // ─── Civil Air Traffic (free airplanes.live sampling) ───
    // Icon rendering is now handled by DeckGL (IconLayer 'deck-air-traffic')
    // MapLibre is only responsible for rendering the text labels.
    this.map.addLayer({
      id: LYR_AIR_TRAFFIC_LABEL,
      type: 'symbol',
      source: SRC_AIR_TRAFFIC,
      minzoom: 6,
      layout: {
        'text-field': ['get', 'callsign'],
        'text-size': 10,
        'text-offset': [0, 1.6],
        'text-anchor': 'top',
        'text-allow-overlap': false,
        'text-font': ['Open Sans Semibold'],
      },
      paint: {
        'text-color': '#7dd3fc',
        'text-halo-color': '#0a0a0f',
        'text-halo-width': 2,
        'text-opacity': 0.85,
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

    // ─── Military Ships (Marine Nationale) — ⚓ SVG ───
    this.map.addLayer({
      id: LYR_MILITARY_SHIPS,
      type: 'symbol',
      source: SRC_MILITARY_SHIPS,
      layout: {
        'icon-image': 'mil-ship',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.28, 8, 0.38, 12, 0.5],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {},
    });

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

    // ─── Military Ships label ───
    this.map.addLayer({
      id: `${LYR_MILITARY_SHIPS}-label`,
      type: 'symbol',
      source: SRC_MILITARY_SHIPS,
      minzoom: 8,
      layout: {
        'text-field': ['concat', ['get', 'name'], ['case', ['has', 'type'], ['concat', '\n', ['get', 'type']], '']],
        'text-size': 10,
        'text-offset': [0, 2.0],
        'text-anchor': 'top',
        'text-allow-overlap': false,
        'text-font': ['Open Sans Semibold'],
      },
      paint: {
        'text-color': '#00d4c8',
        'text-halo-color': '#000000',
        'text-halo-width': 2,
      },
    });

    // ─── Submarine Cables (Defense Infrastructure) ───
    // Glow effect layer (below main line)
    this.map.addLayer({
      id: LYR_SUBMARINE_CABLES_GLOW,
      type: 'line',
      source: SRC_SUBMARINE_CABLES,
      paint: {
        'line-color': '#5fdcff',
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
        'line-color': '#22c7ff',
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
        'line-color': '#f4fdff',
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

    // ─── Citizen Outage Zones (crowd-sourced clusters) ───
    // Fill : rouge-orange translucide selon severity (data-driven via 'match')
    this.map.addLayer({
      id: LYR_CITIZEN_FILL,
      type: 'fill',
      source: SRC_CITIZEN_ZONES,
      paint: {
        'fill-color': [
          'match', ['get', 'severity'],
          'critical', 'rgba(180,0,255,0.25)',
          'high', 'rgba(220,50,50,0.20)',
          'medium', 'rgba(255,140,0,0.18)',
          /* low */   'rgba(255,200,50,0.12)',
        ],
        'fill-opacity': 1,
      },
    });
    this.map.addLayer({
      id: LYR_CITIZEN_LINE,
      type: 'line',
      source: SRC_CITIZEN_ZONES,
      paint: {
        'line-color': [
          'match', ['get', 'severity'],
          'critical', '#b400ff',
          'high', '#dc3232',
          'medium', '#ff8c00',
          /* low */   '#ffc832',
        ],
        'line-width': 1.5,
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
    // Tension réseau Ecowatt (0 PDL mesurés) — fill semi-transparent + contour pointillé
    this.map.addLayer({
      id: LYR_POWER_TENSION_FILL,
      type: 'fill',
      source: SRC_POWER_TENSION,
      paint: {
        'fill-color': ['get', 'tensionColor'],
        'fill-opacity': 0.08,
      },
    });
    this.map.addLayer({
      id: LYR_POWER_TENSION_LINE,
      type: 'line',
      source: SRC_POWER_TENSION,
      paint: {
        'line-color': ['get', 'tensionColor'],
        'line-width': 1.5,
        'line-opacity': 0.6,
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

    // ─── Internet / BGP outages ───
    // Glow ring for IODA outage events — couleur teal (cyan) pour distinguer d'internet
    this.map.addLayer({
      id: LYR_NET_IODA_GLOW,
      type: 'circle',
      source: SRC_NET_IODA,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 28, 8, 44, 12, 58],
        'circle-color': [
          'interpolate', ['linear'], ['get', 'score'],
          0, 'rgba(16,185,129,0.09)',   // vert emerald normal
          50, 'rgba(245,158,11,0.15)',   // ambre anomalie modérée
          80, 'rgba(239,68,68,0.18)',    // rouge anomalie critique
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
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 6, 10, 10],
        'circle-color': [
          'interpolate', ['linear'], ['get', 'score'],
          0, '#10B981',  // vert emerald normal
          50, '#F59E0B',  // ambre
          80, '#EF4444',  // rouge critique
        ],
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#0a0a0f',
        'circle-opacity': ['case', ['get', 'isOngoing'], 1.0, 0.55],
      },
    });
    // ISP BGP status — anneaux (distinct des cercles pleins télécom)
    // 1. Halo ambiant
    this.map.addLayer({
      id: LYR_NET_ISP_GLOW,
      type: 'circle',
      source: SRC_NET_ISP,
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

    // ─── Datacenter status — palette violet/purple (cloud) ───
    // Glow halo (cercle doux pour l'ambiance visuelle)
    this.map.addLayer({
      id: LYR_DC_GLOW,
      type: 'circle',
      source: SRC_DC,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 20, 10, 34],
        'circle-color': 'rgba(167,139,250,0.10)',  // violet uniforme — pas de halo coloré par statut
        'circle-blur': 0.65,
        'circle-stroke-width': 0,
      },
    });
    // Core datacenters — triangles violets SDF (▲), colorisés par statut
    this.map.addLayer({
      id: LYR_DC_CORE,
      type: 'symbol',
      source: SRC_DC,
      layout: {
        'icon-image': 'triangle-dc',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.28, 10, 0.50],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-color': [
          'match', ['get', 'status'],
          'operational', '#A78BFA',  // violet-400
          'degraded', '#F59E0B',  // ambre
          'partial', '#F97316',  // orange
          'outage', '#EF4444',  // rouge
          'maintenance', '#8B5CF6',  // violet-500
          'unknown', '#A78BFA',  // violet — pas d'incident connu
          '#A78BFA',
        ],
        'icon-opacity': 0.95,
        'icon-halo-color': '#0a0a0f',
        'icon-halo-width': 1.5,
      },
    });

    // ─── IXP — diamants violet clair SDF (◆), colorisés par statut ───
    this.map.addLayer({
      id: LYR_IXP_CIRCLE,
      type: 'symbol',
      source: SRC_IXP,
      layout: {
        'icon-image': 'square-ixp',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.18, 10, 0.34],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-color': [
          'match', ['get', 'status'],
          'outage', '#EF4444',
          'degraded', '#F59E0B',
          '#C4B5FD',  // violet-300 opérationnel
        ],
        'icon-opacity': 0.90,
        'icon-halo-color': '#A78BFA',
        'icon-halo-width': 1,
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



    // ─── Citizen zones au-dessus de tous les calques ───
    // moveLayer sans beforeId = déplace au sommet du stack MapLibre
    this.map.moveLayer(LYR_CITIZEN_FILL);
    this.map.moveLayer(LYR_CITIZEN_LINE);

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

          // Fetch leaves if cluster changed
          if (clusterId != null && clusterId !== this.hoveredClusterId) {
            this.hoveredClusterId = clusterId;
            const src = this.map.getSource(SRC) as maplibregl.GeoJSONSource;

            // Get cluster leaves (up to 20 items for preview)
            src.getClusterLeaves(clusterId, 20, 0).then((leaves) => {
              if (!this.onClusterHover) return;
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
              this.onClusterHover(items, e.point.x, e.point.y, this.lastClusterCount);
            }).catch(() => { /* ignore */ });
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

    // ─── Fires (NASA FIRMS) Interactions ───
    this.map.on('mouseenter', LYR_FIRES_POINTS, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', LYR_FIRES_POINTS, () => {
      if (this.map) this.map.getCanvas().style.cursor = '';
      this.firesHoverPopup?.remove();
    });
    this.map.on('mousemove', LYR_FIRES_POINTS, (e) => {
      if (!this.map || !e.features || e.features.length === 0) return;
      const p = e.features[0].properties || {};
      const frp = Number(p.frp ?? 0).toFixed(1);
      const conf = String(p.confidence ?? '');
      const confLabel = conf === 'high' ? '🔴 Haute' : conf === 'nominal' ? '🟠 Nominale' : '🟡 Basse';
      const lat = Number(p.lat ?? 0).toFixed(4);
      const lon = Number(p.lon ?? 0).toFixed(4);
      const date = String(p.acq_date ?? '');
      const rawTime = String(p.acq_time ?? '').padStart(4, '0');
      const timeLabel = `${rawTime.slice(0, 2)}:${rawTime.slice(2)} UTC`;
      const period = p.daynight === 'D' ? '☀️ Jour' : '🌙 Nuit';
      const temp = Number(p.bright_ti4 ?? 0);
      const tempLabel = temp > 0 ? `${(temp - 273.15).toFixed(0)} °C` : '—';

      const html = `
        <div style="color:#e8e8ec; font-family:sans-serif; min-width:170px; padding:2px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <strong style="font-size:13px; color:#ff9500;">🔥 Feu actif</strong>
            <span style="font-size:11px; color:#9898a8;">${period}</span>
          </div>
          <div style="font-size:11px; display:flex; flex-direction:column; gap:3px;">
            <div style="display:flex; justify-content:space-between;">
              <span style="color:#9898a8;">Puissance (FRP)</span>
              <strong style="color:#ff3b30;">${frp} MW</strong>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span style="color:#9898a8;">Température</span>
              <span style="color:#e8e8ec;">${tempLabel}</span>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span style="color:#9898a8;">Confiance</span>
              <span>${confLabel}</span>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span style="color:#9898a8;">Détecté le</span>
              <span style="color:#e8e8ec;">${date} ${timeLabel}</span>
            </div>
            <div style="display:flex; justify-content:space-between; padding-top:4px; border-top:1px solid rgba(255,255,255,0.08); margin-top:2px;">
              <span style="color:#9898a8;">Coord.</span>
              <span style="color:#e8e8ec; font-size:10px;">${lat}°N, ${lon}°E</span>
            </div>
          </div>
          <div style="font-size:10px; color:#5c5c6b; margin-top:6px;">NASA FIRMS · VIIRS SNPP</div>
        </div>
      `;

      if (!this.firesHoverPopup) {
        this.firesHoverPopup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 12,
          maxWidth: '260px',
          className: 'dark-popup',
        });
      }
      this.firesHoverPopup.setLngLat(e.lngLat).setHTML(html).addTo(this.map);
    });

    // ─── Health Interactions (ISS) ───
    const handleHealthMove = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!this.map || !e.features || e.features.length === 0) return;

      // Zone d'exclusion : si un point hôpital est sous la souris, on laisse son handler s'exprimer
      const hospitalFeatures = this.map.queryRenderedFeatures(e.point, {
        layers: [LYR_HOSPITALS_CHU, LYR_HOSPITALS_CH]
      });
      if (hospitalFeatures.length > 0) {
        if (this._lastHoveredHealthId !== null) {
          this.map.setFeatureState({ source: SRC_HEALTH, id: this._lastHoveredHealthId }, { hover: false });
          this._lastHoveredHealthId = null;
        }
        this.healthHoverPopup?.remove();
        return;
      }

      const feat = e.features[0];
      const p = feat.properties || {};
      const featureId = typeof feat.id === 'number' ? feat.id : Number.parseInt(String(p.code ?? ''), 10);

      if (this._lastHoveredHealthId !== null && this._lastHoveredHealthId !== featureId) {
        this.map.setFeatureState({ source: SRC_HEALTH, id: this._lastHoveredHealthId }, { hover: false });
      }
      if (Number.isFinite(featureId)) {
        this.map.setFeatureState({ source: SRC_HEALTH, id: featureId }, { hover: true });
        this._lastHoveredHealthId = featureId;
      }

      this.map.getCanvas().style.cursor = 'pointer';

      // -- Fix: Si on bouge la souris sur le département DÉJÀ cliqué, on ne ré-affiche pas le hover
      if ((this as any)._activeHealthClickId === featureId) {
        this.healthHoverPopup?.remove();
        return;
      }

      const isDept = Number.parseInt(String(p.isDepartmental ?? '0')) === 1;
      const geoName = String(p.nom ?? p.name ?? (isDept ? 'Département' : 'Région'));
      const iss = Number.parseFloat(String(p.iss ?? p.healthStressIndex ?? '0'));
      const semio = getISSSemio(Number.isFinite(iss) ? iss : 0);
      const isOscourMarker = feat.layer.id === LYR_HEALTH_OSCOUR_CIRCLES;

      let topMotifs: any[] = [];
      try {
        const topMotifsJson = String(p.topMotifsJson ?? '[]');
        const parsed = JSON.parse(topMotifsJson);
        if (Array.isArray(parsed)) {
          topMotifs = parsed.slice(0, 4);
        }
      } catch { }

      const motifsHtml = topMotifs.length > 0
        ? `<div style="font-size:11px; margin-top:6px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.08);">
            <div style="color:#d8d8df; margin-bottom:4px; font-weight:600;">⚠️ Hausse des ${isOscourMarker ? 'passages' : 'Urgences/SOS'}:</div>
            ${topMotifs.map((m) => {
          const code = m.label || m.code || '';
          const tp = Number(m.trendPct) || (m.trend_pct ? Number(m.trend_pct) : 0);
          const tLabel = m.trendLabel || m.trend || (tp ? `+${Math.round(tp * 100)}%` : 'n/d');
          return `<div style="display:flex; justify-content:space-between; gap:10px; margin:2px 0;">
                 <span style="color:#9898a8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${code}</span>
                 <strong style="color:${tp >= 0.5 ? '#FF1744' : tp >= 0.2 ? '#E91E63' : '#F39C12'};">${tLabel}</strong>
               </div>`;
        }).join('')}
          </div>`
        : '';

      const html = `
        <div style="color:#e8e8ec; font-family:sans-serif; min-width:140px; padding:2px;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
            <strong style="font-size:13px; color:#fff;">${geoName}</strong>
            <span style="font-size:12px; font-weight:700; color:${semio.color};">${semio.icon} ${semio.name}</span>
          </div>
          <div style="font-size:11px; color:#9898a8; margin-top:4px;">ISS : <strong style="color:${semio.color}">${Number.isFinite(iss) ? Math.round(iss) : 0}</strong>/100</div>
          ${motifsHtml}
          <div style="font-size:10px; color:#6b6b76; margin-top:6px;">🖱️ Cliquez pour plus de détails</div>
        </div>
      `;

      if (!this.healthHoverPopup) {
        this.healthHoverPopup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 16,
          maxWidth: '360px',
          className: 'dark-popup'
        });
      }
      this.healthHoverPopup.setLngLat(e.lngLat).setHTML(html).addTo(this.map);
    };

    const handleHealthLeave = () => {
      if (!this.map) return;
      this.map.getCanvas().style.cursor = '';
      if (this._lastHoveredHealthId !== null) {
        this.map.setFeatureState({ source: SRC_HEALTH, id: this._lastHoveredHealthId }, { hover: false });
      }
      this._lastHoveredHealthId = null;
      this.healthHoverPopup?.remove();
    };

    const handleHealthClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!this.map || !e.features || e.features.length === 0) return;
      const feat = e.features[0];
      const p = feat.properties || {};
      const isDept = Number.parseInt(String(p.isDepartmental ?? '0')) === 1;
      const geoName = String(p.nom ?? p.name ?? (isDept ? 'Département' : 'Région'));
      const iss = Number.parseFloat(String(p.iss ?? p.healthStressIndex ?? '0'));
      const incidence = Number.parseFloat(String(p.incidenceRate ?? '0'));
      const spfIncidence = Number.parseFloat(String(p.spfIncidenceRate ?? '0'));
      const hosp = Number.parseFloat(String(p.hospitalizations ?? '0'));
      const spfHosp = Number.parseFloat(String(p.spfHospitalizations ?? '0'));
      const rea = Number.parseFloat(String(p.reanimation ?? '0'));
      const urgences = Number.parseFloat(String(p.emergencyVisits ?? '0'));
      const positivity = Number.parseFloat(String(p.positivityRate ?? '0'));
      const aplIndex = Number.parseFloat(String(p.aplIndex ?? 'NaN'));
      const aplCategoryRaw = String(p.aplCategory ?? 'indisponible');
      const topMotifsJson = String(p.topMotifsJson ?? '[]');
      let topMotifs: Array<{ code: string; label: string; trendLabel: string; trendPct: number; network: 'OSCOUR' | 'SOS_MED' }> = [];
      try {
        const parsed = JSON.parse(topMotifsJson);
        if (Array.isArray(parsed)) {
          topMotifs = parsed
            .map((m) => ({
              code: String(m?.code ?? '').trim(),
              label: String(m?.label ?? '').trim(),
              trendLabel: String(m?.trendLabel ?? '').trim(),
              trendPct: Number(m?.trendPct ?? 0),
              network: String(m?.network ?? '').includes('SOS') ? 'SOS_MED' as const : 'OSCOUR' as const,
            }))
            .filter((m) => m.code || m.label)
            .slice(0, 4);
        }
      } catch {
        topMotifs = [];
      }
      const trend = String(p.trend ?? 'stable');
      const trendLabel = trend === 'up' ? '↗ Hausse' : trend === 'down' ? '↘ Baisse' : '→ Stable';
      const source = getHealthSourceLabel(String(p.source ?? 'spf-epid'));
      const semio = getISSSemio(Number.isFinite(iss) ? iss : 0);
      const granularityLabel = isDept ? 'Département' : 'Région';
      const aplDef = APL_LEVELS.find(l => l.category === aplCategoryRaw);
      const aplCategoryLabel = aplDef ? aplDef.label : 'Indisponible';
      const aplColor = aplDef ? aplDef.color : '#9898a8';
      const motifsHtml = topMotifs.length > 0
        ? `<div style="font-size:11px; margin-top:6px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.08);">
            <div style="color:#9898a8; margin-bottom:4px;">Motifs en forte hausse (OSCOUR / SOS Médecins)</div>
            ${topMotifs.map((m) => {
          const lvl = [...OSCOUR_LEVELS].reverse().find(l => m.trendPct >= l.threshold) || OSCOUR_LEVELS[0];
          return `<div style="display:flex; justify-content:space-between; gap:10px; margin:2px 0;">
              <span style="color:#d8d8df;">${m.label || m.code} <span style="color:#9898a8;">(${m.network === 'SOS_MED' ? 'SOS' : 'OSCOUR'})</span></span>
              <strong style="color:${lvl.color};">${m.trendLabel || `${m.trendPct >= 0 ? '+' : ''}${Math.round(m.trendPct * 100)}%`}</strong>
            </div>`;
        }).join('')}
          </div>`
        : '';



      const html = `
        <div style="color:#e8e8ec; font-family:sans-serif; min-width:290px;">
          <h4 style="margin:0 0 2px; font-weight:700; font-size:15px; color:#ffffff;">${geoName}</h4>
          <div style="font-size:11px; color:#9898a8; margin-bottom:6px;">${granularityLabel} • ${source}</div>
          <div style="font-size:13px; margin-bottom:8px; color:${semio.color}; font-weight:700;">${semio.icon} Niv. ${semio.level} • ${semio.name} — ${semio.label}</div>

          <div style="font-size:12px; display:grid; grid-template-columns: 1fr auto; gap:4px 10px; padding:6px 0; border-top:1px solid rgba(255,255,255,0.08);">
            <span style="color:#9898a8;">ISS (0-100)</span><strong style="color:${semio.color}">${Number.isFinite(iss) ? Math.round(iss) : 0}</strong>
            <span style="color:#9898a8;">Incidence composite /100k</span><strong>${Number.isFinite(incidence) ? incidence.toFixed(1) : '0.0'}</strong>
            ${spfIncidence > 0 ? `<span style="color:#5ac8fa;">┗ SPF incidence</span><strong>${spfIncidence.toFixed(1)}</strong>` : ''}

            <span style="color:#9898a8;">Hospitalisations</span><strong>${Number.isFinite(hosp) ? Math.round(hosp) : 0}</strong>
            ${spfHosp > 0 ? `<span style="color:#5ac8fa;">┗ SPF hospitalisations</span><strong>${Math.round(spfHosp)}</strong>` : ''}
            ${rea > 0 ? `<span style="color:#ff6b6b;">Réanimation / Soins critiques</span><strong>${Math.round(rea)}</strong>` : ''}
            ${urgences > 0 ? `<span style="color:#ffa94d;">Passages urgences</span><strong>${Math.round(urgences)}</strong>` : ''}
            ${positivity > 0 ? `<span style="color:#9898a8;">Positivité</span><strong>${positivity.toFixed(1)} %</strong>` : ''}
            ${isDept ? `<span style="color:${aplColor};">APL (déserts médicaux)</span><strong style="color:${aplColor};">${Number.isFinite(aplIndex) ? aplIndex.toFixed(2) : 'n/d'} • ${aplCategoryLabel}</strong>` : ''}
            <span style="color:#9898a8;">Tendance</span><strong>${trendLabel}</strong>
          </div>

          ${isDept ? motifsHtml : ''}

          <div style="margin-top:10px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.08); text-align: center;">
            <button onclick="document.dispatchEvent(new CustomEvent('open-national-health'))" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #fff; padding: 6px 12px; border-radius: 4px; font-size: 11px; cursor: pointer; transition: background 0.2s;">Voir les indicateurs nationaux (Sentinelles, ANSM)</button>
          </div>
        </div>
      `;

      this.healthHoverPopup?.remove(); // Hide hover tooltip when clicking to avoid overlap

      const featureId = typeof feat.id === 'number' ? feat.id : Number.parseInt(String(p.code ?? ''), 10);
      (this as any)._activeHealthClickId = featureId;

      const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '360px', className: 'dark-popup' })
        .setLngLat(e.lngLat)
        .setHTML(html)
        .addTo(this.map);

      popup.on('close', () => {
        if ((this as any)._activeHealthClickId === featureId) {
          (this as any)._activeHealthClickId = null;
        }
      });
    };

    this.map.on('mousemove', LYR_HEALTH_FILL, handleHealthMove);
    this.map.on('mousemove', LYR_HEALTH_APL_FILL, handleHealthMove);
    this.map.on('mousemove', LYR_HEALTH_APL_LINE, handleHealthMove);
    this.map.on('mousemove', LYR_HEALTH_OSCOUR_CIRCLES, handleHealthMove);
    this.map.on('mousemove', LYR_HEALTH_MARKERS, handleHealthMove);
    this.map.on('mousemove', (e) => {
      if (!this.map || this._lastHoveredHealthId === null) return;
      const healthAtCursor = this.map.queryRenderedFeatures(e.point, { layers: [LYR_HEALTH_FILL, LYR_HEALTH_APL_FILL, LYR_HEALTH_APL_LINE, LYR_HEALTH_OSCOUR_CIRCLES, LYR_HEALTH_MARKERS] });
      if (healthAtCursor.length === 0) {
        handleHealthLeave();
      }
    });
    this.map.on('mouseleave', LYR_HEALTH_FILL, handleHealthLeave);
    this.map.on('mouseleave', LYR_HEALTH_APL_FILL, handleHealthLeave);
    this.map.on('mouseleave', LYR_HEALTH_APL_LINE, handleHealthLeave);
    this.map.on('mouseleave', LYR_HEALTH_OSCOUR_CIRCLES, handleHealthLeave);
    this.map.on('mouseleave', LYR_HEALTH_MARKERS, handleHealthLeave);

    this.map.on('click', LYR_HEALTH_FILL, handleHealthClick);
    this.map.on('click', LYR_HEALTH_APL_FILL, handleHealthClick);
    this.map.on('click', LYR_HEALTH_APL_LINE, handleHealthClick);
    this.map.on('click', LYR_HEALTH_OSCOUR_CIRCLES, handleHealthClick);
    this.map.on('click', LYR_HEALTH_MARKERS, handleHealthClick);

    // ─── Citizen outage zone — hover tooltip élargi ───
    let citizenHoverPopup: maplibregl.Popup | null = null;

    const severityMeta: Record<string, { label: string; color: string; icon: string }> = {
      critical: { label: 'Critique', color: '#b400ff', icon: '🟣' },
      high: { label: 'Élevé', color: '#dc3232', icon: '🔴' },
      medium: { label: 'Modéré', color: '#ff8c00', icon: '🟠' },
      low: { label: 'Faible', color: '#ffc832', icon: '🟡' },
    };

    this.map.on('mousemove', LYR_CITIZEN_FILL, (e) => {
      if (!this.map || !e.features || e.features.length === 0) return;
      this.map.getCanvas().style.cursor = 'crosshair';

      const p = e.features[0].properties;
      if (!p) return;

      const sev = severityMeta[p.severity] ?? { label: p.severity, color: '#888', icon: '⚪' };
      let sources: string[] = [];
      try { sources = Array.isArray(p.sources) ? p.sources : JSON.parse(p.sources ?? '[]'); } catch { sources = []; }

      const radiusKm = Number(p.radiusKm ?? 0).toFixed(1);
      const density = Number(p.density ?? 0).toFixed(2);
      const reports = Number(p.totalReports ?? 0);
      const updatedAt = p.createdAt ? new Date(p.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—';
      const areaKm2 = Math.round(Math.PI * Math.pow(Number(p.radiusKm ?? 0), 2));

      const html = `
        <div style="font-family:var(--font-sans,sans-serif);color:#e8e8ec;min-width:240px;max-width:300px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.1);">
            <span style="font-size:13px;font-weight:700;color:#fff;">${sev.icon} Zone de coupures — ${sev.label}</span>
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
          <div style="font-size:10px;color:#9898a8;">🕒 Mis à jour ${updatedAt}</div>
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

    [LYR_POWER_FILL, LYR_POWER_TENSION_FILL].forEach(lyr => {
      this.map!.on('mouseenter', lyr, () => { if (this.map) this.map.getCanvas().style.cursor = 'pointer'; });
      this.map!.on('mouseleave', lyr, () => { if (this.map) this.map.getCanvas().style.cursor = ''; });
    });
    this.map.on('click', LYR_POWER_TENSION_FILL, (e) => {
      if (!this.map || !e.features || e.features.length === 0) return;
      const feat = e.features[0];
      const code = (feat.properties?.code as string) ?? '';
      const tensionColor = (feat.properties?.tensionColor as string) ?? '#F97316';
      const name = feat.properties?.nom ?? feat.properties?.name ?? code;
      const html = `
        <div style="color:#e8e8ec; font-family:sans-serif; min-width:200px;">
          <h4 style="margin:0 0 4px; font-weight:700; font-size:15px; color:#fff;">
            ${name} <span style="font-size:12px; font-weight:normal; color:#9898a8;">(${code})</span>
          </h4>
          <div style="margin:0 0 10px; font-size:12px; font-weight:600; color:${tensionColor};">
            ${tensionColor === '#EF4444' ? '🔴 Signal rouge' : '🟠 Signal orange'} — Tension réseau Ecowatt
          </div>
          <div style="font-size:11px; color:#a1a1aa; line-height:1.5;">
            Aucune panne PDL mesurée par Enedis.<br/>
            Signal de tension préventif uniquement.
          </div>
        </div>
      `;
      new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '280px', className: 'dark-popup' })
        .setLngLat(e.lngLat)
        .setHTML(html)
        .addTo(this.map);
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
      const trendLabel = p.trend === 'improving' ? '📉 Amélioration' : p.trend === 'worsening' ? '📈 Aggravation' : '➡️ Stable';

      const html = `
        <div style="color:#e8e8ec; font-family:sans-serif; min-width:220px;">
          <h4 style="margin:0 0 4px; font-weight:700; font-size:15px; color:#fff; display:flex; justify-content:space-between; align-items:center;">
            ${p.departmentName || 'Département'} <span style="font-size:12px; font-weight:normal; color:#9898a8;">(${p.departmentCode})</span>
          </h4>
          <div style="margin:0 0 10px; font-size:12px; font-weight:600; color:${deptColor};">⚡ Tension réseau électrique</div>
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

    this.map.on('click', LYR_DC_CORE, (e) => {
      if (!this.map || !e.features?.length) return;
      const p = e.features[0].properties ?? {};
      const stCol = p.status === 'operational' ? '#A78BFA' : p.status === 'outage' ? '#EF4444' : p.status === 'maintenance' ? '#8B5CF6' : p.status === 'partial' ? '#F97316' : '#F59E0B';
      const stLbl = p.status === 'operational' ? 'Opérationnel' : p.status === 'degraded' ? 'Dégradé' : p.status === 'partial' ? 'Partiel' : p.status === 'outage' ? 'En panne' : p.status === 'maintenance' ? 'Maintenance' : 'Inconnu';
      const incidents: Array<{ title: string; severity: string }> = (() => { try { return JSON.parse(p.incidents ?? '[]'); } catch { return []; } })();
      const incHtml = incidents.length
        ? incidents.map(i => `<div style="font-size:11px;color:#F59E0B;margin-top:4px;">⚠ ${i.title}</div>`).join('')
        : `<div style="font-size:11px;color:var(--text-muted);">Aucun incident actif</div>`;
      const html = `
        <div style="color:#e8e8ec;font-family:sans-serif;min-width:220px;">
          <h4 style="margin:0 0 2px;font-weight:700;font-size:14px;color:#fff;">${p.name ?? 'Datacenter'}</h4>
          <div style="font-size:11px;color:#6366f1;margin-bottom:10px;">${p.provider ?? ''} · ${p.region ?? ''}</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:13px;">
            <span style="color:#9898a8">Statut :</span>
            <span style="font-weight:700;color:${stCol}">${stLbl}</span>
          </div>
          <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em;">Incidents</div>
          ${incHtml}
          <div style="margin-top:8px;font-size:10px;color:#6b7280;border-top:1px solid rgba(255,255,255,0.06);padding-top:6px;">Source : Statuspage officielle</div>
        </div>`;
      new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '280px', className: 'dark-popup' })
        .setLngLat(e.lngLat).setHTML(html).addTo(this.map);
    });

    this.map.on('click', LYR_IXP_CIRCLE, (e) => {
      if (!this.map || !e.features?.length) return;
      const p = e.features[0].properties ?? {};
      const stCol = p.status === 'operational' ? '#C4B5FD' : p.status === 'outage' ? '#EF4444' : '#F59E0B';
      const stLbl = p.status === 'operational' ? 'Opérationnel' : p.status === 'outage' ? 'En panne' : 'Dégradé';
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
            <span style="font-weight:600">${p.speedGbps ?? '—'} Gbps</span>
          </div>
          <div style="margin-top:8px;font-size:10px;color:#6b7280;border-top:1px solid rgba(255,255,255,0.06);padding-top:6px;">Source : PeeringDB</div>
        </div>`;
      new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '260px', className: 'dark-popup' })
        .setLngLat(e.lngLat).setHTML(html).addTo(this.map);
    });

    // ─── Internet / BGP outage interactions ───
    [LYR_NET_ISP, LYR_NET_ISP_RING, LYR_NET_IODA_CORE].forEach(lyr => {
      this.map!.on('mouseenter', lyr, () => { if (this.map) this.map.getCanvas().style.cursor = 'pointer'; });
      this.map!.on('mouseleave', lyr, () => { if (this.map) this.map.getCanvas().style.cursor = ''; });
    });

    this.map.on('click', LYR_NET_ISP, (e) => {
      if (!this.map || !e.features?.length) return;
      const p = e.features[0].properties ?? {};
      const visColor = p.status === 'outage' ? '#EF4444' : p.status === 'degraded' ? '#F59E0B' : '#10B981';
      const statusLabel = p.status === 'outage' ? 'Panne' : p.status === 'degraded' ? 'Dégradé' : 'Normal';
      const html = `
        <div style="color:#e8e8ec;font-family:sans-serif;min-width:220px;">
          <h4 style="margin:0 0 4px;font-weight:700;font-size:14px;color:#fff;">${p.ispName ?? `AS${p.asn}`}</h4>
          <div style="font-size:11px;color:#6366f1;margin-bottom:10px;">AS${p.asn} · BGP / Internet</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;">
            <span style="color:#9898a8">Statut :</span>
            <span style="font-weight:700;color:${visColor}">${statusLabel}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;">
            <span style="color:#9898a8">Visibilité BGP :</span>
            <span style="font-weight:600">${p.visibility ?? '—'} %</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:13px;">
            <span style="color:#9898a8">Préfixes actifs :</span>
            <span style="font-weight:600">${Number(p.prefixCount ?? 0).toLocaleString('fr-FR')} / ${Number(p.prefixCountNormal ?? 0).toLocaleString('fr-FR')}</span>
          </div>
          <div style="margin-top:8px;font-size:10px;color:#6b7280;border-top:1px solid rgba(255,255,255,0.06);padding-top:6px;">Source : BGPView</div>
        </div>`;
      new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '280px', className: 'dark-popup' })
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
            <span style="font-weight:600">${p.isOngoing ? '⏳ En cours' : durStr}</span>
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

    this.map.on('mouseenter', LYR_INFRA_CIRCLE, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mousemove', LYR_INFRA_CIRCLE, (e) => {
      if (!this.map || !e.features?.length) return;
      const p = e.features[0].properties || {};
      this.showEnrichedHoverPopup(e.lngLat, this.buildInfrastructureHoverHtml(p));
    });
    this.map.on('mouseleave', LYR_INFRA_CIRCLE, hideEnrichedHover);

    this.map.on('mouseenter', LYR_GAS_TERMINALS, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mousemove', LYR_GAS_TERMINALS, (e) => {
      if (!this.map || !e.features?.length) return;
      const p = e.features[0].properties || {};
      this.showEnrichedHoverPopup(e.lngLat, this.buildGasHoverHtml(p));
    });
    this.map.on('mouseleave', LYR_GAS_TERMINALS, hideEnrichedHover);

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

    this.map.on('mouseenter', LYR_METROPOLES_CIRCLE, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mousemove', LYR_METROPOLES_CIRCLE, (e) => {
      if (!this.map || !e.features?.length) return;
      const p = e.features[0].properties || {};
      this.showEnrichedHoverPopup(e.lngLat, this.buildMetropoleHoverHtml(p));
    });
    this.map.on('mouseleave', LYR_METROPOLES_CIRCLE, hideEnrichedHover);

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

    // ─── Vigicrues Interactions ───
    this.map.on('mouseenter', LYR_FLOODS, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mousemove', LYR_FLOODS, (e) => {
      if (!this.map || !e.features?.length) return;
      const feature = e.features[0];
      const featureId = feature.id;
      this.highlightFloodSegment(typeof featureId === 'string' ? featureId : null);

      const p = feature.properties || {};
      const level = String(p.level ?? 'green');
      const name = String(p.name ?? 'Tronçon inconnu');
      const confidence = typeof p.matchConfidence === 'number'
        ? Math.round(p.matchConfidence * 100)
        : Math.round(Number(p.matchConfidence ?? 0) * 100);
      const displayVertices = Number(p.displayVertexCount ?? 0);

      const levelColors: Record<string, string> = {
        red: '#ff3b30',
        orange: '#ff9500',
        yellow: '#ffcc00',
        green: '#34c759',
      };
      const levelLabels: Record<string, string> = {
        red: 'Rouge',
        orange: 'Orange',
        yellow: 'Jaune',
        green: 'Vert',
      };
      const levelColor = levelColors[level] ?? '#888';
      const levelLabel = levelLabels[level] ?? 'Inconnu';
      const traceText = p.geometryFidelity === 'matched'
        ? 'Tracé hydrographique recalé'
        : p.geometryFidelity === 'fallback'
          ? 'Corridor hydrographique'
          : 'Tracé brut Vigicrues';
      const sourceText = p.dataSource === 'mock' ? 'mock' : 'live';

      const html = `
        <div style="color:#e8e8ec; font-family:sans-serif; min-width:170px; padding:4px;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:6px;">
            <strong style="font-size:14px; color:#fff;">${name}</strong>
            <span style="font-size:11px; padding:2px 8px; border-radius:4px; font-weight:700; color:${level === 'yellow' || level === 'green' ? '#000' : '#fff'}; background:${levelColor};">${levelLabel}</span>
          </div>
          <div style="font-size:12px; color:#c8c8d0; margin-bottom:4px;">${traceText}</div>
          <div style="font-size:11px; color:#9898a8;">Source ${sourceText} · confiance ${confidence}% · ${displayVertices} sommets</div>
        </div>
      `;

      if (!this.floodHoverPopup) {
        this.floodHoverPopup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 16,
          maxWidth: '320px',
          className: 'dark-popup',
        });
      }
      this.floodHoverPopup.setLngLat(e.lngLat).setHTML(html).addTo(this.map);
    });
    this.map.on('mouseleave', LYR_FLOODS, () => {
      if (this.map) this.map.getCanvas().style.cursor = '';
      this.highlightFloodSegment(null);
      this.floodHoverPopup?.remove();
    });
    this.map.on('click', LYR_FLOODS, (e) => {
      if (!this.map || !e.features || e.features.length === 0) return;
      const feat = e.features[0];
      const p = feat.properties || {};

      let levelText = 'Inconnu';
      let levelColor = '#888';
      if (p.level === 'red') { levelText = 'Rouge'; levelColor = '#ff3b30'; }
      else if (p.level === 'orange') { levelText = 'Orange'; levelColor = '#ff9500'; }
      else if (p.level === 'yellow') { levelText = 'Jaune'; levelColor = '#ffcc00'; }
      else if (p.level === 'green') { levelText = 'Vert'; levelColor = '#34c759'; }

      let traceText = 'Tracé brut Vigicrues';
      if (p.geometryFidelity === 'matched') traceText = 'Tracé recalé sur hydrographie';
      else if (p.geometryFidelity === 'fallback') traceText = 'Corridor hydrographique';

      const dataSourceText = p.dataSource === 'mock' ? 'mock' : 'live';
      const confidence = typeof p.matchConfidence === 'number'
        ? Math.round(p.matchConfidence * 100)
        : Math.round(Number(p.matchConfidence ?? 0) * 100);
      const displayVertices = Number(p.displayVertexCount ?? 0);

      // Compute bbox from actual geometry for EO Browser deep-link
      const geom = feat.geometry;
      const hasLineGeom = geom !== null &&
          (geom.type === 'LineString' || geom.type === 'MultiLineString');
      const aoBbox: [number, number, number, number] = hasLineGeom
          ? computeFloodSegmentBbox(geom as LineString | MultiLineString)
          : [e.lngLat.lng - 0.05, e.lngLat.lat - 0.05, e.lngLat.lng + 0.05, e.lngLat.lat + 0.05];
      const eoBrowserUrl = buildEoBrowserUrl(aoBbox, 'sentinel-2-l2a');
      const ctaHtml = this.onSatelliteView
        ? `<button class="satellite-cta-btn" type="button" data-action="satellite-panel">Avant / apres</button>`
        : `<a class="satellite-cta-btn" href="${eoBrowserUrl}" target="_blank" rel="noopener noreferrer">Avant / apres ↗</a>`;

      this.floodHoverPopup?.remove();
      this.fitBounds(aoBbox, 80);

      const html = `
        <div style="color:#e8e8ec; font-family:sans-serif; min-width:180px;">
          <h4 style="margin:0 0 4px; font-weight:700; font-size: 15px; color: #ffffff;">
            Vigicrues
          </h4>
          <div style="margin:0 0 10px; font-size: 13px; font-weight: 600; color: #64d2ff;">
            ${p.name || 'Tronçon inconnu'}
          </div>
          <div style="font-size:13px; margin-bottom: 2px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="color:#9898a8">Niveau de vigilance :</span>
              <span style="font-size:11px; padding:2px 6px; border-radius:4px; font-weight:700; color:${p.level === 'yellow' || p.level === 'green' ? '#000' : '#fff'}; background:${levelColor}">${levelText}</span>
            </div>
          </div>
          <div style="font-size:12px; color:#c8c8d0; margin:8px 0 2px;">
            ${traceText}
          </div>
          <div style="font-size:11px; color:#8f90a0; margin-bottom: 10px;">
            Source ${dataSourceText} · confiance ${confidence}% · ${displayVertices} sommets
          </div>
          ${ctaHtml}
        </div>
      `;

      const popup = new maplibregl.Popup({
          closeButton: true, closeOnClick: true, maxWidth: '300px', className: 'dark-popup',
      })
          .setLngLat(e.lngLat)
          .setHTML(html)
          .addTo(this.map);

      if (this.onSatelliteView) {
        const button = popup.getElement().querySelector<HTMLElement>('[data-action="satellite-panel"]');
        button?.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.onSatelliteView?.({
            bbox: aoBbox,
            sourceType: 'flood',
            title: String(p.name || 'Zone Vigicrues'),
            geometry: hasLineGeom ? geom as LineString | MultiLineString : undefined,
            preferredCollection: 'sentinel-2-l2a',
          });
          popup.remove();
        });
      }
    });

    // ─── Weather Department Interactions (tooltip on hover) ───
    this.map.on('mouseenter', LYR_WEATHER_FILL, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', LYR_WEATHER_FILL, () => {
      if (this.map) this.map.getCanvas().style.cursor = '';
      this.weatherHoverPopup?.remove();
    });
    this.map.on('mousemove', LYR_WEATHER_FILL, (e) => {
      if (!this.map || !e.features || e.features.length === 0) return;
      const feat = e.features[0];
      const p = feat.properties || {};
      const code = String(p.code ?? '');
      const nom = String(p.nom ?? p.name ?? 'Département');
      const level = String(p.level ?? 'green');
      const risksStr = String(p.risks ?? '');

      // Level display
      const levelColors: Record<string, string> = {
        red: '#ff3b30', orange: '#ff9500', yellow: '#ffcc00', green: '#34c759', violet: '#af52de'
      };
      const levelLabels: Record<string, string> = {
        red: 'Rouge', orange: 'Orange', yellow: 'Jaune', green: 'Vert', violet: 'Violet'
      };
      const levelColor = levelColors[level] ?? '#888';
      const levelLabel = levelLabels[level] ?? 'Inconnu';

      // Risk labels
      const riskLabels: Record<string, string> = {
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

      const risks = risksStr.split(',').map(r => r.trim()).filter(Boolean);
      const risksHtml = risks.length > 0
        ? `<div style="margin-top:8px; display:flex; flex-wrap:wrap; gap:4px;">
             ${risks.map(r => {
          const emoji = WEATHER_RISK_EMOJIS[r] ?? '⚠️';
          const label = riskLabels[r] ?? r;
          return `<span style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); padding:2px 6px; border-radius:4px; font-size:11px;">${emoji} ${label}</span>`;
        }).join('')}
           </div>`
        : '';

      const html = `
        <div style="color:#e8e8ec; font-family:sans-serif; min-width:160px; padding:4px;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:6px;">
            <strong style="font-size:14px; color:#fff;">${nom}</strong>
            <span style="font-size:11px; padding:2px 8px; border-radius:4px; font-weight:700; color:${level === 'yellow' || level === 'green' ? '#000' : '#fff'}; background:${levelColor};">${levelLabel}</span>
          </div>
          <div style="font-size:11px; color:#9898a8;">Dpt. ${code}</div>
          ${risksHtml}
        </div>
      `;

      if (!this.weatherHoverPopup) {
        this.weatherHoverPopup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 16,
          maxWidth: '320px',
          className: 'dark-popup'
        });
      }
      this.weatherHoverPopup.setLngLat(e.lngLat).setHTML(html).addTo(this.map);

      // Update feature state for border highlight
      const featureId = code;
      if (this._lastHoveredDeptId !== null && this._lastHoveredDeptId !== featureId) {
        this.map.setFeatureState({ source: SRC_WEATHER, id: this._lastHoveredDeptId }, { hover: false });
      }
      this.map.setFeatureState({ source: SRC_WEATHER, id: featureId }, { hover: true });
      this._lastHoveredDeptId = featureId;
    });

    // ─── Energy Region Interactions (tooltip on hover) ───
    const ECOWATT_SIG_COLORS: Record<string, string> = { green: '#34c759', orange: '#ff9500', red: '#ff3b30' };
    const ECOWATT_SIG_LABELS: Record<string, string> = { green: 'Consommation normale', orange: 'Système électrique tendu', red: 'Coupures ciblées possibles' };
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

    this.map.on('mouseenter', LYR_ENERGY_FILL, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'crosshair';
    });
    this.map.on('mouseleave', LYR_ENERGY_FILL, () => {
      if (this.map) this.map.getCanvas().style.cursor = '';
      this.energyRegionPopup?.remove();
      this.energyRegionPopup = null;
    });
    this.map.on('mousemove', LYR_ENERGY_FILL, (e) => {
      if (!this.map || !e.features?.length) return;
      // Arc or gas feature takes priority over the region fill
      const overrideFeats = this.map.queryRenderedFeatures(e.point, {
        layers: [LYR_INTERCONN_HITAREA, LYR_GAS_TERMINALS, LYR_GAS_STORAGES, LYR_GAS_PIR_MARKER],
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
      const sig = s.ecowattToday;
      const sigColor = ECOWATT_SIG_COLORS[sig] ?? '#888';
      const deltaColor = s.consumptionDeltaPct <= 0 ? '#34c759' : '#ff3b30';

      const prodRows: [string, number][] = [
        ['☢ Nucléaire', p.nuclear],
        ['💧 Hydraulique', p.hydro],
        ['💨 Éolien', p.wind],
        ['☀ Solaire', p.solar],
        ['🔥 Thermique', p.gas],
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
          ${sectionLabel('Écowatt')}
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            <span style="width:8px;height:8px;border-radius:50%;background:${sigColor};display:inline-block;"></span>
            <span style="font-size:12px;color:${sigColor};font-weight:600;">${ECOWATT_SIG_LABELS[sig] ?? sig}</span>
          </div>
          ${sep}
          ${sectionLabel('Consommation')}
          ${row('Actuelle', fmtMW(s.consumptionMW))}
          ${row('Vs J-1', fmtDelta(s.consumptionDeltaPct), deltaColor)}
          ${sep}
          ${sectionLabel(`Production — ${fmtMW(p.total)}`)}
          ${prodRowsHTML}
          ${row('Bas-carbone', `${s.lowCarbonPct.toFixed(0)} %`, '#34c759')}
          ${sep}
          ${row('⚡ Intensité CO₂', `${Math.round(s.carbonIntensity)} gCO₂/kWh`, co2Color(s.carbonIntensity))}
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
    const FLOW_LABELS: Record<string, string> = { export: 'Export ↗', import: 'Import ↙', balanced: 'Équilibré ↔' };
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
          ${f.summary ? `${sep}<div style="font-size:11px;color:#9898a8;font-style:italic;line-height:1.4;">${f.summary}</div>` : ''}
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

    // ─── Traffic Incidents Interactions ───
    this.map.on('mouseenter', LYR_TRAFFIC_INCIDENTS, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', LYR_TRAFFIC_INCIDENTS, () => {
      if (this.map) this.map.getCanvas().style.cursor = '';
    });
    this.map.on('click', LYR_TRAFFIC_INCIDENTS, (e) => {
      if (!this.map || !e.features || e.features.length === 0) return;
      const feat = e.features[0];
      const p = feat.properties || {};
      const coords = (feat.geometry as GeoJSON.Point).coordinates as [number, number];

      // Format delay in minutes
      const delayMin = Math.round((p.delay || 0) / 60);
      const delayText = delayMin > 0 ? `${delayMin} min` : '—';

      // Format length in km
      const lengthKm = ((p.length || 0) / 1000).toFixed(1);
      const lengthText = p.length > 0 ? `${lengthKm} km` : '—';

      // Severity color
      const sevColors: Record<string, string> = {
        critical: '#ff3b30',
        high: '#ff3b30',
        medium: '#ff9500',
        low: '#ffcc00'
      };
      const sevColor = sevColors[p.severity] || '#ffcc00';
      const sevText = p.severity === 'critical' ? 'Critique' :
        p.severity === 'high' ? 'Fort' :
          p.severity === 'medium' ? 'Modéré' : 'Faible';

      // Type emoji
      const typeEmoji: Record<string, string> = {
        'Accident': '🚨',
        'Bouchon': '🚗',
        'Travaux': '🚧',
        'Voie fermée': '🚫',
        'Route barrée': '⛔',
        'Vent fort': '💨',
        'Inondation': '🌊',
      };
      const emoji = typeEmoji[p.type] || '⚠️';

      const html = `
        <div style="color:#e8e8ec; font-family:sans-serif; min-width:200px;">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <span style="font-size:20px;">${emoji}</span>
            <div>
              <h4 style="margin:0; font-weight:700; font-size:14px; color:#fff;">${p.type || 'Incident'}</h4>
              <span style="font-size:10px; padding:2px 6px; border-radius:4px; font-weight:700; color:#fff; background:${sevColor}">${sevText}</span>
            </div>
          </div>

          <div style="font-size:12px; margin-bottom:8px; display:grid; grid-template-columns:1fr 1fr; gap:4px;">
            <div style="color:#9898a8;">Retard :</div>
            <div style="font-weight:600; color:#ff9f0a;">${delayText}</div>
            <div style="color:#9898a8;">Longueur :</div>
            <div style="font-weight:600;">${lengthText}</div>
          </div>

          ${p.description && p.description !== 'null' && p.description.trim() !== '' ?
          `<p style="margin:0; font-size:11px; color:#a1a1aa; border-top:1px solid rgba(255,255,255,0.1); padding-top:8px;">${p.description}</p>` : ''}
        </div>
      `;

      new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '320px', className: 'dark-popup' })
        .setLngLat(coords)
        .setHTML(html)
        .addTo(this.map);
    });

    // ─── Military Bases interactions ───
    this.map.on('mouseenter', LYR_MILITARY_BASES_CIRCLE, (e) => {
      if (!this.map) return;
      this.map.getCanvas().style.cursor = 'pointer';
      const feat = e.features?.[0];
      if (!feat) return;
      const p = feat.properties || {};
      this.showMilitaryTooltip(
        e.lngLat,
        `<strong>${p.name || 'Base'}</strong><br><span style="color:#34c759;font-size:11px">${p.type || ''}</span>`
      );
    });
    this.map.on('mouseleave', LYR_MILITARY_BASES_CIRCLE, () => {
      if (this.map) this.map.getCanvas().style.cursor = '';
      this.militaryTooltip?.remove();
      this.militaryTooltip = null;
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

    // ─── Military Flights interactions ───
    this.map.on('mouseenter', LYR_MILITARY_FLIGHTS, (e) => {
      if (!this.map) return;
      this.map.getCanvas().style.cursor = 'pointer';
      const feat = e.features?.[0];
      if (!feat) return;
      const p = feat.properties || {};
      const altFl = p.altitude > 0 ? `FL${Math.round(p.altitude / 100)}` : 'Au sol';
      const typeModel = p.aircraftModel
        ? `${p.aircraftModel}`
        : (p.aircraftType && p.aircraftType !== 'unknown' ? p.aircraftType : '⚡ Militaire');
      this.showMilitaryTooltip(
        e.lngLat,
        `<strong>${p.callsign || 'N/A'}</strong> · ${typeModel}<br><span style="color:#ffcc00;font-size:11px">${altFl} · ${p.speed || 0} kts</span>`
      );
    });
    this.map.on('mouseleave', LYR_MILITARY_FLIGHTS, () => {
      if (this.map) this.map.getCanvas().style.cursor = '';
      this.militaryTooltip?.remove();
      this.militaryTooltip = null;
    });
    this.map.on('click', LYR_MILITARY_FLIGHTS, (e) => {
      if (!this.map || !e.features || e.features.length === 0) return;
      const feat = e.features[0];
      const flightId = feat.properties?.id as string | undefined;
      if (!flightId || !this.onMilitaryFlightClick) return;
      const flight = this.militaryFlightsById.get(flightId);
      if (!flight) return;
      this.militaryTooltip?.remove();
      this.militaryTooltip = null;
      const pt = this.map.project(e.lngLat);
      this.onMilitaryFlightClick(flight, pt.x, pt.y);
    });

    // ─── Civil Air Traffic interactions ───
    // Hover events are handled directly by DeckGL's IconLayer `onHover` handler.


    // ─── Military Ships interactions ───
    this.map.on('mouseenter', LYR_MILITARY_SHIPS, (e) => {
      if (!this.map) return;
      this.map.getCanvas().style.cursor = 'pointer';
      const feat = e.features?.[0];
      if (!feat) return;
      const p = feat.properties || {};
      this.showMilitaryTooltip(
        e.lngLat,
        `<strong>⚓ ${p.name || 'Navire'}</strong><br><span style="color:#00d4c8;font-size:11px">${p.type || 'Marine'}</span>${p.speed > 0 ? `<br><span style="color:#9898a8;font-size:10px">${p.speed} nœuds</span>` : ''}`
      );
    });
    this.map.on('mouseleave', LYR_MILITARY_SHIPS, () => {
      if (this.map) this.map.getCanvas().style.cursor = '';
      this.militaryTooltip?.remove();
      this.militaryTooltip = null;
    });
    this.map.on('click', LYR_MILITARY_SHIPS, (e) => {
      if (!this.map || !e.features || e.features.length === 0) return;
      const feat = e.features[0];
      const shipId = feat.properties?.id as string | undefined;
      if (!shipId) return;
      const ship = this.militaryShipsById.get(shipId);
      if (!ship) return;
      this.militaryTooltip?.remove();
      this.militaryTooltip = null;
      const pt = this.map.project(e.lngLat);
      if (this.onMilitaryShipClick) this.onMilitaryShipClick(ship, pt.x, pt.y);
      if (this._onMaritimeShipClick) {
        const full: MilitaryShip | undefined = getAllLiveTraffic().find(s => s.mmsi === ship.mmsi) ?? getMilitaryShips().find(s => s.mmsi === ship.mmsi);
        if (full) this._onMaritimeShipClick(full, pt.x, pt.y);
      }
    });

    // ─── Submarine Cables Interactions ───
    const showSubseaCableHover = (
      e: maplibregl.MapLayerMouseEvent,
      source: typeof SRC_SUBMARINE_CABLES | typeof SRC_SUBMARINE_CABLES_LANDINGS
    ) => {
      if (!this.map) return;
      const feat = e.features?.[0];
      if (!feat?.properties) return;

      this.map.getCanvas().style.cursor = 'pointer';
      this.clearSubseaCableHoverState();

      if (source === SRC_SUBMARINE_CABLES && feat.id != null) {
        this.hoveredSubseaCableId = feat.id;
        this.map.setFeatureState({ source, id: feat.id }, { hover: true });
      }
      if (source === SRC_SUBMARINE_CABLES_LANDINGS && feat.id != null) {
        this.hoveredSubseaLandingId = feat.id;
        this.map.setFeatureState({ source, id: feat.id }, { hover: true });
      }

      this.showMilitaryTooltip(e.lngLat, buildSubseaCableTooltip(feat.properties as Record<string, unknown>));
    };

    for (const layerId of [LYR_SUBMARINE_CABLES_HITAREA, LYR_SUBMARINE_CABLES_LANDING]) {
      this.map.on('mouseenter', layerId, () => {
        if (this.map) this.map.getCanvas().style.cursor = 'pointer';
      });
      this.map.on('mouseleave', layerId, () => {
        if (this.map) this.map.getCanvas().style.cursor = '';
        this.hideSubseaCableTooltip();
      });
    }

    this.map.on('mousemove', LYR_SUBMARINE_CABLES_HITAREA, (e) => showSubseaCableHover(e, SRC_SUBMARINE_CABLES));
    this.map.on('mousemove', LYR_SUBMARINE_CABLES_LANDING, (e) => showSubseaCableHover(e, SRC_SUBMARINE_CABLES_LANDINGS));

    // Track view state
    this.map.on('moveend', () => {
      if (!this.map) return;
      const c = this.map.getCenter();
      this.viewState = {
        longitude: c.lng, latitude: c.lat,
        zoom: this.map.getZoom(), pitch: this.map.getPitch(), bearing: this.map.getBearing(),
      };
      this.onViewChange?.(this.viewState);
    });

    // ═══════════════════════════════════════════════════════════════
    // PULSE OVERLAY (CSS animations for critical/high alerts)
    // ═══════════════════════════════════════════════════════════════
    this.initPulseOverlay();
    this.startSubseaPulseAnimation();

    // Update pulse markers on map move
    this.map.on('move', () => this.updatePulseMarkerPositions());
    this.map.on('zoom', () => this.updatePulseMarkerPositions());

    // Keep health layer above other fills so it remains visible when enabled.
    try {
      this.map.moveLayer(LYR_HEALTH_FILL);
      this.map.moveLayer(LYR_HEALTH_APL_FILL);
      this.map.moveLayer(LYR_HEALTH_APL_LINE);
      this.map.moveLayer(LYR_HEALTH_LINE);
      this.map.moveLayer(LYR_HEALTH_OSCOUR_CIRCLES);
      this.map.moveLayer(LYR_HEALTH_MARKERS);
    } catch {
      // Ignore if layer order cannot be adjusted yet.
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
          : ['trafficRoad', 'trafficAir', 'health', 'healthApl', 'healthOscour', 'hospitals'].includes(this.legendHoverCategory)
            ? 0.15
            : 1;
    const roadDeckOpacity =
      this.legendHoverCategory == null
        ? 1
        : this.legendHoverCategory === 'trafficRoad'
          ? 1
          : ['trafficMaritime', 'trafficAir', 'health', 'healthApl', 'healthOscour', 'hospitals'].includes(this.legendHoverCategory)
            ? 0.15
            : 1;
    const airDeckOpacity =
      this.legendHoverCategory == null
        ? 1
        : this.legendHoverCategory === 'trafficAir'
          ? 1
          : ['trafficRoad', 'trafficMaritime', 'health', 'healthApl', 'healthOscour', 'hospitals'].includes(this.legendHoverCategory)
            ? 0.15
            : 1;

    const getShipTypeNumber = (d: AisShipData): number => {
      const raw = (d.shipType ?? (d as { ShipType?: unknown }).ShipType ?? (d as { type?: unknown }).type);
      const value = raw == null ? NaN : Number(raw);
      return Number.isFinite(value) ? value : 0;
    };
    const getAisIconColor = (d: AisShipData): string => {
      if (d.mmsi && d.mmsi === this._highlightedMmsi) return '#ffffff';
      if (d.mmsi && d.mmsi === this._selectedShipMmsi) return '#5ac8fa';
      const t = getShipTypeNumber(d);
      if (t >= 80 && t <= 89) return '#60a5fa';      // Tanker — bleu clair
      if (t >= 70 && t <= 79) return '#4ade80';      // Cargo — vert
      if (t >= 60 && t <= 69) return '#f97316';      // Passagers — orange
      if (t === 55 || t === 51 || t === 52 || t === 53) return '#a855f7'; // Remorqueur/SAR/pilote — violet
      if (t === 36 || t === 37) return '#06b6d4';    // Voilier/plaisance — cyan
      if (t >= 40 && t <= 49) return '#f472b6';      // Grande vitesse — rose
      if (t === 30 || t === 31 || t === 32 || t === 33 || t === 34) return '#facc15'; // Pêche — jaune
      if (d.navStatus === 7) return '#facc15';        // Pêche par statut — jaune
      return '#94a3b8';                              // Inconnu — gris
    };
    const getAisSize = (d: AisShipData): number => {
      if (d.mmsi && d.mmsi === this._highlightedMmsi) return 22;
      if (d.mmsi && d.mmsi === this._selectedShipMmsi) return 18;
      return 14;
    };
    const getAisAngle = (d: AisShipData): number => this.getAisDeckAngle(d);
    const maritimeLabelData = this.globalTrafficData.filter((ship) => {
      if (!ship.name || ship.name.trim().length === 0) return false;
      if (ship.mmsi === this._highlightedMmsi || ship.mmsi === this._selectedShipMmsi) return true;
      return this.viewState.zoom >= 8;
    });
    return [
      new DayNightLayer({
        id: 'day-night',
        timestamp: this.dayNightOptions.timestamp || Date.now(),
        showNight: this.dayNightOptions.showNight,
        showTwilight: this.dayNightOptions.showTwilight,
        showSunIcon: this.dayNightOptions.showSunIcon,
        resolution: 1,
        visible: this.dayNightVisible,
        opacity: 1,
      }),
      new PathLayer<AisShipData>({
        id: 'deck-ais-trails',
        data: this.globalTrafficData.filter(d => d.trail && d.trail.length >= 2),
        visible: this.globalTrafficVisible,
        opacity: maritimeDeckOpacity * 0.5,
        coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        getPath: (d: AisShipData) => (d.trail ?? []) as [number, number][],
        getColor: (d: AisShipData) => {
          const t = d.shipType ?? 0;
          if (t >= 80 && t <= 89) return [96, 165, 250, 180];   // Tanker bleu
          if (t >= 70 && t <= 79) return [74, 222, 128, 180];   // Cargo vert
          if (t >= 60 && t <= 69) return [249, 115, 22, 180];   // Passagers orange
          if (t === 30 || t === 31 || t === 32 || t === 33 || t === 34) return [250, 204, 21, 180]; // Pêche jaune
          return [148, 163, 184, 120];                           // Défaut gris
        },
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
        visible: this.globalTrafficVisible && this.viewState.zoom >= 8,
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
      new ScatterplotLayer<TrafficIncident>({
        id: 'deck-road-incidents',
        data: this.roadTrafficIncidents,
        visible: this.roadTrafficVisible,
        opacity: roadDeckOpacity,
        coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        getPosition: (d: TrafficIncident) => [d.lon, d.lat],
        getRadius: (d: TrafficIncident) => {
          if (d.severity === 'high' || d.type === 'Route barrée') return 22000;
          if (d.severity === 'medium') return 15000;
          return 10000;
        },
        getFillColor: (d: TrafficIncident) => {
          if (d.severity === 'high' || d.type === 'Route barrée') return [255, 80, 80, 225] as [number, number, number, number];
          if (d.severity === 'medium') return [255, 170, 0, 205] as [number, number, number, number];
          return [255, 220, 80, 185] as [number, number, number, number];
        },
        radiusMinPixels: 5,
        radiusMaxPixels: 16,
        stroked: true,
        getLineColor: [255, 255, 255, 170],
        lineWidthMinPixels: 1,
        pickable: true,
        onHover: (info) => {
          void this.handleRoadIncidentHover(info);
        },
        onClick: (info) => {
          void this.handleRoadIncidentClick(info);
        },
        updateTriggers: {
          getPosition: this.roadTrafficIncidents,
          getFillColor: this.roadTrafficIncidents,
          getRadius: this.roadTrafficIncidents,
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
        getIcon: (d: AirTrafficFlight) => this.getAirTrafficIconDef(this.getAirTrafficColorHex(d)),
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
    ];
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

  private getAirTrafficColorHex(flight: AirTrafficFlight): string {
    const alt = flight.altitude ?? 0;

    // Low altitude flights (< 5000ft): warm/orange
    if (alt < 5000) return '#ff7832'; // [255, 120, 50]

    // Climbing/Descending mid-level (< 15000ft): yellow
    if (alt < 15000) return '#ffd232'; // [255, 210, 50]

    // High-mid level (< 25000ft): greenish
    if (alt < 25000) return '#82e650'; // [130, 230, 80]

    // Crusing (< 35000ft): light blue
    if (alt < 35000) return '#32c8ff'; // [50, 200, 255]

    // High crusing (> 35000ft): violet / indigo
    return '#8264ff'; // [130, 100, 255]
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

  private refreshCivilAirTrafficSource(): void {
    if (!this.map) return;
    const src = this.map.getSource(SRC_AIR_TRAFFIC) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    src.setData({
      type: 'FeatureCollection',
      features: this.civilAirTrafficFlights.map((flight) => {
        const [longitude, latitude] = this.projectAirTrafficPosition(flight);
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [longitude, latitude] },
          properties: {
            id: flight.id,
            callsign: flight.callsign,
            altitude: flight.altitude,
            speed: flight.speed,
            heading: this.normalizeFlightHeading(flight.heading),
            registration: flight.registration || '',
            aircraftType: flight.aircraftType || '',
            aircraftModel: flight.aircraftModel || '',
            operator: flight.operator || '',
            category: flight.category || '',
            originAirport: flight.originAirport || '',
            destinationAirport: flight.destinationAirport || '',
            source: flight.source || '',
          },
        };
      }),
    });
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

    const altitude = flight.altitude > 0 ? `FL${Math.round(flight.altitude / 100)}` : 'Niveau inconnu';
    const speed = flight.speed > 0 ? `${flight.speed} kts` : 'Vitesse inconnue';
    const registration = flight.registration ? `<br><span style="color:#cbd5e1;font-size:10px">Immat: ${flight.registration}</span>` : '';
    const aircraft = flight.aircraftModel || flight.aircraftType || 'Vol civil';
    const operator = flight.operator ? `<br><span style="color:#94a3b8;font-size:10px">${flight.operator}</span>` : '';
    const origin = flight.originAirport ? `<br><span style="color:#cbd5e1;font-size:10px">Origine: ${flight.originAirport}</span>` : '';
    const destination = flight.destinationAirport ? `<br><span style="color:#cbd5e1;font-size:10px">Arrivée: ${flight.destinationAirport}</span>` : '';
    const eta = flight.eta
      ? `<br><span style="color:#cbd5e1;font-size:10px">ETA: ${new Date(flight.eta).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>`
      : '';
    const source = flight.source ? `<br><span style="color:#64748b;font-size:10px">Source: ${flight.source}</span>` : '';
    const airportContext = flight.nearbyAirportIata
      ? `<br><span style="color:#facc15;font-size:10px">Aéroport: ${flight.nearbyAirportIata}${flight.nearbyAirportName ? ` · ${flight.nearbyAirportName}` : ''}${flight.nearbyAirportDistanceKm != null ? ` · ${flight.nearbyAirportDistanceKm} km` : ''}</span>`
      : '';
    const airportScore = flight.airportScore != null
      ? `<br><span style="color:#fbbf24;font-size:10px">Score aéroport: ${flight.airportScore}/100${flight.airportSeverity ? ` · ${flight.airportSeverity}` : ''}</span>`
      : '';
    const anomalies = Array.isArray(flight.anomalies) && flight.anomalies.length > 0
      ? `<br><span style="color:#fda4af;font-size:10px">Anomalies: ${flight.anomalies.map((anomaly) => anomaly.label).join(' · ')}</span>`
      : '';

    this.showMilitaryTooltip(
      lngLat,
      `<strong>${flight.callsign || 'Vol civil'}</strong><br><span style="color:#7dd3fc;font-size:11px">${aircraft}</span>${operator}${registration}${origin}${destination}${eta}${airportContext}${airportScore}${anomalies}<br><span style="color:#9ca3af;font-size:10px">${altitude} · ${speed} · cap ${Math.round(flight.heading || 0)}°</span>${source}`
    );
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

  private async handleRoadIncidentHover(info: { object?: unknown; coordinate?: number[]; x?: number; y?: number }): Promise<void> {
    if (!this.map) return;
    const incident = info.object as TrafficIncident | undefined;
    this.map.getCanvas().style.cursor = incident ? 'pointer' : '';

    if (this.trafficIncidentHoverTimer) {
      clearTimeout(this.trafficIncidentHoverTimer);
      this.trafficIncidentHoverTimer = null;
    }

    if (!incident) {
      this.hoveredTrafficIncidentId = null;
      this.hideTrafficIncidentPopup();
      return;
    }

    this.hoveredTrafficIncidentId = incident.id;
    const coord = info.coordinate;
    const lngLat =
      coord && coord.length >= 2
        ? new maplibregl.LngLat(coord[0], coord[1])
        : this.map.unproject([info.x ?? 0, info.y ?? 0]);

    const popup = this.getTrafficIncidentPopup();
    popup.setLngLat(lngLat).setHTML(this.buildTrafficIncidentPopupHtml(incident)).addTo(this.map);
    const popupEl = popup.getElement();
    popupEl.style.pointerEvents = 'none';
    popupEl.style.zIndex = '2000';

    this.trafficIncidentHoverTimer = setTimeout(async () => {
      const flow = await fetchTrafficFlowSegment(incident.lat, incident.lon, this.viewState.zoom);
      if (this.hoveredTrafficIncidentId !== incident.id) return;
      popup.setHTML(this.buildTrafficIncidentPopupHtml(incident, flow));
      const refreshedEl = popup.getElement();
      refreshedEl.style.pointerEvents = 'none';
      refreshedEl.style.zIndex = '2000';
    }, 350);
  }

  private async handleRoadIncidentClick(info: { object?: unknown; coordinate?: number[]; x?: number; y?: number }): Promise<void> {
    if (!this.map) return;
    const incident = info.object as TrafficIncident | undefined;
    if (!incident) return;

    const coord = info.coordinate;
    const lngLat =
      coord && coord.length >= 2
        ? new maplibregl.LngLat(coord[0], coord[1])
        : this.map.unproject([info.x ?? 0, info.y ?? 0]);

    const popup = this.getTrafficIncidentPopup();
    popup.setLngLat(lngLat).setHTML(this.buildTrafficIncidentPopupHtml(incident)).addTo(this.map);

    const flow = await fetchTrafficFlowSegment(incident.lat, incident.lon, this.viewState.zoom);
    popup.setHTML(this.buildTrafficIncidentPopupHtml(incident, flow));
  }

  private getTrafficIncidentPopup(): maplibregl.Popup {
    if (!this.trafficIncidentPopup) {
      this.trafficIncidentPopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        maxWidth: '340px',
        className: 'dark-popup',
        offset: 8,
      });
    }
    return this.trafficIncidentPopup;
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
    const voltageKv = Number(properties.voltageKv ?? 0);
    const fuelType = String(properties.fuelType ?? '');
    const storageCapacityHm3 = Number(properties.storageCapacityHm3 ?? 0);
    const throughputKbpd = Number(properties.throughputKbpd ?? 0);
    const notes = String(properties.notes ?? '');
    const hasEnergyData = Number.isFinite(power) && power > 0;

    return `
      <div style="color:#e8e8ec; font-family:sans-serif; min-width:220px;">
        <div style="font-size:14px; font-weight:700; color:#fff;">${this.escapeHtml(String(properties.name ?? 'Infrastructure'))}</div>
        <div style="margin:2px 0 10px; font-size:12px; font-weight:600; color:${this.escapeHtml(String(properties.color ?? '#e8e8ec'))};">
          ${this.escapeHtml(typeLabels[type] ?? type)}
        </div>
        <div style="display:grid; grid-template-columns:1fr auto; gap:6px 10px; font-size:12px;">
          ${operator ? `<span style="color:#9898a8;">Opérateur</span><strong>${this.escapeHtml(operator)}</strong>` : ''}
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

    return `
      <div style="color:#e8e8ec; font-family:sans-serif; min-width:220px;">
        <div style="font-size:14px; font-weight:700; color:#fff;">${this.escapeHtml(String(properties.name ?? 'Site gaz'))}</div>
        <div style="margin:2px 0 10px; font-size:12px; font-weight:600; color:${isTerminal ? '#A78BFA' : '#2DD4BF'};">
          ${isTerminal ? 'Terminal GNL' : 'Stockage gaz'}
        </div>
        <div style="display:grid; grid-template-columns:1fr auto; gap:6px 10px; font-size:12px;">
          <span style="color:#9898a8;">Opérateur</span><strong>${this.escapeHtml(operator)}</strong>
          ${capacity > 0 ? `<span style="color:#9898a8;">Capacité</span><strong>${capacity.toLocaleString('fr-FR')} ${isTerminal ? 'GWh' : 'TWh'}</strong>` : ''}
          ${Number.isFinite(fillLevel) ? `<span style="color:#9898a8;">Remplissage</span><strong>${fillLevel.toFixed(0)} %</strong>` : ''}
          ${!isTerminal ? `<span style="color:#9898a8;">Tendance</span><strong>${this.escapeHtml(trendLabel)}</strong>` : ''}
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
          ${isImp ? 'Import gaz ↙' : 'Export gaz ↗'}
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
    const trendLabel: Record<string, string> = { filling: 'Remplissage ↑', withdrawing: 'Soutirage ↓', stable: 'Stable →' };
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
           ${sectionLabel('7 derniers jours — solde GWh/j')}
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
            ${f.direction === 'import' ? 'Import ↙' : 'Export ↗'}
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
          ${isImport ? 'Flux import ↙' : 'Flux export ↗'}
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

  private hideTrafficIncidentPopup(): void {
    this.trafficIncidentPopup?.remove();
  }

  private buildTrafficIncidentPopupHtml(incident: TrafficIncident, flow?: TrafficFlowSegment | null): string {
    const delayMin = Math.round((incident.delay || 0) / 60);
    const delayText = delayMin > 0 ? `${delayMin} min` : '—';
    const lengthText = incident.length > 0 ? `${(incident.length / 1000).toFixed(1)} km` : '—';
    const sevColors: Record<string, string> = {
      critical: '#ff3b30',
      high: '#ff3b30',
      medium: '#ff9500',
      low: '#ffcc00',
    };
    const sevColor = sevColors[incident.severity] || '#ffcc00';
    const sevText = incident.severity === 'critical' ? 'Critique'
      : incident.severity === 'high' ? 'Fort'
        : incident.severity === 'medium' ? 'Modéré'
          : 'Faible';
    const typeEmoji: Record<string, string> = {
      Accident: '🚨',
      Bouchon: '🚗',
      Travaux: '🚧',
      'Voie fermée': '🚫',
      'Route barrée': '⛔',
      'Vent fort': '💨',
      Inondation: '🌊',
    };
    const emoji = typeEmoji[incident.type] || '⚠️';
    const routeText = incident.roadNumbers && incident.roadNumbers.length > 0 ? incident.roadNumbers.join(', ') : '—';
    const validityText = incident.timeValidity === 'future' ? 'Planifié' : 'En cours';
    const formatDate = (value?: string | null) => {
      if (!value) return '—';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return this.escapeHtml(value);
      return date.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    };

    const flowHtml = flow
      ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.1);display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;">
          <div><span style="color:#71717a;">Vitesse</span><br><strong>${flow.currentSpeed} km/h</strong></div>
          <div><span style="color:#71717a;">Vitesse libre</span><br><strong>${flow.freeFlowSpeed} km/h</strong></div>
          <div><span style="color:#71717a;">Temps courant</span><br><strong>${flow.currentTravelTime}s</strong></div>
          <div><span style="color:#71717a;">Fermeture</span><br><strong>${flow.roadClosure ? 'Oui' : 'Non'}</strong></div>
        </div>`
      : `<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.1);font-size:11px;color:#71717a;">Chargement Flow Segment Data…</div>`;

    return `
      <div style="padding:14px; min-width:280px;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
          <span style="font-size:20px;">${emoji}</span>
          <div style="flex:1;">
            <div style="font-size:14px; font-weight:700; color:#fff;">${this.escapeHtml(incident.type)}</div>
            <div style="font-size:11px; color:${sevColor}; font-weight:600;">${sevText} · ${validityText}</div>
          </div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:11px; margin-bottom:10px;">
          <div><span style="color:#71717a;">Retard</span><br><strong>${delayText}</strong></div>
          <div><span style="color:#71717a;">Longueur</span><br><strong>${lengthText}</strong></div>
          <div><span style="color:#71717a;">Route</span><br><strong>${this.escapeHtml(routeText)}</strong></div>
          <div><span style="color:#71717a;">Signalements</span><br><strong>${incident.numberOfReports ?? '—'}</strong></div>
        </div>
        ${incident.osintSignals && incident.osintSignals.length > 0 ? `<div style="font-size:11px; margin-bottom:8px;"><span style="color:#71717a;">Signaux OSINT</span><br><strong>${this.escapeHtml(incident.osintSignals.join(' · '))}</strong></div>` : ''}
        ${(incident.from || incident.to) ? `<div style="font-size:11px; margin-bottom:8px;"><span style="color:#71717a;">Tronçon</span><br><strong>${this.escapeHtml(incident.from ?? '—')} → ${this.escapeHtml(incident.to ?? '—')}</strong></div>` : ''}
        ${(incident.startTime || incident.endTime) ? `<div style="font-size:11px; margin-bottom:8px;"><span style="color:#71717a;">Fenêtre</span><br><strong>${formatDate(incident.startTime)} → ${formatDate(incident.endTime)}</strong></div>` : ''}
        ${(incident.lastReportTime || incident.probabilityOfOccurrence) ? `<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:11px; margin-bottom:8px;">
          <div><span style="color:#71717a;">Dernier signalement</span><br><strong>${formatDate(incident.lastReportTime)}</strong></div>
          <div><span style="color:#71717a;">Probabilité</span><br><strong>${this.escapeHtml(incident.probabilityOfOccurrence ?? '—')}</strong></div>
        </div>` : ''}
        ${incident.description && incident.description.trim() !== '' ? `<p style="margin:0; font-size:11px; color:#a1a1aa;">${this.escapeHtml(incident.description)}</p>` : ''}
        ${flowHtml}
      </div>
    `;
  }

  private getAisTooltipHtml(ship: AisShipData): string {
    const shipType = Number.isFinite(ship.shipType) ? ship.shipType : 0;
    const fishingByStatus = shipType === 0 && ship.navStatus === 7;

    // Get readable ship type label
    const typeLabel = fishingByStatus ? 'Pêche (statut)' : this.getShipTypeLabel(shipType);

    // Ship type icons based on AIS code
    const getTypeIcon = (t: number): string => {
      if (t >= 80 && t <= 89) return '🛢️';  // Tanker
      if (t >= 70 && t <= 79) return '📦';  // Cargo
      if (t >= 60 && t <= 69) return '🚢';  // Passagers
      if (t === 55) return '🚓';             // Police/SAR
      if (t === 51) return '🆘';             // SAR
      if (t === 52 || t === 53) return '🛥️'; // Remorqueur/pilote
      if (t === 36 || t === 37 || (t >= 20 && t <= 29)) return '⛵'; // Voilier/plaisance
      if (t >= 40 && t <= 49) return '💨';  // Grande vitesse
      if (t >= 30 && t <= 34) return '🎣';  // Pêche
      return '🚤';                           // Inconnu/divers
    };
    const typeIcon = fishingByStatus ? '🎣' : getTypeIcon(shipType);

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
      ? `<span style="color:${isStale ? '#f59e0b' : '#6f7080'}; font-size:10px;">${isStale ? '⚠️ ' : ''}${stalenessLabel}</span>`
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
        ${cog || heading ? row('COG/HDG', `${cog || '—'} / ${heading || '—'}`) : ''}
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
      const respMapping = await fetch('/assets/dsfr-mapping.json');
      const mapping = await respMapping.json() as Record<string, any>;

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
        ctx.drawImage(image as any, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
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
      marker.style.display = zoom >= 10 ? 'block' : 'none';
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

    for (const [id, marker] of this.pulseMarkers) {
      const item = this.itemsById.get(id);
      if (item && item.lon != null && item.lat != null) {
        const pos = this.map.project([item.lon, item.lat]);
        marker.style.left = `${pos.x}px`;
        marker.style.top = `${pos.y}px`;
        // Hide when zoomed out (clustered area)
        marker.style.display = zoom >= 10 ? 'block' : 'none';
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

    const allLegendLayers = [
      LYR_HEALTH_FILL, LYR_HEALTH_LINE,
      LYR_HEALTH_APL_FILL, LYR_HEALTH_APL_LINE,
      LYR_HEALTH_OSCOUR_CIRCLES,
      LYR_HOSPITALS_CHU, LYR_HOSPITALS_CH, LYR_HOSPITALS_LABEL,
      LYR_TRAFFIC, LYR_AIR_TRAFFIC_LABEL,
    ];

    let activeLayers: string[] = [];
    if (categoryId === 'health') {
      activeLayers = [LYR_HEALTH_FILL, LYR_HEALTH_LINE];
    } else if (categoryId === 'healthApl') {
      activeLayers = [LYR_HEALTH_APL_FILL, LYR_HEALTH_APL_LINE];
    } else if (categoryId === 'healthOscour') {
      activeLayers = [LYR_HEALTH_OSCOUR_CIRCLES];
    } else if (categoryId === 'hospitals') {
      activeLayers = [LYR_HOSPITALS_CHU, LYR_HOSPITALS_CH, LYR_HOSPITALS_LABEL];
    } else if (categoryId === 'trafficRoad') {
      activeLayers = [LYR_TRAFFIC];
    } else if (categoryId === 'trafficAir') {
      activeLayers = [LYR_AIR_TRAFFIC_LABEL];
    } else if (categoryId === 'trafficMaritime') {
      activeLayers = [];
    }

    allLegendLayers.forEach(layerId => {
      const layer = this.map!.getLayer(layerId);
      if (!layer) return;

      if (!this.originalOpacities.has(layerId)) {
        let prop = 'fill-opacity';
        if (layer.type === 'line') prop = 'line-opacity';
        if (layer.type === 'circle') prop = 'circle-opacity';
        if (layer.type === 'symbol') prop = 'text-opacity';
        if (layer.type === 'raster') prop = 'raster-opacity';

        const orig = this.map!.getPaintProperty(layerId, prop) ?? 1;
        this.originalOpacities.set(layerId, { prop, orig });
      }

      const { prop, orig } = this.originalOpacities.get(layerId)!;

      if (categoryId === null || activeLayers.length === 0) {
        // Reset to original
        this.map!.setPaintProperty(layerId, prop, orig);
      } else {
        const isTarget = activeLayers.includes(layerId);
        // If original is an expression, wrap it down to smaller scale
        if (Array.isArray(orig)) {
          this.map!.setPaintProperty(layerId, prop, ['*', orig, isTarget ? 1 : 0.15]);
        } else {
          this.map!.setPaintProperty(layerId, prop, isTarget ? orig : Number(orig) * 0.15);
        }
      }
    });

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

  async updateEnergy(ecowatt: EcowattResponse | Record<string, EcowattSignal>): Promise<void> {
    if (!this.map) return;
    try {
      // Pour éviter les problèmes de typage avec le mock pendant la transition
      const isResponseObj = 'signals' in ecowatt;
      const signals = (isResponseObj ? (ecowatt as EcowattResponse).signals : ecowatt) as Record<string, EcowattSignal>;
      const interconnections = (isResponseObj ? (ecowatt as EcowattResponse).interconnections : []) || [];

      const resp = await fetch('/data/regions.geojson');
      if (!resp.ok) return;
      const geojson = await resp.json() as GeoJSON.FeatureCollection;
      // Inject Ecowatt colors into features
      for (const feat of geojson.features) {
        const code = (feat.properties?.code as string) ?? '';
        const signal = signals[code] ?? 'green';
        feat.properties = {
          ...feat.properties,
          fillColor: ECOWATT_COLORS[signal],
          lineColor: signal === 'green' ? 'rgba(52,199,89,0.3)' :
            signal === 'orange' ? 'rgba(255,149,0,0.5)' :
              'rgba(255,59,48,0.6)',
          signal,
        };
      }
      const src = this.map.getSource(SRC_ENERGY) as maplibregl.GeoJSONSource;
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

  // ─── Weather Layer ───

  async updateWeather(alerts: MeteoAlert[]): Promise<void> {
    if (!this.map) return;
    const alertsByCode = new Map<string, MeteoAlert>();
    for (const a of alerts) alertsByCode.set(a.departmentCode, a);

    try {
      const resp = await fetch('/data/departements.geojson');
      if (!resp.ok) return;
      const geojson = await resp.json() as GeoJSON.FeatureCollection;
      // Only keep departments with alerts
      geojson.features = geojson.features.filter((f) => {
        const code = (f.properties?.code as string) ?? '';
        return alertsByCode.has(code);
      });
      for (let i = 0; i < geojson.features.length; i++) {
        const feat = geojson.features[i];
        const code = (feat.properties?.code as string) ?? '';
        feat.id = deptCodeToId(code); // Strict numeric ID for MapLibre feature-state
        const alert = alertsByCode.get(code);
        const level = alert?.level ?? 'green';
        feat.properties = {
          ...feat.properties,
          fillColor: METEO_COLORS[level] ?? METEO_COLORS.green,
          lineColor: level === 'red' ? 'rgba(255,59,48,0.8)' :
            level === 'orange' ? 'rgba(255,149,0,0.7)' :
              level === 'yellow' ? 'rgba(255,204,0,0.8)' :
                'rgba(52,199,89,0.5)',
          level,
          risks: alert?.risks?.join(', ') ?? '',
        };
      }
      const src = this.map.getSource(SRC_WEATHER) as maplibregl.GeoJSONSource;
      src?.setData(geojson);

      // Update weather icons (risk pictograms at centroids)
      this.updateWeatherIcons(alerts);
    } catch (e) {
      console.warn('[DeckGLMap] Failed to load depts for weather layer', e);
    }
  }

  /**
   * Update weather risk icons at department centroids.
   */
  private updateWeatherIcons(alerts: MeteoAlert[]): void {
    if (!this.map) return;

    const iconFeatures: GeoJSON.Feature<GeoJSON.Point>[] = [];

    for (const alert of alerts) {
      const centroid = WEATHER_DEPT_CENTROIDS[alert.departmentCode];
      if (!centroid) continue;

      // Get primary risk emoji
      const emoji = getWeatherRiskEmoji(alert.risks);

      // Priority for z-ordering (red = highest)
      const priority = alert.level === 'red' ? 4 :
        alert.level === 'orange' ? 3 :
          alert.level === 'yellow' ? 2 : 1;

      iconFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: centroid,
        },
        properties: {
          code: alert.departmentCode,
          department: alert.department,
          level: alert.level,
          emoji,
          priority,
          risks: alert.risks.join(', '),
        },
      });
    }

    const iconsSrc = this.map.getSource(SRC_WEATHER_ICONS) as maplibregl.GeoJSONSource;
    iconsSrc?.setData({
      type: 'FeatureCollection',
      features: iconFeatures,
    });
  }

  highlightWeatherDepartment(departmentCode: string | null): void {
    if (!this.map) return;

    // Reset previous hovered state if any
    if (this._lastHoveredDeptId !== null) {
      this.map.setFeatureState(
        { source: SRC_WEATHER, id: this._lastHoveredDeptId },
        { hover: false }
      );
    }

    if (departmentCode !== null) {
      this.map.setFeatureState(
        { source: SRC_WEATHER, id: departmentCode },
        { hover: true }
      );
      this._lastHoveredDeptId = departmentCode;
    } else {
      this._lastHoveredDeptId = null;
    }
  }
  private _lastHoveredDeptId: string | null = null;

  // ─── Hospitals Layer (FINESS) ───

  updateHospitals(hospitals: GeoJSON.FeatureCollection<GeoJSON.Point>): void {
    if (!this.map) return;
    const src = this.map.getSource(SRC_HOSPITALS) as maplibregl.GeoJSONSource;
    if (!src) return;
    src.setData(hospitals);

    // Event listeners (registered once)
    if (!this._hospitalsEventsRegistered) {
      this._hospitalsEventsRegistered = true;
      this._initHospitalEvents();
    }
  }

  private _hospitalsEventsRegistered = false;
  private _hospitalsPopup: maplibregl.Popup | null = null;

  private _initHospitalEvents(): void {
    if (!this.map) return;

    const showHospitalTooltip = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features?.length || !this.map) return;
      const feat = e.features[0];
      const p = feat.properties as Record<string, unknown>;
      const name = p.name as string ?? 'Établissement';
      const type = p.type as string ?? 'Hôpital';
      const beds = p.beds ? `${p.beds} lits` : 'Capacité inconnue';
      const isEmergency = p.emergency === true || p.emergency === 'true';
      const color = type === 'CHU' ? '#ff3b30' : '#ff9500';

      const isChu = type === 'CHU';
      const icon = isChu ? '🏥' : '🏨';

      this._hospitalsPopup?.remove();
      this._hospitalsPopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: 'health-hospital-popup',
        offset: 12,
        maxWidth: '260px',
      })
        .setLngLat((feat.geometry as GeoJSON.Point).coordinates as [number, number])
        .setHTML(`
          <div style="font-family:'Inter',sans-serif;background:#12121a;border:1px solid ${color}55;border-radius:8px;padding:10px 14px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <span style="font-size:18px;">${icon}</span>
              <span style="font-size:13px;font-weight:700;color:#fff;">${name}</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;font-size:11px;">
              <span style="background:${color}22;border:1px solid ${color}44;color:${color};padding:2px 8px;border-radius:4px;">${type}</span>
              <span style="background:#ffffff10;color:#ccc;padding:2px 8px;border-radius:4px;">${beds}</span>
              ${isEmergency ? '<span style="background:#ff3b3022;border:1px solid #ff3b3055;color:#ff3b30;padding:2px 8px;border-radius:4px;">🚨 Urgences</span>' : ''}
            </div>
          </div>
        `)
        .addTo(this.map);
    };

    const hideHospitalTooltip = () => {
      this._hospitalsPopup?.remove();
      this._hospitalsPopup = null;
    };

    // Hover events for both CHU and CH layers
    for (const lyr of [LYR_HOSPITALS_CHU, LYR_HOSPITALS_CH]) {
      this.map.on('mouseenter', lyr, (e) => {
        if (this.map) this.map.getCanvas().style.cursor = 'pointer';
        showHospitalTooltip(e as any);
      });
      this.map.on('mouseleave', lyr, () => {
        if (this.map) this.map.getCanvas().style.cursor = '';
        hideHospitalTooltip();
      });
    }
  }

  // ─── Health Layer ───

  async updateHealth(regions: HealthRegionMetric[], healthFeatures?: HealthFeatures, departments?: HealthDepartmentMetric[]): Promise<void> {
    if (!this.map) return;
    this.latestHealthFeatures = healthFeatures ?? this.latestHealthFeatures;

    const hasDepts = Array.isArray(departments) && departments.length > 0;
    const hasRegions = regions.length > 0;

    if (!hasDepts && !hasRegions) {
      const src = this.map.getSource(SRC_HEALTH) as maplibregl.GeoJSONSource;
      const markersSrc = this.map.getSource(SRC_HEALTH_MARKERS) as maplibregl.GeoJSONSource;
      src?.setData(emptyFC());
      markersSrc?.setData(emptyFC());
      return;
    }

    try {
      // ─ Prefer departmental granularity ─
      if (hasDepts) {
        const deptMap = new Map<string, HealthDepartmentMetric>();
        for (const d of departments!) deptMap.set(d.depCode, d);

        const resp = await fetch('/data/departements.geojson');
        if (!resp.ok) return;
        const geojson = await resp.json() as GeoJSON.FeatureCollection;

        for (const feature of geojson.features) {
          const code = String(feature.properties?.code ?? '');
          const metric = deptMap.get(code);
          const iss = metric?.iss ?? 0;
          feature.id = deptCodeToId(code);
          feature.properties = {
            ...feature.properties,
            fillColor: issToFillColor(iss),
            lineColor: issToLineColor(iss),
            healthIconColor: issToColor(iss),
            healthStressIndex: iss,
            iss,
            issLevel: metric?.issLevel ?? 1,
            incidenceRate: metric?.incidenceRate ?? 0,
            spfIncidenceRate: metric?.spfIncidence ?? 0,
            sentinellesIncidenceRate: metric?.sentinellesIncidence ?? 0,
            hospitalizations: metric?.hospitalizations ?? 0,
            spfHospitalizations: metric?.spfHospitalizations ?? 0,
            reanimation: metric?.reanimation ?? 0,
            emergencyVisits: metric?.emergencyVisits ?? 0,
            positivityRate: metric?.positivityRate ?? 0,
            hasOscourAlert: metric?.topMotifs && metric.topMotifs.length > 0 ? 1 : 0,
            oscourMaxTrend: metric?.topMotifs && metric.topMotifs.length > 0 ? Math.max(...metric.topMotifs.map(m => m.trendPct || (m as any).trend_pct || 0)) : 0,
            topMotifsJson: JSON.stringify(metric?.topMotifs ?? []),
            aplIndex: metric?.aplIndex ?? null,
            aplCategory: metric?.aplCategory ?? 'indisponible',
            trend: metric?.trend ?? 'stable',
            source: metric?.source ?? 'spf-epid',
            updatedAt: metric?.updatedAt?.toISOString() ?? new Date().toISOString(),
            isDepartmental: 1,
          };
        }

        const src = this.map.getSource(SRC_HEALTH) as maplibregl.GeoJSONSource;
        const markersSrc = this.map.getSource(SRC_HEALTH_MARKERS) as maplibregl.GeoJSONSource;
        src?.setData(geojson);

        // Use SRC_HEALTH_MARKERS for points (ex: OSCOUR circles)
        const markerFeatures = geojson.features.map(f => {
          const center = getFeatureCenter(f);
          if (!center) return null;
          return {
            type: 'Feature',
            properties: { ...f.properties },
            geometry: { type: 'Point', coordinates: center }
          } as GeoJSON.Feature;
        }).filter(f => f !== null) as GeoJSON.Feature[];

        markersSrc?.setData({ type: 'FeatureCollection', features: markerFeatures });
      } else {
        // ─ Fallback: regional ─
        const regionsByCode = new Map<string, HealthRegionMetric>();
        for (const region of regions) regionsByCode.set(region.regionCode, region);

        const resp = await fetch('/data/regions.geojson');
        if (!resp.ok) return;
        const geojson = await resp.json() as GeoJSON.FeatureCollection;

        geojson.features = geojson.features.filter((f) => regionsByCode.has(String(f.properties?.code ?? '')));

        for (const feature of geojson.features) {
          const code = String(feature.properties?.code ?? '');
          const metric = regionsByCode.get(code);
          if (!metric) continue;
          const iss = metric.iss ?? metric.healthStressIndex ?? 0;
          feature.id = Number.parseInt(code, 10);
          feature.properties = {
            ...feature.properties,
            fillColor: issToFillColor(iss),
            lineColor: issToLineColor(iss),
            healthIconColor: issToColor(iss),
            healthStressIndex: iss,
            iss,
            issLevel: metric.issLevel ?? 1,
            incidenceRate: metric.incidenceRate,
            spfIncidenceRate: metric.spfIncidenceRate,
            sentinellesIncidenceRate: metric.sentinellesIncidenceRate,
            hospitalizations: metric.hospitalizations,
            spfHospitalizations: metric.spfHospitalizations,
            reanimation: metric.reanimation ?? 0,
            positivityRate: metric.positivityRate,
            trend: metric.trend,
            source: metric.source,
            updatedAt: metric.updatedAt.toISOString(),
            isDepartmental: 0,
          };
        }

        const src = this.map.getSource(SRC_HEALTH) as maplibregl.GeoJSONSource;
        const markersSrc = this.map.getSource(SRC_HEALTH_MARKERS) as maplibregl.GeoJSONSource;
        const markerFeatures: GeoJSON.Feature[] = geojson.features
          .map((feature) => {
            const center = getFeatureCenter(feature);
            if (!center) return null;
            return { type: 'Feature', properties: { ...feature.properties }, geometry: { type: 'Point', coordinates: center } } as GeoJSON.Feature;
          })
          .filter((f): f is GeoJSON.Feature => f !== null);

        src?.setData(geojson);
        markersSrc?.setData({ type: 'FeatureCollection', features: markerFeatures });
      }

      try {
        this.map.moveLayer(LYR_HEALTH_FILL);
        this.map.moveLayer(LYR_HEALTH_APL_FILL);
        this.map.moveLayer(LYR_HEALTH_APL_LINE);
        this.map.moveLayer(LYR_HEALTH_LINE);
        this.map.moveLayer(LYR_HEALTH_OSCOUR_CIRCLES);
        this.map.moveLayer(LYR_HEALTH_MARKERS);
      } catch {
        // Ignore ordering errors.
      }
    } catch (error) {
      console.warn('[DeckGLMap] Failed to update health layer', error);
    }
  }

  // ─── ISNR Stability Layer ───

  async updateISNR(scores: import('../types/index.ts').ISNRScore[]): Promise<void> {
    if (!this.map) return;
    const scoresByCode = new Map<string, import('../types/index.ts').ISNRScore>();
    for (const s of scores) scoresByCode.set(s.code, s);

    try {
      const resp = await fetch('/data/departements.geojson');
      if (!resp.ok) return;
      const geojson = await resp.json() as GeoJSON.FeatureCollection;

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

  // ─── Train Route Highlight ───

  /**
   * Draw a train route between two stations on the map.
   * Pass null to clear the route.
   */
  highlightTrainRoute(
    departure: [number, number] | null,
    arrival: [number, number] | null
  ): void {
    if (!this.map) return;

    const src = this.map.getSource(SRC_TRAIN_ROUTE) as maplibregl.GeoJSONSource;
    if (!src) return;

    // Clear route if no coordinates
    if (!departure) {
      src.setData(emptyFC());
      return;
    }

    const features: GeoJSON.Feature[] = [];

    // Add departure station point
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: departure },
      properties: { role: 'departure' },
    });

    if (arrival) {
      // Add arrival station point
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: arrival },
        properties: { role: 'arrival' },
      });

      // Add curved line between stations (bezier approximation)
      const lineCoords = this.generateCurvedLine(departure, arrival);
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: lineCoords },
        properties: {},
      });
    }

    src.setData({ type: 'FeatureCollection', features });
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
    const powersByCode = new Map<string, PowerOutage>();
    for (const p of powers) powersByCode.set(p.departmentCode, p);

    try {
      const resp = await fetch('/data/departements.geojson');
      if (!resp.ok) return;
      const geojson = await resp.json() as GeoJSON.FeatureCollection;

      // Filter to departments with actual measured outages only (map layer)
      // Departments with only Ecowatt risk signal (offGridCount=0) are shown in the panel but NOT on the map
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

      // Tension departments (Ecowatt signal, 0 PDL) — outline only, no fill
      const tensionGeojson = await fetch('/data/departements.geojson').then(r => r.json()) as GeoJSON.FeatureCollection;
      tensionGeojson.features = tensionGeojson.features
        .filter(f => {
          const code = (f.properties?.code as string) ?? '';
          const pout = powersByCode.get(code);
          return !!pout && pout.offGridCount === 0;
        })
        .map(f => {
          const code = (f.properties?.code as string) ?? '';
          const pout = powersByCode.get(code)!;
          const tensionColor = pout.eventCause.includes('rouge') ? '#EF4444' : '#F97316';
          return { ...f, properties: { ...f.properties, tensionColor } };
        });
      (this.map.getSource(SRC_POWER_TENSION) as maplibregl.GeoJSONSource)?.setData(tensionGeojson);
    } catch (e) {
      console.warn('[DeckGLMap] Error mapping power outages', e);
    }
  }

  /** Render citizen outage zones (crowd-sourced DBSCAN clusters) on the map. */
  updateCitizenOutageZones(zones: GeoJSON.FeatureCollection): void {
    (this.map?.getSource(SRC_CITIZEN_ZONES) as maplibregl.GeoJSONSource)?.setData(zones);
  }

  /** Met à jour le polygone jour/nuit sur la carte. */
  updateTerminator(geojson: GeoJSON.FeatureCollection): void {
    (this.map?.getSource(SRC_TERMINATOR) as maplibregl.GeoJSONSource)?.setData(geojson);
  }

  /** Met à jour les options du layer Deck.gl Jour/Nuit (showNight, showTwilight, showSunIcon, timestamp). */
  updateDayNightOptions(opts: Partial<typeof this.dayNightOptions>): void {
    Object.assign(this.dayNightOptions, opts);
    this.refreshAisLayers();
  }

  /** Highlight a specific department on the power outages layer (actual + tension). */
  highlightPowerDept(deptCode: string | null): void {
    if (!this.map) return;
    if (deptCode) {
      // Actual outages layer
      this.map.setPaintProperty(LYR_POWER_FILL, 'fill-color', [
        'case', ['==', ['get', 'code'], deptCode], 'rgba(255,255,255,0.35)', ['get', 'fillColor'],
      ]);
      this.map.setPaintProperty(LYR_POWER_LINE, 'line-color', [
        'case', ['==', ['get', 'code'], deptCode], '#FFFFFF', ['get', 'lineColor'],
      ]);
      // Tension layer
      this.map.setPaintProperty(LYR_POWER_TENSION_FILL, 'fill-opacity', [
        'case', ['==', ['get', 'code'], deptCode], 0.25, 0.08,
      ]);
      this.map.setPaintProperty(LYR_POWER_TENSION_LINE, 'line-color', [
        'case', ['==', ['get', 'code'], deptCode], '#FFFFFF', ['get', 'tensionColor'],
      ]);
      this.map.setPaintProperty(LYR_POWER_TENSION_LINE, 'line-width', [
        'case', ['==', ['get', 'code'], deptCode], 2.5, 1.5,
      ]);
    } else {
      this.map.setPaintProperty(LYR_POWER_FILL, 'fill-color', ['get', 'fillColor']);
      this.map.setPaintProperty(LYR_POWER_LINE, 'line-color', ['get', 'lineColor']);
      this.map.setPaintProperty(LYR_POWER_TENSION_FILL, 'fill-opacity', 0.08);
      this.map.setPaintProperty(LYR_POWER_TENSION_LINE, 'line-color', ['get', 'tensionColor']);
      this.map.setPaintProperty(LYR_POWER_TENSION_LINE, 'line-width', 1.5);
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
      this.map.flyTo({ center: data.coordinates, zoom: Math.max(this.map.getZoom(), 7), duration: 800, essential: true });
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
      this.map.flyTo({ center: data.coordinates, zoom: Math.max(this.map.getZoom(), 6), duration: 800, essential: true });
    } else {
      this.map.setPaintProperty(LYR_NET_IODA_CORE, 'circle-stroke-color', '#0a0a0f');
      this.map.setPaintProperty(LYR_NET_IODA_CORE, 'circle-stroke-width', 1.5);
      this.map.setPaintProperty(LYR_NET_IODA_GLOW, 'circle-opacity', 1);
    }
  }

  /** Highlight a specific datacenter triangle and fly to it. */
  highlightDc(data: { id: string; coordinates: [number, number] } | null): void {
    if (!this.map) return;
    const defaultColor = [
      'match', ['get', 'status'],
      'operational', '#A78BFA', 'degraded', '#F59E0B', 'partial', '#F97316',
      'outage', '#EF4444', 'maintenance', '#8B5CF6', 'unknown', '#A78BFA', '#A78BFA',
    ] as maplibregl.ExpressionSpecification;
    if (data) {
      this.map.setPaintProperty(LYR_DC_CORE, 'icon-color', [
        'case', ['==', ['get', 'id'], data.id], '#FFFFFF', defaultColor,
      ]);
      this.map.setPaintProperty(LYR_DC_CORE, 'icon-opacity', [
        'case', ['==', ['get', 'id'], data.id], 1, 0.6,
      ]);
      this.map.flyTo({ center: data.coordinates, zoom: Math.max(this.map.getZoom(), 7), duration: 800, essential: true });
    } else {
      this.map.setPaintProperty(LYR_DC_CORE, 'icon-color', defaultColor);
      this.map.setPaintProperty(LYR_DC_CORE, 'icon-opacity', 0.95);
    }
  }

  /** Highlight a specific IXP diamond and fly to it. */
  highlightIxp(data: { id: string; coordinates: [number, number] } | null): void {
    if (!this.map) return;
    const defaultColor = [
      'match', ['get', 'status'],
      'outage', '#EF4444', 'degraded', '#F59E0B', '#C4B5FD',
    ] as maplibregl.ExpressionSpecification;
    if (data) {
      this.map.setPaintProperty(LYR_IXP_CIRCLE, 'icon-color', [
        'case', ['==', ['get', 'id'], data.id], '#FFFFFF', defaultColor,
      ]);
      this.map.setPaintProperty(LYR_IXP_CIRCLE, 'icon-opacity', [
        'case', ['==', ['get', 'id'], data.id], 1, 0.55,
      ]);
      this.map.flyTo({ center: data.coordinates, zoom: Math.max(this.map.getZoom(), 7), duration: 800, essential: true });
    } else {
      this.map.setPaintProperty(LYR_IXP_CIRCLE, 'icon-color', defaultColor);
      this.map.setPaintProperty(LYR_IXP_CIRCLE, 'icon-opacity', 0.90);
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
        asn: isp.asn,
        ispName: isp.ispName,
        prefixCount: isp.prefixCount,
        prefixCountNormal: isp.prefixCountNormal,
        visibility: isp.visibility,
        status: isp.status,
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
        status: dc.status,
        incidents: JSON.stringify(dc.incidents),
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

  /**
   * Generate a curved line between two points (arc-like effect).
   */
  private generateCurvedLine(
    start: [number, number],
    end: [number, number],
    numPoints: number = 50
  ): [number, number][] {
    const coords: [number, number][] = [];
    const [x1, y1] = start;
    const [x2, y2] = end;

    // Calculate distance for curve height
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Perpendicular offset for curve (proportional to distance)
    const curveHeight = dist * 0.15;

    // Midpoint
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;

    // Perpendicular direction (rotated 90 degrees)
    const px = -dy / dist;
    const py = dx / dist;

    // Control point for quadratic bezier
    const cx = mx + px * curveHeight;
    const cy = my + py * curveHeight;

    // Generate points along quadratic bezier curve
    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      const u = 1 - t;

      // Quadratic bezier: B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
      const x = u * u * x1 + 2 * u * t * cx + t * t * x2;
      const y = u * u * y1 + 2 * u * t * cy + t * t * y2;
      coords.push([x, y]);
    }

    return coords;
  }

  // ─── Topage visual Layer ───

  /**
   * Met à jour le réseau hydro décoratif (fond bleu clair).
   * Appelé depuis App.ts après un fetch /api/environment/topage-hydro?bbox=vue courante.
   * Les features passent directement : pas de matching, juste l'affichage brut.
   */
  updateTopageVisual(geojson: GeoJSON.FeatureCollection): void {
    if (!this.map) return;
    const src = this.map.getSource(SRC_TOPAGE_VIS) as maplibregl.GeoJSONSource;
    src?.setData(geojson);
  }

  // ─── Floods Layer ───

  updateFloods(segments: FloodSegment[]): void {
    if (!this.map) return;
    this.floodSegmentsById = new Map(segments.map((segment) => [segment.id, segment]));
    this.highlightFloodSegment(null);
    // Tous les segments vont dans la source ; les layers filtrent par geometryFidelity :
    // LYR_FLOODS      → matched + fallback (lignes pleines, couleur vigilance)
    // LYR_FLOODS_RAW  → raw (pointillés, opacité réduite — Topage indisponible)
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: segments.map((s) => ({
        type: 'Feature' as const,
        id: s.id,
        geometry: s.displayGeometry,
        properties: {
          name: s.name,
          color: FLOOD_COLORS[s.level] ?? FLOOD_COLORS.green,
          level: s.level,
          dataSource: s.dataSource,
          geometryFidelity: s.geometryFidelity,
          matchConfidence: s.matchConfidence,
          rawVertexCount: s.rawVertexCount,
          displayVertexCount: s.displayVertexCount,
        },
      })),
    };
    const src = this.map.getSource(SRC_FLOODS) as maplibregl.GeoJSONSource;
    src?.setData(fc);
    const highlightSrc = this.map.getSource(SRC_FLOODS_HIGHLIGHT) as maplibregl.GeoJSONSource;
    highlightSrc?.setData(emptyFC());

    const matchedCount = segments.filter((s) => s.geometryFidelity === 'matched').length;
    const corridorCount = segments.filter((s) => s.geometryFidelity === 'fallback').length;
    const rawCount = segments.filter((s) => s.geometryFidelity === 'raw').length;
    const hydrated = segments.filter((s) => s.geometryFidelity !== 'raw');
    const avgConf = hydrated.length > 0
      ? (hydrated.reduce((sum, s) => sum + s.matchConfidence, 0) / hydrated.length).toFixed(2)
      : 'n/a';
    console.info(
      `[DeckGLMap/Vigicrues] total:${segments.length} — ` +
      `matched:${matchedCount} fallback:${corridorCount} raw(pointillés):${rawCount} | confiance moy:${avgConf}`,
    );
  }

  highlightFloodSegment(segmentId: string | null): void {
    if (!this.map) return;
    const highlightSrc = this.map.getSource(SRC_FLOODS_HIGHLIGHT) as maplibregl.GeoJSONSource | undefined;

    if (this._highlightedFloodSegmentId !== null) {
      this.map.setFeatureState(
        { source: SRC_FLOODS, id: this._highlightedFloodSegmentId },
        { hover: false },
      );
    }

    if (segmentId !== null) {
      this.map.setFeatureState(
        { source: SRC_FLOODS, id: segmentId },
        { hover: true },
      );
      const segment = this.floodSegmentsById.get(segmentId);
      if (segment && highlightSrc) {
        highlightSrc.setData({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: segment.displayGeometry,
            properties: { id: segment.id },
          }],
        });
        this.setVis(LYR_FLOODS_HIGHLIGHT, 'visible');
      }
      this._highlightedFloodSegmentId = segmentId;
    } else {
      highlightSrc?.setData(emptyFC());
      this.setVis(LYR_FLOODS_HIGHLIGHT, 'none');
      this._highlightedFloodSegmentId = null;
    }
  }

  private _highlightedFloodSegmentId: string | null = null;

  // ─── Fires Layer ───

  updateFires(fires: ActiveFire[]): void {
    if (!this.map) return;
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: fires.map((f) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point', coordinates: [f.longitude, f.latitude] },
        properties: {
          frp: f.frp,
          confidence: f.confidence,
          acq_time: f.acq_time,
          acq_date: f.acq_date,
          daynight: f.daynight,
          lat: f.latitude,
          lon: f.longitude,
          bright_ti4: f.bright_ti4,
        }
      }))
    };
    const src = this.map.getSource(SRC_FIRES) as maplibregl.GeoJSONSource;
    src?.setData(fc);
  }

  highlightFire(lat: number, lon: number): void {
    if (!this.map) return;
    const src = this.map.getSource(SRC_FIRES_HIGHLIGHT) as maplibregl.GeoJSONSource;
    src?.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {} }]
    });
  }

  clearFireHighlight(): void {
    if (!this.map) return;
    const src = this.map.getSource(SRC_FIRES_HIGHLIGHT) as maplibregl.GeoJSONSource;
    src?.setData({ type: 'FeatureCollection', features: [] });
  }

  /**
   * Met en surbrillance TOUS les points d'un cluster d'incident (DBSCAN).
   * Utilisé quand on survole une carte incident dans FiresPanel.
   * Si points est vide, efface le highlight (comme clearFireHighlight).
   */
  highlightFireCluster(points: { lat: number; lon: number }[]): void {
    if (!this.map) return;
    const src = this.map.getSource(SRC_FIRES_HIGHLIGHT) as maplibregl.GeoJSONSource;
    src?.setData({
      type: 'FeatureCollection',
      features: points.map(p => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
        properties: {},
      })),
    });
  }

  setModisOverlayVisible(enabled: boolean): void {
    this._modisOverlayEnabled = enabled;
    this.setVis(LYR_MODIS, enabled ? 'visible' : 'none');
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

  private _buildGibsDate(): string {
    const d = new Date();
    d.setDate(d.getDate() - 2); // J-2 : latence de traitement VIIRS ~24-48h
    return d.toISOString().slice(0, 10);
  }

  // ─── Infrastructure Layer ───

  updateInfrastructure(points: (InfrastructurePoint | any)[]): void {
    if (!this.map) return;
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: points.filter((p) => p.status !== 'shutdown').map((p) => {
        let color = INFRA_COLORS[p.type] ?? '#8e8e93';
        const isElectricGeneration = p.type === 'nuclear' || p.type === 'thermal' || p.type === 'hydro';
        const baseRadius =
          p.type === 'nuclear' ? 8
            : p.type === 'thermal' || p.type === 'hydro' || p.type === 'refinery' ? 7
              : p.type === 'gas-terminal' ? 6.8
                : p.type === 'gas-storage' || p.type === 'oil-depot' ? 6.2
                  : 5.8;

        if (p.type === 'nuclear' && p.status === 'maintenance') color = '#B7D6E7';

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

  // ─── Métropoles Layer ───

  updateMetropoles(data: MetropoleConsumption[], nationalLoadMW?: number): void {
    if (!this.map) return;
    if (data.length === 0) return;

    const classified = classifyMetropoles(data, nationalLoadMW);

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

    const src = this.map.getSource(SRC_METROPOLES) as maplibregl.GeoJSONSource;
    src?.setData(fc);
  }

  // ─── Traffic Layer & Incidents ───

  updateTraffic(_trafficData?: Array<{ start: [number, number], end: [number, number], level: string }>): void {
    // Traffic tiles are loaded automatically by MapLibre from TomTom source
    if (!this.map) return;
    if (!import.meta.env.VITE_TOMTOM_API_KEY) {
      console.warn('[DeckGLMap] TomTom API Key missing. Traffic layers will be empty.');
    }
  }

  updateTrafficIncidents(incidents: any[]): void {
    if (!this.map) return;
    this.roadTrafficIncidents = incidents;
    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: incidents.map(i => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [i.lon, i.lat] },
        properties: { ...i }
      }))
    };
    const src = this.map.getSource(SRC_TRAFFIC_INCIDENTS) as maplibregl.GeoJSONSource;
    src?.setData(geojson);
    this.refreshAisLayers();
  }

  // ─── Military Layers ───

  updateMilitaryZones(zones: RestrictedZone[]): void {
    if (!this.map) return;
    const src = this.map.getSource(SRC_MILITARY_ZONES) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: zones.filter(z => z.active).map((z) => ({
        type: 'Feature' as const,
        geometry: z.geometry,
        properties: { name: z.name, type: z.type },
      })),
    });
  }

  updateMilitaryBases(bases: MilitaryBase[]): void {
    if (!this.map) return;
    // Populate lookup table
    this.militaryBasesById.clear();
    for (const b of bases) this.militaryBasesById.set(b.id, b);

    const src = this.map.getSource(SRC_MILITARY_BASES) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: bases.map((b) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point', coordinates: b.coordinates },
        properties: {
          id: b.id,
          name: b.name,
          type: b.type,
          description: b.description || '',
        },
      })),
    });
  }

  updateMilitaryFlights(flights: MilitaryFlight[]): void {
    if (!this.map) return;
    // Populate lookup table
    this.militaryFlightsById.clear();
    for (const f of flights) this.militaryFlightsById.set(f.id, f);

    this._renderMilitaryFlightsGeoJSON(flights);

    // Update flight trails layer (only on real API fetch, not on interpolation ticks)
    this.updateMilitaryFlightTrails(flights);

    this._startFlightInterpolation();
  }

  private _renderMilitaryFlightsGeoJSON(flights: MilitaryFlight[]): void {
    if (!this.map) return;
    const src = this.map.getSource(SRC_MILITARY_FLIGHTS) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: flights.map((f) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point', coordinates: [f.longitude, f.latitude] },
        properties: {
          id: f.id,
          callsign: f.callsign,
          country: f.country,
          altitude: f.altitude,
          velocity: f.velocity,
          speed: f.speed,
          heading: f.heading,
          hexCode: f.hexCode || f.id,
          aircraftType: f.aircraftType || 'unknown',
          aircraftModel: f.aircraftModel || '',
          operator: f.operator || 'unknown',
          operatorLabel: f.operatorLabel || '',
          confidence: f.confidence || 'low',
          squawk: f.squawk || '',
          squawkSeverity: f.squawkAlert?.severity || '',
          squawkDescription: f.squawkAlert?.description || '',
          isAllied: f.isAllied || false,
          branch: f.branch || '',
        },
      })),
    });
  }

  private _startFlightInterpolation(): void {
    if (this._flightInterpolTick) return; // already running
    this._flightInterpolTick = setInterval(() => {
      if (!this.map || this.militaryFlightsById.size === 0) return;
      const now = Date.now() / 1000;
      const interpolated = Array.from(this.militaryFlightsById.values()).map(f => {
        const pos = interpolateFlightPosition(f, now);
        return { ...f, latitude: pos.latitude, longitude: pos.longitude };
      });
      this._renderMilitaryFlightsGeoJSON(interpolated);
    }, 1_000);
  }

  updateAirTraffic(flights: AirTrafficFlight[]): void {
    if (!this.map) return;

    // Update lookup map for tooltip/click handlers
    this.airTrafficFlightsById.clear();
    for (const flight of flights) this.airTrafficFlightsById.set(flight.id, flight);

    // OSINT: Filter out military flights for the civil traffic layer
    // Military flights are displayed via the DÉFENSE layer (military-flights.ts → /v2/mil)
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

    // Start tween animation (only if we had data before — no tween on first load)
    if (hadPreviousData) {
      this.startCivilAirTween();
    }

    this.refreshCivilAirTrafficSource();
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
        // Final: update MapLibre GeoJSON source (labels) with settled positions
        this.refreshCivilAirTrafficSource();
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

  private updateMilitaryFlightTrails(flights: MilitaryFlight[]): void {
    if (!this.map) return;
    const src = this.map.getSource(SRC_MILITARY_FLIGHT_TRAILS) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    // Only include flights with trails of 2+ points
    const trailFeatures = flights
      .filter(f => f.trail && f.trail.length >= 2)
      .map(f => ({
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: f.trail!,
        },
        properties: {
          id: f.id,
          aircraftType: f.aircraftType || 'unknown',
          operator: f.operator || 'unknown',
        },
      }));

    src.setData({
      type: 'FeatureCollection',
      features: trailFeatures,
    });
  }

  setOnMilitaryFlightClick(handler: (flight: MilitaryFlight, x: number, y: number) => void): void {
    this.onMilitaryFlightClick = handler;
  }

  setOnMilitaryBaseClick(handler: (base: MilitaryBase, x: number, y: number) => void): void {
    this.onMilitaryBaseClick = handler;
  }

  setOnMilitaryShipClick(handler: (ship: { id: string; name: string; type: string; role: string; mmsi?: string; lat: number; lon: number; speed?: number; heading?: number; port?: string; isLive?: boolean }, x: number, y: number) => void): void {
    this.onMilitaryShipClick = handler;
  }

  setOnMaritimeShipClick(cb: (ship: MilitaryShip, x: number, y: number) => void): void {
    this._onMaritimeShipClick = cb;
  }

  setHighlightedShip(mmsi: string | null): void {
    this._highlightedMmsi = mmsi;
    this.updateMilitaryShipMarkerSource(SRC_MILITARY_SHIPS_HIGHLIGHT, mmsi);
    this.syncHighlightedShipTooltip(mmsi);
    this.refreshAisLayers();
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
    const ship = Array.from(this.militaryShipsById.values()).find((s) => s.mmsi === mmsi)
      ?? this.globalTrafficData.find((s) => s.mmsi === mmsi)
      ?? getAllLiveTraffic().find((s) => s.mmsi === mmsi);
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

  updateMilitaryShips(ships: Array<{ id: string; name: string; type: string; role: string; mmsi?: string; lat: number; lon: number; speed?: number; heading?: number; port?: string; isLive?: boolean }>): void {
    if (!this.map) return;
    const src = this.map.getSource(SRC_MILITARY_SHIPS) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    // Update lookup table
    this.militaryShipsById.clear();
    for (const s of ships) this.militaryShipsById.set(s.id, s);
    src.setData({
      type: 'FeatureCollection',
      features: ships.map(s => ({
        type: 'Feature' as const,
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: {
          id: s.id,
          name: s.name,
          type: s.type,
          role: s.role ?? '',
          speed: s.speed ?? 0,
          heading: s.heading ?? 0,
          mmsi: s.mmsi ?? '',
          port: s.port ?? '',
          isLive: s.isLive ?? false,
        },
      })),
    });
    this.updateMilitaryShipMarkerSource(SRC_MILITARY_SHIPS_HIGHLIGHT, this._highlightedMmsi);
    this.updateMilitaryShipMarkerSource(SRC_MILITARY_SHIPS_SELECTED, this._selectedShipMmsi);
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

  /**
   * Returns human-readable ship type label from AIS type code.
   */
  private getShipTypeLabel(shipType: number): string {
    if (shipType >= 70 && shipType <= 79) return 'Cargo';
    if (shipType >= 80 && shipType <= 89) return 'Pétrolier';
    if (shipType >= 60 && shipType <= 69) return 'Passagers';
    if (shipType === 30) return 'Pêche';
    if (shipType === 35) return 'Militaire';
    if (shipType >= 31 && shipType <= 32) return 'Remorqueur';
    if (shipType >= 50 && shipType <= 59) return 'Plaisance';
    if (shipType >= 40 && shipType <= 49) return 'Haute vitesse';
    if (shipType === 52) return 'Remorqueur';
    if (shipType === 53) return 'Drague';
    return shipType > 0 ? `Type ${shipType}` : 'Inconnu';
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

  private clearSubseaCableHoverState(): void {
    if (!this.map) return;
    if (this.hoveredSubseaCableId != null) {
      this.map.setFeatureState({ source: SRC_SUBMARINE_CABLES, id: this.hoveredSubseaCableId }, { hover: false });
      this.hoveredSubseaCableId = null;
    }
    if (this.hoveredSubseaLandingId != null) {
      this.map.setFeatureState({ source: SRC_SUBMARINE_CABLES_LANDINGS, id: this.hoveredSubseaLandingId }, { hover: false });
      this.hoveredSubseaLandingId = null;
    }
  }

  private hideSubseaCableTooltip(): void {
    this.clearSubseaCableHoverState();
    this.militaryTooltip?.remove();
    this.militaryTooltip = null;
  }

  // ─── Layer Visibility Toggle ───

  setLayerVisibility(layers: MapLayers): void {
    if (!this.map) return;

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
    this.setVis(LYR_ENERGY_FILL, vis(layers.energy));
    this.setVis(LYR_ENERGY_LINE, vis(layers.energy));
    this.setVis(LYR_INTERCONN_ARC, vis(layers.energy));
    this.setVis(LYR_INTERCONN_ARC_GLOW, vis(layers.energy));
    this.setVis(LYR_INTERCONN_HITAREA, vis(layers.energy));
    this.setVis(LYR_INTERCONN_CHEVRONS, vis(layers.energy));
    this.setVis(LYR_INTERCONN_LINE, vis(layers.energy));
    this.setVis(LYR_INTERCONN_LABEL, vis(layers.energy));
    this.setVis(LYR_WEATHER_FILL, vis(layers.environmental));
    this.setVis(LYR_WEATHER_LINE, vis(layers.environmental));
    this.setVis(LYR_WEATHER_ICONS, vis(layers.environmental));
    // Core health uses ISS fill, shown when health is enabled
    this.setVis(LYR_HEALTH_FILL, vis(layers.health ?? false));
    this.setVis(LYR_HEALTH_APL_FILL, vis(layers.healthApl ?? false));
    this.setVis(LYR_HEALTH_APL_LINE, vis(layers.healthApl ?? false));
    this.setVis(LYR_HEALTH_LINE, vis(layers.health ?? false));
    this.setVis(LYR_HEALTH_OSCOUR_CIRCLES, vis(layers.healthOscour ?? false));
    this.setVis(LYR_HEALTH_MARKERS, vis(layers.health ?? false));
    this.setVis(LYR_HOSPITALS_CHU, vis(layers.hospitals ?? false));
    this.setVis(LYR_HOSPITALS_CH, vis(layers.hospitals ?? false));
    this.setVis(LYR_HOSPITALS_LABEL, vis(layers.hospitals ?? false));
    this.setVis(LYR_TOPAGE_VIS, vis(layers.environmental));
    this.setVis(LYR_FLOODS_RAW, vis(layers.environmental));
    this.setVis(LYR_FLOODS, vis(layers.environmental));
    this.setVis(LYR_FLOODS_HIGHLIGHT, vis(layers.environmental && this._highlightedFloodSegmentId !== null));
    this.setVis(LYR_MODIS, vis((layers.fires ?? false) && this._modisOverlayEnabled));
    this.setVis(LYR_FIRES_GLOW, vis(layers.fires ?? false));
    this.setVis(LYR_FIRES_POINTS, vis(layers.fires ?? false));
    this.setVis(LYR_FIRES_HIGHLIGHT, vis(layers.fires ?? false));
    this.setVis(LYR_ISNR_FILL, vis(layers.stability ?? false));
    this.setVis(LYR_ISNR_LINE, vis(layers.stability ?? false));
    this.setVis(LYR_INFRA_VITAL_HALO, vis(layers.infrastructure));
    this.setVis(LYR_INFRA_NUCLEAR_RING, vis(layers.infrastructure));
    this.setVis(LYR_INFRA_CIRCLE, vis(layers.infrastructure));
    this.setVis(LYR_INFRA_LABEL, vis(layers.infrastructure));
    // Gas layer: réseau + organes vitaux
    const gasVis = vis(layers.gas ?? false);
    this.setVis(LYR_GAS_NETWORK_GRT, gasVis);
    this.setVis(LYR_GAS_NETWORK_TEREGA, gasVis);
    this.setVis(LYR_GAS_TERMINALS, gasVis);
    this.setVis(LYR_GAS_STORAGES_GLOW, gasVis);
    this.setVis(LYR_GAS_STORAGES, gasVis);
    this.setVis(LYR_GAS_STORAGES_LABEL, gasVis);
    this.setVis(LYR_GAS_PIR_ARC_GLOW, gasVis);
    this.setVis(LYR_GAS_PIR_ARC, gasVis);
    this.setVis(LYR_GAS_PIR_CHEVRONS, gasVis);
    this.setVis(LYR_GAS_PIR_MARKER, gasVis);
    this.setVis(LYR_GAS_PIR_LABEL, gasVis);
    // Oil layer (refineries, depots, pipelines, flows)
    const oilVis = vis(layers.oil ?? false);
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
    this.setVis(LYR_TRAFFIC, vis(layers.trafficRoad));
    this.setVis(LYR_TRAFFIC_INCIDENTS, 'none');
    this.setVis(LYR_METROPOLES_GLOW, vis(layers.metropoles));
    this.setVis(LYR_METROPOLES_CIRCLE, vis(layers.metropoles));
    this.setVis(LYR_METROPOLES_LABEL, vis(layers.metropoles));

    // Military layers
    this.setVis(LYR_MILITARY_ZONES_FILL, vis(layers.military));
    this.setVis(LYR_MILITARY_ZONES_LINE, vis(layers.military));
    this.setVis(LYR_MILITARY_BASES_CIRCLE, vis(layers.military));
    this.setVis(LYR_MILITARY_BASES_LABEL, vis(layers.military));
    this.setVis(LYR_MILITARY_FLIGHT_TRAILS, vis(layers.military));
    this.setVis(LYR_MILITARY_FLIGHTS, vis(layers.military));
    this.setVis(LYR_MILITARY_FLIGHTS_LABEL, vis(layers.military));
    this.setVis(LYR_AIR_TRAFFIC_LABEL, vis(layers.trafficAir));
    this.setVis(LYR_MILITARY_SHIPS, vis(layers.military));
    this.setVis(`${LYR_MILITARY_SHIPS}-label`, vis(layers.military));
    this.setVis(LYR_MILITARY_SHIPS_HIGHLIGHT, vis(layers.trafficMaritime || layers.military));
    this.setVis(LYR_MILITARY_SHIPS_SELECTED, vis(layers.trafficMaritime || layers.military));
    // AIS traffic layer (Deck.gl IconLayer)
    this.globalTrafficVisible = layers.trafficMaritime;
    this.roadTrafficVisible = layers.trafficRoad;
    this.airTrafficVisible = layers.trafficAir;
    this.dayNightVisible = layers.dayNight ?? false;
    this.refreshAisLayers();
    // Submarine cables
    this.setVis(LYR_SUBMARINE_CABLES, vis(layers.subseaCables));
    this.setVis(LYR_SUBMARINE_CABLES_GLOW, vis(layers.subseaCables));
    this.setVis(LYR_SUBMARINE_CABLES_CORE, vis(layers.subseaCables));
    this.setVis(LYR_SUBMARINE_CABLES_HITAREA, vis(layers.subseaCables));
    this.setVis(LYR_SUBMARINE_CABLES_LANDING, vis(layers.subseaCables));
    this.setVis(LYR_POWER_FILL, vis(layers.outagesElec));
    this.setVis(LYR_POWER_LINE, vis(layers.outagesElec));
    this.setVis(LYR_POWER_TENSION_FILL, vis(layers.outagesElec));
    this.setVis(LYR_POWER_TENSION_LINE, vis(layers.outagesElec));
    this.setVis(LYR_CITIZEN_FILL, vis(layers.outagesElec));
    this.setVis(LYR_CITIZEN_LINE, vis(layers.outagesElec));
    this.setVis(LYR_TELECOM_PTS, vis(layers.outagesTelecom));
    this.setVis(LYR_NET_IODA_GLOW, vis(layers.outagesInternet));
    this.setVis(LYR_NET_IODA_CORE, vis(layers.outagesInternet));
    this.setVis(LYR_NET_ISP_GLOW, vis(layers.outagesInternet));
    this.setVis(LYR_NET_ISP_RING, vis(layers.outagesInternet));
    this.setVis(LYR_NET_ISP, vis(layers.outagesInternet));
    this.setVis(LYR_DC_GLOW, vis(layers.outagesCloud));
    this.setVis(LYR_DC_CORE, vis(layers.outagesCloud));
    this.setVis(LYR_IXP_CIRCLE, vis(layers.outagesCloud));
    // LYR_TERMINATOR masqué : le Deck.gl DayNightLayer gère toute la visualisation jour/nuit
    this.setVis(LYR_TERMINATOR, 'none');
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
    const src = this.map.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData({
        type: 'FeatureCollection',
        features: otherItems.map(toFeature),
      });
    }

    // Update critical source (never clustered)
    const criticalSrc = this.map.getSource(SRC_CRITICAL) as maplibregl.GeoJSONSource | undefined;
    if (criticalSrc) {
      criticalSrc.setData({
        type: 'FeatureCollection',
        features: criticalItems.map(toFeature),
      });
    }
  }

  destroy(): void {
    // Cleanup timeouts
    if (this.clusterHideTimeout) {
      clearTimeout(this.clusterHideTimeout);
      this.clusterHideTimeout = null;
    }

    // Cleanup pulse overlay
    this.pulseOverlay?.remove();
    this.pulseOverlay = null;
    this.pulseMarkers.clear();

    // Cleanup energy/gas tooltips
    this.energyRegionPopup?.remove();
    this.energyFlowPopup?.remove();
    this.gasFlowPopup?.remove();

    // Cleanup interconnection animation
    this.stopInterconnAnimation();
    this.stopGasPirAnimation();
    this.stopOilFlowAnimation();
    this.stopSubseaPulseAnimation();

    // Cleanup civil air traffic tween animation
    this.stopCivilAirTween();

    // Cleanup flight interpolation interval
    if (this._flightInterpolTick) { clearInterval(this._flightInterpolTick); this._flightInterpolTick = null; }
    this.stopSentinelSceneBlink();

    this.map?.remove();
    this.map = null;
  }
}
