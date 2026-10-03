// src/components/deckgl/traffic-map.ts : couches Trafics de la carte (spec 2026-10-03 trafics § 3.1 à 3.4), parties pures :
// sources et couches MapLibre, géométries, couleurs, infobulles. MapLibre ne lit pas les variables CSS : niveaux en levelHex
// (palette L1), catégories copiées des jetons de main.css (layer-panel/traffic-legend.ts). Donnée en retard (S2) : teinte neutre,
// jamais une couleur de niveau. Tout texte de source est échappé ; valeurs insécables (R1). Aucune vue importée.
import type { ExpressionSpecification, GeoJSONSourceSpecification, LayerSpecification } from 'maplibre-gl';
import type {
  AirEmergency, AirOverviewResponse, AirTrafficFlight, AirportActivity, MaritimePortStats, MaritimeSignal, MaritimeSnapshot,
  RailOverviewResponse, RailTrain, RoadEvent, RoadEventKind, RoadNationalResponse, RoadUrbanResponse, UrbanJam,
} from '../../types/index.ts';
import { isTrafficDataLate } from '../../services/traffic-levels.ts';
import type { TrafficFlowSegment } from '../../services/traffic-road.ts';
import { LEVEL_RANK, levelHex, type VigilanceLevel } from '../../services/vigilance.ts';
import { NBSP, frNumber } from '../layer-panel/format.ts';
import {
  RAIL_EFFECT_WORD, ROAD_EVENT_LEVEL, ROAD_KIND_ORDER, SQUAWK_LEVEL, SQUAWK_WORD, anomalyLabel, clockOf, coordText, fold, formatCount, formatKm, formatKmh, formatMeters,
  formatMinutes, jamLevel, plural, railDelayLevel,
} from '../layer-panel/traffic-format.ts';
import { CAT_AIRPORT_HEX, CAT_PORT_HEX, TRAFFIC_NEUTRAL_HEX, isDrawnTraficolorSection } from '../layer-panel/traffic-legend.ts';
import {
  LYR_AIRPORTS, LYR_AIR_EMERGENCIES, LYR_AIR_EMERGENCY_LABEL, LYR_AIS_SIGNALS, LYR_ANCHORAGES, LYR_RAIL_STATION,
  LYR_RAIL_STATION_LABEL, LYR_ROAD_EVENTS, LYR_ROAD_JAMS, LYR_ROAD_JAM_POINTS, LYR_ROAD_SECTIONS, LYR_TRAIN_STATIONS, SRC_AIRPORTS, SRC_AIR_EMERGENCIES,
  SRC_AIS_SIGNALS, SRC_ANCHORAGES, SRC_RAIL_STATIONS, SRC_ROAD_EVENTS, SRC_ROAD_JAMS, SRC_ROAD_SECTIONS,
} from './constants.ts';
import { escapeHtml } from './format-utils.ts';

type Fc<G extends GeoJSON.Geometry = GeoJSON.Geometry> = GeoJSON.FeatureCollection<G>;
type Section = RoadNationalResponse['sections'][number];
export type TrafficMapLayer = 'trafficRoad' | 'trafficAir' | 'trafficRail' | 'trafficMaritime';

function fc<G extends GeoJSON.Geometry>(features: GeoJSON.Feature<G>[]): Fc<G> {
  return { type: 'FeatureCollection', features };
}

function point(lon: number, lat: number): GeoJSON.Point {
  return { type: 'Point', coordinates: [lon, lat] };
}

// ─── Infobulles : gabarit .hm-tip de la santé ; libellés et valeurs échappés ───

function head(title: string, sub: string): string {
  return `<b>${escapeHtml(title)}</b><div class="hm-sub">${escapeHtml(sub)}</div>`;
}

function row(label: string, value: string): string {
  return `<div class="hm-row"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
}

function note(text: string): string {
  return `<div class="hm-note">${escapeHtml(text)}</div>`;
}

function tip(body: string): string {
  return `<div class="hm-tip">${body}</div>`;
}

/** Couleur d'un niveau ; donnée en retard (S2) ou niveau gris (travaux, information, retard inconnu) : teinte neutre. */
export function trafficHex(level: VigilanceLevel | 'gris', late: boolean): string {
  return late || level === 'gris' ? TRAFFIC_NEUTRAL_HEX : levelHex(level);
}

/** Couleur, rayon et ordre portés par chaque objet (calculés ici, jamais par la peinture). */
export const TRAFFIC_COLOR: ExpressionSpecification = ['coalesce', ['get', 'color'], TRAFFIC_NEUTRAL_HEX];
const TRAFFIC_RADIUS: ExpressionSpecification = ['coalesce', ['get', 'radius'], 5];
const TRAFFIC_SORT: ExpressionSpecification = ['coalesce', ['get', 'sortKey'], 0];
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

// ─── Route (§ 3.1) ───

/** Ordre de dessin d'un événement DIR : accidents et coupures au premier plan (spec § 3.1), puis l'ordre du panneau. */
export function roadEventSortKey(kind: RoadEventKind): number {
  if (kind === 'accident') return 100;
  if (kind === 'closure') return 99;
  return 90 - ROAD_KIND_ORDER[kind];
}

function roadEventBody(e: RoadEvent, late: boolean, now: number): string {
  const where = [e.road, e.place].filter((x): x is string => typeof x === 'string' && x !== '').join(', ');
  return head(e.label, where === '' ? e.dir : where)
    + row('Depuis', clockOf(e.start, now))
    + (e.direction ? row('Sens', e.direction) : '')
    + (e.detail ? row('Détail', e.detail) : '')
    + row('Source', e.dir)
    + (late ? note('Données DIR en retard : couleur retirée.') : '');
}

/** Événements DIR en cours géolocalisés (les longues durées restent dans le panneau, T2). */
export function roadEventFeatures(national: RoadNationalResponse | null, now: number): Fc<GeoJSON.Point> {
  if (!national) return fc([]);
  const late = isTrafficDataLate('dir', national.publishedAt, now);
  return fc(national.events.flatMap((e): GeoJSON.Feature<GeoJSON.Point>[] => {
    if (e.lat === null || e.lon === null) return [];
    const front = e.kind === 'accident' || e.kind === 'closure';
    return [{
      type: 'Feature', geometry: point(e.lon, e.lat),
      properties: {
        id: e.id, color: trafficHex(ROAD_EVENT_LEVEL[e.kind], late), radius: front ? 7 : 5, sortKey: roadEventSortKey(e.kind),
        body: roadEventBody(e, late, now),
      },
    }];
  }));
}

function urbanJamBody(j: UrbanJam, late: boolean, now: number): string {
  const sub = j.from && j.to ? `${j.from} vers ${j.to}` : (j.from ?? j.to ?? 'agglomération');
  return head(j.road ? `Bouchon · ${j.road}` : 'Bouchon', sub)
    + row('Longueur', formatKm(j.lengthKm))
    + row('Retard', formatMinutes(j.delayMin, { signed: true }))
    + row('Depuis', clockOf(j.start, now))
    + row('Source', 'TomTom')
    + (late ? note('Collecte TomTom en retard : couleur retirée.') : '');
}

/** Bouchons TomTom des agglomérations : tracé quand il existe, sinon un point ; position gardée pour la vitesse du tronçon. */
export function urbanJamFeatures(urban: RoadUrbanResponse | null, now: number): Fc<GeoJSON.LineString | GeoJSON.Point> {
  if (!urban) return fc([]);
  const late = isTrafficDataLate('tomtom', urban.collectedAt, now);
  return fc(urban.jams.map((j, i): GeoJSON.Feature<GeoJSON.LineString | GeoJSON.Point> => ({
    type: 'Feature',
    geometry: j.path.length >= 2 ? { type: 'LineString', coordinates: j.path.map(([lon, lat]) => [lon, lat]) } : point(j.lon, j.lat),
    properties: { id: `jam-${i}`, color: trafficHex(jamLevel(j.magnitude), late), width: j.magnitude + 1, lat: j.lat, lon: j.lon, body: urbanJamBody(j, late, now) },
  })));
}

const TRAFICOLOR: Readonly<Record<Exclude<Section['status'], 'unknown'>, { level: VigilanceLevel; word: string }>> = {
  freeFlow: { level: 'vert', word: 'Fluide' }, heavy: { level: 'orange', word: 'Dense' }, congested: { level: 'rouge', word: 'Saturé' },
};

/** Sections Traficolor géolocalisées (amendement 3) : niveau du dernier fichier du réseau ; inconnue non dessinée ; fichier en retard : neutre. */
export function traficolorFeatures(national: RoadNationalResponse | null, now: number): Fc<GeoJSON.LineString> {
  if (!national) return fc([]);
  return fc(national.sections.flatMap((s): GeoJSON.Feature<GeoJSON.LineString>[] => {
    if (!isDrawnTraficolorSection(s)) return [];
    const agglo = national.agglos.find((a) => a.network === s.network);
    const at = agglo?.at ?? null;
    const late = isTrafficDataLate('traficolor', at, now);
    const { level, word } = TRAFICOLOR[s.status];
    return [{
      type: 'Feature', geometry: { type: 'LineString', coordinates: s.path.map(([lon, lat]) => [lon, lat]) },
      properties: {
        id: s.id, color: trafficHex(level, late),
        body: head(agglo?.label ?? s.network, word) + row('Section', s.id)
          + note(`Traficolor (DIR), fichier de ${clockOf(at, now)}${late ? ' (en retard) : couleur retirée' : ''}.`),
      },
    }];
  }));
}

/** Temps de parcours d'un tronçon (secondes TomTom) : « 45 s », « 1,7 min », « 5 min », « 12 min ». */
function travelTime(seconds: number): string {
  if (seconds < 60) return `${frNumber(seconds, 0)}${NBSP}s`;
  const minutes = Math.round(seconds / 6) / 10;
  return formatMinutes(minutes, { digits: minutes < 10 && !Number.isInteger(minutes) ? 1 : 0 });
}

/** Vitesse et temps de parcours du tronçon (TomTom, au clic, budget serveur) ; indisponible : dit, jamais une valeur inventée. */
function jamFlowHtml(flow: TrafficFlowSegment | null): string {
  if (!flow) return note('Vitesse du tronçon indisponible.');
  return row('Vitesse du tronçon', formatKmh(flow.currentSpeed)) + row('Vitesse sans trafic', formatKmh(flow.freeFlowSpeed))
    + row('Temps de parcours', `${travelTime(flow.currentTravelTime)} (sans trafic : ${travelTime(flow.freeFlowTravelTime)})`)
    + (flow.roadClosure ? note('Tronçon fermé.') : '');
}

export function jamPopupHtml(body: string, flow: TrafficFlowSegment | null): string {
  return tip(body + jamFlowHtml(flow));
}

// ─── Aérien (§ 3.2) ───

/**
 * Les icônes d'avions (Deck.gl) sont dessinées à tous les zooms (retour de l'utilisateur : une densité floue ne remplace pas des
 * avions nets) ; leurs positions ne sont animées entre deux relevés qu'à partir de ce zoom.
 */
export const AIR_TWEEN_MIN_ZOOM = 7;

/**
 * Animation des positions entre deux relevés (12 s) : couche active, zoom 7 ou plus et relevé précédent. Sous le zoom 7, l'avion
 * se déplace de quelques pixels par relevé : positions posées à chaque relevé, sans reconstruire les couches Deck.gl à chaque image.
 */
export function shouldTweenAirPositions(hadPrevious: boolean, layerVisible: boolean, zoom: number): boolean {
  return hadPrevious && layerVisible && zoom >= AIR_TWEEN_MIN_ZOOM;
}

function airEmergencyBody(e: AirEmergency, late: boolean, now: number): string {
  return head(e.callsign ?? `ICAO ${e.icao24.toUpperCase()}`, `${e.squawk} · ${SQUAWK_WORD[e.squawk]}`)
    + row('Position', coordText(e.lat, e.lon))
    + row('Altitude', formatMeters(e.altitudeM))
    + row('Vu depuis', clockOf(e.firstSeen, now))
    + row('Dernière position', clockOf(e.lastSeen, now))
    + (e.overFrance ? '' : note('Hors territoire et approches : couleur retirée, ne colore pas la pastille.'))
    + (late ? note('Données OpenSky en retard : couleur retirée.') : '');
}

/**
 * Couleur d'une urgence, comme la ligne du panneau et la pastille (R3, T3) : au-dessus du territoire ou de ses approches, 7500 rouge,
 * 7700 orange, 7600 jaune ; hors territoire et approches : gris.
 */
export function airEmergencyLevel(e: Pick<AirEmergency, 'squawk' | 'overFrance'>): VigilanceLevel | 'gris' {
  return e.overFrance ? SQUAWK_LEVEL[e.squawk] : 'gris';
}

/** Urgences en vol (7500, 7600, 7700) : symbole et indicatif (spec § 3.2), couleur du panneau (airEmergencyLevel). */
export function airEmergencyFeatures(overview: AirOverviewResponse | null, now: number): Fc<GeoJSON.Point> {
  if (!overview) return fc([]);
  const late = isTrafficDataLate('opensky', overview.at, now);
  return fc(overview.emergencies.map((e): GeoJSON.Feature<GeoJSON.Point> => ({
    type: 'Feature', geometry: point(e.lon, e.lat),
    properties: {
      id: e.icao24, label: e.callsign ?? e.icao24.toUpperCase(), color: trafficHex(airEmergencyLevel(e), late), body: airEmergencyBody(e, late, now),
    },
  })));
}

/** Rayon d'un aéroport : surface proportionnelle aux départs détectés (racine), au dixième ; départs non relevés : 5 px. */
export function airportRadius(departures: number | null): number {
  if (departures === null) return 5;
  return Math.min(22, Math.round((5 + Math.sqrt(Math.max(0, departures)) * 1.6) * 10) / 10);
}

function airportBody(a: AirportActivity, now: number): string {
  const span = a.departuresWindow;
  const spanLate = span !== null && isTrafficDataLate('opensky-departures', span.end, now);
  return head(a.name, a.iata)
    + row('Départs détectés', formatCount(a.departures))
    + (span ? row('Fenêtre', `${clockOf(span.begin, now)} à ${clockOf(span.end, now)}${spanLate ? ' (en retard)' : ''}`) : '')
    + row('Au sol', formatCount(a.onGround))
    + row('En approche', formatCount(a.approaching))
    + (a.board
      ? row('Vols retardés', formatCount(a.board.delayed)) + row('Vols annulés', formatCount(a.board.cancelled))
        + note(`Annuaire officiel de l’aéroport, ${clockOf(a.board.at, now)}.`)
      : '')
    + (a.departures === null ? note('Départs non relevés pour cet aéroport.') : '');
}

/** Aéroports suivis, placés par leurs coordonnées (amendement 3), disque en jeton de catégorie (pas un niveau). */
export function airportFeatures(overview: AirOverviewResponse | null, now: number): Fc<GeoJSON.Point> {
  if (!overview) return fc([]);
  return fc(overview.airports.map((a): GeoJSON.Feature<GeoJSON.Point> => ({
    type: 'Feature', geometry: point(a.lon, a.lat),
    properties: { id: a.icao, color: CAT_AIRPORT_HEX, radius: airportRadius(a.departures), body: airportBody(a, now) },
  })));
}

/**
 * Survol d'un avion (couche Deck.gl) : indicatif, appareil, altitude, vitesse, cap ; immatriculation, provenance et destination
 * quand la source ou un annuaire officiel les donne ; trajectoire inhabituelle détectée par le serveur (gardée, spec § 2.6).
 * Plus aucun libellé permanent.
 */
export function airFlightTooltipHtml(f: AirTrafficFlight): string {
  const callsign = String(f.callsign ?? '').trim();
  const anomalies = (f.anomalies ?? []).map((a) => anomalyLabel(a.type));
  return tip(head(callsign === '' ? 'Indicatif inconnu' : callsign, f.aircraftModel ?? f.aircraftType ?? 'Vol civil')
    + (f.operator ? row('Exploitant', f.operator) : '')
    + (f.registration ? row('Immatriculation', f.registration) : '')
    + (f.originAirport ? row('Provenance', f.originAirport) : '')
    + (f.destinationAirport ? row('Destination', f.destinationAirport) : '')
    + row('Altitude', f.altitude > 0 ? `${frNumber(f.altitude, 0)}${NBSP}ft` : 'n.d.')
    + row('Vitesse', f.speed > 0 ? `${frNumber(f.speed, 0)}${NBSP}nœuds` : 'n.d.')
    + row('Cap', `${Math.round((((f.heading || 0) % 360) + 360) % 360)}°`)
    + (anomalies.length > 0 ? row('Trajectoire', anomalies.join(', ')) : '')
    + note('Source : OpenSky (ADS-B).'));
}

// ─── Rail (§ 3.3) ───

interface StationTrain { train: RailTrain; delay: number | null }
interface Station { name: string; lat: number; lon: number; level: VigilanceLevel; trains: StationTrain[] }
const MAX_STATION_TRAINS = 6;

function stationRank(s: StationTrain): number {
  return s.train.effect === 'supprime' ? 100_000 : s.delay ?? -1;
}

function stationValue(s: StationTrain): string {
  if (s.train.effect === 'supprime') return 'supprimé';
  const delay = formatMinutes(s.delay, { signed: true });
  return s.train.effect === 'retard' ? delay : `${delay} · ${RAIL_EFFECT_WORD[s.train.effect]}`;
}

function stationBody(st: Station, late: boolean, updatedAt: string | null, now: number): string {
  const trains = [...st.trains].sort((a, b) => stationRank(b) - stationRank(a));
  const shown = trains.slice(0, MAX_STATION_TRAINS);
  return head(st.name, plural(trains.length, 'train perturbé', 'trains perturbés'))
    + shown.map((s) => row(`n° ${s.train.number} · ${s.train.origin} – ${s.train.destination}`, stationValue(s))).join('')
    + (trains.length > shown.length ? note(`${trains.length - shown.length} autres trains.`) : '')
    + note(`SNCF, ${clockOf(updatedAt, now)}${late ? ' (en retard) : couleur retirée' : ''}.`);
}

export function railOverviewLate(overview: RailOverviewResponse | null, now: number): boolean {
  return overview !== null && isTrafficDataLate('sncf', overview.updatedAt, now);
}

/** Gares des trains perturbés en cours : couleur du plus fort retard à l'arrêt (supprimé rouge) ; retard inconnu non dessiné. */
export function railStationFeatures(overview: RailOverviewResponse | null, now: number): Fc<GeoJSON.Point> {
  if (!overview) return fc([]);
  const late = railOverviewLate(overview, now);
  const stations = new Map<string, Station>();
  for (const train of overview.trains) {
    if (train.status !== 'en-cours') continue;
    const cancelled = train.effect === 'supprime';
    for (const stop of train.stops) {
      const level = railDelayLevel(stop.delayMin, cancelled);
      if (level === 'gris') continue;
      const key = fold(stop.name);
      const station = stations.get(key) ?? { name: stop.name, lat: stop.lat, lon: stop.lon, level, trains: [] };
      if (LEVEL_RANK[level] > LEVEL_RANK[station.level]) station.level = level;
      station.trains.push({ train, delay: stop.delayMin });
      stations.set(key, station);
    }
  }
  return fc([...stations.entries()].map(([key, st]): GeoJSON.Feature<GeoJSON.Point> => ({
    type: 'Feature', geometry: point(st.lon, st.lat),
    properties: {
      id: key, name: st.name, color: trafficHex(st.level, late), radius: 4 + LEVEL_RANK[st.level] * 2, sortKey: LEVEL_RANK[st.level],
      body: stationBody(st, late, overview.updatedAt, now),
    },
  })));
}

/** Trajet d'un train choisi dans le panneau : ligne par ses arrêts, départ et arrivée, couleur de son retard. */
export function trainRouteFeatures(train: RailTrain | null, late: boolean): Fc {
  if (!train || train.stops.length === 0) return fc([]);
  const color = trafficHex(railDelayLevel(train.delayMin, train.effect === 'supprime'), late);
  const first = train.stops[0];
  const last = train.stops[train.stops.length - 1];
  const features: GeoJSON.Feature[] = [];
  if (train.stops.length >= 2) {
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: train.stops.map((s) => [s.lon, s.lat]) }, properties: { color } });
  }
  features.push({ type: 'Feature', geometry: point(first.lon, first.lat), properties: { role: 'departure', name: first.name, color } });
  if (train.stops.length >= 2) {
    features.push({ type: 'Feature', geometry: point(last.lon, last.lat), properties: { role: 'arrival', name: last.name, color } });
  }
  return fc(features);
}

// ─── Maritime (§ 3.4) ───

/** Positions publiques des 9 ports suivis par le relais (`MaritimePortStats` n'en porte pas), [lon, lat], noms repliés. */
export const PORT_COORDS: Readonly<Record<string, readonly [number, number]>> = {
  'le havre': [0.107, 49.483], rouen: [1.07, 49.44], dunkerque: [2.335, 51.05], calais: [1.86, 50.965], brest: [-4.475, 48.383],
  'saint-nazaire': [-2.2, 47.27], bordeaux: [-0.55, 44.86], 'marseille-fos': [4.87, 43.405], toulon: [5.93, 43.11],
};

function signalBody(s: MaritimeSignal, late: boolean, now: number): string {
  return head(s.name ?? `MMSI ${s.mmsi}`, s.statusLabel)
    + row('Type', s.type ?? 'n.d.')
    + row('Position', coordText(s.lat, s.lon))
    + row('Depuis', clockOf(s.since, now))
    + row('MMSI', s.mmsi)
    + (s.sensitive ? note('Pétrolier ou navire à passagers.') : '')
    + note(`Signalement croisé : hors port, immobile depuis 30${NBSP}min (règle T3).`)
    + (late ? note('AIS en retard : couleur retirée.') : '');
}

/** Signalements confirmés (T3) : pétrolier ou passagers rouge, autre orange, comme la pastille. */
export function maritimeSignalFeatures(snapshot: MaritimeSnapshot | null, now: number): Fc<GeoJSON.Point> {
  if (!snapshot) return fc([]);
  const late = isTrafficDataLate('ais', snapshot.lastMessageAt, now);
  return fc(snapshot.signals.filter((s) => s.confirmed).map((s): GeoJSON.Feature<GeoJSON.Point> => ({
    type: 'Feature', geometry: point(s.lon, s.lat),
    properties: { id: s.mmsi, color: trafficHex(s.sensitive ? 'rouge' : 'orange', late), body: signalBody(s, late, now) },
  })));
}

function anchorageBody(p: MaritimePortStats, at: string | null, late: boolean, now: number): string {
  return head(p.port, 'Mouillage devant le port')
    + row('Au mouillage', formatCount(p.atAnchor))
    + row('Présents', formatCount(p.vessels))
    + row('Amarrés', formatCount(p.moored))
    + row('En route', formatCount(p.underWay))
    + note(`AIS, ${clockOf(at, now)}${late ? ' (en retard)' : ''}.`);
}

/** Mouillages devant les ports qui en ont : surface selon le nombre de navires, jeton de port (pas un niveau). */
export function anchorageFeatures(snapshot: MaritimeSnapshot | null, now: number): Fc<GeoJSON.Point> {
  if (!snapshot) return fc([]);
  const late = isTrafficDataLate('ais', snapshot.lastMessageAt, now);
  return fc(snapshot.ports.flatMap((p): GeoJSON.Feature<GeoJSON.Point>[] => {
    const key = fold(p.port);
    const at = PORT_COORDS[key];
    if (!at || p.atAnchor <= 0) return [];
    return [{
      type: 'Feature', geometry: point(at[0], at[1]),
      properties: { id: key, color: CAT_PORT_HEX, radius: Math.min(20, Math.round(6 + Math.sqrt(p.atAnchor) * 3)), body: anchorageBody(p, snapshot.lastMessageAt, late, now) },
    }];
  }));
}

// ─── Sources, couches, survol ───

export const TRAFFIC_SOURCE_IDS: readonly string[] = [
  SRC_ROAD_SECTIONS, SRC_ROAD_JAMS, SRC_ROAD_EVENTS, SRC_AIRPORTS, SRC_AIR_EMERGENCIES, SRC_RAIL_STATIONS, SRC_ANCHORAGES, SRC_AIS_SIGNALS,
];

export function trafficSourceSpec(): GeoJSONSourceSpecification {
  return { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
}

/** Couches Trafics du bas vers le haut ; toutes masquées jusqu'à setLayerVisibility. */
export const TRAFFIC_LAYERS: readonly LayerSpecification[] = [
  {
    id: LYR_ROAD_SECTIONS, type: 'line', source: SRC_ROAD_SECTIONS,
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: { 'line-color': TRAFFIC_COLOR, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 13, 4], 'line-opacity': 0.85 },
  },
  {
    id: LYR_ROAD_JAMS, type: 'line', source: SRC_ROAD_JAMS, filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: {
      'line-color': TRAFFIC_COLOR,
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, ['coalesce', ['get', 'width'], 2], 12, ['*', ['coalesce', ['get', 'width'], 2], 2.5]],
      'line-opacity': 0.9,
    },
  },
  {
    id: LYR_ROAD_JAM_POINTS, type: 'circle', source: SRC_ROAD_JAMS, filter: ['==', ['geometry-type'], 'Point'], layout: { visibility: 'none' },
    paint: { 'circle-color': TRAFFIC_COLOR, 'circle-radius': 4, 'circle-stroke-width': 1, 'circle-stroke-color': '#111111' },
  },
  {
    id: LYR_ROAD_EVENTS, type: 'circle', source: SRC_ROAD_EVENTS, layout: { 'circle-sort-key': TRAFFIC_SORT, visibility: 'none' },
    paint: { 'circle-color': TRAFFIC_COLOR, 'circle-radius': TRAFFIC_RADIUS, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#111111', 'circle-opacity': 0.95 },
  },
  {
    id: LYR_AIRPORTS, type: 'circle', source: SRC_AIRPORTS, layout: { visibility: 'none' },
    paint: { 'circle-color': TRAFFIC_COLOR, 'circle-opacity': 0.3, 'circle-radius': TRAFFIC_RADIUS, 'circle-stroke-width': 1.5, 'circle-stroke-color': TRAFFIC_COLOR },
  },
  {
    id: LYR_AIR_EMERGENCIES, type: 'circle', source: SRC_AIR_EMERGENCIES, layout: { visibility: 'none' },
    paint: { 'circle-color': TRAFFIC_COLOR, 'circle-radius': 9, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' },
  },
  {
    id: LYR_AIR_EMERGENCY_LABEL, type: 'symbol', source: SRC_AIR_EMERGENCIES,
    layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-font': ['Open Sans Semibold'], visibility: 'none' },
    paint: { 'text-color': '#ffffff', 'text-halo-color': '#0a0a0f', 'text-halo-width': 2 },
  },
  {
    id: LYR_RAIL_STATION, type: 'circle', source: SRC_RAIL_STATIONS, layout: { 'circle-sort-key': TRAFFIC_SORT, visibility: 'none' },
    paint: { 'circle-color': TRAFFIC_COLOR, 'circle-radius': TRAFFIC_RADIUS, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#1a1a2e', 'circle-opacity': 0.95 },
  },
  {
    id: LYR_RAIL_STATION_LABEL, type: 'symbol', source: SRC_RAIL_STATIONS, minzoom: 8,
    layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, -1.4], 'text-anchor': 'bottom', 'text-font': ['Noto Sans Regular'], visibility: 'none' },
    paint: { 'text-color': '#f0f0f0', 'text-halo-color': '#1a1a2e', 'text-halo-width': 1.5 },
  },
  {
    id: LYR_ANCHORAGES, type: 'circle', source: SRC_ANCHORAGES, layout: { visibility: 'none' },
    paint: { 'circle-color': TRAFFIC_COLOR, 'circle-opacity': 0.2, 'circle-radius': TRAFFIC_RADIUS, 'circle-stroke-width': 2, 'circle-stroke-color': TRAFFIC_COLOR },
  },
  {
    id: LYR_AIS_SIGNALS, type: 'circle', source: SRC_AIS_SIGNALS, layout: { visibility: 'none' },
    paint: { 'circle-color': TRANSPARENT, 'circle-radius': 12, 'circle-stroke-width': 3, 'circle-stroke-color': TRAFFIC_COLOR },
  },
];

/** Couches MapLibre de chaque couche Trafics (visibilité, survol de légende). */
export const TRAFFIC_LAYER_KEYS: Readonly<Record<TrafficMapLayer, readonly string[]>> = {
  trafficRoad: [LYR_ROAD_SECTIONS, LYR_ROAD_JAMS, LYR_ROAD_JAM_POINTS, LYR_ROAD_EVENTS],
  trafficAir: [LYR_AIRPORTS, LYR_AIR_EMERGENCIES, LYR_AIR_EMERGENCY_LABEL],
  trafficRail: [LYR_RAIL_STATION, LYR_RAIL_STATION_LABEL],
  trafficMaritime: [LYR_ANCHORAGES, LYR_AIS_SIGNALS],
};

/** Bouchons TomTom : cliquables (vitesse du tronçon). */
export const TRAFFIC_JAM_LAYERS: readonly string[] = [LYR_ROAD_JAMS, LYR_ROAD_JAM_POINTS];

/**
 * Cercles à contour coloré ou blanc (anneau des signalements AIS sans remplissage, aéroports, mouillages, urgences, arrêts du trajet
 * d'un train) : au survol de légende d'une autre couche, leur contour s'atténue avec leur remplissage.
 */
export const TRAFFIC_STROKE_DIM_LAYERS: readonly string[] = [LYR_AIRPORTS, LYR_AIR_EMERGENCIES, LYR_ANCHORAGES, LYR_AIS_SIGNALS, LYR_TRAIN_STATIONS];

const HOVERABLE: ReadonlySet<string> = new Set([
  LYR_ROAD_SECTIONS, LYR_ROAD_JAMS, LYR_ROAD_JAM_POINTS, LYR_ROAD_EVENTS, LYR_AIRPORTS, LYR_AIR_EMERGENCIES, LYR_RAIL_STATION, LYR_ANCHORAGES,
  LYR_AIS_SIGNALS,
]);

/** Couches survolées, de la plus haute à la plus basse : celle qu'on voit au-dessus répond. */
export const TRAFFIC_HOVER_LAYERS: readonly string[] = TRAFFIC_LAYERS.map((l) => l.id).reverse().filter((id) => HOVERABLE.has(id));

export function topTrafficHit<T extends { layer: { id: string } }>(hits: readonly T[]): T | undefined {
  for (const id of TRAFFIC_HOVER_LAYERS) {
    const hit = hits.find((f) => f.layer.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** Infobulle préparée avec la donnée (propriété `body`, déjà échappée) ; bouchon : rappel du clic. */
export function trafficTooltipHtml(layerId: string, props: Readonly<Record<string, unknown>>): string | null {
  const body = props['body'];
  if (typeof body !== 'string' || body === '' || !HOVERABLE.has(layerId)) return null;
  return tip(body + (TRAFFIC_JAM_LAYERS.includes(layerId) ? note('Clic : vitesse du tronçon.') : ''));
}
