/**
 * MapContainer.ts — Wrapper qui choisit DeckGLMap (desktop) ou Map (mobile).
 * Expose toutes les méthodes de calques unifié.
 */

import type { DeckGLMap } from './DeckGLMap.ts';
import { Map as SVGMap } from './Map.ts';
import type { FeatureCollection } from 'geojson';
import type { NewsItem, EcowattResponse, FuelTensionDashboard, MeteoAlert, FloodSegment, InfrastructurePoint, MapLayers, MapViewState, RestrictedZone, MilitaryBase, MilitaryFlight, AirTrafficFlight, ActiveFire, TelecomOutage, PowerOutage, ISNRScore, HealthRegionMetric, HealthDepartmentMetric, HealthFeatures, GasNetworkState, NetworkOutageState, InfraNetworkState, SatelliteViewRequest, RailNetworkData, TransportDisruption, HydraulicBackboneAsset, ThreatEvent } from '../types/index.ts';
import type { MilitaryShip } from '../services/military-ships.ts';
import type { RTEIIPIncident } from '../services/rte-iip.ts';
import type { TrafficSegment } from '../config/mock-data.ts';
import type { TrafficIncident } from '../services/traffic.ts';
import type { MetropoleConsumption } from '../services/metropoles.ts';
import type { CopernicusScene, SatelliteCollection } from '../types/index.ts';
import type { EolienLive, EolienParkSummary } from '../services/eolien/types.ts';
import { fetchDromEnergyDashboard, type DromEnergyAsset, type DromEnergyDashboard } from '../services/drom-energy/index.ts';
import type { Radar2dManifest } from '../services/radar-2d.ts';

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
  private onMilitaryFlightClick: ((flight: MilitaryFlight, x: number, y: number) => void) | null = null;
  private onMilitaryBaseClick: ((base: MilitaryBase, x: number, y: number) => void) | null = null;
  private onMilitaryShipClick: ((ship: { id: string; name: string; type: string; role: string; mmsi?: string; lat: number; lon: number; speed?: number; heading?: number; port?: string; isLive?: boolean }, x: number, y: number) => void) | null = null;
  private _onMaritimeShipClickCb: ((ship: MilitaryShip, x: number, y: number) => void) | null = null;
  private onRawMapClick: ((lat: number, lon: number) => void) | null = null;
  private onSatelliteView: ((request: SatelliteViewRequest) => void) | null = null;
  private onThreatEventClick: ((event: ThreatEvent, x: number, y: number) => void) | null = null;
  private dromEnergyData: DromEnergyDashboard | null = null;
  private dromEnergyLoadPromise: Promise<void> | null = null;
  private radar2dManifest: Radar2dManifest | null = null;
  private radar2dEnabled = false;
  private echoTopsEnabled = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.isMobile = isMobileDevice();
  }

  async init(): Promise<void> {
    if (this.isMobile) {
      this.svgMap = new SVGMap(this.container);
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
    if (this.onMilitaryFlightClick) this.deckMap.setOnMilitaryFlightClick(this.onMilitaryFlightClick);
    if (this.onMilitaryBaseClick) this.deckMap.setOnMilitaryBaseClick(this.onMilitaryBaseClick);
    if (this.onMilitaryShipClick) this.deckMap.setOnMilitaryShipClick(this.onMilitaryShipClick);
    if (this._onMaritimeShipClickCb) this.deckMap.setOnMaritimeShipClick(this._onMaritimeShipClickCb);
    if (this.onRawMapClick) this.deckMap.setOnRawMapClick(this.onRawMapClick);
    if (this.onSatelliteView) this.deckMap.setOnSatelliteView(this.onSatelliteView);
    if (this.onThreatEventClick) this.deckMap.setOnThreatEventClick(this.onThreatEventClick);
    await this.deckMap.init();
    await this.deckMap.setRadar2dOverlay(this.radar2dManifest, this.radar2dEnabled);
    this.deckMap.setEchoTopsOverlay(this.radar2dManifest, this.echoTopsEnabled);
    console.log('[MapContainer] Desktop map (MapLibre) initialized');
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

  // ─── Weather ───
  async updateWeather(alerts: MeteoAlert[]): Promise<void> {
    await this.deckMap?.updateWeather(alerts);
  }

  async refreshWeatherRadar(force = true): Promise<void> {
    await this.deckMap?.refreshWeatherRadar(force);
  }

  // ─── Floods ───
  updateFloods(segments: FloodSegment[]): void {
    this.deckMap?.updateFloods(segments);
  }

  updateTopageVisual(geojson: FeatureCollection): void {
    this.deckMap?.updateTopageVisual(geojson);
  }

  /** [minLng, minLat, maxLng, maxLat] de la vue courante, ou null. */
  getBounds(): [number, number, number, number] | null {
    return this.deckMap?.getBounds() ?? null;
  }

  getViewState(): MapViewState | null {
    return this.deckMap?.getViewState() ?? null;
  }

  highlightFloodSegment(segmentId: string | null): void {
    this.deckMap?.highlightFloodSegment(segmentId);
  }

  // ─── Fires ───
  updateFires(fires: ActiveFire[]): void {
    this.deckMap?.updateFires(fires);
  }

  highlightFire(lat: number, lon: number): void {
    this.deckMap?.highlightFire(lat, lon);
  }

  clearFireHighlight(): void {
    this.deckMap?.clearFireHighlight();
  }

  /** Highlight tous les points d'un cluster incident DBSCAN sur la carte. */
  highlightFireCluster(points: { lat: number; lon: number }[]): void {
    this.deckMap?.highlightFireCluster(points);
  }

  setFirePointsVisible(enabled: boolean): void {
    this.deckMap?.setFirePointsVisible(enabled);
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

  // ─── Traffic ───
  updateTraffic(_segments: TrafficSegment[]): void {
    // DeckGL map uses TomTom tiles, basemap mask handles France clipping
    this.deckMap?.updateTraffic();
  }

  updateTrafficIncidents(incidents: TrafficIncident[]): void {
    this.deckMap?.updateTrafficIncidents(incidents);
  }

  // ─── Métropoles ───
  updateMetropoles(data: MetropoleConsumption[], nationalLoadMW?: number): void {
    this.deckMap?.updateMetropoles(data, nationalLoadMW);
  }

  // ─── Military ───
  updateMilitaryZones(zones: RestrictedZone[]): void {
    this.deckMap?.updateMilitaryZones(zones);
  }

  updateMilitaryBases(bases: MilitaryBase[]): void {
    this.deckMap?.updateMilitaryBases(bases);
  }

  updateMilitaryFlights(flights: MilitaryFlight[]): void {
    this.deckMap?.updateMilitaryFlights(flights);
  }

  updateAirTraffic(flights: AirTrafficFlight[]): void {
    this.deckMap?.updateAirTraffic(flights);
  }

  updateMilitaryShips(ships: Array<{ id: string; name: string; type: string; role: string; mmsi?: string; lat: number; lon: number; speed?: number; heading?: number; port?: string; isLive?: boolean }>): void {
    this.deckMap?.updateMilitaryShips(ships);
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

  updateTerminator(geojson: GeoJSON.FeatureCollection): void {
    this.deckMap?.updateTerminator(geojson);
  }

  updateDayNightOptions(opts: {
    showNight?: boolean;
    showTwilight?: boolean;
    showSunIcon?: boolean;
    timestamp?: number;
  }): void {
    this.deckMap?.updateDayNightOptions(opts);
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

  // ─── Health (Santé — ISS) ───
  updateHealth(regions: HealthRegionMetric[], healthFeatures?: HealthFeatures, departments?: HealthDepartmentMetric[]): void {
    this.deckMap?.updateHealth(regions, healthFeatures, departments);
  }

  // ─── Hospitals (FINESS) ───
  updateHospitals(hospitals: GeoJSON.FeatureCollection<GeoJSON.Point>): void {
    this.deckMap?.updateHospitals(hospitals);
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

  setOnMilitaryFlightClick(handler: (flight: MilitaryFlight, x: number, y: number) => void): void {
    this.onMilitaryFlightClick = handler;
    this.deckMap?.setOnMilitaryFlightClick(handler);
  }

  setOnMilitaryBaseClick(handler: (base: MilitaryBase, x: number, y: number) => void): void {
    this.onMilitaryBaseClick = handler;
    this.deckMap?.setOnMilitaryBaseClick(handler);
  }

  setOnMilitaryShipClick(handler: (ship: { id: string; name: string; type: string; role: string; mmsi?: string; lat: number; lon: number; speed?: number; heading?: number; port?: string; isLive?: boolean }, x: number, y: number) => void): void {
    this.onMilitaryShipClick = handler;
    this.deckMap?.setOnMilitaryShipClick(handler);
  }

  setOnMaritimeShipClick(cb: (ship: MilitaryShip, x: number, y: number) => void): void {
    this._onMaritimeShipClickCb = cb;
    this.deckMap?.setOnMaritimeShipClick(cb);
  }

  setOnSatelliteView(handler: (request: SatelliteViewRequest) => void): void {
    this.onSatelliteView = handler;
    this.deckMap?.setOnSatelliteView(handler);
  }

  setOnThreatEventClick(handler: (event: ThreatEvent, x: number, y: number) => void): void {
    this.onThreatEventClick = handler;
    this.deckMap?.setOnThreatEventClick(handler);
  }

  updateThreatEvents(events: ThreatEvent[]): void {
    this.deckMap?.updateThreatEvents(events);
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

  getHealthFeatures(): HealthFeatures | null {
    if (this.deckMap) return this.deckMap.getHealthFeatures();
    return null;
  }

  flyTo(longitude: number, latitude: number, zoom?: number): void {
    this.deckMap?.flyTo(longitude, latitude, zoom);
    this.svgMap?.flyTo(longitude, latitude, zoom);
  }

  fitBounds(bounds: [number, number, number, number], padding?: number): void {
    this.deckMap?.fitBounds(bounds, padding);
  }

  highlightWeatherDepartment(departmentCode: string | null): void {
    this.deckMap?.highlightWeatherDepartment(departmentCode);
  }

  previewWeatherDepartment(departmentCode: string | null): void {
    this.deckMap?.previewWeatherDepartment(departmentCode);
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

  highlightTrainRoute(disruption: TransportDisruption | null): void {
    this.deckMap?.highlightTrainRoute(disruption);
  }

  updateRailNetwork(data: RailNetworkData): void {
    this.deckMap?.updateRailNetwork(data);
  }

  destroy(): void {
    this.deckMap?.destroy();
    this.deckMap = null;
    this.svgMap?.destroy();
    this.svgMap = null;
  }
}
