// src/components/deckgl/traffic-map.test.ts
import { describe, expect, it } from 'vitest';
import type { AirEmergency, AirTrafficFlight, MaritimeSignal } from '../../types/index.ts';
import { levelHex } from '../../services/vigilance.ts';
import { NBSP, visibleText } from '../layer-panel/format.ts';
import { SQUAWK_LEVEL, trafficBreakable } from '../layer-panel/traffic-format.ts';
import { CAT_AIRPORT_HEX, CAT_PORT_HEX, TRAFFIC_NEUTRAL_HEX } from '../layer-panel/traffic-legend.ts';
import {
  TRAFFIC_NOW, airOverviewFixture, maritimeSnapshotFixture, paris, railOverviewFixture, roadNationalFixture, roadUrbanFixture,
} from '../layer-panel/traffic.fixture.ts';
import {
  LYR_AIRPORTS, LYR_AIR_EMERGENCIES, LYR_AIR_EMERGENCY_LABEL, LYR_AIS_SIGNALS, LYR_ANCHORAGES, LYR_RAIL_STATION, LYR_ROAD_EVENTS, LYR_ROAD_JAMS, LYR_ROAD_JAM_POINTS,
  LYR_ROAD_SECTIONS, LYR_TRAIN_STATIONS,
} from './constants.ts';
import {
  AIR_TWEEN_MIN_ZOOM, PORT_COORDS, TRAFFIC_COLOR, TRAFFIC_HOVER_LAYERS, TRAFFIC_JAM_LAYERS, TRAFFIC_LAYERS, TRAFFIC_LAYER_KEYS,
  TRAFFIC_SOURCE_IDS, TRAFFIC_STROKE_DIM_LAYERS, airEmergencyFeatures, airEmergencyLevel, airFlightTooltipHtml, airportFeatures, airportRadius, anchorageFeatures, jamPopupHtml,
  maritimeSignalFeatures, railOverviewLate, railStationFeatures, roadEventFeatures, roadEventSortKey, topTrafficHit, trafficHex,
  shouldTweenAirPositions, trafficTooltipHtml, traficolorFeatures, trainRouteFeatures, urbanJamFeatures,
} from './traffic-map.ts';

const LATE = TRAFFIC_NOW + 2 * 3_600_000;
const props = (f: GeoJSON.Feature): Record<string, unknown> => f.properties ?? {};
const body = (f: GeoJSON.Feature): string => String(props(f)['body'] ?? '');
const allNeutral = (fc: GeoJSON.FeatureCollection): boolean => fc.features.length > 0 && fc.features.every((f) => props(f)['color'] === TRAFFIC_NEUTRAL_HEX);

describe('couleurs de la carte', () => {
  it('palette L1 ; donnée en retard (S2) ou niveau gris : teinte neutre ; couleur portée par chaque objet', () => {
    expect(trafficHex('rouge', false)).toBe(levelHex('rouge'));
    expect(trafficHex('rouge', true)).toBe(TRAFFIC_NEUTRAL_HEX);
    expect(trafficHex('gris', false)).toBe(TRAFFIC_NEUTRAL_HEX);
    expect(TRAFFIC_COLOR).toEqual(['coalesce', ['get', 'color'], TRAFFIC_NEUTRAL_HEX]);
  });
});

describe('route (§ 3.1)', () => {
  it('événements DIR géolocalisés, couleur du type ; accidents et coupures au premier plan', () => {
    const fc = roadEventFeatures(roadNationalFixture(), TRAFFIC_NOW);
    expect(fc.features.map((f) => props(f)['id'])).toEqual(['acc-a55', 'acc-a86', 'acc-n10-yrieix', 'acc-n10-vignolles', 'queue-a7', 'closure-a63', 'gravel-flumet']);
    const byId = new Map(fc.features.map((f) => [props(f)['id'], props(f)]));
    expect(byId.get('acc-a55')?.['color']).toBe(levelHex('rouge'));
    expect(byId.get('closure-a63')?.['color']).toBe(levelHex('orange'));
    expect(byId.get('gravel-flumet')?.['color']).toBe(levelHex('jaune'));
    expect([byId.get('closure-a63')?.['radius'], byId.get('queue-a7')?.['radius']]).toEqual([7, 5]);
    expect([roadEventSortKey('accident'), roadEventSortKey('closure'), roadEventSortKey('queue'), roadEventSortKey('works')]).toEqual([100, 99, 89, 84]);
    expect(fc.features[0].geometry.coordinates).toEqual([5.321, 43.371]);
  });
  it('infobulle d’un événement : type, route et lieu, heure, sens, DIR ; texte hostile échappé ; en retard : neutre et dit', () => {
    const n = roadNationalFixture();
    n.events[0].place = '<img src=x onerror=1>';
    const html = body(roadEventFeatures(n, TRAFFIC_NOW).features[0]);
    expect(html).toContain('<b>Accident</b>');
    expect(html).toContain('A55, &lt;img src=x onerror=1&gt;');
    expect(html).not.toContain('<img');
    for (const part of ['Depuis', '14:44', 'vers Marseille', 'DIR Méditerranée']) expect(html).toContain(part);
    const late = roadEventFeatures(roadNationalFixture(), LATE);
    expect(allNeutral(late)).toBe(true);
    expect(body(late.features[0])).toContain('Données DIR en retard : couleur retirée.');
  });
  it('bouchons TomTom : tracé, couleur de magnitude, valeurs insécables ; clic : vitesse du tronçon ou « indisponible »', () => {
    const fc = urbanJamFeatures(roadUrbanFixture(), TRAFFIC_NOW);
    expect(fc.features).toHaveLength(4);
    const first = fc.features[0];
    expect(first.geometry).toEqual({ type: 'LineString', coordinates: [[2.18, 48.877], [2.205, 48.905], [2.227, 48.922]] });
    expect(props(first)).toMatchObject({ color: levelHex('rouge'), width: 4, lat: 48.905, lon: 2.205 });
    expect(props(fc.features[3])['color']).toBe(levelHex('jaune'));
    const html = body(first);
    for (const part of ['Bouchon · A86', 'Rueil-Malmaison vers Colombes', `3,6${NBSP}km`, `+24${NBSP}min`, '12:42', 'TomTom']) expect(html).toContain(part);
    expect(trafficTooltipHtml(LYR_ROAD_JAMS, props(first))).toContain('Clic : vitesse du tronçon.');
    const flow = { currentSpeed: 23, freeFlowSpeed: 70, currentTravelTime: 300, freeFlowTravelTime: 100, confidence: 1, roadClosure: false };
    expect(jamPopupHtml(html, flow)).toContain(`23${NBSP}km/h`);
    expect(jamPopupHtml(html, flow)).toContain(`70${NBSP}km/h`);
    expect(jamPopupHtml(html, flow)).toContain(`Temps de parcours</span><span>5${NBSP}min (sans trafic : 1,7${NBSP}min)`);
    expect(jamPopupHtml(html, { ...flow, currentTravelTime: 45, freeFlowTravelTime: 30 })).toContain(`45${NBSP}s (sans trafic : 30${NBSP}s)`);
    expect(jamPopupHtml(html, null)).toContain('Vitesse du tronçon indisponible.');
    expect(allNeutral(urbanJamFeatures(roadUrbanFixture(), LATE))).toBe(true);
  });
  it('sections Traficolor : saturé rouge, dense orange, fluide vert, inconnue non dessinée ; fichier en retard : neutre', () => {
    const fc = traficolorFeatures(roadNationalFixture(), TRAFFIC_NOW);
    expect(fc.features.map((f) => [props(f)['id'], props(f)['color']])).toEqual([
      ['Lyon-A7-12', levelHex('rouge')], ['Lyon-A7-13', levelHex('orange')], ['Marius-A50-04', levelHex('vert')],
    ]);
    for (const part of ['<b>Lyon</b>', 'Saturé', 'fichier de 15:06']) expect(body(fc.features[0])).toContain(part);
    expect(body(fc.features[2])).toContain('<b>Marseille</b>');
    expect(allNeutral(traficolorFeatures(roadNationalFixture(), Date.parse('2026-10-03T13:40:00Z')))).toBe(true);
  });
});

describe('aérien (§ 3.2)', () => {
  const emergency = (over: Partial<AirEmergency> = {}): AirEmergency => ({
    icao24: '3c6444', callsign: 'AFR123', squawk: '7700', lat: 46.2, lon: 2.1, altitudeM: 3200, firstSeen: paris('15:01'),
    lastSeen: paris('15:09'), overFrance: true, ...over,
  });
  it('urgences : couleur du panneau et de la pastille (7500 rouge, 7700 orange, 7600 jaune, hors territoire gris), indicatif, infobulle échappée', () => {
    expect(airEmergencyFeatures(airOverviewFixture(), TRAFFIC_NOW).features).toHaveLength(0);
    const o = airOverviewFixture();
    o.emergencies = [
      emergency({ callsign: '<b>X</b>' }), emergency({ callsign: null, squawk: '7600', icao24: 'abc123' }),
      emergency({ callsign: 'HIJ1', squawk: '7500' }), emergency({ callsign: 'AWAY1', overFrance: false }),
      emergency({ callsign: 'AWAY2', squawk: '7500', overFrance: false }),
    ];
    const fc = airEmergencyFeatures(o, TRAFFIC_NOW);
    expect(fc.features.map((f) => [props(f)['label'], props(f)['color']])).toEqual([
      ['<b>X</b>', levelHex('orange')], ['ABC123', levelHex('jaune')], ['HIJ1', levelHex('rouge')], ['AWAY1', TRAFFIC_NEUTRAL_HEX],
      ['AWAY2', TRAFFIC_NEUTRAL_HEX],
    ]);
    for (const e of o.emergencies) expect(airEmergencyLevel(e)).toBe(e.overFrance ? SQUAWK_LEVEL[e.squawk] : 'gris');
    const html = body(fc.features[0]);
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(html).toContain('7700 · urgence');
    expect(html).toContain(`3\u202F200${NBSP}m`);
    expect(html).not.toMatch(/hors territoire/i);
    expect(body(fc.features[1])).toContain('7600 · panne radio');
    expect(body(fc.features[3])).toContain('Hors territoire et approches');
    expect(allNeutral(airEmergencyFeatures(o, LATE))).toBe(true);
  });
  it('animation des positions des avions : couche active, zoom 7 ou plus et relevé précédent ; sous le zoom 7, positions posées', () => {
    expect(AIR_TWEEN_MIN_ZOOM).toBe(7);
    expect(shouldTweenAirPositions(true, true, AIR_TWEEN_MIN_ZOOM)).toBe(true);
    expect(shouldTweenAirPositions(true, true, 9.5)).toBe(true);
    expect(shouldTweenAirPositions(true, true, 6.99)).toBe(false);
    expect(shouldTweenAirPositions(true, false, 9)).toBe(false);
    expect(shouldTweenAirPositions(false, true, 9)).toBe(false);
  });
  it('aéroports placés par leurs coordonnées, surface selon les départs, jeton de catégorie ; annuaires de Beauvais et Bordeaux', () => {
    const fc = airportFeatures(airOverviewFixture(), TRAFFIC_NOW);
    expect(fc.features).toHaveLength(9);
    const cdg = fc.features[0];
    expect(cdg.geometry.coordinates).toEqual([2.5479, 49.0097]);
    expect(props(cdg)).toMatchObject({ id: 'LFPG', color: CAT_AIRPORT_HEX, radius: 18.5 });
    expect(airportRadius(null)).toBe(5);
    expect(body(cdg)).toContain('13:09 à 15:09');
    const bva = body(fc.features[8]);
    for (const part of ['Beauvais-Tillé', 'Départs non relevés pour cet aéroport.', 'Vols retardés', 'Vols annulés', 'Annuaire officiel de l’aéroport, 14:55.']) {
      expect(bva).toContain(part);
    }
  });
  it('avions : icônes nettes à tous les zooms (aucune densité, aucun calque MapLibre des positions) ; aucun libellé d’indicatif ; infobulle échappée', () => {
    expect(TRAFFIC_LAYERS.some((l) => l.type === 'heatmap')).toBe(false);
    expect(TRAFFIC_LAYER_KEYS.trafficAir).toEqual([LYR_AIRPORTS, LYR_AIR_EMERGENCIES, LYR_AIR_EMERGENCY_LABEL]);
    expect(JSON.stringify(TRAFFIC_LAYERS)).not.toContain('callsign');
    const flight: AirTrafficFlight = { id: 'f1', callsign: '<i>EZY1</i>', longitude: 2, latitude: 48, altitude: 35000, speed: 450, heading: 271.6, source: 'opensky' };
    const html = airFlightTooltipHtml(flight);
    expect(html).toContain('&lt;i&gt;EZY1&lt;/i&gt;');
    for (const part of [`35\u202F000${NBSP}ft`, `450${NBSP}nœuds`, '272°', 'Source : OpenSky (ADS-B).']) expect(html).toContain(part);
    expect(airFlightTooltipHtml({ ...flight, callsign: ' ', altitude: 0, speed: 0 })).toContain('Indicatif inconnu');
    expect(html).not.toMatch(/Immatriculation|Provenance|Destination|Trajectoire/);
  });
  it('avion : immatriculation, provenance, destination et trajectoire inhabituelle gardées au survol, texte échappé', () => {
    const flight: AirTrafficFlight = {
      id: 'f2', callsign: 'EZY45HD', longitude: 2.4, latitude: 48.7, altitude: 4000, speed: 210, heading: 90, source: 'opensky',
      registration: 'G-EZAB', originAirport: '<b>Genève</b>', destinationAirport: 'Paris-Orly',
      anomalies: [{ type: 'holding', label: 'Holding', severity: 'medium' }, { type: 'go-around', label: 'Go-around', severity: 'high' }],
    };
    const html = airFlightTooltipHtml(flight);
    for (const part of ['Immatriculation', 'G-EZAB', 'Provenance', '&lt;b&gt;Genève&lt;/b&gt;', 'Destination', 'Paris-Orly', 'Trajectoire',
      'circuit d’attente, approche interrompue']) expect(html).toContain(part);
    expect(html).not.toContain('<b>Genève');
  });
});

describe('rail (§ 3.3)', () => {
  it('gares des trains en cours, couleur du plus fort retard à l’arrêt ; trains à venir écartés ; supprimé rouge', () => {
    const fc = railStationFeatures(railOverviewFixture(), TRAFFIC_NOW);
    expect(Object.fromEntries(fc.features.map((f) => [String(props(f)['name']), props(f)['color']]))).toEqual({
      'Paris Gare de Lyon': levelHex('rouge'), Perpignan: levelHex('rouge'), 'Barcelone Sants': levelHex('rouge'), Narbonne: levelHex('rouge'),
      'Marseille Saint-Charles': levelHex('vert'), 'Lille Europe': levelHex('orange'), 'Bruxelles-Midi': levelHex('rouge'),
      'Toulouse Matabiau': levelHex('rouge'), 'Bordeaux Saint-Jean': levelHex('orange'), 'Lyon Part-Dieu': levelHex('rouge'), Tours: levelHex('rouge'),
    });
    const of = (name: string): string => body(fc.features.find((f) => props(f)['name'] === name) ?? fc.features[0]);
    const narbonne = of('Narbonne');
    expect(narbonne.indexOf('n° 6204')).toBeLessThan(narbonne.indexOf('n° 7885'));
    for (const part of ['3 trains perturbés', `+105${NBSP}min`, 'SNCF, 15:10.']) expect(narbonne).toContain(part);
    expect(of('Tours')).toContain('supprimé');
    expect(of('Lille Europe')).toContain('service modifié');
  });
  it('en retard (SNCF plus de 20 min) : neutre ; trajet du train choisi par ses arrêts, couleur de son retard', () => {
    expect(railOverviewLate(railOverviewFixture(), LATE)).toBe(true);
    expect(railOverviewLate(railOverviewFixture(), TRAFFIC_NOW)).toBe(false);
    expect(allNeutral(railStationFeatures(railOverviewFixture(), LATE))).toBe(true);
    const train = railOverviewFixture().trains[0];
    const route = trainRouteFeatures(train, false);
    expect(route.features.map((f) => f.geometry.type)).toEqual(['LineString', 'Point', 'Point']);
    expect(new Set(route.features.map((f) => props(f)['color']))).toEqual(new Set([levelHex('rouge')]));
    expect(route.features.slice(1).map((f) => [props(f)['role'], props(f)['name']])).toEqual([['departure', 'Paris Gare de Lyon'], ['arrival', 'Barcelone Sants']]);
    expect(allNeutral(trainRouteFeatures(train, true))).toBe(true);
    expect(trainRouteFeatures(null, false).features).toHaveLength(0);
  });
});

describe('maritime (§ 3.4)', () => {
  const signal = (over: Partial<MaritimeSignal> = {}): MaritimeSignal => ({
    mmsi: '228000001', name: 'ESSAI', type: 'Cargo', status: 2, statusLabel: 'Non maître de sa manœuvre', lat: 47.1, lon: -3.2,
    since: paris('14:20'), confirmed: true, sensitive: false, ...over,
  });
  it('signalements confirmés mis en avant : pétrolier ou passagers rouge, autre orange ; AIS en retard : neutre ; hostile échappé', () => {
    const s = maritimeSnapshotFixture();
    s.signals = [signal({ sensitive: true, name: '<b>T</b>' }), signal({ mmsi: '228000002' }), signal({ mmsi: '228000003', confirmed: false })];
    const fc = maritimeSignalFeatures(s, TRAFFIC_NOW);
    expect(fc.features.map((f) => props(f)['color'])).toEqual([levelHex('rouge'), levelHex('orange')]);
    const html = body(fc.features[0]);
    expect(html).toContain('&lt;b&gt;T&lt;/b&gt;');
    for (const part of ['Non maître de sa manœuvre', 'Pétrolier ou navire à passagers.', `30${NBSP}min`, '14:20']) expect(html).toContain(part);
    expect(allNeutral(maritimeSignalFeatures(s, TRAFFIC_NOW + 10 * 60_000))).toBe(true);
    expect(maritimeSignalFeatures(maritimeSnapshotFixture(), TRAFFIC_NOW).features).toHaveLength(0);
  });
  it('mouillages devant les ports qui en ont : surface selon le nombre, jeton de port, positions des 9 ports', () => {
    const fc = anchorageFeatures(maritimeSnapshotFixture(), TRAFFIC_NOW);
    expect(fc.features.map((f) => [props(f)['id'], props(f)['radius'], props(f)['color']])).toEqual([['le havre', 14, CAT_PORT_HEX], ['saint-nazaire', 10, CAT_PORT_HEX]]);
    expect(fc.features[0].geometry.coordinates).toEqual([...PORT_COORDS['le havre']]);
    for (const part of ['Le Havre', 'Au mouillage', 'Présents', '94', 'AIS, 15:12.']) expect(body(fc.features[0])).toContain(part);
    expect(Object.keys(PORT_COORDS)).toHaveLength(9);
  });
});

describe('sources, couches et survol', () => {
  it('sources vides au départ ; couches masquées jusqu’à l’activation de leur couche ; ids uniques ; répartition par couche', () => {
    const ids = TRAFFIC_LAYERS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(TRAFFIC_LAYERS.every((l) => l.layout?.visibility === 'none')).toBe(true);
    expect(Object.values(TRAFFIC_LAYER_KEYS).flat().sort()).toEqual([...ids].sort());
    expect(TRAFFIC_LAYER_KEYS.trafficRoad).toEqual([LYR_ROAD_SECTIONS, LYR_ROAD_JAMS, LYR_ROAD_JAM_POINTS, LYR_ROAD_EVENTS]);
    expect(TRAFFIC_SOURCE_IDS).toHaveLength(8);
    expect(TRAFFIC_JAM_LAYERS).toEqual([LYR_ROAD_JAMS, LYR_ROAD_JAM_POINTS]);
  });
  it('survol de légende : contours atténués pour l’anneau des signalements et les cercles à contour coloré ou blanc', () => {
    expect(TRAFFIC_STROKE_DIM_LAYERS).toContain(LYR_AIS_SIGNALS);
    expect(TRAFFIC_STROKE_DIM_LAYERS).toContain(LYR_TRAIN_STATIONS);
    for (const id of TRAFFIC_STROKE_DIM_LAYERS.filter((x) => x !== LYR_TRAIN_STATIONS)) {
      const layer = TRAFFIC_LAYERS.find((l) => l.id === id);
      expect(layer?.type).toBe('circle');
      const paint = (layer?.paint ?? {}) as Record<string, unknown>;
      expect(paint['circle-stroke-width']).toBeGreaterThanOrEqual(1.5);
      expect(paint['circle-stroke-color']).not.toBe('#111111');
    }
  });
  it('survol : couche du dessus d’abord ; infobulle seulement avec un contenu ; libellés jamais survolés', () => {
    expect(TRAFFIC_HOVER_LAYERS[0]).toBe(LYR_AIS_SIGNALS);
    expect(TRAFFIC_HOVER_LAYERS).not.toContain(LYR_AIR_EMERGENCY_LABEL);
    expect(topTrafficHit([{ layer: { id: LYR_ANCHORAGES } }, { layer: { id: LYR_AIS_SIGNALS } }])?.layer.id).toBe(LYR_AIS_SIGNALS);
    expect(trafficTooltipHtml(LYR_RAIL_STATION, { body: '<b>Narbonne</b>' })).toBe('<div class="hm-tip"><b>Narbonne</b></div>');
    expect(trafficTooltipHtml(LYR_ROAD_EVENTS, {})).toBeNull();
    expect(trafficTooltipHtml(LYR_AIR_EMERGENCY_LABEL, { body: 'x' })).toBeNull();
  });
  it('infobulles : R1, aucun tiret cadratin, aucune police à chasse fixe', () => {
    const n = roadNationalFixture();
    const bodies = [
      ...roadEventFeatures(n, TRAFFIC_NOW).features, ...urbanJamFeatures(roadUrbanFixture(), TRAFFIC_NOW).features,
      ...traficolorFeatures(n, TRAFFIC_NOW).features, ...airportFeatures(airOverviewFixture(), TRAFFIC_NOW).features,
      ...railStationFeatures(railOverviewFixture(), TRAFFIC_NOW).features, ...anchorageFeatures(maritimeSnapshotFixture(), TRAFFIC_NOW).features,
    ].map(body);
    expect(bodies.length).toBeGreaterThan(30);
    for (const html of bodies) {
      expect(trafficBreakable(visibleText(html))).toBeNull();
      expect(html).not.toMatch(/\u2014|&mdash;|monospace/);
    }
  });
});
