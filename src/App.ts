/**
 * App.ts — Orchestrateur principal de France Monitor.
 * Phase 2 : pipeline RSS réel + classifier + géocodeur.
 */

import { MapContainer } from './components/MapContainer.ts';
import { MapPopup } from './components/MapPopup.ts';
import { energyChipsPressed, energyFocusKeysHtml, isEnergyLayerKey, toggleEnergyChip } from './components/deckgl/energy-focus.ts';
import { escapeHtml } from './components/deckgl/format-utils.ts';
import type { EnergyLayerKey } from './components/deckgl/energy-map.ts';
import type { VigilancePhenomenonId } from './types/index.ts';
import { buildArticlePreviewHtml, buildEventPreviewHtml, MapPreviewCard } from './components/MapPreviewCard.ts';
import { buildEventsKeyHtml } from './components/map-key/events-key.ts';
import { MapLegend, type LegendCategory } from './components/MapLegend.ts';
import { fmIcon, type IconName } from './components/shared/icons.ts';
import { UnderMapNewsFeed } from './components/UnderMapNewsFeed.ts';
import { StatusPanel } from './components/StatusPanel.ts';
import type { SearchModal } from './components/SearchModal.ts';
import type { VigilancePanel } from './components/VigilancePanel.ts';
import type { FloodsPanel } from './components/FloodsPanel.ts';
import { EnergyPanel } from './components/EnergyPanel.ts';
import { isLayerPanelOpen } from './components/layer-panel/frame.ts';
import type { TransportPanel } from './components/TransportPanel.ts';
import type { FiresPanel } from './components/FiresPanel.ts';
import type { TrafficPanel } from './components/TrafficPanel.ts';
import type { AirTrafficPanel } from './components/AirTrafficPanel.ts';
import { FinancialStabilityStrip } from './components/FinancialStabilityStrip.ts';
import { CommodityStrip } from './components/CommodityStrip.ts';
import { fetchCommodityData } from './services/commodities.ts';
import { ISNRPanel } from './components/ISNRPanel.ts';
import type { CyberPanel } from './components/CyberPanel.ts';
import type { FranceIntelPanel } from './components/FranceIntelPanel.ts';
import type { PosteSituation } from './components/poste/PosteSituation.ts';
import type { VisitBaselineSession } from './services/intel-last-visit.ts';
import { briefSituationIds, evaluateBriefLevel, fetchFranceIntelBrief, type BriefLevelMark } from './services/france-intel-brief.ts';
import { LEVEL_RANK, levelHex, scoreLevel, type VigilanceLevel } from './services/vigilance.ts';
import { eventMapPoints } from './services/v2-map.ts';
import { inTheme, themeLabel, type ThemeId } from './services/themes.ts';
import { innerLayerOpen } from './services/escape-layers.ts';
import { isUiV2, layerActivationOptions, layerStateStorage, moduleInColumn, reopensLayerPanelsOnLoad, shouldRecordIntelSnapshot } from './services/ui-mode.ts';
import { restorePanelPlan, showsSwitcher, switcherPanelOffsetPx, v2ColumnVars, v2SwitcherLayout, v2TabletPanelOffsetPx } from './services/floating-panel-switcher.ts';
import { settleWithin } from './utils/settle-within.ts';
import {
  buildFranceCountrySnapshot as buildFranceEngine,
  type FranceRawData,
} from './services/france-country-intel.ts';
import { cableAlertSituations, detectWildfireIncidents, militaryEmergencyAlerts } from './services/situation-engine.ts';
import {
  getDelta24h,
  getPillarDeltas24h,
  getPreviousScoreForSmoothing,
  getSparklineSeries,
  recordStabilitySnapshot,
} from './utils/stability-history.ts';
import type { BriefEventInput, FranceCountrySnapshot, FranceIntelTimelineLane, IntelEventsState, PressAlertEvent, StructuredBrief, TelecomOutagesResponse } from './types/index.ts';
import { PressAlertSource, pruneStalePressAlerts } from './services/press-alert-source.ts';
import { GasPanel } from './components/GasPanel.ts';
import type { HydraulicPanel } from './components/HydraulicPanel.ts';
import type { EolienPanel } from './components/EolienPanel.ts';
import { OilPanel } from './components/OilPanel.ts';
import type { DromEnergyPanel } from './components/DromEnergyPanel.ts';
import type { DefensePanel, DefensePanelState } from './components/DefensePanel.ts';
import type { ConnectivityPanel, ConnectivityPanelState } from './components/ConnectivityPanel.ts';
import type { WeatherRadarPanel, RadarPanelState } from './components/WeatherRadarPanel.ts';
import type { FiresPanelState } from './components/FiresPanel.ts';
import type { MaritimePanel } from './components/MaritimePanel.ts';
import { BarometerWidget } from './components/BarometerWidget.ts';
import type { SentinelModal } from './components/SentinelModal.ts';
import type { RightSidebar } from './components/RightSidebar.ts';
import { fetchNetworkBarometer, setBarometerEolienLive } from './services/network-barometer.ts';
import type { NetworkBarometerResult } from './services/network-barometer.ts';
import { LayerPanel } from './components/LayerPanel.ts';
import {
  THEME_LAYERS,
  ALL_PRESETABLE_LAYER_KEYS, DEFAULT_PRESET_ID, hasPersistedLayers, layersForPreset, migrateStoredLayers, presetShowsEvents, themeLayers, v2StartupLayers, type LayerPresetId,
} from './config/layer-presets.ts';
import { computeISNR } from './services/stability-index.ts';
import type { DepartmentPressure } from './services/department-pressure.ts';
import type { WatchEntry, WatchLevel, WatchTransition, Watched } from './components/layer-panel/watch.ts';
import { cumulFocusKey, envChipsPressed, envFocusStatus, focusSwatchHtml, toggleEnvChip, usesEnergyFocus } from './components/layer-panel/env-focus.ts';
import type { PressurePanel } from './components/PressurePanel.ts';
import { ALL_INFRASTRUCTURE, NUCLEAR_PLANTS } from './config/infrastructure.ts';
// ACTIVE_INSTALLATIONS (config/military-bases-db ~1100 l.) chargé dynamiquement dans loadDefenseSites(), sans fusion OpenStreetMap.

import { AIS_RELAY_URL, getAisStatus, getAisConnectionState, getMilitaryShips, getAllLiveTraffic, NAVY_MMSI_SET, onFirstAisData } from './services/military-ships.ts';
import { connectAis } from './services/ais-connection.ts';
import { detectAisAnomalies } from './services/ais-anomalies.ts';
import { ALL_FEEDS } from './config/feeds.ts';
import { VIEW_PRESETS } from './config/geo.ts';
import { fetchAllFeeds, fetchFromIngestApi } from './services/rss.ts';
import { classifyByKeywords } from './services/classifier.ts';
import { classifyWithAI } from './services/ai-classifier.ts';
import { summarizeWithFallback } from './services/summarization.ts';
import { geocodeNewsItem } from './services/geocoder.ts';
import { fetchEcowatt } from './services/ecowatt.ts';
import { ecowattToday } from './services/ecowatt-official.ts';
import { fetchBiogasProduction } from './services/biogas.ts';
import { fetchBiomethaneSites } from './services/biogas-sites.ts';
import { fetchEnergyRegions, fetchBorderHistory } from './services/energy-regions.ts';
import { fetchMetropoles, type MetropoleConsumption } from './services/metropoles.ts';
import type { MetroLoadPanel } from './components/MetroLoadPanel.ts';
// Environnement (spec 2026-10-04 environnement) : vigilance et crues lues au démarrage (score, situations), feux en arrière-plan.
import { fetchVigilance, mergeVigilance, vigilanceStatus, type VigilanceState } from './services/environment-vigilance.ts';
import { fetchFloods, floodsStatus, mergeFloods, type FloodsState } from './services/environment-floods.ts';
import { fetchFires, firesStatus, mergeFires, type FiresState } from './services/environment-fires.ts';
import { asnrEventsOf, asnrStatus, fetchAsnr, mergeAsnr } from './services/asnr-events.ts';
import type { SourceSlot } from './services/environment-source.ts';
import type { AsnrResponse } from './types/index.ts';
import { buildEnvironmentInputs, servedAirEpisodes, servedDisasters, servedEms, servedQuakes, type EnvironmentInputs } from './services/environment-inputs.ts';
import { ENVIRONMENT_LATE_AFTER_MIN, parisDayOf } from './services/environment-levels.ts';
// Phase B (spec 2026-10-04 environnement § 3) : qualité de l'air et séismes lus au démarrage (situations, tâche 32), sécheresse avec sa
// couche ou son panneau (un stock, jamais au score : E2), marégraphes avec la vigilance.
import { droughtStatus, fetchDrought, mergeDrought, type DroughtState } from './services/environment-drought.ts';
import { airQualityStatus, fetchAirQuality, mergeAirQuality, type AirQualityState } from './services/environment-air.ts';
import { earthquakesStatus, fetchEarthquakes, mergeEarthquakes, type EarthquakesState } from './services/environment-earthquakes.ts';
import { disastersStatus, emsStatus, fetchDisasters, mergeDisasters, type DisastersState } from './services/environment-disasters.ts';
import { fetchSeaLevels, mergeSeaLevels, seaLevelsStatus, type SeaLevelsState } from './services/environment-sea-levels.ts';
import type { DroughtPanel } from './components/DroughtPanel.ts';
import type { AirQualityPanel } from './components/AirQualityPanel.ts';
import type { EarthquakesPanel } from './components/EarthquakesPanel.ts';
import type { DisastersPanel } from './components/DisastersPanel.ts';
import type { ProtestsPanel } from './components/ProtestsPanel.ts';
import { PROTESTS_POLL_MS, fetchProtests, mergeProtests, type ProtestsState } from './services/protests.ts';
import { PROTESTS_LEGEND, protestsLegend } from './components/layer-panel/manifestations-legend.ts';
import type { CriminalitePanel } from './components/CriminalitePanel.ts';
import { fetchCrimeDataset } from './services/crime.ts';
import { CRIME_LEGEND, crimeLegend } from './components/layer-panel/criminalite-legend.ts';
import type { WebcamsPanel } from './components/WebcamsPanel.ts';
import type { WebcamWall } from './components/WebcamWall.ts';
import type { FluxPietonsPanel } from './components/FluxPietonsPanel.ts';
import { FLUX_POLL_MS, fetchFluxEvent, fluxForecastsByProtest, fluxMoment, fetchFluxIndex, type FluxFeature } from './services/flux-pietons.ts';
import { FLUX_LEGEND, fluxLegend } from './components/layer-panel/flux-pietons-legend.ts';
import type { FluxIndex, FluxPhase } from './types/index.ts';
import { fetchWebcamsDataset } from './services/webcams.ts';
import { WEBCAMS_LEGEND, webcamsLegend } from './components/layer-panel/webcams-legend.ts';
import type { EnvBriefData, EnvBriefPanel } from './components/EnvBriefPanel.ts';
import type { ThemeBriefData, ThemeBriefPanel } from './components/ThemeBriefPanel.ts';
import type { ThemeBriefPastille } from './components/layer-panel/theme-brief.ts';
import { lastLayerHead } from './components/layer-panel/frame.ts';
import type { WorkQueue } from './services/work-queue.ts';
import { ENV_BRIEF_LEGEND } from './components/layer-panel/env-brief-legend.ts';
import { ENV_FOCUS_IDS } from './components/layer-panel/env-focus.ts';
import { railStationCounts, transportVigilancePoints, type TransportMode, type TransportVigilancePoint } from './components/layer-panel/transport-vigilance.ts';
import { buildTransportKeyHtml } from './components/map-key/transport-key.ts';
import { buildHazards, computeExposure, type Exposure, type ExposureResult, type Hazard } from './services/environment-exposure.ts';
import { fetchExposureAssets, fetchSevesoDataset, type ExposureAssetsState, type SevesoDataset } from './services/exposure-assets.ts';
import { fetchCommunes, hazardPopulation, type Commune, type HazardPopulation } from './services/exposure-population.ts';
import { cachedCarreaux, fetchCarreaux, zonePeople, type ZonePeople } from './services/flood-zone-people.ts';
import { fetchFloodZones } from './services/environment-flood-zones.ts';
import { EXPOSURE_SCENARIOS, floodCells, sectionFloodZones } from './services/flood-zone-geo.ts';
import type { FloodZoneStatus, SectionImpact } from './components/layer-panel/crues-impact.ts';
import type { SevesoPanel } from './components/SevesoPanel.ts';
import type { PollensPanel } from './components/PollensPanel.ts';
import type { PollenDay } from './types/index.ts';
import { POLLEN_TTL_MS, fetchPollen, mergePollen, type PollenState } from './services/environment-pollen.ts';
import { pollensHeadLevel } from './components/layer-panel/pollens-level.ts';
import { POLLENS_LEGEND, pollensLegend } from './components/layer-panel/pollens-legend.ts';
import { sevesoExposures, sevesoHeadLevel } from './components/layer-panel/seveso-level.ts';
import { SEVESO_LEGEND, sevesoLegend } from './components/layer-panel/seveso-legend.ts';
import { buildEnvironmentKeyHtml } from './components/map-key/environment-key.ts';
import { OFFICIAL_COLOR_LEVEL } from './services/environment-levels.ts';
import type { WebcamsDataset } from './types/index.ts';
import type { CrimeDataset } from './types/index.ts';
import { departementCentroid } from './config/departements.ts';
import { radarStatus, type RadarProfileState } from './services/environment-radar.ts';
import { clusterFireDetections } from './services/fire-clustering.ts';
import { fetchRadarColumn } from './services/radar-column.ts';
import {
  ENVIRONMENT_ALWAYS_POLLED, ENVIRONMENT_LAYER_KEYS, ENVIRONMENT_LAYER_SOURCES, ENVIRONMENT_POLL_MS, ENVIRONMENT_SOURCE_NAMES,
  environmentReportSources, hasActiveEnvironment, type EnvironmentLayerKey,
} from './config/environment-sources.ts';
import {
  AIR_QUALITY_LEGEND, DISASTERS_LEGEND, DROUGHT_LEGEND, EARTHQUAKES_LEGEND, FIRES_LEGEND, FLOODS_LEGEND, RADAR_LEGEND, VIGILANCE_LEGEND, airQualityLegend, droughtLegend, withFillMask,
  disastersLegend, earthquakesLegend, firesLegend, floodsLegend, radarLegend, vigilanceLegend, withTideGauges,
} from './components/layer-panel/environment-legend.ts';
// Souveraineté (spec 2026-10-04 souveraineté ; contrats § 4.4) : aéronefs militaires, veille des câbles et vigilance cyber lus au démarrage
// et relevés sans arrêt (score, arbitrage 21) ; panneaux, carte, légendes et panneau des sources datés par leur donnée.
import { fetchDefenseOsmWorks, fetchMilitary, mergeMilitary, militaryStatus, type MilitaryState } from './services/sovereignty-military.ts';
import { cablesStatus, fetchCables, mergeCables, type CablesState } from './services/sovereignty-cables.ts';
import { cyberStatus, fetchCyber, mergeCyber, type CyberPart, type SovCyberState } from './services/sovereignty-cyber.ts';
import {
  fetchVigipirateCheck, mergeVigipirateCheck, vigipirateCheckStatus, type VigipirateCheckState,
} from './services/sovereignty-vigipirate.ts';
import {
  SOVEREIGNTY_ALWAYS_POLLED, SOVEREIGNTY_LAYER_KEYS, SOVEREIGNTY_LAYER_SOURCES, SOVEREIGNTY_POLL_MS, SOVEREIGNTY_SOURCE_NAMES,
  hasActiveSovereignty, sovereigntyReportSources, type SovereigntyLayerKey,
} from './config/sovereignty-sources.ts';
import {
  CONNECTIVITY_LEGEND, CYBER_LEGEND, DEFENSE_LEGEND, connectivityLegend, cyberLegend, defenseLegend, withDefensePhaseB,
} from './components/layer-panel/sovereignty-legend.ts';
import { findShipByKey, navyLiveState } from './components/layer-panel/navy.ts';
import type { DefenseSitesSummary } from './components/layer-panel/defense.ts';
import { buildSovereigntyInputs, monitoredMilitaryEmergencies, type SovereigntyInputs } from './services/sovereignty-inputs.ts';
// Souveraineté, phase B (tâche B28) : grille GNSS et météo spatiale (score), grands réseaux, registre des gels, zones drones ; moniteur.
import { fetchGnss, gnssStatus, mergeGnss, type GnssState } from './services/sovereignty-gnss.ts';
import { fetchConnectivity, mergeConnectivity, ripeStatus, type ConnectivityState } from './services/sovereignty-connectivity.ts';
import { fetchSanctions, gelsStatus, mergeSanctions, type SanctionsState } from './services/sovereignty-sanctions.ts';
import { fetchDroneZones } from './services/sovereignty-drones.ts';
import { withGnssInputs } from './services/sovereignty-inputs-b.ts';
import { gnssJammingSituations, pruneStaleGnssAlert } from './services/sovereignty-alerts.ts';
import { distinctVessels } from './services/sovereignty-levels.ts';
import type { DroneZonesFile } from './types/index.ts';
import {
  LYR_SOV_AIRCRAFT, LYR_SOV_AIRCRAFT_ABROAD, LYR_SOV_CABLE_VESSELS, LYR_SOV_EMERGENCIES, LYR_SOV_GNSS_FILL, LYR_SOV_NAVY_OBSERVED,
  LYR_SOV_NAVY_REFERENCE, LYR_SUBMARINE_CABLES_HITAREA, LYR_SUBMARINE_CABLES_LANDING,
} from './components/deckgl/constants.ts';

/** Clé d'une des couches Environnement (un panneau, une relève, une légende chacune). */
const isEnvironmentLayerKey = (key: keyof MapLayers): key is EnvironmentLayerKey => (ENVIRONMENT_LAYER_KEYS as readonly string[]).includes(key);
/** Clé d'une des trois couches Souveraineté (un panneau, une relève, une légende chacune ; contrats § 4.4 point 2). */
const isSovereigntyLayerKey = (key: keyof MapLayers): key is SovereigntyLayerKey => (SOVEREIGNTY_LAYER_KEYS as readonly string[]).includes(key);
/** Clé d'une des quatre couches Pannes réseau (Électricité, Télécoms, Internet, Cloud : un panneau, une relève, une légende chacune). */
const isOutagesLayerKey = (key: keyof MapLayers): key is OutagesLayerKey => (OUTAGES_LAYER_KEYS as readonly string[]).includes(key);
/** Lignes cyber du panneau des sources (arbitrage 22) : partie de la réponse qui date chaque ligne, nom affiché. */
const CYBER_STATUS_PARTS: ReadonlyArray<readonly [CyberPart, string]> = [
  ['certfr', 'CERT-FR'], ['kev', 'CISA KEV'], ['ransomware', 'Ransomware.live'], ['hibp', 'Have I Been Pwned'],
  ['cybermalveillance', 'Cybermalveillance.gouv.fr'],
];
/** Ligne de la relecture quotidienne de la page Vigipirate du SGDSN (O14, arbitrage du contrôleur) ; la saisie n'a pas de ligne. */
const VIGIPIRATE_CHECK_SOURCE = 'Vigipirate (page du SGDSN)';
/** Sites de défense avant la lecture de la liste interne : jamais affichés (ensureDefensePanel attend loadDefenseSites). */
const NO_DEFENSE_SITES: DefenseSitesSummary = {
  curated: { total: 0, byType: { air: 0, navy: 0, army: 0, joint: 0, fortification: 0, other: 0 }, overseas: 0, abroad: 0 },
  osm: { meta: null, error: null, shown: false },
};
// buildHydraulicBackboneAssets (+ config hydraulic-backbone-official ~1200 l.) chargé
// dynamiquement dans refreshHydraulicLayer() — sort la grosse config du chunk critique.
import { fetchHydraulicHydrometrySnapshot, type HydraulicHydrometrySnapshot } from './services/hubeau-hydrometry.ts';
import { EolienTracker } from './services/eolien/eolien-tracker.ts';

import { resolveIncidentGeography } from './services/incident-geography.ts';
import { fetchMtgFrpMetadata, type MtgFrpMetadata } from './services/mtg-frp.ts';
import { fetchRadar2dManifest, type Radar2dResult } from './services/radar-2d.ts';
// Services Trafics chargés à la demande (loadRoadTraffic, loadAirOverview, loadRailTraffic, loadMaritimeSnapshot) : hors du chunk critique.
import type { RoadTrafficState } from './services/traffic-road.ts';
import type { AirOverviewState } from './services/traffic-air.ts';
import type { RailTrafficState } from './services/traffic-rail.ts';
import type { MaritimeState } from './services/traffic-maritime.ts';
import {
  AIR_POSITIONS_SOURCE, TRAFFIC_LAYER_KEYS, TRAFFIC_LAYER_SOURCES, TRAFFIC_SOURCE_NAMES, aisLiveStatus, airPositionsStatus, trafficReportSources,
  type TrafficLayerKey,
} from './config/traffic-sources.ts';
import { dedupe } from './utils/inflight.ts';
import {
  AIR_TRAFFIC_LEGEND, MARITIME_TRAFFIC_LEGEND, RAIL_TRAFFIC_LEGEND, ROAD_TRAFFIC_LEGEND, airLegend, maritimeLegend, railLegend, roadLegend,
} from './components/layer-panel/traffic-legend.ts';
import { fetchAirTrafficSnapshot } from './services/air-traffic.ts';
import { fetchMarketData } from './services/finance.ts';
import type { EventPressureResponse } from './types/index.ts';
import type { ArchivedNoteSummary } from './services/situation-notes.ts';
import { upcomingFromSources } from './services/upcoming.ts';
import {
  BCE_SOURCE_NAME, SPREAD_SOURCE_NAME, bceStatus, fetchFinancialStability, mergeFinancialStability, spreadStatus, type FinancialStabilitySlot,
} from './services/financial-stability.ts';
// Pannes réseau (spec 2026-10-08 panneaux pannes § 4) : Télécoms lu au démarrage et relevé sans arrêt (score) ; Électricité, Internet et
// Cloud couche active ou panneau ouvert ; panneaux, carte, légendes et panneau des sources datés par leur donnée.
import {
  OUTAGES_ALWAYS_POLLED, OUTAGES_LAYER_KEYS, OUTAGES_LAYER_SOURCES, OUTAGES_POLL_MS, OUTAGES_SOURCE_NAMES, hasActiveOutages,
  type OutagesLayerKey,
} from './config/outages-sources.ts';
import { arcepStatus, fetchTelecom, mergeTelecom, type TelecomState } from './services/outages-telecom.ts';
import { telecomIfFresh } from './services/outages-levels.ts';
import { edfStatus, fetchPower, iipStatus, mergePower, seiStatus, type PowerState } from './services/outages-power.ts';
import { fetchInternet, iodaStatus, mergeInternet, radarStatus as cloudflareRadarStatus, type InternetState } from './services/outages-internet.ts';
import { cloudStatus, fetchCloud, mergeCloud, type CloudState } from './services/outages-cloud.ts';
import { emptySlot } from './services/sovereignty-source.ts';
import { cloudLegend, internetLegend, telecomLegend } from './components/layer-panel/outages-legend.ts';
import type { OutagesTelecomPanel } from './components/OutagesTelecomPanel.ts';
import type { OutagesPowerPanel } from './components/OutagesPowerPanel.ts';
import type { OutagesInternetPanel } from './components/OutagesInternetPanel.ts';
import type { OutagesCloudPanel } from './components/OutagesCloudPanel.ts';
import { fetchRTEIIPIncidents } from './services/rte-iip.ts';
import { fetchNuclearUnavailabilities, buildNuclearStateMap } from './services/nuclear-rte.ts';
import { ENERGY_STATE_HEX, ENERGY_STATES, type EnergyState } from './services/energy-state.ts';
import { buildEnergyKeyHtml } from './components/map-key/energy-key.ts';
import { buildNuclearState } from './services/nuclear-correlation.ts';
import type { NuclearPanel } from './components/NuclearPanel.ts';
import type { SituationMonitor } from './components/SituationMonitor.ts';
import type { SituationBrief } from './components/SituationBrief.ts';
import type { OutagesNowController } from './components/outages-room/outages-now-controller.ts';
import { resolvedSituationsFromHistory } from './services/situation-brief.ts';
import type { SituationHistoryPanel } from './components/SituationHistoryPanel.ts';
import { getHistory, isRecorderPage, pushHistorySnapshot, scoreCoverageOf } from './services/situation-history.ts';
import type { AlertMonitor } from './components/AlertMonitor.ts';
import { UpdateNotification } from './components/UpdateNotification.ts';
import type { NuclearState, NuclearUnavailability, InfrastructurePoint, ScoreCoverage } from './types/index.ts';
import { fetchSpaceWeather } from './services/space-weather.ts';
// Services et panneaux santé chargés à la demande (loadHealthSurveillance, loadHealthOffer, ensure*Panel) : hors du chunk critique.
import type { HealthSurveillanceKey, HealthSurveillanceState } from './services/health-surveillance.ts';
import type { HealthOfferState } from './services/health-offer.ts';
import type { NationalHealthSummary } from './components/layer-panel/veille.ts';
import type { VeilleSanitairePanel } from './components/VeilleSanitairePanel.ts';
import type { UrgencesPanel } from './components/UrgencesPanel.ts';
import type { AccesSoinsPanel } from './components/AccesSoinsPanel.ts';
import type { HopitauxPanel } from './components/HopitauxPanel.ts';
import { fetchGasNetwork, isGasPanelEnabled } from './services/gas.ts';
// oil.ts (~1250 l.) chargé dynamiquement dans loadOil() — sort du chunk critique
import { buildDegradedFuelTensionDashboard, fetchFuelTensionDashboard } from './services/fuel-tension.ts';
import { readUrlState, writeUrlState } from './utils/urlState.ts';
import { loadNewsFromCache, saveNewsToCache } from './utils/newsCache.ts';
import type { DromLiveResponse, NewsItem, FilterState, FuelTensionDashboard, MapLayers, EcowattResponse, ISNRData, LayerConfig, OilDashboard, EventCategory, AisAnomaly, RailTrain, RoadEvent, RoadEventKind, HydraulicBackboneAsset, MarketData, DetectedSituation, SituationSeverity, ThreatLevel, BiogasState, BiomethaneSite, FireObservationFeedState, CommodityData, VigilanceEcheance } from './types/index.ts';
import { fetchISNRSynthesis, type NuclearBriefingContext, type EolienBriefingContext, type OilBriefingContext } from './services/isnr-synthesis.ts';
import type { EolienLive, EolienParkSummary } from './services/eolien/types.ts';
import { Watchdog } from './services/watchdog.ts';
import { recordStatusSamples, startQualityHistoryTracking } from './services/source-quality-history.ts';
import { HEALTH_NATIONAL_KEYS, HEALTH_OFFER_SOURCES, HEALTH_STATUS_SOURCES, healthReportSources } from './config/health-sources.ts';
import type { SituationReportContext } from './components/SituationReport.ts';
import type { ExportContext } from './services/data-export.ts';
import type { ExportMenu } from './components/ExportMenu.ts';
import { fetchAppVersion, getVersionKey } from './services/version-watch.ts';
import type { DromEnergyDashboard } from './services/drom-energy/index.ts';
import { loadDepartementIndex } from './services/departement-lookup.ts';
import { getCurrentLanguage, onLanguageChange, setLanguage, t } from './services/i18n.ts';



// ─── Polling intervals (ms) ─────────────────────────────────────────────────
// Single source of truth for every setInterval cadence in this file.
// Tune here — never scatter magic numbers near each setInterval call.
const RSS_POLL_INTERVAL_MS             =  5 * 60_000; //  5 min
const POLL_FINANCE_MS                  =  5 * 60_000; //  5 min  (market data + nuclear snapshot)
const POLL_NUCLEAR_MS                  = 15 * 60_000; // 15 min  (RTE real-time unavailabilities)
const POLL_OIL_MS                      =  5 * 60_000; //  5 min  (fuel tension quasi-live + oil structural cache)
const POLL_COMMODITIES_MS              = 15 * 60_000; // 15 min
const POLL_AIR_TRAFFIC_MS              = 12_000;       // 12 s    (positions de la carte ; collecte OpenSky du serveur toutes les 2 min)
const POLL_AIR_OVERVIEW_MS             =  2 * 60_000; //  2 min  (panneau aérien : aperçu du serveur ; cache client 90 s)
const POLL_ROAD_MS                     =  5 * 60_000; //  5 min  (DIR et agglomérations TomTom collectés par le serveur ; cache client 4 min)
const POLL_EVENT_PRESSURE_MS           = 10 * 60_000; // 10 min  (/api/news/event-pressure, cache serveur 10 min)
const POLL_MARITIME_SNAPSHOT_MS        =  2 * 60_000; //  2 min  (instantané du relais AIS ; cache client 90 s)
const POLL_HEALTH_MS                   = 30 * 60_000; // 30 min  (veille sanitaire et offre de soins, hebdomadaires ou annuelles ; caches clients 25 min)
const POLL_HYDRAULIC_MS                = 10 * 60_000; // 10 min  (hydrometrics + barrage signals)
const POLL_ECO2MIX_MS                  =  5 * 60_000; //  5 min  (éCO2mix national, pas de 15 min ; cache client 4 min)
const POLL_EOLIEN_MS                   =  5 * 60_000; //  5 min  (RTE éolien temps-réel)
const POLL_DROM_LIVE_MS               =  5 * 60_000; //  5 min  (EDF SEI temps réel, pas de 5 min)
// Vigilance, crues, radar et feux : relèves de ENVIRONMENT_POLL_MS (src/config/environment-sources.ts), syncEnvironmentPolling.
const POLL_MTG_FRP_MS                  = 10 * 60_000; // 10 min  (LSA SAF product cadence)
// MTG-FRP : retard S2 de la spec environnement (observation + 60 min), constante unique de la tâche 1, jamais l'ancien seuil de 45 min.
const MTG_FRP_LATE_MS                  = ENVIRONMENT_LATE_AFTER_MIN['mtg-frp'] * 60_000;
const POLL_NETWORK_BAROMETER_MS        =  5 * 60_000; //  5 min
const POLL_SNCF_MS                     =  5 * 60_000; //  5 min  (perturbations SNCF et situations SIRI SX ; cache client 4 min ; couche active, sans arrêt)
const POLL_SPACE_WEATHER_REFRESH_MS    = 15 * 60_000; // 15 min
const VERSION_POLL_INTERVAL_MS         =     60_000;  //  1 min
/** Relève de chaque panneau Trafics, tant que sa couche est active ou son panneau ouvert (syncTrafficPolling). */
const TRAFFIC_POLL_MS: Readonly<Record<TrafficLayerKey, number>> = {
  trafficRoad: POLL_ROAD_MS, trafficAir: POLL_AIR_OVERVIEW_MS, trafficRail: POLL_SNCF_MS, trafficMaritime: POLL_MARITIME_SNAPSHOT_MS,
};

// Cap on news items kept in memory / pushed to map & panels (after date sort).
const MAX_NEWS_ITEMS = 500;
// Inter-batch delays for background RSS augmentation pipelines.
const GEOCODE_BATCH_DELAY_MS = 50;
const SUMMARIZE_BATCH_DELAY_MS = 50;
// AI classification fallback: items processed in parallel batches of this size.
const AI_CLASSIFY_BATCH_SIZE = 5;

/** Interval pausable quand l'onglet est caché (visibilitychange). */
interface PausableTimer {
  fn: () => void;
  ms: number;
  id: ReturnType<typeof setInterval> | null;
}

// Session-level geocoding memo: never geocode the same title+region twice per session.
const geocodeSessionCache = new Map<string, Awaited<ReturnType<typeof geocodeNewsItem>>>();

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

function isEnergyStateName(value: string): value is EnergyState {
  return (ENERGY_STATES as readonly string[]).includes(value);
}

function buildNuclearInfrastructurePoints(
  unavailabilities: NuclearUnavailability[] = [],
  rteAvailable = false,
): InfrastructurePoint[] {
  const stateMap = buildNuclearStateMap(unavailabilities, Date.now(), rteAvailable);

  return NUCLEAR_PLANTS
    .filter((p) => p.status !== 'shutdown')
    .map((p) => {
      const summary = summarizeNuclearPlantForMap(p.name, p.capacity ?? 0, unavailabilities);
      const energyState = stateMap[p.name] ?? 'nonSuivi';
      return {
        ...p,
        energyState,
        colorOverride: ENERGY_STATE_HEX[energyState],
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
  rteAvailable = false,
): InfrastructurePoint[] {
  const gasInfra = ALL_INFRASTRUCTURE.filter((p) => p.type === 'gas-terminal' || p.type === 'gas-storage');
  return [...buildNuclearInfrastructurePoints(unavailabilities, rteAvailable), ...gasInfra];
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

// Default layer visibility: all layers start disabled on first load.
const DEFAULT_LAYERS: MapLayers = {
  newsGroup: false,
  news: false,
  events: false,
  alerts: false,
  energySystems: false,
  dromEnergy: false,
  powerGrid: false,
  hydroBackbone: false,
  windMonitor: false,
  health: false,
  healthOscour: false,
  healthApl: false,
  hospitals: false,
  environmentGroup: false,
  environmental: false,
  floods: false,
  weatherRadar: false,
  fires: false,
  drought: false,
  airQuality: false,
  earthquakes: false,
  disasters: false,
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
  protests: false,
  crime: false,
  webcams: false,
  envBrief: false,
  brief: false,
  seveso: false,
  pollens: false,
  pedestrianFlows: false,
  stability: false,
  cyber: false,
  gasNetwork: false,
  biomethaneSites: false,
  oilNetwork: false,
  nuclearFleet: false,
};

const ACTIVE_LAYERS_STORAGE_KEY = 'fm-active-layers';

/**
 * Registre des panneaux flottants possédés par une couche (audit UI 2026-09
 * §5.3 point 3 : un seul panneau flottant ouvert à la fois). Un seul id
 * représentatif par panneau ; le groupe pannes réseau partage un
 * unique panneau pour plusieurs clés enfant (`layerKeys`). Source unique pour
 * getFloatingPanelInstance()/hideAllFloatingPanels()/showFloatingPanel()/le
 * sélecteur « panneaux ouverts » (refreshFloatingPanelSwitcher()). `id` est
 * toujours une clé passée telle quelle à _handlePanelVisibility().
 */
interface FloatingPanelDef {
  id: keyof MapLayers;
  label: string;
  icon: IconName;
  layerKeys: ReadonlyArray<keyof MapLayers>;
}

/** Sources relevées pour la seule Vue générale dynamique (lot C) : hors du socle de relève permanent. */
const GENERAL_WATCH_POLLED: ReadonlyArray<keyof MapLayers> = [
  'outagesElec', 'outagesInternet', 'outagesCloud', 'drought',
  // Trafics (lot 1 Transports, 25/10/2026) : un mode passé en orange ou en rouge entre dans la Vue générale.
  'trafficRoad', 'trafficRail', 'trafficAir', 'trafficMaritime',
];

/** Panneaux de module : ne comptent pas comme « couche intérieure » pour Échap. */
const MODULE_PANEL_SELECTOR = '[class*="-panel-modal"], .fm-floating-panel';

/** Délai de l'aperçu au survol d'une pastille (évite le clignotement en glissant d'une pastille à l'autre). */
const PASTILLE_PREVIEW_DELAY_MS = 120;

const FLOATING_PANEL_DEFS: ReadonlyArray<FloatingPanelDef> = [
  { id: 'envBrief', label: 'En bref', icon: 'target', layerKeys: ['envBrief'] },
  { id: 'brief', label: 'En bref', icon: 'target', layerKeys: ['brief'] },
  { id: 'environmental', label: 'Vigilance météo', icon: 'cloud-lightning', layerKeys: ['environmental'] },
  { id: 'floods', label: 'Crues', icon: 'waves', layerKeys: ['floods'] },
  { id: 'weatherRadar', label: 'Radar météo', icon: 'cloud-rain', layerKeys: ['weatherRadar'] },
  { id: 'fires', label: 'Feux de forêt', icon: 'flame', layerKeys: ['fires'] },
  { id: 'drought', label: 'Sécheresse', icon: 'sun', layerKeys: ['drought'] },
  { id: 'airQuality', label: 'Qualité de l’air', icon: 'cloud', layerKeys: ['airQuality'] },
  { id: 'earthquakes', label: 'Séismes', icon: 'activity', layerKeys: ['earthquakes'] },
  { id: 'disasters', label: 'Catastrophes', icon: 'globe', layerKeys: ['disasters'] },
  { id: 'pollens', label: 'Pollens', icon: 'leaf', layerKeys: ['pollens'] },
  { id: 'seveso', label: 'Seveso', icon: 'factory', layerKeys: ['seveso'] },
  { id: 'powerGrid', label: 'Réseau électrique', icon: 'zap', layerKeys: ['powerGrid'] },
  { id: 'dromEnergy', label: 'Énergie DROM', icon: 'palmtree', layerKeys: ['dromEnergy'] },
  { id: 'nuclearFleet', label: 'Parc nucléaire', icon: 'atom', layerKeys: ['nuclearFleet'] },
  { id: 'gasNetwork', label: 'Réseau gaz', icon: 'flame', layerKeys: ['gasNetwork'] },
  { id: 'hydroBackbone', label: 'Stress hydro', icon: 'droplet', layerKeys: ['hydroBackbone'] },
  { id: 'oilNetwork', label: 'Pétrole', icon: 'fuel', layerKeys: ['oilNetwork'] },
  { id: 'windMonitor', label: 'Éolien', icon: 'wind', layerKeys: ['windMonitor'] },
  { id: 'metroLoad', label: 'Charge métropolitaine', icon: 'building-2', layerKeys: ['metroLoad'] },
  { id: 'health', label: 'Veille sanitaire', icon: 'stethoscope', layerKeys: ['health'] },
  { id: 'healthOscour', label: 'Urgences et SOS Médecins', icon: 'siren', layerKeys: ['healthOscour'] },
  { id: 'healthApl', label: 'Accès aux soins', icon: 'map-pin', layerKeys: ['healthApl'] },
  { id: 'hospitals', label: 'Hôpitaux', icon: 'hospital', layerKeys: ['hospitals'] },
  { id: 'trafficRoad', label: 'Trafic routier', icon: 'car-front', layerKeys: ['trafficRoad'] },
  { id: 'trafficAir', label: 'Trafic aérien', icon: 'plane', layerKeys: ['trafficAir'] },
  { id: 'trafficMaritime', label: 'Trafic maritime', icon: 'ship', layerKeys: ['trafficMaritime'] },
  { id: 'trafficRail', label: 'Réseau ferroviaire', icon: 'train-front', layerKeys: ['trafficRail'] },
  { id: 'military', label: 'Défense', icon: 'shield', layerKeys: ['military'] },
  { id: 'subseaCables', label: 'Connectivité', icon: 'waves', layerKeys: ['subseaCables'] },
  { id: 'cyber', label: 'Vigilance cyber', icon: 'lock-keyhole', layerKeys: ['cyber'] },
  { id: 'stability', label: 'Pression par département', icon: 'bar-chart-3', layerKeys: ['stability'] },
  { id: 'outagesElec', label: 'Électricité', icon: 'zap', layerKeys: ['outagesElec'] },
  { id: 'outagesTelecom', label: 'Télécoms mobiles', icon: 'satellite-dish', layerKeys: ['outagesTelecom'] },
  { id: 'outagesInternet', label: 'Internet', icon: 'globe', layerKeys: ['outagesInternet'] },
  { id: 'outagesCloud', label: 'Cloud et hébergement', icon: 'cloud', layerKeys: ['outagesCloud'] },
  { id: 'protests', label: 'Manifestations', icon: 'megaphone', layerKeys: ['protests'] },
  { id: 'crime', label: 'Criminalité', icon: 'siren', layerKeys: ['crime'] },
  { id: 'webcams', label: 'Webcams', icon: 'camera', layerKeys: ['webcams'] },
  { id: 'pedestrianFlows', label: 'Foule estimée', icon: 'activity', layerKeys: ['pedestrianFlows'] },
];

/** Lignes Souveraineté de la phase B : chacune n'est écrite que par son lecteur (tâche B28), jamais par un service de la phase A. */
const SOVEREIGNTY_B_SOURCE_NAMES: ReadonlySet<string> = new Set(['Grille GNSS', 'NOAA SWPC', 'RIPEstat', 'Registre des gels']);

/**
 * handleSourcePanelClick()'s source names → their FLOATING_PANEL_DEFS id
 * (best-effort, only for the chip switcher's "current" highlight — that
 * click path can open a panel without its layer being active, so it can't
 * be driven by floatingPanelIdForLayerKey()).
 */
const SOURCE_NAME_TO_FLOATING_PANEL: Record<string, keyof MapLayers> = {
  'Météo-France': 'environmental',
  'Vigicrues': 'floods',
  'Radar Météo-France': 'weatherRadar',
  'Météo des forêts': 'fires',
  'Éolien France': 'windMonitor',
  'SNCF': 'trafficRail',
  'NASA FIRMS': 'fires',
  'VigiEau': 'drought',
  'Atmo France': 'airQuality',
  'BCSF-RéNaSS': 'earthquakes',
  'GDACS': 'disasters',
  'Marégraphes SHOM': 'environmental',
  'Trafic': 'trafficRoad',
  'TomTom agglomérations': 'trafficRoad',
  'Trafic aérien': 'trafficAir',
  [AIR_POSITIONS_SOURCE]: 'trafficAir',
  'SIRI SX': 'trafficRail',
  'AIS maritime': 'trafficMaritime',
  'AIS instantané': 'trafficMaritime',
  'CERT-FR': 'cyber',
  'CISA KEV': 'cyber',
  'Ransomware.live': 'cyber',
  'Have I Been Pwned': 'cyber',
  'Cybermalveillance.gouv.fr': 'cyber',
  'Câbles et AIS': 'subseaCables',
  'RIPEstat': 'subseaCables',
  'Écowatt RTE': 'powerGrid',
  'ARCEP sites mobiles': 'outagesTelecom',
  'EDF indisponibilités': 'outagesElec',
  'RTE IIP': 'outagesElec',
  'EDF SEI (îles)': 'outagesElec',
  'IODA': 'outagesInternet',
  'Cloudflare Radar': 'outagesInternet',
  'Pages d’état cloud': 'outagesCloud',
  'Réseau Gaz / EcoGaz': 'gasNetwork',
  'Pétrole SDES / INSEE': 'oilNetwork',
  'Vols militaires': 'military',
  'Vigipirate (page du SGDSN)': 'military',
  'Grille GNSS': 'military',
  'NOAA SWPC': 'military',
  'Registre des gels': 'military',
  'Santé publique France': 'healthOscour',
  'Odissé alertes': 'health',
  'Sentinelles': 'health',
  'SUM’eau': 'health',
  'OMS / ECDC': 'health',
  'DGS-Urgent (PEPS)': 'health',
  'ANSM Médicaments': 'health',
  'RappelConso': 'health',
  'DREES APL': 'healthApl',
  'DREES SAE / FINESS': 'hospitals',
};

/** Couches santé, un panneau chacune (spec 2026-10-03 § 3). */
type HealthLayerKey = 'health' | 'healthOscour' | 'healthApl' | 'hospitals';

const ENERGY_SYSTEM_LAYER_KEYS: Array<
  'dromEnergy' |
  'powerGrid' |
  'hydroBackbone' |
  'gasNetwork' |
  'biomethaneSites' |
  'oilNetwork' |
  'windMonitor' |
  'metroLoad' |
  'nuclearFleet'
> = [
  'dromEnergy',
  'powerGrid',
  'hydroBackbone',
  'gasNetwork',
  'biomethaneSites',
  'oilNetwork',
  'windMonitor',
  'metroLoad',
  'nuclearFleet',
];

function hasActiveEnergySystems(layers: Pick<MapLayers, typeof ENERGY_SYSTEM_LAYER_KEYS[number] | 'energySystems'>): boolean {
  return ENERGY_SYSTEM_LAYER_KEYS.some((key) => layers[key]);
}

// Légendes santé (spec 2026-10-03 § 3) : couleurs identiques à la carte (deckgl/health-map.ts, vérifié par test).
const HEALTH_ALERTS_LEGEND: LegendCategory = {
  id: 'health',
  title: 'Veille sanitaire : alertes grippe et bronchiolite par région',
  items: [
    { id: 'health-alert-epidemic', label: 'Épidémie', color: levelHex('orange'), shape: 'square' },
    { id: 'health-alert-pre-post', label: 'Pré-épidémie ou post-épidémie', color: levelHex('jaune'), shape: 'square' },
    { id: 'health-alert-none', label: 'Pas d’alerte', color: levelHex('vert'), shape: 'square' },
    { id: 'health-alert-off', label: 'Hors saison', color: '#c7c7cc', shape: 'square' },
  ],
  source: { label: 'Santé publique France (Odissé)', url: 'https://odisse.santepubliquefrance.fr' },
  refresh: { label: 'Hebdomadaire, publié le mercredi' },
};

const HEALTH_URGENCES_LEGEND: LegendCategory = {
  id: 'healthOscour',
  title: 'Urgences : syndrome choisi, comparé aux 3 saisons précédentes',
  items: [
    { id: 'urg-rouge', label: 'Plus de 50\u00a0% au-dessus du maximum', color: levelHex('rouge'), shape: 'square' },
    { id: 'urg-orange', label: 'De 15 à 50\u00a0% au-dessus', color: levelHex('orange'), shape: 'square' },
    { id: 'urg-jaune', label: 'Au-dessus, de moins de 15\u00a0%', color: levelHex('jaune'), shape: 'square' },
    { id: 'urg-vert', label: 'Au plus le maximum des 3 saisons', color: levelHex('vert'), shape: 'square' },
  ],
  notes: ['Département sans couleur : moins de deux saisons de référence.'],
  source: { label: 'Santé publique France (Odissé : OSCOUR et SOS Médecins)', url: 'https://odisse.santepubliquefrance.fr' },
  refresh: { label: 'Hebdomadaire, publié le mercredi' },
};

const HEALTH_APL_LEGEND: LegendCategory = {
  id: 'healthApl',
  title: 'Accès aux soins : APL de la profession choisie',
  items: [
    { id: 'apl-rouge', label: 'Généralistes : moins de 2,5\u00a0consultations par an et par habitant', color: levelHex('rouge'), shape: 'square' },
    { id: 'apl-orange', label: 'De 2,5 à 3,5', color: levelHex('orange'), shape: 'square' },
    { id: 'apl-jaune', label: 'De 3,5 à 4', color: levelHex('jaune'), shape: 'square' },
    { id: 'apl-vert', label: '4 et plus', color: levelHex('vert'), shape: 'square' },
  ],
  notes: ['Autres professions : rapport à la moyenne nationale, rouge sous 0,5, orange sous 0,75, jaune sous 1, vert au-delà.'],
  source: {
    label: 'DREES, APL',
    url: 'https://data.drees.solidarites-sante.gouv.fr/explore/dataset/530_l-accessibilite-potentielle-localisee-apl/',
    year: 2024,
  },
  refresh: { label: 'Annuelle' },
};

const HOSPITALS_LEGEND: LegendCategory = {
  id: 'hospitals',
  title: 'Hôpitaux : sites d’urgences autorisés',
  items: [
    { id: 'hosp-chu', label: 'CHU et CHR', color: '#64d2ff', shape: 'circle' },
    { id: 'hosp-ch', label: 'Centres hospitaliers', color: '#bf5af2', shape: 'circle' },
    { id: 'hosp-private', label: 'Cliniques privées', color: '#5e5ce6', shape: 'circle' },
    { id: 'hosp-gcs', label: 'Groupements (GCS)', color: '#30b0c7', shape: 'circle' },
    { id: 'hosp-army', label: 'Hôpitaux des armées', color: '#ac8e68', shape: 'circle' },
    { id: 'hosp-other', label: 'Autres établissements', color: '#71717a', shape: 'circle' },
  ],
  notes: ['Surface du disque : passages aux urgences de l’année.'],
  source: { label: 'DREES (SAE) et FINESS', url: 'https://data.drees.solidarites-sante.gouv.fr/explore/dataset/707_bases-administratives-sae/', year: 2025 },
  refresh: { label: 'Annuelle' },
};

// ── Pannes réseau (spec 2026-10-08 panneaux pannes) : légendes de outages-legend.ts, sources appelées réellement ──
const OUTAGES_TELECOM_LEGEND: LegendCategory = telecomLegend();
const OUTAGES_INTERNET_LEGEND: LegendCategory = internetLegend();
const OUTAGES_CLOUD_LEGEND: LegendCategory = cloudLegend();

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
  },
  {
    id: 'events',
    groupId: 'news',
    role: 'child',
    // Jamais masquée par le maître du groupe Actualités : c'est la couche de base de la v2.
    dependsOnGroup: false,
    label: 'Evenements',
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
    label: 'Trafic maritime',
    legend: MARITIME_TRAFFIC_LEGEND,
  },
  {
    id: 'trafficAir',
    groupId: 'traffic',
    role: 'child',
    dependsOnGroup: true,
    label: 'Trafic aérien',
    legend: AIR_TRAFFIC_LEGEND,
  },
  {
    id: 'trafficRail',
    groupId: 'traffic',
    role: 'child',
    dependsOnGroup: true,
    label: 'Réseau ferroviaire',
    legend: RAIL_TRAFFIC_LEGEND,
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
    id: 'dromEnergy',
    groupId: 'energySystems',
    role: 'child',
    dependsOnGroup: true,
    label: 'Énergie DROM / SEI',
  },
  {
    id: 'powerGrid',
    groupId: 'energySystems',
    role: 'child',
    dependsOnGroup: true,
    label: 'Réseau électrique / Écowatt',
  },
  {
    id: 'nuclearFleet',
    groupId: 'energySystems',
    role: 'child',
    dependsOnGroup: true,
    label: 'Parc nucléaire',
  },
  {
    id: 'gasNetwork',
    groupId: 'energySystems',
    role: 'child',
    dependsOnGroup: true,
    label: 'Réseau Gaz',
  },
  {
    id: 'biomethaneSites',
    groupId: 'energySystems',
    role: 'child',
    dependsOnGroup: true,
    label: 'Sites Biométhane',
  },
  {
    id: 'hydroBackbone',
    groupId: 'energySystems',
    role: 'child',
    dependsOnGroup: true,
    label: 'Backbone hydraulique',
  },
  {
    id: 'oilNetwork',
    groupId: 'energySystems',
    role: 'child',
    dependsOnGroup: true,
    label: 'Pétrole – Réseau & stocks',
  },
  {
    id: 'windMonitor',
    groupId: 'energySystems',
    role: 'child',
    dependsOnGroup: true,
    label: 'Veille Éolienne',
  },

  {
    id: 'metroLoad',
    groupId: 'energySystems',
    role: 'child',
    dependsOnGroup: true,
    label: 'Charge métropolitaine',
  },
  // ─── Health Group ───
  {
    id: 'health',
    groupId: 'health',
    role: 'standalone',
    dependsOnGroup: false,
    label: 'Veille sanitaire',
    legend: HEALTH_ALERTS_LEGEND,
  },
  {
    id: 'healthApl',
    groupId: 'health',
    role: 'standalone',
    dependsOnGroup: false,
    label: 'Accès aux soins',
    legend: HEALTH_APL_LEGEND,
  },
  {
    id: 'healthOscour',
    groupId: 'health',
    role: 'standalone',
    dependsOnGroup: false,
    label: 'Urgences et SOS Médecins',
    legend: HEALTH_URGENCES_LEGEND,
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
    label: 'Défense',
    legend: DEFENSE_LEGEND,
  },
  {
    id: 'subseaCables',
    groupId: 'sovereignty',
    role: 'child',
    dependsOnGroup: true,
    label: 'Connectivité',
    legend: CONNECTIVITY_LEGEND,
  },
  {
    id: 'cyber',
    groupId: 'sovereignty',
    role: 'child',
    dependsOnGroup: true,
    label: 'Vigilance cyber',
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
  },
  {
    id: 'outagesTelecom',
    groupId: 'outages',
    role: 'child',
    dependsOnGroup: true,
    label: 'Télécoms mobiles',
    legend: OUTAGES_TELECOM_LEGEND,
  },
  {
    id: 'outagesInternet',
    groupId: 'outages',
    role: 'child',
    dependsOnGroup: true,
    label: 'Internet',
    legend: OUTAGES_INTERNET_LEGEND,
  },
  {
    id: 'outagesCloud',
    groupId: 'outages',
    role: 'child',
    dependsOnGroup: true,
    label: 'Cloud et hébergement',
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
    label: 'VIGILANCE MÉTÉO',
    legend: VIGILANCE_LEGEND,
  },
  {
    id: 'floods',
    groupId: 'environment',
    role: 'child',
    dependsOnGroup: true,
    label: 'CRUES',
    legend: FLOODS_LEGEND,
  },
  {
    id: 'weatherRadar',
    groupId: 'environment',
    role: 'child',
    dependsOnGroup: true,
    label: 'RADAR MÉTÉO',
    legend: RADAR_LEGEND,
  },
  // ─── Feux de forêt ───
  {
    id: 'fires',
    role: 'standalone',
    label: 'Feux de forêt',
    legend: FIRES_LEGEND,
  },
  {
    id: 'drought',
    groupId: 'environment',
    role: 'child',
    dependsOnGroup: true,
    label: 'SÉCHERESSE',
    legend: DROUGHT_LEGEND,
  },
  {
    id: 'airQuality',
    groupId: 'environment',
    role: 'child',
    dependsOnGroup: true,
    label: 'QUALITÉ DE L’AIR',
    legend: AIR_QUALITY_LEGEND,
  },
  {
    id: 'earthquakes',
    groupId: 'environment',
    role: 'child',
    dependsOnGroup: true,
    label: 'SÉISMES',
    legend: EARTHQUAKES_LEGEND,
  },
  {
    id: 'disasters',
    groupId: 'environment',
    role: 'child',
    dependsOnGroup: true,
    label: 'CATASTROPHES (GDACS)',
    legend: DISASTERS_LEGEND,
  },
  // ─── Manifestations (spec 2026-10-17) : couche autonome du thème Sécurité, panneau et relève propres ───
  {
    id: 'protests',
    role: 'standalone',
    label: 'MANIFESTATIONS',
    legend: PROTESTS_LEGEND,
  },
  // ─── Criminalité (spec 2026-10-17) : couche autonome du thème Sécurité, fichier annuel lu une fois, aucune relève ───
  {
    id: 'crime',
    role: 'standalone',
    label: 'CRIMINALITÉ',
    legend: CRIME_LEGEND,
  },
  // ─── Webcams : couche autonome rangée dans le thème Environnement, recensement statique lu une fois, aucune relève ───
  {
    id: 'webcams',
    role: 'standalone',
    label: 'WEBCAMS',
    legend: WEBCAMS_LEGEND,
  },
  // ─── Pollens (onglet Environnement, 20/10/2026) : indice pollen Atmo France par département, J à J+2 ───
  {
    id: 'pollens',
    role: 'standalone',
    label: 'POLLENS',
    legend: POLLENS_LEGEND,
  },
  // ─── Sites Seveso (onglet Environnement, 20/10/2026) : recensement Géorisques et exposition aux phénomènes en cours ───
  {
    id: 'seveso',
    role: 'standalone',
    label: 'SITES SEVESO',
    legend: SEVESO_LEGEND,
  },
  // ─── En bref (onglet Environnement, 20/10/2026) : synthèse décideur et enjeux exposés aux phénomènes en cours ───
  {
    id: 'envBrief',
    role: 'standalone',
    label: 'EN BREF · ENJEUX EXPOSÉS',
    legend: ENV_BRIEF_LEGEND,
  },
  // ─── Flux piétons : prévisions publiées par flux_osint (data/flux-pietons/), relève de 15 min couche allumée ───
  {
    id: 'pedestrianFlows',
    role: 'standalone',
    label: 'FLUX PIÉTONS',
    legend: FLUX_LEGEND,
  },

];

const FRANCE_INTEL_BRIEF_REFRESH_MS = 6 * 60 * 60 * 1000;
/** Attente maximale des événements (preuves E…) avant de demander le brief sans eux. */
const FRANCE_INTEL_BRIEF_EVENTS_WAIT_MS = 8_000;
/** v2 (?ui=v2) : relecture des événements consolidés pour la liste et la fiche France (arbitrage A11). */
const V2_EVENTS_REFRESH_MS = 5 * 60_000;
const MAX_SUMMARIZE_ITEMS_PER_CYCLE = 10;
// Résumés IA jamais pendant le démarrage (10 appels sinon) : le fil montre le texte d'origine en attendant.
const SUMMARIZE_STARTUP_DELAY_MS = 30_000;

export class App {

  private container: HTMLElement;
  private mapContainer: MapContainer | null = null;
  private mapPopup: MapPopup | null = null;
  private mapLegend: MapLegend | null = null;
  private newsPanel: UnderMapNewsFeed | null = null;
  private statusPanel: StatusPanel | null = null;
  private vigilancePanel: VigilancePanel | null = null;
  private floodsPanel: FloodsPanel | null = null;
  private energyPanel: EnergyPanel | null = null;
  private dromEnergyPanel: DromEnergyPanel | null = null;
  private hydraulicPanel: HydraulicPanel | null = null;
  private eolienPanel: EolienPanel | null = null;
  private metroLoadPanel: MetroLoadPanel | null = null;
  private currentMetropoles: MetropoleConsumption[] | null = null;
  private transportPanel: TransportPanel | null = null;
  private firesPanel: FiresPanel | null = null;
  private droughtPanel: DroughtPanel | null = null;
  private airQualityPanel: AirQualityPanel | null = null;
  private earthquakesPanel: EarthquakesPanel | null = null;
  private disastersPanel: DisastersPanel | null = null;
  private protestsPanel: ProtestsPanel | null = null;
  private currentProtests: ProtestsState | null = null;
  private protestsPanelPromise: Promise<void> | null = null;
  private crimePanel: CriminalitePanel | null = null;
  private crimePanelPromise: Promise<void> | null = null;
  private currentCrime: CrimeDataset | null = null;
  private crimeError: string | null = null;
  private webcamsPanel: WebcamsPanel | null = null;
  private envBriefPanel: EnvBriefPanel | null = null;
  private themeBriefPanel: ThemeBriefPanel | null = null;
  private pollensPanel: PollensPanel | null = null;
  private pollensPanelPromise: Promise<void> | null = null;
  private currentPollen: PollenState | null = null;
  private pollenDay: PollenDay = 'J';
  private pollenTimer: ReturnType<typeof setInterval> | null = null;
  private sevesoPanel: SevesoPanel | null = null;
  private sevesoPanelPromise: Promise<void> | null = null;
  private sevesoData: SevesoDataset | null = null;
  private sevesoError: string | null = null;
  /** Sites Seveso exposés (null : phénomènes pas encore croisés). */
  private sevesoExposed: Exposure[] | null = null;
  private themeBriefPanelPromise: Promise<void> | null = null;
  /** Dernière liste « À traiter » du poste (tous thèmes), pour l'En bref des onglets. */
  private lastQueue: WorkQueue | null = null;
  private envBriefPanelPromise: Promise<void> | null = null;
  /** Enjeux lus pour le croisement (null avant le premier allumage d'En bref) et dernier croisement calculé. */
  private exposureAssets: ExposureAssetsState | null = null;
  private currentExposure: ExposureResult | null = null;
  /** Communes INSEE (population exposée) et habitants des communes touchées par phénomène (id). */
  private communes: Commune[] | null = null;
  private currentPopulation: Map<string, HazardPopulation> | null = null;
  /** Zones inondables cartographiées par tronçon en crue orange ou rouge (id du phénomène), lues une fois par session. */
  private floodZoneRings = new Map<string, Array<Array<[number, number]>>>();
  private floodZoneLoading = new Set<string>();
  /** Habitants en zone inondable par tronçon, mémorisés pour un jeu de zones donné (clé : id + nombre de zones). */
  private floodPeople = new Map<string, { key: string; people: ZonePeople }>();
  /** Interrupteur du panneau Crues : éteint, aucune zone lue ni dessinée (bande passante). Mémorisé par navigateur. */
  private floodZonesOn = ((): boolean => {
    try { return localStorage.getItem('fm.floods.zones') !== 'off'; } catch { return true; }
  })();
  private webcamsPanelPromise: Promise<void> | null = null;
  private webcamWall: WebcamWall | null = null;
  private fluxPanel: FluxPietonsPanel | null = null;
  private fluxPanelPromise: Promise<void> | null = null;
  private fluxIndex: FluxIndex | null = null;
  private fluxError: string | null = null;
  private fluxSelectedId: string | null = null;
  private fluxPhase: FluxPhase = 'arrivee';
  /** Instant du rejeu (minutes après le début annoncé) ; null : totaux de la phase. */
  private fluxInstant: number | null = null;
  private fluxFeatures: FluxFeature[] | null = null;
  private fluxGeo: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  private fluxPoll: PausableTimer | null = null;
  private currentWebcams: WebcamsDataset | null = null;
  private webcamsError: string | null = null;
  private protestsPoll: PausableTimer | null = null;
  private weatherRadarPanel: WeatherRadarPanel | null = null;
  private maritimePanel: MaritimePanel | null = null;
  /** Environnement (spec 2026-10-04 environnement) : dernières lectures des services, partagées par les panneaux, la carte et le score. */
  private currentVigilance: VigilanceState | null = null;
  private currentFloods: FloodsState | null = null;
  private currentFires: FiresState | null = null;
  /** Dernières lectures des services de la phase B (comme currentVigilance) ; la sécheresse n'entre jamais dans le score (E2). */
  private currentDrought: DroughtState | null = null;
  /**
   * Remplissages départementaux visibles, dans l'ordre fixe de la carte (environment-map-b.ts, ENV_B_FILL_LAYERS) : la qualité de
   * l'air est toujours dessinée au-dessus de la sécheresse, quel que soit l'ordre d'activation ; le dernier masque les autres.
   */
  private fillOrder: string[] = [];
  private currentAirQuality: AirQualityState | null = null;
  private currentEarthquakes: EarthquakesState | null = null;
  private currentDisasters: DisastersState | null = null;
  private currentSeaLevels: SeaLevelsState | null = null;
  /** Échéance de la vigilance affichée (bascule Aujourd’hui / Demain du panneau), suivie par la carte. */
  private vigilanceEcheance: VigilanceEcheance = 'J';
  /** Département choisi dans le panneau Vigilance (bulletin départemental, surbrillance de la carte). */
  private selectedVigilanceDept: string | null = null;
  /** Manifeste radar Météo-France (null avant la première lecture) et message de la dernière lecture en échec. */
  private radarManifest: Radar2dResult | null = null;
  private radarError: string | null = null;
  /** Point cliqué sur la carte, couche Radar active, et son profil vertical (démonstration). */
  private radarProfile: RadarProfileState | null = null;
  /** Incidents DBSCAN sur ces détections, géo-résolus : situations WILDFIRE_ESCALATION et onglet « Dossier d'un feu ». */
  private currentFireIncidents: import('./types/index.ts').LocatedFireIncident[] = [];
  private mtgFrpEnabled = false;
  private latestMtgFrpMetadata: MtgFrpMetadata | null = null;
  private mtgFrpRequestInFlight = false;
  /** MTG-FRP (démonstration) : état dérivé de la dernière lecture, jamais « actif » codé. */
  private mtgFrpFeed: FireObservationFeedState = { status: 'loading', observedAt: null, fetchedAt: null, source: 'EUMETSAT LSA SAF' };
  /** Option « Sommets d'écho » : un seul état, partagé par les panneaux Radar météo et Feux de forêt. */
  private echoTopsEnabled = false;
  /** Imagerie satellite GIBS et remplissage par la météo des forêts : options de la carte du panneau Feux. */
  private gibsEnabled = false;
  private forestDangerFill = false;
  private trafficPanel: TrafficPanel | null = null;
  private airTrafficPanel: AirTrafficPanel | null = null;
  private financialStrip: FinancialStabilityStrip | null = null;
  /** Bloc « Stabilité financière » (spec 2026-10-12) : BCE + écart OAT-Bund, dernier relevé gardé en cas de panne. */
  private currentFinancialStability: FinancialStabilitySlot | null = null;
  /** Notes de situation archivées par la VM (/api/situation-notes) ; undefined : pas encore lues. */
  private archivedNotes: ArchivedNoteSummary[] | undefined = undefined;
  /** Événements sociaux et de sécurité distincts sur 24 h (/api/news/event-pressure) : situations SOCIAL_MOBILISATION et SECURITY_UNREST. */
  private currentEventPressure: EventPressureResponse | null = null;
  private commodityStrip: CommodityStrip | null = null;
  private _intervalCommodities: ReturnType<typeof setInterval> | null = null;
  private isnrPanel: ISNRPanel | null = null;
  /** v2 : « Pression par département » à la place de l'ISNRPanel (12/10/2026) ; données calculées avec le fil du poste. */
  private pressurePanel: PressurePanel | null = null;
  private v2Pressure: DepartmentPressure[] | null = null;
  /**
   * Vue générale dynamique (12/10/2026) : couches allumées automatiquement parce qu'elles sont en jaune ou plus (éteintes à leur
   * retour au vert ; une couche touchée à la main en sort), puces dans l'ordre des niveaux, dernier niveau connu de chaque couche
   * suivie et journal des passages de niveau de la session.
   */
  private generalAuto = new Set<keyof MapLayers>();
  private watchEntries: WatchEntry[] = [];
  /** Niveau de chaque couche suivie (pastilles), calculé quel que soit l'onglet : voyants de l'onglet Environnement (20/10/2026). */
  private watchLevelMap: ReadonlyMap<keyof MapLayers, WatchLevel> = new Map();
  private watchLastKnown = new Map<keyof MapLayers, VigilanceLevel>();
  private watchLog: WatchTransition[] = [];
  /** Module de surveillance chargé à la demande : il importe les vues des panneaux suivis, hors du chunk principal. */
  private watchModule: typeof import('./components/layer-panel/watch.ts') | null = null;
  private watchModulePromise: Promise<void> | null = null;
  private generalWatchPollingStarted = false;
  private cyberPanel: CyberPanel | null = null;
  private franceIntelPanel: FranceIntelPanel | null = null;
  private situationMonitor: SituationMonitor | null = null;
  private situationBrief: SituationBrief | null = null;
  /** Pannes en cours (bandeau hors de l'onglet Pannes, control room dedans), chargé à la demande. */
  private outagesNow: OutagesNowController<PausableTimer> | null = null;
  private situationHistoryPanel: SituationHistoryPanel | null = null;
  private alertMonitor: AlertMonitor | null = null;
  private updateNotification: UpdateNotification | null = null;
  private currentVersionKey: string | null = null;
  private hasUpdate = false;
  private franceIntelBriefRequestId = 0;
  private franceIntelBriefRefreshTimer: ReturnType<typeof setInterval> | null = null;
  /** Couleur nationale du dernier brief demandé : un changement de couleur redemande le brief. */
  private franceIntelBriefMark: BriefLevelMark | null = null;
  /** Revérifie à l'échéance de stabilisation (BRIEF_LEVEL_SETTLE_MS) avec un instantané frais ; un seul à la fois. */
  private franceIntelBriefSettleTimer: ReturnType<typeof setTimeout> | null = null;
  // ── Disposition A1, interface par défaut (refonte UI, étape 3) ──────────────
  /** Interface « poste de situation » (v2) par défaut ; ?ui=v1 redonne l'ancienne interface. */
  private readonly uiV2 = isUiV2(window.location.search);
  private poste: PosteSituation | null = null;
  private postePromise: Promise<PosteSituation> | null = null;
  /** Conteneurs de la v2, créés par renderShell(). */
  private v2Roots: { status: HTMLElement; themes: HTMLElement; list: HTMLElement; fiche: HTMLElement; tabs: HTMLElement } | null = null;
  /** Brief, événements et ligne de base lancés pour la fiche France (équivalent v2 du tiroir ouvert). */
  private v2IntelStarted = false;
  /** Page ouverte par l'enregistreur de la note sur la VM (?recorder=1) : relevé remis à la page, aucune note de synthèse demandée. */
  private readonly recorderPage = isRecorderPage(window.location.search);
  /** Thème choisi dans la v2 : filtre les points d'événements (spec 2026-09-29 § 5). */
  private v2Theme: ThemeId = 'general';
  /** Niveaux masqués depuis la légende (clic sur une ligne de niveau, spec 2026-10-14). */
  private v2HiddenLevels = new Set<VigilanceLevel>();
  /** États de l'énergie masqués depuis la légende (spec 2026-10-15). */
  private energyHiddenStates = new Set<EnergyState>();
  private v2EventsState: IntelEventsState | null = null;
  private mapPreview: MapPreviewCard | null = null;
  /** Événement dont l'aperçu attend son détail : un détail arrivé pour un autre point est ignoré. */
  private previewEventId: number | null = null;
  /** Ligne de base de visite figée par startV2Intel ; null avant (aucun enregistrement possible). */
  private v2BaselineSession: VisitBaselineSession | null = null;
  private v2EventsTimer: ReturnType<typeof setInterval> | null = null;
  /** Matières premières en cache : mouvements exceptionnels de l'énergie dans la liste (spec §4.4). */
  private currentCommodityData: CommodityData[] = [];

  private gasPanel: GasPanel | null = null;
  private currentGasData: import('./types').GasNetworkState | null = null;
  private currentDromEnergyDashboard: DromEnergyDashboard | null = null;
  private currentDromLive: DromLiveResponse | null = null;
  private currentDromLiveError: string | null = null;
  private currentDromEnergyError: string | null = null;
  private oilPanel: OilPanel | null = null;
  private currentOilData: OilDashboard | null = null;
  private oilReadWithJodi = false;
  private currentFuelTensionData: FuelTensionDashboard | null = null;
  private currentNuclearState: NuclearState | null = null;
  /** Événements de sûreté ASNR (spec 2026-10-13) ; null avant la première lecture. */
  private currentAsnr: SourceSlot<AsnrResponse> | null = null;
  private nuclearPanel: NuclearPanel | null = null;
  /** Pannes réseau (spec 2026-10-08 panneaux pannes) : dernières lectures des services, partagées par les panneaux, la carte et le score. */
  private currentOutTelecom: TelecomState | null = null;
  private currentOutPower: PowerState | null = null;
  private currentOutInternet: InternetState | null = null;
  private currentOutCloud: CloudState | null = null;
  private outagesTelecomPanel: OutagesTelecomPanel | null = null;
  private outagesPowerPanel: OutagesPowerPanel | null = null;
  private outagesInternetPanel: OutagesInternetPanel | null = null;
  private outagesCloudPanel: OutagesCloudPanel | null = null;
  private outagesPanelPromises: Partial<Record<OutagesLayerKey, Promise<void>>> = {};
  private defensePanel: DefensePanel | null = null;
  private connectivityPanel: ConnectivityPanel | null = null;
  /** Souveraineté (spec 2026-10-04 souveraineté) : dernières lectures des services, partagées par les panneaux, la carte et le score (A16). */
  private currentMilitary: MilitaryState | null = null;
  private currentCables: CablesState | null = null;
  private currentSovCyber: SovCyberState | null = null;
  /** Relecture quotidienne de la page Vigipirate du SGDSN par le serveur (O14), lue avec la Défense. */
  private currentVigipirate: VigipirateCheckState | null = null;
  /** Sites du panneau Défense : liste interne (lue avant le panneau) et ouvrages OpenStreetMap (option lue à la première demande). */
  private defenseSites: DefenseSitesSummary = NO_DEFENSE_SITES;
  private currentAisAnomalies: AisAnomaly[] = [];
  /** Alertes presse issues des événements corroborés, réévaluées à chaque rafraîchissement (spec 2026-09-28 § 4.7). */
  private readonly pressAlertSource = new PressAlertSource();
  private currentMaritimeTrafficFranceCount = 0;
  private veillePanel: VeilleSanitairePanel | null = null;
  private urgencesPanel: UrgencesPanel | null = null;
  private accesSoinsPanel: AccesSoinsPanel | null = null;
  private hopitauxPanel: HopitauxPanel | null = null;
  private sentinelModal: SentinelModal | null = null;
  private rightSidebar: RightSidebar | null = null;
  private sentinelModalPromise: Promise<SentinelModal> | null = null;
  private rightSidebarPromise: Promise<RightSidebar> | null = null;
  private currentHealth: HealthSurveillanceState | null = null;
  private currentHealthOffer: HealthOfferState | null = null;
  /** Niveau national de santé (fiche thème Santé de la v2, spec 2026-10-03 § 3.5), recalculé à chaque relève et à chaque rendu. */
  private currentHealthNational: NationalHealthSummary | null = null;
  /** Calcul du niveau national (vue Veille, chargée à la demande), gardé après le premier chargement de la veille sanitaire. */
  private healthNationalOf: ((state: HealthSurveillanceState, now: number) => NationalHealthSummary) | null = null;
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
  private isSummarizationRunning = false;
  private currentISNRData: ISNRData | null = null;
  private _aisZeroWarnLogged = false; // Avoid spamming "0 ships" warning
  private _aisLoaderEl: HTMLElement | null = null; // Loader overlay while AIS connects
  private _showAisLoaderFn: (() => void) | null = null; // Ref so onLayerToggle can trigger it
  private currentEcowattResponse: EcowattResponse | null = null;
  private currentBiogasState: BiogasState | null = null;
  private currentBiomethaneSites: BiomethaneSite[] | null = null;
  private currentHydraulicAssets: HydraulicBackboneAsset[] = [];
  private currentHydraulicHydrometry: HydraulicHydrometrySnapshot | null = null;
  private currentEolienLive: EolienLive | null = null;
  /** Dernier résultat du baromètre des infrastructures (section Infrastructures de l'onglet État v2). */
  private currentNetworkBarometer: NetworkBarometerResult | null = null;
  private currentEolienParks: EolienParkSummary[] = [];
  private readonly eolienTracker = new EolienTracker();


  /** Trafics (spec 2026-10-03 trafics) : dernières lectures des quatre services, partagées par les panneaux, la carte, le score et la note. */
  private currentRoadTraffic: RoadTrafficState | null = null;
  private currentAirOverview: AirOverviewState | null = null;
  private currentRailTraffic: RailTrafficState | null = null;
  private currentMaritimeSnapshot: MaritimeState | null = null;
  /** Positions de la carte : dernière lecture réussie (heure des états OpenSky, incidents) et dernier échec, pour leur ligne datée. */
  private airPositions: { read: { at: number | null; errors: string[] } | null; failure: string | null } = { read: null, failure: null };
  private legacyTomTomCleared = false;
  /** Menu d'export CSV / GeoJSON, instancié à la demande au premier clic. */
  private exportMenu: ExportMenu | null = null;
  private franceIntelPanelPromise: Promise<FranceIntelPanel> | null = null;
  // Perf audit top-10 item 5 / task 5: these 13 panels used to be
  // dynamically imported unconditionally inside renderShell(), so every
  // session downloaded all 13 chunks regardless of which layers were ever
  // toggled. Each is now lazy-loaded on first activation via the matching
  // ensureXPanel() below (memoized, same pattern as ensureFranceIntelPanel()),
  // dispatched from onLayerToggle()/restoreActiveLayerPanelsAfterRefresh()
  // through ensureLazyPanelForLayer().
  private dromEnergyPanelPromise: Promise<void> | null = null;
  private hydraulicPanelPromise: Promise<void> | null = null;
  private eolienPanelPromise: Promise<void> | null = null;
  private metroLoadPanelPromise: Promise<void> | null = null;
  private veillePanelPromise: Promise<void> | null = null;
  private urgencesPanelPromise: Promise<void> | null = null;
  private accesSoinsPanelPromise: Promise<void> | null = null;
  private hopitauxPanelPromise: Promise<void> | null = null;
  private vigilancePanelPromise: Promise<void> | null = null;
  private floodsPanelPromise: Promise<void> | null = null;
  private firesPanelPromise: Promise<void> | null = null;
  private droughtPanelPromise: Promise<void> | null = null;
  private airQualityPanelPromise: Promise<void> | null = null;
  private earthquakesPanelPromise: Promise<void> | null = null;
  private disastersPanelPromise: Promise<void> | null = null;
  private weatherRadarPanelPromise: Promise<void> | null = null;
  private trafficPanelPromise: Promise<void> | null = null;
  private maritimePanelPromise: Promise<void> | null = null;
  private airTrafficPanelPromise: Promise<void> | null = null;
  private transportPanelPromise: Promise<void> | null = null;
  private cyberPanelPromise: Promise<void> | null = null;
  private oilPanelPromise: Promise<void> | null = null;
  private nuclearPanelPromise: Promise<void> | null = null;
  private defensePanelPromise: Promise<void> | null = null;
  private connectivityPanelPromise: Promise<void> | null = null;
  private defenseSitesPromise: Promise<void> | null = null;
  private hasRestoredActiveLayerPanels = false;
  private activeLayers: MapLayers = { ...DEFAULT_LAYERS };
  // ── Single floating panel (audit UI 2026-09 §5.3 point 3) ────────────────
  /** Dernier panneau flottant ouvert explicitement via showFloatingPanel() —
   *  repli pour la puce active du sélecteur sur les panneaux sans isVisible(). */
  private currentFloatingPanelId: keyof MapLayers | null = null;
  private floatingPanelSwitcherEl: HTMLElement | null = null;
  /** true seulement pendant l'application du preset d'accueil (premier
   *  chargement OU état persisté "tout éteint") — voir init() et
   *  restoreActiveLayerPanelsAfterRefresh(). */
  private suppressFirstLoadPanelAutoOpen = false;

  private _intervalRSS: ReturnType<typeof setInterval> | null = null;
  private _intervalShips: PausableTimer | null = null;
  private _intervalFinance: ReturnType<typeof setInterval> | null = null;
  private _intervalNuclear: ReturnType<typeof setInterval> | null = null;
  private _intervalOil: ReturnType<typeof setInterval> | null = null;
  private _intervalAirTraffic: PausableTimer | null = null;
  private _intervalEco2mix: PausableTimer | null = null;
  private _intervalHealth: PausableTimer | null = null;
  private _intervalHydraulic: ReturnType<typeof setInterval> | null = null;
  private _intervalMtgFrp: ReturnType<typeof setInterval> | null = null;
  private _intervalEolien: ReturnType<typeof setInterval> | null = null;
  private _intervalDromLive: ReturnType<typeof setInterval> | null = null;
  /** Relèves des panneaux Trafics, présentes tant que la couche est active ou le panneau ouvert (syncTrafficPolling). */
  private trafficPolls: Partial<Record<TrafficLayerKey, PausableTimer>> = {};
  /** Relèves des panneaux Environnement : sans arrêt pour la vigilance, les crues et les feux (score), sinon couche active ou panneau ouvert. */
  private environmentPolls: Partial<Record<EnvironmentLayerKey, PausableTimer>> = {};
  /** Relèves des couches Souveraineté : sans arrêt pour les trois (score, SOVEREIGNTY_ALWAYS_POLLED). */
  private sovereigntyPolls: Partial<Record<SovereigntyLayerKey, PausableTimer>> = {};
  /** Relèves des couches Pannes réseau : Télécoms sans arrêt (score, OUTAGES_ALWAYS_POLLED), Électricité couche active ou panneau ouvert. */
  private outagesPolls: Partial<Record<OutagesLayerKey, PausableTimer>> = {};
  private _intervalClock: PausableTimer | null = null;
  private networkBarometerWidget: BarometerWidget | null = null;
  private _intervalNetworkBarometer: ReturnType<typeof setInterval> | null = null;
  private _intervalSpaceWeatherRefresh: ReturnType<typeof setInterval> | null = null;
  private _intervalVersion: PausableTimer | null = null;
  // Timers agressifs suspendus quand l'onglet est caché (visibilitychange)
  private pausableTimers: PausableTimer[] = [];
  private visibilityHandlerInstalled = false;
  // Listeners globaux (document/window) à retirer dans destroy()
  private globalListeners: Array<{
    target: EventTarget;
    type: string;
    handler: EventListener;
    options?: AddEventListenerOptions | boolean;
  }> = [];
  private aboutTriggerEl: HTMLButtonElement | null = null;
  private headerLiveDotEl: HTMLElement | null = null;
  private mapLoadingTextEl: HTMLElement | null = null;
  private bottomLinksEl: HTMLElement | null = null;
  private underMapLabelEl: HTMLElement | null = null;
  private underMapExpanded = false;
  private underMapScrollLockUntil = 0;
  /** v2 : relance la mise en page des puces de panneaux quand la zone carte change de taille. */
  private floatingSwitcherObserver: ResizeObserver | null = null;

  public destroy(): void {
    this.floatingSwitcherObserver?.disconnect();
    this.floatingSwitcherObserver = null;
    if (this._intervalRSS !== null) { clearInterval(this._intervalRSS); this._intervalRSS = null; }
    this.removePausableInterval(this._intervalShips); this._intervalShips = null;
    if (this._intervalFinance !== null) { clearInterval(this._intervalFinance); this._intervalFinance = null; }
    if (this._intervalNuclear !== null) { clearInterval(this._intervalNuclear); this._intervalNuclear = null; }
    if (this._intervalOil !== null) { clearInterval(this._intervalOil); this._intervalOil = null; }
    if (this._intervalCommodities !== null) { clearInterval(this._intervalCommodities); this._intervalCommodities = null; }
    this.removePausableInterval(this._intervalAirTraffic); this._intervalAirTraffic = null;
    this.removePausableInterval(this._intervalEco2mix); this._intervalEco2mix = null;
    this.removePausableInterval(this._intervalHealth); this._intervalHealth = null;
    if (this._intervalHydraulic !== null) { clearInterval(this._intervalHydraulic); this._intervalHydraulic = null; }
    if (this._intervalMtgFrp !== null) { clearInterval(this._intervalMtgFrp); this._intervalMtgFrp = null; }
    if (this._intervalEolien !== null) { clearInterval(this._intervalEolien); this._intervalEolien = null; }
    if (this._intervalDromLive !== null) { clearInterval(this._intervalDromLive); this._intervalDromLive = null; }
    for (const key of TRAFFIC_LAYER_KEYS) this.removePausableInterval(this.trafficPolls[key] ?? null);
    this.trafficPolls = {};
    for (const key of ENVIRONMENT_LAYER_KEYS) this.removePausableInterval(this.environmentPolls[key] ?? null);
    this.environmentPolls = {};
    for (const key of SOVEREIGNTY_LAYER_KEYS) this.removePausableInterval(this.sovereigntyPolls[key] ?? null);
    this.sovereigntyPolls = {};
    for (const key of OUTAGES_LAYER_KEYS) this.removePausableInterval(this.outagesPolls[key] ?? null);
    this.outagesPolls = {};
    this.removePausableInterval(this.protestsPoll);
    this.protestsPoll = null;
    this.removePausableInterval(this.fluxPoll);
    this.fluxPoll = null;
    this.removePausableInterval(this._intervalClock); this._intervalClock = null;
    if (this._intervalNetworkBarometer !== null) {
      clearInterval(this._intervalNetworkBarometer);
      this._intervalNetworkBarometer = null;
    }
    if (this._intervalSpaceWeatherRefresh !== null) {
      clearInterval(this._intervalSpaceWeatherRefresh);
      this._intervalSpaceWeatherRefresh = null;
    }
    this.removePausableInterval(this._intervalVersion);
    this._intervalVersion = null;
    this.clearFranceIntelBriefRefresh();
    this.clearFranceIntelBriefSettleTimer();
    if (this.v2EventsTimer !== null) { clearInterval(this.v2EventsTimer); this.v2EventsTimer = null; }
    this.clearPausableIntervals();
    this.removeGlobalListeners();
    this.visibilityHandlerInstalled = false;
    this.updateNotification?.destroy();
    this.updateNotification = null;
    this.networkBarometerWidget?.destroy();
    this.networkBarometerWidget = null;
  }

  // ─── Background tab suspension & global listener bookkeeping ───────────────

  /** addEventListener sur document/window avec retrait automatique dans destroy(). */
  private addGlobalListener(
    target: EventTarget,
    type: string,
    handler: EventListener,
    options?: AddEventListenerOptions | boolean,
  ): void {
    target.addEventListener(type, handler, options);
    this.globalListeners.push({ target, type, handler, options });
  }

  private removeGlobalListeners(): void {
    for (const { target, type, handler, options } of this.globalListeners) {
      target.removeEventListener(type, handler, options);
    }
    this.globalListeners = [];
  }

  /**
   * setInterval qui se met en pause quand l'onglet est caché et reprend
   * (avec un tick immédiat) quand il redevient visible. Réservé aux pollings
   * agressifs (< 1 min) : vols militaires, AIS, trafic aérien, horloge,
   * terminateur, check version ; à la relève éCO2mix et à la relève santé, dont la donnée doit être
   * fraîche dès le retour sur l'onglet.
   */
  private registerPausableInterval(fn: () => void, ms: number): PausableTimer {
    this.ensureVisibilityHandler();
    const timer: PausableTimer = { fn, ms, id: null };
    if (!document.hidden) {
      timer.id = setInterval(fn, ms);
    }
    this.pausableTimers.push(timer);
    return timer;
  }

  private removePausableInterval(timer: PausableTimer | null): void {
    if (!timer) return;
    if (timer.id !== null) {
      clearInterval(timer.id);
      timer.id = null;
    }
    const index = this.pausableTimers.indexOf(timer);
    if (index !== -1) this.pausableTimers.splice(index, 1);
  }

  private clearPausableIntervals(): void {
    for (const timer of this.pausableTimers) {
      if (timer.id !== null) {
        clearInterval(timer.id);
        timer.id = null;
      }
    }
    this.pausableTimers = [];
  }

  private ensureVisibilityHandler(): void {
    if (this.visibilityHandlerInstalled) return;
    this.visibilityHandlerInstalled = true;
    this.addGlobalListener(document, 'visibilitychange', () => {
      if (document.hidden) {
        for (const timer of this.pausableTimers) {
          if (timer.id !== null) {
            clearInterval(timer.id);
            timer.id = null;
          }
        }
      } else {
        for (const timer of this.pausableTimers) {
          if (timer.id === null) {
            timer.fn(); // refresh immédiat au retour au premier plan
            timer.id = setInterval(timer.fn, timer.ms);
          }
        }
      }
    });
  }

  private isPanelVisible(element: HTMLElement | null): boolean {
    if (!element) return false;
    // Layer panels use CSS class `.lp.is-open`; other panels use inline display.
    return element.classList.contains('lp') ? isLayerPanelOpen(element) : element.style.display !== 'none';
  }

  private layoutEnergyFloatingPanels(): void {
    requestAnimationFrame(() => {
      const panels = [
        this.container.querySelector<HTMLElement>('.drom-energy-panel-modal'),
        this.container.querySelector<HTMLElement>('.energy-panel-modal'),
        this.container.querySelector<HTMLElement>('.hydraulic-panel-modal'),
        this.container.querySelector<HTMLElement>('.eolien-panel-modal'),
        this.container.querySelector<HTMLElement>('.metro-load-panel-modal'),
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
    this.refreshEventPoints();
  }

  private refreshTrafficLegend(): void {
    if (!this.mapLegend) return;

    this.mapLegend.setCategoryVisibility('trafficRoad', this.activeLayers.traffic && this.activeLayers.trafficRoad);
    this.mapLegend.setCategoryVisibility('trafficMaritime', this.activeLayers.traffic && this.activeLayers.trafficMaritime);
    this.mapLegend.setCategoryVisibility('trafficAir', this.activeLayers.traffic && this.activeLayers.trafficAir);
    this.mapLegend.setCategoryVisibility('trafficRail', this.activeLayers.traffic && this.activeLayers.trafficRail);
  }

  constructor(container: HTMLElement) {
    this.container = container;
    onLanguageChange(() => {
      this.updateShellTranslations();
      this.newsPanel?.refreshTranslations();
      this.statusPanel?.refreshTranslations();
      this.refreshFranceIntelPanel();
      // v2 : la fiche France suit la bascule FR/EN de l'en-tête ; le brief est redemandé dans la langue.
      if (this.uiV2 && this.v2IntelStarted) {
        const lang = this.intelLang();
        this.requestFranceIntelBrief(this.buildFranceSnapshot(lang), lang, { showLoading: false });
      }
    });
  }

  private bindLanguageToggle(root: ParentNode): void {
    root.querySelectorAll<HTMLButtonElement>('[data-language-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const nextLanguage = button.dataset.languageToggle;
        if (nextLanguage === 'fr' || nextLanguage === 'en') {
          void setLanguage(nextLanguage);
        }
      });
    });
  }

  /**
   * Bascule tablette (769–1180 px) de la sidebar (audit UI 2026-09 §5.3
   * point 5) — le bouton n'est visible que dans cette plage via CSS
   * (.header-sidebar-toggle, main.css). Pose/retire `sidebar-collapsed` sur
   * la racine #app (this.container ; la règle `#app.sidebar-collapsed
   * .sidebar` existe déjà dans main.css), état persisté dans localStorage,
   * et déclenche un resize après la transition CSS de la sidebar. Ni
   * MapContainer ni DeckGLMap n'exposent de resize()/invalidateSize() — la
   * carte MapLibre observe déjà son conteneur via son ResizeObserver interne
   * (`trackResize`, activé par défaut), donc l'événement `resize` générique
   * suffit à la faire se remesurer, et rafraîchit au passage
   * syncCompactMode() (bascule des presets régions en `<select>`).
   */
  private bindSidebarToggle(header: HTMLElement): void {
    const toggle = header.querySelector<HTMLButtonElement>('[data-sidebar-toggle]');
    if (!toggle) return;

    // v2 : la barre des couches est toujours repliée à l'ouverture, la carte garde toute la place (décision du 12/10/2026,
    // revient sur la mémorisation de l'arbitrage A6) ; v1 : état mémorisé.
    const storageKey = 'fm-sidebar-collapsed';
    let collapsed = this.uiV2;
    if (!this.uiV2) {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored !== null) collapsed = stored === 'true';
      } catch {
        collapsed = false;
      }
    }

    const apply = (next: boolean, persist: boolean): void => {
      collapsed = next;
      this.container.classList.toggle('sidebar-collapsed', collapsed);
      // v2 : le tiroir ouvert décale les puces des panneaux (main.css) ; l'étiquette du baromètre suit.
      this.layoutFloatingPanelSwitcher();
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-label', collapsed ? t('app.sidebarExpandAria') : t('app.sidebarCollapseAria'));
      if (!persist || this.uiV2) return;
      try {
        localStorage.setItem(storageKey, String(collapsed));
      } catch {
        // Quota dépassé / navigation privée : pas bloquant, juste pas persisté.
      }
    };

    apply(collapsed, false);

    toggle.addEventListener('click', () => {
      apply(!collapsed, true);
      const sidebarEl = this.container.querySelector<HTMLElement>('.sidebar');
      if (!sidebarEl) {
        window.dispatchEvent(new Event('resize'));
        return;
      }
      const onTransitionEnd = (event: TransitionEvent): void => {
        if (event.propertyName !== 'width') return;
        sidebarEl.removeEventListener('transitionend', onTransitionEnd);
        window.dispatchEvent(new Event('resize'));
      };
      sidebarEl.addEventListener('transitionend', onTransitionEnd);
    });
  }

  private updateShellTranslations(): void {
    const language = getCurrentLanguage();
    this.aboutTriggerEl?.setAttribute('aria-label', t('app.aboutAria'));
    this.headerLiveDotEl?.setAttribute('title', t('app.live'));
    if (this.mapLoadingTextEl) this.mapLoadingTextEl.textContent = t('app.loadingMap');
    this.bottomLinksEl?.setAttribute('aria-label', t('app.infoPagesAria'));
    if (this.bottomLinksEl) {
      const links = this.bottomLinksEl.querySelectorAll<HTMLAnchorElement>('a');
      if (links[0]) links[0].textContent = t('app.bottomLinks.about');
      if (links[1]) links[1].textContent = t('app.bottomLinks.methodology');
      if (links[2]) links[2].textContent = t('app.bottomLinks.documentation');
      if (links[3]) links[3].textContent = t('app.bottomLinks.legal');
      if (links[4]) links[4].textContent = t('app.bottomLinks.contact');
    }
    if (this.underMapLabelEl) {
      this.underMapLabelEl.textContent = this.underMapExpanded ? t('app.backToMap') : t('app.openModules');
    }
    this.container.querySelectorAll<HTMLElement>('.header-language-toggle').forEach((toggle) => {
      toggle.setAttribute('aria-label', t('app.languageSwitcher'));
    });
    const dashboardHeadingEl = this.container.querySelector<HTMLElement>('h1.visually-hidden');
    if (dashboardHeadingEl) dashboardHeadingEl.textContent = t('app.dashboardHeading');
    this.container.querySelector<HTMLButtonElement>('[data-overflow-trigger]')?.setAttribute('aria-label', t('app.moreActionsAria'));
    this.floatingPanelSwitcherEl?.setAttribute('aria-label', t('app.floatingPanelSwitcherAria'));
    const layersLabel = this.container.querySelector<HTMLElement>('.header-sidebar-toggle__label');
    if (layersLabel) layersLabel.textContent = language === 'fr' ? 'Couches' : 'Layers';
    const sidebarToggle = this.container.querySelector<HTMLButtonElement>('[data-sidebar-toggle]');
    if (sidebarToggle) {
      const isCollapsed = this.container.classList.contains('sidebar-collapsed');
      sidebarToggle.setAttribute('aria-label', isCollapsed ? t('app.sidebarExpandAria') : t('app.sidebarCollapseAria'));
    }
    const aboutModal = this.container.querySelector('.about-modal');
    if (aboutModal) {
      aboutModal.querySelector<HTMLButtonElement>('.about-modal__close')?.setAttribute('aria-label', t('app.closeAbout'));
      const subtitle = aboutModal.querySelector<HTMLElement>('.about-modal__subtitle');
      if (subtitle) subtitle.textContent = t('app.aboutSubtitle');
      const body = aboutModal.querySelector<HTMLElement>('.about-modal__text');
      if (body) body.textContent = t('app.aboutBody');
      const chips = aboutModal.querySelectorAll<HTMLAnchorElement>('.about-modal__links:first-of-type .about-modal__chip');
      if (chips[0]) chips[0].textContent = t('app.aboutLinks.about');
      if (chips[1]) chips[1].textContent = t('app.aboutLinks.methodology');
      if (chips[2]) chips[2].textContent = t('app.aboutLinks.documentation');
      if (chips[3]) chips[3].textContent = t('app.aboutLinks.contact');
      if (chips[4]) chips[4].textContent = t('app.aboutLinks.legal');
      const externalLinks = aboutModal.querySelectorAll<HTMLAnchorElement>('.about-modal__links:nth-of-type(2) .about-modal__chip');
      externalLinks[0]?.setAttribute('aria-label', t('app.githubAria'));
      externalLinks[1]?.setAttribute('aria-label', t('app.linkedinAria'));
      const legalLines = aboutModal.querySelectorAll<HTMLElement>('.about-modal__legal div');
      if (legalLines[0]) legalLines[0].textContent = t('app.copyright');
      if (legalLines[1]) legalLines[1].textContent = t('app.independentProject');
    }
    this.container.querySelectorAll<HTMLButtonElement>('[data-language-toggle]').forEach((button) => {
      const active = button.dataset.languageToggle === language;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  private syncRightSidebarTriggers(isOpen: boolean): void {
    const mobileToggle = this.rightSidebarMobileToggleEl;
    if (!mobileToggle) return;
    mobileToggle.setAttribute('aria-label', isOpen ? 'Fermer le panneau latéral' : 'Ouvrir le panneau latéral');
    mobileToggle.innerHTML = isOpen ? fmIcon('x') : fmIcon('menu');
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
        this.clearFranceIntelBriefSettleTimer();
      });
      panel.mount();
      this.franceIntelPanel = panel;
      return panel;
    });

    return this.franceIntelPanelPromise;
  }

  private readStoredActiveLayers(): Partial<MapLayers> | null {
    try {
      const raw = layerStateStorage(this.uiV2, window)?.getItem(ACTIVE_LAYERS_STORAGE_KEY);
      if (!raw) return null;
      const stored = JSON.parse(raw) as Record<string, unknown>;
      if (!stored || typeof stored !== 'object') return null;
      // Vigilance météo et Crues séparées, Jour / Nuit retiré (spec 2026-10-04 environnement § 2.2, § 2.5 ; amendement 9).
      const parsed = migrateStoredLayers(stored);

      const allowedKeys = new Set(Object.keys(DEFAULT_LAYERS));
      const layers: Partial<MapLayers> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (allowedKeys.has(key) && typeof value === 'boolean') {
          (layers as Record<string, boolean>)[key] = value;
        }
      }
      return Object.keys(layers).length > 0 ? layers : null;
    } catch {
      return null;
    }
  }

  private normalizeLayerState(layers: MapLayers): MapLayers {
    const normalized = { ...layers };
    normalized.newsGroup = normalized.news || normalized.stability || normalized.events;
    if (normalized.traffic && !normalized.trafficRoad && !normalized.trafficMaritime && !normalized.trafficAir && !normalized.trafficRail) {
      normalized.trafficRoad = true;
    }
    normalized.traffic = normalized.trafficRoad || normalized.trafficMaritime || normalized.trafficAir || (normalized.trafficRail ?? false);
    normalized.energySystems = hasActiveEnergySystems(normalized);
    normalized.environmentGroup = hasActiveEnvironment(normalized);
    normalized.sovereignty = hasActiveSovereignty(normalized);
    normalized.outages = hasActiveOutages(normalized) || normalized.outages;
    return normalized;
  }

  async init(): Promise<void> {
    // ── Phase 0: Layer state ─────────────────────────────────────────────────
    // All layers start OFF by default. URL params win; localStorage restores Ctrl+R.
    const urlState = readUrlState();
    const persistedLayers = urlState.layers ?? this.readStoredActiveLayers();
    // A-t-on au moins UNE couche enfant persistée active ? Un état "tout
    // éteint" (ex. localStorage écrit par une session précédente qui a tout
    // désactivé) est traité comme un premier chargement — sinon la carte est
    // vide (audit UI 2026-09 §5.1/§5.3 point 1).
    // v2 : l'application s'ouvre toujours sur la Vue générale ; les couches gardées d'un autre onglet (Sécurité, Énergie…) n'y
    // reviennent pas (19/10/2026) : départ sur la Vue générale, que sa surveillance complète (orange ou rouge).
    const hasPersistedChildActive = !this.uiV2 && hasPersistedLayers(persistedLayers);
    if (hasPersistedChildActive) {
      this.activeLayers = this.normalizeLayerState({ ...DEFAULT_LAYERS, ...persistedLayers });
      // v1 : les panneaux des couches persistées se rouvrent (comportement historique) ; v2
      // (relecture finale I1) : les couches restent actives sans ouvrir de panneau sur la fiche.
      this.suppressFirstLoadPanelAutoOpen = !reopensLayerPanelsOnLoad(this.uiV2);
    } else {
      // Premier chargement OU état persisté "tout éteint" → preset d'accueil
      // nommé (mode simple, §5.3 point 1/2) pour ne pas présenter une carte
      // vide. Même chemin (normalizeLayerState) que la restauration : les
      // groupes parents sont recalculés automatiquement. Contrairement à un
      // retour d'utilisateur avec de vraies couches persistées, ce chemin ne
      // doit ouvrir AUCUN panneau flottant d'office (restoreActiveLayerPanelsAfterRefresh
      // lit ce flag) — seul un clic explicite ouvre un panneau.
      this.activeLayers = this.normalizeLayerState({ ...DEFAULT_LAYERS, ...(this.uiV2 ? v2StartupLayers() : layersForPreset(DEFAULT_PRESET_ID)) });
      this.suppressFirstLoadPanelAutoOpen = true;
    }

    this.renderShell();
    if (this.uiV2) {
      void this.ensurePoste().catch((err) => {
        console.error('[App] Poste de situation indisponible', err);
        if (this.v2Roots) this.v2Roots.list.innerHTML = '<p class="wl-empty">Interface indisponible : rechargez la page.</p>';
      });
    }
    this.startVersionPolling();

    // ── Cache warm-up (perf audit §6 item 1) ──────────────────────────────
    // initMap() below awaits a third-party network chain (cartocdn style →
    // sprite/glyphs/tiles) plus ~2 MB of map JS before ANY data fetch used
    // to start. Fire the critical-layer network calls now, in parallel with
    // the map bootstrap, so their latency overlaps instead of serializing
    // after it. Results are intentionally NOT applied to the map here —
    // loadCriticalLayers() below calls the same service functions again
    // once the map exists and applies them normally; this call only exists
    // to warm each service's own in-flight/short-TTL cache.
    this.warmCriticalDataCache();

    await this.initMap();

    // ── Apply saved layer visibility IMMEDIATELY (before any data) ──────────
    // This is the critical fix for the "flash of default layers" on page load:
    // the map is ready but hidden layers must be set before any layer becomes visible.
    this.mapContainer?.setLayerVisibility(this.getEffectiveLayers());
    this.layerPanel?.updateLayers(this.activeLayers);

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
    this.startShipsPolling();
    // Finance/commodities strips render under the map and aren't part of the
    // critical first paint — defer their startup (immediate fetch + interval)
    // until the browser is idle so they don't compete with critical-layer
    // fetches right after map init (perf audit §6 item 4, last bullet).
    this.deferAfterFirstPaint(() => {
      this.startFinancePolling();
      this.startCommodityPolling();
    });
    this.startOilPolling();
    this.startAirTrafficPolling();
    this.startHealthPolling();
    this.startEventPressurePolling();
    if (this.uiV2 && !this.recorderPage) {
      this.startArchivedNotesPolling();
      // Échéances : rassemblements annoncés lus même couche Manifestations éteinte, une fois par heure.
      const loadAnnounced = (): void => {
        if (this.protestsPollWanted()) return;
        this.loadProtests().then(() => this.repaintPoste()).catch((err) => console.error('[App] Rassemblements annoncés', err));
      };
      loadAnnounced();
      this.registerPausableInterval(loadAnnounced, 60 * 60_000);
    }
    this.startHydraulicPolling();
    this.startEco2mixPolling();
    this.startMtgFrpPolling();
    this.startEolienPolling();
    this.startDromLivePolling();
    // Relèves Trafics : couches actives au démarrage ; les autres démarrent à l'ouverture de leur panneau ou de leur couche.
    for (const key of TRAFFIC_LAYER_KEYS) this.syncTrafficPolling(key);
    // Relèves Environnement : vigilance, crues et feux sans arrêt (score, situations) ; le radar si sa couche est active.
    for (const key of ENVIRONMENT_LAYER_KEYS) this.syncEnvironmentPolling(key);
    // Relèves Souveraineté : aéronefs militaires, veille des câbles et cyber sans arrêt (score, arbitrage 21).
    for (const key of SOVEREIGNTY_LAYER_KEYS) this.syncSovereigntyPolling(key);
    // Relèves Pannes réseau : Télécoms sans arrêt (score, R16) ; Électricité à l'activation de sa couche ou de son panneau.
    for (const key of OUTAGES_LAYER_KEYS) this.syncOutagesPolling(key);

    // ── Static data — sync, instant
    this.loadStaticData();

    // ── CRITICAL layers — await: map becomes useful
    await this.loadCriticalLayers();
    this.updateISNR();
    if (this.uiV2) {
      void this.startV2Intel().catch((err) => console.error('[App] Fiche France v2 : démarrage impossible', err));
    }
    this.restoreActiveLayerPanelsAfterRefresh();

    // ── SECONDARY layers — background
    this.loadSecondaryLayers()
      .then(() => {
        this.updateISNR();
        this.restoreActiveLayerPanelsAfterRefresh();
        // v2 (relecture finale I5) : la liste compte maintenant les données secondaires.
        this.recordV2VisitBaseline();
      })
      .catch((err) => console.error('[Init] Secondary layers error:', err));

    // ── OPTIONAL layers — background
    this.loadOptionalLayers().catch((err) => console.error('[Init] Optional layers error:', err));
  }

  /**
   * Fire the critical-layer network calls (ecowatt, weather vigilance, floods,
   * nuclear) and the server news ingest, without applying their results.
   *
   * Called before `await this.initMap()` so their network latency overlaps
   * with the map bootstrap instead of being fully serialized after it
   * (perf audit §6 item 1). `loadCriticalLayers()`/the RSS pipeline call the
   * same functions again once the map exists; each service's own short-TTL
   * memoization / in-flight-promise guard means that second call reuses this
   * warm-up's result instead of re-issuing the request. Errors are swallowed
   * here — the real call later handles its own error/fallback UI.
   */
  /**
   * Runs `fn` once the browser is idle (requestIdleCallback), falling back to
   * a fixed 3 s timeout in browsers/environments without it. Used for
   * below-the-fold work (finance/commodity strips) that shouldn't compete
   * with critical-layer network calls right after first paint.
   */
  private deferAfterFirstPaint(fn: () => void): void {
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof ric === 'function') {
      // Délai maximum : une page toujours occupée (carte dessinée sans carte graphique) ne repousse pas la finance du score sans fin.
      ric(() => fn(), { timeout: 5000 });
    } else {
      setTimeout(fn, 3000);
    }
  }

  private warmCriticalDataCache(): void {
    fetchEcowatt().catch(() => {});
    // Lectures qui ne rejettent jamais (environment-source.ts) : elles remplissent le cache par URL relu par loadVigilance et loadFloods.
    void fetchVigilance(null);
    void fetchFloods(null);
    // Souveraineté : lectures qui ne rejettent jamais, relues par loadMilitary, loadCables et loadCyber (cache par URL).
    void fetchMilitary(null);
    void fetchCables(null, Date.now(), false);
    void fetchCyber(null);
    // Phase B : la grille GNSS nourrit le score (relue par loadGnss) ; réseaux, gels et zones drones seulement à la demande.
    void fetchGnss(null);
    fetchNuclearUnavailabilities().catch(() => {});
    fetchRTEIIPIncidents().catch(() => {});
    fetchFromIngestApi().catch(() => {});
  }

  // ─── Shell Layout ───────────────────────────────────────────────────────────

  private renderShell(): void {
    const language = getCurrentLanguage();

    // ── Lien d'évitement (accessibilité clavier — premier élément focusable) ──
    const skipLink = document.createElement('a');
    skipLink.className = 'skip-link';
    skipLink.href = '#main-content';
    skipLink.textContent = 'Aller au contenu';
    this.container.appendChild(skipLink);

    // ── Titre de page sémantique (audit UI 2026-09 §5.2/§5.3.8) — masqué
    // visuellement, donne au tableau de bord un vrai <h1> pour les lecteurs
    // d'écran et le plan de page (jusqu'ici absent hors du <noscript>).
    const dashboardHeading = document.createElement('h1');
    dashboardHeading.className = 'visually-hidden';
    dashboardHeading.textContent = t('app.dashboardHeading');
    this.container.appendChild(dashboardHeading);

    // ── Header ──
    const header = document.createElement('header');
    header.className = 'header';
    header.innerHTML = `
      <button class="header-sidebar-toggle" type="button" data-sidebar-toggle aria-expanded="true" aria-label="${t('app.sidebarCollapseAria')}">
        ${fmIcon('menu')}${this.uiV2 ? `<span class="header-sidebar-toggle__label">${language === 'fr' ? 'Couches' : 'Layers'}</span>` : ''}
      </button>
      <button class="header-title header-about-trigger" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="${t('app.aboutAria')}">
        <img class="header-logo" src="/icon.svg" alt="France Monitor logo" />
        <span class="header-title-text">
          <span class="header-title-word header-title-word--france">France</span><span class="header-title-word header-title-word--monitor">Monitor</span>
        </span>
      </button>
      <div class="header-center" id="region-presets"></div>
      <div class="header-status">
        <div class="header-language-toggle" role="group" aria-label="${t('app.languageSwitcher')}">
          <button class="header-language-toggle__btn ${language === 'fr' ? 'is-active' : ''}" type="button" data-language-toggle="fr" aria-pressed="${language === 'fr'}">FR</button>
          <button class="header-language-toggle__btn ${language === 'en' ? 'is-active' : ''}" type="button" data-language-toggle="en" aria-pressed="${language === 'en'}">EN</button>
        </div>
        <a class="header-quality-link" href="/sources-quality">Sources & qualité</a>
        <div id="header-data-sources"></div>
        <div class="header-overflow" data-header-overflow>
          <button
            class="header-quality-link header-overflow-trigger"
            type="button"
            data-overflow-trigger
            aria-haspopup="menu"
            aria-expanded="false"
            aria-label="${t('app.moreActionsAria')}"
          >⋯</button>
          <div class="header-overflow-menu" role="menu" data-overflow-menu hidden>
            <button class="header-overflow-menu__item" type="button" role="menuitem" data-note-report>Note de situation</button>
            <button class="header-overflow-menu__item" type="button" role="menuitem" data-export-menu>Export</button>
          </div>
        </div>
        <span class="header-clock" id="clock"></span>
        <span class="header-live-dot" title="${t('app.live')}"></span>
      </div>
    `;
    this.container.appendChild(header);

    // ── Disposition A1 (?ui=v2) : bandeau d'état et barre de thèmes sous l'en-tête ──
    let v2Bar: HTMLElement | null = null;
    if (this.uiV2) {
      this.container.classList.add('ui-v2');
      this.container.dataset.v2Tab = 'list';
      this.container.dataset.v2Fiche = 'default';
      v2Bar = document.createElement('div');
      v2Bar.className = 'fm-v2-bar';
      v2Bar.innerHTML = '<div class="fm-v2-themes"></div><div class="fm-v2-tools"></div>';
      this.container.appendChild(v2Bar);
    }
    this.aboutTriggerEl = header.querySelector<HTMLButtonElement>('.header-about-trigger');
    this.headerLiveDotEl = header.querySelector<HTMLElement>('.header-live-dot');
    this.bindLanguageToggle(header);
    this.bindSidebarToggle(header);

    if (this.uiV2 && v2Bar) {
      // En-tête sur deux lignes (spec 2026-09-29 § 4) : l'état national dans l'en-tête, à la place des
      // régions ; régions et bouton Couches sur la ligne des thèmes ; « Sources & qualité » dans ⋯.
      const status = document.createElement('div');
      status.className = 'fm-v2-status';
      const tools = v2Bar.querySelector<HTMLElement>('.fm-v2-tools');
      const regions = header.querySelector<HTMLElement>('#region-presets');
      const layersToggle = header.querySelector<HTMLElement>('[data-sidebar-toggle]');
      if (regions && tools) {
        regions.replaceWith(status);
        tools.append(regions);
      }
      if (layersToggle && tools) tools.append(layersToggle);
      header.querySelector('a.header-quality-link')?.remove();
      header.querySelector('[data-overflow-menu]')?.insertAdjacentHTML('afterbegin',
        '<a class="header-overflow-menu__item" role="menuitem" href="/sources-quality">Sources & qualité</a>');
    }

    // ── Menu « ⋯ » (Note de situation / Export) — audit UI 2026-09 §5.3.4 ──
    // Regroupe deux actions header peu fréquentes derrière un seul bouton,
    // avec le clavier/focus attendu d'un menu (RGAA 7.1/7.3/8.9).
    const overflowWrapper = header.querySelector<HTMLElement>('[data-header-overflow]');
    const overflowTrigger = header.querySelector<HTMLButtonElement>('[data-overflow-trigger]');
    const overflowMenu = header.querySelector<HTMLElement>('[data-overflow-menu]');
    const overflowItems = overflowMenu
      ? Array.from(overflowMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      : [];

    const setOverflowOpen = (open: boolean): void => {
      overflowTrigger?.setAttribute('aria-expanded', String(open));
      if (overflowMenu) overflowMenu.hidden = !open;
      if (open) overflowItems[0]?.focus();
    };

    overflowTrigger?.addEventListener('click', (event) => {
      event.stopPropagation();
      setOverflowOpen(overflowTrigger.getAttribute('aria-expanded') !== 'true');
    });

    overflowMenu?.addEventListener('keydown', (event) => {
      const currentIndex = overflowItems.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        overflowItems[(currentIndex + 1 + overflowItems.length) % overflowItems.length]?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        overflowItems[(currentIndex - 1 + overflowItems.length) % overflowItems.length]?.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setOverflowOpen(false);
        overflowTrigger?.focus();
      } else if (event.key === 'Tab') {
        setOverflowOpen(false);
      }
    });

    this.addGlobalListener(document, 'click', (event) => {
      if (!overflowWrapper) return;
      if (overflowTrigger?.getAttribute('aria-expanded') !== 'true') return;
      if (!overflowWrapper.contains(event.target as Node)) setOverflowOpen(false);
    });

    header.querySelector<HTMLButtonElement>('[data-note-report]')?.addEventListener('click', () => {
      setOverflowOpen(false);
      overflowTrigger?.focus();
      void this.openSituationReport();
    });
    header.querySelector<HTMLButtonElement>('[data-export-menu]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      setOverflowOpen(false);
      // Ancre sur le déclencheur « ⋯ » (stable, toujours visible) plutôt que
      // sur l'item de menu qu'on vient de masquer — ExportMenu mesure sa
      // position au clic (getBoundingClientRect()), un élément caché
      // renverrait un rectangle vide.
      void this.toggleExportMenu(overflowTrigger ?? (event.currentTarget as HTMLElement));
    });

    const aboutModal = document.createElement('div');
    aboutModal.className = 'about-modal';
    aboutModal.setAttribute('aria-hidden', 'true');
    aboutModal.innerHTML = `
      <div class="about-modal__backdrop" data-close="true"></div>
      <div class="about-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="about-modal-title">
        <button class="about-modal__close" type="button" aria-label="${t('app.closeAbout')}">${fmIcon('x')}</button>
        <div class="about-modal__hero">
          <div class="about-modal__brand">
            <img class="about-modal__logo" src="/icon.svg" alt="France Monitor logo" />
            <div class="about-modal__brand-copy">
              <div class="about-modal__title-row">
                <div id="about-modal-title" class="about-modal__title">France Monitor</div>
                <div class="about-modal__version">v1.0</div>
              </div>
              <div class="about-modal__subtitle">${t('app.aboutSubtitle')}</div>
            </div>
          </div>
        </div>
        <div class="about-modal__body">
          <p class="about-modal__text">
            ${t('app.aboutBody')}
          </p>
          <div class="about-modal__links">
            <a class="about-modal__chip" href="/about">${t('app.aboutLinks.about')}</a>
            <a class="about-modal__chip" href="/methodology">${t('app.aboutLinks.methodology')}</a>
            <a class="about-modal__chip" href="/docs">${t('app.aboutLinks.documentation')}</a>
            <a class="about-modal__chip" href="/sources-quality">Sources & qualité</a>
            <a class="about-modal__chip" href="/contact">${t('app.aboutLinks.contact')}</a>
            <a class="about-modal__chip" href="/legal">${t('app.aboutLinks.legal')}</a>
          </div>
          <div class="about-modal__links" style="margin-top: 10px;">
            <a
              class="about-modal__chip"
              href="https://github.com/FraidFraid/France-Monitor"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="${t('app.githubAria')}"
            >
              GitHub
            </a>
            <a
              class="about-modal__chip"
              href="https://www.linkedin.com/in/fredaubourg/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="${t('app.linkedinAria')}"
            >
              LinkedIn
            </a>
            <span class="about-modal__chip about-modal__chip--static">AGPL-3.0</span>
          </div>
          <div class="about-modal__legal">
            <div>${t('app.copyright')}</div>
            <div>${t('app.independentProject')}</div>
          </div>
        </div>
      </div>
    `;
    this.container.appendChild(aboutModal);

    const setAboutModalOpen = (open: boolean) => {
      aboutModal.setAttribute('aria-hidden', open ? 'false' : 'true');
      this.aboutTriggerEl?.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.style.overflow = open ? 'hidden' : '';
    };
    this.aboutTriggerEl?.addEventListener('click', () => setAboutModalOpen(true));
    aboutModal.querySelector('.about-modal__close')?.addEventListener('click', () => setAboutModalOpen(false));
    aboutModal.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.dataset['close'] === 'true') setAboutModalOpen(false);
    });
    this.addGlobalListener(document, 'keydown', (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      if (event.key === 'Escape' && aboutModal.getAttribute('aria-hidden') === 'false') {
        event.preventDefault();
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

      // Historisation locale de la qualité des sources (scores calculés, page Sources & qualité).
      startQualityHistoryTracking();
    }

    // ── Main layout ──
    const main = document.createElement('main');
    main.className = 'main-container';
    main.id = 'main-content';
    main.tabIndex = -1;

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
          <p data-map-loading-text>${t('app.loadingMap')}</p>
        </div>
      </div>
    `;
    mapArea.appendChild(mapContainerEl);
    this.mapLoadingTextEl = mapContainerEl.querySelector<HTMLElement>('[data-map-loading-text]');

    const underMapArea = document.createElement('section');
    underMapArea.className = 'under-map-area';
    underMapArea.id = 'under-map-area';
    underMapArea.innerHTML = `<div class="under-map-grid" id="under-map-grid"></div>`;
    mapArea.appendChild(underMapArea);

    const bottomLinks = document.createElement('nav');
    bottomLinks.className = 'app-bottom-links';
    bottomLinks.setAttribute('aria-label', t('app.infoPagesAria'));
    bottomLinks.innerHTML = `
      <a href="/about">${t('app.bottomLinks.about')}</a>
      <span aria-hidden="true">·</span>
      <a href="/methodology">${t('app.bottomLinks.methodology')}</a>
      <span aria-hidden="true">·</span>
      <a href="/docs">${t('app.bottomLinks.documentation')}</a>
      <span aria-hidden="true">·</span>
      <a href="/sources-quality">Sources & qualité</a>
      <span aria-hidden="true">·</span>
      <a href="/legal">${t('app.bottomLinks.legal')}</a>
      <span aria-hidden="true">·</span>
      <a href="/contact">${t('app.bottomLinks.contact')}</a>
    `;
    this.bottomLinksEl = bottomLinks;

    const underMapJumpBtn = document.createElement('button');
    underMapJumpBtn.className = 'map-underfold-btn';
    underMapJumpBtn.type = 'button';
    underMapJumpBtn.setAttribute('aria-expanded', 'false');
    underMapJumpBtn.innerHTML = `
      <span class="map-underfold-btn__label">${t('app.openModules')}</span>
      <span class="map-underfold-btn__chevron">${fmIcon('chevron-down')}</span>
    `;
    const underMapLabelEl = underMapJumpBtn.querySelector('.map-underfold-btn__label') as HTMLElement | null;
    const underMapChevronEl = underMapJumpBtn.querySelector('.map-underfold-btn__chevron') as HTMLElement | null;
    this.underMapLabelEl = underMapLabelEl;
    const syncUnderMapToggle = (expanded: boolean) => {
      this.underMapExpanded = expanded;
      underMapJumpBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      if (underMapLabelEl) underMapLabelEl.textContent = expanded ? t('app.backToMap') : t('app.openModules');
      if (underMapChevronEl) underMapChevronEl.innerHTML = expanded ? fmIcon('chevron-up') : fmIcon('chevron-down');
    };
    underMapJumpBtn.onclick = () => {
      this.underMapScrollLockUntil = Date.now() + 700;
      if (this.underMapExpanded) {
        syncUnderMapToggle(false);
        mapArea.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        syncUnderMapToggle(true);
        mapArea.scrollTo({ top: underMapArea.offsetTop, behavior: 'smooth' });
      }
    };
    const handleMapAreaScroll = (): void => {
      if (Date.now() < this.underMapScrollLockUntil) return;
      const mapTop = mapArea.scrollTop;
      const revealThreshold = Math.max(32, underMapArea.offsetTop - mapContainerEl.clientHeight / 2);
      const isUnderMapVisible = mapTop >= revealThreshold;
      syncUnderMapToggle(isUnderMapVisible);
    };
    let scrollThrottleTimer: ReturnType<typeof setTimeout> | null = null;
    mapArea.addEventListener('scroll', () => {
      if (scrollThrottleTimer !== null) return; // throttle ~150 ms (trailing)
      scrollThrottleTimer = setTimeout(() => {
        scrollThrottleTimer = null;
        handleMapAreaScroll();
      }, 150);
    }, { passive: true });
    mapArea.appendChild(underMapJumpBtn);

    // ── « Panneaux ouverts » : sélecteur de panneau flottant unique ──
    // (audit UI 2026-09 §5.3 point 3). Peuplé/masqué par
    // refreshFloatingPanelSwitcher() — vide et caché tant qu'il n'y a pas
    // au moins 2 panneaux flottants éligibles.
    const floatingPanelSwitcher = document.createElement('div');
    floatingPanelSwitcher.className = 'floating-panel-switcher';
    floatingPanelSwitcher.setAttribute('role', 'group');
    floatingPanelSwitcher.setAttribute('aria-label', t('app.floatingPanelSwitcherAria'));
    floatingPanelSwitcher.hidden = true;
    mapArea.appendChild(floatingPanelSwitcher);
    this.floatingPanelSwitcherEl = floatingPanelSwitcher;
    // Cartes Sécurité et Santé (public/maquette-*.js) : leurs pastilles se cumulent sur la carte ; elles décident du panneau de droite
    // (celui de la dernière pastille allumée, aucun quand toutes sont éteintes) par cette passerelle, comme les pastilles Énergie.
    (window as unknown as { __fmPanels?: object }).__fmPanels = {
      isVisible: (key: string): boolean => this.isFloatingPanelVisible(key as keyof MapLayers),
      show: (key: string): void => this.showFloatingPanel(key as keyof MapLayers),
      hide: (key: string): void => this.hideFloatingPanel(key as keyof MapLayers),
    };
    // Carte Sécurité : elle capte les clics de la carte ; elle lit les rassemblements Flux piétons et en choisit un par cette passerelle.
    (window as unknown as { __fmFlux?: object }).__fmFlux = {
      event: (id: string): FluxIndex['evenements'][number] | null => this.fluxIndex?.evenements.find((e) => e.id === id) ?? null,
      selectedId: (): string | null => this.fluxSelectedId,
      select: (id: string): void => this.openFluxFromProtest(id),
    };
    // Énergie (spec 2026-10-16 § 7) : les pastilles allumées (vertes) ne laissent vives que leurs couches, et leurs légendes
    // courtes se cumulent ; l'état reste tant que les pastilles ne changent pas. Survoler une autre pastille l'ajoute le temps
    // du survol. Le conteneur est réécrit par innerHTML à chaque rafraîchissement : on écoute le conteneur, une seule fois.
    floatingPanelSwitcher.addEventListener('pointerover', (ev) => {
      // Au toucher, pas de « sortie » : l'aperçu resterait affiché.
      if (ev.pointerType === 'touch') return;
      const chip = ev.target instanceof Element ? ev.target.closest<HTMLElement>('.floating-panel-switcher__chip[data-panel-key]') : null;
      const key = chip?.dataset['panelKey'] ?? null;
      // Aperçu après un court arrêt de la souris (20/10/2026) : en glissant d'une pastille à l'autre, les espaces entre pastilles
      // (aucun aperçu, carte entière) et les pastilles traversées (Vigilance météo à 100 %) faisaient clignoter la carte.
      this.schedulePastillePreview(() => {
        const theme = this.uiV2 ? this.v2Theme : 'general';
        this.setEnergyFocusPreview(key && isEnergyLayerKey(key) && usesEnergyFocus(theme, key) ? key : null);
        // « En bref » ne dessine rien : son survol ne tamise pas la carte.
        this.setGeneralFocusPreview(key && key !== 'brief' && key !== 'envBrief' && !usesEnergyFocus(theme, key) ? key as keyof MapLayers : null);
      });
    });
    floatingPanelSwitcher.addEventListener('pointerleave', () => {
      this.schedulePastillePreview(() => { this.setEnergyFocusPreview(null); this.setGeneralFocusPreview(null); });
    });
    // La largeur de la carte change la place disponible (repli en icônes) et donc le décalage des panneaux.
    this.addGlobalListener(window, 'resize', () => this.layoutFloatingPanelSwitcher());
    // v2 : la zone carte change de taille sans que la fenêtre bouge (tiroir ouvert ou fermé, onglet Carte du mobile).
    if (this.uiV2 && typeof ResizeObserver !== 'undefined') {
      const switcherObserver = new ResizeObserver(() => this.layoutFloatingPanelSwitcher());
      switcherObserver.observe(mapArea);
      this.floatingSwitcherObserver = switcherObserver;
    }
    // v2 : Échap ferme le panneau de module (lui seul). Écouté sur `document`, donc avant le
    // gestionnaire de PosteSituation (sur `window`) qui ignore un événement déjà traité.
    this.addGlobalListener(document, 'keydown', (event) => {
      if (!moduleInColumn(this.uiV2, window.innerWidth) || !(event instanceof KeyboardEvent) || event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      // Une fenêtre, un menu ou une bulle de carte ouverts reçoivent Échap avant le panneau.
      if (innerLayerOpen(document, MODULE_PANEL_SELECTOR)) return;
      if (this.closeV2ModulePanel()) event.preventDefault();
    });

    // ── Disposition A1 (?ui=v2) : liste « À traiter » à gauche de la carte, fiche à droite ──
    let v2List: HTMLElement | null = null;
    let v2Fiche: HTMLElement | null = null;
    if (this.uiV2) {
      v2List = document.createElement('aside');
      v2List.className = 'fm-v2-list';
      v2List.setAttribute('aria-label', 'À traiter');
      v2List.innerHTML = '<p class="wl-empty">Chargement…</p>';
      main.appendChild(v2List);
    }

    main.appendChild(mapArea);

    if (this.uiV2) {
      v2Fiche = document.createElement('aside');
      v2Fiche.className = 'fm-v2-fiche';
      main.appendChild(v2Fiche);
    }

    // ── Right Sidebar ──
    const rightSidebarEl = document.createElement('aside');
    rightSidebarEl.id = 'right-sidebar';
    main.appendChild(rightSidebarEl);
    this.rightSidebarRootEl = rightSidebarEl;

    // Mobile toggle button — only visible on small screens via CSS
    const mobileToggle = document.createElement('button');
    mobileToggle.className = 'right-sidebar-mobile-toggle';
    mobileToggle.setAttribute('aria-label', 'Ouvrir le panneau latéral');
    mobileToggle.innerHTML = fmIcon('menu');
    mapArea.appendChild(mobileToggle);
    this.rightSidebarMobileToggleEl = mobileToggle;

    this.container.appendChild(main);
    this.container.appendChild(bottomLinks);
    if (v2Bar && v2List && v2Fiche) {
      const tabs = document.createElement('nav');
      tabs.className = 'fm-v2-tabs';
      tabs.setAttribute('aria-label', 'Vues');
      this.container.appendChild(tabs);
      const status = this.container.querySelector<HTMLElement>('.fm-v2-status');
      const themes = v2Bar.querySelector<HTMLElement>('.fm-v2-themes');
      if (status && themes) this.v2Roots = { status, themes, list: v2List, fiche: v2Fiche, tabs };
    }
    this.updateNotification = new UpdateNotification(this.container);
    this.syncRightSidebarTriggers(false);

    mobileToggle.addEventListener('click', () => {
      void this.ensureRightSidebar().then((sidebar) => sidebar.toggle());
    });
    // presidentToggle listener removed

    // ── Mount sidebar panels ──
    const sidebarEl = document.getElementById('sidebar-content')!;

    // Baromètre Pannes Réseau (premier élément de la sidebar, avant les couches)
    this.networkBarometerWidget = new BarometerWidget(sidebarEl);
    this.networkBarometerWidget.mount({ attach: false, briefing: !this.uiV2 });

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
    // v2 : l'activation d'une couche ne l'ouvre jamais (spec 2026-09-29 § 4), le sélecteur de panneaux le fait.
    this.layerPanel.setOnChange((key, enabled) => {
      // Couche touchée à la main : la Vue générale ne l'éteindra plus d'elle-même (12/10/2026).
      this.generalAuto.delete(key);
      this.onLayerToggle(key, enabled, layerActivationOptions(this.uiV2));
    });
    this.layerPanel.setPresetHandler((id) => {
      // Thème posé avant la vue : la puce Actualités de la barre des panneaux en dépend.
      this.v2Theme = id;
      this.applyLayerPreset(id);
      // v2 (arbitrage A5) : la vue choisie dans « Couches » devient aussi le thème de la liste et de la fiche.
      this.poste?.setTheme(id, { silent: true });
      // Silencieux : `onThemeChange` ne tourne pas, la carte doit suivre le thème du fil elle-même.
      this.refreshEventPoints();
    });
    this.layerPanel.mount();

    const underMapGrid = document.getElementById('under-map-grid')!;

    // Moitié gauche : Stabilité financière (spec 2026-10-12) + Matières premières fusionnés en UNE
    // seule bande (audit UI 2026-09 §5.3 point 7 — auparavant 2 cartes
    // empilées, chacune avec sa propre bordure/fond/ombre). Chaque composant
    // garde son mount() intact ; .under-map-market-band neutralise juste la
    // carte individuelle de chaque enfant en CSS (main.css).
    const marketBand = document.createElement('div');
    marketBand.className = 'under-map-market-band';
    underMapGrid.appendChild(marketBand);

    const marketStripContainer = document.createElement('div');
    marketStripContainer.className = 'under-map-market-band__col';
    marketBand.appendChild(marketStripContainer);
    this.financialStrip = new FinancialStabilityStrip(marketStripContainer);
    this.financialStrip.mount();

    const commodityStripContainer = document.createElement('div');
    commodityStripContainer.className = 'under-map-market-band__col';
    marketBand.appendChild(commodityStripContainer);
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

    // Panneaux Environnement (Vigilance météo, Crues, Radar météo, Feux de forêt) : créés à la demande, ensure*Panel().

    this.energyPanel = new EnergyPanel(floatContainer);
    this.energyPanel.setOnClose(() => this.closeEnergyLayer('powerGrid'));
    this.energyPanel.mount();

    // DromEnergyPanel/HydraulicPanel/EolienPanel: lazy-loaded on first layer
    // activation — see ensureDromEnergyPanel()/ensureHydraulicPanel()/
    // ensureEolienPanel() below (perf audit task 5).

    this.isnrPanel = new ISNRPanel(floatContainer);
    this.isnrPanel.setOnHoverDepartment((code) => {
      this.mapContainer?.highlightISNRDepartment(code);
    });
    // Click sur département : pas de flyTo (panel latéral uniquement, sans interaction carte)
    this.isnrPanel.mount();
    // v2 : « Pression par département » chargé à la demande (hors du chunk critique), à la place de l'ISNRPanel.
    if (this.uiV2) {
      void import('./components/PressurePanel.ts').then(({ PressurePanel }) => {
        const panel = new PressurePanel(floatContainer);
        // Département choisi : mis en évidence sur la carte et sa fiche ouverte ; élément choisi : sa fiche.
        panel.setOnSelectDepartment((code) => {
          this.mapContainer?.highlightISNRDepartment(code);
          this.poste?.select(`dept:${code}`);
        });
        panel.setOnOpenElement((key) => this.poste?.select(key));
        panel.mount();
        this.pressurePanel = panel;
        panel.update(this.v2Pressure);
        // La puce de la couche n'apparaît qu'avec l'instance du panneau.
        this.refreshFloatingPanelSwitcher();
      });
    }

    void this.refreshNetworkBarometerWidget();
    this._intervalNetworkBarometer = setInterval(() => {
      if (document.hidden) return; // skip tick while tab is hidden
      this.refreshNetworkBarometerWidget().catch(err => console.error('[App] Network barometer poll error', err));
    }, POLL_NETWORK_BAROMETER_MS);

    // France Intelligence Panel — open on sidebar button click or map click
    this.addGlobalListener(document, 'open-france-intel', () => {
      // v2 : pas de tiroir, la fiche France de la colonne de droite (spec §5, §14).
      if (this.uiV2) {
        this.poste?.select('france');
        return;
      }
      void this.openFranceIntelPanel();
    });

    // Handle lang toggle from panel header button
    this.addGlobalListener(document, 'france-intel-lang-toggle', (e: Event) => {
      const { lang } = (e as CustomEvent<{ lang: 'fr' | 'en' }>).detail;
      const snapshot = this.buildFranceSnapshot(lang);
      this.franceIntelPanel?.show(snapshot);
      this.requestFranceIntelBrief(snapshot, lang);
    });

    // FiresPanel/TrafficPanel/MaritimePanel/CyberPanel: lazy-loaded on first
    // layer activation — see ensureFiresPanel()/ensureTrafficPanel()/
    // ensureMaritimePanel()/ensureCyberPanel() below (perf audit task 5).

    // ElusPanel disabled

    // Bouton du baromètre et du poste de situation : panneau Vigilance cyber, même couche éteinte (contrats § 4.4 point 18).
    this.addGlobalListener(document, 'open-cyber-panel', () => this.showSovereigntyPanel('cyber'));

    // Gas Panel (EcoGaz + Vital Organs Dashboard)
    this.gasPanel = new GasPanel(floatContainer);
    this.gasPanel.setOnClose(() => this.closeEnergyLayer('gasNetwork'));
    this.gasPanel.mount();

    // OilPanel/NuclearPanel/DefensePanel and the Pannes réseau panels: lazy-loaded on first
    // layer activation — see ensureOilPanel()/ensureNuclearPanel()/
    // ensureOutagesLayerPanel()/ensureDefensePanel() below (perf audit task 5).

    // Layer toggles now in header (UnifiedSettings modal)

    // ── Search Modal ──
    this.addGlobalListener(document, 'keydown', (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        void this.ensureSearchModal().then((modal) => modal.show());
      }
    });

    // ── Clock ──
    this.startClock();
  }

  private startVersionPolling(): void {
    const checkVersion = async (): Promise<void> => {
      const info = await fetchAppVersion();
      if (!info) return;

      const nextKey = getVersionKey(info);
      if (this.currentVersionKey === null) {
        this.currentVersionKey = nextKey;
        return;
      }

      if (nextKey !== this.currentVersionKey && !this.hasUpdate) {
        this.hasUpdate = true;
        this.updateNotification?.show();
      }
    };

    void checkVersion();
    this._intervalVersion = this.registerPausableInterval(() => {
      void checkVersion();
    }, VERSION_POLL_INTERVAL_MS);
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
    let resizeThrottleTimer: ReturnType<typeof setTimeout> | null = null;
    this.addGlobalListener(window, 'resize', () => {
      if (resizeThrottleTimer !== null) return; // throttle ~200 ms (trailing)
      resizeThrottleTimer = setTimeout(() => {
        resizeThrottleTimer = null;
        syncCompactMode();
      }, 200);
    });

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => syncCompactMode());
      observer.observe(container);
      observer.observe(listEl);
    }
  }

  private handleSourcePanelClick(name: string): void {
    // Un seul panneau flottant à la fois (audit UI 2026-09 §5.3.3). Cette
    // liste bascule des panneaux SANS forcément activer la couche
    // correspondante (l'utilisateur clique une source dans le menu Sources,
    // pas une case à cocher) — elle ne peut donc pas passer par
    // showFloatingPanel()/_handlePanelVisibility(), qui exigent la couche
    // active pour la plupart des branches ; on garde son show() dédié
    // ci-dessous, seul le hide-others est centralisé.
    this.hideAllFloatingPanels();

    if (name === 'Météo-France') {
      // Panneaux Environnement créés à la demande : la source peut être cliquée couche éteinte ; le panneau lit alors sa source.
      void this.ensureVigilancePanel().then(() => this.openEnvironmentPanel('environmental'));
    } else if (name === 'Vigicrues') {
      void this.ensureFloodsPanel().then(() => this.openEnvironmentPanel('floods'));
    } else if (name === 'Radar Météo-France') {
      void this.ensureWeatherRadarPanel().then(() => this.openEnvironmentPanel('weatherRadar'));
    } else if (name === 'NASA FIRMS' || name === 'Météo des forêts') {
      void this.ensureFiresPanel().then(() => this.openEnvironmentPanel('fires'));
    } else if (name === 'VigiEau') {
      void this.ensureDroughtPanel().then(() => this.openEnvironmentPanel('drought'));
    } else if (name === 'Atmo France') {
      void this.ensureAirQualityPanel().then(() => this.openEnvironmentPanel('airQuality'));
    } else if (name === 'BCSF-RéNaSS') {
      void this.ensureEarthquakesPanel().then(() => this.openEnvironmentPanel('earthquakes'));
    } else if (name === 'GDACS' || name === 'Copernicus EMS') {
      void this.ensureDisastersPanel().then(() => this.openEnvironmentPanel('disasters'));

    } else if (name === 'Marégraphes SHOM') {
      void this.ensureVigilancePanel().then(() => this.openEnvironmentPanel('environmental'));
    } else if (name === 'Éolien France') {
      this.eolienPanel?.show(this.currentEolienLive, this.currentEolienParks);
      this.layoutEnergyFloatingPanels();
    } else if (name === 'SNCF' || name === 'SIRI SX') {
      // Panneaux Trafics créés à la demande : la source peut être cliquée couche éteinte ; le panneau lit alors sa source et la
      // relève tant qu'il reste ouvert (openTrafficPanel).
      void this.ensureTransportPanel().then(() => this.openTrafficPanel('trafficRail'));
    } else if (name === 'Trafic' || name === 'TomTom agglomérations') {
      void this.ensureTrafficPanel().then(() => this.openTrafficPanel('trafficRoad'));
    } else if (name === 'Trafic aérien' || name === AIR_POSITIONS_SOURCE) {
      void this.ensureAirTrafficPanel().then(() => this.openTrafficPanel('trafficAir'));
    } else if (name === 'AIS maritime' || name === 'AIS instantané') {
      void this.ensureMaritimePanel().then(() => this.openTrafficPanel('trafficMaritime'));
    } else if (SOURCE_NAME_TO_FLOATING_PANEL[name] === 'cyber') {
      // Cinq sources de la Vigilance cyber (arbitrage 22) : panneau créé à la demande, couche éteinte possible.
      void this.ensureCyberPanel().then(() => this.openSovereigntyPanel('cyber'));
    } else if (name === 'Câbles et AIS') {
      void this.ensureConnectivityPanel().then(() => this.openSovereigntyPanel('subseaCables'));
    } else if (name === 'Écowatt RTE') {
      this.energyPanel?.show(this.currentEcowattResponse);
    } else if (name === 'ARCEP sites mobiles') {
      // Panneaux Pannes réseau créés à la demande : la source peut être cliquée couche éteinte ; le panneau lit alors sa source.
      void this.ensureOutagesLayerPanel('outagesTelecom').then(() => this.openOutagesPanel('outagesTelecom'));
    } else if (name === 'EDF indisponibilités' || name === 'RTE IIP' || name === 'EDF SEI (îles)') {
      void this.ensureOutagesLayerPanel('outagesElec').then(() => this.openOutagesPanel('outagesElec'));
    } else if (name === 'IODA' || name === 'Cloudflare Radar') {
      void this.ensureOutagesLayerPanel('outagesInternet').then(() => this.openOutagesPanel('outagesInternet'));
    } else if (name === 'Pages d’état cloud') {
      void this.ensureOutagesLayerPanel('outagesCloud').then(() => this.openOutagesPanel('outagesCloud'));
    } else if (name === 'Réseau Gaz / EcoGaz') {
      if (this.currentGasData) this.gasPanel?.show(this.currentGasData, this.currentBiogasState);
    } else if (name === 'Pétrole SDES / INSEE') {
      if (this.currentOilData) this.oilPanel?.show(this.currentOilData, this.currentFuelTensionData);
    } else if (name === 'Vols militaires') {
      void this.ensureDefensePanel().then(() => this.openSovereigntyPanel('military'));
    } else if (name === VIGIPIRATE_CHECK_SOURCE) {
      void this.ensureDefensePanel().then(() => this.openSovereigntyPanel('military'));
    } else if (name === 'Grille GNSS' || name === 'NOAA SWPC' || name === 'Registre des gels') {
      void this.ensureDefensePanel().then(() => this.openSovereigntyPanel('military'));
    } else if (name === 'RIPEstat') {
      void this.ensureConnectivityPanel().then(() => this.openSovereigntyPanel('subseaCables'));
    } else if (name === 'Santé publique France') {
      // Panneaux Santé créés à la demande : la source peut être cliquée avant toute activation de couche.
      void this.ensureUrgencesPanel().then(() => this.urgencesPanel?.show(this.currentHealth));
    } else if (SOURCE_NAME_TO_FLOATING_PANEL[name] === 'health') {
      void this.ensureVeillePanel().then(() => this.veillePanel?.show(this.currentHealth));
    } else if (name === 'DREES APL') {
      void this.ensureAccesSoinsPanel().then(() => this.accesSoinsPanel?.show(this.currentHealthOffer));
    } else if (name === 'DREES SAE / FINESS') {
      void this.ensureHopitauxPanel().then(() => this.hopitauxPanel?.show(this.currentHealthOffer));
    }
    this.currentFloatingPanelId = SOURCE_NAME_TO_FLOATING_PANEL[name] ?? null;
    this.refreshFloatingPanelSwitcher();
  }

  private restoreActiveLayerPanelsAfterRefresh(): void {
    if (this.hasRestoredActiveLayerPanels) return;
    this.hasRestoredActiveLayerPanels = true;

    const restoreOrder: (keyof MapLayers)[] = [
      'environmental',
      'floods',
      'weatherRadar',
      'fires',
      'drought',
      'airQuality',
      'earthquakes',
      'disasters',
      'powerGrid',
      'dromEnergy',
      'nuclearFleet',
      'gasNetwork',
      'hydroBackbone',
      'oilNetwork',
      'windMonitor',
      'metroLoad',
      'health',
      'healthOscour',
      'healthApl',
      'hospitals',
      'trafficRoad',
      'trafficAir',
      'trafficMaritime',
      'trafficRail',
      'military',
      'subseaCables',
      'cyber',
      'stability',
      'outagesElec',
      'outagesTelecom',
      'outagesInternet',
      'outagesCloud',
      'protests',
      'crime',
      'webcams',
      'envBrief',
      'seveso',
      'pollens',
      'pedestrianFlows',
    ];

    const activeKeys = restoreOrder.filter((key) => this.activeLayers[key]);
    // Utilisateur récurrent avec de vraies couches persistées : les couches se rechargent, mais un
    // seul panneau flottant se rouvre (règle « un seul panneau à la fois », §5.3.3) ; les autres
    // restent accessibles par la barre « Panneaux ouverts ». Preset d'accueil (premier chargement /
    // état « tout éteint ») : aucun panneau ne s'ouvre tout seul — cf. init() (§5.3.2).
    const plan = this.suppressFirstLoadPanelAutoOpen
      ? { open: [] as (keyof MapLayers)[], silent: activeKeys }
      : restorePanelPlan(activeKeys, (key) => FLOATING_PANEL_DEFS.find((def) => def.layerKeys.includes(key))?.id ?? null);

    for (const key of activeKeys) {
      // Perf audit task 5: ensure the lazy panel chunk for this key is
      // requested (its own catch-up logic shows it once loaded) — mirrors
      // what onLayerToggle() does on a live toggle.
      void Promise.all(this.ensureLazyPanelForLayer(key)).then(() => this.refreshFloatingPanelSwitcher());
      if (plan.open.includes(key)) {
        this._handlePanelVisibility(key, true);
        const def = FLOATING_PANEL_DEFS.find((d) => d.layerKeys.includes(key));
        if (def) this.currentFloatingPanelId = def.id;
      } else {
        this.activateLayerSilently(key);
      }
    }
    this.refreshFloatingPanelSwitcher();
  }

  private getEffectiveLayers(): MapLayers {
    const effective: MapLayers = { ...this.activeLayers };
    effective.traffic =
      effective.trafficRoad ||
      effective.trafficMaritime ||
      effective.trafficAir ||
      effective.trafficRail;
    // Comme `traffic` : sans le maître dérivé, une couche Environnement seule ne s'afficherait pas (enfants dependsOnGroup).
    effective.environmentGroup = hasActiveEnvironment(effective);
    // Même raison pour la Souveraineté : une couche enfant seule restaurée s'affiche.
    effective.sovereignty = hasActiveSovereignty(effective);
    // Et pour les Pannes réseau : Électricité ou Télécoms seul restauré s'affiche.
    effective.outages = hasActiveOutages(effective);
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
    this.refreshFloatingPanelSwitcher();
  }

  private onLayerToggle(
    key: keyof MapLayers,
    enabled: boolean,
    opts: { suppressPanel?: boolean } = {},
  ): void {
    this.activeLayers[key] = enabled;
    this._syncGroupFlags(key, enabled);

    this.mapContainer?.setLayerVisibility(this.getEffectiveLayers());
    this.refreshLegendVisibility();
    this.refreshTrafficLegend();
    this.refreshEnvironmentLegend();
    this.refreshSovereigntyLegend();

    // Persist layer state across sessions
    try {
      layerStateStorage(this.uiV2, window)?.setItem(ACTIVE_LAYERS_STORAGE_KEY, JSON.stringify(this.activeLayers));
    } catch (err) {
      console.warn('[App] localStorage quota exceeded, could not persist layer state', err);
    }
    writeUrlState({ layers: this.activeLayers });

    // AIS loader lifecycle — show while waiting for first ship data, hide when layer off
    if (key === 'trafficMaritime' && !enabled && this._aisLoaderEl) {
      this._aisLoaderEl.remove();
      this._aisLoaderEl = null;
    }
    if (key === 'trafficMaritime' && enabled && getAllLiveTraffic().length === 0) {
      this._showAisLoaderFn?.();
    }

    // Feux : MTG-FRP (démonstration) lu à l'activation ; manifeste radar aussi quand les sommets d'écho sont cochés. La couche Radar
    // lit son manifeste à l'ouverture de son panneau (openEnvironmentPanel), comme toute couche Environnement.
    if (key === 'fires' && enabled) {
      void this.loadMtgFrpMetadata().catch((error) => {
        console.error('[App] MTG-FRP metadata load failed', error);
      });
      if (this.echoTopsEnabled) this.loadRadarManifest().catch((error) => console.error('[App] Manifeste radar indisponible', error));
    }
    // AIS relay socket: opened lazily at boot (startShipsPolling) only if
    // trafficMaritime/military was already active. connectAis() is idempotent
    // (no-op if already connecting/connected), so this just covers the case
    // where the layer is switched on later in the session (perf audit §6 item 4).
    if ((key === 'trafficMaritime' || key === 'military') && enabled) {
      connectAis();
    }
    // Air traffic: polling only runs while the layer is active (perf audit
    // §6 item 4 / top-10 list) — start/stop the interval on toggle instead of
    // always running it in the background.
    if (key === 'trafficAir') {
      if (enabled) this.startAirTrafficPolling();
      else this.stopAirTrafficPolling();
    }
    // Perf audit task 5: request the lazy panel chunk for this key (if any)
    // the first time it's switched on — its own catch-up logic shows it once
    // the chunk resolves.
    if (enabled) void Promise.all(this.ensureLazyPanelForLayer(key)).then(() => this.refreshFloatingPanelSwitcher());

    // Single floating panel (audit UI 2026-09 §5.3.3): a preset applies
    // several toggles in a row and must never pop a panel open on its own
    // (opts.suppressPanel, set by applyLayerPreset()) — the data/chunk load
    // above still runs, only the panel stays hidden. A real, explicit toggle
    // routes through showFloatingPanel(), which hides every other panel
    // first. Layers with no floating panel (or being switched off) keep the
    // direct _handlePanelVisibility() path.
    const floatingId = this.floatingPanelIdForLayerKey(key);
    if (enabled && opts.suppressPanel) {
      this.activateLayerSilently(key);
      this.refreshFloatingPanelSwitcher();
    } else if (enabled && floatingId) {
      this.showFloatingPanel(floatingId);
    } else {
      this._handlePanelVisibility(key, enabled);
      this.refreshFloatingPanelSwitcher();
    }
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

    if (isSovereigntyLayerKey(key)) this.activeLayers.sovereignty = hasActiveSovereignty(this.activeLayers);
    if (ENERGY_SYSTEM_LAYER_KEYS.includes(key as typeof ENERGY_SYSTEM_LAYER_KEYS[number])) {
      this.activeLayers.energySystems = hasActiveEnergySystems(this.activeLayers);
    }
    if (isEnvironmentLayerKey(key)) {
      this.activeLayers.environmentGroup = hasActiveEnvironment(this.activeLayers);
    }
    if (key === 'trafficRoad' || key === 'trafficMaritime' || key === 'trafficAir' || key === 'trafficRail') {
      this.syncTrafficGroupState();
    }
    if (isOutagesLayerKey(key)) this.activeLayers.outages = hasActiveOutages(this.activeLayers);
    if (key === 'news' || key === 'stability' || key === 'events') {
      this.activeLayers.newsGroup = this.activeLayers.news || this.activeLayers.stability || this.activeLayers.events;
    }
  }

  /**
   * Show or hide the panel that corresponds to the toggled layer.
   *
   * Chaque couche Souveraineté a son panneau (Connectivité comprise).
   * Some panels are shared across child layers (outages tab auto-switch).
   * Some trigger lazy data loads if the data hasn't been fetched yet.
   *
   * Called at the end of onLayerToggle, after map visibility and state
   * have already been updated.
   */
  private _handlePanelVisibility(key: keyof MapLayers, enabled: boolean): void {
    // Panneaux Environnement (spec 2026-10-04 environnement § 2) : à l'ouverture, source lue et relève réglée ; à l'extinction,
    // masquage silencieux et relève réglée (vigilance, crues et feux continuent pour le score, qualité de l'air et séismes pour les situations).
    if (isEnvironmentLayerKey(key)) {
      if (enabled) {
        this.openEnvironmentPanel(key);
      } else {
        this.getFloatingPanelInstance(key)?.hide({ silent: true });
        this.syncEnvironmentPolling(key);
        if (key === 'fires') this.syncEnvironmentPolling('weatherRadar');
      }
    }
    // Panneaux Trafics (spec 2026-10-03 trafics § 3) : à l'ouverture (case, puce, restauration), source lue et relève réglée ; à
    // l'extinction, masquage silencieux et relève arrêtée si le panneau n'est plus ouvert.
    if (key === 'trafficRoad' || key === 'trafficAir' || key === 'trafficRail' || key === 'trafficMaritime') {
      if (enabled) {
        this.openTrafficPanel(key);
      } else {
        this.getFloatingPanelInstance(key)?.hide({ silent: true });
        this.syncTrafficPolling(key);
      }
    }
    // Panneaux Souveraineté (spec 2026-10-04 souveraineté § 2) : à l'ouverture, source lue et relève réglée ; à l'extinction, masquage
    // silencieux et relève réglée (les trois couches restent relevées pour le score, arbitrage 21).
    if (isSovereigntyLayerKey(key)) {
      if (enabled) {
        this.openSovereigntyPanel(key);
      } else {
        this.getFloatingPanelInstance(key)?.hide({ silent: true });
        this.syncSovereigntyPolling(key);
      }
    }
    // Panneaux Pannes réseau (spec 2026-10-08 panneaux pannes § 4) : à l'ouverture, source lue, carte repeinte et relève réglée ; à
    // l'extinction, masquage silencieux et relève réglée (Télécoms reste relevé pour le score, R16).
    if (isOutagesLayerKey(key)) {
      if (enabled) {
        this.openOutagesPanel(key);
      } else {
        this.getFloatingPanelInstance(key)?.hide({ silent: true });
        this.syncOutagesPolling(key);
      }
    }

    // Panneau Manifestations (spec 2026-10-17) : à l'ouverture, source lue, carte repeinte et relève réglée ; à l'extinction, masquage
    // silencieux et relève arrêtée (rien n'est relevé couche éteinte : aucun effet sur le score).
    if (key === 'protests') {
      // Foule estimée (Flux piétons) fusionnée dans Manifestations : sa couche suit, sans case ni puce à elle.
      if (this.activeLayers.pedestrianFlows !== enabled) this.onLayerToggle('pedestrianFlows', enabled);
      if (enabled) {
        this.openProtestsPanel();
      } else {
        this.protestsPanel?.hide({ silent: true });
        this.syncProtestsPolling();
      }
    }

    // Panneau Criminalité (spec 2026-10-17) : fichier annuel lu une fois à l'ouverture, aucune relève ; masquage silencieux à l'extinction.
    if (key === 'crime') {
      if (enabled) {
        this.openCrimePanel();
      } else {
        this.crimePanel?.hide({ silent: true });
      }
    }

    // Pollens (20/10/2026) : lus à l'allumage puis toutes les 25 min tant que la couche est allumée.
    if (key === 'pollens') {
      if (enabled) {
        this.pollensPanel?.show(this.currentPollen);
        void this.loadPollen();
        this.pollenTimer ??= setInterval(() => { void this.loadPollen(); }, POLLEN_TTL_MS);
      } else {
        this.pollensPanel?.hide({ silent: true });
        if (this.pollenTimer !== null) clearInterval(this.pollenTimer);
        this.pollenTimer = null;
      }
    }

    // Sites Seveso (20/10/2026) : recensement lu une fois, exposition recalculée à chaque lecture des phénomènes.
    if (key === 'seveso') {
      if (enabled) {
        this.sevesoPanel?.show();
        void this.loadSeveso();
      } else {
        this.sevesoPanel?.hide({ silent: true });
      }
    }

    // En bref des onglets (20/10/2026) : synthèse de la liste « À traiter » et des pastilles de l'onglet, sans dessin.
    if (key === 'brief') {
      if (enabled) {
        this.themeBriefPanel?.show(this.themeBriefData());
      } else {
        this.themeBriefPanel?.hide({ silent: true });
      }
    }

    // En bref (20/10/2026) : enjeux lus une fois à l'allumage, croisement recalculé à chaque lecture des phénomènes.
    if (key === 'envBrief') {
      if (enabled) {
        this.openEnvBriefPanel();
      } else {
        this.envBriefPanel?.hide({ silent: true });
        this.mapContainer?.updateExposureLayer(null);
      }
    }

    // Panneau Webcams : recensement statique lu une fois à l'ouverture, aucune relève ; masquage silencieux à l'extinction.
    if (key === 'webcams') {
      if (enabled) {
        this.openWebcamsPanel();
      } else {
        this.webcamsPanel?.hide({ silent: true });
        this.webcamWall?.hide();
      }
    }

    // Panneau Flux piétons : index relu toutes les 15 min couche allumée ; masquage silencieux et relève arrêtée à l'extinction.
    if (key === 'pedestrianFlows') {
      if (enabled) {
        this.openFluxPanel();
      } else {
        this.fluxPanel?.hide({ silent: true });
        // Couche rallumée : de nouveau aucune ville choisie.
        this.fluxSelectedId = null;
        this.fluxFeatures = null;
        this.fluxInstant = null;
        this.fluxGeo = 'idle';
      }
      this.syncFluxPolling();
    }

    // All remaining panels use an if/else chain — at most one branch fires per toggle.
    if (key === 'stability') {
      if (this.uiV2) {
        if (this.activeLayers.stability) this.pressurePanel?.show(this.v2Pressure);
        else this.pressurePanel?.hide({ silent: true });
      } else if (this.activeLayers.stability && this.currentISNRData) this.isnrPanel?.show(this.currentISNRData);
      else this.isnrPanel?.hide();
    } else if (key === 'energySystems') {
      // Group master turned off: collapse all energy panels
      if (!this.activeLayers.energySystems) {
        this.energyPanel?.hide();
        this.layoutEnergyFloatingPanels();
      }
    } else if (key === 'environmentGroup') {
      // Maître éteint : les panneaux Environnement masqués (silencieux : les couches gardent leur état), relèves réglées.
      if (!this.activeLayers.environmentGroup) {
        for (const envKey of ENVIRONMENT_LAYER_KEYS) {
          this.getFloatingPanelInstance(envKey)?.hide({ silent: true });
          this.syncEnvironmentPolling(envKey);
        }
      }
    } else if (key === 'health') {
      if (this.activeLayers.health) {
        this.loadHealthSurveillance('all').catch((err) => console.error('[App] Veille sanitaire indisponible', err));
        this.veillePanel?.show(this.currentHealth);
      } else {
        this.veillePanel?.hide({ silent: true });
      }
    } else if (key === 'healthOscour') {
      if (this.activeLayers.healthOscour) {
        this.loadHealthSurveillance(['syndromic', 'alerts']).catch((err) => console.error('[App] Urgences indisponibles', err));
        this.urgencesPanel?.show(this.currentHealth);
      } else {
        this.urgencesPanel?.hide({ silent: true });
      }
    } else if (key === 'healthApl') {
      if (this.activeLayers.healthApl) {
        this.loadHealthOffer().catch((err) => console.error('[App] APL indisponible', err));
        this.accesSoinsPanel?.show(this.currentHealthOffer);
      } else {
        this.accesSoinsPanel?.hide({ silent: true });
      }
    } else if (key === 'hospitals') {
      if (this.activeLayers.hospitals) {
        this.loadHealthOffer().catch((err) => console.error('[App] Hôpitaux indisponibles', err));
        this.hopitauxPanel?.show(this.currentHealthOffer);
      } else {
        this.hopitauxPanel?.hide({ silent: true });
      }
    } else if (key === 'sovereignty') {
      // Maître éteint : les trois panneaux Souveraineté masqués (silencieux : les couches gardent leur état), relèves réglées.
      if (!this.activeLayers.sovereignty) {
        for (const sovKey of SOVEREIGNTY_LAYER_KEYS) {
          this.getFloatingPanelInstance(sovKey)?.hide({ silent: true });
          this.syncSovereigntyPolling(sovKey);
        }
      }
    } else if (key === 'powerGrid') {
      if (this.activeLayers.powerGrid) this.energyPanel?.show(this.currentEcowattResponse);
      else this.energyPanel?.hide();
      this.layoutEnergyFloatingPanels();
    } else if (key === 'dromEnergy') {
      if (this.activeLayers.dromEnergy) {
        void this.loadDromLive();
        if (!this.currentDromEnergyDashboard && !this.currentDromEnergyError) {
          this.dromEnergyPanel?.showLoadingState();
          void this.loadDromEnergy();
        } else if (this.currentDromEnergyDashboard) {
          this.dromEnergyPanel?.show(this.currentDromEnergyDashboard);
        } else if (this.currentDromEnergyError) {
          this.dromEnergyPanel?.showErrorState(this.currentDromEnergyError);
        }
      } else {
        this.dromEnergyPanel?.hide();
      }
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
    } else if (key === 'metroLoad') {
      if (this.activeLayers.metroLoad) {
        void this.loadMetropoles();
        this.metroLoadPanel?.show(this.currentMetropoles);
      } else {
        this.metroLoadPanel?.hide();
      }
      this.layoutEnergyFloatingPanels();
    } else if (key === 'gasNetwork') {
      if (this.activeLayers.gasNetwork) {
        if (!this.currentGasData) this.loadGas(); // lazy-load on first enable
        this.gasPanel?.show(this.currentGasData, this.currentBiogasState);
        this.layoutEnergyFloatingPanels();
      } else {
        this.gasPanel?.hide();
        this.layoutEnergyFloatingPanels();
      }
    } else if (key === 'biomethaneSites') {
      if (this.activeLayers.biomethaneSites) {
        if (!this.currentBiomethaneSites) {
          void this.loadGas(); // lazy-load biomethane alongside gas data
        } else {
          this.mapContainer?.updateBiomethaneSites(this.currentBiomethaneSites);
        }
      }
    } else if (key === 'oilNetwork') {
      if (this.activeLayers.oilNetwork) {
        // Première ouverture, ou données lues sans les fichiers JODI (Vue générale) : relecture complète.
        if (!this.currentOilData || !this.oilReadWithJodi) void this.loadOil();
        this.oilPanel?.show(this.currentOilData, this.currentFuelTensionData);
      } else {
        this.oilPanel?.hide();
      }
    } else if (key === 'nuclearFleet') {
      if (this.activeLayers.nuclearFleet) {
        const nuclearInfra = this.currentNuclearState
          ? buildEnergyInfrastructurePoints(this.currentNuclearState.unavailabilities, this.currentNuclearState.rteAvailable)
          : buildEnergyInfrastructurePoints();
        this.mapContainer?.updateInfrastructure(nuclearInfra);
        if (!this.currentNuclearState) void this.loadNuclear(); // lazy-load on first enable
        this.nuclearPanel?.show(this.currentNuclearState, this.currentEcowattResponse);
        this.layoutEnergyFloatingPanels();
      } else {
        this.nuclearPanel?.hide();
        this.layoutEnergyFloatingPanels();
      }
    } else if (key === 'elus') {
      void this.mapContainer?.setMairesPolitiqueVisible(false);
    } else if (key === 'outages') {
      // Maître éteint : les quatre panneaux masqués (silencieux : les couches gardent leur état), relèves réglées.
      if (!this.activeLayers.outages) {
        for (const outKey of OUTAGES_LAYER_KEYS) {
          this.getFloatingPanelInstance(outKey)?.hide({ silent: true });
          this.syncOutagesPolling(outKey);
        }
      }
    }
  }

  // ─── Lazy panel loaders (perf audit task 5) ──────────────────────────────
  //
  // These 13 panels used to be dynamically imported unconditionally inside
  // renderShell(), so every session downloaded all 13 chunks regardless of
  // whether their layer was ever toggled on. Each ensureXPanel() below loads
  // its chunk once (memoized), on first activation only — dispatched from
  // onLayerToggle()/restoreActiveLayerPanelsAfterRefresh() through
  // ensureLazyPanelForLayer(). Each mirrors the "catch-up" logic the eager
  // versions used to run in their .then() callback (re-checking
  // this.activeLayers.X once the chunk resolves, since the panel object
  // doesn't exist yet when onLayerToggle's synchronous _handlePanelVisibility
  // call runs) — but does NOT re-trigger the underlying data load
  // (loadOil/loadNuclear/loadEolien/loadCyber/refreshHydraulicSignalSources/
  // loadHealthSurveillance/loadHealthOffer/loadDromEnergy), since _handlePanelVisibility already did
  // that on the original toggle; re-triggering here would risk a duplicate
  // in-flight request if the chunk resolves before that fetch completes.

  private ensureDromEnergyPanel(): Promise<void> {
    if (!this.floatContainerEl) return Promise.resolve();
    this.dromEnergyPanelPromise ??= import('./components/DromEnergyPanel.ts').then(({ DromEnergyPanel }) => {
      const panel = new DromEnergyPanel(this.floatContainerEl!);
      panel.setOnClose(() => this.closeEnergyLayer('dromEnergy'));
      panel.setOnHoverAsset((asset) => {
        this.mapContainer?.highlightDromEnergyAsset(asset);
      });
      panel.mount();
      panel.setLive(this.currentDromLive, this.currentDromLiveError);
      this.dromEnergyPanel = panel;
      if (this.activeLayers.dromEnergy) {
        if (this.currentDromEnergyDashboard) panel.show(this.currentDromEnergyDashboard);
        else if (this.currentDromEnergyError) panel.showErrorState(this.currentDromEnergyError);
        else panel.showLoadingState();
        this.layoutEnergyFloatingPanels();
      }
    });
    return this.dromEnergyPanelPromise;
  }

  private ensureHydraulicPanel(): Promise<void> {
    if (!this.floatContainerEl) return Promise.resolve();
    this.hydraulicPanelPromise ??= import('./components/HydraulicPanel.ts').then(({ HydraulicPanel }) => {
      const panel = new HydraulicPanel(this.floatContainerEl!);
      panel.setOnClose(() => this.closeEnergyLayer('hydroBackbone'));
      panel.setOnSelectAsset((asset) => {
        this.mapContainer?.flyTo(asset.location.lon, asset.location.lat, 10.5);
      });
      panel.mount();
      this.hydraulicPanel = panel;
      if (this.activeLayers.hydroBackbone) {
        panel.show(this.currentHydraulicAssets, this.currentEcowattResponse);
        this.layoutEnergyFloatingPanels();
      }
    });
    return this.hydraulicPanelPromise;
  }

  private ensureEolienPanel(): Promise<void> {
    if (!this.floatContainerEl) return Promise.resolve();
    this.eolienPanelPromise ??= import('./components/EolienPanel.ts').then(({ EolienPanel }) => {
      const panel = new EolienPanel(this.floatContainerEl!);
      panel.setOnClose(() => this.closeEnergyLayer('windMonitor'));
      panel.setOnSelectPark((park) => {
        this.mapContainer?.flyTo(park.coordinates[0], park.coordinates[1], 9.8);
      });
      panel.mount();
      panel.setGrid(this.currentEcowattResponse?.grid ?? null);
      this.eolienPanel = panel;
      if (this.activeLayers.windMonitor) {
        panel.show(this.currentEolienLive, this.currentEolienParks);
        this.layoutEnergyFloatingPanels();
      }
    });
    return this.eolienPanelPromise;
  }

  private ensureMetroLoadPanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.metroLoadPanelPromise ??= import('./components/MetroLoadPanel.ts').then(({ MetroLoadPanel }) => {
      const panel = new MetroLoadPanel(container);
      panel.setOnClose(() => this.closeEnergyLayer('metroLoad'));
      panel.mount();
      this.metroLoadPanel = panel;
      if (this.activeLayers.metroLoad) {
        panel.show(this.currentMetropoles);
        this.layoutEnergyFloatingPanels();
      }
    });
    return this.metroLoadPanelPromise;
  }

  private ensureVeillePanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.veillePanelPromise ??= import('./components/VeilleSanitairePanel.ts').then(({ VeilleSanitairePanel }) => {
      const panel = new VeilleSanitairePanel(container);
      panel.setOnClose(() => this.closeHealthLayer('health'));
      panel.mount();
      this.veillePanel = panel;
      if (this.activeLayers.health) panel.show(this.currentHealth);
    });
    return this.veillePanelPromise;
  }

  private ensureUrgencesPanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.urgencesPanelPromise ??= import('./components/UrgencesPanel.ts').then(({ UrgencesPanel }) => {
      const panel = new UrgencesPanel(container);
      panel.setOnClose(() => this.closeHealthLayer('healthOscour'));
      panel.setOnSyndrome((syndrome) => this.mapContainer?.setHealthUrgencesSyndrome(syndrome));
      this.mapContainer?.setHealthUrgencesSyndrome(panel.getSyndrome());
      panel.mount();
      this.urgencesPanel = panel;
      if (this.activeLayers.healthOscour) panel.show(this.currentHealth);
    });
    return this.urgencesPanelPromise;
  }

  private ensureAccesSoinsPanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.accesSoinsPanelPromise ??= import('./components/AccesSoinsPanel.ts').then(({ AccesSoinsPanel }) => {
      const panel = new AccesSoinsPanel(container);
      panel.setOnClose(() => this.closeHealthLayer('healthApl'));
      panel.setOnProfession((profession) => this.mapContainer?.setHealthAplProfession(profession));
      this.mapContainer?.setHealthAplProfession(panel.getProfession());
      panel.mount();
      this.accesSoinsPanel = panel;
      if (this.activeLayers.healthApl) panel.show(this.currentHealthOffer);
    });
    return this.accesSoinsPanelPromise;
  }

  private ensureHopitauxPanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.hopitauxPanelPromise ??= import('./components/HopitauxPanel.ts').then(({ HopitauxPanel }) => {
      const panel = new HopitauxPanel(container);
      panel.setOnClose(() => this.closeHealthLayer('hospitals'));
      // Mobile (carte SVG) : la carte ne recentre pas sur un site, les lignes ne se donnent pas pour cliquables.
      if (this.mapContainer?.canFocusHospital()) panel.setOnSelectSite((site) => this.mapContainer?.focusHospital(site));
      panel.mount();
      this.hopitauxPanel = panel;
      if (this.activeLayers.hospitals) panel.show(this.currentHealthOffer);
    });
    return this.hopitauxPanelPromise;
  }

  /** Croix d'un panneau Santé : éteint sa couche comme une case décochée (persistance, carte, légende, barre des panneaux). */
  private closeHealthLayer(key: HealthLayerKey): void {
    if (!this.activeLayers[key]) return;
    this.onLayerToggle(key, false);
    this.layerPanel?.updateLayers(this.activeLayers);
  }

  /** Lien d'une fiche (thème Santé) vers le panneau d'une couche : active la couche si besoin, puis ouvre son panneau. */
  private openLayerPanelFromFiche(key: string): void {
    const def = FLOATING_PANEL_DEFS.find((d) => d.id === key);
    if (!def) return;
    if (!this.activeLayers[def.id]) this.onLayerToggle(def.id, true, { suppressPanel: true });
    this.layerPanel?.updateLayers(this.activeLayers);
    void Promise.all(this.ensureLazyPanelForLayer(def.id)).then(() => this.showFloatingPanel(def.id));
  }

  /**
   * Sources de veille à relire : toutes pour Veille sanitaire, urgences et alertes pour Urgences ; en v2, fiche thème Santé à
   * l'écran sans couche santé active, les quatre sources de son niveau national ; aucune sinon.
   */
  private healthSurveillanceKeys(): readonly HealthSurveillanceKey[] | 'all' {
    if (this.activeLayers.health) return 'all';
    const keys = new Set<HealthSurveillanceKey>(this.activeLayers.healthOscour ? ['syndromic', 'alerts'] : []);
    // Fiche thème Santé à l'écran, ou Vue générale (niveau national suivi, 12/10/2026) : les sources du niveau national.
    if (this.healthThemeFicheVisible() || (this.uiV2 && this.v2Theme === 'general')) for (const k of HEALTH_NATIONAL_KEYS) keys.add(k);
    return [...keys];
  }

  /** v2 : fiche du thème Santé ouverte (niveau national de santé à l'écran). */
  private healthThemeFicheVisible(): boolean {
    return this.uiV2 && this.poste?.selectedKey() === 'theme:health';
  }

  /**
   * Niveau national de santé de la fiche thème, recalculé à l'instant du rendu (retard S2 réévalué entre deux relèves) une fois
   * la vue Veille chargée ; avant, la dernière valeur connue.
   */
  private healthNationalNow(now: number): NationalHealthSummary | null {
    if (this.currentHealth && this.healthNationalOf) this.currentHealthNational = this.healthNationalOf(this.currentHealth, now);
    return this.currentHealthNational;
  }

  private ensureTrafficPanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.trafficPanelPromise ??= import('./components/TrafficPanel.ts').then(({ TrafficPanel }) => {
      const panel = new TrafficPanel(container);
      panel.setOnClose(() => this.closeTrafficLayer('trafficRoad'));
      if (this.mapContainer?.canFocusMap()) panel.setOnFocusEvent((event) => {
        if (event.lon !== null && event.lat !== null) this.mapContainer?.flyTo(event.lon, event.lat, 12);
      });
      panel.mount();
      this.trafficPanel = panel;
      if (this.activeLayers.trafficRoad) panel.show(this.currentRoadTraffic);
    });
    return this.trafficPanelPromise;
  }

  private ensureAirTrafficPanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.airTrafficPanelPromise ??= import('./components/AirTrafficPanel.ts').then(({ AirTrafficPanel }) => {
      const panel = new AirTrafficPanel(container);
      panel.setOnClose(() => this.closeTrafficLayer('trafficAir'));
      panel.mount();
      this.airTrafficPanel = panel;
      if (this.activeLayers.trafficAir) panel.show(this.currentAirOverview);
    });
    return this.airTrafficPanelPromise;
  }

  private ensureTransportPanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.transportPanelPromise ??= import('./components/TransportPanel.ts').then(({ TransportPanel }) => {
      const panel = new TransportPanel(container);
      panel.setOnClose(() => this.closeTrafficLayer('trafficRail'));
      if (this.mapContainer?.canFocusMap()) {
        panel.setOnSelectTrain((train) => this.focusTrain(train));
        // Survol d'un train : son trajet prévisualisé ; sortie : retour au train choisi ou carte effacée (previewTrainRoute).
        panel.setOnPreviewTrain((train) => this.mapContainer?.previewTrainRoute(train));
      }
      panel.mount();
      this.transportPanel = panel;
      if (this.activeLayers.trafficRail) panel.show(this.currentRailTraffic);
    });
    return this.transportPanelPromise;
  }

  private ensureMaritimePanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.maritimePanelPromise ??= import('./components/MaritimePanel.ts').then(({ MaritimePanel }) => {
      const panel = new MaritimePanel(container);
      panel.setOnClose(() => this.closeTrafficLayer('trafficMaritime'));
      panel.setOnHighlightShip((mmsi) => this.mapContainer?.setHighlightedShip(mmsi));
      panel.setOnSelectShip((ship) => {
        this.mapContainer?.setSelectedShip(ship.mmsi ?? null);
        if (this.mapContainer?.canFocusMap()) this.mapContainer.flyTo(ship.lon, ship.lat, 9);
      });
      panel.mount();
      this.maritimePanel = panel;
      if (this.activeLayers.trafficMaritime) panel.show(this.currentMaritimeSnapshot);
    });
    return this.maritimePanelPromise;
  }

  /**
   * Croix d'un panneau Trafics : éteint sa couche comme une case décochée (persistance, carte, légende, barre des panneaux) ;
   * panneau ouvert depuis le panneau des sources, couche éteinte : sa relève s'arrête avec lui.
   */
  private closeTrafficLayer(key: TrafficLayerKey): void {
    if (this.activeLayers[key]) {
      this.onLayerToggle(key, false);
      this.layerPanel?.updateLayers(this.activeLayers);
    }
    this.syncTrafficPolling(key);
  }

  /**
   * Ouvre le panneau d'une couche Trafics sur ses dernières données (chargement au premier affichage), lit aussitôt sa source et
   * règle sa relève : case cochée, puce, restauration ou ligne du panneau des sources cliquée couche éteinte.
   */
  private openTrafficPanel(key: TrafficLayerKey): void {
    switch (key) {
      case 'trafficRoad': this.trafficPanel?.show(this.currentRoadTraffic); break;
      case 'trafficAir': this.airTrafficPanel?.show(this.currentAirOverview); break;
      case 'trafficRail': this.transportPanel?.show(this.currentRailTraffic); break;
      case 'trafficMaritime': this.maritimePanel?.show(this.currentMaritimeSnapshot); break;
    }
    this.loadTrafficSource(key).catch((err) => console.error(`[App] Lecture ${key} en échec`, err));
    this.syncTrafficPolling(key);
  }

  /** Source du panneau d'une couche Trafics (route, aperçu aérien, rail, instantané AIS). */
  private loadTrafficSource(key: TrafficLayerKey): Promise<void> {
    switch (key) {
      case 'trafficRoad': return this.loadRoadTraffic();
      case 'trafficAir': return this.loadAirOverview();
      case 'trafficRail': return this.loadRailTraffic();
      case 'trafficMaritime': return this.loadMaritimeSnapshot();
    }
  }

  /** Relève voulue : couche active OU panneau ouvert (ligne du panneau des sources cliquée couche éteinte). */
  private trafficPollWanted(key: TrafficLayerKey): boolean {
    return this.activeLayers[key] || (this.getFloatingPanelInstance(key)?.isVisible?.() ?? false) || this.generalWatchPolls(key);
  }

  /**
   * Démarre ou arrête la relève pausable d'une couche Trafics (TRAFFIC_POLL_MS) : elle tourne tant que la couche est active ou que
   * son panneau est ouvert, et s'arrête quand les deux sont éteints (ici, ou au tour suivant après un masquage silencieux).
   */
  private syncTrafficPolling(key: TrafficLayerKey): void {
    const timer = this.trafficPolls[key];
    if (!this.trafficPollWanted(key)) {
      if (timer) {
        this.removePausableInterval(timer);
        delete this.trafficPolls[key];
      }
      return;
    }
    if (timer) return;
    this.trafficPolls[key] = this.registerPausableInterval(() => {
      if (!this.trafficPollWanted(key)) {
        this.syncTrafficPolling(key);
        return;
      }
      this.loadTrafficSource(key).catch((err) => console.error(`[App] Relève ${key} en échec`, err));
    }, TRAFFIC_POLL_MS[key]);
  }

  /**
   * Lecture d'une source Trafics : une seule à la fois par couche (démarrage, restauration, ouverture, relève : un second appelant
   * rejoint la lecture en cours) ; si le service ne se charge pas, toutes les lignes de la couche le disent (S3), quel que soit
   * l'appelant.
   */
  private readTraffic(key: TrafficLayerKey, read: () => Promise<void>): Promise<void> {
    return dedupe(`traffic:${key}`, () => read().catch((err: unknown) => {
      this.markTrafficSourcesFailed(key, err);
      throw err;
    }));
  }

  /**
   * Toutes les lignes d'une couche Trafics (TRAFFIC_LAYER_SOURCES : « TomTom agglomérations » et « SIRI SX » comprises) quand son
   * service ne se charge pas : une ligne déjà datée garde sa date et passe « stale », sinon « error » sans heure inventée.
   */
  private markTrafficSourcesFailed(key: TrafficLayerKey, err: unknown): void {
    const error = err instanceof Error ? err.message : 'service de la source introuvable';
    for (const name of TRAFFIC_LAYER_SOURCES[key]) {
      const dated = this.statusPanel?.getSources().find((s) => s.name === name)?.lastUpdate ?? null;
      this.statusPanel?.updateSource(name, dated !== null ? { status: 'stale', error } : { status: 'error', lastUpdate: null, period: undefined, error });
    }
  }

  // ─── Environnement (spec 2026-10-04 environnement § 2, § 3) : Vigilance météo, Crues, Radar météo, Feux de forêt, Sécheresse, Qualité de l'air, Séismes ───

  private ensureVigilancePanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.vigilancePanelPromise ??= import('./components/VigilancePanel.ts').then(({ VigilancePanel }) => {
      const panel = new VigilancePanel(container);
      panel.setOnClose(() => this.closeEnvironmentLayer('environmental'));
      // Département choisi : bulletin départemental dans le panneau, surbrillance sur la carte (sans carte : le bulletin seul).
      panel.setOnSelectDepartment((code) => {
        this.selectedVigilanceDept = code;
        this.mapContainer?.selectWeatherDepartment(code);
      });
      panel.setOnEcheance((echeance) => {
        this.vigilanceEcheance = echeance;
        // Carte repeinte à l'échéance choisie, département choisi gardé en surbrillance.
        void this.mapContainer?.updateVigilanceLayer(this.currentVigilance?.vigilance.data ?? null, echeance, Date.now())
          .then(() => this.mapContainer?.selectWeatherDepartment(this.selectedVigilanceDept))
          // Carte non repeinte : tracé ; le panneau reste sur l'échéance choisie et la prochaine lecture repeindra la carte.
          .catch((err: unknown) => console.error('[App] Carte de vigilance non repeinte', err));
        this.refreshEnvironmentLegend();
      });
      // Lignes de marégraphes cliquables avec la carte WebGL seulement (arbitrage 12).
      if (this.mapContainer?.canFocusMap()) panel.setOnFocusGauge((id) => this.focusGauge(id));
      panel.mount();
      this.vigilancePanel = panel;
      if (this.activeLayers.environmental) panel.show({ vigilance: this.currentVigilance, seaLevels: this.currentSeaLevels });
    });
    return this.vigilancePanelPromise;
  }

  private ensureFloodsPanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.floodsPanelPromise ??= import('./components/FloodsPanel.ts').then(({ FloodsPanel }) => {
      const panel = new FloodsPanel(container);
      panel.setOnClose(() => this.closeEnvironmentLayer('floods'));
      if (this.mapContainer?.canFocusMap()) {
        // Second clic sur le tronçon déjà sélectionné : sélection quittée (sortie sans chercher la croix).
        panel.setOnFocusSection((id) => {
          if (this.mapContainer?.highlightedFloodSection() === id) {
            this.mapContainer.highlightFloodSection(null);
            return;
          }
          this.mapContainer?.highlightFloodSection(id);
          this.mapContainer?.focusFloodSection(id);
        });
        panel.setOnFocusPoint((lon, lat) => this.mapContainer?.focusPoint(lon, lat, 13));
        panel.setOnFocusStation((code) => {
          const station = this.currentFloods?.floods.data?.sections.flatMap((s) => s.stations).find((s) => s.code === code);
          if (station && station.lat !== null && station.lon !== null) this.mapContainer?.flyTo(station.lon, station.lat, 11);
        });
      }
      panel.setOnToggleZones((on) => this.setFloodZonesOn(on));
      panel.mount();
      this.floodsPanel = panel;
      if (this.activeLayers.floods) {
        panel.show(this.currentFloods);
        this.ensureExposureData();
        this.refreshFloodImpact();
      }
    });
    return this.floodsPanelPromise;
  }

  private ensureWeatherRadarPanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.weatherRadarPanelPromise ??= import('./components/WeatherRadarPanel.ts').then(({ WeatherRadarPanel }) => {
      const panel = new WeatherRadarPanel(container);
      panel.setOnClose(() => this.closeEnvironmentLayer('weatherRadar'));
      panel.setOnEchoTops((on) => this.setEchoTops(on));
      panel.mount();
      this.weatherRadarPanel = panel;
      if (this.activeLayers.weatherRadar) panel.show(this.radarPanelState());
    });
    return this.weatherRadarPanelPromise;
  }

  private ensureFiresPanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.firesPanelPromise ??= import('./components/FiresPanel.ts').then(({ FiresPanel }) => {
      const panel = new FiresPanel(container);
      panel.setOnClose(() => this.closeEnvironmentLayer('fires'));
      if (this.mapContainer?.canFocusMap()) {
        panel.setOnFocusFoyer((foyer) => {
          this.mapContainer?.highlightFoyer(foyer.id);
          this.mapContainer?.flyTo(foyer.lon, foyer.lat, 10);
        });
      }
      panel.setOnEchoTops((on) => this.setEchoTops(on));
      panel.setOnGibs((on) => {
        this.gibsEnabled = on;
        this.mapContainer?.setModisOverlayVisible(on);
        this.firesPanel?.update(this.firesPanelState());
      });
      panel.setOnMtgFrp((on) => {
        this.mtgFrpEnabled = on;
        if (on) void this.loadMtgFrpMetadata().catch((error) => console.error('[App] MTG-FRP activation failed', error));
        else this.mapContainer?.setMtgFrpEnabled(false);
        this.firesPanel?.update(this.firesPanelState());
      });
      panel.setOnForestDangerFill((on) => {
        this.forestDangerFill = on;
        this.mapContainer?.updateFiresLayer(this.currentFires?.fires.data ?? null, Date.now(), { forestDangerFill: on });
        this.refreshEnvironmentLegend();
        this.firesPanel?.update(this.firesPanelState());
      });
      panel.mount();
      this.firesPanel = panel;
      if (this.activeLayers.fires) panel.show(this.firesPanelState());
    });
    return this.firesPanelPromise;
  }

  private ensureDroughtPanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.droughtPanelPromise ??= import('./components/DroughtPanel.ts').then(({ DroughtPanel }) => {
      const panel = new DroughtPanel(container);
      panel.setOnClose(() => this.closeEnvironmentLayer('drought'));
      if (this.mapContainer?.canFocusMap()) panel.setOnFocusDepartment((code) => this.focusDepartment(code));
      panel.mount();
      this.droughtPanel = panel;
      if (this.activeLayers.drought) panel.show(this.currentDrought);
    });
    return this.droughtPanelPromise;
  }

  private ensureAirQualityPanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.airQualityPanelPromise ??= import('./components/AirQualityPanel.ts').then(({ AirQualityPanel }) => {
      const panel = new AirQualityPanel(container);
      panel.setOnClose(() => this.closeEnvironmentLayer('airQuality'));
      panel.mount();
      this.airQualityPanel = panel;
      if (this.activeLayers.airQuality) panel.show(this.currentAirQuality);
    });
    return this.airQualityPanelPromise;
  }

  private ensureEarthquakesPanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.earthquakesPanelPromise ??= import('./components/EarthquakesPanel.ts').then(({ EarthquakesPanel }) => {
      const panel = new EarthquakesPanel(container);
      panel.setOnClose(() => this.closeEnvironmentLayer('earthquakes'));
      if (this.mapContainer?.canFocusMap()) panel.setOnFocusQuake((quake) => this.mapContainer?.flyTo(quake.lon, quake.lat, 9));
      panel.mount();
      this.earthquakesPanel = panel;
      if (this.activeLayers.earthquakes) panel.show(this.currentEarthquakes);
    });
    return this.earthquakesPanelPromise;
  }

  private ensureDisastersPanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.disastersPanelPromise ??= import('./components/DisastersPanel.ts').then(({ DisastersPanel }) => {
      const panel = new DisastersPanel(container);
      panel.setOnClose(() => this.closeEnvironmentLayer('disasters'));
      if (this.mapContainer?.canFocusMap()) panel.setOnFocusAlert((alert) => this.mapContainer?.flyTo(alert.lon, alert.lat, 6));
      panel.mount();
      this.disastersPanel = panel;
      if (this.activeLayers.disasters) panel.show(this.currentDisasters);
    });
    return this.disastersPanelPromise;
  }

  /** Département cliqué dans un panneau Environnement : la carte se centre sur son centroïde. */
  private focusDepartment(code: string): void {
    const c = departementCentroid(code);
    if (c) this.mapContainer?.flyTo(c[0], c[1], 8);
  }

  /** Marégraphe cliqué dans la section Submersion marine : la carte se centre sur le port. */
  private focusGauge(id: number): void {
    const g = this.currentSeaLevels?.seaLevels.data?.gauges.find((x) => x.id === id);
    if (g) this.mapContainer?.flyTo(g.lon, g.lat, 10);
  }

  /** Marégraphes voulus : couche Vigilance active ou panneau ouvert (contrats § 0.7) ; jamais lus pour le score. */
  private seaLevelsWanted(): boolean {
    return this.activeLayers.environmental || (this.vigilancePanel?.isVisible() ?? false);
  }

  /** Couche Vigilance : carte et textes à chaque relève ; marégraphes en plus quand ils sont voulus (relève de 5 min, cache client de 8 min). */
  private loadVigilanceAndSeaLevels(): Promise<void> {
    const seaLevels = this.seaLevelsWanted()
      ? this.loadSeaLevels().catch((err: unknown) => console.error('[App] Lecture des marégraphes en échec', err))
      : Promise.resolve();
    return Promise.all([this.loadVigilance(), seaLevels]).then(() => undefined);
  }

  /** Croix d'un panneau Environnement : éteint sa couche comme une case décochée ; panneau ouvert couche éteinte : relève réglée. */
  private closeEnvironmentLayer(key: EnvironmentLayerKey): void {
    if (this.activeLayers[key]) {
      this.onLayerToggle(key, false);
      this.layerPanel?.updateLayers(this.activeLayers);
    }
    this.syncEnvironmentPolling(key);
  }

  /**
   * Ouvre le panneau d'une couche Environnement sur ses dernières données (chargement au premier affichage), lit aussitôt sa source
   * et règle sa relève : case cochée, puce, restauration ou ligne du panneau des sources cliquée couche éteinte.
   */
  private openEnvironmentPanel(key: EnvironmentLayerKey): void {
    switch (key) {
      case 'environmental': this.vigilancePanel?.show({ vigilance: this.currentVigilance, seaLevels: this.currentSeaLevels }); break;
      case 'floods': this.floodsPanel?.show(this.currentFloods); this.ensureExposureData(); this.refreshFloodImpact(); break;
      case 'weatherRadar': this.weatherRadarPanel?.show(this.radarPanelState()); break;
      case 'fires': this.firesPanel?.show(this.firesPanelState()); break;
      case 'drought': this.droughtPanel?.show(this.currentDrought); break;
      case 'airQuality': this.airQualityPanel?.show(this.currentAirQuality); break;
      case 'earthquakes': this.earthquakesPanel?.show(this.currentEarthquakes); break;
      case 'disasters': this.disastersPanel?.show(this.currentDisasters); break;
    }
    this.loadEnvironmentSource(key).catch((err) => console.error(`[App] Lecture ${key} en échec`, err));
    this.syncEnvironmentPolling(key);
    // Couche Feux : le manifeste radar est relevé tant que les sommets d'écho sont cochés (environmentPollWanted).
    if (key === 'fires') this.syncEnvironmentPolling('weatherRadar');
  }

  /** Source du panneau d'une couche Environnement. */
  private loadEnvironmentSource(key: EnvironmentLayerKey): Promise<void> {
    switch (key) {
      case 'environmental': return this.loadVigilanceAndSeaLevels();
      case 'floods': return this.loadFloods();
      case 'weatherRadar': return this.loadRadarManifest();
      case 'fires': return this.loadFires();
      case 'drought': return this.loadDrought();
      case 'airQuality': return this.loadAirQuality();
      case 'earthquakes': return this.loadEarthquakes();
      case 'disasters': return this.loadDisasters();
    }
  }

  /**
   * Relève voulue : vigilance, crues, feux, qualité de l'air et séismes toujours (score et situations, ENVIRONMENT_ALWAYS_POLLED) ; radar et
   * sécheresse si leur couche est active ou leur panneau ouvert ; radar aussi avec la couche Feux active et les sommets d'écho cochés.
   */
  private environmentPollWanted(key: EnvironmentLayerKey): boolean {
    if (ENVIRONMENT_ALWAYS_POLLED.has(key) || this.activeLayers[key] || this.generalWatchPolls(key)) return true;
    if (this.getFloatingPanelInstance(key)?.isVisible?.() ?? false) return true;
    return key === 'weatherRadar' && this.activeLayers.fires && this.echoTopsEnabled;
  }

  /** Démarre ou arrête la relève pausable d'une couche Environnement (ENVIRONMENT_POLL_MS), comme syncTrafficPolling. */
  private syncEnvironmentPolling(key: EnvironmentLayerKey): void {
    const timer = this.environmentPolls[key];
    if (!this.environmentPollWanted(key)) {
      if (timer) {
        this.removePausableInterval(timer);
        delete this.environmentPolls[key];
      }
      return;
    }
    if (timer) return;
    this.environmentPolls[key] = this.registerPausableInterval(() => {
      if (!this.environmentPollWanted(key)) {
        this.syncEnvironmentPolling(key);
        return;
      }
      // La relève est la seule lecture qui force le manifeste radar (cadence de 5 min du worker) ; les autres passent par le cache.
      const read = key === 'weatherRadar' ? this.loadRadarManifest(true) : this.loadEnvironmentSource(key);
      read.catch((err) => console.error(`[App] Relève ${key} en échec`, err));
    }, ENVIRONMENT_POLL_MS[key]);
  }

  /**
   * Lecture d'une source Environnement : une seule à la fois par couche (démarrage, ouverture, relève : un second appelant rejoint la
   * lecture en cours) ; si le service ne se charge pas, toutes les lignes de la couche le disent (S3).
   */
  private readEnvironment(key: EnvironmentLayerKey, read: () => Promise<void>): Promise<void> {
    return dedupe(`environment:${key}`, () => read().catch((err: unknown) => {
      this.markEnvironmentSourcesFailed(key, err);
      throw err;
    }));
  }

  /** Lignes d'une couche Environnement quand son service ne se charge pas : une ligne datée garde sa date (« stale »), sinon « error ». */
  private markEnvironmentSourcesFailed(key: EnvironmentLayerKey, err: unknown): void {
    const error = err instanceof Error ? err.message : 'service de la source introuvable';
    for (const name of ENVIRONMENT_LAYER_SOURCES[key]) {
      const dated = this.statusPanel?.getSources().find((s) => s.name === name)?.lastUpdate ?? null;
      this.statusPanel?.updateSource(name, dated !== null ? { status: 'stale', error } : { status: 'error', lastUpdate: null, period: undefined, error });
    }
  }

  /** Historique de qualité des sources Environnement hors Watchdog (même store que la santé et les trafics). */
  private recordEnvironmentSamples(now: number): void {
    recordStatusSamples(this.statusPanel?.getSources().filter((s) => ENVIRONMENT_SOURCE_NAMES.includes(s.name)) ?? [], now);
  }

  /**
   * Légendes Environnement datées par leur donnée (S1) puis montrées selon leur couche ; avant toute lecture, la légende de base
   * (jamais « indisponible » pour une source qui charge).
   */
  private refreshEnvironmentLegend(): void {
    if (!this.mapLegend) return;
    const now = Date.now();
    const manifest = this.radarManifest?.configured ? this.radarManifest.manifest : null;
    const shown = (key: EnvironmentLayerKey): boolean => this.activeLayers.environmentGroup && this.activeLayers[key];
    const vigilance = this.currentVigilance ? vigilanceLegend(this.currentVigilance.vigilance.data, this.vigilanceEcheance, now) : VIGILANCE_LEGEND;
    // Remplissages départementaux visibles, dans l'ordre de la carte et de l'infobulle : la qualité de l'air masque la sécheresse.
    this.fillOrder = (['drought', 'airQuality'] as const).filter((k) => shown(k));
    // Toutes les catégories (identifiants = clés des couches) d'un seul coup : une reconstruction de la légende par appel.
    this.mapLegend.setCategories([
      // Marégraphes (section Submersion marine) : élément et date de la dernière mesure, une fois lus (arbitrage 13).
      {
        ...(this.currentSeaLevels ? withTideGauges(vigilance, this.currentSeaLevels.seaLevels.data, now) : vigilance),
        visible: shown('environmental'),
      },
      { ...(this.currentFloods ? floodsLegend(this.currentFloods.floods.data, now) : FLOODS_LEGEND), visible: shown('floods') },
      {
        ...(this.radarManifest !== null || this.radarError !== null ? radarLegend(manifest, this.echoTopsEnabled, now) : RADAR_LEGEND),
        visible: shown('weatherRadar'),
      },
      { ...(this.currentFires ? firesLegend(this.currentFires.fires.data, this.forestDangerFill, now) : FIRES_LEGEND), visible: shown('fires') },
      { ...withFillMask(this.currentDrought ? droughtLegend(this.currentDrought.drought.data, now) : DROUGHT_LEGEND, this.fillOrder), visible: shown('drought') },
      { ...withFillMask(this.currentAirQuality ? airQualityLegend(this.currentAirQuality.air.data, now) : AIR_QUALITY_LEGEND, this.fillOrder), visible: shown('airQuality') },
      { ...(this.currentEarthquakes ? earthquakesLegend(this.currentEarthquakes.quakes.data, now) : EARTHQUAKES_LEGEND), visible: shown('earthquakes') },
      { ...(this.currentDisasters ? disastersLegend(this.currentDisasters.disasters.data, now) : DISASTERS_LEGEND), visible: shown('disasters') },
    ]);
  }

  // ─── Souveraineté (spec 2026-10-04 souveraineté § 2 ; contrats § 4.4) : Défense, Connectivité, Vigilance cyber ───

  private ensureDefensePanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    // La liste interne des sites est lue avant le panneau : la section « Sites de défense » n'affiche jamais un compte vide.
    this.defensePanelPromise ??= Promise.all([import('./components/DefensePanel.ts'), this.loadDefenseSites()]).then(([{ DefensePanel }]) => {
      const panel = new DefensePanel(container);
      panel.setOnClose(() => this.closeSovereigntyLayer('military'));
      // Lignes recentrées sur la carte WebGL seulement (mobile : aucun rendu de la souveraineté sur la carte) : tout aéronef et toute urgence.
      if (this.mapContainer?.canFocusMap()) {
        panel.setOnFocusAircraft((aircraft) => this.mapContainer?.flyTo(aircraft.lon, aircraft.lat, 9));
        panel.setOnFocusEmergency((emergency) => this.mapContainer?.flyTo(emergency.lon, emergency.lat, 9));
        panel.setOnFocusNavy((ship) => this.mapContainer?.flyTo(ship.lon, ship.lat, 10));
        // Phase B : seules les mailles du jour UTC précédent ont une ligne (O17 : jamais un lieu en direct).
        panel.setOnFocusGnssCell((cell) => this.focusGnssCell(cell));
      }
      panel.setOnOsmWorks((on) => this.setOsmWorks(on));
      panel.setOnDroneZones((on) => this.setDroneZones(on));
      panel.mount();
      this.defensePanel = panel;
      panel.setPressEvents(this.v2EventsState?.events ?? []);
      if (this.activeLayers.military) panel.show(this.defensePanelStateB());
    });
    return this.defensePanelPromise;
  }

  private ensureConnectivityPanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.connectivityPanelPromise ??= import('./components/ConnectivityPanel.ts').then(({ ConnectivityPanel }) => {
      const panel = new ConnectivityPanel(container);
      panel.setOnClose(() => this.closeSovereigntyLayer('subseaCables'));
      if (this.mapContainer?.canFocusMap()) {
        panel.setOnFocusCable((id) => this.mapContainer?.highlightCable(id));
        panel.setOnFocusLanding((landing) => this.mapContainer?.flyTo(landing.lon, landing.lat, 10));
        panel.setOnFocusVessel((alert) => this.mapContainer?.flyTo(alert.lon, alert.lat, 11));
      }
      panel.mount();
      this.connectivityPanel = panel;
      if (this.activeLayers.subseaCables) panel.show(this.connectivityPanelStateB());
    });
    return this.connectivityPanelPromise;
  }

  private ensureCyberPanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.cyberPanelPromise ??= import('./components/CyberPanel.ts').then(({ CyberPanel }) => {
      const panel = new CyberPanel(container);
      panel.setOnClose(() => this.closeSovereigntyLayer('cyber'));
      panel.mount();
      this.cyberPanel = panel;
      panel.setPressEvents(this.v2EventsState?.events ?? []);
      if (this.activeLayers.cyber) panel.show(this.currentSovCyber);
    });
    return this.cyberPanelPromise;
  }

  /** Panneau d'une couche Souveraineté, créé à la demande. */
  private ensureSovereigntyPanel(key: SovereigntyLayerKey): Promise<void> {
    switch (key) {
      case 'military': return this.ensureDefensePanel();
      case 'subseaCables': return this.ensureConnectivityPanel();
      case 'cyber': return this.ensureCyberPanel();
    }
  }

  /** Croix d'un panneau Souveraineté : éteint sa couche comme une case décochée ; panneau ouvert couche éteinte : relève réglée. */
  private closeSovereigntyLayer(key: SovereigntyLayerKey): void {
    if (this.activeLayers[key]) {
      this.onLayerToggle(key, false);
      this.layerPanel?.updateLayers(this.activeLayers);
    }
    this.syncSovereigntyPolling(key);
  }

  /**
   * Ouvre le panneau d'une couche Souveraineté sur ses dernières données, lit aussitôt sa source et règle sa relève : case cochée, puce,
   * restauration, clic sur la carte, ligne du panneau des sources ou bouton du baromètre (couche éteinte possible).
   */
  private openSovereigntyPanel(key: SovereigntyLayerKey): void {
    switch (key) {
      case 'military': this.defensePanel?.show(this.defensePanelStateB()); break;
      case 'subseaCables': this.connectivityPanel?.show(this.connectivityPanelStateB()); break;
      case 'cyber': this.cyberPanel?.show(this.currentSovCyber); break;
    }
    // Défense : la Marine nationale vient du WebSocket AIS du navigateur (connectAis() est idempotent).
    if (key === 'military') connectAis();
    this.loadSovereigntySourceB(key).catch((err) => console.error(`[App] Lecture ${key} en échec`, err));
    this.syncSovereigntyPolling(key);
  }

  /** Panneau d'une couche Souveraineté ouvert depuis la carte ou le baromètre, couche éteinte possible : un seul panneau à la fois. */
  private showSovereigntyPanel(key: SovereigntyLayerKey): void {
    this.syncV2ColumnVars();
    this.hideAllFloatingPanels(key);
    void this.ensureSovereigntyPanel(key).then(() => this.openSovereigntyPanel(key));
    this.currentFloatingPanelId = key;
    this.refreshFloatingPanelSwitcher();
  }

  // ─── Pannes réseau (spec 2026-10-08 panneaux pannes § 4) : Électricité, Télécoms, Internet, Cloud ───

  /** État du panneau Télécoms : la dernière lecture, ou une lecture vide (le panneau dit « chargement… ») avant la première. */
  private outagesTelecomState(): TelecomState {
    return this.currentOutTelecom ?? { telecom: emptySlot() };
  }

  private outagesPowerState(): PowerState {
    return this.currentOutPower ?? { power: emptySlot() };
  }

  private outagesInternetState(): InternetState {
    return this.currentOutInternet ?? { internet: emptySlot() };
  }

  private outagesCloudState(): CloudState {
    return this.currentOutCloud ?? { cloud: emptySlot() };
  }

  /** Panneau d'une couche Pannes réseau, créé à la demande. */
  private ensureOutagesLayerPanel(key: OutagesLayerKey): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    if (key === 'outagesTelecom') {
      this.outagesPanelPromises.outagesTelecom ??= import('./components/OutagesTelecomPanel.ts').then(({ OutagesTelecomPanel }) => {
        const panel = new OutagesTelecomPanel(container);
        panel.setOnClose(() => this.closeOutagesLayer('outagesTelecom'));
        // Lignes recentrées sur la carte WebGL seulement ; l'option des maintenances n'existe que là.
        if (this.mapContainer?.canFocusMap()) {
          panel.setOnFocusSite((lat, lon) => this.mapContainer?.flyTo(lon, lat, 11));
          panel.setOnFocusDept((dept) => this.focusDepartment(dept));
          panel.setOnToggleMaintenance((on) => this.mapContainer?.setTelecomMaintenanceVisible(on));
        }
        panel.mount();
        this.outagesTelecomPanel = panel;
        if (this.activeLayers.outagesTelecom) panel.show(this.outagesTelecomState());
      });
      return this.outagesPanelPromises.outagesTelecom;
    }
    if (key === 'outagesElec') {
      this.outagesPanelPromises.outagesElec ??= import('./components/OutagesPowerPanel.ts').then(({ OutagesPowerPanel }) => {
        const panel = new OutagesPowerPanel(container);
        panel.setOnClose(() => this.closeOutagesLayer('outagesElec'));
        // Une tranche nucléaire ouvre le panneau Parc nucléaire (couche activée comme une case cochée).
        panel.setOnOpenNuclear(() => {
          this.onLayerToggle('nuclearFleet', true);
          this.layerPanel?.updateLayers(this.activeLayers);
        });
        if (this.mapContainer?.canFocusMap()) panel.setOnFocusUnit((name) => this.mapContainer?.flyToAsset(name));
        panel.mount();
        this.outagesPowerPanel = panel;
        if (this.activeLayers.outagesElec) panel.show(this.outagesPowerState(), this.currentEcowattResponse?.official ?? null);
      });
      return this.outagesPanelPromises.outagesElec;
    }
    if (key === 'outagesInternet') {
      this.outagesPanelPromises.outagesInternet ??= import('./components/OutagesInternetPanel.ts').then(({ OutagesInternetPanel }) => {
        const panel = new OutagesInternetPanel(container);
        panel.setOnClose(() => this.closeOutagesLayer('outagesInternet'));
        // Départements recentrés sur la carte WebGL seulement ; le rappel RIPEstat ouvre le panneau Connectivité partout (couche cochée
        // comme une case, tiroir à jour, P35).
        if (this.mapContainer?.canFocusMap()) panel.setOnFocusDept((dept) => this.focusDepartment(dept));
        panel.setOnOpenConnectivity(() => {
          this.onLayerToggle('subseaCables', true);
          this.layerPanel?.updateLayers(this.activeLayers);
        });
        panel.mount();
        this.outagesInternetPanel = panel;
        if (this.activeLayers.outagesInternet) panel.show(this.outagesInternetState());
      });
      return this.outagesPanelPromises.outagesInternet;
    }
    this.outagesPanelPromises.outagesCloud ??= import('./components/OutagesCloudPanel.ts').then(({ OutagesCloudPanel }) => {
      const panel = new OutagesCloudPanel(container);
      panel.setOnClose(() => this.closeOutagesLayer('outagesCloud'));
      if (this.mapContainer?.canFocusMap()) panel.setOnFocusZone((lat, lon) => this.mapContainer?.flyTo(lon, lat, 9));
      panel.mount();
      this.outagesCloudPanel = panel;
      if (this.activeLayers.outagesCloud) panel.show(this.outagesCloudState());
    });
    return this.outagesPanelPromises.outagesCloud;
  }

  /** Croix d'un panneau Pannes réseau : éteint sa couche comme une case décochée ; panneau ouvert couche éteinte : relève réglée. */
  private closeOutagesLayer(key: OutagesLayerKey): void {
    if (this.activeLayers[key]) {
      this.onLayerToggle(key, false);
      this.layerPanel?.updateLayers(this.activeLayers);
    }
    this.syncOutagesPolling(key);
  }

  /**
   * Ouvre le panneau d'une couche Pannes réseau sur ses dernières données, repeint la carte (rien d'autre ne la repeint à la
   * réactivation, R35), lit aussitôt la source et règle la relève : case cochée, restauration ou ligne du panneau des sources.
   */
  private openOutagesPanel(key: OutagesLayerKey): void {
    if (key === 'outagesTelecom') this.outagesTelecomPanel?.show(this.outagesTelecomState());
    if (key === 'outagesElec') this.outagesPowerPanel?.show(this.outagesPowerState(), this.currentEcowattResponse?.official ?? null);
    if (key === 'outagesInternet') this.outagesInternetPanel?.show(this.outagesInternetState());
    if (key === 'outagesCloud') this.outagesCloudPanel?.show(this.outagesCloudState());
    this.repaintOutagesMap(key);
    this.loadOutagesSource(key).catch((err) => console.error(`[App] Lecture ${key} en échec`, err));
    this.syncOutagesPolling(key);
  }

  /** Carte : données de la dernière lecture de la couche, couleurs recalculées à l'horloge courante (retard compris). */
  private repaintOutagesMap(key: OutagesLayerKey): void {
    const now = Date.now();
    if (key === 'outagesTelecom' && this.currentOutTelecom) this.mapContainer?.updateOutagesTelecom(this.currentOutTelecom.telecom.data, now);
    if (key === 'outagesElec' && this.currentOutPower) this.mapContainer?.updateOutagesPower(this.currentOutPower.power.data, now);
    if (key === 'outagesInternet' && this.currentOutInternet) this.mapContainer?.updateOutagesInternet(this.currentOutInternet.internet.data, now);
    if (key === 'outagesCloud' && this.currentOutCloud) this.mapContainer?.updateOutagesCloud(this.currentOutCloud.cloud.data, now);
  }

  /**
   * Relève voulue : Télécoms nourrit le score (OUTAGES_ALWAYS_POLLED, R16) ; Électricité, Internet et Cloud couche active ou panneau
   * ouvert, jamais couche éteinte (le cloud n'entre pas au score).
   */
  private outagesPollWanted(key: OutagesLayerKey): boolean {
    if (OUTAGES_ALWAYS_POLLED.has(key) || this.activeLayers[key] || this.generalWatchPolls(key)) return true;
    return this.getFloatingPanelInstance(key)?.isVisible?.() ?? false;
  }

  /** Démarre ou arrête la relève pausable d'une couche Pannes réseau (OUTAGES_POLL_MS), comme syncSovereigntyPolling. */
  private syncOutagesPolling(key: OutagesLayerKey): void {
    const timer = this.outagesPolls[key];
    if (!this.outagesPollWanted(key)) {
      if (timer) {
        this.removePausableInterval(timer);
        delete this.outagesPolls[key];
      }
      return;
    }
    if (timer) return;
    this.outagesPolls[key] = this.registerPausableInterval(() => {
      if (!this.outagesPollWanted(key)) {
        this.syncOutagesPolling(key);
        return;
      }
      this.loadOutagesSource(key).catch((err) => console.error(`[App] Relève ${key} en échec`, err));
    }, OUTAGES_POLL_MS[key]);
  }

  /**
   * Lecture d'une couche Pannes réseau : une seule à la fois par couche (démarrage, ouverture, relève : un second appelant rejoint la
   * lecture en cours) ; panneau, carte, lignes du panneau des sources et score mis à jour ; si le service ne se charge pas, les lignes
   * de la couche le disent (S3).
   */
  private loadOutagesSource(key: OutagesLayerKey): Promise<void> {
    return dedupe(`outages:${key}`, async () => {
      try {
        const now = Date.now();
        if (key === 'outagesTelecom') {
          this.currentOutTelecom = mergeTelecom(this.currentOutTelecom, await fetchTelecom(this.currentOutTelecom, now));
          this.outagesTelecomPanel?.update(this.currentOutTelecom);
          this.mapContainer?.updateOutagesTelecom(this.currentOutTelecom.telecom.data, now);
          this.statusPanel?.updateSource('ARCEP sites mobiles', arcepStatus(this.currentOutTelecom, now));
        } else if (key === 'outagesElec') {
          this.currentOutPower = mergePower(this.currentOutPower, await fetchPower(this.currentOutPower, now));
          this.outagesPowerPanel?.update(this.currentOutPower, this.currentEcowattResponse?.official ?? null);
          this.mapContainer?.updateOutagesPower(this.currentOutPower.power.data, now);
          this.statusPanel?.updateSource('EDF indisponibilités', edfStatus(this.currentOutPower, now));
          this.statusPanel?.updateSource('RTE IIP', iipStatus(this.currentOutPower, now));
          this.statusPanel?.updateSource('EDF SEI (îles)', seiStatus(this.currentOutPower, now));
        } else if (key === 'outagesInternet') {
          this.currentOutInternet = mergeInternet(this.currentOutInternet, await fetchInternet(this.currentOutInternet, now));
          this.outagesInternetPanel?.update(this.currentOutInternet);
          this.mapContainer?.updateOutagesInternet(this.currentOutInternet.internet.data, now);
          this.statusPanel?.updateSource('IODA', iodaStatus(this.currentOutInternet, now));
          this.statusPanel?.updateSource('Cloudflare Radar', cloudflareRadarStatus(this.currentOutInternet, now));
        } else {
          this.currentOutCloud = mergeCloud(this.currentOutCloud, await fetchCloud(this.currentOutCloud, now));
          this.outagesCloudPanel?.update(this.currentOutCloud);
          this.mapContainer?.updateOutagesCloud(this.currentOutCloud.cloud.data, now);
          this.statusPanel?.updateSource('Pages d’état cloud', cloudStatus(this.currentOutCloud, now));
        }
        // Radar sans jeton (ligne « non configuré », statut ok) : hors de l'historique de qualité, qu'il gonflerait (P34).
        recordStatusSamples(this.statusPanel?.getSources()
          .filter((s) => OUTAGES_SOURCE_NAMES.includes(s.name) && (s.name !== 'Cloudflare Radar' || !this.radarNotConfigured())) ?? [], now);
        this.refreshFranceIntelPanel();
      } catch (err) {
        this.markOutagesSourcesFailed(key, err);
        throw err;
      }
    });
  }

  /** Panne en cours la plus grave (niveau de l'onglet Pannes) ; null sans réponse. */
  private outagesNowLevel(): VigilanceLevel | null {
    return this.outagesNow?.level() ?? null;
  }

  /** Pannes en cours : bandeau dans tous les onglets, control room dans l'onglet Pannes (21/10/2026). Chargé à part (chunk App < 1 Mio). */
  private mountOutagesNow(mapEl: HTMLElement): void {
    void import('./components/outages-room/outages-now-controller.ts').then(async ({ OutagesNowController }) => {
      this.outagesNow?.destroy();
      const map = this.mapContainer;
      this.outagesNow = new OutagesNowController<PausableTimer>({
        mapEl,
        map: {
          setOutagesRoom: (state) => map?.setOutagesRoom(state),
          flyTo: (lon, lat, zoom) => map?.flyTo(lon, lat, zoom),
          refitFrance: () => map?.refitFrance(),
        },
        schedule: (fn, ms) => this.registerPausableInterval(fn, ms),
        unschedule: (timer) => this.removePausableInterval(timer),
        onLevelChange: () => this.repaintPoste(),
      });
      await this.outagesNow.start();
      this.syncOutagesRoom();
    }).catch((err) => console.error('[App] Pannes en cours indisponibles', err));
  }

  /** Control room montée seulement dans l'onglet Pannes (v2). */
  private syncOutagesRoom(): void {
    void this.outagesNow?.setRoomActive(this.uiV2 && this.v2Theme === 'outages');
  }

  /** Jeton Cloudflare Radar absent d'après la dernière réponse lue (inconnu tant qu'aucune réponse n'est lisible). */
  private radarNotConfigured(): boolean {
    return this.currentOutInternet?.internet.data?.radar.configured === false;
  }

  /**
   * Lignes d'une couche Pannes réseau quand son service ne se charge pas : une ligne datée garde sa date (« stale »), sinon « error » (S3).
   * Radar sans jeton reste « non configuré » : la source est facultative, son absence n'est pas une panne.
   */
  private markOutagesSourcesFailed(key: OutagesLayerKey, err: unknown): void {
    const error = err instanceof Error ? err.message : 'service de la source introuvable';
    for (const name of OUTAGES_LAYER_SOURCES[key]) {
      if (name === 'Cloudflare Radar' && this.radarNotConfigured()) continue;
      const dated = this.statusPanel?.getSources().find((s) => s.name === name)?.lastUpdate ?? null;
      this.statusPanel?.updateSource(name, dated !== null ? { status: 'stale', error } : { status: 'error', lastUpdate: null, period: undefined, error });
    }
  }

  // ─── Manifestations (spec 2026-10-17 manifestations) : agenda militant Démosphère et signal de la presse GDELT ───

  /** Panneau Manifestations, créé à la demande ; lignes recentrées sur la carte WebGL seulement. */
  private ensureProtestsPanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.protestsPanelPromise ??= import('./components/ProtestsPanel.ts').then(({ ProtestsPanel }) => {
      const panel = new ProtestsPanel(container);
      panel.setOnClose(() => this.closeProtestsLayer());
      panel.setOnFluxEvent((id) => this.openFluxFromProtest(id));
      if (this.mapContainer?.canFocusMap()) panel.setOnFocusPlace((lat, lon) => this.mapContainer?.flyTo(lon, lat, 9));
      panel.mount();
      this.protestsPanel = panel;
      this.syncProtestForecasts();
      if (this.activeLayers.protests) panel.show(this.currentProtests);
    });
    return this.protestsPanelPromise;
  }

  /** Croix du panneau : éteint la couche comme une case décochée. */
  private closeProtestsLayer(): void {
    if (this.activeLayers.protests) {
      this.onLayerToggle('protests', false);
      this.layerPanel?.updateLayers(this.activeLayers);
    }
    this.syncProtestsPolling();
  }

  /** Ouverture (case, restauration) : panneau sur les dernières données, carte repeinte, source lue, relève réglée. */
  private openProtestsPanel(): void {
    this.protestsPanel?.show(this.currentProtests);
    if (this.currentProtests) this.mapContainer?.updateProtestsLayer(this.currentProtests.data);
    this.loadProtests().catch((err) => console.error('[App] Lecture Manifestations en échec', err));
    this.syncProtestsPolling();
  }

  /** Clic sur un point de la carte : panneau ouvert (les autres se referment) sur les lignes de la commune. */
  private onProtestMapClick(placeKey: string): void {
    void this.ensureProtestsPanel().then(() => {
      if (!this.isFloatingPanelVisible('protests')) this.showFloatingPanel('protests');
      this.protestsPanel?.focusPlace(placeKey);
    });
  }

  private protestsPollWanted(): boolean {
    return this.activeLayers.protests || (this.protestsPanel?.isVisible() ?? false);
  }

  /** Relève pausable de 10 min, couche active ou panneau ouvert seulement. */
  private syncProtestsPolling(): void {
    if (!this.protestsPollWanted()) {
      if (this.protestsPoll) {
        this.removePausableInterval(this.protestsPoll);
        this.protestsPoll = null;
      }
      return;
    }
    if (this.protestsPoll) return;
    this.protestsPoll = this.registerPausableInterval(() => {
      if (!this.protestsPollWanted()) {
        this.syncProtestsPolling();
        return;
      }
      this.loadProtests().catch((err) => console.error('[App] Relève Manifestations en échec', err));
    }, PROTESTS_POLL_MS);
  }

  /** Lecture unique à la fois (un second appelant rejoint la lecture en cours) : panneau, carte et légende mis à jour. */
  private loadProtests(): Promise<void> {
    return dedupe('protests', async () => {
      this.currentProtests = mergeProtests(this.currentProtests, await fetchProtests(this.currentProtests));
      this.mapContainer?.updateProtestsLayer(this.currentProtests.data);
      this.protestsPanel?.update(this.currentProtests);
      this.syncProtestForecasts();
      this.refreshProtestsLegend();
    });
  }

  /** Manifestations et Flux piétons fusionnés : chaque annonce prévue porte sa foule estimée (lien vers les rues et le rejeu). */
  private syncProtestForecasts(): void {
    // Couche Flux piétons éteinte : l'index (fichier statique léger) est lu une fois pour les annonces.
    if (!this.fluxIndex && !this.fluxIndexAsked && this.protestsPanel) {
      this.fluxIndexAsked = true;
      fetchFluxIndex().then((index) => { this.fluxIndex ??= index; this.syncProtestForecasts(); }).catch(() => undefined);
    }
    const ids = (this.currentProtests?.data?.items ?? []).map((x) => x.id);
    this.protestsPanel?.setForecasts(fluxForecastsByProtest(this.fluxIndex?.evenements ?? [], ids));
  }

  private fluxIndexAsked = false;

  /** « Foule estimée » d'une annonce : couche Flux piétons allumée au besoin, son panneau ouvert sur ce rassemblement, carte cadrée. */
  private openFluxFromProtest(id: string): void {
    if (!this.activeLayers.pedestrianFlows) {
      this.onLayerToggle('pedestrianFlows', true);
      this.layerPanel?.updateLayers(this.activeLayers);
    }
    void this.ensureFluxPanel().then(async () => {
      if (!this.isFloatingPanelVisible('pedestrianFlows')) this.showFloatingPanel('pedestrianFlows');
      if (!this.fluxIndex?.evenements.some((e) => e.id === id)) await this.loadFlux();
      return this.selectFluxEvent(id, true);
    }).catch(() => undefined);
  }

  private refreshProtestsLegend(): void {
    if (!this.mapLegend) return;
    this.mapLegend.setCategories([{ ...protestsLegend(this.currentProtests?.data ?? null, Date.now()), visible: this.activeLayers.protests }]);
  }

  // ─── Criminalité (spec 2026-10-17 criminalité) : délinquance enregistrée SSMSI, fichier statique annuel ───

  /** Panneau Criminalité, créé à la demande ; indicateur choisi transmis à la carte, villes recentrées sur la carte WebGL seulement. */
  private ensureCrimePanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.crimePanelPromise ??= import('./components/CriminalitePanel.ts').then(({ CriminalitePanel }) => {
      const panel = new CriminalitePanel(container);
      panel.setOnClose(() => this.closeCrimeLayer());
      panel.setOnIndicator((key) => {
        this.mapContainer?.setCrimeIndicator(key);
        this.refreshCrimeLegend();
      });
      if (this.mapContainer?.canFocusMap()) panel.setOnFocusPlace((lat, lon) => this.mapContainer?.flyTo(lon, lat, 11));
      panel.mount();
      this.crimePanel = panel;
      this.mapContainer?.setCrimeIndicator(panel.getIndicator());
      if (this.activeLayers.crime) panel.show(this.currentCrime, this.crimeError);
    });
    return this.crimePanelPromise;
  }

  /** Croix du panneau : éteint la couche comme une case décochée. */
  private closeCrimeLayer(): void {
    if (this.activeLayers.crime) {
      this.onLayerToggle('crime', false);
      this.layerPanel?.updateLayers(this.activeLayers);
    }
  }

  /** Ouverture (case, restauration) : panneau sur le fichier déjà lu, carte repeinte, fichier lu une fois sinon. */
  private openCrimePanel(): void {
    this.crimePanel?.show(this.currentCrime, this.crimeError);
    if (this.crimePanel) this.mapContainer?.setCrimeIndicator(this.crimePanel.getIndicator());
    if (this.currentCrime) this.mapContainer?.updateCrimeLayer(this.currentCrime);
    this.refreshCrimeLegend();
    if (this.currentCrime === null) this.loadCrime().catch((err) => console.error('[App] Lecture Criminalité en échec', err));
  }

  /** Rond de ville cliqué sur la carte : panneau ouvert sur la ligne de la ville. */
  private onCrimeMapClick(cityCode: string): void {
    void this.ensureCrimePanel().then(() => {
      if (!this.isFloatingPanelVisible('crime')) this.showFloatingPanel('crime');
      this.crimePanel?.focusCity(cityCode);
    });
  }

  /** Lecture unique à la fois (mémorisée par le service) : panneau, carte et légende mis à jour ; un échec est dit, relu à la réouverture. */
  private loadCrime(): Promise<void> {
    return dedupe('crime', async () => {
      try {
        this.currentCrime = await fetchCrimeDataset();
        this.crimeError = null;
      } catch (err) {
        this.crimeError = err instanceof Error ? err.message : 'Criminalité : lecture impossible';
      }
      this.mapContainer?.updateCrimeLayer(this.currentCrime);
      this.crimePanel?.update(this.currentCrime, this.crimeError);
      this.refreshCrimeLegend();
    });
  }

  // ─── Flux piétons : prévisions publiées par flux_osint dans data/flux-pietons/ (ESTIMATIONS MODÉLISÉES) ───

  /** Panneau Flux piétons, créé à la demande. */
  private ensureFluxPanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.fluxPanelPromise ??= import('./components/FluxPietonsPanel.ts').then(({ FluxPietonsPanel }) => {
      const panel = new FluxPietonsPanel(container);
      panel.setHandlers({
        onClose: () => this.closeFluxLayer(),
        onSelect: (id) => this.selectFluxEvent(id, true),
        onPhase: (phase) => {
          this.fluxPhase = phase;
          this.fluxInstant = null;
          this.pushFluxMap();
          this.pushFluxState();
        },
        // Curseur du rejeu : seule la carte change (le panneau met sa ligne à jour lui-même, sans nouveau rendu).
        onTime: (atMin) => {
          this.fluxInstant = atMin;
          this.pushFluxMap();
        },
      });
      panel.mount();
      this.fluxPanel = panel;
      if (this.activeLayers.pedestrianFlows) panel.show();
      this.pushFluxState();
    });
    return this.fluxPanelPromise;
  }

  /** Croix du panneau : éteint la couche comme une case décochée. */
  /** Croix du panneau Foule estimée : la couche suit Manifestations ; fermer quitte le rassemblement choisi (rues retirées). */
  private closeFluxLayer(): void {
    this.fluxPanel?.hide({ silent: true });
    this.fluxSelectedId = null;
    this.fluxFeatures = null;
    this.fluxInstant = null;
    this.fluxGeo = 'idle';
    this.pushFluxMap();
    this.pushFluxState();
    this.refreshFloatingPanelSwitcher();
  }

  /** Ouverture (case, restauration) : panneau sur l'état connu, carte reposée, index relu. */
  private openFluxPanel(): void {
    this.mapContainer?.setOnFluxEventClick((id) => { this.selectFluxEvent(id, true).catch(() => undefined); });
    this.fluxPanel?.show();
    this.pushFluxState();
    this.pushFluxMap();
    this.refreshFluxLegend();
    this.loadFlux().catch((err) => console.error('[App] Lecture Flux piétons en échec', err));
  }

  private pushFluxState(): void {
    this.fluxPanel?.update({
      index: this.fluxIndex, error: this.fluxError, selectedId: this.fluxSelectedId, phase: this.fluxPhase, geo: this.fluxGeo,
      maxDistance: this.fluxMaxDistance(), instant: this.fluxInstant,
    });
  }

  /**
   * Carte Flux piétons : rues de l'événement choisi (phase ou instant du rejeu) et autres rassemblements prévus, en anneau ;
   * la légende suit le mode (totaux de la phase ou instant du rejeu).
   */
  private pushFluxMap(): void {
    const now = Date.now();
    const others = (this.fluxIndex?.evenements ?? []).filter((e) => e.id !== this.fluxSelectedId).map((e) => {
      const moment = fluxMoment(e.debut, now);
      const date = e.debut ? new Date(e.debut).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'date n.d.';
      // Le mot double la valeur du point : lisible sans distinguer les gris.
      const label = moment === 'encours' ? `${e.ville} · en cours` : moment === 'passe' ? `${e.ville} · passé ${date}` : `${e.ville} · ${date}`;
      return { id: e.id, point: e.point, label, moment };
    });
    this.mapContainer?.updateFluxLayer(this.fluxFeatures, this.fluxPhase, this.fluxInstantOf(this.fluxInstant), others);
    const instantMode = this.fluxInstant !== null;
    if (instantMode !== this.fluxLegendInstant) {
      this.fluxLegendInstant = instantMode;
      this.refreshFluxLegend();
    }
  }
  private fluxLegendInstant = false;

  /** Distance au point de la rue la plus lointaine (m) ; null si la carte lue ne porte pas les distances (publication ancienne). */
  private fluxMaxDistance(): number | null {
    let max: number | null = null;
    for (const f of this.fluxFeatures ?? []) {
      const d = f.properties['distance'];
      if (f.properties['kind'] === 'troncon' && typeof d === 'number' && Number.isFinite(d)) max = Math.max(max ?? 0, d);
    }
    return max;
  }

  /** Instant du rejeu pour la carte : minutes et paramètres de temps de l'événement choisi, ou null. */
  private fluxInstantOf(atMin: number | null): { atMin: number; timing: NonNullable<FluxIndex['evenements'][number]['temps']> } | null {
    const timing = this.fluxIndex?.evenements.find((e) => e.id === this.fluxSelectedId)?.temps ?? null;
    return atMin === null || timing === null ? null : { atMin, timing };
  }

  /** Relève de 15 min (rythme du batch flux_osint), couche allumée seulement. */
  private syncFluxPolling(): void {
    if (!this.activeLayers.pedestrianFlows) {
      if (this.fluxPoll) {
        this.removePausableInterval(this.fluxPoll);
        this.fluxPoll = null;
      }
      return;
    }
    if (this.fluxPoll) return;
    this.fluxPoll = this.registerPausableInterval(() => {
      if (!this.activeLayers.pedestrianFlows) {
        this.syncFluxPolling();
        return;
      }
      this.loadFlux().catch((err) => console.error('[App] Relève Flux piétons en échec', err));
    }, FLUX_POLL_MS);
  }

  /** Index relu (une lecture à la fois) ; l'événement choisi est gardé s'il est toujours publié. Aucun par défaut : on choisit sur la carte. */
  private loadFlux(): Promise<void> {
    return dedupe('pedestrianFlows', async () => {
      try {
        this.fluxIndex = await fetchFluxIndex();
        this.fluxError = null;
      } catch (err) {
        this.fluxError = err instanceof Error ? err.message : 'Flux piétons : lecture impossible';
      }
      const list = this.fluxIndex?.evenements ?? [];
      const keep = list.find((e) => e.id === this.fluxSelectedId) ?? null;
      this.refreshFluxLegend();
      this.syncProtestForecasts();
      if (keep) await this.selectFluxEvent(keep.id, false);
      else {
        this.fluxSelectedId = null;
        this.fluxFeatures = null;
        this.fluxGeo = 'idle';
        this.pushFluxMap();
        this.pushFluxState();
      }
    });
  }

  /** Événement choisi : sa carte lue (mémorisée par date de calcul), posée ; recentrage seulement sur un choix de l'utilisateur. */
  private async selectFluxEvent(id: string, fly: boolean): Promise<void> {
    const ev = this.fluxIndex?.evenements.find((e) => e.id === id);
    if (!ev) return;
    if (id !== this.fluxSelectedId) this.fluxInstant = null;
    this.fluxSelectedId = id;
    this.fluxGeo = 'loading';
    this.pushFluxState();
    if (fly) this.mapContainer?.flyTo(ev.point[0], ev.point[1], 14.5);
    try {
      const features = await fetchFluxEvent(ev);
      if (this.fluxSelectedId !== id) return;
      this.fluxFeatures = features;
      this.fluxGeo = 'ready';
    } catch {
      if (this.fluxSelectedId !== id) return;
      // Jamais la carte d'un autre événement sous le nom de celui-ci.
      this.fluxFeatures = null;
      this.fluxGeo = 'error';
    }
    this.pushFluxMap();
    this.pushFluxState();
  }

  private refreshFluxLegend(): void {
    if (!this.mapLegend) return;
    this.mapLegend.setCategories([{ ...fluxLegend(this.fluxIndex, this.fluxInstant !== null), visible: this.activeLayers.pedestrianFlows }]);
  }

  // ─── Webcams : recensement statique public/data/webcams.json (scripts/build-webcams.mjs) ───

  /** Panneau Webcams, créé à la demande. */
  private ensureWebcamsPanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.webcamsPanelPromise ??= Promise.all([import('./components/WebcamsPanel.ts'), import('./components/WebcamWall.ts')])
      .then(([{ WebcamsPanel }, { WebcamWall }]) => {
        const panel = new WebcamsPanel(container);
        panel.setOnClose(() => this.closeWebcamsLayer());
        panel.mount();
        this.webcamsPanel = panel;
        // Mur de webcams : fenêtre flottante, ouverte depuis le panneau, épinglage depuis la fiche d'une webcam.
        const wall = new WebcamWall(container);
        wall.setData(this.currentWebcams);
        wall.setOnChange((st) => panel.setWallIds(st.ids));
        panel.setWallHandlers(() => wall.open(), (id) => wall.toggle(id));
        panel.setWallIds(wall.getState().ids);
        this.webcamWall = wall;
        // Le mur ne se rouvre jamais tout seul (20/10/2026) : seulement par « Ouvrir le mur » du panneau Webcams.
        if (this.activeLayers.webcams) panel.show(this.currentWebcams, this.webcamsError);
      });
    return this.webcamsPanelPromise;
  }

  /** Croix du panneau : éteint la couche comme une case décochée. */
  private closeWebcamsLayer(): void {
    if (this.activeLayers.webcams) {
      this.onLayerToggle('webcams', false);
      this.layerPanel?.updateLayers(this.activeLayers);
    }
  }

  /** Ouverture (case, restauration) : panneau sur le fichier déjà lu, carte reposée, fichier lu une fois sinon. */
  private openWebcamsPanel(): void {
    this.webcamsPanel?.show(this.currentWebcams, this.webcamsError);
    if (this.currentWebcams) this.mapContainer?.updateWebcamsLayer(this.currentWebcams);
    this.refreshWebcamsLegend();
    if (this.currentWebcams === null) this.loadWebcams().catch((err) => console.error('[App] Lecture Webcams en échec', err));
  }

  /** Point cliqué sur la carte : panneau ouvert sur la fiche de la webcam. */
  private onWebcamMapClick(id: string): void {
    void this.ensureWebcamsPanel().then(() => {
      if (!this.isFloatingPanelVisible('webcams')) this.showFloatingPanel('webcams');
      this.webcamsPanel?.select(id);
    });
  }

  /** Lecture unique à la fois (mémorisée par le service) : panneau, carte et légende mis à jour ; un échec est dit, relu à la réouverture. */
  private loadWebcams(): Promise<void> {
    return dedupe('webcams', async () => {
      try {
        this.currentWebcams = await fetchWebcamsDataset();
        this.webcamsError = null;
      } catch (err) {
        this.webcamsError = err instanceof Error ? err.message : 'Webcams : lecture impossible';
      }
      this.mapContainer?.updateWebcamsLayer(this.currentWebcams);
      this.webcamsPanel?.update(this.currentWebcams, this.webcamsError);
      this.webcamWall?.setData(this.currentWebcams);
      this.refreshWebcamsLegend();
    });
  }

  private refreshWebcamsLegend(): void {
    if (!this.mapLegend) return;
    this.mapLegend.setCategories([{ ...webcamsLegend(this.currentWebcams), visible: this.activeLayers.webcams }]);
  }

  // ─── En bref des onglets autres qu'Environnement (20/10/2026) ───

  private ensureThemeBriefPanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.themeBriefPanelPromise ??= import('./components/ThemeBriefPanel.ts').then(({ ThemeBriefPanel }) => {
      const panel = new ThemeBriefPanel(container);
      // Croix : le panneau se ferme, la pastille reste (elle fait partie de chaque onglet) ; il ne revient plus d'office ici.
      panel.setOnClose(() => {
        this.briefDismissed = true;
        this.refreshFloatingPanelSwitcher();
      });
      panel.setOnSelectWork((key) => this.poste?.select(key));
      panel.setOnOpenPastille((key) => this.showFloatingPanel(key));
      panel.setOnFocusPoint((lon, lat) => this.mapContainer?.focusPoint(lon, lat, 9));
      // Points de vigilance Transports : survol croisé entre l'En bref et les étiquettes de la carte.
      panel.setOnHoverPoint((n) => this.mapContainer?.highlightTransportPoint(n));
      this.mapContainer?.setOnTransportHover((n) => this.themeBriefPanel?.highlightPoint(n) ?? false);
      panel.mount();
      this.themeBriefPanel = panel;
      if (this.activeLayers.brief && this.isFloatingPanelVisible('brief')) panel.show(this.themeBriefData());
    });
    return this.themeBriefPanelPromise;
  }

  /** Pastilles de l'onglet affiché (Vue générale : le socle et les couches suivies affichées), avec leur niveau. */
  private themeBriefPastilles(): ThemeBriefPastille[] {
    const label = (key: keyof MapLayers): string => FLOATING_PANEL_DEFS.find((d) => d.id === key)?.label ?? key;
    const theme = this.v2Theme;
    const keys: Array<keyof MapLayers> = theme === 'general'
      ? this.watchEntries.map((e) => e.key)
      : theme === 'environment' ? [] : theme === 'outages' ? [...OUTAGES_LAYER_KEYS]
        : THEME_LAYERS[theme].filter((k) => k !== 'news' && k !== 'pedestrianFlows');
    // En-tête du panneau de chaque pastille (dernière vue retenue par le cadre ; « Pression par département » = panneau « pressure »).
    return keys.map((key) => ({ key, label: label(key), level: this.watchLevelMap.get(key) ?? null, head: lastLayerHead(key === 'stability' ? 'pressure' : key) }));
  }

  /** Données du panneau pour l'onglet affiché : pastilles, liste « À traiter » de l'onglet, passages de niveau. */
  private themeBriefData(): ThemeBriefData {
    const theme = this.v2Theme;
    const q = this.lastQueue;
    const pastilles = this.themeBriefPastilles();
    const keys = new Set(pastilles.map((p) => p.key));
    const label = (key: keyof MapLayers): string => FLOATING_PANEL_DEFS.find((d) => d.id === key)?.label ?? key;
    const themeLevel = !q ? null : theme === 'general'
      ? (Object.values(q.themeLevels) as VigilanceLevel[]).reduce<VigilanceLevel | null>((m, l) => (m === null || LEVEL_RANK[l] > LEVEL_RANK[m] ? l : m), null)
      : theme === 'environment' ? null : q.themeLevels[theme];
    return {
      themeName: themeLabel(theme),
      pastilles,
      items: (q?.items ?? []).filter((it) => inTheme(it.theme, theme)),
      themeLevel,
      changes: this.watchLog.filter((t) => theme === 'general' || keys.has(t.key)).map((t) => ({ label: label(t.key), from: t.from, to: t.to, at: t.at })),
      eventsStatus: q?.eventsStatus ?? null,
      ...(theme === 'transport' ? { transport: this.transportBriefData() } : {}),
      now: Date.now(),
    };
  }

  /** Panneau ouvert : contenu de l'onglet affiché, à chaque liste « À traiter », niveau des pastilles ou changement d'onglet. */
  private refreshThemeBrief(): void {
    if (!this.themeBriefPanel?.isVisible()) return;
    this.themeBriefPanel.update(this.themeBriefData());
  }

  // ─── Onglet Transports : points de vigilance (lots 1 et 2, 25/10/2026, layer-panel/transport-vigilance.ts) ───

  private transportPoints: TransportVigilancePoint[] = [];

  /** Points recalculés à chaque lecture d'une source Trafics ; numéros pulsants sur la carte dans l'onglet Transports seulement. */
  private refreshTransportVigilance(): void {
    this.transportPoints = transportVigilancePoints({
      rail: this.currentRailTraffic?.overview.data ?? null,
      situations: this.currentRailTraffic?.situations.data ?? null,
      road: this.currentRoadTraffic?.national.data ?? null,
      air: this.currentAirOverview?.overview.data ?? null,
      maritime: this.currentMaritimeSnapshot?.snapshot.data ?? null,
      now: Date.now(),
    });
    const shown = this.uiV2 && this.v2Theme === 'transport';
    this.mapContainer?.setTransportVigilance(shown ? this.transportPoints : null);
    // Bloc Transports de « Lire la carte » : éléments comptés à l'écran.
    const road = shown && this.activeLayers.trafficRoad ? this.currentRoadTraffic?.national.data ?? null : null;
    const roadKinds: Partial<Record<RoadEventKind, number>> = {};
    for (const e of road?.events ?? []) if (e.lat !== null && e.lon !== null) roadKinds[e.kind] = (roadKinds[e.kind] ?? 0) + 1;
    const rail = shown && this.activeLayers.trafficRail ? this.currentRailTraffic?.overview.data ?? null : null;
    this.mapLegend?.setTransportKey(buildTransportKeyHtml({
      visible: shown,
      points: this.transportPoints,
      roadKinds: road ? roadKinds : null,
      stations: rail ? railStationCounts(rail) : null,
    }));
  }

  /** Données Transports de l'En bref : points, données des quatre panneaux, niveaux de leurs pastilles. */
  private transportBriefData(): NonNullable<ThemeBriefData['transport']> {
    const levels: Partial<Record<TransportMode, WatchLevel>> = {};
    for (const key of ['trafficRail', 'trafficRoad', 'trafficAir', 'trafficMaritime'] as const) {
      const l = this.watchLevelMap.get(key);
      if (l !== undefined) levels[key] = l;
    }
    return {
      points: this.transportPoints,
      rail: this.currentRailTraffic?.overview.data ?? null,
      situations: this.currentRailTraffic?.situations.data ?? null,
      road: this.currentRoadTraffic?.national.data ?? null,
      urban: this.currentRoadTraffic?.urban.data ?? null,
      urbanError: this.currentRoadTraffic?.urban.error ?? null,
      air: this.currentAirOverview?.overview.data ?? null,
      maritime: this.currentMaritimeSnapshot?.snapshot.data ?? null,
      levels,
    };
  }

  // ─── En bref de l'onglet Environnement (spec 2026-10-20 onglet Environnement § 3, lot 2) ───

  /** Panneau En bref, créé à la demande. */
  private ensureEnvBriefPanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.envBriefPanelPromise ??= import('./components/EnvBriefPanel.ts').then(({ EnvBriefPanel }) => {
      const panel = new EnvBriefPanel(container);
      panel.setOnClose(() => {
        if (!this.activeLayers.envBrief) return;
        this.onLayerToggle('envBrief', false);
        this.layerPanel?.updateLayers(this.activeLayers);
      });
      panel.setOnFocusPoint((lon, lat) => this.mapContainer?.focusPoint(lon, lat, 13));
      panel.setOnOpenPastille((key) => this.showFloatingPanel(key));
      panel.setOnWebcam((id) => {
        if (!this.activeLayers.webcams) {
          this.onLayerToggle('webcams', true, { suppressPanel: true });
          this.layerPanel?.updateLayers(this.activeLayers);
        }
        this.onWebcamMapClick(id);
      });
      panel.mount();
      this.envBriefPanel = panel;
      if (this.activeLayers.envBrief) panel.show(this.envBriefData());
    });
    return this.envBriefPanelPromise;
  }

  /** Allumage : panneau sur le dernier croisement, enjeux et webcams lus une fois, carte reposée. */
  private openEnvBriefPanel(): void {
    this.envBriefPanel?.show(this.envBriefData());
    if (this.currentWebcams === null) this.loadWebcams().catch((err) => console.error('[App] Lecture Webcams en échec', err));
    this.ensureExposureData();
    this.refreshEnvBrief();
  }

  /** Données du panneau : niveaux des pastilles, phénomènes, croisement, journal des passages, fraîcheur. */
  private envBriefData(): EnvBriefData {
    const now = Date.now();
    const label = (key: keyof MapLayers): string => FLOATING_PANEL_DEFS.find((d) => d.id === key)?.label ?? key;
    const levels = new Map<keyof MapLayers, WatchLevel>();
    for (const key of ENV_FOCUS_IDS) {
      const l = this.watchLevelMap.get(key);
      if (l !== undefined) levels.set(key, l);
    }
    const labels: Partial<Record<keyof MapLayers, string>> = {};
    for (const key of ENV_FOCUS_IDS) labels[key] = label(key);
    const sourceKeys: Array<keyof MapLayers> = ['environmental', 'floods', 'weatherRadar', 'fires', 'airQuality', 'drought', 'earthquakes', 'disasters'];
    const pastilleKeys = ENV_FOCUS_IDS.filter((k) => k !== 'envBrief' && this.activeLayers[k]);
    return {
      levels, labels,
      pastilles: pastilleKeys.map((key) => ({ key, label: label(key), level: this.watchLevelMap.get(key) ?? null, head: lastLayerHead(key) })),
      vigilance: this.currentVigilance?.vigilance.data ?? null,
      floods: this.currentFloods?.floods.data ?? null,
      fires: this.currentFires?.fires.data ?? null,
      earthquakes: this.currentEarthquakes?.quakes.data ?? null,
      ems: this.currentDisasters?.ems.data ?? null,
      exposure: this.currentExposure,
      population: this.currentPopulation ?? undefined,
      assetsLoading: this.exposureAssets === null,
      assetsMissing: this.exposureAssets?.missing ?? [],
      webcams: this.currentWebcams,
      changes: this.watchLog.filter((t) => ENV_FOCUS_IDS.includes(t.key)).map((t) => ({ ...t, label: label(t.key) })),
      sources: sourceKeys.map((key) => {
        const at = this.envDataAt(key);
        return { key, label: label(key), at: at.at, verb: at.verb, level: this.watchLevelMap.get(key) ?? null };
      }),
      now,
    };
  }

  /** Bloc Environnement de « Lire la carte » : grille de lecture et éléments comptés, dans l'onglet Environnement seulement. */
  private refreshEnvironmentKey(): void {
    const visible = this.uiV2 && this.v2Theme === 'environment';
    if (!visible) {
      this.mapLegend?.setEnvironmentKey('');
      return;
    }
    const period = this.currentVigilance?.vigilance.data?.periods.find((p) => p.echeance === this.vigilanceEcheance);
    const vigilance: Partial<Record<VigilanceLevel, number>> = {};
    const phenomena = new Set<VigilancePhenomenonId>();
    for (const d of period?.departments ?? []) {
      const l = OFFICIAL_COLOR_LEVEL[d.color];
      vigilance[l] = (vigilance[l] ?? 0) + 1;
      if (d.phenomena[0]) phenomena.add(d.phenomena[0].id);
    }
    const counts = this.currentFloods?.floods.data?.counts;
    this.mapLegend?.setEnvironmentKey(buildEnvironmentKeyHtml({
      visible: this.activeLayers.environmental === true || this.activeLayers.floods === true || this.activeLayers.envBrief === true,
      vigilance: this.activeLayers.environmental ? vigilance : {},
      phenomena: this.activeLayers.environmental ? [...phenomena] : [],
      floods: this.activeLayers.floods && counts ? { jaune: counts.jaune, orange: counts.orange, rouge: counts.rouge } : {},
      exposed: this.activeLayers.envBrief ? this.currentExposure?.nearby.length ?? 0 : null,
    }));
  }

  /**
   * Zones inondables cartographiées (Géorisques, crue fréquente et moyenne) des tronçons en crue orange ou rouge pas encore lus : cases
   * de 0,05° le long du tracé (au plus 60 par tronçon), puis exposition, population et carte recalculées. Échec complet : rien retenu, relu au prochain calcul.
   */
  private loadFloodZones(hazards: readonly Hazard[]): void {
    if (!this.floodZonesOn) return;
    for (const h of hazards) {
      if (h.kind !== 'crue' || (h.level !== 'orange' && h.level !== 'rouge')) continue;
      if (this.floodZoneRings.has(h.id) || this.floodZoneLoading.has(h.id)) continue;
      this.floodZoneLoading.add(h.id);
      void Promise.all(floodCells(h.lines, 60).map((cell) => fetchFloodZones(cell, EXPOSURE_SCENARIOS))).then((responses) => {
        this.floodZoneLoading.delete(h.id);
        const read = responses.filter((r) => r !== null);
        if (read.length === 0) return;
        this.floodZoneRings.set(h.id, sectionFloodZones(read.flatMap((r) => r.zones), h.lines).map((z) => z.ring));
        this.refreshEnvBrief();
        this.refreshSeveso();
        this.refreshFloodImpact();
      });
    }
  }

  /** Phénomènes en cours de l'onglet Environnement (zones de vigilance, crues avec leurs zones inondables lues, feux, séismes, zones Copernicus). */
  private currentHazards(): Hazard[] {
    const hazards = buildHazards({
      vigilance: this.currentVigilance?.vigilance.data ?? null,
      floods: this.currentFloods?.floods.data ?? null,
      fires: this.currentFires?.fires.data ?? null,
      earthquakes: this.currentEarthquakes?.quakes.data ?? null,
      ems: this.currentDisasters?.ems.data ?? null,
      now: Date.now(),
    });
    this.loadFloodZones(hazards);
    return hazards.map((h) => {
      const rings = this.floodZonesOn ? this.floodZoneRings.get(h.id) : undefined;
      return rings && rings.length > 0 ? { ...h, floodZones: rings } : h;
    });
  }

  /** Enjeux et communes lus une fois (relus après un échec), puis En bref et Crues recalculés. */
  private ensureExposureData(): void {
    if (this.exposureAssets !== null && this.exposureAssets.missing.length === 0 && this.communes !== null) return;
    void dedupe('exposure-assets', async () => {
      const [assets, communes] = await Promise.all([fetchExposureAssets(), fetchCommunes()]);
      this.exposureAssets = assets;
      this.communes = communes;
      this.refreshEnvBrief();
      this.refreshFloodImpact();
    });
  }

  /** Interrupteur des zones inondables : mémorisé, carte vidée ou relue, conséquences recalculées. */
  private setFloodZonesOn(on: boolean): void {
    this.floodZonesOn = on;
    try { localStorage.setItem('fm.floods.zones', on ? 'on' : 'off'); } catch { /* stockage indisponible : réglage de session */ }
    this.refreshEnvBrief();
    this.refreshSeveso();
    this.refreshFloodImpact();
  }

  /**
   * Conséquences des crues (pastille Crues allumée) : par tronçon en vigilance, état de la zone inondable, communes touchées, enjeux ;
   * puis panneau et zones dessinées (rien si l'interrupteur est éteint).
   */
  private refreshFloodImpact(): void {
    if (!this.activeLayers.floods) return;
    const crues = this.currentHazards().filter((h) => h.kind === 'crue');
    const rings = crues.flatMap((h) => h.floodZones ?? []);
    this.mapContainer?.updateFloodZonesLayer(rings);
    const assets = this.exposureAssets;
    const communes = this.communes;
    if (!assets || !communes) {
      this.floodsPanel?.setImpact({ impacts: null, zonesOn: this.floodZonesOn, canFocus: this.mapContainer?.canFocusMap() ?? false });
      return;
    }
    const nearby = computeExposure(crues, assets.assets).nearby;
    this.mapContainer?.updateFloodAssetsLayer(nearby);
    // Enjeux retenus à la seule distance du tronçon : ceux que la zone officielle écarte sont dits dans le panneau.
    const byDistance = computeExposure(crues.map(({ floodZones: _zones, ...h }) => h), assets.assets).nearby;
    const byCode = new Map(communes.map((c) => [c.code, c]));
    const impacts: SectionImpact[] = crues.map((h) => {
      const zoneCount = h.floodZones?.length ?? 0;
      const zone: FloodZoneStatus = h.level === 'jaune' ? 'non-demandee' : !this.floodZonesOn ? 'off'
        : zoneCount > 0 ? 'cartographiee' : this.floodZoneRings.has(h.id) ? 'non-cartographiee' : 'lecture';
      const population = hazardPopulation(h, communes, h.floodZones);
      const exposures = nearby.filter((e) => e.hazard.id === h.id);
      const kept = new Set(exposures.map((e) => e.asset.id));
      const excluded = zone === 'cartographiee' ? byDistance.filter((e) => e.hazard.id === h.id && !kept.has(e.asset.id)) : [];
      const found = zone === 'cartographiee' ? this.floodZonePeople(h, population) : null;
      const people = found === null || found === 'lecture' ? found : {
        total: found.total, over80: found.over80,
        // Carreaux 2019 et population légale plus récente : jamais plus d'habitants en zone que dans la commune.
        communes: found.communes.map((c) => {
          const commune = byCode.get(c.code);
          const pop = commune?.pop ?? null;
          return { name: commune?.name ?? c.code, dept: commune?.dept ?? c.code.slice(0, 2), people: pop === null ? c.people : Math.min(c.people, pop), pop };
        }),
      };
      return {
        sectionId: h.id.replace(/^crue-/, ''), name: h.label.replace(/^Crue \S+ · /, ''), level: h.level, zone, zoneCount,
        population, people, exposures, excluded,
      };
    });
    this.floodsPanel?.setImpact({ impacts, zonesOn: this.floodZonesOn, canFocus: this.mapContainer?.canFocusMap() ?? false });
  }

  /**
   * Habitants en zone inondable d'un tronçon : carreaux Insee des départements des communes touchées, lus à la demande (puis Crues
   * recalculé) ; 'lecture' en attendant ; mémorisés tant que les zones du tronçon ne changent pas.
   */
  private floodZonePeople(h: Hazard, population: HazardPopulation): ZonePeople | 'lecture' | null {
    const zones = h.floodZones ?? [];
    if (zones.length === 0) return null;
    const key = `${h.id}:${zones.length}`;
    const memo = this.floodPeople.get(h.id);
    if (memo?.key === key) return memo.people;
    const depts = [...new Set(population.communes.map((c) => c.dept))];
    const missing = depts.filter((d) => !cachedCarreaux(d));
    if (missing.length > 0) {
      void dedupe(`carreaux:${missing.join(',')}`, async () => {
        const read = await Promise.all(missing.map((d) => fetchCarreaux(d)));
        if (read.some((x) => x !== null)) this.refreshFloodImpact();
      });
      // Un département illisible (DROM non carroyé) ne bloque pas les autres : on compte dès qu'un lu suffit à tout couvrir.
      if (missing.length === depts.length) return 'lecture';
    }
    const people = zonePeople(zones, depts.flatMap((d) => cachedCarreaux(d) ?? []));
    if (missing.length === 0) this.floodPeople.set(h.id, { key, people });
    return people;
  }

  // ─── Pollens (20/10/2026) ───

  private ensurePollensPanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.pollensPanelPromise ??= import('./components/PollensPanel.ts').then(({ PollensPanel }) => {
      const panel = new PollensPanel(container);
      panel.setOnClose(() => {
        if (!this.activeLayers.pollens) return;
        this.onLayerToggle('pollens', false);
        this.layerPanel?.updateLayers(this.activeLayers);
      });
      if (this.mapContainer?.canFocusMap()) panel.setOnFocusDepartment((code) => this.focusDepartment(code));
      // Onglets Aujourd'hui / Demain / Après-demain : la carte suit le jour choisi.
      panel.setOnDayChange((day) => {
        this.pollenDay = day;
        this.mapContainer?.updatePollenLayer(this.currentPollen?.pollen.data ?? null, day, Date.now());
      });
      panel.mount();
      this.pollensPanel = panel;
      panel.update(this.currentPollen);
      if (this.activeLayers.pollens && this.currentFloatingPanelId === 'pollens') panel.show(this.currentPollen);
    });
    return this.pollensPanelPromise;
  }

  /** Lecture (cache client 25 min), puis panneau, carte, légende et voyant. */
  private loadPollen(): Promise<void> {
    return dedupe('pollens', async () => {
      const incoming = await fetchPollen(this.currentPollen, Date.now());
      this.currentPollen = mergePollen(this.currentPollen, incoming);
      const now = Date.now();
      const data = this.currentPollen.pollen.data;
      this.pollensPanel?.update(this.currentPollen);
      this.mapContainer?.updatePollenLayer(data, this.pollenDay, now);
      this.mapLegend?.setCategories([{ ...pollensLegend(data, now), visible: this.activeLayers.pollens }]);
      this.refreshGeneralWatch();
    });
  }

  // ─── Sites Seveso (20/10/2026) ───

  private ensureSevesoPanel(): Promise<void> {
    const container = this.floatContainerEl;
    if (!container) return Promise.resolve();
    this.sevesoPanelPromise ??= import('./components/SevesoPanel.ts').then(({ SevesoPanel }) => {
      const panel = new SevesoPanel(container);
      panel.setOnClose(() => {
        if (!this.activeLayers.seveso) return;
        this.onLayerToggle('seveso', false);
        this.layerPanel?.updateLayers(this.activeLayers);
      });
      panel.setOnFocusPoint((lon, lat) => this.mapContainer?.focusPoint(lon, lat, 13));
      panel.mount();
      this.sevesoPanel = panel;
      panel.update(this.sevesoData, this.sevesoError, this.sevesoExposed);
      if (this.activeLayers.seveso && this.currentFloatingPanelId === 'seveso') panel.show();
    });
    return this.sevesoPanelPromise;
  }

  /** Recensement lu une fois (relu après un échec), puis exposition, carte, panneau et légende. */
  private loadSeveso(): Promise<void> {
    return dedupe('seveso', async () => {
      if (this.sevesoData === null) {
        try {
          this.sevesoData = await fetchSevesoDataset();
          this.sevesoError = null;
        } catch (err) {
          this.sevesoError = err instanceof Error ? err.message : 'lecture impossible';
        }
      }
      this.refreshSeveso();
    });
  }

  /** Exposition des sites Seveso aux phénomènes en cours (couche allumée), puis carte, panneau, légende. */
  private refreshSeveso(): void {
    if (!this.activeLayers.seveso) return;
    const sites = this.sevesoData?.sites ?? null;
    this.sevesoExposed = sites ? sevesoExposures(computeExposure(this.currentHazards(), sites), sites) : null;
    this.mapContainer?.updateSevesoLayer(sites, this.sevesoExposed);
    this.sevesoPanel?.update(this.sevesoData, this.sevesoError, this.sevesoExposed);
    this.mapLegend?.setCategories([{ ...sevesoLegend(this.sevesoData), visible: true }]);
  }

  /** Croisement phénomènes × enjeux recalculé (pastille allumée seulement), puis carte et panneau. */
  private refreshEnvBrief(): void {
    if (!this.activeLayers.envBrief) return;
    const hazards = this.currentHazards();
    this.currentExposure = this.exposureAssets ? computeExposure(hazards, this.exposureAssets.assets) : null;
    const communes = this.communes;
    this.currentPopulation = communes ? new Map(hazards.map((h) => [h.id, hazardPopulation(h, communes, h.floodZones)])) : null;
    this.mapContainer?.updateExposureLayer(this.currentExposure);
    this.envBriefPanel?.update(this.envBriefData());
  }

  private refreshCrimeLegend(): void {
    if (!this.mapLegend) return;
    this.mapLegend.setCategories([{ ...crimeLegend(this.currentCrime, this.crimePanel?.getIndicator() ?? 'homicides'), visible: this.activeLayers.crime }]);
  }

  // ─── Souveraineté, phase B (tâche B28 ; contrats § 4.4 point 15, § 6 ; amendement 7, O7, O15, O17, S15) ───
  // Grille GNSS et météo spatiale (score : lue avec chaque lecture de la couche Défense), registre des gels (couche Défense active ou
  // panneau ouvert), grands réseaux et points d'échange (couche Connectivité active ou panneau ouvert), fichier des zones drones (une fois
  // par session, à l'activation de l'option, jamais au démarrage).

  private gnssState: GnssState | null = null;
  private connectivityState: ConnectivityState | null = null;
  private sanctionsState: SanctionsState | null = null;
  private droneZonesFile: DroneZonesFile | null = null;
  private droneZonesError: string | null = null;
  private droneZonesOn = false;

  /** Lecture d'une couche Souveraineté (tâche A15), puis les sources de la phase B de cette couche (arbitrage 21). */
  private async loadSovereigntySourceB(key: SovereigntyLayerKey): Promise<void> {
    const reads: Array<Promise<void>> = [this.loadSovereigntySource(key)];
    if (key === 'military') {
      reads.push(this.loadGnss());
      if (this.sovereigntyBWanted('military')) reads.push(this.loadSanctions());
    }
    if (key === 'subseaCables' && this.sovereigntyBWanted('subseaCables')) reads.push(this.loadConnectivity());
    await Promise.all(reads);
  }

  /** Sources de la phase B hors score : couche active ou panneau ouvert. */
  private sovereigntyBWanted(key: 'military' | 'subseaCables'): boolean {
    return this.activeLayers[key] || (this.getFloatingPanelInstance(key)?.isVisible?.() ?? false);
  }

  /**
   * Grille GNSS et météo spatiale : lignes « Grille GNSS » et « NOAA SWPC » (S1, datées par leur donnée), mailles du jour UTC précédent
   * sur la carte, panneau, légende, score, situations et moniteur.
   */
  private loadGnss(): Promise<void> {
    return dedupe('sovereignty:gnss', async () => {
      try {
        this.gnssState = mergeGnss(this.gnssState, await fetchGnss(this.gnssState));
        const now = Date.now();
        this.statusPanel?.updateSource('Grille GNSS', gnssStatus(this.gnssState, 'adsb-gnss', now));
        this.statusPanel?.updateSource('NOAA SWPC', gnssStatus(this.gnssState, 'noaa', now));
        this.mapContainer?.updateGnssLayer(this.gnssState.gnss.data, now);
        this.refreshSovereigntyPanelsB('military');
        this.recordSovereigntySamples(now);
        this.refreshFranceIntelPanel();
      } catch (err) {
        this.markSovereigntyBFailed(['Grille GNSS', 'NOAA SWPC'], err);
        throw err;
      }
    });
  }

  /** Grands réseaux (RIPEstat) et points d'échange (PeeringDB), une route : ligne « RIPEstat », panneau Connectivité. Hors score. */
  private loadConnectivity(): Promise<void> {
    return dedupe('sovereignty:connectivity', async () => {
      try {
        this.connectivityState = mergeConnectivity(this.connectivityState, await fetchConnectivity(this.connectivityState));
        const now = Date.now();
        this.statusPanel?.updateSource('RIPEstat', ripeStatus(this.connectivityState, now));
        this.refreshSovereigntyPanelsB('subseaCables');
        this.recordSovereigntySamples(now);
      } catch (err) {
        this.markSovereigntyBFailed(['RIPEstat'], err);
        throw err;
      }
    });
  }

  /** Registre national des gels (DG Trésor) : ligne « Registre des gels », section Sanctions du panneau Défense. Hors score, aucun nom. */
  private loadSanctions(): Promise<void> {
    return dedupe('sovereignty:sanctions', async () => {
      try {
        this.sanctionsState = mergeSanctions(this.sanctionsState, await fetchSanctions(this.sanctionsState));
        const now = Date.now();
        this.statusPanel?.updateSource('Registre des gels', gelsStatus(this.sanctionsState, now));
        this.refreshSovereigntyPanelsB('military');
        this.recordSovereigntySamples(now);
      } catch (err) {
        this.markSovereigntyBFailed(['Registre des gels'], err);
        throw err;
      }
    });
  }

  /** Fichier des zones drones (1,47 Mo) : lu une fois par session ; un échec n'est pas gardé (nouvelle tentative à la demande suivante). */
  private loadDroneZonesOnce(): Promise<void> {
    if (this.droneZonesFile !== null) return Promise.resolve();
    return dedupe('sovereignty:droneZones', async () => {
      const { data, error } = await fetchDroneZones();
      this.droneZonesFile = data;
      this.droneZonesError = error;
      this.mapContainer?.updateDroneZones(data);
      this.refreshSovereigntyPanelsB('military');
    });
  }

  /** Option « zones drones » de la couche Défense (bouton du panneau) : carte, panneau, légende ; fichier lu au premier appel. */
  private setDroneZones(on: boolean): void {
    this.droneZonesOn = on;
    this.mapContainer?.setDroneZonesVisible(on);
    this.refreshSovereigntyPanelsB('military');
    if (on) this.loadDroneZonesOnce().catch((err: unknown) => console.error('[App] Zones drones illisibles', err));
  }

  /** Maille du jour UTC précédent choisie dans le panneau Défense ou sur la carte : la carte se cale sur son centre. */
  private focusGnssCell(cell: { lat: number; lon: number }): void {
    this.mapContainer?.flyTo(cell.lon + 0.25, cell.lat + 0.25, 8);
  }

  /** État du panneau Défense (tâche A15) complété : grille GNSS, registre des gels, zones drones (contrats § 4.2). */
  private defensePanelStateB(): DefensePanelState {
    const a = this.defensePanelState();
    const f = this.droneZonesFile;
    const meta = f ? { generatedAt: f.generatedAt, edition: f.edition, source: f.source, licence: f.licence, counts: f.counts } : null;
    return {
      ...a,
      sites: { ...a.sites, drones: { meta, error: this.droneZonesError, shown: this.droneZonesOn } },
      gnss: this.gnssState,
      sanctions: this.sanctionsState,
    };
  }

  /** État du panneau Connectivité (tâche A15) complété : grands réseaux et points d'échange. */
  private connectivityPanelStateB(): ConnectivityPanelState {
    return { ...this.connectivityPanelState(), connectivity: this.connectivityState };
  }

  /** Panneau de la couche et légende, après une lecture ou une option de la phase B (le seul panneau concerné : pas de rendu de trop). */
  private refreshSovereigntyPanelsB(key: 'military' | 'subseaCables'): void {
    if (key === 'military') this.defensePanel?.update(this.defensePanelStateB());
    else this.connectivityPanel?.update(this.connectivityPanelStateB());
    this.refreshSovereigntyLegend();
  }

  /** Légende Défense datée (tâche A10) complétée par les mailles GNSS du jour UTC précédent et, option active, les zones drones (B27). */
  private defenseLegendB(...args: Parameters<typeof defenseLegend>): ReturnType<typeof defenseLegend> {
    const [m, opts, now] = args;
    return withDefensePhaseB(defenseLegend(m, { ...opts, droneZones: this.droneZonesOn }, now), {
      gnss: this.gnssState?.gnss.data ?? null, drones: this.droneZonesFile, dronesShown: this.droneZonesOn,
    }, now);
  }

  /** Entrées du score (tâche A16) avec les comptes GNSS sans lieu et la pastille Défense recalculée (contrats § 6, phase B ; O17). */
  private buildSovereigntyInputsB(...args: Parameters<typeof buildSovereigntyInputs>): ReturnType<typeof buildSovereigntyInputs> {
    const [military, cables, cyber, now] = args;
    const gnss = this.gnssState?.gnss.data ?? null;
    return withGnssInputs(buildSovereigntyInputs(military, cables, cyber, now), gnss, military, now);
  }

  /** Lignes d'une source de la phase B quand son lecteur échoue sans réponse : datée, « stale » ; sinon « error » (S3). */
  private markSovereigntyBFailed(names: readonly string[], err: unknown): void {
    const error = err instanceof Error ? err.message : 'service de la source introuvable';
    for (const name of names) {
      const dated = this.statusPanel?.getSources().find((s) => s.name === name)?.lastUpdate ?? null;
      this.statusPanel?.updateSource(name, dated !== null ? { status: 'stale', error } : { status: 'error', lastUpdate: null, period: undefined, error });
    }
  }

  /** Source du panneau d'une couche Souveraineté. */
  private loadSovereigntySource(key: SovereigntyLayerKey): Promise<void> {
    switch (key) {
      case 'military': return this.loadMilitary();
      case 'subseaCables': return this.loadCables();
      case 'cyber': return this.loadCyber();
    }
  }

  /** Relève voulue : les trois couches nourrissent le score (SOVEREIGNTY_ALWAYS_POLLED, arbitrage 21) ; sinon couche active ou panneau ouvert. */
  private sovereigntyPollWanted(key: SovereigntyLayerKey): boolean {
    if (SOVEREIGNTY_ALWAYS_POLLED.has(key) || this.activeLayers[key]) return true;
    return this.getFloatingPanelInstance(key)?.isVisible?.() ?? false;
  }

  /** Démarre ou arrête la relève pausable d'une couche Souveraineté (SOVEREIGNTY_POLL_MS), comme syncEnvironmentPolling. */
  private syncSovereigntyPolling(key: SovereigntyLayerKey): void {
    const timer = this.sovereigntyPolls[key];
    if (!this.sovereigntyPollWanted(key)) {
      if (timer) {
        this.removePausableInterval(timer);
        delete this.sovereigntyPolls[key];
      }
      return;
    }
    if (timer) return;
    this.sovereigntyPolls[key] = this.registerPausableInterval(() => {
      if (!this.sovereigntyPollWanted(key)) {
        this.syncSovereigntyPolling(key);
        return;
      }
      this.loadSovereigntySourceB(key).catch((err) => console.error(`[App] Relève ${key} en échec`, err));
    }, SOVEREIGNTY_POLL_MS[key]);
  }

  /**
   * Lecture d'une source Souveraineté : une seule à la fois par couche (démarrage, ouverture, relève : un second appelant rejoint la
   * lecture en cours) ; si le service ne se charge pas, toutes les lignes de la couche le disent (S3).
   */
  private readSovereignty(key: SovereigntyLayerKey, read: () => Promise<void>): Promise<void> {
    return dedupe(`sovereignty:${key}`, () => read().catch((err: unknown) => {
      this.markSovereigntySourcesFailed(key, err);
      throw err;
    }));
  }

  /**
   * Lignes d'une couche Souveraineté quand son service ne se charge pas : une ligne datée garde sa date (« stale »), sinon « error ». Les
   * lignes de la phase B ont chacune leur lecteur (loadGnss, loadConnectivity, loadSanctions) : seul celui-ci les écrit.
   */
  private markSovereigntySourcesFailed(key: SovereigntyLayerKey, err: unknown): void {
    const error = err instanceof Error ? err.message : 'service de la source introuvable';
    for (const name of SOVEREIGNTY_LAYER_SOURCES[key].filter((n) => !SOVEREIGNTY_B_SOURCE_NAMES.has(n))) {
      const dated = this.statusPanel?.getSources().find((s) => s.name === name)?.lastUpdate ?? null;
      this.statusPanel?.updateSource(name, dated !== null ? { status: 'stale', error } : { status: 'error', lastUpdate: null, period: undefined, error });
    }
  }

  /** Historique de qualité des sources Souveraineté hors Watchdog (même store que la santé, les Trafics et l'Environnement). */
  private recordSovereigntySamples(now: number): void {
    recordStatusSamples(this.statusPanel?.getSources().filter((s) => SOVEREIGNTY_SOURCE_NAMES.includes(s.name)) ?? [], now);
  }

  /**
   * Légendes Souveraineté datées par leur donnée (S1) puis montrées selon leur couche ; avant toute lecture, la légende de base (jamais
   * « indisponible » pour une source qui charge).
   */
  private refreshSovereigntyLegend(): void {
    if (!this.mapLegend) return;
    const now = Date.now();
    const shown = (key: SovereigntyLayerKey): boolean => this.activeLayers.sovereignty && this.activeLayers[key];
    this.mapLegend.setCategories([
      {
        ...(this.currentMilitary
          ? this.defenseLegendB(this.currentMilitary.military.data, { osmWorks: this.defenseSites.osm.shown, droneZones: false }, now)
          : DEFENSE_LEGEND),
        visible: shown('military'),
      },
      {
        ...(this.currentCables ? connectivityLegend(this.currentCables.file, this.currentCables.watch.data, now) : CONNECTIVITY_LEGEND),
        visible: shown('subseaCables'),
      },
      { ...(this.currentSovCyber ? cyberLegend(this.currentSovCyber.cyber.data, now) : CYBER_LEGEND), visible: shown('cyber') },
    ]);
  }

  /**
   * État du panneau Défense : relevé adsb.lol, veille des câbles (état de l'AIS vu par le serveur), relecture de la page Vigipirate du
   * SGDSN, sites de défense.
   */
  private defensePanelState(): DefensePanelState {
    return { military: this.currentMilitary, cables: this.currentCables, vigipirate: this.currentVigipirate, sites: this.defenseSites };
  }

  /** État du panneau Connectivité : veille des câbles et fichier des câbles (Shom et OpenStreetMap). */
  private connectivityPanelState(): ConnectivityPanelState {
    return { cables: this.currentCables };
  }

  /**
   * Sites de défense : liste interne en chunk dynamique, lue une fois, sans fusion OpenStreetMap (les ouvrages OSM sont une option datée,
   * setOsmWorks). Lue au démarrage et avant le premier affichage du panneau.
   */
  private loadDefenseSites(): Promise<void> {
    this.defenseSitesPromise ??= Promise.all([import('./config/military-bases-db.ts'), import('./components/layer-panel/defense.ts')])
      .then(([{ ACTIVE_INSTALLATIONS }, { summarizeCuratedSites }]) => {
        this.mapContainer?.updateDefenseSites(ACTIVE_INSTALLATIONS);
        this.defenseSites = { ...this.defenseSites, curated: summarizeCuratedSites(ACTIVE_INSTALLATIONS) };
        this.defensePanel?.update(this.defensePanelStateB());
      })
      .catch((err: unknown) => console.error('[App] Sites de défense non chargés', err));
    return this.defenseSitesPromise;
  }

  /** Option des ouvrages OpenStreetMap (bouton du panneau Défense) : fichier daté lu à la première demande, une fois (arbitrage 10). */
  private setOsmWorks(on: boolean): void {
    this.defenseSites = { ...this.defenseSites, osm: { ...this.defenseSites.osm, shown: on } };
    this.mapContainer?.setOsmWorksVisible(on);
    this.defensePanel?.update(this.defensePanelStateB());
    this.refreshSovereigntyLegend();
    if (!on || this.defenseSites.osm.meta !== null) return;
    void fetchDefenseOsmWorks().then(({ data, error }) => {
      this.mapContainer?.updateOsmWorks(data);
      const meta = data
        ? { generatedAt: data.generatedAt, osmBase: data.osmBase, licence: data.licence, source: data.source, count: data.items.length }
        : null;
      this.defenseSites = { ...this.defenseSites, osm: { ...this.defenseSites.osm, meta, error } };
      this.defensePanel?.update(this.defensePanelStateB());
    });
  }

  /**
   * Défense (spec souveraineté § 2.1 ; amendement 7, O9, O14) : aéronefs militaires ou d'État visibles en ADS-B au-dessus de la
   * métropole (collecte adsb.lol du serveur) et relecture quotidienne de la page Vigipirate du SGDSN (cache de 30 min : une requête au
   * plus par demi-heure) ; panneau, carte, légende et lignes « Vols militaires » et « Vigipirate (page du SGDSN) » datées par leur
   * donnée (S1), jamais « LIVE ».
   */
  private loadMilitary(): Promise<void> {
    return this.readSovereignty('military', async () => {
      const [incoming, check] = await Promise.all([fetchMilitary(this.currentMilitary), fetchVigipirateCheck(this.currentVigipirate)]);
      this.currentMilitary = mergeMilitary(this.currentMilitary, incoming);
      this.currentVigipirate = mergeVigipirateCheck(this.currentVigipirate, check);
      const now = Date.now();
      this.statusPanel?.updateSource('Vols militaires', militaryStatus(this.currentMilitary, now));
      this.statusPanel?.updateSource(VIGIPIRATE_CHECK_SOURCE, vigipirateCheckStatus(this.currentVigipirate, now));
      this.mapContainer?.updateMilitaryLayer(this.currentMilitary.military.data, now);
      this.defensePanel?.update(this.defensePanelStateB());
      this.refreshSovereigntyLegend();
      this.recordSovereigntySamples(now);
      // Score, situations, tuiles et moniteur d'alertes : entrées de sovereigntyInputs() (contrats § 6).
      this.refreshFranceIntelPanel();
    });
  }

  /**
   * Connectivité (§ 2.2) : veille des câbles du serveur et fichier des câbles (Shom et OpenStreetMap) ; panneau, carte, légende et ligne
   * « Câbles et AIS » datée par le dernier message AIS (S1) ; le panneau Défense lit l'état de l'AIS vu par le serveur.
   */
  private loadCables(): Promise<void> {
    return this.readSovereignty('subseaCables', async () => {
      // Fichier des câbles seulement si la carte ou un panneau le montre (Connectivité, Défense) ; l'indice ne lit que la veille.
      const withFile = this.activeLayers.subseaCables === true || this.connectivityPanel?.isVisible() === true || this.defensePanel?.isVisible() === true;
      const incoming = await fetchCables(this.currentCables, Date.now(), withFile);
      this.currentCables = mergeCables(this.currentCables, incoming);
      const now = Date.now();
      this.statusPanel?.updateSource('Câbles et AIS', cablesStatus(this.currentCables, now));
      this.mapContainer?.updateCablesLayer(this.currentCables.file, this.currentCables.watch.data, now);
      this.connectivityPanel?.update(this.connectivityPanelStateB());
      this.defensePanel?.update(this.defensePanelStateB());
      this.refreshSovereigntyLegend();
      this.recordSovereigntySamples(now);
      this.refreshFranceIntelPanel();
    });
  }

  /**
   * Vigilance cyber (§ 2.3) : CERT-FR, CISA KEV, revendications, fuites publiées, Cybermalveillance (collecte du serveur) ; panneau,
   * légende et cinq lignes du panneau des sources, chacune datée par sa partie de la réponse (arbitrage 22).
   */
  private loadCyber(): Promise<void> {
    return this.readSovereignty('cyber', async () => {
      const incoming = await fetchCyber(this.currentSovCyber);
      this.currentSovCyber = mergeCyber(this.currentSovCyber, incoming);
      const now = Date.now();
      for (const [part, name] of CYBER_STATUS_PARTS) this.statusPanel?.updateSource(name, cyberStatus(this.currentSovCyber, part, now));
      this.cyberPanel?.update(this.currentSovCyber);
      this.refreshSovereigntyLegend();
      this.recordSovereigntySamples(now);
      this.refreshFranceIntelPanel();
    });
  }

  /**
   * Clic sur un objet Souveraineté de la carte (contrats § 4.4 point 19) : un bâtiment de la Marine nationale ouvre sa fiche à sa position
   * (« position de référence, pas une observation » au port base) ; un aéronef ou une urgence ouvre le panneau Défense ; un câble, un
   * atterrage ou un navire signalé ouvrent le panneau Connectivité. Sites et ouvrages : infobulle seule (un site garde son propre clic).
   * Phase B : une maille GNSS (jour UTC précédent seulement, O17) recentre la carte et ouvre le panneau Défense ; une zone drones : infobulle
   * seule.
   */
  private onSovereigntyMapClick(layerId: string, props: Record<string, unknown>): void {
    const id = typeof props['id'] === 'string' ? props['id'] : null;
    if (layerId === LYR_SOV_GNSS_FILL) {
      // « 48:-3.5 » : coin sud-ouest de la maille, même clé que `data-gnss-cell` du panneau.
      const [lat, lon] = typeof props['cell'] === 'string' ? props['cell'].split(':').map(Number) : [];
      if (lat !== undefined && lon !== undefined && Number.isFinite(lat) && Number.isFinite(lon)) this.focusGnssCell({ lat, lon });
      this.showSovereigntyPanel('military');
      return;
    }
    if (layerId === LYR_SOV_NAVY_OBSERVED || layerId === LYR_SOV_NAVY_REFERENCE) {
      // Clé du marqueur `mmsi ?? id` ; un bâtiment sans MMSI vérifié (O12) n'est trouvé que par son identifiant.
      const ship = id !== null ? findShipByKey(id, getMilitaryShips()) : undefined;
      const at = ship ? this.mapContainer?.project(ship.lon, ship.lat) ?? null : null;
      if (ship && at) this.mapPopup?.showMilitaryShip(ship, at.x, at.y);
      return;
    }
    if (layerId === LYR_SOV_AIRCRAFT || layerId === LYR_SOV_AIRCRAFT_ABROAD || layerId === LYR_SOV_EMERGENCIES) {
      this.showSovereigntyPanel('military');
    } else if (layerId === LYR_SUBMARINE_CABLES_HITAREA || layerId === LYR_SUBMARINE_CABLES_LANDING || layerId === LYR_SOV_CABLE_VESSELS) {
      if (layerId === LYR_SUBMARINE_CABLES_HITAREA && id !== null) this.mapContainer?.highlightCable(id);
      this.showSovereigntyPanel('subseaCables');
    }
  }

  /**
   * Entrées Souveraineté du score, des situations, de la frise, des tuiles et du moniteur d'alertes (contrats § 6), lues dans les
   * dernières réponses des services, jamais copiées ailleurs (modèle environmentInputs). Phase B : grille GNSS par buildSovereigntyInputsB.
   */
  private sovereigntyInputs(now: number = Date.now()): SovereigntyInputs {
    return this.buildSovereigntyInputsB(
      this.currentMilitary?.military.data ?? null, this.currentCables?.watch.data ?? null, this.currentSovCyber?.cyber.data ?? null, now,
    );
  }

  /** État du panneau Radar : manifeste, option des sommets d'écho (partagée avec les feux) et profil du point cliqué. */
  private radarPanelState(): RadarPanelState {
    const manifest = this.radarManifest?.configured ? this.radarManifest.manifest : null;
    return {
      manifest, configured: this.radarManifest?.configured ?? true, error: this.radarError, echoTops: this.echoTopsEnabled,
      echoTopsAvailable: Boolean(manifest?.echoTopImageUrl), profile: this.radarProfile,
    };
  }

  /** État du panneau Feux : collecte du serveur, incidents du dossier, MTG-FRP dérivé et options de la carte. */
  private firesPanelState(): FiresPanelState {
    const manifest = this.radarManifest?.configured ? this.radarManifest.manifest : null;
    return {
      fires: this.currentFires, incidents: this.currentFireIncidents, mtgFrp: this.mtgFrpFeed,
      options: {
        gibs: this.gibsEnabled, mtgFrp: this.mtgFrpEnabled, echoTops: this.echoTopsEnabled,
        echoTopsAvailable: Boolean(manifest?.echoTopImageUrl), forestDangerFill: this.forestDangerFill,
      },
    };
  }

  /** Option « Sommets d'écho » (un seul état pour les panneaux Radar et Feux) : carte, panneaux, légende, relève du manifeste. */
  private setEchoTops(on: boolean): void {
    this.echoTopsEnabled = on;
    const manifest = this.radarManifest?.configured ? this.radarManifest.manifest : null;
    this.mapContainer?.setEchoTopsOverlay(manifest, on);
    if (on && manifest === null) this.loadRadarManifest().catch((err) => console.error('[App] Manifeste radar indisponible', err));
    this.weatherRadarPanel?.update(this.radarPanelState());
    this.firesPanel?.update(this.firesPanelState());
    this.refreshEnvironmentLegend();
    this.syncEnvironmentPolling('weatherRadar');
  }

  /** Clic sur la carte, couche Radar active : profil vertical à la station la plus proche (démonstration) ; un clic plus récent l'emporte. */
  private loadRadarProfile(lat: number, lon: number): void {
    this.radarProfile = { lat, lon, result: 'loading' };
    this.mapContainer?.setRadarPick({ lat, lon });
    this.weatherRadarPanel?.update(this.radarPanelState());
    void fetchRadarColumn(lat, lon).catch(() => null).then((result) => {
      if (this.radarProfile?.lat !== lat || this.radarProfile.lon !== lon) return;
      this.radarProfile = { lat, lon, result: result ?? 'error' };
      this.weatherRadarPanel?.update(this.radarPanelState());
    });
  }

  /** Train choisi dans le panneau ferroviaire : son trajet tracé par ses arrêts, puis la carte se centre dessus. */
  private focusTrain(train: RailTrain): void {
    this.mapContainer?.highlightTrainRoute(train);
    const first = train.stops[0];
    const last = train.stops[train.stops.length - 1];
    if (!first || !last) return;
    this.mapContainer?.flyTo((first.lon + last.lon) / 2, (first.lat + last.lat) / 2, first === last ? 10 : 6);
  }

  private ensureOilPanel(): Promise<void> {
    if (!this.floatContainerEl) return Promise.resolve();
    this.oilPanelPromise ??= import('./components/OilPanel.ts').then(({ OilPanel }) => {
      const panel = new OilPanel(this.floatContainerEl!);
      // skipLayout: oil panel doesn't use the energy floating stack
      panel.setOnClose(() => this.closeEnergyLayer('oilNetwork', { skipLayout: true }));
      panel.setOnFuelTensionMapVisibilityChange((visible) => {
        void this.mapContainer?.updateFuelTension(visible ? this.currentFuelTensionData : null);
      });
      panel.mount();
      this.oilPanel = panel;
      // mirror _handlePanelVisibility('oilNetwork') — show even without data yet
      // (loadOil was already triggered when the layer was toggled and will
      // update() the panel once it resolves).
      if (this.activeLayers.oilNetwork) {
        panel.show(this.currentOilData, this.currentFuelTensionData);
      }
    });
    return this.oilPanelPromise;
  }

  private ensureNuclearPanel(): Promise<void> {
    if (!this.floatContainerEl) return Promise.resolve();
    this.nuclearPanelPromise ??= import('./components/NuclearPanel.ts').then(({ NuclearPanel }) => {
      const panel = new NuclearPanel(this.floatContainerEl!);
      panel.mount();
      panel.setOnPlantHover((plantName) => {
        if (!plantName) {
          this.mapContainer?.setHighlightedInfrastructurePoint(null);
          return;
        }
        const plant = NUCLEAR_PLANTS.find((item) => item.name === plantName);
        this.mapContainer?.setHighlightedInfrastructurePoint(plant?.coordinates ?? null);
      });
      panel.setOnClose(() => {
        // Clear any highlighted plant before deactivating the layer
        this.mapContainer?.setHighlightedInfrastructurePoint(null);
        this.closeEnergyLayer('nuclearFleet');
      });
      this.nuclearPanel = panel;
      panel.setAsnr(this.currentAsnr);
      if (this.activeLayers.nuclearFleet) {
        panel.show(this.currentNuclearState, this.currentEcowattResponse);
        this.layoutEnergyFloatingPanels();
      }
    });
    return this.nuclearPanelPromise;
  }

  /**
   * Dispatches a toggled/restored layer key to the matching ensureXPanel()
   * loader above, if any. Called from onLayerToggle() (when a layer is
   * switched on) and restoreActiveLayerPanelsAfterRefresh() (persisted
   * layers active at boot). No-op for layers with no lazy panel (or an
   * eagerly-constructed one, e.g. energyPanel/gasPanel).
   */
  /**
   * Returns the ensureXPanel() promise(s) this key triggers (empty array for
   * layers with no lazy panel). Callers that don't need the promises (the
   * normal toggle/restore path) simply ignore the return value; callers that
   * need to know once the chunk has resolved — activateLayerSilently(), to
   * hide a panel that only became showable after an async import — chain on
   * it. ensureXPanel() promises are memoized (`??=`), so calling this twice
   * for the same key never re-triggers the import.
   */
  private ensureLazyPanelForLayer(key: keyof MapLayers): Promise<void>[] {
    switch (key) {
      case 'dromEnergy': return [this.ensureDromEnergyPanel()];
      case 'hydroBackbone': return [this.ensureHydraulicPanel()];
      case 'windMonitor': return [this.ensureEolienPanel()];
      case 'metroLoad': return [this.ensureMetroLoadPanel()];
      case 'health': return [this.ensureVeillePanel()];
      case 'healthOscour': return [this.ensureUrgencesPanel()];
      case 'healthApl': return [this.ensureAccesSoinsPanel()];
      case 'hospitals': return [this.ensureHopitauxPanel()];
      case 'environmental': return [this.ensureVigilancePanel()];
      case 'floods': return [this.ensureFloodsPanel()];
      case 'weatherRadar': return [this.ensureWeatherRadarPanel()];
      case 'fires': return [this.ensureFiresPanel()];
      case 'drought': return [this.ensureDroughtPanel()];
      case 'airQuality': return [this.ensureAirQualityPanel()];
      case 'earthquakes': return [this.ensureEarthquakesPanel()];
      case 'disasters': return [this.ensureDisastersPanel()];
      case 'protests': return [this.ensureProtestsPanel()];
      case 'crime': return [this.ensureCrimePanel()];
      case 'webcams': return [this.ensureWebcamsPanel()];
      case 'envBrief': return [this.ensureEnvBriefPanel()];
      case 'brief': return [this.ensureThemeBriefPanel()];
      case 'seveso': return [this.ensureSevesoPanel()];
      case 'pollens': return [this.ensurePollensPanel()];
      case 'pedestrianFlows': return [this.ensureFluxPanel()];
      case 'trafficRoad': return [this.ensureTrafficPanel()];
      case 'trafficAir': return [this.ensureAirTrafficPanel()];
      case 'trafficRail': return [this.ensureTransportPanel()];
      case 'trafficMaritime': return [this.ensureMaritimePanel()];
      // Souveraineté (contrats § 4.4 point 12) : un panneau par couche.
      case 'military': return [this.ensureDefensePanel()];
      case 'subseaCables': return [this.ensureConnectivityPanel()];
      case 'cyber': return [this.ensureCyberPanel()];
      case 'sovereignty': return [this.ensureDefensePanel(), this.ensureConnectivityPanel(), this.ensureCyberPanel()];
      case 'oilNetwork': return [this.ensureOilPanel()];
      case 'nuclearFleet': return [this.ensureNuclearPanel()];
      // Pannes réseau : un panneau par couche.
      case 'outagesElec':
      case 'outagesTelecom':
      case 'outagesInternet':
      case 'outagesCloud':
        return [this.ensureOutagesLayerPanel(key)];
      case 'outages': return OUTAGES_LAYER_KEYS.map((k) => this.ensureOutagesLayerPanel(k));
      default:
        return [];
    }
  }

  /**
   * Single floating-panel registry lookups (audit UI 2026-09 §5.3.3) — see
   * FLOATING_PANEL_DEFS for the layer-key → panel mapping.
   */
  private floatingPanelIdForLayerKey(key: keyof MapLayers): (keyof MapLayers) | null {
    return FLOATING_PANEL_DEFS.find((def) => def.layerKeys.includes(key))?.id ?? null;
  }

  private getFloatingPanelInstance(key: keyof MapLayers): { hide(opts?: { silent?: boolean }): void; isVisible?(): boolean } | null {
    // Accepts either a def's representative `id` or any of its `layerKeys`
    // members (a def may list several keys):
    // callers like activateLayerSilently() pass the exact key that was just
    // toggled, which isn't always the representative one.
    const id = this.floatingPanelIdForLayerKey(key) ?? key;
    switch (id) {
      case 'environmental': return this.vigilancePanel;
      case 'floods': return this.floodsPanel;
      case 'weatherRadar': return this.weatherRadarPanel;
      case 'fires': return this.firesPanel;
      case 'drought': return this.droughtPanel;
      case 'airQuality': return this.airQualityPanel;
      case 'earthquakes': return this.earthquakesPanel;
      case 'disasters': return this.disastersPanel;
      case 'powerGrid': return this.energyPanel;
      case 'dromEnergy': return this.dromEnergyPanel;
      case 'nuclearFleet': return this.nuclearPanel;
      case 'gasNetwork': return this.gasPanel;
      case 'hydroBackbone': return this.hydraulicPanel;
      case 'oilNetwork': return this.oilPanel;
      case 'windMonitor': return this.eolienPanel;
      case 'metroLoad': return this.metroLoadPanel;
      case 'health': return this.veillePanel;
      case 'healthOscour': return this.urgencesPanel;
      case 'healthApl': return this.accesSoinsPanel;
      case 'hospitals': return this.hopitauxPanel;
      case 'trafficRoad': return this.trafficPanel;
      case 'trafficAir': return this.airTrafficPanel;
      case 'trafficRail': return this.transportPanel;
      case 'trafficMaritime': return this.maritimePanel;
      case 'cyber': return this.cyberPanel;
      case 'military': return this.defensePanel;
      case 'subseaCables': return this.connectivityPanel;
      case 'stability': return this.uiV2 ? this.pressurePanel : this.isnrPanel;
      case 'outagesElec': return this.outagesPowerPanel;
      case 'outagesTelecom': return this.outagesTelecomPanel;
      case 'outagesInternet': return this.outagesInternetPanel;
      case 'outagesCloud': return this.outagesCloudPanel;
      case 'protests': return this.protestsPanel;
      case 'crime': return this.crimePanel;
      case 'webcams': return this.webcamsPanel;
      case 'envBrief': return this.envBriefPanel;
      case 'brief': return this.themeBriefPanel;
      case 'seveso': return this.sevesoPanel;
      case 'pollens': return this.pollensPanel;
      case 'pedestrianFlows': return this.fluxPanel;
      default: return null;
    }
  }

  /** Hides every layer-owned floating panel (FLOATING_PANEL_DEFS) plus the
   *  France Intel drawer, optionally sparing one — the shared "one floating
   *  panel at a time" primitive (audit UI 2026-09 §5.3.3). `exceptId` is used
   *  by showFloatingPanel() (about to show it). */
  private hideAllFloatingPanels(exceptId?: keyof MapLayers): void {
    for (const def of FLOATING_PANEL_DEFS) {
      if (def.id === exceptId) continue;
      // silent : masquer sans passer par onClose, qui désactiverait la couche (closeEnergyLayer…).
      this.getFloatingPanelInstance(def.id)?.hide({ silent: true });
    }
    this.franceIntelPanel?.hide({ silent: true });
  }

  /**
   * Central "open exactly one floating panel" helper (audit UI 2026-09
   * §5.3.3). Hides every other layer-owned floating panel, then reuses
   * _handlePanelVisibility()'s existing per-layer show logic (cached data or
   * loading state) to display `id`. Call sites are explicit user actions: a
   * layer checkbox toggled on (onLayerToggle()), a chip in the switcher, or
   * a Sources-panel click (handleSourcePanelClick()) — never a preset
   * (applyLayerPreset() deliberately keeps panels hidden, see
   * activateLayerSilently()).
   */
  private showFloatingPanel(id: keyof MapLayers): void {
    this.syncV2ColumnVars();
    this.hideAllFloatingPanels(id);
    this._handlePanelVisibility(id, true);
    this.currentFloatingPanelId = id;
    this.refreshFloatingPanelSwitcher();
  }

  /**
   * Activates `key` exactly like a real layer toggle (data load via
   * _handlePanelVisibility, lazy panel chunk request) but hides whatever
   * floating panel that activation would otherwise show — both the
   * synchronous case (chunk already loaded) and the async one (chunk
   * resolves later, after this call returns). Used by applyLayerPreset() and
   * the first-load path of restoreActiveLayerPanelsAfterRefresh(): a preset
   * or the home view changes the map, it never auto-opens a panel — only
   * showFloatingPanel() does that, from an explicit action.
   */
  private activateLayerSilently(key: keyof MapLayers): void {
    this._handlePanelVisibility(key, true);
    // silent : la couche reste active, seul le panneau est masqué (voir hideAllFloatingPanels).
    this.getFloatingPanelInstance(key)?.hide({ silent: true });
    for (const p of this.ensureLazyPanelForLayer(key)) {
      void p.then(() => this.getFloatingPanelInstance(key)?.hide({ silent: true }));
    }
  }

  /** Is `id`'s floating panel currently the one on screen? Prefers the
   *  panel's own isVisible() (ground truth, catches closes that bypassed
   *  showFloatingPanel — e.g. the panel's own × button) and falls back to
   *  the tracked id for the few panels that don't implement isVisible(). */
  private isFloatingPanelVisible(id: keyof MapLayers): boolean {
    const panel = this.getFloatingPanelInstance(id);
    if (!panel) return false;
    if (typeof panel.isVisible === 'function') return panel.isVisible();
    return this.currentFloatingPanelId === id;
  }

  /**
   * « Panneaux ouverts » chip bar (audit UI 2026-09 §5.3 point 3): one chip
   * per floating panel whose owning layer is active AND whose lazy chunk has
   * resolved. Hidden below 2 eligible panels — with 0 or 1 there is nothing
   * to switch between. Clicking a chip routes through showFloatingPanel(),
   * the single place that hides every other panel.
   */
  private refreshFloatingPanelSwitcher(): void {
    const el = this.floatingPanelSwitcherEl;
    if (!el) return;

    if (this.currentFloatingPanelId && !this.floatingPanelIsEligible(this.currentFloatingPanelId)) {
      this.currentFloatingPanelId = null;
    }

    // « En bref » déjà active au démarrage (état restauré) : son panneau n'a jamais été demandé, la pastille manquerait.
    if (this.activeLayers.brief && !this.themeBriefPanel) {
      void this.ensureThemeBriefPanel().then(() => { if (this.themeBriefPanel) this.refreshFloatingPanelSwitcher(); });
    }

    // Vue générale : pas de puce pour une couche du socle au vert (13/10/2026), sa couche reste allumée.
    const hideGreen = this.uiV2 && this.v2Theme === 'general' && this.watchModule !== null;
    // Foule estimée : pas de puce, son panneau s'ouvre depuis une manifestation (fusion avec Manifestations, 19/10/2026).
    // L'Environnement a son propre En bref (envBrief) : jamais deux pastilles « En bref ».
    const eligible = FLOATING_PANEL_DEFS.filter((def) => def.id !== 'pedestrianFlows' && this.floatingPanelIsEligible(def.id)
      && !(def.id === 'brief' && this.v2Theme === 'environment')
      && !(hideGreen && this.watchModule?.generalChipHidden(def.id, this.watchEntries)));

    // v2 : puce « Actualités géolocalisées » en tête (12/10/2026), dans la vue qui affiche les actualités (Vue générale), même
    // éteinte pour pouvoir les rallumer ; ailleurs, seulement si la couche a été cochée à la main.
    const showNews = this.uiV2 && (presetShowsEvents(this.v2Theme) || this.activeLayers.events === true);
    if (!showsSwitcher(this.uiV2, eligible.length + (showNews ? 1 : 0))) {
      el.hidden = true;
      el.innerHTML = '';
      this.energyFocusActive = [];
      this.energyFocusPreview = null;
      this.syncEnergyFocus();
      this.generalFocusActive = [];
      this.generalFocusPreview = null;
      this.syncGeneralFocus();
      this.layoutFloatingPanelSwitcher();
      return;
    }

    el.hidden = false;
    const newsOn = this.activeLayers.events === true;
    const newsAction = newsOn ? 'Masquer les actualités géolocalisées de la carte' : 'Afficher les actualités géolocalisées sur la carte';
    // Même puce que les autres : pleine quand les points d'actualité (couche « Événements en cours ») sont affichés ; un clic les
    // montre ou les cache.
    const newsChip = !showNews ? '' : `
        <button
          type="button"
          class="floating-panel-switcher__chip ${newsOn ? 'is-active' : ''}"
          data-events-toggle
          aria-pressed="${newsOn}"
          aria-label="${newsAction}"
          title="${newsAction}"
        >
          <span class="floating-panel-switcher__icon" aria-hidden="true">${fmIcon('newspaper')}</span>
          <span class="floating-panel-switcher__label">Actualités géolocalisées</span>
        </button>
      `;
    // Vue générale dynamique : puces dans l'ordre des niveaux (rouge d'abord), voyant de niveau ; « n.d. » en gris (12/10/2026).
    // Onglet Environnement (20/10/2026) : même voyant, niveau de la pastille du panneau ; rouge d'abord.
    // Onglet Transports (lot 1, 25/10/2026) : voyants et ordre par niveau comme l'Environnement.
    const inEnv = this.uiV2 && (this.v2Theme === 'environment' || this.v2Theme === 'transport');
    // Pastilles cumulables avec mise en avant : Environnement et Pannes (21/10/2026), Transports (25/10/2026), comme Santé et Énergie.
    const theme = this.uiV2 ? this.v2Theme : 'general';
    const cumul = this.uiV2 && (theme === 'environment' || theme === 'outages' || theme === 'transport');
    const isCumul = (id: string): id is keyof MapLayers => cumul && cumulFocusKey(theme, id);
    const watchedLevel = (id: keyof MapLayers): string | null =>
      this.uiV2 && this.v2Theme === 'general' ? this.watchEntries.find((e) => e.key === id)?.level ?? null
        : inEnv ? this.watchLevelMap.get(id) ?? null : null;
    const ENV_ORDER: Record<string, number> = { rouge: 0, orange: 1, jaune: 2, nd: 3, vert: 4 };
    // En bref en tête de l'onglet, puis les pastilles par niveau.
    const envRank = (id: keyof MapLayers): number => id === 'envBrief' ? -1 : ENV_ORDER[this.watchLevelMap.get(id) ?? ''] ?? 5;
    const watchRank = (id: keyof MapLayers): number => {
      const i = this.watchEntries.findIndex((e) => e.key === id);
      return i === -1 ? this.watchEntries.length : i;
    };
    const ordered = this.uiV2 && this.v2Theme === 'general' ? [...eligible].sort((a, b) => watchRank(a.id) - watchRank(b.id))
      : inEnv ? [...eligible].sort((a, b) => envRank(a.id) - envRank(b.id)) : eligible;
    // « En bref » toujours en tête de la barre, dans tous les onglets (20/10/2026).
    const briefFirst = (d: { id: keyof MapLayers }): number => (d.id === 'brief' || d.id === 'envBrief' ? 0 : 1);
    ordered.sort((a, b) => briefFirst(a) - briefFirst(b));
    // Énergie : pastilles vertes cumulables (retenues par un clic ou panneau ouvert) ; on oublie celles qui ne sont plus proposées.
    const ids = ordered.map((def) => def.id);
    for (const k of [...this.energyChipsSelected]) if (!ids.includes(k)) this.energyChipsSelected.delete(k);
    const energyPressed = energyChipsPressed(ids, this.energyChipsSelected, (id) => this.isFloatingPanelVisible(id));
    // Environnement : pastilles cumulables comme Énergie (retenues par un clic, ou panneau ouvert).
    if (!cumul) this.envChipsSelected.clear();
    for (const k of [...this.envChipsSelected]) if (!ids.includes(k)) this.envChipsSelected.delete(k);
    const envPressed = cumul ? envChipsPressed(ids, this.envChipsSelected, (id) => this.isFloatingPanelVisible(id), isCumul) : [];
    el.innerHTML = newsChip + ordered.map((def) => {
      // Surligné = son panneau est à l'écran (Énergie : ou pastille retenue) ; un clic l'ouvre ou le referme (la couche reste active).
      const pressed = isEnergyLayerKey(def.id) && usesEnergyFocus(theme, def.id) ? energyPressed.includes(def.id)
        : isCumul(def.id) ? envPressed.includes(def.id) : this.isFloatingPanelVisible(def.id);
      const level = watchedLevel(def.id);
      const action = t(pressed ? 'app.floatingPanelHide' : 'app.floatingPanelShow', { value: def.label })
        + (level === 'nd' ? ' (source indisponible)' : '');
      return `
        <button
          type="button"
          class="floating-panel-switcher__chip ${pressed ? 'is-active' : ''}"
          data-panel-key="${def.id}"
          aria-pressed="${pressed}"
          aria-label="${action}"
          title="${action}"
        >
          <span class="floating-panel-switcher__icon" aria-hidden="true">${fmIcon(def.icon)}</span>
          <span class="floating-panel-switcher__label">${def.label}</span>
          ${level ? `<span class="fps-level fps-level--${level}" title="${level === 'nd' ? 'source indisponible' : level}" aria-hidden="true"></span>` : ''}
        </button>
      `;
    }).join('');

    el.querySelector<HTMLButtonElement>('[data-events-toggle]')?.addEventListener('click', () => {
      this.onLayerToggle('events', !this.activeLayers.events, layerActivationOptions(this.uiV2));
      this.layerPanel?.updateLayers(this.activeLayers);
      this.refreshFloatingPanelSwitcher();
    });
    el.querySelectorAll<HTMLButtonElement>('[data-panel-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset['panelKey'] as keyof MapLayers | undefined;
        if (!key) return;
        if (isEnergyLayerKey(key) && usesEnergyFocus(theme, key)) {
          // Pastilles Énergie cumulables : un seul panneau à droite (le dernier allumé), plusieurs couches mises en avant.
          const t = toggleEnergyChip(this.energyChipsSelected, key, energyPressed.includes(key));
          this.energyChipsSelected = t.selected;
          if (t.open) this.showFloatingPanel(key);
          else if (this.isFloatingPanelVisible(key)) this.hideFloatingPanel(key);
          else this.refreshFloatingPanelSwitcher();
          return;
        }
        if (isCumul(key)) {
          // Environnement et Pannes : même règle qu'Énergie, pastilles cumulables, panneau de droite = la dernière allumée.
          const t = toggleEnvChip(this.envChipsSelected, key, envPressed.includes(key));
          this.envChipsSelected = t.selected;
          if (t.open) this.showFloatingPanel(key);
          else if (this.isFloatingPanelVisible(key)) this.hideFloatingPanel(key);
          else this.refreshFloatingPanelSwitcher();
          return;
        }
        if (this.isFloatingPanelVisible(key)) this.hideFloatingPanel(key);
        else this.showFloatingPanel(key);
      });
    });
    this.layoutFloatingPanelSwitcher();
    // Cadrage « France et Corse » accroché : un panneau ouvert ou fermé change la place libre sur la carte.
    this.mapContainer?.refitFrance();
    // Pastilles Énergie allumées : mise en avant persistante. La barre est réécrite à chaque arrivée de données : l'aperçu suit la
    // pastille encore sous le pointeur (sinon un survol tombait au milieu, souris immobile).
    const hovered = el.querySelector<HTMLElement>('.floating-panel-switcher__chip[data-panel-key]:hover')?.dataset['panelKey'] ?? null;
    this.energyFocusActive = energyPressed.filter((k) => usesEnergyFocus(theme, k));
    this.energyFocusPreview = hovered && isEnergyLayerKey(hovered) && usesEnergyFocus(theme, hovered) ? hovered : null;
    this.syncEnergyFocus();
    // Vue générale : la pastille dont le panneau est ouvert reste mise en avant, comme une pastille Énergie allumée. Lu à l'image
    // suivante : à l'ouverture ou à la fermeture d'un panneau, sa visibilité n'est à jour qu'après ce rafraîchissement.
    this.generalFocusPreview = hovered && !usesEnergyFocus(theme, hovered) ? hovered as keyof MapLayers : null;
    requestAnimationFrame(() => {
      if (cumul) {
        this.generalFocusActive = envChipsPressed(ids, this.envChipsSelected, (id) => this.isFloatingPanelVisible(id), isCumul);
      } else {
        const open = this.currentFloatingPanelId;
        this.generalFocusActive = open && open !== 'brief' && !isEnergyLayerKey(open) && this.isFloatingPanelVisible(open) ? [open] : [];
      }
      this.syncGeneralFocus();
    });
  }

  /**
   * Vue générale (19/10/2026), même règle que les pastilles Énergie : la pastille survolée, ou celle dont le panneau est ouvert,
   * laisse sa couche vive (les autres se tamisent) et montre sa légende courte sous la barre. Onglet Environnement (20/10/2026) :
   * pastilles cumulables, légendes cumulées, chacune avec sa ligne d'état (niveau, âge de la donnée). Sécurité et Santé ont la leur
   * (public/maquette-*.js), Énergie aussi (syncEnergyFocus).
   */
  private generalFocusActive: Array<keyof MapLayers> = [];
  private generalFocusPreview: keyof MapLayers | null = null;
  private generalFocusShown = '';

  private pastillePreviewTimer: ReturnType<typeof setTimeout> | null = null;

  /** Survol des pastilles : seul le dernier aperçu demandé s'applique, après 120 ms sans mouvement vers une autre pastille. */
  private schedulePastillePreview(apply: () => void): void {
    if (this.pastillePreviewTimer !== null) clearTimeout(this.pastillePreviewTimer);
    this.pastillePreviewTimer = setTimeout(() => { this.pastillePreviewTimer = null; apply(); }, PASTILLE_PREVIEW_DELAY_MS);
  }

  private setGeneralFocusPreview(key: keyof MapLayers | null): void {
    if (key === this.generalFocusPreview) return;
    this.generalFocusPreview = key;
    this.syncGeneralFocus();
  }

  /** Heure de la donnée d'une couche Environnement pour la ligne d'état (lecture ; observation pour le radar). */
  private envDataAt(key: keyof MapLayers): { at: number | null; verb: string } {
    const read = (x: { fetchedAt: number | null } | undefined): number | null => x?.fetchedAt ?? null;
    switch (key) {
      case 'environmental': return { at: read(this.currentVigilance?.vigilance), verb: 'lu' };
      case 'floods': return { at: read(this.currentFloods?.floods), verb: 'lu' };
      case 'fires': return { at: read(this.currentFires?.fires), verb: 'lu' };
      case 'drought': return { at: read(this.currentDrought?.drought), verb: 'lu' };
      case 'airQuality': return { at: read(this.currentAirQuality?.air), verb: 'lu' };
      case 'earthquakes': return { at: read(this.currentEarthquakes?.quakes), verb: 'lu' };
      case 'disasters': return { at: read(this.currentDisasters?.disasters), verb: 'lu' };
      case 'weatherRadar': {
        const observed = this.radarManifest?.configured ? Date.parse(this.radarManifest.manifest.observedAt) : NaN;
        return { at: Number.isFinite(observed) ? observed : null, verb: 'image' };
      }
      case 'trafficRoad': return { at: read(this.currentRoadTraffic?.national), verb: 'lu' };
      case 'trafficAir': return { at: read(this.currentAirOverview?.overview), verb: 'lu' };
      case 'trafficRail': return { at: read(this.currentRailTraffic?.overview), verb: 'lu' };
      case 'trafficMaritime': return { at: read(this.currentMaritimeSnapshot?.snapshot), verb: 'lu' };
      default: return { at: null, verb: 'lu' };
    }
  }

  private syncGeneralFocus(): void {
    // Ligne d'état de la mini-légende (niveau, âge de la donnée) : Environnement et Transports.
    const inEnv = this.uiV2 && (this.v2Theme === 'environment' || this.v2Theme === 'transport');
    // Onglet Environnement : toutes les couches visibles à l'ouverture, comme Santé (20/10/2026, décision utilisateur). Le mode
    // « l'anormal d'abord » (deckgl/env-context.ts, setEnvContext) reste disponible mais n'est plus activé.
    const inScope = this.uiV2 && (this.v2Theme === 'general' || inEnv || this.v2Theme === 'outages');
    this.mapContainer?.setTransportFocus(inScope && this.v2Theme === 'transport' ? [...this.generalFocusActive, ...(this.generalFocusPreview ? [this.generalFocusPreview] : [])] : []);
    const keys: Array<keyof MapLayers> = [];
    if (inScope) {
      // Les En bref sont des synthèses : ouverts ou survolés, ils ne tamisent rien (20/10/2026).
      for (const k of this.generalFocusActive) if (!keys.includes(k) && k !== 'envBrief' && k !== 'brief') keys.push(k);
      if (this.generalFocusPreview && !keys.includes(this.generalFocusPreview)) keys.push(this.generalFocusPreview);
    }
    const shown = keys.join(',');
    if (shown !== this.generalFocusShown) {
      this.generalFocusShown = shown;
      this.mapContainer?.setGeneralFocus(keys);
    }
    let panel = document.getElementById('general-focus-key');
    const switcher = this.floatingPanelSwitcherEl;
    const now = Date.now();
    const blocks = keys.map((key) => {
      const legend = this.mapLegend?.getCategory(key);
      if (!legend) return '';
      const items = legend.items.filter((i) => !i.isHeader && i.visible !== false && (i.color || i.borderColor)).slice(0, 6);
      // Couche sans dessin sur la carte (Vigilance cyber) : sa légende dit pourquoi, en texte.
      const texts = items.length === 0 ? legend.items.filter((i) => i.visible !== false).map((i) => i.label).slice(0, 2) : [];
      const dataAt = inEnv ? this.envDataAt(key) : null;
      const status = inEnv && dataAt ? envFocusStatus(this.watchLevelMap.get(key) ?? null, dataAt.at, now, dataAt.verb) : null;
      if (items.length === 0 && texts.length === 0 && status === null) return '';
      const rows = items.map((i) => `<div class="ef-row">${focusSwatchHtml(i)}<span>${escapeHtml(i.label)}</span></div>`).join('')
        + texts.map((tx) => `<div class="ef-row"><span>${escapeHtml(tx)}</span></div>`).join('');
      return `<div class="ef-key"><div class="ef-title">${escapeHtml(legend.title)}</div>${rows}${status ? `<div class="ef-status">${escapeHtml(status)}</div>` : ''}</div>`;
    }).join('');
    if (blocks === '' || !switcher || switcher.hidden) {
      panel?.remove();
      return;
    }
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'general-focus-key';
      document.body.appendChild(panel);
    }
    panel.innerHTML = blocks;
    const r = switcher.getBoundingClientRect();
    panel.style.left = `${Math.round(r.left)}px`;
    panel.style.top = `${Math.round(r.bottom + 6)}px`;
    // Onglet Pannes (22/10/2026) : sous les pastilles, la légende recouvrait la barre des réseaux de la salle ; posée en bas à gauche
    // de la carte, au-dessus de la frise.
    const frise = this.v2Theme === 'outages' ? document.querySelector('.orm-frise') : null;
    if (frise) {
      const f = frise.getBoundingClientRect();
      panel.style.left = `${Math.round(f.left)}px`;
      panel.style.top = `${Math.round(f.top - panel.getBoundingClientRect().height - 8)}px`;
    }
  }

  /** Pastilles Énergie allumées (vertes) et pastille survolée en aperçu. */
  private energyFocusActive: EnergyLayerKey[] = [];
  /** Pastilles Énergie allumées par un clic (cumulables, indépendantes du panneau affiché). */
  private energyChipsSelected = new Set<EnergyLayerKey>();
  /** Pastilles Environnement allumées par un clic (cumulables, 20/10/2026). */
  private envChipsSelected = new Set<keyof MapLayers>();
  private energyFocusPreview: EnergyLayerKey | null = null;

  private setEnergyFocusPreview(key: EnergyLayerKey | null): void {
    if (key === this.energyFocusPreview) return;
    this.energyFocusPreview = key;
    this.syncEnergyFocus();
  }

  /** Couches vives et légendes cumulées : pastilles allumées, plus la pastille survolée. */
  private syncEnergyFocus(): void {
    const keys = [...this.energyFocusActive];
    if (this.energyFocusPreview && !keys.includes(this.energyFocusPreview)) keys.push(this.energyFocusPreview);
    this.mapContainer?.setEnergyFocus(keys);
    let panel = document.getElementById('energy-focus-key');
    const switcher = this.floatingPanelSwitcherEl;
    if (keys.length === 0 || !switcher || switcher.hidden) {
      panel?.remove();
      return;
    }
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'energy-focus-key';
      document.body.appendChild(panel);
    }
    panel.innerHTML = energyFocusKeysHtml(keys);
    const r = switcher.getBoundingClientRect();
    panel.style.left = `${Math.round(r.left)}px`;
    panel.style.top = `${Math.round(r.bottom + 6)}px`;
  }

  /** Referme le panneau flottant `id` sans éteindre sa couche (clic sur son bouton surligné). */
  private hideFloatingPanel(id: keyof MapLayers): void {
    this.getFloatingPanelInstance(id)?.hide({ silent: true });
    if (this.currentFloatingPanelId === id) this.currentFloatingPanelId = null;
    // En bref refermé à la main : il ne revient plus d'office dans cet onglet ; un autre panneau refermé : retour à l'En bref.
    if (id === 'brief' || id === 'envBrief') this.briefDismissed = true;
    this.refreshFloatingPanelSwitcher();
    if (id !== 'brief' && id !== 'envBrief') this.showDefaultBrief();
  }

  /** En bref refermé à la main dans l'onglet affiché (remis à zéro à chaque changement d'onglet). */
  private briefDismissed = false;

  /**
   * Colonne de droite par défaut des onglets thématiques (20/10/2026) : l'En bref de l'onglet, quand aucun autre panneau ni aucune
   * fiche n'y est affiché. La Vue générale garde « État de la France ». Vérifié à l'image suivante (une sélection en cours de
   * l'ouverture d'une fiche est alors posée).
   */
  private showDefaultBrief(): void {
    if (!this.uiV2 || this.v2Theme === 'general' || !moduleInColumn(this.uiV2, window.innerWidth)) return;
    requestAnimationFrame(() => {
      const id: keyof MapLayers = this.v2Theme === 'environment' ? 'envBrief' : 'brief';
      if (this.v2Theme === 'general' || this.briefDismissed || !this.activeLayers[id]) return;
      if (this.poste?.selectedKey() != null) return;
      const open = this.currentFloatingPanelId;
      if (open && this.isFloatingPanelVisible(open)) return;
      if (!this.getFloatingPanelInstance(id)) {
        void Promise.all(this.ensureLazyPanelForLayer(id)).then(() => this.showDefaultBrief());
        return;
      }
      this.showFloatingPanel(id);
    });
  }

  /**
   * Mise en page de la barre : une seule rangée ; si elle déborde, les boutons non surlignés passent
   * en icône seule (libellé en infobulle). Puis les panneaux de droite (v1) démarrent sous la barre.
   */
  private layoutFloatingPanelSwitcher(): void {
    const el = this.floatingPanelSwitcherEl;
    if (!el) return;
    if (!this.uiV2) {
      el.classList.remove('is-compact');
      // Rangée alignée à droite : elle déborde vers la GAUCHE, ce que scrollWidth ne voit pas ; on
      // compare donc le bord gauche du premier bouton à celui de la barre.
      const first = el.firstElementChild;
      if (!el.hidden && first && first.getBoundingClientRect().left < el.getBoundingClientRect().left - 1) {
        el.classList.add('is-compact');
      }
    }
    // Décalage des panneaux de droite sous la barre : v1 d'après sa hauteur, v2 tablette d'après son bas (une seule pose).
    let offset = switcherPanelOffsetPx(el.hidden ? 0 : el.offsetHeight, this.uiV2);
    if (this.uiV2) {
      // Zone carte masquée (mobile, autre onglet) : rien à mesurer ; l'observateur de taille relance la mise en page à son retour.
      const mapWidth = el.parentElement?.clientWidth ?? 0;
      if (mapWidth > 0 && !el.hidden) {
        // Le libellé reste visible au-dessus de 768 px ; le repli en icônes ne vient que d'un manque de place
        // réel (v2SwitcherLayout). La largeur d'une rangée se mesure donc sans repli ni plafond.
        el.classList.remove('is-icon-only');
        el.classList.add('is-measuring');
        const chips = Array.from(el.children) as HTMLElement[];
        const oneRow = chips.reduce((w, chip) => w + chip.offsetWidth, 0) + 8 * Math.max(0, chips.length - 1);
        el.classList.remove('is-measuring');
        const drawerOpen = !this.container.classList.contains('sidebar-collapsed');
        const layout = v2SwitcherLayout(window.innerWidth, mapWidth, drawerOpen, oneRow);
        el.classList.toggle('is-icon-only', layout.iconOnly);
        el.classList.toggle('is-below-controls', layout.belowControls);
        // Tablette : les panneaux de module flottent par-dessus la carte ; ils commencent sous les puces.
        offset = v2TabletPanelOffsetPx(el.getBoundingClientRect().bottom, window.innerWidth, false);
      }
    }
    document.documentElement.style.setProperty('--map-switcher-offset', `${offset}px`);
    this.syncV2ColumnVars();
  }

  /** v2 : pose la géométrie de la colonne État (`.fm-v2-fiche`) en variables CSS ; les panneaux de module s'y placent. */
  private syncV2ColumnVars(): void {
    if (!this.uiV2) return;
    const fiche = this.v2Roots?.fiche;
    if (!fiche) return;
    const rect = fiche.getBoundingClientRect();
    if (rect.width <= 0) return;
    const root = document.documentElement.style;
    for (const [name, value] of Object.entries(v2ColumnVars(rect))) root.setProperty(name, value);
  }

  /** v2 : ferme le panneau de module ouvert (l'État ou la fiche réapparaît) ; true s'il y en avait un. */
  private closeV2ModulePanel(): boolean {
    if (!FLOATING_PANEL_DEFS.some((def) => this.isFloatingPanelVisible(def.id))) return false;
    this.currentFloatingPanelId = null;
    this.hideAllFloatingPanels();
    this.refreshFloatingPanelSwitcher();
    return true;
  }

  private floatingPanelIsEligible(id: keyof MapLayers): boolean {
    const def = FLOATING_PANEL_DEFS.find((d) => d.id === id);
    if (!def) return false;
    if (!def.layerKeys.some((k) => this.activeLayers[k])) return false;
    return this.getFloatingPanelInstance(id) != null;
  }

  /**
   * « Vues » de LayerPanel (audit UI 2026-09 §5.3 point 2) : applique en un
   * clic l'état de couches enfant d'un preset nommé (layer-presets.ts), en
   * réutilisant onLayerToggle() couche par couche pour que chargement de
   * données, polling et persistance restent identiques à un bascule manuel.
   * `suppressPanel` fait tenir la promesse de la tâche 1 : une vue change la
   * carte, jamais les panneaux ouverts (seul un clic explicite le fait, via
   * showFloatingPanel()) ; elle éteint aussi le polling des couches
   * désactivées exactement comme un bascule manuel (onLayerToggle() gère
   * déjà trafficAir/trafficRoad/trafficMaritime start/stop).
   */
  private applyLayerPreset(id: LayerPresetId): void {
    // Une vue choisie reprend la main sur toutes les couches : plus aucune n'est « allumée par la Vue générale ».
    this.generalAuto.clear();
    this.syncOutagesRoom();
    const target = themeLayers(this.uiV2, id);
    // v2 : la vue décide aussi de « Événements en cours » (décision du 12/10/2026).
    const keys: ReadonlyArray<keyof MapLayers> = this.uiV2 ? [...ALL_PRESETABLE_LAYER_KEYS, 'events', 'brief'] : ALL_PRESETABLE_LAYER_KEYS;
    for (const key of keys) {
      const wanted = target[key] ?? false;
      if (this.activeLayers[key] === wanted) continue;
      this.onLayerToggle(key, wanted, { suppressPanel: true });
    }
    this.currentFloatingPanelId = null;
    this.hideAllFloatingPanels();
    // Le LayerPanel tient son propre état des cases : le resynchroniser, sinon il diverge de App.
    this.layerPanel?.updateLayers(this.activeLayers);
    this.refreshFloatingPanelSwitcher();
    if (id === 'general') this.refreshGeneralWatch();
    this.syncGeneralWatchPolling();
    this.refreshEnvironmentKey();
    this.refreshTransportVigilance();
    // Onglet thématique : l'En bref occupe la colonne de droite par défaut (décision de l'utilisateur, 20/10/2026).
    this.briefDismissed = false;
    this.showDefaultBrief();
  }

  /**
   * Vue générale dynamique (12/10/2026) : niveau de chaque couche suivie (celui de la pastille de son panneau), journal des passages
   * de niveau, puis, en Vue générale, couches en jaune ou plus allumées et couches revenues au vert éteintes (seulement celles que la
   * vue a allumées elle-même ; une couche touchée à la main n'est plus gérée). Appelée à chaque rafraîchissement du poste.
   */
  /**
   * Sources relevées pour la seule Vue générale dynamique (lot C, 12/10/2026) : coupures d'électricité, Internet et cloud (10, 10 et
   * 30 min), sécheresse (1 h) ; environ 15 lectures de plus par heure, servies par le cache serveur, et seulement Vue générale affichée.
   */
  private generalWatchPolls(key: keyof MapLayers): boolean {
    return this.uiV2 && this.v2Theme === 'general' && GENERAL_WATCH_POLLED.includes(key);
  }

  /** Relèves de la Vue générale alignées sur la vue affichée, et première lecture des sources jamais lues (une fois). */
  private syncGeneralWatchPolling(): void {
    for (const key of ['outagesElec', 'outagesInternet', 'outagesCloud'] as const) {
      this.syncOutagesPolling(key);
      const slot = key === 'outagesElec' ? this.currentOutPower?.power : key === 'outagesInternet' ? this.currentOutInternet?.internet : this.currentOutCloud?.cloud;
      if (this.generalWatchPolls(key) && slot === undefined) this.loadOutagesSource(key).catch((err) => console.error(`[App] Lecture ${key} en échec`, err));
    }
    this.syncEnvironmentPolling('drought');
    if (this.generalWatchPolls('drought') && this.currentDrought === null) void this.loadDrought();
    for (const key of TRAFFIC_LAYER_KEYS) {
      this.syncTrafficPolling(key);
      if (this.generalWatchPolls(key) && !this.trafficLoaded(key)) this.loadTrafficSource(key).catch((err) => console.error(`[App] Lecture ${key} en échec`, err));
    }
  }

  /** Source Trafics déjà lue au moins une fois (donnée ou erreur). */
  private trafficLoaded(key: TrafficLayerKey): boolean {
    switch (key) {
      case 'trafficRoad': return this.currentRoadTraffic !== null;
      case 'trafficAir': return this.currentAirOverview !== null;
      case 'trafficRail': return this.currentRailTraffic !== null;
      case 'trafficMaritime': return this.currentMaritimeSnapshot !== null;
    }
  }

  private refreshGeneralWatch(): void {
    if (!this.uiV2) return;
    const watch = this.watchModule;
    if (!watch) {
      this.watchModulePromise ??= import('./components/layer-panel/watch.ts').then((m) => {
        this.watchModule = m;
        this.refreshGeneralWatch();
      });
      return;
    }
    const { GENERAL_SOCLE, generalWatch, watchLevels, watchTransitions } = watch;
    if (this.v2IntelStarted && !this.generalWatchPollingStarted) {
      this.generalWatchPollingStarted = true;
      this.syncGeneralWatchPolling();
    }
    const now = Date.now();
    const healthNational = this.healthNationalNow(now);
    const slot = <T>(s: { data: T | null; error: string | null; fetchedAt: number | null } | undefined): Watched<T> =>
      ({ data: s?.data ?? null, loaded: s !== undefined && (s.fetchedAt !== null || s.error !== null) });
    const levels = watchLevels({
      vigilance: slot(this.currentVigilance?.vigilance),
      floods: slot(this.currentFloods?.floods),
      fires: slot(this.currentFires?.fires),
      earthquakes: slot(this.currentEarthquakes?.quakes),
      airQuality: slot(this.currentAirQuality?.air),
      telecom: slot(this.currentOutTelecom?.telecom),
      // Sans emplacement de source : pas de donnée = pas encore lu (une panne est dite dans la donnée, ex. rteAvailable, degraded).
      ecowatt: { data: this.currentEcowattResponse, loaded: this.currentEcowattResponse !== null },
      nuclear: { data: this.currentNuclearState, loaded: this.currentNuclearState !== null },
      cyber: slot(this.currentSovCyber?.cyber),
      military: slot(this.currentMilitary?.military),
      fuel: { data: this.currentFuelTensionData, loaded: this.currentFuelTensionData !== null },
      power: slot(this.currentOutPower?.power),
      internet: slot(this.currentOutInternet?.internet),
      cloud: slot(this.currentOutCloud?.cloud),
      drought: slot(this.currentDrought?.drought),
      disasters: {
        data: { gdacs: this.currentDisasters?.disasters.data ?? null, ems: this.currentDisasters?.ems.data ?? null },
        loaded: [this.currentDisasters?.disasters, this.currentDisasters?.ems].some((x) => x !== undefined && (x.fetchedAt !== null || x.error !== null)),
      },
      health: { data: healthNational, loaded: healthNational !== null },
      traffic: {
        road: slot(this.currentRoadTraffic?.national),
        air: slot(this.currentAirOverview?.overview),
        rail: slot(this.currentRailTraffic?.overview),
        maritime: slot(this.currentMaritimeSnapshot?.snapshot),
      },
      gnss: this.gnssState?.gnss.data ?? null,
      now,
    });
    // Journal : passages entre niveaux connus (un « n.d. » n'écrit rien) ; 50 derniers gardés pour la session.
    // Pollens : niveau de la pastille (Atmo, jour J) dès la première lecture.
    if (this.currentPollen) levels.set('pollens', pollensHeadLevel(this.currentPollen.pollen.data, now));
    // Sites Seveso : niveau de leur exposition (pastille allumée, recensement lu).
    if (this.activeLayers.seveso && this.sevesoData) levels.set('seveso', sevesoHeadLevel(this.sevesoData, this.sevesoExposed));
    this.watchLevelMap = levels;
    const transitions = watchTransitions(this.watchLastKnown, levels, now);
    for (const [key, level] of levels) if (level !== 'nd') this.watchLastKnown.set(key, level);
    if (transitions.length > 0) {
      this.watchLog = [...transitions, ...this.watchLog].slice(0, 50);
      this.poste?.setLayerChanges(this.watchLog.map((t) => ({ ...t, label: FLOATING_PANEL_DEFS.find((d) => d.id === t.key)?.label ?? t.key })));
    }
    // Avant les couches critiques, seul le socle : pas de puce « n.d. » pour une source simplement pas encore lue.
    this.watchEntries = this.v2IntelStarted ? generalWatch(levels) : generalWatch(new Map());
    // En bref de l'onglet Environnement : croisement et panneau suivent chaque rafraîchissement du poste (20/10/2026).
    this.refreshSeveso();
    this.refreshEnvBrief();
    this.refreshTransportVigilance();
    this.refreshThemeBrief();
    this.refreshEnvironmentKey();
    if (this.v2Theme !== 'general') {
      // Voyants des pastilles d'un onglet à niveaux (Environnement, Transports) : la barre suit les niveaux.
      if (this.v2Theme === 'transport') this.refreshFloatingPanelSwitcher();
      return;
    }
    const wanted = new Set(this.watchEntries.map((e) => e.key).filter((k) => !GENERAL_SOCLE.includes(k)));
    let changed = false;
    for (const key of wanted) {
      if (this.activeLayers[key]) continue;
      this.onLayerToggle(key, true, { suppressPanel: true });
      this.generalAuto.add(key);
      changed = true;
    }
    for (const key of [...this.generalAuto]) {
      if (wanted.has(key)) continue;
      this.generalAuto.delete(key);
      if (this.activeLayers[key]) this.onLayerToggle(key, false, { suppressPanel: true });
      changed = true;
    }
    if (changed) this.layerPanel?.updateLayers(this.activeLayers);
    this.refreshFloatingPanelSwitcher();
  }

  /**
   * Dossier dédié d'une alerte ou d'une situation (grand feu, vol militaire) ; false s'il n'y en a
   * pas. Partagé par AlertMonitor (v1) et la fiche d'alerte ou de situation (v2).
   */
  private openAlertDossier(situation: DetectedSituation): boolean {
    if (situation.type === 'WILDFIRE_ESCALATION') {
      const incidentId = situation.id.replace(/^wildfire-/, '');
      if (!this.currentFireIncidents.some((i) => i.id === incidentId)) return false;
      // Onglet « Dossier d'un feu » du panneau Feux (spec 2026-10-04 environnement § 2.4), à la place de l'ancienne fenêtre. Le panneau
      // reçoit d'abord l'état courant : créé couche Feux éteinte, il n'en a aucun et l'incident y serait introuvable. Rien n'est masqué
      // si le dossier ne s'ouvre pas.
      const openDossier = (): boolean => {
        this.firesPanel?.update(this.firesPanelState());
        if (!this.firesPanel?.openDossier(incidentId)) return false;
        this.hideAllFloatingPanels('fires');
        this.currentFloatingPanelId = 'fires';
        this.refreshFloatingPanelSwitcher();
        return true;
      };
      if (this.firesPanel) return openDossier();
      // Panneau pas encore chargé : l'incident est connu et le panneau reçoit son état avant l'ouverture, le dossier s'ouvrira donc
      // dès l'arrivée du morceau (sans conteneur flottant, aucun panneau ne peut naître).
      if (!this.floatContainerEl) return false;
      void this.ensureFiresPanel().then(() => { openDossier(); });
      return true;
    }

    if (situation.type === 'GPS_JAMMING_ALERT') {
      // Précision GNSS dégradée (phase B, O17) : un compte sans lieu, rien à recentrer ; le panneau Défense dit les mailles du jour UTC
      // précédent, la météo spatiale et la méthode.
      if (!this.floatContainerEl) return false;
      this.showSovereigntyPanel('military');
      return true;
    }

    if (situation.type === 'MILITARY_SURGE_ALERT') {
      // Urgence militaire (souveraineté § 2.4) : sa position à la dernière lecture ; le panneau Défense dit le reste.
      const { lon, lat } = situation;
      if (lon == null || lat == null) return false;
      if (!this.activeLayers.military) {
        this.onLayerToggle('military', true, layerActivationOptions(this.uiV2));
      }
      this.mapContainer?.flyTo(lon, lat, 10);
      return true;
    }

    return false;
  }

  /**
   * « Voir sur la carte » d'une situation : active ses couches (SituationMonitor v1, fiche v2). En
   * v2, sans ouvrir leur panneau flottant sur la colonne fiche (relecture finale I1).
   */
  private activateLayersFromSituation(layerKeys: readonly string[]): void {
    for (const key of layerKeys) {
      if (key in this.activeLayers && !this.activeLayers[key as keyof typeof this.activeLayers]) {
        this.onLayerToggle(key as keyof typeof this.activeLayers, true, layerActivationOptions(this.uiV2));
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

    this.mapContainer.setOnItemClick((item, point) => {
      this.mapPopup?.hide();
      this.mapContainer?.selectItem(item);
      this.newsPanel?.selectItem(item.id);
      this.routeGovernmentContextForItem(item);
      // Clic sur un point de la carte : aperçu avec lien vers l'article complet (spec 2026-10-14), sans zoom.
      if (point) {
        this.openArticlePreview(item, point.x, point.y);
        return;
      }
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

    });


    // Raw map click → élus panel (clic direct sur la carte, hors articles/clusters)
    this.mapContainer.setOnRawMapClick((_lat, _lon) => {
    });

    this.mapContainer.setOnSatelliteView((request) => {
      this.mapContainer?.setSentinelSceneOverlay(null);
      this.mapContainer?.fitBounds(request.bbox, 80);
      void this.ensureSentinelModal().then((modal) => modal.show(request));
    });

    // Handle military base clicks → show detailed popup
    this.mapContainer.setOnMilitaryBaseClick((base, x, y) => {
      if (this.mapPopup) {
        this.mapPopup.showMilitaryBase(base, x, y);
      }
    });

    // Clic sur la carte, couche Radar active : profil vertical du point (démonstration, panneau Radar météo).
    this.mapContainer.setOnRadarPointPick((lat, lon) => this.loadRadarProfile(lat, lon));
    // Clic sur un point Manifestations : panneau ouvert sur les lignes de cette commune.
    this.mapContainer.setOnProtestClick((key) => this.onProtestMapClick(key));
    // Clic sur un rond de ville Criminalité : panneau ouvert sur la ligne de cette ville.
    this.mapContainer.setOnCrimeCityClick((code) => this.onCrimeMapClick(code));
    // Clic sur une webcam : panneau ouvert sur sa fiche.
    this.mapContainer.setOnWebcamClick((id) => this.onWebcamMapClick(id));
    // Clic sur un objet Souveraineté (contrats § 4.4 point 19) : fiche d'un bâtiment, ou panneau de sa couche.
    this.mapContainer.setOnSovereigntyFeatureClick((layerId, props) => this.onSovereigntyMapClick(layerId, props));
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
    // Pannes réseau : les sources de la carte n'existaient pas quand le premier relevé (Télécoms, au démarrage) a répondu ; repeinture (R35).
    for (const key of OUTAGES_LAYER_KEYS) this.repaintOutagesMap(key);
    this.mountOutagesNow(mapEl);
    // v2 (?ui=v2) : alertes, convergences et situations passent dans la liste « À traiter » et
    // leurs fiches ; les trois panneaux flottants ne sont créés que pour l'interface par défaut.
    if (!this.uiV2) {
      // Interface v1 seulement : chargés à part (chunk App < 1 Mio, 21/10/2026).
      const [{ AlertMonitor }, { SituationMonitor }, { SituationBrief }] = await Promise.all([
        import('./components/AlertMonitor.ts'), import('./components/SituationMonitor.ts'), import('./components/SituationBrief.ts'),
      ]);
      this.alertMonitor?.destroy();
      this.alertMonitor = new AlertMonitor(mapEl);
      this.alertMonitor.setDossierHandler((situation) => this.openAlertDossier(situation));
      this.situationMonitor?.destroy();
      this.situationMonitor = new SituationMonitor(mapEl);
      this.situationMonitor.setOnLayerActivate((layerKeys) => this.activateLayersFromSituation(layerKeys));
      this.situationMonitor.setOnFlyTo((lon, lat, zoom) => {
        this.mapContainer?.flyTo(lon, lat, zoom ?? 10);
      });
      // Modèle "synthèse → détail" : le monitor ne s'affiche plus spontanément,
      // il s'ouvre via le bouton "Détails" du bandeau de synthèse.
      this.situationMonitor.enableManualMode();

      // Synthèse d'ouverture — même flux que SituationMonitor, aucun re-fetch du moteur.
      this.situationBrief?.destroy();
      this.situationBrief = new SituationBrief(mapEl);
      this.situationBrief.setOnFlyTo((lon, lat, zoom) => {
        this.mapContainer?.flyTo(lon, lat, zoom ?? 8);
      });
      this.situationBrief.setOnOpenDetails(() => {
        this.situationMonitor?.toggleOpen();
      });
      // Historique 24 h (situations résolues) : fetch léger unique, tolérant aux erreurs.
      void getHistory(7)
        .then((result) => {
          this.situationBrief?.setRecent24h(
            resolvedSituationsFromHistory(result.data.slots, Date.now()),
          );
        })
        .catch(() => {
          // Le bandeau vit sans historique : il affichera les seules situations actives.
        });
    }

    void import('./components/SituationHistoryPanel.ts').then(({ SituationHistoryPanel }) => {
      this.situationHistoryPanel?.destroy();
      const panel = new SituationHistoryPanel(mapEl);
      const historyWrap = document.querySelector<HTMLElement>('.sit-hist-wrap');
      if (historyWrap) {
        panel.mount(historyWrap);
      }
      this.situationHistoryPanel = panel;
    });
    this.mapPopup = new MapPopup(mapEl);

    // Initialize map legend
    this.mapLegend = new MapLegend(mapEl);
    this.mapLegend.init();
    // Créé avec la légende : un élément ajouté avant l'initialisation de la carte est effacé avec son conteneur.
    this.mapPreview = new MapPreviewCard(mapEl);
    this.mapLegend.setOnKeyAction((action) => {
      if (action.startsWith('energy:')) {
        const state = action.slice('energy:'.length);
        if (!isEnergyStateName(state)) return;
        if (this.energyHiddenStates.has(state)) this.energyHiddenStates.delete(state);
        else this.energyHiddenStates.add(state);
        this.mapContainer?.setHiddenEnergyStates(this.energyHiddenStates);
        return;
      }
      const level = action.startsWith('level:') ? action.slice('level:'.length) : '';
      if (level !== 'rouge' && level !== 'orange' && level !== 'jaune' && level !== 'vert') return;
      if (this.v2HiddenLevels.has(level)) this.v2HiddenLevels.delete(level);
      else this.v2HiddenLevels.add(level);
      this.refreshEventPoints();
    });
    // Bloc Énergie de « Lire la carte » (spec 2026-10-15) : réémis à chaque donnée et bascule de couche.
    this.mapContainer?.setOnEnergyKeyChange((model) => {
      this.mapLegend?.setEnergyKey(buildEnergyKeyHtml(model));
    });

    // Wire map hover interactions
    this.mapLegend.setOnHover((categoryId) => {
      this.mapContainer?.setLegendHover(categoryId);
    });

    this.mapLegend.addCategory(ROAD_TRAFFIC_LEGEND);
    this.mapLegend.addCategory(MARITIME_TRAFFIC_LEGEND);
    this.mapLegend.addCategory(AIR_TRAFFIC_LEGEND);
    this.mapLegend.addCategory(RAIL_TRAFFIC_LEGEND);
    this.mapLegend.addCategory(HEALTH_ALERTS_LEGEND);
    this.mapLegend.addCategory(HEALTH_APL_LEGEND);
    this.mapLegend.addCategory(HEALTH_URGENCES_LEGEND);
    this.mapLegend.addCategory(HOSPITALS_LEGEND);

    this.mapLegend.addCategory(VIGILANCE_LEGEND);
    this.mapLegend.addCategory(FLOODS_LEGEND);
    this.mapLegend.addCategory(RADAR_LEGEND);
    this.mapLegend.addCategory(FIRES_LEGEND);
    this.mapLegend.addCategory(DROUGHT_LEGEND);
    this.mapLegend.addCategory(AIR_QUALITY_LEGEND);
    this.mapLegend.addCategory(EARTHQUAKES_LEGEND);
    this.mapLegend.addCategory(DISASTERS_LEGEND);
    this.mapLegend.addCategory(DEFENSE_LEGEND);
    this.mapLegend.addCategory(CONNECTIVITY_LEGEND);
    this.mapLegend.addCategory(CYBER_LEGEND);
    this.mapLegend.addCategory(OUTAGES_TELECOM_LEGEND);
    this.mapLegend.addCategory(OUTAGES_INTERNET_LEGEND);
    this.mapLegend.addCategory(OUTAGES_CLOUD_LEGEND);

    this.refreshLegendVisibility();
    this.refreshTrafficLegend();
    this.refreshEnvironmentLegend();
    this.refreshSovereigntyLegend();

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
    this._intervalRSS = setInterval(() => {
      if (document.hidden) return; // skip tick while tab is hidden
      this.fetchAndProcessRSS().catch(err => console.error('[App] RSS poll error', err));
    }, RSS_POLL_INTERVAL_MS);
  }

  /**
   * Relève AIS de 5 s (Trafic maritime et Marine nationale, spec souveraineté § 2.1) : ligne « AIS maritime » datée par le dernier message,
   * carte de la Marine nationale (vue en AIS, ou port base de référence), panneaux maritime et Défense, anomalies AIS. Les aéronefs
   * militaires ont leur relève (syncSovereigntyPolling('military')) ; la veille des câbles est faite par le serveur.
   */
  private startShipsPolling(): void {
    // Audit de performance § 6 point 4 : le WebSocket du relais AIS n'est ouvert au démarrage que si une couche en a besoin ;
    // onLayerToggle() l'ouvre ensuite à la demande (connectAis() est idempotent).
    if (this.activeLayers.trafficMaritime || this.activeLayers.military) {
      connectAis();
    }

    const AIS_UI_REFRESH_MS = 5_000;
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

    const updateShips = async () => {
      try {
        const aisStatus = getAisStatus();
        const aisRelayLabel = AIS_RELAY_URL ?? 'Non configuré';
        const aisDetail = `${aisRelayLabel} · ${aisStatus.shipCount} navire${aisStatus.shipCount > 1 ? 's' : ''} · ${aisStatus.messageCount} msg`;
        // Date du dernier message reçu du relais (S1), jamais l'heure de lecture ; message trop ancien : en retard même connecté (S2).
        const aisState = getAisConnectionState();
        this.statusPanel?.updateSource('AIS maritime', {
          ...aisLiveStatus({ connected: aisStatus.connected, shipCount: aisStatus.shipCount, lastMessageAt: aisState.lastMessageAt }, Date.now()),
          detail: aisStatus.connected ? aisDetail : aisRelayLabel,
        });

        // Marine nationale (souveraineté § 2.1) : vue en AIS, ou port base de référence ; liaison figée : bâtiments vus en gris.
        // O10 et O11 : plus rien n'est poussé vers l'ancienne couche des navires (retirée à A17).
        const militaryShips = getMilitaryShips();
        const navyNow = Date.now();
        const navyFrozen = navyLiveState({ status: aisState.status, lastMessageAt: aisState.lastMessageAt }, false, navyNow).frozen;
        this.mapContainer?.updateNavyLayer(militaryShips, navyFrozen, navyNow);
        this.defensePanel?.refreshLive();

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
        this.maritimePanel?.refreshLive();

        // Détection anomalies AIS (radio silence, rendezvous suspects)
        const aisAnomalies = detectAisAnomalies(allTraffic);
        const AIS_ANOMALY_TTL_MS = 30 * 60 * 1000;
        const cutoff = Date.now() - AIS_ANOMALY_TTL_MS;
        this.currentAisAnomalies = [
          ...this.currentAisAnomalies.filter((anomaly) => anomaly.timestamp >= cutoff),
          ...aisAnomalies,
        ];
        this.refreshFranceIntelPanel();
        // Veille des câbles : faite par le serveur sur l'AIS du relais (/api/sovereignty/cables-watch, relève de la Connectivité).
      } catch (err) {
        console.error('[Military Ships] Failed to update', err);
        this.statusPanel?.updateSource('AIS maritime', {
          status: 'error',
          lastUpdate: null,
          detail: AIS_RELAY_URL ?? 'Non configuré',
          error: err instanceof Error ? err.message : 'Échec mise à jour AIS',
        });
      }
    };

    // Register callback for first AIS data arrival (triggers immediate refresh)
    onFirstAisData(() => {
      // Première trame AIS : carte et panneau maritime (onglets Marine nationale et Alertes) aussitôt à jour.
      updateShips();
    });

    updateShips();
    this._intervalShips = this.registerPausableInterval(
      () => { updateShips().catch(err => console.error('[App] Ships poll error', err)); },
      AIS_UI_REFRESH_MS,
    );
  }

  private startFinancePolling(): void {
    const fetchFinance = async () => {
      try {
        const data = await fetchMarketData();
        this.currentMarketData = data;
        this.renderFinancialStrip();
        this.repaintPoste(); // v2 : mouvements exceptionnels des indices dans la liste (m4)
        void this.loadFinancialStability().catch((err) => console.error('[Finance] Stabilité financière indisponible', err));
      } catch (err) {
        console.error('[Finance] Polling failed', err);
      }
    };
    fetchFinance();
    this._intervalFinance = setInterval(() => {
      if (document.hidden) return; // skip tick while tab is hidden
      fetchFinance().catch(err => console.error('[App] Finance poll error', err));
    }, POLL_FINANCE_MS);
    this._intervalNuclear = setInterval(() => {
      if (document.hidden) return; // skip tick while tab is hidden
      void this.loadNuclear();
      void this.loadAsnr();
    }, POLL_NUCLEAR_MS);
  }

  /** Bloc « Stabilité financière » (spec 2026-10-12) : séries BCE et écart OAT-Bund ; deux lignes au panneau des sources. */
  private async loadFinancialStability(): Promise<void> {
    const incoming = await fetchFinancialStability(this.currentFinancialStability);
    this.currentFinancialStability = mergeFinancialStability(this.currentFinancialStability, incoming);
    this.statusPanel?.updateSource(BCE_SOURCE_NAME, bceStatus(this.currentFinancialStability));
    this.statusPanel?.updateSource(SPREAD_SOURCE_NAME, spreadStatus(this.currentFinancialStability));
    this.renderFinancialStrip();
  }

  /** Rendu du bloc : le CAC 40 en repère vient du relevé TradingView déjà fait pour le score. */
  private renderFinancialStrip(): void {
    const slot = this.currentFinancialStability;
    this.financialStrip?.update({
      data: slot?.data ?? null,
      error: slot?.error ?? null,
      cac: this.currentMarketData.find((m) => m.symbol === 'CAC.INDX') ?? null,
    });
  }

  private startOilPolling(): void {
    if (this._intervalOil !== null) clearInterval(this._intervalOil);

    this._intervalOil = setInterval(() => {
      if (document.hidden) return; // skip tick while tab is hidden
      // Vue générale dynamique : la tension carburants y est suivie, couche éteinte comprise (12/10/2026).
      if (!this.activeLayers.oilNetwork && !(this.uiV2 && this.v2Theme === 'general')) return;
      void this.loadOil();
    }, POLL_OIL_MS);
  }

  private startCommodityPolling(): void {
    const fetchCommodities = async () => {
      try {
        const data = await fetchCommodityData();
        this.currentCommodityData = data;
        this.commodityStrip?.update(data);
        this.repaintPoste(); // v2 : mouvements exceptionnels du pétrole et du gaz dans la liste (m4)
      } catch (err) {
        console.error('[Commodities] Polling failed', err);
      }
    };
    fetchCommodities();
    this._intervalCommodities = setInterval(() => {
      if (document.hidden) return; // skip tick while tab is hidden
      fetchCommodities().catch(err => console.error('[App] Commodities poll error', err));
    }, POLL_COMMODITIES_MS);
  }

  private _airTrafficPollInFlight = false;

  private async pollAirTraffic(): Promise<void> {
    if (this._airTrafficPollInFlight) return;
    this._airTrafficPollInFlight = true;
    try {
      await this.loadAirTraffic();
    } catch (err) {
      console.error('[AirTraffic] Polling failed', err);
    } finally {
      this._airTrafficPollInFlight = false;
    }
  }

  /**
   * Perf audit §6 item 4: air traffic (10 s response, polled every
   * POLL_AIR_TRAFFIC_MS) used to fetch unconditionally regardless of the
   * trafficAir layer. Now a no-op at boot when the layer is off, and
   * started/stopped from onLayerToggle() instead.
   */
  private startAirTrafficPolling(): void {
    if (!this.activeLayers.trafficAir) return;
    if (this._intervalAirTraffic !== null) return; // already running
    void this.pollAirTraffic();
    this._intervalAirTraffic = this.registerPausableInterval(() => {
      this.pollAirTraffic().catch(err => console.error('[App] AirTraffic poll error', err));
    }, POLL_AIR_TRAFFIC_MS);
  }

  private stopAirTrafficPolling(): void {
    this.removePausableInterval(this._intervalAirTraffic);
    this._intervalAirTraffic = null;
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
    this.newsItems = [...items]
      .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
      .slice(0, MAX_NEWS_ITEMS);
    this.mapContainer?.updateNews(this.newsItems);
    this.newsPanel?.updateItems(this.newsItems);
    this.searchModal?.updateNewsItems(this.newsItems);
    this.refreshFranceIntelPanel();
  }

  // ─── Background AI & Geocoding ─────────────────────────────────────────────

  private async augmentItemsInBackground(items: NewsItem[], requestId: number): Promise<void> {
    // Run AI classification and geocoding in PARALLEL — geocoding must NOT wait for AI model to load
    // Résumés à part : ils attendent la fin du démarrage, le classement et les lieux n'ont pas à les attendre.
    const summarized = this.runSummarization(items, requestId);
    await Promise.all([
      this.runAIClassification(items, requestId),
      this.runGeocoding(items, requestId),
    ]);
    if (!this.applyAugmentedAndCache(items, requestId)) return;
    console.log(`[RSS] Pipeline stage 2 (background) complete: AI & Geocoding.`);

    await summarized;
    if (this.applyAugmentedAndCache(items, requestId)) console.log('[RSS] Summarization complete.');
  }

  private applyAugmentedAndCache(items: NewsItem[], requestId: number): boolean {
    if (requestId !== this.rssRequestSeq) {
      console.log('[RSS] Background augmentation dropped for stale request', requestId);
      return false;
    }
    this.applyNewsItems(items);
    saveNewsToCache(this.newsItems);
    return true;
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
      for (let i = 0; i < itemsToAI.length; i += AI_CLASSIFY_BATCH_SIZE) {
        // Abort if a newer RSS request superseded this one
        if (requestId !== this.rssRequestSeq) return;
        const batch = itemsToAI.slice(i, i + AI_CLASSIFY_BATCH_SIZE);
        await Promise.all(
          batch.map(async (item) => {
            const aiFallback = await classifyWithAI(item.title, item.summary);
            if (aiFallback) {
              item.threat = aiFallback;
              updated = true;
            }
          }),
        );
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
            // Session-level dedup: identical title+region pairs are geocoded once
            const cacheKey = `${item.title}|${item.feedRegion ?? ''}`;
            let geo: Awaited<ReturnType<typeof geocodeNewsItem>>;
            if (geocodeSessionCache.has(cacheKey)) {
              geo = geocodeSessionCache.get(cacheKey) ?? null;
            } else {
              geo = await geocodeNewsItem(item.title, item.feedRegion);
              geocodeSessionCache.set(cacheKey, geo);
            }
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
          await new Promise((r) => setTimeout(r, GEOCODE_BATCH_DELAY_MS));
        }
      }
    } catch (err) {
      console.error('[RSS] Geocoding failed:', err);
    }
  }

  /** Summarize items that have no aiSummary yet */
  private async runSummarization(items: NewsItem[], requestId: number): Promise<void> {
    if (this.isSummarizationRunning) {
      console.log('[RSS] Summarization skipped: previous cycle still running');
      return;
    }

    this.isSummarizationRunning = true;
    try {
      const startupWait = SUMMARIZE_STARTUP_DELAY_MS - performance.now();
      if (startupWait > 0) await new Promise((r) => setTimeout(r, startupWait));
      const toSummarize = items
        .filter((it) => !it.aiSummary && it.summary && it.aiSummaryStatus !== 'pending' && it.aiSummaryStatus !== 'failed' && it.aiSummaryStatus !== 'done')
        .slice(0, MAX_SUMMARIZE_ITEMS_PER_CYCLE);
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
          await new Promise((r) => setTimeout(r, SUMMARIZE_BATCH_DELAY_MS));
        }
      }
    } catch (err) {
      console.error('[RSS] Summarization failed:', err);
    } finally {
      this.isSummarizationRunning = false;
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

    this.energyPanel?.updateBorderHistory(borderHistory);
    if (Object.keys(ecowatt.mixes).length > 0 || ecowatt.official !== null) {
      this.currentEcowattResponse = ecowatt;
      await this.mapContainer?.updateEnergy(ecowatt);
      this.mapContainer?.updateEnergyTooltipData(energyRegions.regions, energyRegions.flows, borderHistory);
      // Signal officiel du jour (API RTE) → à jour ; repli open data (J-1) ou signal absent → figé.
      const officialLive = ecowattToday(ecowatt.official, Date.now()) !== null;
      this.statusPanel?.updateSource('Écowatt RTE', { status: officialLive ? 'ok' : 'stale', lastUpdate: new Date() });
    } else {
      this.currentEcowattResponse = {
        official: null,
        mixes: {},
        national: { timestamp: new Date(), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 },
        interconnections: [], grid: null,
      };
      await this.mapContainer?.updateEnergy(this.currentEcowattResponse);
      this.mapContainer?.updateEnergyTooltipData(energyRegions.regions, energyRegions.flows, borderHistory);
      this.statusPanel?.updateSource('Écowatt RTE', { status: 'stale', lastUpdate: new Date() });
    }

    // Rafraîchit seulement un panneau déjà ouvert : ne pas rouvrir un panneau masqué par l'utilisateur.
    if (this.activeLayers.powerGrid && this.energyPanel?.isVisible()) {
      this.energyPanel.show(this.currentEcowattResponse);
      this.layoutEnergyFloatingPanels();
    }
    // La tension réseau est nationale (Écowatt) : le panneau Électricité l'affiche en une ligne.
    if (this.currentOutPower) this.outagesPowerPanel?.update(this.currentOutPower, this.currentEcowattResponse.official ?? null);
    this.eolienPanel?.setGrid(this.currentEcowattResponse.grid);

    await this.refreshHydraulicLayer();
    this.refreshFranceIntelPanel();
  }

  /**
   * Vigilance météo (spec 2026-10-04 environnement § 2.1) : carte à l'échéance affichée, panneau, légende et ligne « Météo-France »
   * datée par la carte (S1) ; score, note de situation, file de travail et stress hydro lisent l'échéance du jour par l'adaptateur.
   */
  private loadVigilance(): Promise<void> {
    return this.readEnvironment('environmental', async () => {
      const incoming = await fetchVigilance(this.currentVigilance);
      this.currentVigilance = mergeVigilance(this.currentVigilance, incoming);
      const now = Date.now();
      const data = this.currentVigilance.vigilance.data;
      this.statusPanel?.updateSource('Météo-France', vigilanceStatus(this.currentVigilance, now));
      this.vigilancePanel?.update({ vigilance: this.currentVigilance });
      this.refreshEnvironmentLegend();
      this.recordEnvironmentSamples(now);
      // Pas de refreshHydraulicLayer ici (audit perf § 5) : la tâche « hydraulic » du démarrage et la relève hydraulique le font.
      this.refreshFranceIntelPanel();
      await this.mapContainer?.updateVigilanceLayer(data, this.vigilanceEcheance, now);
      // Département choisi dans le panneau : gardé en surbrillance sur la carte repeinte.
      this.mapContainer?.selectWeatherDepartment(this.selectedVigilanceDept);
      // Marégraphes : anneau de la couleur du domaine littoral du jour, repeint avec la carte relue.
      if (this.currentSeaLevels) this.mapContainer?.updateSeaLevelsLayer(this.currentSeaLevels.seaLevels.data, data, now);
    });
  }

  /** Crues (spec § 2.2) : tronçons et stations datés ; tronçons en vigilance (FloodSectionRef) pour le score et le stress hydro. */
  private loadFloods(): Promise<void> {
    return this.readEnvironment('floods', async () => {
      const incoming = await fetchFloods(this.currentFloods);
      this.currentFloods = mergeFloods(this.currentFloods, incoming);
      const now = Date.now();
      const data = this.currentFloods.floods.data;
      this.statusPanel?.updateSource('Vigicrues', floodsStatus(this.currentFloods, now));
      this.mapContainer?.updateFloodsLayer(data, now);
      this.floodsPanel?.update(this.currentFloods);
      this.refreshFloodImpact();
      this.refreshEnvironmentLegend();
      this.recordEnvironmentSamples(now);
      await this.refreshHydraulicLayer();
      this.refreshFranceIntelPanel();
    });
  }

  /**
   * Feux de forêt (spec § 2.4, § 2.7) : collecte du serveur ; détections en France non récurrentes pour le score et le regroupement
   * DBSCAN (situations, onglet « Dossier d'un feu ») ; deux lignes datées, « NASA FIRMS » et « Météo des forêts ».
   */
  private loadFires(): Promise<void> {
    return this.readEnvironment('fires', async () => {
      const incoming = await fetchFires(this.currentFires);
      this.currentFires = mergeFires(this.currentFires, incoming);
      const now = Date.now();
      const data = this.currentFires.fires.data;
      const incidents = clusterFireDetections(this.environmentInputs().activeFires, { epsKm: 3, minPoints: 2 });
      this.statusPanel?.updateSource('NASA FIRMS', firesStatus(this.currentFires, 'firms', now));
      this.statusPanel?.updateSource('Météo des forêts', firesStatus(this.currentFires, 'mdf', now));
      this.mapContainer?.updateFiresLayer(data, now, { forestDangerFill: this.forestDangerFill });
      this.firesPanel?.update(this.firesPanelState());
      this.refreshEnvironmentLegend();
      this.recordEnvironmentSamples(now);
      this.refreshFranceIntelPanel();
      // Géo-résolution au mieux (§ 7) : un échec laisse départements et communes vides et l'alerte retombe sur les coordonnées ;
      // l'affichage des détections n'attend jamais le découpage administratif.
      void resolveIncidentGeography(incidents)
        .then((located) => {
          this.currentFireIncidents = located;
          this.firesPanel?.update(this.firesPanelState());
          this.refreshFranceIntelPanel();
        })
        .catch(() => { /* départements et communes restent vides */ });
    });
  }

  /**
   * Sécheresse (spec environnement § 3.1) : arrêtés VigiEau ; même forme que loadFloods : panneau, carte, légendes, ligne « VigiEau »
   * datée par les arrêtés (S1). Un stock (E2) : jamais dans le score ni dans une situation.
   */
  private loadDrought(): Promise<void> {
    return this.readEnvironment('drought', async () => {
      const incoming = await fetchDrought(this.currentDrought);
      this.currentDrought = mergeDrought(this.currentDrought, incoming);
      const now = Date.now();
      const data = this.currentDrought.drought.data;
      this.statusPanel?.updateSource('VigiEau', droughtStatus(this.currentDrought, now));
      void this.mapContainer?.updateDroughtLayer(data, now);
      this.droughtPanel?.update(this.currentDrought);
      this.refreshEnvironmentLegend();
      this.recordEnvironmentSamples(now);
      this.refreshGeneralWatch();
    });
  }

  /** Qualité de l'air (§ 3.2) : épisodes et indice ATMO ; lue au démarrage et relevée sans arrêt (situation « épisode d'alerte », tâche 32). */
  private loadAirQuality(): Promise<void> {
    return this.readEnvironment('airQuality', async () => {
      const incoming = await fetchAirQuality(this.currentAirQuality);
      this.currentAirQuality = mergeAirQuality(this.currentAirQuality, incoming);
      const now = Date.now();
      const data = this.currentAirQuality.air.data;
      this.statusPanel?.updateSource('Atmo France', airQualityStatus(this.currentAirQuality, now));
      void this.mapContainer?.updateAirQualityLayer(data, now);
      this.airQualityPanel?.update(this.currentAirQuality);
      this.refreshEnvironmentLegend();
      this.recordEnvironmentSamples(now);
      this.refreshFranceIntelPanel();
    });
  }

  /** Séismes (§ 3.3) : 7 jours, France et 20 km autour ; lus au démarrage et relevés sans arrêt (situation sismique, tâche 32). */
  private loadEarthquakes(): Promise<void> {
    return this.readEnvironment('earthquakes', async () => {
      const incoming = await fetchEarthquakes(this.currentEarthquakes);
      this.currentEarthquakes = mergeEarthquakes(this.currentEarthquakes, incoming);
      const now = Date.now();
      const data = this.currentEarthquakes.quakes.data;
      this.statusPanel?.updateSource('BCSF-RéNaSS', earthquakesStatus(this.currentEarthquakes, now));
      this.mapContainer?.updateEarthquakesLayer(data, now);
      this.earthquakesPanel?.update(this.currentEarthquakes);
      this.refreshEnvironmentLegend();
      this.recordEnvironmentSamples(now);
      this.refreshFranceIntelPanel();
    });
  }

  /** Catastrophes (GDACS, spec 2026-10-12) : territoire français et monde ; lues au démarrage et relevées sans arrêt (situations outre-mer). */
  private loadDisasters(): Promise<void> {
    return this.readEnvironment('disasters', async () => {
      const incoming = await fetchDisasters(this.currentDisasters);
      this.currentDisasters = mergeDisasters(this.currentDisasters, incoming);
      const now = Date.now();
      const data = this.currentDisasters.disasters.data;
      this.statusPanel?.updateSource('GDACS', disastersStatus(this.currentDisasters, now));
      this.statusPanel?.updateSource('Copernicus EMS', emsStatus(this.currentDisasters, now));
      this.mapContainer?.updateDisastersLayer(data, now);
      this.mapContainer?.updateEmsLayer(this.currentDisasters.ems.data, now);
      this.disastersPanel?.update(this.currentDisasters);
      this.refreshEnvironmentLegend();
      this.recordEnvironmentSamples(now);
      this.refreshFranceIntelPanel();
    });
  }

  /**
   * Marégraphes du SHOM (§ 3.4) : section Submersion marine, points de la couche Vigilance, ligne « Marégraphes SHOM » datée par la
   * dernière mesure (ok avec une note tant que le plus récent est frais : tâche 25). Pas une couche (pas de clé ENVIRONMENT_LAYER_KEYS) :
   * une seule lecture à la fois par `dedupe`, et un échec ne met en erreur que sa ligne (même règle que markEnvironmentSourcesFailed).
   */
  private loadSeaLevels(): Promise<void> {
    return dedupe('environment:seaLevels', async () => {
      try {
        const incoming = await fetchSeaLevels(this.currentSeaLevels);
        this.currentSeaLevels = mergeSeaLevels(this.currentSeaLevels, incoming);
        const now = Date.now();
        const data = this.currentSeaLevels.seaLevels.data;
        this.statusPanel?.updateSource('Marégraphes SHOM', seaLevelsStatus(this.currentSeaLevels, now));
        this.vigilancePanel?.update({ vigilance: this.currentVigilance, seaLevels: this.currentSeaLevels });
        this.mapContainer?.updateSeaLevelsLayer(data, this.currentVigilance?.vigilance.data ?? null, now);
        this.refreshEnvironmentLegend();
        this.recordEnvironmentSamples(now);
      } catch (err) {
        const error = err instanceof Error ? err.message : 'service de la source introuvable';
        const dated = this.statusPanel?.getSources().find((s) => s.name === 'Marégraphes SHOM')?.lastUpdate ?? null;
        this.statusPanel?.updateSource('Marégraphes SHOM', dated !== null ? { status: 'stale', error } : { status: 'error', lastUpdate: null, period: undefined, error });
        // La section Submersion dit la panne (S3) au lieu de rester sur « Chargement des marégraphes… » : données gardées, échec nommé.
        const previous = this.currentSeaLevels?.seaLevels;
        this.currentSeaLevels = { seaLevels: { data: previous?.data ?? null, fetchedAt: previous?.fetchedAt ?? null, error } };
        this.vigilancePanel?.update({ vigilance: this.currentVigilance, seaLevels: this.currentSeaLevels });
        throw err;
      }
    });
  }

  private async loadInfrastructure(): Promise<void> {
    const gasInfra = ALL_INFRASTRUCTURE.filter((p) => p.type === 'gas-terminal' || p.type === 'gas-storage');
    this.mapContainer?.updateInfrastructure(gasInfra);
  }

  private async refreshHydraulicLayer(): Promise<void> {
    // Seuls la couche « stress hydro-énergétique » et son panneau consomment ces actifs : sans elle,
    // pas d'appels Hub'Eau (25 requêtes à chaque rafraîchissement Écowatt/crues, audit 2026-09).
    // L'activation de la couche relance ce rafraîchissement (refreshHydraulicSignalSources()).
    if (!this.activeLayers.hydroBackbone) return;
    const { buildHydraulicBackboneAssets } = await import('./services/hydraulic-backbone.ts');
    this.currentHydraulicHydrometry = await fetchHydraulicHydrometrySnapshot(
      this.currentHydraulicAssets.length > 0 ? this.currentHydraulicAssets : buildHydraulicBackboneAssets(null, [], []),
    );
    const env = this.environmentInputs();
    this.currentHydraulicAssets = buildHydraulicBackboneAssets(
      this.currentEcowattResponse,
      env.floodSegments,
      env.meteoAlerts,
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
  }

  private async loadHydraulic(): Promise<void> {
    await this.refreshHydraulicLayer();
  }

  private async loadEolien(): Promise<void> {
    this.statusPanel?.updateSource('Éolien France', { status: 'loading', lastUpdate: null });

    try {
      // Parcs éoliens (4,6 Mo) seulement pour la carte ou le panneau Éolien ; l'indice ne lit que la production du moment.
      const parks = this.activeLayers.windMonitor === true || this.eolienPanel?.isVisible() === true;
      const snapshot = await this.eolienTracker.fetchDashboardSnapshot(undefined, { parks });
      this.currentEolienLive = snapshot.live;
      this.currentEolienParks = snapshot.parks;

      // Update barometer wind score + widget tooltip immediately
      setBarometerEolienLive(snapshot.live);
      this.networkBarometerWidget?.updateEolien(snapshot.live);
      this.repaintPoste();

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
      this.refreshFranceIntelPanel();
    } catch (error) {
      console.warn('[App/Eolien] Source unavailable', error);
      const message = error instanceof Error ? error.message : 'fetch_failed';
      this.currentEolienLive = null;
      this.currentEolienParks = [];
      this.mapContainer?.updateEolien(null, []);
      this.eolienPanel?.showErrorState(message);
      this.statusPanel?.updateSource('Éolien France', { status: 'stale', lastUpdate: new Date(), detail: message });
      this.refreshFranceIntelPanel();
    }
  }

  /** Événements de sûreté ASNR (spec 2026-10-13) : section du panneau Nucléaire, anneaux, situations ; lus au rythme du parc. */
  private async loadAsnr(): Promise<void> {
    const incoming = await fetchAsnr(this.currentAsnr);
    this.currentAsnr = mergeAsnr(this.currentAsnr, incoming);
    const now = Date.now();
    this.statusPanel?.updateSource('ASNR', asnrStatus(this.currentAsnr, now));
    this.mapContainer?.updateAsnrLayer(this.currentAsnr.data, now);
    this.nuclearPanel?.setAsnr(this.currentAsnr);
    this.refreshFranceIntelPanel();
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
      this.repaintPoste();

      if (this.activeLayers.nuclearFleet && this.nuclearPanel?.isVisible()) {
        this.nuclearPanel.update(nuclearState, this.currentEcowattResponse);
      }

      this.mapContainer?.updateInfrastructure(buildEnergyInfrastructurePoints(unavailabilities, rteResult.available));

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

  /**
   * Trafic routier (spec trafics § 2.1, § 2.2) : DIR et TomTom collectés par le serveur ; panneau, carte, score, sources datées (S1).
   * Lecture unique en cours partagée (readTraffic) ; fusion à l'écriture : une route en échec garde les données actuelles.
   */
  private loadRoadTraffic(): Promise<void> {
    return this.readTraffic('trafficRoad', async () => {
      const { fetchRoadTraffic, mergeRoadTraffic, roadStatus, clearLegacyTomTomStorage } = await import('./services/traffic-road.ts');
      if (!this.legacyTomTomCleared) {
        this.legacyTomTomCleared = true;
        try {
          clearLegacyTomTomStorage(window.localStorage);
        } catch {
          // Stockage refusé : rien à effacer.
        }
      }
      const now = Date.now();
      const read = await fetchRoadTraffic(this.currentRoadTraffic, now);
      // État relu APRÈS la lecture, jamais celui capturé à son départ.
      const state = mergeRoadTraffic(this.currentRoadTraffic, read, now);
      this.currentRoadTraffic = state;
      this.trafficPanel?.update(state);
      this.mapContainer?.updateRoadTraffic(state.national.data, state.urban.data, now);
      this.mapLegend?.addCategory(roadLegend(state.national.data, state.urban.data, now));
      this.statusPanel?.updateSource('Trafic', roadStatus(state, 'national', now));
      this.statusPanel?.updateSource('TomTom agglomérations', roadStatus(state, 'urban', now));
      this.recordTrafficSamples(now);
      this.refreshFranceIntelPanel();
    });
  }

  /**
   * Positions des avions pour la carte (/api/traffic/air, 12 s) ; ligne « Positions aériennes (carte) » datée par l'heure des états
   * OpenSky servis, jamais l'heure de lecture ; un échec garde cette date. « Trafic aérien » reste à l'aperçu du panneau.
   */
  private async loadAirTraffic(): Promise<void> {
    try {
      const snapshot = await fetchAirTrafficSnapshot();
      this.mapContainer?.updateAirTraffic(snapshot.flights);
      this.airPositions = { read: { at: snapshot.fetchedAt, errors: (snapshot.errors ?? []).map((e) => e.message) }, failure: null };
    } catch (err) {
      this.airPositions = { read: this.airPositions.read, failure: err instanceof Error ? err.message : 'lecture impossible' };
      throw err;
    } finally {
      const now = Date.now();
      this.statusPanel?.updateSource(AIR_POSITIONS_SOURCE, airPositionsStatus(this.airPositions.read, this.airPositions.failure, now));
      this.recordTrafficSamples(now);
    }
  }

  /** Trafic aérien (spec trafics § 2.3) : aperçu OpenSky du serveur ; panneau, carte, sources datées par l'état OpenSky (S1). */
  private loadAirOverview(): Promise<void> {
    return this.readTraffic('trafficAir', async () => {
      const { fetchAirOverview, mergeAirOverview, airStatus } = await import('./services/traffic-air.ts');
      const now = Date.now();
      const read = await fetchAirOverview(this.currentAirOverview, now);
      const state = mergeAirOverview(this.currentAirOverview, read, now);
      this.currentAirOverview = state;
      this.airTrafficPanel?.update(state);
      this.mapContainer?.updateAirOverview(state.overview.data, now);
      this.mapLegend?.addCategory(airLegend(state.overview.data, now));
      this.statusPanel?.updateSource('Trafic aérien', airStatus(state, now));
      this.recordTrafficSamples(now);
      this.refreshGeneralWatch();
    });
  }

  private async loadGas(): Promise<void> {
    console.log('[App/loadGas] Entry');

    if (!isGasPanelEnabled()) {
      console.log('[App/loadGas] Feature DISABLED, skipping...');
      this.statusPanel?.updateSource('Gaz', { status: 'stale', lastUpdate: null });
      this.currentGasData = null;
      return;
    }

    this.statusPanel?.updateSource('Gaz', { status: 'loading', lastUpdate: null });

    try {
      const [gasData, biogasState, biomethaneSites] = await Promise.all([
        fetchGasNetwork(),
        fetchBiogasProduction().catch(() => null),
        fetchBiomethaneSites().catch(() => [] as BiomethaneSite[]),
      ]);
      this.currentGasData = gasData;
      this.currentBiogasState = biogasState;
      if (biomethaneSites.length > 0) {
        this.currentBiomethaneSites = biomethaneSites;
      }

      // Update map visualization
      await this.mapContainer?.updateGas(gasData);
      if (this.currentBiomethaneSites?.length) {
        this.mapContainer?.updateBiomethaneSites(this.currentBiomethaneSites);
      }

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
      this.gasPanel?.update(gasData, biogasState);

      console.log(`[App/loadGas] Complete: EcoGaz=${gasData.ecogaz.signal}, Fill=${gasData.nationalStats.averageFillLevel.toFixed(1)}%`);
    } catch (err) {
      console.error('[App/loadGas] Failed:', err);
      this.statusPanel?.updateSource('Gaz', { status: 'error', lastUpdate: new Date() });
    }
  }

  private async loadDromEnergy(): Promise<void> {
    this.statusPanel?.updateSource('Énergie DROM / SEI', { status: 'loading', lastUpdate: null });

    try {
      const dashboard = await this.mapContainer?.ensureDromEnergyLoaded();
      if (!dashboard) {
        throw new Error('Aucune donnée DROM énergie disponible');
      }
      this.currentDromEnergyDashboard = dashboard;
      this.currentDromEnergyError = null;

      const hasAssets = dashboard.assets.length > 0;
      this.statusPanel?.updateSource('Énergie DROM / SEI', {
        status: hasAssets ? 'ok' : 'stale',
        lastUpdate: new Date(dashboard.updatedAt),
      });

      if (this.activeLayers.dromEnergy && this.dromEnergyPanel?.isVisible()) {
        this.dromEnergyPanel.show(dashboard);
        this.layoutEnergyFloatingPanels();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      this.currentDromEnergyError = message;
      this.currentDromEnergyDashboard = null;
      this.statusPanel?.updateSource('Énergie DROM / SEI', { status: 'error', lastUpdate: new Date(), detail: message });
      if (this.activeLayers.dromEnergy) {
        this.dromEnergyPanel?.showErrorState(message);
        this.layoutEnergyFloatingPanels();
      }
    }
  }

  /** Production DROM et Corse en temps réel (EDF SEI) ; un échec garde les dernières données. */
  private async loadDromLive(): Promise<void> {
    try {
      const { fetchDromLive } = await import('./services/drom-live.ts');
      this.currentDromLive = await fetchDromLive();
      this.currentDromLiveError = null;
    } catch (error) {
      this.currentDromLiveError = error instanceof Error ? error.message : 'Erreur inconnue';
    }
    this.dromEnergyPanel?.setLive(this.currentDromLive, this.currentDromLiveError);
  }

  private async loadOil(): Promise<void> {
    console.log('[App/loadOil] Entry');
    const oilStatusDetail = 'OilNetwork : réseau et stocks structurels + carburants quasi-live via API prix carburants';

    const { fetchOilDashboard, isOilPanelEnabled } = await import('./services/oil.ts');
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
      return;
    }

    this.statusPanel?.updateSource('Pétrole', {
      status: 'loading',
      lastUpdate: null,
      detail: oilStatusDetail,
    });

    try {
      const [oilData, fuelTensionResult] = await Promise.allSettled([
        // Fichiers JODI seulement pour le panneau Pétrole (couche allumée) ; la Vue générale ne suit que la tension.
        fetchOilDashboard({ jodi: this.activeLayers.oilNetwork === true }),
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
      this.oilReadWithJodi ||= this.activeLayers.oilNetwork === true;

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
    originPeriodLabel?: string;
    originLastMonth?: { label: string; volumeMt: number; sharePct: number };
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
        originPeriodLabel: origin.periodLabel,
        originLastMonth: origin.lastMonth,
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

  /**
   * Réseau ferroviaire (spec trafics § 2.4) : perturbations SNCF et situations SIRI SX ; panneau, carte, score, note, sources datées
   * (S1). Lecture unique en cours partagée (readTraffic) ; fusion à l'écriture : une route en échec garde les données actuelles.
   */
  private loadRailTraffic(): Promise<void> {
    return this.readTraffic('trafficRail', async () => {
      const { fetchRailTraffic, mergeRailTraffic, railStatus } = await import('./services/traffic-rail.ts');
      const now = Date.now();
      const read = await fetchRailTraffic(this.currentRailTraffic, now);
      const state = mergeRailTraffic(this.currentRailTraffic, read, now);
      this.currentRailTraffic = state;
      this.transportPanel?.update(state);
      this.mapContainer?.updateRailTraffic(state.overview.data, now);
      this.mapLegend?.addCategory(railLegend(state.overview.data, state.situations.data, now));
      this.statusPanel?.updateSource('SNCF', railStatus(state, 'overview', now));
      this.statusPanel?.updateSource('SIRI SX', railStatus(state, 'situations', now));
      this.recordTrafficSamples(now);
      this.refreshFranceIntelPanel();
    });
  }

  /** Trafic maritime (spec trafics § 2.5) : instantané du relais AIS ; panneau, carte, sources datées par le dernier message (S1). */
  private loadMaritimeSnapshot(): Promise<void> {
    return this.readTraffic('trafficMaritime', async () => {
      const { fetchMaritimeSnapshot, mergeMaritimeState, maritimeStatus } = await import('./services/traffic-maritime.ts');
      const now = Date.now();
      const read = await fetchMaritimeSnapshot(this.currentMaritimeSnapshot, AIS_RELAY_URL, now);
      const state = mergeMaritimeState(this.currentMaritimeSnapshot, read, now);
      this.currentMaritimeSnapshot = state;
      this.maritimePanel?.update(state);
      this.mapContainer?.updateMaritimeSnapshot(state.snapshot.data, now);
      this.mapLegend?.addCategory(maritimeLegend(state.snapshot.data, now));
      this.statusPanel?.updateSource('AIS instantané', maritimeStatus(state, now));
      this.recordTrafficSamples(now);
      this.refreshGeneralWatch();
    });
  }

  /** Historique de qualité des sources Trafics hors Watchdog (même store que la santé). */
  private recordTrafficSamples(now: number): void {
    recordStatusSamples(this.statusPanel?.getSources().filter((s) => TRAFFIC_SOURCE_NAMES.includes(s.name)) ?? [], now);
  }

  /** Entrées Trafics du score France, de la frise et de la note (arbitrage 14 de la phase B). */
  private trafficInputs(): { railTrains: RailTrain[]; roadEvents: RoadEvent[]; urbanJamCount: number } {
    return {
      railTrains: this.currentRailTraffic?.overview.data?.trains ?? [],
      roadEvents: this.currentRoadTraffic?.national.data?.events ?? [],
      urbanJamCount: (this.currentRoadTraffic?.urban.data?.agglos ?? []).reduce((n, a) => n + a.jams, 0),
    };
  }

  /**
   * Entrées Environnement du score France, de la frise, des situations, de la note, de l'export, du poste v2, de l'ISNR et du stress
   * hydro (spec 2026-10-04 environnement § 2.7) : vigilance du jour, tronçons en vigilance, détections en France non récurrentes,
   * incidents DBSCAN géo-résolus, foyers du serveur, sources lues, séismes et épisodes de pollution (phase B, situations) ; lues dans
   * les dernières réponses des services, jamais copiées ailleurs. Une source en retard (S2, mêmes délais que les panneaux : carte de
   * vigilance, relevé Vigicrues, détections FIRMS) ou une collecte des feux de plus de 2 jours, gardée après une erreur, ne compte
   * plus ; un relevé des séismes en retard ou une couche des épisodes en panne ou en retard non plus. Un rafraîchissement les lit
   * une fois et les passe à ses consommateurs : un seul instant pour ces règles (revue m6).
   */
  private environmentInputs(now: number = Date.now()): EnvironmentInputs {
    return {
      ...buildEnvironmentInputs(
        this.currentVigilance?.vigilance.data ?? null, this.currentFloods?.floods.data ?? null, this.currentFires?.fires.data ?? null,
        this.currentFireIncidents, now,
      ),
      // Phase B : séismes et épisodes de pollution (situations, contrats § 6) ; la sécheresse n'y entre jamais (E2).
      quakes: servedQuakes(this.currentEarthquakes?.quakes.data ?? null, now),
      disasters: servedDisasters(this.currentDisasters?.disasters.data ?? null, now),
      emsActive: servedEms(this.currentDisasters?.ems.data ?? null, now),
      airEpisodes: servedAirEpisodes(this.currentAirQuality?.air.data ?? null, now),
    };
  }

  private async loadMetropoles(): Promise<void> {
    this.statusPanel?.updateSource('Métropoles', { status: 'loading', lastUpdate: null });
    const metropoles = await fetchMetropoles();
    this.currentMetropoles = metropoles;
    if (metropoles.length > 0) {
      this.mapContainer?.updateMetropoles(metropoles);
      this.statusPanel?.updateSource('Métropoles', { status: 'ok', lastUpdate: new Date() });
    } else {
      this.statusPanel?.updateSource('Métropoles', { status: 'stale', lastUpdate: new Date() });
    }
    this.metroLoadPanel?.update(metropoles);
  }

  /** Veille sanitaire (spec 2026-10-03 § 2, § 3.1, § 3.2) : panneaux, niveau national de la fiche thème, panneau des sources daté (S1). */
  private async loadHealthSurveillance(keys: readonly HealthSurveillanceKey[] | 'all'): Promise<void> {
    if (keys !== 'all' && keys.length === 0) return;
    const [{ fetchHealthSurveillance, mergeSurveillance, surveillanceStatus }, { nationalSummary }, { urgencesLegend }, { sourcePeriod }] = await Promise.all([
      import('./services/health-surveillance.ts'), import('./components/layer-panel/veille.ts'), import('./components/layer-panel/urgences-legend.ts'),
      import('./components/layer-panel/health-format.ts'),
    ]);
    const now = Date.now();
    const read = await fetchHealthSurveillance(this.currentHealth, now, keys);
    // Lectures concurrentes (démarrage et couche restaurée, relève) : seules les sources lues remplacent l'état courant.
    const state = mergeSurveillance(this.currentHealth, read, keys);
    this.currentHealth = state;
    this.healthNationalOf = nationalSummary;
    this.currentHealthNational = nationalSummary(state, now);
    this.veillePanel?.update(state);
    this.urgencesPanel?.update(state);
    this.mapContainer?.updateHealthAlerts(state.alerts.data, now);
    this.mapContainer?.updateHealthDepartments(state.syndromic.data, this.currentHealthOffer?.apl.data ?? null, now);
    // Légende Urgences datée (S1) ; en retard, « (en retard) » et couleurs retirées de la carte (S2).
    this.mapLegend?.addCategory(urgencesLegend(HEALTH_URGENCES_LEGEND, state.syndromic.data, now));
    const updated: string[] = [];
    for (const [key, name] of HEALTH_STATUS_SOURCES) {
      if (keys === 'all' || keys.includes(key)) {
        this.statusPanel?.updateSource(name, { ...surveillanceStatus(state, key, now), period: sourcePeriod(state, key, now) });
        updated.push(name);
      }
    }
    this.recordHealthSamples(updated, now);
    this.repaintPoste();
  }

  /**
   * Historique local de qualité des sources santé (hors Watchdog, spec 2026-10-03) : statuts du panneau des sources, datés par la
   * donnée. Jamais réenregistrées au Watchdog, qui les daterait de la lecture et les passerait « en cache figé » au bout de 10 min.
   */
  private recordHealthSamples(names: readonly string[], now: number): void {
    recordStatusSamples(this.statusPanel?.getSources().filter((s) => names.includes(s.name)) ?? [], now);
  }

  /** Offre de soins (APL, hôpitaux) : fichiers annuels, panneaux, panneau des sources sur la date de publication (S1). */
  private async loadHealthOffer(): Promise<void> {
    const { fetchHealthOffer, offerStatus } = await import('./services/health-offer.ts');
    const offer = await fetchHealthOffer(this.currentHealthOffer);
    this.currentHealthOffer = offer;
    this.accesSoinsPanel?.update(offer);
    this.hopitauxPanel?.update(offer);
    this.mapContainer?.updateHealthDepartments(this.currentHealth?.syndromic.data ?? null, offer.apl.data, Date.now());
    this.mapContainer?.updateHospitals(offer.hospitals.data);
    this.statusPanel?.updateSource('DREES APL', offerStatus(offer, 'apl'));
    this.statusPanel?.updateSource('DREES SAE / FINESS', offerStatus(offer, 'hospitals'));
    this.recordHealthSamples(HEALTH_OFFER_SOURCES.map(([, name]) => name), Date.now());
  }

  /**
   * Relève santé (spec 2026-10-03 § 3) : toutes les 30 min tant qu'une couche santé est active ; pausée onglet caché, relève
   * immédiate au retour (registerPausableInterval) ; les caches clients (25 min) sont plus courts que la relève.
   */
  /**
   * Étendue des mobilisations et des violences (26/10/2026) : lue au démarrage puis toutes les 10 min, quel que soit l'onglet (entrée
   * de l'indice). Une lecture en échec garde la précédente 30 min au plus, puis plus rien : jamais une situation sur un vieux comptage.
   */
  private startEventPressurePolling(): void {
    const load = async (): Promise<void> => {
      // Chargé à la demande : hors du fichier principal de l'application (plafond de précache du service worker).
      const { fetchEventPressure } = await import('./services/event-pressure.ts');
      const read = await fetchEventPressure();
      const keep = this.currentEventPressure !== null && Date.now() - Date.parse(this.currentEventPressure.readAt) < 30 * 60_000;
      this.currentEventPressure = read ?? (keep ? this.currentEventPressure : null);
      this.refreshFranceIntelPanel();
    };
    void load();
    this.registerPausableInterval(() => { void load(); }, POLL_EVENT_PRESSURE_MS);
  }

  /** Notes archivées (26/10/2026) : liste lue au démarrage puis toutes les 30 min (une note nouvelle toutes les 6 h). */
  private startArchivedNotesPolling(): void {
    const load = async (): Promise<void> => {
      const { fetchArchivedNotes } = await import('./services/situation-notes.ts');
      this.archivedNotes = await fetchArchivedNotes();
      this.repaintPoste();
    };
    void load();
    this.registerPausableInterval(() => { void load(); }, 30 * 60_000);
  }

  /** Note archivée relue et ouverte au format A4, avec sa date dans l'en-tête. */
  private async openArchivedNote(id: string): Promise<void> {
    // Fenêtre ouverte au clic, avant toute attente : sinon le navigateur la bloque.
    const win = window.open('', '_blank');
    const [{ fetchArchivedNote }, { openArchivedSituationReport }] = await Promise.all([
      import('./services/situation-notes.ts'), import('./components/SituationReport.ts'),
    ]);
    const note = await fetchArchivedNote(id);
    if (!note) {
      win?.close();
      this.archivedNotes = this.archivedNotes?.filter((n) => n.id !== id);
      this.repaintPoste();
      return;
    }
    const when = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' }).format(new Date(note.capturedAt));
    const score = note.score !== null ? `, indice ${note.score}/100` : '';
    openArchivedSituationReport(note.report, `Note archivée du ${when}${score}`, win);
  }

  private startHealthPolling(): void {
    if (this._intervalHealth !== null) return;
    let inFlight = false;
    this._intervalHealth = this.registerPausableInterval(() => {
      if (inFlight) return;
      const keys = this.healthSurveillanceKeys();
      const offer = this.activeLayers.healthApl || this.activeLayers.hospitals;
      if (keys !== 'all' && keys.length === 0 && !offer) return;
      inFlight = true;
      Promise.all([this.loadHealthSurveillance(keys), offer ? this.loadHealthOffer() : Promise.resolve()])
        .catch((err) => console.error('[App] Health poll error', err))
        .finally(() => { inFlight = false; });
    }, POLL_HEALTH_MS);
  }

  private async refreshHydraulicSignalSources(): Promise<void> {
    const results = await Promise.allSettled([
      this.loadEcowatt(),
      this.loadVigilance(),
      this.loadFloods(),
    ]);

    if (results.every((result) => result.status === 'rejected')) {
      await this.refreshHydraulicLayer();
    }
  }

  /**
   * Relève éCO2mix dédiée : Réseau électrique, Parc nucléaire, Éolien, Stress hydro et le score France lisent
   * `currentEcowattResponse`, qui n'était rechargé qu'au démarrage et par la relève hydraulique (10 min, couche
   * hydro active seulement) : la donnée passait « en retard » alors que la source était à jour. Pausée onglet caché,
   * relève immédiate au retour.
   */
  private startEco2mixPolling(): void {
    if (this._intervalEco2mix !== null) return;
    let inFlight = false;
    this._intervalEco2mix = this.registerPausableInterval(() => {
      if (inFlight) return;
      inFlight = true;
      this.loadEcowatt()
        .catch((err) => console.error('[App] éCO2mix poll error', err))
        .finally(() => { inFlight = false; });
    }, POLL_ECO2MIX_MS);
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
      if (document.hidden) return; // skip tick while tab is hidden
      poll().catch((err) => console.error('[App] Hydraulic poll error', err));
    }, POLL_HYDRAULIC_MS);
  }

  private async loadMtgFrpMetadata(force = false): Promise<void> {
    if (this.mtgFrpRequestInFlight) return;
    this.mtgFrpRequestInFlight = true;
    Watchdog.register('fire-mtg-frp', {
      label: 'MTG-FRP LSA SAF',
      staleAfterMs: MTG_FRP_LATE_MS,
      detail: 'Produit de démonstration EUMETSAT LSA SAF',
    });
    Watchdog.report('fire-mtg-frp', { type: 'loading' });
    const startedAt = performance.now();
    try {
      const metadata = await fetchMtgFrpMetadata(force);
      if (
        this.latestMtgFrpMetadata?.observedAt !== metadata.observedAt
        || this.latestMtgFrpMetadata.fetchedAt !== metadata.fetchedAt
      ) {
        this.latestMtgFrpMetadata = metadata;
      }
      const observedAt = Date.parse(metadata.observedAt);
      // État dérivé de l'observation (démonstration), jamais « actif » codé : le panneau Feux le date et dit son retard à l'affichage
      // (observation + 60 min, S2) ; « stale » (dernière valide gardée) est réservé à une lecture en échec.
      this.mtgFrpFeed = {
        status: 'ok',
        observedAt,
        fetchedAt: Date.now(),
        source: 'EUMETSAT LSA SAF',
      };
      Watchdog.report('fire-mtg-frp', {
        type: 'success',
        responseTimeMs: Math.round(performance.now() - startedAt),
        detail: `Observation ${metadata.observedAt} · DÉMONSTRATION`,
      });
      if (this.mtgFrpEnabled) this.mapContainer?.setMtgFrpEnabled(true);
    } catch (error) {
      this.mtgFrpFeed = this.latestMtgFrpMetadata
        ? { ...this.mtgFrpFeed, status: 'stale', detail: 'Dernière observation valide conservée' }
        : { status: 'error', observedAt: null, fetchedAt: Date.now(), source: 'EUMETSAT LSA SAF' };
      Watchdog.report('fire-mtg-frp', {
        type: 'failure',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.mtgFrpRequestInFlight = false;
      this.firesPanel?.update(this.firesPanelState());
    }
  }

  private startMtgFrpPolling(): void {
    if (this._intervalMtgFrp !== null) clearInterval(this._intervalMtgFrp);

    const poll = (force: boolean): void => {
      if (document.hidden) return;
      if (!this.activeLayers.fires && !this.mtgFrpEnabled) return;
      void this.loadMtgFrpMetadata(force).catch((error) => {
        // Keep latestMtgFrpMetadata and the current raster on transient failure.
        console.error('[App] MTG-FRP poll error', error);
      });
    };

    poll(false);
    this._intervalMtgFrp = setInterval(() => poll(true), POLL_MTG_FRP_MS);
  }

  /**
   * Manifeste radar Météo-France (spec § 2.3) : image 2D montrée par la couche Radar météo, sommets d'écho selon l'option partagée avec
   * les feux, ligne « Radar Météo-France » datée par l'observation (S1) ; une lecture en échec garde la dernière image et le dit.
   * `force` : relève périodique seulement (lecture réseau) ; ouverture du panneau, puce et sommets d'écho lisent par le cache de 2 min
   * du service.
   */
  private loadRadarManifest(force = false): Promise<void> {
    return this.readEnvironment('weatherRadar', async () => {
      try {
        const result = await fetchRadar2dManifest(force);
        const manifest = result.configured ? result.manifest : null;
        // Image 2D : la couche Radar la commande (l'interrupteur « Réflectivité radar 2D » du panneau Feux n'existe plus).
        await this.mapContainer?.setRadar2dOverlay(manifest, false);
        this.mapContainer?.setEchoTopsOverlay(manifest, this.echoTopsEnabled);
        this.radarManifest = result;
        this.radarError = null;
      } catch (err) {
        console.warn('[App] Manifeste radar illisible', err);
        this.radarError = 'lecture du manifeste radar en échec';
      }
      const now = Date.now();
      this.statusPanel?.updateSource('Radar Météo-France', radarStatus(this.radarManifest, this.radarError, now));
      this.weatherRadarPanel?.update(this.radarPanelState());
      this.firesPanel?.update(this.firesPanelState());
      this.refreshEnvironmentLegend();
      this.recordEnvironmentSamples(now);
    });
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
      if (document.hidden) return; // skip tick while tab is hidden
      poll().catch((err) => console.error('[App] Eolien poll error', err));
    }, POLL_EOLIEN_MS);
  }

  private startDromLivePolling(): void {
    if (this._intervalDromLive !== null) clearInterval(this._intervalDromLive);
    let inFlight = false;
    this._intervalDromLive = setInterval(() => {
      if (document.hidden || inFlight) return; // onglet masqué ou lecture en cours
      const shouldRefresh = this.activeLayers.dromEnergy || this.dromEnergyPanel?.isVisible() === true;
      if (!shouldRefresh) return;
      inFlight = true;
      this.loadDromLive()
        .catch((err) => console.error('[App] DROM live poll error', err))
        .finally(() => { inFlight = false; });
    }, POLL_DROM_LIVE_MS);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOAD ALL LAYERS — Pattern WorldMonitor (static first, then parallel async)
  // ═══════════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT DATA — 3 priority groups + 1 sync method
  // ═══════════════════════════════════════════════════════════════════════════

  /** Sync — called first, no network, instant display */
  private loadStaticData(): void {
    // Sites de défense (liste interne en chunk dynamique) : loadDefenseSites, sans fusion OpenStreetMap (souveraineté § 2.1).
    void this.loadDefenseSites();
  }
  /** CRITICAL — awaited in init(). 4 layers that seed the ISNR (energy + weather + floods). */
  private async loadCriticalLayers(): Promise<void> {
    const tasks: Array<{ name: string; task: Promise<void> }> = [
      {
        name: 'ecowatt', task: this.loadEcowatt().catch(() => {
          this.currentEcowattResponse = {
            official: null,
            mixes: {},
            national: { timestamp: new Date(), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 },
            interconnections: [], grid: null,
          };
          this.mapContainer?.updateEnergy(this.currentEcowattResponse);
          this.statusPanel?.updateSource('Écowatt RTE', { status: 'error', lastUpdate: new Date() });
        })
      },
      // Échec d'un service Environnement : ses lignes du panneau des sources sont mises en erreur par readEnvironment ; ici, la trace.
      {
        name: 'vigilance', task: this.loadVigilance().catch((err) => console.error('[App] Vigilance météo indisponible', err))
      },
      {
        name: 'floods', task: this.loadFloods().catch((err) => console.error('[App] Crues indisponibles', err))
      },
      {
        name: 'nuclear', task: this.loadNuclear().catch(() => {
          this.currentNuclearState = null;
          this.networkBarometerWidget?.updateNuclear(null);
          this.statusPanel?.updateSource('Nucléaire RTE', { status: 'error', lastUpdate: new Date() });
        })
      },
      {
        name: 'asnr', task: this.loadAsnr().catch((err) => console.error('[App] ASNR indisponible', err))
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
        name: 'fires', task: this.loadFires().catch((err) => console.error('[App] Feux de forêt indisponibles', err))
      },
      // Souveraineté : aéronefs militaires et veille des câbles lus au démarrage (score, arbitrage 21) ; un service en échec met ses
      // lignes en erreur (readSovereignty) ; ici, la trace.
      {
        name: 'military', task: this.loadMilitary().catch((err) => console.error('[App] Aéronefs militaires indisponibles', err))
      },
      // Phase B : la grille GNSS est lue avec chaque lecture de la Défense (score) ; ici, la première.
      {
        name: 'gnss', task: this.loadGnss().catch((err) => console.error('[App] Grille GNSS indisponible', err))
      },
      {
        name: 'cables', task: this.loadCables().catch((err) => console.error('[App] Veille des câbles indisponible', err))
      },
      // Qualité de l'air et séismes lus au démarrage (situations, tâche 32) ; la sécheresse seulement avec sa couche ou son panneau.
      {
        name: 'air-quality', task: this.loadAirQuality().catch((err) => console.error('[App] Qualité de l’air indisponible', err))
      },
      {
        name: 'earthquakes', task: this.loadEarthquakes().catch((err) => console.error('[App] Séismes indisponibles', err))
      },
      {
        name: 'disasters', task: this.loadDisasters().catch((err) => console.error('[App] Catastrophes GDACS indisponibles', err))
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
          this.currentEolienParks = [];
          this.mapContainer?.updateEolien(null, []);
          this.statusPanel?.updateSource('Éolien France', { status: 'error', lastUpdate: new Date() });
        })
      },
      // Échec d'un service Trafics : toutes les lignes de sa couche (« TomTom agglomérations », « SIRI SX » comprises) sont mises
      // en erreur par readTraffic, pour chaque appelant ; ici, seulement la trace.
      {
        // Score France : trafic routier lu au démarrage, couche éteinte et quel que soit l'onglet, comme la SNCF (26/10/2026).
        name: 'traffic', task: this.loadRoadTraffic().catch((err) => console.error('[App] Trafic routier indisponible', err))
      },
      {
        // Score France et note de situation : perturbations SNCF lues au démarrage, même couche éteinte (comme avant).
        name: 'sncf', task: this.loadRailTraffic().catch((err) => console.error('[App] Réseau ferroviaire indisponible', err))
      },
      {
        name: 'metropoles', task: this.loadMetropoles().catch(() => {
          this.statusPanel?.updateSource('Métropoles', { status: 'error', lastUpdate: new Date() });
        })
      },
      {
        // Télécoms nourrit le score : lu une fois au démarrage, couche éteinte aussi (R16) ; les lignes disent l'échec (markOutagesSourcesFailed).
        name: 'outagesTelecom', task: this.loadOutagesSource('outagesTelecom'),
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
        // Panneau des sources : aperçu aérien lu au démarrage ; les positions de la carte attendent l'activation de la couche.
        // Échec du service : ligne « Trafic aérien » mise en erreur par readTraffic.
        name: 'air-overview', task: this.loadAirOverview().catch((err) => console.error('[App] Aperçu aérien indisponible', err))
      },
      {
        // Module santé en échec (chunk injoignable) : les huit sources de veille en erreur, jamais « en chargement » (S3).
        name: 'health', task: this.loadHealthSurveillance('all').catch(() => {
          for (const [, name] of HEALTH_STATUS_SOURCES) this.statusPanel?.updateSource(name, { status: 'error', lastUpdate: null, period: undefined });
        })
      },
      {
        name: 'health-offer', task: this.loadHealthOffer().catch(() => {
          for (const [, name] of HEALTH_OFFER_SOURCES) this.statusPanel?.updateSource(name, { status: 'error', lastUpdate: null, period: undefined });
        })
      },
      {
        // Vigilance cyber : un service en échec met ses cinq lignes en erreur (readSovereignty), jamais à l'heure du navigateur.
        name: 'cyber', task: this.loadCyber().catch((err) => console.error('[App] Vigilance cyber indisponible', err))
      },
      {
        // Indice Kp du panneau Énergie. La ligne de la météo spatiale du panneau des sources n'est jamais écrite ici : elle est celle de la
        // grille GNSS (loadGnss), datée par l'heure des échelles du serveur, jamais par l'horloge du navigateur (S1, revue de B28).
        name: 'space-weather', task: this.loadSpaceWeather().catch((err) => console.error('[App] Météo spatiale du panneau Énergie indisponible', err))
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
    // Kp index NOAA (panneau Énergie seulement ; la ligne de la météo spatiale du panneau des sources vient de loadGnss). null si
    // jamais lu : « n.d. » sans couleur, jamais « Calme ».
    const data = await fetchSpaceWeather();
    this.energyPanel?.updateSpaceWeather(data);

    // Refresh Kp toutes les 15 min
    if (this._intervalSpaceWeatherRefresh !== null) {
      clearInterval(this._intervalSpaceWeatherRefresh);
    }
    this._intervalSpaceWeatherRefresh = setInterval(async () => {
      if (document.hidden) return; // skip tick while tab is hidden
      const fresh = await fetchSpaceWeather().catch(() => null);
      if (fresh) this.energyPanel?.updateSpaceWeather(fresh);
    }, POLL_SPACE_WEATHER_REFRESH_MS);
  }

  private buildFranceTimeline(
    lang: 'fr' | 'en', env: EnvironmentInputs, sov: SovereigntyInputs = this.sovereigntyInputs(),
  ): { days: string[]; lanes: FranceIntelTimelineLane[] } {
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
    laneMap.weather.counts[todayIndex]   += env.meteoAlerts.filter((a) => a.level !== 'green').length;
    laneMap.weather.counts[todayIndex]   += env.floodSegments.filter((a) => a.level !== 'green').length;
    const traffic = this.trafficInputs();
    laneMap.transport.counts[todayIndex] += traffic.railTrains.length + traffic.roadEvents.length + traffic.urbanJamCount;
    // File « sécurité » du jour : navires lents confirmés sur un câble (AIS frais), comptés par navire (FX2 : une alerte par navire et
    // par câble), et mailles à précision GNSS dégradée sur 24 h (B28).
    laneMap.security.counts[todayIndex]  += distinctVessels(sov.cableAlerts) + (sov.gnssDegraded?.rolling24h ?? 0);
    // File « cyber » : chaque jour de Paris, les alertes du CERT-FR publiées ce jour-là et les avis publiés ce jour-là qui citent une
    // vulnérabilité du catalogue KEV (O6 : les autres avis, environ cinq par jour, sont un stock, pas un événement).
    const parisDays = days.map((d) => parisDayOf(d.getTime()));
    for (const item of sov.cyber ? [...sov.cyber.certfr.alerts, ...sov.cyber.certfr.avis.filter((a) => a.kevCves.length > 0)] : []) {
      const dayIndex = parisDays.indexOf(item.firstVersion);
      if (dayIndex !== -1) laneMap.cyber.counts[dayIndex] += 1;
    }

    return {
      days: days.map((d) =>
        d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', { month: 'short', day: 'numeric' }),
      ),
      lanes: Object.values(laneMap),
    };
  }

  /**
   * Fichier ARCEP versé au score, aux situations (« Perturbation télécom »), à l'indice de stabilité, au brief et à la note : null s'il
   * est en retard (isArcepFileLate), jamais ses comptes périmés. L'export, lui, garde le fichier lu : il est daté et dit tout.
   */
  private telecomForScore(): TelecomOutagesResponse | null {
    return telecomIfFresh(this.currentOutTelecom?.telecom.data ?? null, Date.now());
  }

  private buildFranceSnapshot(
    lang: 'fr' | 'en',
    options?: { brief?: StructuredBrief | null; briefFreshness?: 'fresh' | 'cached' },
    env: EnvironmentInputs = this.environmentInputs(),
  ): FranceCountrySnapshot {
    const sov = this.sovereigntyInputs();
    const raw: FranceRawData = {
      newsItems:            this.newsItems,
      isnrData:             this.currentISNRData,
      eventPressure:        this.currentEventPressure,
      ...env,
      ...this.trafficInputs(),
      // Souveraineté : aéronefs, urgences, alertes câbles, mailles GNSS, réponse cyber, disponibilités et pastilles (contrats § 6).
      ...sov,
      telecomOutages:       this.telecomForScore(),
      maritimeCount:        this.currentMaritimeTrafficFranceCount,
      marketData:           this.currentMarketData,
      financialStability:   this.currentFinancialStability?.data ?? null,
      ecowattResponse:      this.currentEcowattResponse,
      gasState:             this.currentGasData,
      nuclearState:         this.currentNuclearState,
      asnrEvents:           asnrEventsOf(this.currentAsnr?.data ?? null),
      eolienLive:           this.currentEolienLive,
      aisAnomalies:         this.currentAisAnomalies,
      timeline:             this.buildFranceTimeline(lang, env),
      briefLang:            lang,
      oilDashboard:         this.currentOilData ?? null,
      fuelTensionDashboard: this.currentFuelTensionData ?? null,
    };
    return buildFranceEngine(raw, { ...options, previousScore: getPreviousScoreForSmoothing() });
  }

  private pressEventSituation(e: PressAlertEvent, locale: string): DetectedSituation {
    const lastSeen = new Date(e.lastSeen);
    return {
      id: `news-event-${e.id}`,
      type: 'NEWS_ALERT',
      severity: threatLevelToSituationSeverity(e.severity),
      confidence: 0.9,
      title: truncateLabel(e.title, 88),
      summary: e.title,
      affectedZones: [],
      drivers: [
        t('alerts.source', { value: e.sources.join(', ') }),
        t('alerts.category', { value: t(`newsFeed.categoryLabels.${e.category}`) }),
        t('alerts.publication', { value: lastSeen.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) }),
      ],
      recommendedActions: [
        { label: t('alerts.verifyArticle'), ownerHint: t('alerts.osintWatch'), actionType: 'investigate' },
        { label: t('alerts.followField'), ownerHint: t('alerts.trackingCell'), actionType: 'monitor', automatable: true },
      ],
      sourceRefs: [...e.sources, t('alerts.sourceRefs.rss')],
      category: e.category,
      updatedAt: lastSeen,
    };
  }

  private buildAlertMonitorSituations(env: EnvironmentInputs = this.environmentInputs()): DetectedSituation[] {
    const language = getCurrentLanguage();
    const locale = language === 'fr' ? 'fr-FR' : 'en-US';
    const now = new Date();
    const nowMs = now.getTime();
    // env : vigilance du jour et incidents des feux, mêmes entrées que le score (carte en retard ou collecte FIRMS en retard écartées).

    // Presse : événements consolidés et corroborés quand ils sont chargés (spec 2026-09-28 § 4.7),
    // sinon repli sur les articles un par un.
    const pressEvents = this.pressAlertSource.current(ALERT_MONITOR_LIMIT, nowMs);
    // Pas de doublon entre les deux origines dans le cache (revue finale C2).
    pruneStalePressAlerts(this.alertMonitorCache, pressEvents !== null);
    const newsSituations = pressEvents
      ? pressEvents.map((e) => this.pressEventSituation(e, locale))
      : this.newsItems
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
          t('alerts.source', { value: item.source }),
          t('alerts.category', { value: t(`newsFeed.categoryLabels.${item.threat?.category ?? 'general'}`) }),
          t('alerts.publication', { value: item.pubDate.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) }),
        ],
        recommendedActions: [
          { label: t('alerts.verifyArticle'), ownerHint: t('alerts.osintWatch'), actionType: 'investigate' as const },
          { label: t('alerts.followField'), ownerHint: t('alerts.trackingCell'), actionType: 'monitor' as const, automatable: true },
        ],
        sourceRefs: [item.source, t('alerts.sourceRefs.rss')],
        linkUrl: item.link,
        linkLabel: t('alerts.openArticle'),
        // v2 : rattache l'alerte presse au thème de son article (spec §7.3).
        category: item.threat?.category ?? ('general' as const),
        updatedAt: item.pubDate,
      }));

    // Souveraineté (contrats § 6 ; amendement 7, O7) : urgences au-dessus du territoire ou à moins de 40 km, les trois codes,
    // affichées sur deux relevés ou vues une fois ; navires lents confirmés sur un câble, AIS frais ; compte de mailles GNSS (phase B).
    const sov = this.sovereigntyInputs(nowMs);
    const surgeSituations = militaryEmergencyAlerts(monitoredMilitaryEmergencies(this.currentMilitary?.military.data ?? null, nowMs))
      .slice(0, ALERT_MONITOR_LIMIT);

    const weatherSituations = [...env.meteoAlerts]
      .filter((alert) => alert.level === 'red' || alert.level === 'orange')
      .sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1))
      .slice(0, ALERT_MONITOR_LIMIT)
      .map((alert) => {
        const risks = alert.risks.map((risk) =>
          t(`alerts.meteoRiskLabels.${risk}`, { defaultValue: METEO_RISK_LABELS[risk] ?? risk }),
        );
        return {
          id: `weather-alert-${alert.departmentCode}-${alert.level}-${alert.risks.join('-')}`,
          type: 'WEATHER_ALERT' as const,
          severity: alert.level === 'red' ? 'critical' : 'high',
          confidence: alert.level === 'red' ? 0.95 : 0.84,
          title: t('alerts.weatherAlertTitle', { level: alert.level, department: alert.department }),
          summary: risks.length > 0
            ? t('alerts.mainRisk', { value: risks.slice(0, 2).join(', ') })
            : t('alerts.weatherAlertOngoing', { level: alert.level }),
          affectedZones: [alert.department],
          drivers: [
            ...(risks.length > 0 ? [t('alerts.risks', { value: risks.join(', ') })] : []),
            ...(alert.startDate ? [t('alerts.start', { value: alert.startDate.toLocaleString(locale) })] : []),
            ...(alert.endDate ? [t('alerts.end', { value: alert.endDate.toLocaleString(locale) })] : []),
          ],
          recommendedActions: [
            { label: t('alerts.monitorWeather'), ownerHint: t('alerts.weatherCell'), actionType: 'monitor' as const, automatable: true },
            { label: t('alerts.crossCheckField'), ownerHint: t('alerts.localCoordination'), actionType: 'cross-check' as const },
          ],
          sourceRefs: [t('alerts.sourceRefs.meteo')],
          updatedAt: now,
        };
      });

    // Une entrée par navire, ses câbles listés (FX2).
    const defenseSituations = cableAlertSituations(sov.cableAlerts).slice(0, ALERT_MONITOR_LIMIT);
    // Phase B (tâche B28 ; O7, O17) : une seule entrée GNSS, sans lieu, tirée du compte des 24 h ; moyenne, élevée sur deux jours UTC
    // complets de suite, jamais critique ; aucune si la grille est en retard, en dégradation générale ou jamais lue.
    const jammingSituations = gnssJammingSituations(this.gnssState?.gnss.data ?? null, nowMs).slice(0, ALERT_MONITOR_LIMIT);
    // Grille devenue inexploitable ou sans maille : l'entrée gardée en cache part tout de suite, jamais après sa durée de vie.
    pruneStaleGnssAlert(this.alertMonitorCache, jammingSituations);

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
        affectedZones: [t('alerts.maritimeZone')],
        drivers: [
          t('alerts.anomalyType', {
            value: anomaly.type === 'radio_silence' ? t('alerts.radioSilence') : t('alerts.suspectRendezvous'),
          }),
          t('alerts.mmsiCount', { count: anomaly.mmsis.length }),
        ],
        recommendedActions: [
          { label: t('alerts.verifyAnomaly'), ownerHint: t('alerts.maritimeWatch'), actionType: 'monitor' as const, automatable: true },
          { label: t('alerts.crossCheckLocal'), ownerHint: t('alerts.maritimeSafety'), actionType: 'cross-check' as const },
        ],
        sourceRefs: [t('alerts.sourceRefs.ais')],
        updatedAt: new Date(anomaly.timestamp),
      }));

    const wildfireSituations = detectWildfireIncidents({
      fireIncidents: env.fireIncidents,
    } as FranceRawData);

    const freshAlerts = [
      ...wildfireSituations,
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

  /** Sources principales de la note lues à cet instant (couverture d'un relevé d'historique). */
  private scoreCoverage(env: EnvironmentInputs): ScoreCoverage {
    const sov = this.sovereigntyInputs();
    return scoreCoverageOf({
      presse: this.newsItems.length > 0,
      isnr: this.currentISNRData !== null,
      ecowatt: this.currentEcowattResponse !== null,
      vigilance: env.environmentAvailable.vigilance,
      crues: env.environmentAvailable.floods,
      feux: env.environmentAvailable.fires,
      trains: (this.currentRailTraffic?.overview.data ?? null) !== null,
      routes: (this.currentRoadTraffic?.national.data ?? null) !== null,
      telecom: this.telecomForScore() !== null,
      cyber: sov.sovereigntyAvailable.cyber,
      militaire: sov.sovereigntyAvailable.military,
      finance: (this.currentFinancialStability?.data ?? null) !== null,
      carburants: (this.currentFuelTensionData ?? null) !== null,
      petrole: (this.currentOilData ?? null) !== null,
    });
  }

  private refreshFranceIntelPanel(): void {
    const lang = this.intelLang();
    // Entrées Environnement lues une fois : instantané, moniteur et poste v2 voient le même instant (revue m6).
    const env = this.environmentInputs();
    const snapshot = this.buildFranceSnapshot(lang, undefined, env);
    // Revue (correction post-relecture) : en v2, tant que les couches critiques ne sont pas
    // chargées, les caches consommés par l'instantané sont vides — ne pas écrire dans l'historique
    // de stabilité local ni dans l'historique de situation partagé (SET NX, une seule écriture par
    // créneau de 6 h pour TOUS les visiteurs) avant que startV2Intel() ait tourné.
    const canRecord = shouldRecordIntelSnapshot(this.uiV2, this.v2IntelStarted);
    if (canRecord) {
      recordStabilitySnapshot(snapshot.score, {
        continuity: snapshot.axes.continuity,
        security: snapshot.axes.security,
        signal: snapshot.axes.signal,
        defense: snapshot.axes.defense,
      });
    }
    const alerts = this.buildAlertMonitorSituations(env);
    if (this.uiV2) {
      this.updatePoste(snapshot, alerts, lang, env);
    } else {
      this.alertMonitor?.update(alerts, lang);
      this.situationMonitor?.update(snapshot.situations, lang);
      this.situationBrief?.update(snapshot.situations);
    }
    if (canRecord) void pushHistorySnapshot(snapshot, this.scoreCoverage(env), performance.now());
    if (canRecord && this.recorderPage) void this.exposeRecorderReport();
    if (!this.isIntelSurfaceVisible()) return;
    this.franceIntelPanel?.show(snapshot);
    const now = Date.now();
    const evaluation = evaluateBriefLevel(this.franceIntelBriefMark, snapshot.score, now);
    this.franceIntelBriefMark = evaluation.mark;
    if (evaluation.refresh) {
      this.requestFranceIntelBrief(snapshot, lang, { showLoading: false });
    } else {
      this.armFranceIntelBriefSettleTimer(evaluation.settleAt);
    }
  }

  private clearFranceIntelBriefSettleTimer(): void {
    if (this.franceIntelBriefSettleTimer !== null) {
      clearTimeout(this.franceIntelBriefSettleTimer);
      this.franceIntelBriefSettleTimer = null;
    }
  }

  /**
   * Comme refreshFranceIntelPanel n'est appelé que sur arrivée de données, un changement de
   * couleur qui doit encore stabiliser (BRIEF_LEVEL_SETTLE_MS) a besoin d'un minuteur pour être
   * revérifié même sans nouvelle donnée. Un seul minuteur à la fois.
   */
  private armFranceIntelBriefSettleTimer(settleAt: number | null): void {
    this.clearFranceIntelBriefSettleTimer();
    if (settleAt === null) return;
    const delay = Math.max(0, settleAt - Date.now());
    this.franceIntelBriefSettleTimer = setTimeout(() => {
      this.franceIntelBriefSettleTimer = null;
      if (!this.isIntelSurfaceVisible()) return;
      this.refreshFranceIntelPanel();
    }, delay);
  }

  /** Assemble l'état courant (caches, aucun fetch) pour la note de situation. */
  private buildSituationReportContext(): SituationReportContext {
    const lang = this.intelLang();
    const env = this.environmentInputs();
    const snapshot = this.buildFranceSnapshot(lang, undefined, env);
    const traffic = this.trafficInputs();
    const context: SituationReportContext = {
      generatedAt: new Date(),
      permalink: window.location.href,
      situations: snapshot.situations,
      // Niveau national seulement une fois les couches critiques lues (jamais un vert par défaut).
      nationalScore: this.v2IntelStarted || !this.uiV2 ? snapshot.score : null,
      stability: this.currentISNRData,
      meteoAlerts: env.meteoAlerts,
      floodSegments: env.floodSegments,
      ecowatt: this.currentEcowattResponse,
      railTrains: traffic.railTrains,
      roadEvents: traffic.roadEvents,
      telecomOutages: this.telecomForScore(),
      newsItems: this.newsItems,
      // Sources santé : hors Watchdog, lues dans le panneau des sources avec leur période (spec 2026-10-03 S1).
      sources: [...Watchdog.getSnapshot(), ...healthReportSources(this.statusPanel?.getSources() ?? [])],
      version: null,
    };
    // Sources Trafics : hors Watchdog, lues dans le panneau des sources avec la date de leur donnée (spec 2026-10-03 trafics S1).
    context.sources.push(...trafficReportSources(this.statusPanel?.getSources() ?? []));
    // Sources Environnement : hors Watchdog, datées par leur donnée (spec 2026-10-04 environnement S1).
    context.sources.push(...environmentReportSources(this.statusPanel?.getSources() ?? []));
    // Sources Souveraineté : hors Watchdog, datées par leur donnée (spec 2026-10-04 souveraineté S1).
    context.sources.push(...sovereigntyReportSources(this.statusPanel?.getSources() ?? []));
    return context;
  }

  /** Ouvre la note de situation imprimable (module chargé à la demande). */
  /**
   * Page de l'enregistreur (?recorder=1) : la note de situation du moment est remise à scripts/score-recorder.mjs, qui l'archive
   * (une par créneau de 6 h, 90 jours ; notes archivées de la fiche France, 26/10/2026). Lien de la note : l'application, jamais la
   * page de l'enregistreur.
   */
  private async exposeRecorderReport(): Promise<void> {
    const { collectSituationReportData } = await import('./components/SituationReport.ts');
    window.__fmRecorderReport = { ...collectSituationReportData(this.buildSituationReportContext()), permalink: 'https://www.francemonitor.com/?view=app' };
  }

  private async openSituationReport(): Promise<void> {
    const { openSituationReport } = await import('./components/SituationReport.ts');
    openSituationReport(this.buildSituationReportContext());
  }

  /** Instantané des caches courants pour l'export CSV / GeoJSON (aucun fetch). */
  private buildExportContext(): ExportContext {
    const lang = this.intelLang();
    const env = this.environmentInputs();
    const snapshot = this.buildFranceSnapshot(lang, undefined, env);
    return {
      news: this.newsItems,
      situations: snapshot.situations,
      meteoAlerts: env.meteoAlerts,
      floods: env.floodSegments,
      // Toutes les détections en France de la dernière collecte, récurrentes comprises (colonne « récurrent ») : l'export dit tout.
      fires: this.currentFires?.fires.data?.detections ?? [],
      telecomOutages: this.currentOutTelecom?.telecom.data ?? null,
      roadEvents: this.trafficInputs().roadEvents,
      roadUrban: this.currentRoadTraffic?.urban.data ?? null,
    };
  }

  /** Ouvre/ferme le menu d'export (module chargé à la demande). */
  private async toggleExportMenu(anchor: HTMLElement): Promise<void> {
    if (!this.exportMenu) {
      const { ExportMenu } = await import('./components/ExportMenu.ts');
      this.exportMenu = new ExportMenu({
        anchor,
        getContext: () => this.buildExportContext(),
      });
    }
    this.exportMenu.toggle();
  }

  private async refreshNetworkBarometerWidget(): Promise<void> {
    const result = await fetchNetworkBarometer();
    this.currentNetworkBarometer = result;
    this.networkBarometerWidget?.update(result);
    this.networkBarometerWidget?.updateNuclear(this.currentNuclearState);
    this.networkBarometerWidget?.updateEolien(this.currentEolienLive);
    // v2 (spec 2026-09-29 § 7) : pas d'appel à la synthèse ISNR (Groq), son bloc n'est plus affiché.
    if (this.uiV2) {
      // Section Infrastructures de l'onglet État (spec 2026-10-01) : repeinte avec le nouveau résultat.
      this.repaintPoste();
      return;
    }

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
    // L'enregistreur ne lit que la note : une page ouverte tous les quarts d'heure ne doit pas consommer le quota Groq.
    if (this.recorderPage) return;
    const requestId = ++this.franceIntelBriefRequestId;
    // Un brief est demandé : plus rien à stabiliser (chaque demande de brief y compris via ce
    // minuteur repart de zéro), et la nouvelle couleur devient la référence pour la suite.
    this.clearFranceIntelBriefSettleTimer();
    this.franceIntelBriefMark = {
      level: scoreLevel(snapshot.score),
      lastLevelRefreshAt: this.franceIntelBriefMark?.lastLevelRefreshAt ?? null,
      divergentLevel: null,
      divergedSince: null,
    };
    // S1…S5 désignent les situations de CET instantané : figé pour les preuves cliquables.
    const situationIds = briefSituationIds(snapshot.situations);
    if (options?.showLoading !== false) {
      this.franceIntelPanel?.showBriefLoading();
      this.poste?.setBriefPending();
    }

    // Les événements consolidés alimentent le tiroir (v1) ou la liste et la fiche (v2), et servent
    // de preuves citables au brief.
    const eventsLoad = this.loadFranceIntelEvents();
    // Ils sont remis dès qu'ils arrivent, sans limite de temps.
    void eventsLoad.then((loaded) => {
      if (requestId !== this.franceIntelBriefRequestId || !this.isIntelSurfaceVisible()) return;
      if (this.uiV2) {
        this.deliverV2Events(loaded?.state ?? null);
        return;
      }
      if (!this.franceIntelPanel) return;
      if (loaded) this.franceIntelPanel.updateEvents(loaded.state);
      else this.franceIntelPanel.markEventsUnavailable();
    });
    // Le brief ne les attend que FRANCE_INTEL_BRIEF_EVENTS_WAIT_MS : une base qui cale ne
    // doit pas le laisser sur « Génération… » ; il part alors avec les seules situations.
    void settleWithin(eventsLoad.then((loaded) => loaded?.briefEvents ?? []), FRANCE_INTEL_BRIEF_EVENTS_WAIT_MS, [])
      .then((briefEvents) => (requestId === this.franceIntelBriefRequestId
        ? fetchFranceIntelBrief(snapshot, lang, briefEvents)
        : null))
      .then((result) => {
        if (!result || requestId !== this.franceIntelBriefRequestId) return;
        if (!this.isIntelSurfaceVisible()) return;
        if (this.intelLang() !== lang) return;
        this.franceIntelPanel?.updateBrief(result.brief, result.freshness, situationIds);
        this.poste?.setBrief(result.brief, result.freshness, situationIds, { at: result.generatedAt ?? Date.now(), level: scoreLevel(snapshot.score) });
      });
  }

  /**
   * Événements + fil « depuis votre dernière visite » (modules chargés à la demande, hors
   * chunk critique). L'état porte `unavailable` si l'API échoue ; null seulement si le
   * chunk lui-même n'a pas pu être chargé.
   */
  private async loadFranceIntelEvents(): Promise<{ state: IntelEventsState; briefEvents: BriefEventInput[] } | null> {
    try {
      const [events, visit] = await Promise.all([
        import('./services/news-events.ts'),
        import('./services/intel-last-visit.ts'),
      ]);
      const state = await events.loadIntelEventsState(visit.beginIntelVisit());
      this.pressAlertSource.update(state, events.pressAlertEvents);
      // L'utilisateur a vu l'état courant : c'est l'ancre de sa prochaine visite.
      if (!state.unavailable) visit.recordIntelVisitSeen();
      return { state, briefEvents: events.selectBriefEvents(state.events) };
    } catch (err) {
      console.warn('[App] France intel events unavailable', err);
      return null;
    }
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
      if (document.hidden) return; // skip tick while tab is hidden
      if (!this.isIntelSurfaceVisible()) return;
      const lang = this.intelLang();
      const snapshot = this.buildFranceSnapshot(lang);
      this.franceIntelPanel?.show(snapshot);
      this.requestFranceIntelBrief(snapshot, lang, { showLoading: false });
    }, FRANCE_INTEL_BRIEF_REFRESH_MS);
  }

  private async openFranceIntelPanel(): Promise<void> {
    if (!this.currentSovCyber) void this.loadCyber();
    if (!this.currentISNRData) this.updateISNR();
    if (!this.currentOilData) void this.loadOil();
    void this.refreshNetworkBarometerWidget().catch((err) => {
      console.error('[App] Network barometer refresh on France Intel open failed', err);
    });

    // Un seul panneau flottant à la fois (audit UI 2026-09 §5.3.3).
    this.hideAllFloatingPanels();

    const panel = await this.ensureFranceIntelPanel();
    const lang = panel.getCurrentLang();
    const snapshot = this.buildFranceSnapshot(lang);
    panel.show(snapshot);
    this.requestFranceIntelBrief(snapshot, lang);
    this.scheduleFranceIntelBriefRefresh();
    this.currentFloatingPanelId = null;
    this.refreshFloatingPanelSwitcher();
  }

  // ─── Disposition A1 derrière ?ui=v2 (refonte UI, étape 2) ───────────────────

  /** Langue de l'instantané et du brief : bascule FR/EN de l'en-tête en v2, bouton du tiroir sinon. */
  private intelLang(): 'fr' | 'en' {
    return this.uiV2 ? getCurrentLanguage() : (this.franceIntelPanel?.getCurrentLang() ?? 'fr');
  }

  /** Surface qui affiche le brief : la fiche France (v2, dès son lancement) ou le tiroir ouvert (v1). */
  private isIntelSurfaceVisible(): boolean {
    return this.uiV2 ? this.v2IntelStarted : this.franceIntelPanel?.isVisible() === true;
  }

  /** Contrôleur de la v2, chargé à la demande (hors du chunk critique). */
  private ensurePoste(): Promise<PosteSituation> {
    if (this.poste) return Promise.resolve(this.poste);
    if (this.postePromise) return this.postePromise;
    const roots = this.v2Roots;
    if (!roots) return Promise.reject(new Error('Poste de situation : conteneurs absents'));
    this.postePromise = import('./components/poste/PosteSituation.ts').then(({ PosteSituation }) => {
      const poste = new PosteSituation({ app: this.container, ...roots }, {
        onThemeChange: (theme) => {
          this.v2Theme = theme;
          this.applyLayerPreset(theme);
          this.refreshEventPoints();
        },
        onFlyTo: (lon, lat, zoom) => this.mapContainer?.flyTo(lon, lat, zoom),
        onActivateLayers: (keys) => this.activateLayersFromSituation(keys),
        onOpenLayerPanel: (key) => this.openLayerPanelFromFiche(key),
        onFicheClosed: () => this.showDefaultBrief(),
        onQueue: (queue) => {
          this.lastQueue = queue;
          this.refreshThemeBrief();
        },
        onPressure: (depts) => {
          this.v2Pressure = depts;
          this.pressurePanel?.update(depts);
          void this.mapContainer?.updateDepartmentPressure(new Map(depts.map((d) => [d.code, d.level])));
        },
        onOpenArchivedNote: (id) => { void this.openArchivedNote(id); },
        // Fiche département, « Voir sur la carte » : pression par département allumée, département mis en évidence.
        onShowDepartment: (code) => {
          this.activateLayersFromSituation(['stability']);
          this.mapContainer?.highlightISNRDepartment(code);
        },
        onOpenDossier: (situation) => this.openAlertDossier(situation),
        onOpenReport: () => {
          void this.openSituationReport();
        },
        onShowFrance: () => {
          const france = VIEW_PRESETS.france;
          this.mapContainer?.flyTo(france.center[0], france.center[1], france.zoom);
        },
        // Relecture finale m7 : la carte mobile, créée dans l'onglet masqué, s'ajuste à l'affichage.
        onMapShown: () => this.mapContainer?.resize(),
        // Une sélection prend la colonne : le panneau de module ouvert se ferme d'abord.
        onSelect: () => {
          if (moduleInColumn(this.uiV2, window.innerWidth)) this.closeV2ModulePanel();
        },
      });
      this.poste = poste;
      // Revue (correction post-relecture) : premier rendu seul, sans passer par
      // refreshFranceIntelPanel — à cet instant (juste après renderShell(), avant tout
      // chargement), les caches sont vides et startV2Intel() n'a pas encore tourné ; on peint
      // le poste avec l'état courant, sans toucher à l'historique de stabilité local ni à
      // l'historique de situation partagé (voir shouldRecordIntelSnapshot).
      this.repaintPoste();
      return poste;
    });
    return this.postePromise;
  }

  /**
   * Équivalent v2 de l'ouverture du tiroir : la fiche France est toujours affichée, donc brief,
   * événements et ligne de base de visite partent dès que les couches critiques sont chargées.
   */
  private async startV2Intel(): Promise<void> {
    if (this.v2IntelStarted) return;
    const poste = await this.ensurePoste();
    const visit = await import('./services/intel-last-visit.ts');
    if (this.v2IntelStarted) return;
    // Revue : la ligne de base DOIT être figée avant le premier enregistrement ; startVisitBaseline
    // la fige, puis pose une seule fois les écouteurs visibilitychange (hidden) et pagehide qui
    // enregistrent la dernière liste vue (relecture finale I5).
    this.v2BaselineSession = visit.startVisitBaseline(() => poste.currentLevels(), { document, window });
    poste.setBaseline(this.v2BaselineSession.baseline);
    this.mapContainer?.setOnEventPointClick((id, x, y) => { void this.openEventPreview(id, x, y); });
    // Clic sur un département de la pression par département : sa fiche (26/10/2026).
    this.mapContainer?.setOnDepartmentClick((code) => {
      this.mapContainer?.highlightISNRDepartment(code);
      this.poste?.select(`dept:${code}`);
    });
    void loadDepartementIndex().then((index) => {
      if (index) poste.setDepartements(index);
    });
    this.v2IntelStarted = true;
    // Les couches critiques sont là : la v2 peut afficher le niveau national.
    this.refreshFranceIntelPanel();
    if (!this.currentSovCyber) void this.loadCyber();
    if (!this.currentOilData) void this.loadOil();
    void this.refreshNetworkBarometerWidget().catch((err) => {
      console.error('[App] Network barometer refresh on v2 start failed', err);
    });
    const lang = this.intelLang();
    this.requestFranceIntelBrief(this.buildFranceSnapshot(lang), lang);
    this.scheduleFranceIntelBriefRefresh();
    this.v2EventsTimer = setInterval(() => {
      if (document.hidden) return; // skip tick while tab is hidden
      void this.loadFranceIntelEvents().then((loaded) => this.deliverV2Events(loaded?.state ?? null));
    }, V2_EVENTS_REFRESH_MS);
    void getHistory(7)
      .then((result) => poste.setResolved(resolvedSituationsFromHistory(result.data.slots, Date.now())))
      .catch(() => {
        // Sans historique, « Ce qui a changé » ne liste simplement pas les situations résolues.
      });
  }

  /**
   * Repeint la v2 avec les caches courants, rendu seul : ni historique de stabilité local, ni
   * historique de situation partagé, ni brief (premier rendu, arrivée des marchés et des matières
   * premières : relecture finale m4). Sans effet en v1 ou avant le chargement du poste.
   */
  private repaintPoste(): void {
    if (!this.uiV2 || !this.poste) return;
    const lang = this.intelLang();
    // Entrées Environnement lues une fois par repeinte : un seul instant pour la règle des 2 jours (revue m6).
    const env = this.environmentInputs();
    this.updatePoste(this.buildFranceSnapshot(lang, undefined, env), this.buildAlertMonitorSituations(env), lang, env);
  }

  /** Données en cache (aucun fetch) remises à la v2 à chaque rafraîchissement. */
  private updatePoste(snapshot: FranceCountrySnapshot, alerts: DetectedSituation[], lang: 'fr' | 'en', env: EnvironmentInputs): void {
    const now = Date.now();
    this.poste?.update({
      snapshot,
      alerts,
      ecowatt: this.currentEcowattResponse,
      meteo: env.meteoAlerts,
      floods: env.floodSegments,
      markets: this.currentMarketData,
      commodities: this.currentCommodityData,
      outagesLevel: this.outagesNowLevel(),
      sources: this.statusPanel?.getSources() ?? [],
      coverage: this.scoreCoverage(env),
      archivedNotes: this.archivedNotes,
      upcoming: upcomingFromSources({
        ecowatt: this.currentEcowattResponse, vigilance: this.currentVigilance?.vigilance.data ?? null,
        protests: this.currentProtests?.data?.items ?? null, now,
      }),
      infra: { result: this.currentNetworkBarometer, nuclear: this.currentNuclearState, eolien: this.currentEolienLive },
      health: this.healthNationalNow(now),
      score: { delta24h: getDelta24h(), pillarDeltas: getPillarDeltas24h(), series: getSparklineSeries() },
      // Revue : pas de niveau national avant les couches critiques (jamais un vert par défaut).
      ready: this.v2IntelStarted,
      lang,
      now,
    });
    this.refreshGeneralWatch();
  }

  /** Remet les événements à la v2 et enregistre la ligne de base, au même moment que l'ancre de visite. */
  /** Couche Événements de la v2 : les événements du fil, du thème choisi (spec 2026-09-29 § 5). */
  private refreshEventPoints(): void {
    // L'ancienne interface (?ui=v1) n'a pas d'événements : sa légende garde le seul bloc des articles.
    const events = this.uiV2 ? this.v2EventsState?.events ?? [] : [];
    const all = eventMapPoints(events, this.v2Theme);
    if (this.uiV2) this.mapContainer?.setEventPoints(eventMapPoints(events, this.v2Theme, this.v2HiddenLevels));
    this.mapLegend?.setEventsKey(buildEventsKeyHtml({
      eventsVisible: this.uiV2 && this.activeLayers.events === true,
      newsVisible: this.activeLayers.news === true,
      points: all,
      hiddenLevels: this.v2HiddenLevels,
    }));
  }

  /** Aperçu d'un événement : ouvert tout de suite, articles et extrait à l'arrivée du détail. */
  private async openEventPreview(id: number, x: number, y: number): Promise<void> {
    const event = this.v2EventsState?.events.find((e) => e.id === id);
    const preview = this.mapPreview;
    if (!event || !preview) {
      this.poste?.select(`event:${id}`);
      return;
    }
    this.previewEventId = id;
    preview.setOnAction((action) => {
      if (action === 'open-fiche') this.poste?.select(`event:${id}`);
    });
    preview.show(buildEventPreviewHtml(event, 'loading', Date.now()), x, y);
    // Module chargé à la demande, comme le reste des événements (hors chunk critique).
    const detail = await import('./services/news-events.ts')
      .then((m) => m.fetchEventDetail(id))
      .catch(() => null);
    if (this.previewEventId !== id || !preview.isOpen()) return;
    preview.update(buildEventPreviewHtml(event, detail ?? 'error', Date.now()));
  }

  /** Aperçu d'un article ; « Voir l'événement » s'il appartient à un événement chargé. */
  private openArticlePreview(item: NewsItem, x: number, y: number): void {
    const preview = this.mapPreview;
    if (!preview) return;
    const event = item.eventId === undefined ? null : this.v2EventsState?.events.find((e) => e.id === item.eventId) ?? null;
    this.previewEventId = null;
    preview.setOnAction((action) => {
      if (action === 'open-event' && event) this.poste?.select(`event:${event.id}`);
    });
    preview.show(buildArticlePreviewHtml(item, event, Date.now()), x, y);
  }

  private deliverV2Events(state: IntelEventsState | null): void {
    const poste = this.poste;
    if (!poste) return;
    poste.setEvents(state);
    this.v2EventsState = state;
    this.pushPressEventsToPanels();
    this.refreshEventPoints();
    // Les alertes presse suivent les événements tout juste chargés (spec 2026-09-28 § 4.7).
    this.repaintPoste();
    if (state && !state.unavailable) this.recordV2VisitBaseline();
  }

  /** Événements de presse vers les panneaux Défense et Cyber (section « Signalé par la presse », 22/10/2026). */
  private pushPressEventsToPanels(): void {
    const events = this.v2EventsState?.events ?? [];
    this.defensePanel?.setPressEvents(events);
    this.cyberPanel?.setPressEvents(events);
  }

  /**
   * Enregistre les niveaux affichés comme ligne de base de la prochaine visite (v2). Sans effet
   * avant startV2Intel, qui fige d'abord la ligne de base de l'onglet (relecture finale I5).
   */
  private recordV2VisitBaseline(): void {
    this.v2BaselineSession?.record();
  }

  private updateISNR(): void {
    const env = this.environmentInputs();
    this.currentISNRData = computeISNR(
      this.newsItems,
      env.meteoAlerts,
      env.floodSegments,
      this.currentEcowattResponse,
      '24h',
      this.telecomForScore(),
    );

    // Update map layer
    // v2 : la couche montre la pression par département (onPressure), pas l'ISNR.
    if (!this.uiV2) void this.mapContainer?.updateISNR(this.currentISNRData.scores);

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
    this._intervalClock = this.registerPausableInterval(update, 1000);
  }
}
