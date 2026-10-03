// tests/traffic-map-wiring.test.ts
// Carte des Trafics (spec 2026-10-03 trafics § 3) : DeckGLMap.ts, MapContainer.ts et App.ts ne s'instancient pas sous vitest ;
// ces tests lisent leur source, comme tests/health-map-wiring.test.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const deck = read('src/components/DeckGLMap.ts');
const container = read('src/components/MapContainer.ts');
const app = read('src/App.ts');
const constants = read('src/components/deckgl/constants.ts');
const css = read('src/styles/main.css');

describe('DeckGLMap : couches Trafics réécrites', () => {
  it('anciennes couches, grappes, popups et fiche de gare retirées', () => {
    for (const gone of [/\bSRC_TRAFFIC_INCIDENTS\b/, /\bLYR_TRAFFIC_CLUSTER/, /\bLYR_TRAFFIC_INCIDENTS\b/, /\bSRC_RAIL_ARCS\b/, /\bLYR_RAIL_ARC/,
      /\bLYR_RAIL_STATION_GLOW\b/, /RAIL_SEVERITY_/, /\bLYR_AIR_TRAFFIC_LABEL\b/, /updateTrafficIncidents/, /syncTrafficIncidentSource/,
      /trafficClusterIndex/, /roadTrafficIncidents/, /roadTrafficVisible/, /deck-road-incidents/, /handleRoadIncident/, /\bTrafficIncident\b/,
      /showTrafficIncidentPopupResolved/, /buildTrafficIncidentPopupHtml/, /trafficIncidentPopup/, /updateRailNetwork/, /RailNetworkData/,
      /TransportDisruption/, /railStationPanel/, /openRailStationPopup/, /renderRailStationPopupPage/, /buildRailArcHoverHtml/,
      /buildRailStationHoverHtml/, /parseRailStationDisruptionSummaries/, /formatRailDateTime/, /generateCurvedLine/, /getAirTrafficColorHex/,
      /services\/traffic\.ts/, /airplanes\.live/]) {
      expect(deck).not.toMatch(gone);
      expect(container).not.toMatch(gone);
    }
    expect(constants).not.toMatch(/SRC_TRAFFIC_INCIDENTS|LYR_TRAFFIC_CLUSTER|LYR_TRAFFIC_INCIDENTS|SRC_RAIL_ARCS|LYR_RAIL_ARC|RAIL_SEVERITY_|LYR_AIR_TRAFFIC_LABEL/);
    expect(css).not.toMatch(/rail-station-detail|rail-detail-|rail-train-chip/);
  });
  it('sources et couches de deckgl/traffic-map.ts ; visibilité par couche ; trajet du train dans la couleur portée', () => {
    expect(deck).toContain('for (const id of TRAFFIC_SOURCE_IDS) this.map.addSource(id, trafficSourceSpec());');
    expect(deck).toContain('for (const layer of TRAFFIC_LAYERS) this.map.addLayer(layer);');
    expect(deck).toContain("'line-color': TRAFFIC_COLOR,");
    expect(deck).toContain("'circle-color': TRAFFIC_COLOR,");
    for (const key of ['trafficRoad', 'trafficAir', 'trafficMaritime']) {
      expect(deck).toContain(`for (const id of TRAFFIC_LAYER_KEYS.${key}) this.setVis(id, vis(layers.${key}));`);
    }
    expect(deck).toContain('for (const id of TRAFFIC_LAYER_KEYS.trafficRail) this.setVis(id, railVis);');
    expect(deck).toContain('this.setVis(LYR_TRAFFIC, vis(layers.trafficRoad));');
  });
  it('mises à jour datées : route, aérien, rail, maritime ; trajet d’un train', () => {
    for (const sig of ['updateRoadTraffic(national: RoadNationalResponse | null, urban: RoadUrbanResponse | null, now: number): void',
      'updateAirOverview(overview: AirOverviewResponse | null, now: number): void',
      'updateRailTraffic(overview: RailOverviewResponse | null, now: number): void',
      'updateMaritimeSnapshot(snapshot: MaritimeSnapshot | null, now: number): void', 'highlightTrainRoute(train: RailTrain | null): void',
      'previewTrainRoute(train: RailTrain | null): void']) {
      expect(deck).toContain(sig);
      expect(container).toContain(sig);
    }
    // Survol d'un train : trajet provisoire, puis retour au train choisi ; retard relu à chaque relève SNCF ; train absent de la
    // nouvelle donnée : trajet effacé par la carte elle-même.
    expect(deck).toContain('const train = this.previewTrain ?? this.chosenTrain;');
    expect(deck).toContain('this.chosenTrain = fresh(this.chosenTrain);');
    expect(deck).toContain('const fresh = (t: RailTrain | null): RailTrain | null => (t ? overview?.trains.find((x) => x.id === t.id) ?? null : null);');
    for (const call of ['traficolorFeatures(national, now)', 'urbanJamFeatures(urban, now)', 'roadEventFeatures(national, now)',
      'airportFeatures(overview, now)', 'airEmergencyFeatures(overview, now)', 'railStationFeatures(overview, now)', 'anchorageFeatures(snapshot, now)',
      'maritimeSignalFeatures(snapshot, now)', 'trainRouteFeatures(train, this.railTrafficLate)', 'this.railTrafficLate = railOverviewLate(overview, now);']) {
      expect(deck).toContain(call);
    }
  });
  it('avions : icônes à partir du zoom 7, une teinte, infobulle échappée ; densité en dessous', () => {
    expect(deck).toContain('visible: this.airTrafficVisible && this.airIconsShown,');
    expect(deck).toContain('getIcon: () => this.getAirTrafficIconDef(AIR_ICON_HEX),');
    expect(deck).toContain('this.showMilitaryTooltip(lngLat, airFlightTooltipHtml(flight));');
    expect(deck).toContain('const airIcons = this.viewState.zoom >= AIR_ICON_MIN_ZOOM;');
    expect(deck).toContain('this.airIconsShown = this.viewState.zoom >= AIR_ICON_MIN_ZOOM;');
  });
  it('avions sous le zoom 7 : aucune animation des positions (pas de reconstruction des couches à chaque image), reprise dès le zoom 7', () => {
    expect(deck).toContain('if (shouldTweenAirPositions(hadPreviousData, this.airTrafficVisible, this.viewState.zoom)) {');
    expect(deck).not.toMatch(/if \(hadPreviousData\) \{\s*this\.startCivilAirTween\(\);/);
    expect(deck.split('this.startCivilAirTween();').length - 1).toBe(1);
    expect(deck).toMatch(/if \(!airIcons\) \{\s*\/\/[^\n]*\n\s*this\.stopCivilAirTween\(\);\s*this\.refreshCivilAirTrafficSource\(\);/);
    expect(deck).toContain('if (!this.airTrafficVisible || !this.airIconsShown) this.stopCivilAirTween();');
    // Source de la densité : la position et l'identifiant seulement.
    expect(deck).toContain('properties: { id: flight.id },');
  });
  it('navires : sillages et noms mémorisés sur l’identité des données (deck.gl ne régénère rien sans changement)', () => {
    expect(deck).toContain('const maritimeLabelData = this.getAisLabelData();');
    expect(deck).toContain('data: maritimeTrailData,');
    expect(deck).toContain('if (this.aisTrailCache?.source !== source) {');
    expect(deck).not.toMatch(/this\.globalTrafficData\.filter\(/);
  });
  it('survol : couche visible du dessus ; clic sur un bouchon : vitesse du tronçon par le gestionnaire budgété', () => {
    expect(deck).toContain('this.initTrafficInteractions();');
    expect(deck).toContain('const hit = topTrafficHit(visible.length > 0 ? map.queryRenderedFeatures(e.point, { layers: visible }) : []);');
    expect(deck).toContain('const html = hit ? trafficTooltipHtml(hit.layer.id, hit.properties ?? {}) : null;');
    expect(deck).toContain('for (const id of TRAFFIC_JAM_LAYERS) {');
    expect(deck).toContain('const flow = await fetchTrafficFlowSegment(lat, lon, this.map?.getZoom() ?? 10);');
    expect(deck).toContain('.setHTML(jamPopupHtml(body, flow))');
    expect(deck).toContain("import { fetchTrafficFlowSegment } from '../services/traffic-road.ts';");
  });
  it('navires : teinte, sillage, libellé et icône par le classement du serveur (byType) ; navire survolé ou choisi inchangé', () => {
    expect(deck).toContain('return vesselHex(getShipTypeNumber(d), d.navStatus);');
    expect(deck).toContain('getColor: getAisTrailColor,');
    expect(deck).toContain("const typeLabel = fishingByStatus ? 'Pêche (statut)' : vesselTypeLabel(category);");
    expect(deck).toContain("if (d.mmsi && d.mmsi === this._highlightedMmsi) return '#ffffff';");
    expect(deck).toContain("if (d.mmsi && d.mmsi === this._selectedShipMmsi) return '#5ac8fa';");
    expect(deck).not.toMatch(/t === 30 \|\| t === 31|t === 55 \|\| t === 51|getShipTypeLabel/);
  });
  it('survol de légende : une catégorie par couche Trafics, rail compris', () => {
    expect(deck).toContain('activeLayers = [LYR_TRAFFIC, ...TRAFFIC_LAYER_KEYS.trafficRoad];');
    expect(deck).toContain('activeLayers = [...TRAFFIC_LAYER_KEYS.trafficAir];');
    expect(deck).toContain('activeLayers = [...TRAFFIC_LAYER_KEYS.trafficRail, LYR_TRAIN_ROUTE, LYR_TRAIN_STATIONS];');
    expect(deck).toContain('activeLayers = [...TRAFFIC_LAYER_KEYS.trafficMaritime];');
    // Contours colorés (anneau des signalements, aéroports, mouillages, urgences, arrêts) atténués avec leur couche.
    expect(deck).toContain('for (const layerId of TRAFFIC_STROKE_DIM_LAYERS) {');
    expect(deck).toContain("this.originalOpacities.set(key, { prop: 'circle-stroke-opacity', orig: this.map.getPaintProperty(layerId, 'circle-stroke-opacity') ?? 1 });");
  });
});

describe('App.ts : carte et légendes Trafics nourries par les chargeurs', () => {
  it('chaque chargeur envoie sa donnée datée à la carte et à la légende ; train choisi tracé', () => {
    for (const line of [
      'this.mapContainer?.updateRoadTraffic(state.national.data, state.urban.data, now);',
      'this.mapLegend?.addCategory(roadLegend(state.national.data, state.urban.data, now));',
      'this.mapContainer?.updateAirOverview(state.overview.data, now);',
      'this.mapLegend?.addCategory(airLegend(state.overview.data, now));',
      'this.mapContainer?.updateRailTraffic(state.overview.data, now);',
      'this.mapLegend?.addCategory(railLegend(state.overview.data, state.situations.data, now));',
      'this.mapContainer?.updateMaritimeSnapshot(state.snapshot.data, now);',
      'this.mapLegend?.addCategory(maritimeLegend(state.snapshot.data, now));',
      'this.mapContainer?.highlightTrainRoute(train);',
    ]) expect(app).toContain(line);
  });
  it('légendes de base importées, légende ferroviaire ajoutée et pilotée avec sa couche', () => {
    expect(app).toContain("} from './components/layer-panel/traffic-legend.ts';");
    expect(app).not.toMatch(/const (ROAD|AIR|MARITIME)_TRAFFIC_LEGEND: LegendCategory/);
    expect(app).toContain('legend: RAIL_TRAFFIC_LEGEND,');
    expect(app).toContain('this.mapLegend.addCategory(RAIL_TRAFFIC_LEGEND);');
    expect(app).toContain("this.mapLegend.setCategoryVisibility('trafficRail', this.activeLayers.traffic && this.activeLayers.trafficRail);");
    expect(app).not.toMatch(/Rail legend lives in TransportPanel|Trafic aérien civil|OpenSky \/ airplanes\.live|Temps réel WebSocket/);
  });
});
