// src/components/deckgl/sovereignty-map.ts : couches Souveraineté de la carte (spec 2026-10-04 souveraineté § 2.1, § 2.2 ; contrats § 5),
// parties pures : sources et couches MapLibre, géométries, couleurs, infobulles. MapLibre ne lit pas les variables CSS : niveaux en
// levelHex (palette L1), catégories copiées des jetons de main.css (layer-panel/sovereignty-legend.ts). Donnée en retard ou non évaluée
// (S2, T3) : gris SOV_ABROAD_HEX, jamais une couleur de niveau. Couleur, icône et ordre calculés ici, dans les propriétés ; tout texte est
// échappé ; valeurs insécables (R1). Un lieu sur la carte est un lieu réel (V5) : la Vigilance cyber n'a aucun rendu. Aucune vue importée.
import type { ExpressionSpecification, GeoJSONSourceSpecification, LayerSpecification } from 'maplibre-gl';
import type {
  CableAlert, CableLanding, CablesWatchResponse, DefenseOsmWorksFile, MilitaryAbroad, MilitaryAircraft, MilitaryBase, MilitaryResponse,
  ShownMilitaryEmergency, SubseaCable, SubseaCablesFile,
} from '../../types/index.ts';
import type { MilitaryShip } from '../../services/military-ships.ts';
import { cableAlertLevel, isSovereigntyDataLate, militaryEmergencyLevel } from '../../services/sovereignty-levels.ts';
import { isEmergencyConfirmed } from '../../services/traffic-levels.ts';
import { levelHex } from '../../services/vigilance.ts';
import { departementName } from '../layer-panel/health-format.ts';
import { isSubmarine } from '../layer-panel/navy.ts';
import {
  BASE_TYPE_WORD, EMERGENCY_WORD, SQUAWK_CAVEAT, SQUAWK_WORD, aircraftLabel, capitalize, clockOf, dateOf, formatFeet, formatKnots, formatMeters,
} from '../layer-panel/sovereignty-format.ts';
import { BASE_TYPE_HEX, CABLE_HEX, MIL_AUTRES_HEX, NAVY_HEX, SOV_ABROAD_HEX } from '../layer-panel/sovereignty-legend.ts';
import {
  LYR_MILITARY_BASES_CIRCLE, LYR_MILITARY_BASES_LABEL, LYR_SOV_AIRCRAFT, LYR_SOV_AIRCRAFT_ABROAD, LYR_SOV_DRONES_FILL, LYR_SOV_DRONES_LINE,
  LYR_SOV_GNSS_FILL, LYR_SOV_GNSS_LINE, LYR_SOV_AIRCRAFT_LABEL, LYR_SOV_CABLE_VESSELS, LYR_SOV_EMERGENCIES, LYR_SOV_NAVY_OBSERVED, LYR_SOV_NAVY_REFERENCE, LYR_SOV_OSM_WORKS,
  LYR_SUBMARINE_CABLES, LYR_SUBMARINE_CABLES_CORE, LYR_SUBMARINE_CABLES_GLOW, LYR_SUBMARINE_CABLES_HITAREA, LYR_SUBMARINE_CABLES_LANDING,
  SRC_SOV_AIRCRAFT, SRC_SOV_AIRCRAFT_ABROAD, SRC_SOV_CABLE_VESSELS, SRC_SOV_EMERGENCIES, SRC_SOV_NAVY, SRC_SOV_OSM_WORKS,
} from './constants.ts';
import { escapeHtml } from './format-utils.ts';
import { droneZoneTooltipHtml } from './sovereignty-map-b.ts';

type Fc<G extends GeoJSON.Geometry = GeoJSON.Geometry> = GeoJSON.FeatureCollection<G>;
export type SovereigntyMapLayer = 'military' | 'subseaCables';

function fc<G extends GeoJSON.Geometry>(features: GeoJSON.Feature<G>[]): Fc<G> {
  return { type: 'FeatureCollection', features };
}

function point(lon: number, lat: number): GeoJSON.Point {
  return { type: 'Point', coordinates: [lon, lat] };
}

// ─── Infobulles : gabarit .hm-tip de la santé, des Trafics et de l'Environnement ; libellés et valeurs échappés ───

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

const GREY = SOV_ABROAD_HEX;
const TRANSPARENT = 'rgba(0, 0, 0, 0)';
/** Couleur portée par chaque objet (calculée ici, jamais par la peinture). */
const SOV_COLOR: ExpressionSpecification = ['coalesce', ['get', 'color'], GREY];

/** Couleur d'un tracé de câble : celle de la couche pour un câble en service, grise pour un câble du Shom hors service (jamais en alerte). */
export function sovCableColor(inService: string): ExpressionSpecification {
  return ['case', ['==', ['get', 'outOfService'], true], GREY, inService];
}

function placeOf(dept: string | null): string {
  return dept !== null ? `${departementName(dept)} (${dept})` : 'en mer, eaux françaises';
}

function vigilanceHex(level: ReturnType<typeof militaryEmergencyLevel>, late: boolean): string {
  return late || level === 'gris' ? GREY : levelHex(level);
}

// ─── Aéronefs militaires (§ 2.1, V2 ; O10) ───
// Un appareil français, un appareil marqué PIA ou LADD et une adresse non OACI (« ~… ») n'ont jamais de point : le serveur ne les envoie
// pas (comptés par département seulement) ; les gardes d'ici ne servent qu'à ne jamais en dessiner un si une réponse en laissait passer.

function drawable(a: { hex: string; country: string | null }): boolean {
  if (a.hex === '' || a.hex.startsWith('~') || a.country === 'France') return false;
  if (/^[0-9a-f]{6}$/iu.test(a.hex)) {
    const n = Number.parseInt(a.hex, 16);
    if (n >= 0x380000 && n <= 0x3bffff) return false;   // bloc OACI de la France
  }
  const flags = Number((a as { dbFlags?: unknown }).dbFlags);
  return !(Number.isInteger(flags) && (flags & 12) !== 0);   // bits 4 (PIA) et 8 (LADD) de dbFlags
}

function aircraftBody(a: MilitaryAircraft, late: boolean, now: number): string {
  return head(`${aircraftLabel(a)} · ${a.type ?? 'type n.d.'}`, 'aéronef militaire, autre pays')
    + row('Pays', a.country ?? 'non identifié (bloc OACI)')
    + row('Département', placeOf(a.dept))
    + row('Altitude', formatFeet(a.altitudeFt))
    + row('Vitesse', formatKnots(a.speedKt, 0))
    + row('Vu à', clockOf(a.seenAt, now))
    + note('Données adsb.lol, ODbL 1.0. Un appareil absent du flux n’est pas absent du ciel.')
    + (late ? note('Relevé en retard : couleur retirée.') : '');
}

/** Aéronefs d'un autre pays au-dessus de la France (V2), en rose ; relevé en retard : gris ; jamais lu : rien. Position au relevé (arbitrage 20). */
export function aircraftFeatures(m: MilitaryResponse | null, now: number): Fc<GeoJSON.Point> {
  if (m === null || m.readAt === null) return fc([]);
  const late = isSovereigntyDataLate('adsb-mil', m.readAt, now);
  return fc(m.others.filter((a) => drawable(a)).map((a): GeoJSON.Feature<GeoJSON.Point> => ({
    type: 'Feature', geometry: point(a.lon, a.lat),
    properties: {
      id: a.hex, color: late ? GREY : MIL_AUTRES_HEX, label: `${aircraftLabel(a)} ${clockOf(a.seenAt, now)}`, body: aircraftBody(a, late, now),
    },
  })));
}

function abroadBody(a: MilitaryAbroad): string {
  return head(`${aircraftLabel(a)} · ${a.type ?? 'type n.d.'}`, 'Hors de France, jamais compté') + row('Pays', a.country ?? 'non identifié (bloc OACI)');
}

/** Aéronefs de la zone d'affichage hors de France : gris clair, jamais comptés. */
export function abroadAircraftFeatures(m: MilitaryResponse | null): Fc<GeoJSON.Point> {
  if (m === null || m.readAt === null) return fc([]);
  return fc(m.abroad.filter((a) => drawable(a)).map((a): GeoJSON.Feature<GeoJSON.Point> => ({
    type: 'Feature', geometry: point(a.lon, a.lat), properties: { id: a.hex, color: GREY, body: abroadBody(a) },
  })));
}

function emergencyBody(e: ShownMilitaryEmergency, late: boolean, now: number): string {
  const confirmed = isEmergencyConfirmed(e);
  const place = e.inFrance ? placeOf(e.dept) : e.overFrance ? 'approches de la France, hors du territoire' : 'hors de France';
  const word = e.emergency !== null ? EMERGENCY_WORD[e.emergency] ?? null : null;
  return head(`${e.callsign ?? `adresse ${e.icao24}`} · ${e.squawk} (${SQUAWK_WORD[e.squawk]})`, confirmed ? 'Urgence confirmée (deux lectures)' : 'Vue une fois, à confirmer')
    + row('Lieu', place)
    + row('Vue', `de ${clockOf(e.firstSeen, now)} à ${clockOf(e.lastSeen, now)}`)
    + (word !== null ? row('Publié par l’appareil', word) : '')
    + note(`${capitalize(SQUAWK_CAVEAT)}.`)
    + (late ? note('Relevé en retard : couleur retirée.') : '');
}

/**
 * Urgences de la dernière lecture : cercle autour de l'aéronef, couleur militaryEmergencyLevel ; hors des approches ou en retard : gris.
 * Une urgence masquée (appareil français, PIA, LADD, adresse non OACI) n'a pas de position : aucun point (O10), le panneau la compte.
 */
export function militaryEmergencyFeatures(m: MilitaryResponse | null, now: number): Fc<GeoJSON.Point> {
  if (m === null || m.readAt === null) return fc([]);
  const late = isSovereigntyDataLate('adsb-mil', m.readAt, now);
  const shown = m.emergencies.filter((e): e is ShownMilitaryEmergency => !e.masked);
  return fc(shown.map((e): GeoJSON.Feature<GeoJSON.Point> => ({
    type: 'Feature', geometry: point(e.lon, e.lat),
    properties: { id: `${e.icao24}:${e.squawk}`, color: vigilanceHex(militaryEmergencyLevel(e), late), body: emergencyBody(e, late, now) },
  })));
}

// ─── Marine nationale (§ 2.1, V1) ───

/**
 * Bâtiments vus en AIS (icône du navire, heure en étiquette ; flux figé : icône grise, « non évalué ») et positions de référence au port
 * base (icône à part, contour pointillé, « pas une observation », S2). SNLE et SNA ne sont jamais dessinés (O11).
 */
export function navyFeatures(ships: readonly MilitaryShip[], frozen: boolean, now: number): Fc<GeoJSON.Point> {
  return fc(ships.filter((s) => !isSubmarine(s)).flatMap((s): GeoJSON.Feature<GeoJSON.Point>[] => {
    const observed = s.isLive === true;
    // Heure illisible : le point est écarté, jamais une date inventée ni une exception.
    if (observed && s.lastSeen !== undefined && !Number.isFinite(s.lastSeen)) return [];
    const seen = observed && s.lastSeen !== undefined ? clockOf(new Date(s.lastSeen).toISOString(), now) : '';
    const body = observed
      ? head(s.name, `${s.type} · ${s.role}`) + row('Vu en AIS à', seen || 'n.d.') + row('Vitesse', s.speed !== undefined ? formatKnots(s.speed) : 'n.d.')
        + (frozen ? note('Flux AIS figé : position non évaluée.') : note('AIS : aisstream.io via le relais.'))
      : head(s.name, `${s.type} · ${s.role}`) + row('Port base', s.port ?? 'n.d.') + note('Port base : position de référence, pas une observation.');
    return [{
      type: 'Feature', geometry: point(s.lon, s.lat),
      properties: {
        id: s.mmsi ?? s.id, kind: observed ? 'observed' : 'reference', icon: observed ? (frozen ? 'mil-ship-stale' : 'mil-ship') : 'mil-ship-ref',
        color: observed && frozen ? GREY : NAVY_HEX, label: seen, body,
      },
    }];
  }));
}

// ─── Sites de défense ───

/** Sites de la liste interne (triangles par catégorie, couche existante LYR_MILITARY_BASES_CIRCLE) ; aucune fusion OpenStreetMap. */
export function defenseSiteFeatures(bases: readonly MilitaryBase[]): Fc<GeoJSON.Point> {
  return fc(bases.map((b): GeoJSON.Feature<GeoJSON.Point> => ({
    type: 'Feature', geometry: point(b.coordinates[0], b.coordinates[1]),
    properties: {
      id: b.id, name: b.name, type: b.type,
      // O13 : nom et catégorie seulement ; ni description non sourcée, ni effectif, ni unité (aucun lien officiel n'est tenu par site).
      body: head(b.name, `site ${BASE_TYPE_WORD[b.type]}`) + note('Liste interne de sites publics, sans date par site.'),
    },
  })));
}

/** Ouvrages OpenStreetMap (option, éteinte par défaut) : points en France, couleur de catégorie, licence et date du fichier. */
export function osmWorksFeatures(file: DefenseOsmWorksFile | null): Fc<GeoJSON.Point> {
  if (file === null) return fc([]);
  return fc(file.items.map((w): GeoJSON.Feature<GeoJSON.Point> => ({
    type: 'Feature', geometry: point(w.lon, w.lat),
    properties: {
      id: w.id, color: BASE_TYPE_HEX[w.type],
      body: head(w.name ?? 'ouvrage sans nom', `OpenStreetMap · ${w.kind}`) + row('Département', placeOf(w.dept))
        + note(`${file.source}, ${file.licence} · fichier du ${dateOf(file.generatedAt)}`),
    },
  })));
}

// ─── Connectivité (§ 2.2, O18) ───

function landingPlace(l: CableLanding): string {
  return l.commune !== '' ? `${l.commune} (${l.dept})` : placeOf(l.dept);
}

/** Un câble est du Shom par le préfixe `shom/` de son identifiant, jamais autrement (amendement 7, revue d'A5). */
function isShomCable(c: Pick<SubseaCable, 'id'>): boolean {
  return c.id.startsWith('shom/');
}

/** « Shom (CC BY-SA, 2019) » : source, licence et année d'édition du fichier ; « OpenStreetMap (ODbL 1.0) » pour un complément. */
function cableSourceText(c: SubseaCable, file: SubseaCablesFile): string {
  const name = isShomCable(c) ? 'Shom' : 'OpenStreetMap';
  const edition = file.sources.find((s) => s.source === name && s.licence === c.licence)?.edition ?? null;
  const year = isShomCable(c) && edition !== null ? /^\d{4}/u.exec(edition)?.[0] ?? null : null;
  return `${name} (${c.licence}${year !== null ? `, ${year}` : ''})`;
}

function cableBody(c: SubseaCable, file: SubseaCablesFile): string {
  const source = cableSourceText(c, file);
  const places = [...new Set(c.landings.map(landingPlace))].join(', ');
  const title = c.name ?? `câble télécom · ${source}`;
  const sub = c.outOfService ? 'hors service' : c.name !== null ? `câble télécom · ${source}` : 'câble télécom sous-marin';
  const provenance = isShomCable(c)
    ? `Tracé du Shom, ${source}.`
    : `Tracé OpenStreetMap, précision non garantie. © les contributeurs d’OpenStreetMap, ODbL 1.0, fichier du ${dateOf(file.generatedAt)}.`;
  return head(title, sub)
    + (c.operator !== null ? row('Exploitant', c.operator) : '')
    + row('Atterrages', places !== '' ? places : 'tronçon au large')
    + (c.outOfService ? note('Hors service selon le Shom : tracé gardé en gris, jamais une alerte.') : '')
    + note(provenance);
}

/** Tracés télécom du Shom (référence) et d'OpenStreetMap (compléments), [lng, lat], identifiant du fichier (promoteId) ; hors service : gris. */
export function cableFeatures(file: SubseaCablesFile | null): Fc<GeoJSON.MultiLineString> {
  if (file === null) return fc([]);
  return fc(file.cables.map((c): GeoJSON.Feature<GeoJSON.MultiLineString> => ({
    type: 'Feature', id: c.id,
    geometry: { type: 'MultiLineString', coordinates: c.path.map((line) => line.map(([lng, lat]) => [lng, lat])) },
    properties: {
      id: c.id, name: c.name ?? '', source: c.source, outOfService: c.outOfService, color: c.outOfService ? GREY : CABLE_HEX, body: cableBody(c, file),
    },
  })));
}

/** Atterrages en France, nommés par commune : un point par extrémité retenue (aucun pour un tronçon au large). */
export function landingFeatures(file: SubseaCablesFile | null): Fc<GeoJSON.Point> {
  if (file === null) return fc([]);
  return fc(file.cables.flatMap((c) => c.landings.map((l, i): GeoJSON.Feature<GeoJSON.Point> => ({
    type: 'Feature', geometry: point(l.lon, l.lat),
    properties: {
      id: `${c.id}:${i}`, cable: c.id, outOfService: c.outOfService,
      body: head(landingPlace(l), 'atterrage en France') + row('Câble', c.name ?? `câble télécom · ${cableSourceText(c, file)}`),
    },
  }))));
}

function alertBody(a: CableAlert, muted: boolean, now: number): string {
  const cable = a.cableName ?? (isShomCable({ id: a.cableId }) ? 'câble télécom du Shom, sans nom' : 'câble sans nom');
  return head(`${a.name ?? `MMSI ${a.mmsi}`} · ${a.vesselType ?? 'type n.d.'}`, a.confirmed ? 'Navire lent confirmé sur deux relevés' : 'Navire lent vu une fois, à confirmer')
    + row('Câble', cable)
    + row('Distance au tracé', formatMeters(a.distanceM))
    + row('Vitesse', formatKnots(a.speedKn, 1))
    + row('Dernier relevé', clockOf(a.lastSeen, now))
    + (muted ? note('Veille non évaluée (AIS muet ou flux de la zone muet) : alerte gardée, ni confirmée ni retirée.') : '')
    + note('« À vérifier », jamais une menace. Seule la préfecture maritime qualifie une infraction.');
}

/**
 * Navires lents signalés : confirmé orange, vu une fois jaune (cableAlertLevel) ; AIS muet, flux de la zone muet ou relevé en retard :
 * gris. Un câble du Shom hors service n'a jamais d'alerte (veille côté serveur).
 */
export function cableAlertFeatures(w: CablesWatchResponse | null, now: number): Fc<GeoJSON.Point> {
  if (w === null || w.readAt === null) return fc([]);
  const late = w.evaluated && isSovereigntyDataLate('ais-cables', w.aisLastMessageAt, now);
  return fc(w.alerts.map((a): GeoJSON.Feature<GeoJSON.Point> => {
    const muted = !w.evaluated || a.zoneMuted === true;
    return {
      type: 'Feature', geometry: point(a.lon, a.lat),
      properties: { id: a.id, color: muted ? GREY : vigilanceHex(cableAlertLevel(a, w.evaluated), late), body: alertBody(a, muted, now) },
    };
  }));
}

// ─── Sources, couches, survol ───

/** Sources nouvelles (celles des sites, des zones et des câbles existent déjà dans DeckGLMap). */
export const SOV_SOURCE_IDS: readonly string[] = [
  SRC_SOV_AIRCRAFT, SRC_SOV_AIRCRAFT_ABROAD, SRC_SOV_EMERGENCIES, SRC_SOV_NAVY, SRC_SOV_OSM_WORKS, SRC_SOV_CABLE_VESSELS,
];

export function sovSourceSpec(): GeoJSONSourceSpecification {
  return { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
}

const LABEL_FONT = ['Open Sans Semibold'];

/** Couches nouvelles, toutes masquées jusqu'à setLayerVisibility ; ajoutées au-dessus des câbles. */
export const SOV_LAYERS: readonly LayerSpecification[] = [
  {
    id: LYR_SOV_OSM_WORKS, type: 'circle', source: SRC_SOV_OSM_WORKS, layout: { visibility: 'none' },
    paint: {
      'circle-color': SOV_COLOR, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2, 10, 4], 'circle-opacity': 0.75,
      'circle-stroke-width': 0.5, 'circle-stroke-color': '#0a0a0f',
    },
  },
  {
    id: LYR_SOV_AIRCRAFT_ABROAD, type: 'circle', source: SRC_SOV_AIRCRAFT_ABROAD, layout: { visibility: 'none' },
    paint: { 'circle-color': SOV_COLOR, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3, 10, 5], 'circle-opacity': 0.8 },
  },
  {
    id: LYR_SOV_AIRCRAFT, type: 'circle', source: SRC_SOV_AIRCRAFT, layout: { visibility: 'none' },
    paint: {
      'circle-color': SOV_COLOR, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4, 8, 6, 12, 8],
      'circle-stroke-width': 1, 'circle-stroke-color': '#0a0a0f',
    },
  },
  {
    id: LYR_SOV_EMERGENCIES, type: 'circle', source: SRC_SOV_EMERGENCIES, layout: { visibility: 'none' },
    paint: { 'circle-color': TRANSPARENT, 'circle-radius': 13, 'circle-stroke-width': 3, 'circle-stroke-color': SOV_COLOR },
  },
  {
    id: LYR_SOV_AIRCRAFT_LABEL, type: 'symbol', source: SRC_SOV_AIRCRAFT, minzoom: 6,
    layout: { visibility: 'none', 'text-field': ['get', 'label'], 'text-size': 10, 'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-font': LABEL_FONT },
    paint: { 'text-color': '#e8e8ec', 'text-halo-color': '#0a0a0f', 'text-halo-width': 1.5 },
  },
  {
    id: LYR_SOV_NAVY_REFERENCE, type: 'symbol', source: SRC_SOV_NAVY, filter: ['==', ['get', 'kind'], 'reference'],
    layout: {
      visibility: 'none', 'icon-image': ['get', 'icon'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.26, 8, 0.36, 12, 0.48],
      'icon-allow-overlap': true, 'icon-ignore-placement': true,
    },
    paint: { 'icon-opacity': 0.85 },
  },
  {
    id: LYR_SOV_NAVY_OBSERVED, type: 'symbol', source: SRC_SOV_NAVY, filter: ['==', ['get', 'kind'], 'observed'],
    layout: {
      visibility: 'none', 'icon-image': ['get', 'icon'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.28, 8, 0.38, 12, 0.5],
      'icon-allow-overlap': true, 'icon-ignore-placement': true,
      'text-field': ['get', 'label'], 'text-size': 10, 'text-offset': [0, 1.6], 'text-anchor': 'top', 'text-font': LABEL_FONT, 'text-optional': true,
    },
    paint: { 'text-color': SOV_COLOR, 'text-halo-color': '#0a0a0f', 'text-halo-width': 1.5 },
  },
  {
    id: LYR_SOV_CABLE_VESSELS, type: 'circle', source: SRC_SOV_CABLE_VESSELS, layout: { visibility: 'none' },
    paint: { 'circle-color': SOV_COLOR, 'circle-radius': 6, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#ffffff' },
  },
];

/** Couches MapLibre de chaque couche Souveraineté (visibilité, survol de légende) ; la Vigilance cyber n'en a aucune (V5). */
export const SOV_LAYER_KEYS: Readonly<Record<SovereigntyMapLayer, readonly string[]>> = {
  military: [
    LYR_SOV_AIRCRAFT_ABROAD, LYR_SOV_AIRCRAFT, LYR_SOV_AIRCRAFT_LABEL, LYR_SOV_EMERGENCIES, LYR_SOV_NAVY_REFERENCE, LYR_SOV_NAVY_OBSERVED,
    LYR_MILITARY_BASES_CIRCLE, LYR_MILITARY_BASES_LABEL, LYR_SOV_GNSS_FILL, LYR_SOV_GNSS_LINE,
  ],
  subseaCables: [
    LYR_SUBMARINE_CABLES_GLOW, LYR_SUBMARINE_CABLES, LYR_SUBMARINE_CABLES_CORE, LYR_SUBMARINE_CABLES_HITAREA, LYR_SUBMARINE_CABLES_LANDING,
    LYR_SOV_CABLE_VESSELS,
  ],
};

/** Options éteintes par défaut : ouvrages OpenStreetMap ; zones drones de la DGAC (phase B, tâche B27). */
export const SOV_OPTION_LAYERS: Readonly<{ osmWorks: readonly string[]; droneZones: readonly string[] }> = { osmWorks: [LYR_SOV_OSM_WORKS], droneZones: [LYR_SOV_DRONES_FILL, LYR_SOV_DRONES_LINE] };

/** Couches survolées, de la plus haute à la plus basse : celle qu'on voit au-dessus répond (points avant tracés). */
export const SOV_HOVER_LAYERS: readonly string[] = [
  LYR_SOV_EMERGENCIES, LYR_SOV_AIRCRAFT, LYR_SOV_CABLE_VESSELS, LYR_SOV_NAVY_OBSERVED, LYR_SOV_NAVY_REFERENCE, LYR_SOV_AIRCRAFT_ABROAD,
  LYR_SUBMARINE_CABLES_LANDING, LYR_SOV_OSM_WORKS, LYR_MILITARY_BASES_CIRCLE, LYR_SUBMARINE_CABLES_HITAREA,
  // Phase B (tâche B27) : surfaces, sous tous les points et tracés.
  LYR_SOV_GNSS_FILL, LYR_SOV_DRONES_FILL,
];
const HOVERABLE: ReadonlySet<string> = new Set(SOV_HOVER_LAYERS);

export function topSovHit<T extends { layer: { id: string } }>(hits: readonly T[]): T | undefined {
  for (const id of SOV_HOVER_LAYERS) {
    const hit = hits.find((f) => f.layer.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** Infobulle préparée avec la donnée (propriété `body`, déjà échappée) ; null hors des couches survolables ou sans corps. */
export function sovTooltipHtml(layerId: string, props: Readonly<Record<string, unknown>>): string | null {
  // Zones drones (phase B) : infobulle construite au survol, aucun corps stocké sur 5 541 zones.
  if (layerId === LYR_SOV_DRONES_FILL) return droneZoneTooltipHtml(props);
  const body = props['body'];
  if (typeof body !== 'string' || body === '' || !HOVERABLE.has(layerId)) return null;
  return tip(body);
}

// Phase B (tâche B27) : mailles GNSS et zones drones DGAC (contrats § 5), écrites dans sovereignty-map-b.ts.
export { droneZoneFeatures, gnssCellFeatures } from './sovereignty-map-b.ts';
