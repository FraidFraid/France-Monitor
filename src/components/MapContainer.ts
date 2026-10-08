/**
 * MapContainer.ts — Wrapper qui choisit DeckGLMap (desktop) ou Map (mobile).
 * Expose toutes les méthodes de calques unifié.
 */

import type { DeckGLMap } from './DeckGLMap.ts';
import type { Map as SVGMap } from './Map.ts';
import type { NewsItem, AirOverviewResponse, MaritimeSnapshot, RailOverviewResponse, RailTrain, RoadNationalResponse, RoadUrbanResponse, EcowattResponse, FuelTensionDashboard, InfrastructurePoint, MapLayers, MapViewState, MilitaryBase, AirTrafficFlight, TelecomOutage, PowerOutage, ISNRScore, AlertLevelsResponse, AplDataset, AplProfession, EmergencySite, HospitalsDataset, SyndromicResponse, GasNetworkState, NetworkOutageState, InfraNetworkState, SatelliteViewRequest, HydraulicBackboneAsset } from '../types/index.ts';
import type { MilitaryShip } from '../services/military-ships.ts';
import type { RTEIIPIncident } from '../services/rte-iip.ts';
import type { EventMapPoint } from '../services/v2-map.ts';
import type { MetropoleConsumption } from '../services/metropoles.ts';
import type { CopernicusScene, SatelliteCollection } from '../types/index.ts';
import type { EolienLive, EolienParkSummary } from '../services/eolien/types.ts';
import { fetchDromEnergyDashboard, type DromEnergyAsset, type DromEnergyDashboard } from '../services/drom-energy/index.ts';
import type { Radar2dManifest } from '../services/radar-2d.ts';
import type { CablesWatchResponse, DefenseOsmWorksFile, DroneZonesFile, GnssResponse, MilitaryResponse, SubseaCablesFile } from '../types/index.ts';
import type { AirQualityResponse, DroughtResponse, EarthquakesResponse, FiresResponse, FloodsResponse, SeaLevelsResponse, VigilanceEcheance, VigilanceResponse } from '../types/index.ts';
import type { UrgencesSyndrome } from './layer-panel/health-format.ts';

/** Detect if the device is mobile (no WebGL or small screen) */
function isMobileDevice(): boolean {
  if (window.innerWidth < 768) return true;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
  } catch {
    return true;
  }
  if ('maxTouchPoints' in navigator && navigator.maxTouchPoints > 0) {
    // @ts-expect-error -- deviceMemory is not in all browsers
    const memory = navigator.deviceMemory;
    if (typeof memory === 'number' && memory < 4) return true;
  }
  return false;
}

export class MapContainer {
  private container: HTMLElement;
  private deckMap: DeckGLMap | null = null;
  private svgMap: SVGMap | null = null;
  private isMobile: boolean;
  private onItemClick: ((item: NewsItem) => void) | null = null;
  private onItemHover: ((item: NewsItem | null, x: number, y: number) => void) | null = null;
  private onClusterHover: ((items: NewsItem[], x: number, y: number, totalCount: number) => void) | null = null;
  private onClusterClick: ((items: NewsItem[], center: [number, number]) => void) | null = null;
  private onViewChange: ((vs: MapViewState) => void) | null = null;
  private onMilitaryBaseClick: ((base: MilitaryBase, x: number, y: number) => void) | null = null;
  private onRawMapClick: ((lat: number, lon: number) => void) | null = null;
  private onSatelliteView: ((request: SatelliteViewRequest) => void) | null = null;
  private dromEnergyData: DromEnergyDashboard | null = null;
  private dromEnergyLoadPromise: Promise<void> | null = null;
  private radar2dManifest: Radar2dManifest | null = null;
  private radar2dEnabled = false;
  private echoTopsEnabled = false;
  private onRadarPointPick: ((lat: number, lon: number) => void) | null = null;
  private radarPick: { lat: number; lon: number } | null = null;
  private onSovereigntyFeatureClick: ((layerId: string, props: Record<string, unknown>) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.isMobile = isMobileDevice();
  }

  async init(): Promise<void> {
    if (this.isMobile) {
      // Fallback mobile D3/SVG chargé à la demande — évite d'embarquer d3
      // dans chaque session desktop (qui utilise DeckGLMap ci-dessous).
      const { Map: SVGMapImpl } = await import('./Map.ts');
      this.svgMap = new SVGMapImpl(this.container);
      if (this.onItemClick) this.svgMap.setOnItemClick(this.onItemClick);
      if (this.onItemHover) this.svgMap.setOnItemHover(this.onItemHover);
      await this.svgMap.init();
      console.log('[MapContainer] Mobile map (D3/SVG) initialized');
      return;
    }

    const { DeckGLMap: DeckGLMapImpl } = await import('./DeckGLMap.ts');
    this.deckMap = new DeckGLMapImpl(this.container);
    if (this.onItemClick) this.deckMap.setOnItemClick(this.onItemClick);
    if (this.onItemHover) this.deckMap.setOnItemHover(this.onItemHover);
    if (this.onViewChange) this.deckMap.setOnViewChange(this.onViewChange);
    if (this.onClusterHover) this.deckMap.setOnClusterHover(this.onClusterHover);
    if (this.onClusterClick) this.deckMap.setOnClusterClick(this.onClusterClick);
    if (this.onMilitaryBaseClick) this.deckMap.setOnMilitaryBaseClick(this.onMilitaryBaseClick);
    if (this.onRadarPointPick) this.deckMap.setOnRadarPointPick(this.onRadarPointPick);
    if (this.radarPick) this.deckMap.setRadarPick(this.radarPick);
    if (this.onSovereigntyFeatureClick) this.deckMap.setOnSovereigntyFeatureClick(this.onSovereigntyFeatureClick);
    if (this.onRawMapClick) this.deckMap.setOnRawMapClick(this.onRawMapClick);
    if (this.onSatelliteView) this.deckMap.setOnSatelliteView(this.onSatelliteView);
    await this.deckMap.init();
    await this.deckMap.setRadar2dOverlay(this.radar2dManifest, this.radar2dEnabled);
    this.deckMap.setEchoTopsOverlay(this.radar2dManifest, this.echoTopsEnabled);
    console.log('[MapContainer] Desktop map (MapLibre) initialized');
  }

  /**
   * Ajuste la carte à son conteneur devenu visible (v2 mobile, onglet « Carte » : relecture
   * finale m7). La carte D3 du mobile ne suit pas son conteneur ; MapLibre le fait seule.
   */
  resize(): void {
    this.svgMap?.resize();
  }

  // ─── News ───
  updateNews(items: NewsItem[]): void {
    this.deckMap?.updateNews(items);
    this.svgMap?.updateNews(items);
  }

  // ─── Energy (Ecowatt) ───
  async updateEnergy(ecowatt: EcowattResponse): Promise<void> {
    await this.deckMap?.updateEnergy(ecowatt);
  }

  updateEnergyTooltipData(
    regions: import('../types/index.ts').RegionEnergyStats[],
    flows:   import('../types/index.ts').InterconnectionFlowStats[],
    history?: import('../services/energy-regions.ts').BorderHistory,
  ): void {
    this.deckMap?.updateEnergyTooltipData(regions, flows, history);
  }

  // ─── Gas (EcoGaz + Vital Organs) ───
  async updateGas(state: GasNetworkState): Promise<void> {
    await this.deckMap?.updateGas(state);
  }

  setGasPipelineVisible(show: boolean): void {
    this.deckMap?.setGasPipelineVisible(show);
  }

  // ─── Biomethane injection sites ───
  updateBiomethaneSites(sites: import('../types/index.ts').BiomethaneSite[]): void {
    this.deckMap?.updateBiomethaneSites(sites);
  }

  // ─── Oil (Vigilance Pétrole - Raffineries, Stocks) ───
  async updateOil(flows: Array<{ id: string; name: string; country?: string; flowKbd: number; coordinates: [number, number]; franceCoordinates?: [number, number]; hubName?: string; originSharePct?: number; originVolumeMt?: number; originReferenceYear?: number; originSourceLabel?: string; originPartialBreakdown?: boolean; originBreakdown?: Array<{ label: string; volumeMt: number; sharePct: number }> }>): Promise<void> {
    await this.deckMap?.updateOil(flows);
  }

  async updateOilInfrastructure(data: import('../types').OilDashboard): Promise<void> {
    await this.deckMap?.updateOilInfrastructure(data);
  }

  async updateFuelTension(dashboard: FuelTensionDashboard | null): Promise<void> {
    await this.deckMap?.updateFuelTensionDepartments(dashboard);
    this.svgMap?.updateFuelTension(dashboard);
  }

  async loadOilPipelines(): Promise<void> {
    await this.deckMap?.loadOilPipelines();
  }


  /** [minLng, minLat, maxLng, maxLat] de la vue courante, ou null. */
  getBounds(): [number, number, number, number] | null {
    return this.deckMap?.getBounds() ?? null;
  }

  getViewState(): MapViewState | null {
    return this.deckMap?.getViewState() ?? null;
  }


  setModisOverlayVisible(enabled: boolean): void {
    this.deckMap?.setModisOverlayVisible(enabled);
  }

  setMtgFrpEnabled(enabled: boolean): void {
    this.deckMap?.setMtgFrpEnabled(enabled);
  }

  async setRadar2dOverlay(manifest: Radar2dManifest | null, enabled: boolean): Promise<void> {
    if (this.deckMap) await this.deckMap.setRadar2dOverlay(manifest, enabled);
    this.radar2dManifest = manifest;
    this.radar2dEnabled = enabled;
  }

  setEchoTopsOverlay(manifest: Radar2dManifest | null, enabled: boolean): void {
    this.deckMap?.setEchoTopsOverlay(manifest, enabled);
    if (manifest) this.radar2dManifest = manifest;
    this.echoTopsEnabled = enabled;
  }

  async setMairesPolitiqueVisible(enabled: boolean): Promise<void> {
    await this.deckMap?.setMairesPolitiqueVisible(enabled);
  }

  setOnRawMapClick(handler: (lat: number, lon: number) => void): void {
    this.onRawMapClick = handler;
    this.deckMap?.setOnRawMapClick(handler);
  }

  // ─── Infrastructure ───
  updateInfrastructure(points: InfrastructurePoint[]): void {
    this.deckMap?.updateInfrastructure(points);
  }

  updateHydraulicBackbone(assets: HydraulicBackboneAsset[]): void {
    this.deckMap?.updateHydraulicBackbone(assets);
  }

  updateEolien(live: EolienLive | null, parks: EolienParkSummary[]): void {
    this.deckMap?.updateEolien(live, parks);
  }

  updateDromEnergy(dashboard: DromEnergyDashboard): void {
    this.dromEnergyData = dashboard;
    this.deckMap?.updateDromEnergy(dashboard);
  }

  highlightDromEnergyAsset(asset: DromEnergyAsset | null): void {
    this.deckMap?.highlightDromEnergyAsset(asset);
  }

  // ─── Événements consolidés (v2) ───

  setEventPoints(points: EventMapPoint[]): void {
    this.deckMap?.setEventPoints(points);
  }

  setOnEventPointClick(handler: ((id: number) => void) | null): void {
    this.deckMap?.setOnEventPointClick(handler);
  }

  // ─── Métropoles ───
  updateMetropoles(data: MetropoleConsumption[]): void {
    this.deckMap?.updateMetropoles(data);
  }

  // ─── Military ───
  // Souveraineté, phase B (tâche B27) : carte WebGL seulement (aucun rendu Souveraineté sur la carte D3 mobile).
  updateGnssLayer(g: GnssResponse | null, now: number): void {
    this.deckMap?.updateGnssLayer(g, now);
  }

  updateDroneZones(file: DroneZonesFile | null): void {
    this.deckMap?.updateDroneZones(file);
  }

  setDroneZonesVisible(on: boolean): void {
    this.deckMap?.setDroneZonesVisible(on);
  }

  updateAirTraffic(flights: AirTrafficFlight[]): void {
    this.deckMap?.updateAirTraffic(flights);
  }

  /**
   * Met à jour le trafic AIS mondial (civils/étrangers).
   * Filtré par bounding box visible pour optimiser le rendu.
   *
   * @param ships - Tous les navires AIS (via getAllLiveTraffic)
   * @param navyMmsiSet - Set des MMSI Marine Nationale (exclus car affichés séparément)
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
    this.deckMap?.updateGlobalTraffic(ships, navyMmsiSet);
  }

  // ─── Outages (Telecom & Power) ───
  async updateOutages(telecoms: TelecomOutage[], powers: PowerOutage[]): Promise<void> {
    await this.deckMap?.updateOutages(telecoms, powers);
  }

  // ─── Internet / BGP outages (IODA) ───
  updateNetworkOutages(state: NetworkOutageState): void {
    this.deckMap?.updateNetworkOutages(state);
  }

  updateCitizenOutageZones(zones: GeoJSON.FeatureCollection): void {
    this.deckMap?.updateCitizenOutageZones(zones);
  }

  updateIIPIncidents(incidents: RTEIIPIncident[]): void {
    this.deckMap?.updateIIPIncidents(incidents);
  }


  highlightPowerDept(deptCode: string | null): void {
    this.deckMap?.highlightPowerDept(deptCode);
  }

  highlightCitizenZone(clusterId: number | null): void {
    this.deckMap?.highlightCitizenZone(clusterId);
  }

  highlightIsp(data: { asn: string; coordinates: [number, number] } | null): void {
    this.deckMap?.highlightIsp(data);
  }

  highlightIoda(data: { id: string; coordinates: [number, number] } | null): void {
    this.deckMap?.highlightIoda(data);
  }

  highlightDc(data: { id: string; coordinates: [number, number] } | null): void {
    this.deckMap?.highlightDc(data);
  }

  highlightIxp(data: { id: string; coordinates: [number, number] } | null): void {
    this.deckMap?.highlightIxp(data);
  }

  // ─── Cloud infra & IXP ───
  updateInfraNetwork(state: InfraNetworkState): void {
    this.deckMap?.updateInfraNetwork(state);
  }

  // ─── Santé (spec 2026-10-03 § 3) ───
  updateHealthAlerts(alerts: AlertLevelsResponse | null, now: number): void {
    this.deckMap?.updateHealthAlerts(alerts, now);
  }

  updateHealthDepartments(syndromic: SyndromicResponse | null, apl: AplDataset | null, now: number): void {
    this.deckMap?.updateHealthDepartments(syndromic, apl, now);
  }

  setHealthUrgencesSyndrome(syndrome: UrgencesSyndrome): void {
    this.deckMap?.setHealthUrgencesSyndrome(syndrome);
  }

  setHealthAplProfession(profession: AplProfession): void {
    this.deckMap?.setHealthAplProfession(profession);
  }

  updateHospitals(data: HospitalsDataset | null): void {
    this.deckMap?.updateHospitals(data);
  }

  focusHospital(site: EmergencySite): void {
    this.deckMap?.focusHospital(site);
  }

  /** Vrai si la carte peut recentrer sur un site d'urgences (carte WebGL ; la carte SVG du mobile ne le fait pas). */
  canFocusHospital(): boolean {
    return !this.isMobile;
  }

  /** Vrai si la carte peut recentrer ou surligner un objet des trafics (carte WebGL ; la carte SVG du mobile ne dessine pas les trafics). */
  canFocusMap(): boolean {
    return !this.isMobile;
  }

  // ─── Layer visibility ───
  setLayerVisibility(layers: MapLayers): void {
    if (layers.dromEnergy) {
      void this.ensureDromEnergyLoaded();
    }
    this.deckMap?.setLayerVisibility(layers);
  }

  async ensureDromEnergyLoaded(): Promise<DromEnergyDashboard | null> {
    if (this.dromEnergyData) {
      this.deckMap?.updateDromEnergy(this.dromEnergyData);
      return this.dromEnergyData;
    }
    if (this.dromEnergyLoadPromise) {
      await this.dromEnergyLoadPromise;
      return this.dromEnergyData;
    }

    this.dromEnergyLoadPromise = (async () => {
      try {
        const dashboard = await fetchDromEnergyDashboard();
        this.dromEnergyData = dashboard;
        this.deckMap?.updateDromEnergy(dashboard);
      } catch (error) {
        console.warn('[MapContainer] Failed to load DROM energy data', error);
      } finally {
        this.dromEnergyLoadPromise = null;
      }
    })();

    await this.dromEnergyLoadPromise;
    return this.dromEnergyData;
  }

  setLegendHover(categoryId: string | null): void {
    this.deckMap?.setLegendHover(categoryId);
  }

  // ─── Events ───
  setOnItemClick(handler: (item: NewsItem) => void): void {
    this.onItemClick = handler;
    this.deckMap?.setOnItemClick(handler);
    this.svgMap?.setOnItemClick(handler);
  }

  setOnItemHover(handler: (item: NewsItem | null, x: number, y: number) => void): void {
    this.onItemHover = handler;
    this.deckMap?.setOnItemHover(handler);
    this.svgMap?.setOnItemHover(handler);
  }


  setOnViewChange(handler: (vs: MapViewState) => void): void {
    this.onViewChange = handler;
    this.deckMap?.setOnViewChange(handler);
  }

  setOnClusterHover(handler: (items: NewsItem[], x: number, y: number, totalCount: number) => void): void {
    this.onClusterHover = handler;
    this.deckMap?.setOnClusterHover(handler);
  }

  setOnClusterClick(handler: (items: NewsItem[], center: [number, number]) => void): void {
    this.onClusterClick = handler;
    this.deckMap?.setOnClusterClick(handler);
  }

  setOnMilitaryBaseClick(handler: (base: MilitaryBase, x: number, y: number) => void): void {
    this.onMilitaryBaseClick = handler;
    this.deckMap?.setOnMilitaryBaseClick(handler);
  }

  setOnSatelliteView(handler: (request: SatelliteViewRequest) => void): void {
    this.onSatelliteView = handler;
    this.deckMap?.setOnSatelliteView(handler);
  }

  project(longitude: number, latitude: number): { x: number; y: number } | null {
    return this.deckMap?.project(longitude, latitude) ?? null;
  }

  setBasemapSatellite(enabled: boolean): void {
    this.deckMap?.setBasemapSatellite(enabled);
  }

  setSentinelSceneOverlay(scene: CopernicusScene | null, _collection?: SatelliteCollection): void {
    this.deckMap?.setSentinelSceneOverlay(scene);
  }

  startSentinelSceneBlink(afterScene: CopernicusScene, beforeScene: CopernicusScene, _collection?: SatelliteCollection): void {
    this.deckMap?.startSentinelSceneBlink(afterScene, beforeScene);
  }

  setHighlightedShip(mmsi: string | null): void {
    this.deckMap?.setHighlightedShip(mmsi);
  }

  setHighlightedInfrastructurePoint(coordinates: [number, number] | null): void {
    this.deckMap?.setHighlightedInfrastructurePoint(coordinates);
  }

  setSelectedShip(mmsi: string | null): void {
    this.deckMap?.setSelectedShip(mmsi);
  }

  selectItem(item: NewsItem | null): void {
    this.deckMap?.selectItem(item);
    this.svgMap?.selectItem(item);
  }

  flyTo(longitude: number, latitude: number, zoom?: number): void {
    this.deckMap?.flyTo(longitude, latitude, zoom);
    this.svgMap?.flyTo(longitude, latitude, zoom);
  }

  fitBounds(bounds: [number, number, number, number], padding?: number): void {
    this.deckMap?.fitBounds(bounds, padding);
  }


  selectWeatherDepartment(departmentCode: string | null): void {
    this.deckMap?.selectWeatherDepartment(departmentCode);
  }

  // ─── ISNR (Stability Index) ───
  async updateISNR(scores: ISNRScore[]): Promise<void> {
    await this.deckMap?.updateISNR(scores);
  }

  highlightISNRDepartment(departmentCode: string | null): void {
    this.deckMap?.highlightISNRDepartment(departmentCode);
  }

  // ─── Trafics (spec 2026-10-03 trafics § 3) ───
  updateRoadTraffic(national: RoadNationalResponse | null, urban: RoadUrbanResponse | null, now: number): void {
    this.deckMap?.updateRoadTraffic(national, urban, now);
  }

  updateAirOverview(overview: AirOverviewResponse | null, now: number): void {
    this.deckMap?.updateAirOverview(overview, now);
  }

  updateRailTraffic(overview: RailOverviewResponse | null, now: number): void {
    this.deckMap?.updateRailTraffic(overview, now);
  }

  updateMaritimeSnapshot(snapshot: MaritimeSnapshot | null, now: number): void {
    this.deckMap?.updateMaritimeSnapshot(snapshot, now);
  }

  highlightTrainRoute(train: RailTrain | null): void {
    this.deckMap?.highlightTrainRoute(train);
  }

  /** Survol d'un train dans le panneau ferroviaire : trajet provisoire ; null rend celui du train choisi. */
  previewTrainRoute(train: RailTrain | null): void {
    this.deckMap?.previewTrainRoute(train);
  }

  // ─── Environnement (spec 2026-10-04 environnement § 2 ; contrats § 5) ───
  async updateVigilanceLayer(v: VigilanceResponse | null, echeance: VigilanceEcheance, now: number): Promise<void> {
    await this.deckMap?.updateVigilanceLayer(v, echeance, now);
  }

  updateFloodsLayer(f: FloodsResponse | null, now: number): void {
    this.deckMap?.updateFloodsLayer(f, now);
  }

  highlightFloodSection(id: string | null): void {
    this.deckMap?.highlightFloodSection(id);
  }

  // ─── Environnement, phase B ───
  updateDroughtLayer(d: DroughtResponse | null, now: number): Promise<void> {
    return this.deckMap?.updateDroughtLayer(d, now) ?? Promise.resolve();
  }

  updateAirQualityLayer(a: AirQualityResponse | null, now: number): Promise<void> {
    return this.deckMap?.updateAirQualityLayer(a, now) ?? Promise.resolve();
  }

  updateEarthquakesLayer(q: EarthquakesResponse | null, now: number): void {
    this.deckMap?.updateEarthquakesLayer(q, now);
  }

  updateSeaLevelsLayer(s: SeaLevelsResponse | null, v: VigilanceResponse | null, now: number): void {
    this.deckMap?.updateSeaLevelsLayer(s, v, now);
  }

  focusFloodSection(id: string): void {
    this.deckMap?.focusFloodSection(id);
  }

  updateFiresLayer(f: FiresResponse | null, now: number, opts: { forestDangerFill: boolean }): void {
    this.deckMap?.updateFiresLayer(f, now, opts);
  }

  highlightFoyer(id: string | null): void {
    this.deckMap?.highlightFoyer(id);
  }

  setRadarPick(point: { lat: number; lon: number } | null): void {
    this.radarPick = point;
    this.deckMap?.setRadarPick(point);
  }

  setOnRadarPointPick(handler: (lat: number, lon: number) => void): void {
    this.onRadarPointPick = handler;
    this.deckMap?.setOnRadarPointPick(handler);
  }

  // ─── Souveraineté (spec 2026-10-04 souveraineté § 2 ; contrats § 5) : carte WebGL seulement (mobile : aucun rendu, comme avant) ───
  updateMilitaryLayer(m: MilitaryResponse | null, now: number): void {
    this.deckMap?.updateMilitaryLayer(m, now);
  }

  updateNavyLayer(ships: readonly MilitaryShip[], frozen: boolean, now: number): void {
    this.deckMap?.updateNavyLayer(ships, frozen, now);
  }

  updateDefenseSites(bases: readonly MilitaryBase[]): void {
    this.deckMap?.updateDefenseSites(bases);
  }

  updateOsmWorks(file: DefenseOsmWorksFile | null): void {
    this.deckMap?.updateOsmWorks(file);
  }

  setOsmWorksVisible(on: boolean): void {
    this.deckMap?.setOsmWorksVisible(on);
  }

  updateCablesLayer(file: SubseaCablesFile | null, watch: CablesWatchResponse | null, now: number): void {
    this.deckMap?.updateCablesLayer(file, watch, now);
  }

  highlightCable(id: string | null): void {
    this.deckMap?.highlightCable(id);
  }

  setOnSovereigntyFeatureClick(handler: (layerId: string, props: Record<string, unknown>) => void): void {
    this.onSovereigntyFeatureClick = handler;
    this.deckMap?.setOnSovereigntyFeatureClick(handler);
  }

  destroy(): void {
    this.deckMap?.destroy();
    this.deckMap = null;
    this.svgMap?.destroy();
    this.svgMap = null;
  }
}
