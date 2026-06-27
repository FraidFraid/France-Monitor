// Extracted from DeckGLMap.ts — source/layer IDs, color tables and static dictionaries.
import maplibregl from 'maplibre-gl';
import type { EcowattSignal, MapViewState } from '../../types/index.ts';

// ─── Source & Layer IDs ───
export const SRC = 'news-src';              // Clusterable news (excludes critical)
export const SRC_CRITICAL = 'news-critical-src';  // Critical alerts (never clustered)
export const SRC_SEL = 'news-sel-src';
export const SRC_POWER_REGIONS = 'power-regions-src';
export const SRC_INTERCONN = 'interconn-src';
export const SRC_WEATHER = 'weather-depts-src';
export const SRC_HEALTH = 'health-regions-src';
export const SRC_HEALTH_MARKERS = 'health-markers-src';
export const SRC_FLOODS = 'flood-segments-src';
export const SRC_FLOODS_HIGHLIGHT = 'flood-segments-highlight-src';
export const SRC_TOPAGE_VIS = 'topage-visual-src';     // réseau hydro décoratif (fond)
export const SRC_FIRES = 'fires-points-src';
export const SRC_INFRA = 'infra-src';
export const SRC_INFRA_HIGHLIGHT = 'infra-highlight-src';
export const SRC_DROM_ENERGY = 'drom-energy-src';
export const SRC_DROM_ENERGY_HTA_LINES = 'drom-energy-hta-lines-src';
export const SRC_DROM_ENERGY_HIGHLIGHT = 'drom-energy-highlight-src';
export const SRC_HYDRO_BACKBONE = 'hydro-backbone-src';
export const SRC_WIND_TURBINES = 'wind-turbines-src';
export const SRC_WIND_PARKS = 'wind-parks-src';
export const SRC_TRAFFIC = 'traffic-flow-src';
export const SRC_TRAFFIC_INCIDENTS = 'traffic-incidents-src';
export const SRC_TRAIN_ROUTE = 'train-route-src';

export const LYR_GLOW = 'news-glow';
export const LYR_POINTS = 'news-pts';
export const LYR_CLUSTER_CIRCLE = 'news-cluster-circle';
export const LYR_CLUSTER_COUNT = 'news-cluster-count';
export const LYR_SEL_GLOW = 'news-sel-glow';
export const LYR_SEL_RING = 'news-sel-ring';
export const LYR_POWER_REGION_FILL = 'power-region-fill';
export const LYR_POWER_REGION_LINE = 'power-region-line';
export const LYR_INTERCONN_LINE = 'interconn-line';
export const LYR_INTERCONN_LABEL = 'interconn-label';
export const SRC_INTERCONN_ARCS = 'interconn-arcs-src';
export const SRC_INTERCONN_CHEVRON_PTS = 'interconn-chevron-pts-src';  // Animated chevron points
export const LYR_INTERCONN_ARC = 'interconn-arc';
export const LYR_INTERCONN_ARC_GLOW = 'interconn-arc-glow';
export const LYR_INTERCONN_HITAREA = 'interconn-arc-hitarea';
export const LYR_INTERCONN_CHEVRONS = 'interconn-chevrons';  // Animated chevrons for flow direction
export const LYR_WEATHER_FILL = 'weather-fill';
export const LYR_WEATHER_LINE = 'weather-line';
export const LYR_WEATHER_LINE_YELLOW = 'weather-line-yellow';
export const LYR_WEATHER_LINE_ORANGE = 'weather-line-orange';
export const LYR_WEATHER_LINE_RED = 'weather-line-red';
export const LYR_WEATHER_LINE_VIOLET = 'weather-line-violet';
export const SRC_WEATHER_ICONS = 'weather-icons-src';
export const LYR_WEATHER_ICONS = 'weather-icons';
export const LYR_HEALTH_FILL = 'health-fill';
export const LYR_HEALTH_LINE = 'health-line';
export const LYR_HEALTH_MARKERS = 'health-markers';
export const LYR_HEALTH_APL_FILL = 'health-apl-fill';
export const LYR_HEALTH_APL_LINE = 'health-apl-line';
export const LYR_HEALTH_OSCOUR_CIRCLES = 'health-oscour-circles';

export const SRC_ISNR = 'isnr-depts-src';
export const LYR_ISNR_FILL = 'isnr-fill';
export const LYR_ISNR_LINE = 'isnr-line';
export const LYR_TOPAGE_VIS = 'topage-visual-line';    // réseau hydro décoratif (fond)
export const LYR_FLOODS_RAW = 'flood-lines-raw';       // tronçons sans Topage, pointillés
export const LYR_FLOODS = 'flood-lines';
export const LYR_FLOODS_HIGHLIGHT = 'flood-lines-highlight';
export const LYR_FIRES_GLOW = 'fires-glow';
export const LYR_FIRES_POINTS = 'fires-pts';
export const SRC_FIRES_HIGHLIGHT = 'fires-highlight-src';
export const LYR_FIRES_HIGHLIGHT = 'fires-highlight';
export const SRC_MODIS = 'modis-overlay-src';
export const LYR_MODIS = 'modis-overlay';
export const SRC_SENTINEL_SCENE = 'sentinel-scene-src';
export const LYR_SENTINEL_SCENE = 'sentinel-scene-overlay';
export const LYR_ENERGY_INFRA_VITAL_HALO = 'energy-infra-vital-halo';
export const LYR_ENERGY_INFRA_NUCLEAR_RING = 'energy-infra-nuclear-ring';
export const LYR_ENERGY_INFRA_HIGHLIGHT_GLOW = 'energy-infra-highlight-glow';
export const LYR_ENERGY_INFRA_HIGHLIGHT_RING = 'energy-infra-highlight-ring';
export const LYR_ENERGY_INFRA_CIRCLE = 'energy-infra-circles';
export const LYR_ENERGY_INFRA_LABEL = 'energy-infra-labels';
export const LYR_DROM_ENERGY_HTA_LINES = 'drom-energy-hta-lines-line';
export const LYR_DROM_ENERGY_HIGHLIGHT = 'drom-energy-highlight';
export const LYR_DROM_ENERGY_POINTS = 'drom-energy-points';
export const LYR_HYDRO_BACKBONE_HALO = 'hydro-backbone-halo';
export const LYR_HYDRO_BACKBONE_SIGNAL_RING = 'hydro-backbone-signal-ring';
export const LYR_HYDRO_BACKBONE_CIRCLE = 'hydro-backbone-circles';
export const LYR_HYDRO_BACKBONE_LABEL = 'hydro-backbone-labels';
export const LYR_WIND_CLUSTER       = 'wind-cluster';
export const LYR_WIND_CLUSTER_COUNT = 'wind-cluster-count';
export const LYR_WIND_TURBINE_HALO          = 'wind-turbine-halo';
export const LYR_WIND_TURBINE_CIRCLE        = 'wind-turbine-circles';
export const LYR_WIND_TURBINE_LABEL         = 'wind-turbine-labels';
export const LYR_WIND_PARK_HALO     = 'wind-park-halo';
export const LYR_WIND_PARK_CIRCLE   = 'wind-park-circles';
export const LYR_WIND_PARK_LABEL    = 'wind-park-labels';

export const WEATHER_RADAR_REGIONS = [
  // RainViewer is global, but we clip the raster to keep the overlay focused.
  // Extend the main window from France to a Europe-wide footprint so the radar
  // remains visible when the user pans eastward.
  { id: 'metro', bounds: [-12.0, 34.0, 45.0, 72.0] as [number, number, number, number] },
  { id: 'guadeloupe', bounds: [-61.95, 15.75, -60.95, 16.7] as [number, number, number, number] },
  { id: 'martinique', bounds: [-61.35, 14.2, -60.75, 15.0] as [number, number, number, number] },
  { id: 'guyane', bounds: [-54.8, 1.8, -51.5, 6.0] as [number, number, number, number] },
  { id: 'reunion', bounds: [55.0, -21.5, 55.95, -20.8] as [number, number, number, number] },
  { id: 'mayotte', bounds: [44.9, -13.1, 45.4, -12.5] as [number, number, number, number] },
] as const;
export const WEATHER_RADAR_MAX_ZOOM = 9;

export const SRC_GAS_NETWORK_GRT = 'gas-network-grt-src';
export const SRC_GAS_NETWORK_TEREGA = 'gas-network-terega-src';
export const LYR_GAS_NETWORK_GRT = 'gas-network-grt-line';
export const LYR_GAS_NETWORK_TEREGA = 'gas-network-terega-line';
// Gas Vital Organs (terminals, storage, PIR flows)
export const SRC_GAS_VITALS = 'gas-vitals-src';
export const SRC_GAS_PIR_ARCS = 'gas-pir-arcs-src';
export const SRC_GAS_PIR_MARKERS = 'gas-pir-markers-src';
export const LYR_GAS_TERMINALS = 'gas-terminals';
export const LYR_GAS_STORAGES_GLOW = 'gas-storages-glow';
export const LYR_GAS_STORAGES = 'gas-storages';
export const LYR_GAS_STORAGES_LABEL = 'gas-storages-label';
export const LYR_GAS_PIR_ARC_GLOW = 'gas-pir-arc-glow';
export const LYR_GAS_PIR_ARC = 'gas-pir-arc';
export const SRC_GAS_PIR_CHEVRON_PTS = 'gas-pir-chevron-pts-src';
export const LYR_GAS_PIR_CHEVRONS = 'gas-pir-chevrons';
export const LYR_GAS_PIR_MARKER = 'gas-pir-marker';
export const LYR_GAS_PIR_LABEL = 'gas-pir-label';
// Biomethane injection sites (GRDF OpenData — 833 sites)
export const SRC_BIOMETHANE_SITES = 'biomethane-sites-src';
export const LYR_BIOMETHANE_CLUSTERS = 'biomethane-clusters';
export const LYR_BIOMETHANE_CLUSTER_COUNT = 'biomethane-cluster-count';
export const LYR_BIOMETHANE_SITES = 'biomethane-sites';
export const LYR_BIOMETHANE_SITES_LABEL = 'biomethane-sites-label';
// Oil/Petroleum flows (refineries, pipelines, imports)
export const SRC_OIL_FLOW_ARCS = 'oil-flow-arcs-src';
export const SRC_OIL_FLOW_MARKERS = 'oil-flow-markers-src';
export const SRC_OIL_FLOW_DIRECTION = 'oil-flow-direction-src';
export const SRC_OIL_FLOW_CHEVRON_PTS = 'oil-flow-chevron-pts-src';
export const SRC_FUEL_TENSION = 'fuel-tension-depts-src';
export const LYR_OIL_FLOW_ARC_GLOW = 'oil-flow-arc-glow';
export const LYR_OIL_FLOW_ARC = 'oil-flow-arc';
export const LYR_OIL_FLOW_CHEVRONS = 'oil-flow-chevrons';
export const LYR_OIL_FLOW_MARKER = 'oil-flow-marker';
export const LYR_OIL_FLOW_LABEL = 'oil-flow-label';
export const LYR_FUEL_TENSION_FILL = 'fuel-tension-fill';
export const LYR_FUEL_TENSION_LINE = 'fuel-tension-line';
// Oil infrastructure (pipelines, refineries, depots)
export const SRC_OIL_PIPELINES = 'oil-pipelines-src';
export const SRC_OIL_REFINERIES = 'oil-refineries-src';
export const SRC_OIL_DEPOTS = 'oil-depots-src';
export const LYR_OIL_PIPELINES_GLOW = 'oil-pipelines-glow';
export const LYR_OIL_PIPELINES = 'oil-pipelines';
export const LYR_OIL_REFINERIES_GLOW = 'oil-refineries-glow';
export const LYR_OIL_REFINERIES = 'oil-refineries';
export const LYR_OIL_REFINERIES_LABEL = 'oil-refineries-label';
export const LYR_OIL_DEPOTS = 'oil-depots';
export const LYR_OIL_DEPOTS_TERMINAL_CENTER = 'oil-depots-terminal-center';
export const LYR_OIL_DEPOTS_LABEL = 'oil-depots-label';
// Couches hit invisibles — zone de hover élargie
export const LYR_OIL_REFINERIES_HIT = 'oil-refineries-hit';
export const LYR_OIL_DEPOTS_HIT = 'oil-depots-hit';
export const LYR_OIL_PIPELINES_HIT = 'oil-pipelines-hit';
export const LYR_OIL_FLOW_ARC_HIT = 'oil-flow-arc-hit';
export const LYR_OIL_FLOW_MARKER_HIT = 'oil-flow-marker-hit';
export const LYR_TRAFFIC = 'traffic-flow';
export const LYR_TRAFFIC_CLUSTER = 'traffic-incidents-cluster';
export const LYR_TRAFFIC_CLUSTER_COUNT = 'traffic-incidents-cluster-count';
export const LYR_TRAFFIC_INCIDENTS = 'traffic-incidents';
export const LYR_TRAIN_ROUTE = 'train-route-line';
export const LYR_TRAIN_STATIONS = 'train-stations';
export const LYR_TRAIN_STATION_LABELS = 'train-station-labels';
export const SRC_METRO_LOAD = 'metro-load-src';
export const LYR_METRO_LOAD_GLOW = 'metro-load-glow';
export const LYR_METRO_LOAD_CIRCLE = 'metro-load-circles';
export const LYR_METRO_LOAD_LABEL = 'metro-load-labels';

export const SRC_MILITARY_ZONES = 'military-zones-src';
export const SRC_MILITARY_BASES = 'military-bases-src';
export const SRC_MILITARY_FLIGHTS = 'military-flights-src';
export const SRC_MILITARY_FLIGHT_TRAILS = 'military-flight-trails-src';
export const SRC_AIR_TRAFFIC = 'air-traffic-src';
export const SRC_MILITARY_SHIPS = 'military-ships-src';
export const SRC_MILITARY_SHIPS_HIGHLIGHT = 'military-ships-highlight-src';
export const SRC_MILITARY_SHIPS_SELECTED = 'military-ships-selected-src';
export const SRC_GLOBAL_TRAFFIC = 'global-traffic-src';    // Trafic AIS mondial (civils/étrangers)
export const SRC_SUBMARINE_CABLES = 'submarine-cables-src';
export const SRC_SUBMARINE_CABLES_LANDINGS = 'submarine-cables-landings-src';
export const SRC_TELECOM = 'telecom-src';
export const SRC_POWER = 'power-src';
export const SRC_HOSPITALS = 'hospitals-src';

export const LYR_MILITARY_ZONES_FILL = 'military-zones-fill';
export const LYR_MILITARY_ZONES_LINE = 'military-zones-line';
export const LYR_MILITARY_BASES_CIRCLE = 'military-bases-circle';
export const LYR_MILITARY_BASES_LABEL = 'military-bases-label';
export const LYR_MILITARY_FLIGHT_TRAILS = 'military-flight-trails';
export const LYR_MILITARY_FLIGHTS = 'military-flights';
export const LYR_MILITARY_FLIGHTS_LABEL = 'military-flights-label';
export const LYR_AIR_TRAFFIC_LABEL = 'air-traffic-label';
export const LYR_MILITARY_SHIPS = 'military-ships';
export const LYR_MILITARY_SHIPS_HIGHLIGHT = 'military-ships-highlight';
export const LYR_MILITARY_SHIPS_SELECTED = 'military-ships-selected';
// const LYR_GLOBAL_TRAFFIC = 'global-traffic-pts'; // Now rendered via Deck.gl TextLayer
export const LYR_SUBMARINE_CABLES = 'submarine-cables-line';
export const LYR_SUBMARINE_CABLES_GLOW = 'submarine-cables-glow';
export const LYR_SUBMARINE_CABLES_CORE = 'submarine-cables-core';
export const LYR_SUBMARINE_CABLES_HITAREA = 'submarine-cables-hitarea';
export const LYR_SUBMARINE_CABLES_LANDING = 'submarine-cables-landing';
export const LYR_TELECOM_PTS = 'telecom-pts';
export const LYR_POWER_FILL = 'power-fill';
export const LYR_POWER_LINE = 'power-line';
export const SRC_POWER_TENSION = 'power-tension-src';
export const LYR_POWER_TENSION_FILL = 'power-tension-fill';
export const LYR_POWER_TENSION_LINE = 'power-tension-line';
export const SRC_CITIZEN_ZONES = 'citizen-zones-src';
export const LYR_CITIZEN_FILL = 'citizen-zones-fill';
export const LYR_CITIZEN_LINE = 'citizen-zones-line';
export const SRC_IIP = 'iip-incidents-src';
export const LYR_IIP_GLOW = 'iip-incidents-glow';
export const LYR_IIP_CORE = 'iip-incidents-core';
export const SRC_TERMINATOR = 'terminator-src';
export const LYR_TERMINATOR = 'terminator-fill';
export const SRC_NET_ISP = 'net-isp-src';
export const SRC_NET_IODA = 'net-ioda-src';
export const LYR_NET_ISP_GLOW = 'net-isp-glow';           // halo ambiant
export const LYR_NET_ISP_RING = 'net-isp-ring';           // anneau creux
export const LYR_NET_ISP = 'net-isp-pts';                 // point central
export const LYR_NET_ISP_CLUSTER = 'net-isp-cluster';     // cercle de cluster
export const LYR_NET_ISP_CLUSTER_COUNT = 'net-isp-cluster-count'; // compteur de cluster
export const LYR_NET_IODA_GLOW = 'net-ioda-glow';
export const LYR_NET_IODA_CORE = 'net-ioda-core';
export const LYR_NET_IODA_CLUSTER = 'net-ioda-cluster';
export const LYR_NET_IODA_CLUSTER_COUNT = 'net-ioda-cluster-count';
export const SRC_DC = 'infra-dc-src';
export const SRC_DC_HIGHLIGHT = 'infra-dc-highlight-src';
export const SRC_IXP = 'infra-ixp-src';
export const SRC_IXP_HIGHLIGHT = 'infra-ixp-highlight-src';
export const LYR_DC_GLOW = 'infra-dc-glow';
export const LYR_DC_CORE = 'infra-dc-core';
export const LYR_DC_HIGHLIGHT = 'infra-dc-highlight';
export const LYR_DC_CLUSTER = 'infra-dc-cluster';
export const LYR_DC_CLUSTER_COUNT = 'infra-dc-cluster-count';
export const LYR_IXP_CLUSTER = 'infra-ixp-cluster';
export const LYR_IXP_CLUSTER_COUNT = 'infra-ixp-cluster-count';
export const LYR_IXP_CIRCLE = 'infra-ixp-circle';
export const LYR_IXP_HIGHLIGHT = 'infra-ixp-highlight';
export const LYR_HOSPITALS_CHU = 'hospitals-chu';
export const LYR_HOSPITALS_CH = 'hospitals-ch';
export const LYR_HOSPITALS_LABEL = 'hospitals-label';
export const SRC_MAIRES_POL = 'maires-pol-src';
export const LYR_MAIRES_POL = 'maires-pol';
export const LYR_MAIRES_POL_LABEL = 'maires-pol-label';

// ─── Rail disruptions (SNCF) ───
export const SRC_RAIL_ARCS = 'rail-disruptions-arcs-src';
export const SRC_RAIL_STATIONS = 'rail-disruptions-stations-src';
export const LYR_RAIL_ARC_GLOW = 'rail-arc-glow';
export const LYR_RAIL_ARC = 'rail-arc';
export const LYR_RAIL_ARC_HIT = 'rail-arc-hit';
export const LYR_RAIL_STATION_GLOW = 'rail-station-glow';
export const LYR_RAIL_STATION = 'rail-stations-disrupted';
export const LYR_RAIL_STATION_LABEL = 'rail-station-label';

/** MapLibre match expression: ThreatLevel → hex color */
export const RAIL_SEVERITY_COLOR: maplibregl.ExpressionSpecification = [
  'match', ['get', 'severity'],
  'critical', '#ff2d55',
  'high',     '#ff6b35',
  'medium',   '#ffcc00',
  'low',      '#34c759',
  /* info default */ '#5ac8fa',
];

export const RAIL_SEVERITY_HEX: Record<string, string> = {
  critical: '#ff2d55',
  high: '#ff6b35',
  medium: '#ffcc00',
  low: '#34c759',
  info: '#5ac8fa',
};

export const RAIL_SEVERITY_TINT: Record<string, string> = {
  critical: 'rgba(255,45,85,0.14)',
  high: 'rgba(255,107,53,0.14)',
  medium: 'rgba(255,204,0,0.12)',
  low: 'rgba(52,199,89,0.12)',
  info: 'rgba(90,200,250,0.12)',
};

// ─── Ecowatt signal → color ───
export const ECOWATT_COLORS: Record<EcowattSignal, string> = {
  green: 'rgba(52,199,89,0.15)',
  orange: 'rgba(255,149,0,0.25)',
  red: 'rgba(255,59,48,0.30)',
};

// ─── Météo vigilance → color ───
export const METEO_COLORS: Record<string, string> = {
  green: 'rgba(52,199,89,0.08)',
  yellow: 'rgba(255,204,0,0.20)',
  orange: 'rgba(255,149,0,0.28)',
  red: 'rgba(255,59,48,0.35)',
  violet: 'rgba(175,82,222,0.35)',
};

export const WEATHER_HIGHLIGHT_STATE: maplibregl.ExpressionSpecification = [
  'any',
  ['boolean', ['feature-state', 'preview'], false],
  ['boolean', ['feature-state', 'selected'], false],
];

// ─── Météo risk pictograms ───
export const WEATHER_RISK_EMOJIS: Record<string, string> = {
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

export const AIS_DESTINATION_ALIASES: Record<string, string> = {
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

export const AIS_PORT_LOCODES: Record<string, { name: string; country: string }> = {
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

// ─── Météo department centroids [lng, lat] ───
export const WEATHER_DEPT_CENTROIDS: Record<string, [number, number]> = {
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

// ─── Flood vigilance → color ───
export const FLOOD_COLORS: Record<string, string> = {
  green: '#34c759',
  yellow: '#ffcc00',
  orange: '#ff9500',
  red: '#ff3b30',
};

// ─── ISNR stability → color ───
export const ISNR_COLORS: Record<string, string> = {
  critical: 'rgba(255,59,48,0.40)',   // Rouge : 81-100
  high: 'rgba(255,149,0,0.35)',       // Orange : 61-80
  medium: 'rgba(255,204,0,0.25)',     // Jaune : 41-60
  low: 'rgba(52,199,89,0.20)',        // Vert : 21-40
  stable: 'rgba(52,199,89,0.10)',     // Vert clair : 0-20
};

// ─── Infras vitales: palette pastel volontairement secondaire ───
export const INFRA_COLORS: Record<string, string> = {
  nuclear: '#8FC8E8',
  thermal: '#74B6DC',
  hydro: '#B7DAEE',
  substation: '#5EA6D6',
  'gas-terminal': '#8EDFD8',
  'gas-storage': '#C0F0E8',
  refinery: '#E7BE98',
  'oil-depot': '#F1D6BA',
};

export const INFRA_VITAL_HALO_COLOR = 'rgba(242, 244, 247, 0.94)';
export const INFRA_NUCLEAR_RING_COLOR = 'rgba(232, 242, 250, 0.98)';
export const HYDRAULIC_COLORS: Record<string, string> = {
  hydro_production: '#3B82F6',
  step_storage: '#8B5CF6',
  water_regulation: '#9CA3AF',
};
export const HYDRAULIC_TREND_COLORS: Record<string, string> = {
  low: '#60A5FA',
  normal: '#BFDBFE',
  high: '#2563EB',
  stress: '#EF4444',
};

export const DEFAULT_VIEW: MapViewState = {
  longitude: 2.2,
  latitude: 46.6,
  zoom: 6,
  pitch: 0,
  bearing: 0,
};

// France center for interconnection arcs
export const FRANCE_CENTER: [number, number] = [2.5, 46.5];
