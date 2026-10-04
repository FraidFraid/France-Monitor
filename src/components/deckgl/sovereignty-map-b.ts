// src/components/deckgl/sovereignty-map-b.ts : couches de la phase B de la carte Souveraineté (spec 2026-10-04 souveraineté § 3.1,
// § 3.2 ; contrats § 5 ; amendement 7, O15, O17, S6), rangées dans les listes de sovereignty-map.ts (visibilité, option, survol).
// Mailles GNSS : seules celles du jour UTC complet précédent (`cellsDay`) sont dessinées, jamais un lieu en direct ; jaunes et orange
// seulement ; hors de France en gris, jamais comptées ; dégradation générale DE CE JOUR (`days[cellsDay].general`) : mailles françaises
// en contour seul ; grille en retard : tout en gris. « Précision de position dégradée », jamais un brouillage établi. Zones drones DGAC
// (option de la couche Défense, hors agglomérations) : infobulle construite au survol, aucun texte stocké par zone. Couleur portée par
// chaque objet, jamais par la peinture ; texte tiers échappé ; valeurs insécables (R1).
import type { ExpressionSpecification, GeoJSONSourceSpecification, LayerSpecification } from 'maplibre-gl';
import type { DroneZonesFile, GnssCell, GnssResponse } from '../../types/index.ts';
import { DRONES_TITLE } from '../../services/sovereignty-drones.ts';
import { isSovereigntyDataLate } from '../../services/sovereignty-levels.ts';
import { levelHex } from '../../services/vigilance.ts';
import { NBSP, frNumber } from '../layer-panel/format.ts';
import { DRONE_ZONE_HEX, SOV_ABROAD_HEX } from '../layer-panel/sovereignty-legend.ts';
import { coordText } from '../layer-panel/sovereignty-format.ts';
import { LYR_SOV_DRONES_FILL, LYR_SOV_DRONES_LINE, LYR_SOV_GNSS_FILL, LYR_SOV_GNSS_LINE, SRC_SOV_DRONES, SRC_SOV_GNSS } from './constants.ts';
import { escapeHtml } from './format-utils.ts';

type Fc<G extends GeoJSON.Geometry> = GeoJSON.FeatureCollection<G>;
const CELL_DEG = 0.5;
const COLOR: ExpressionSpecification = ['coalesce', ['get', 'color'], SOV_ABROAD_HEX];

function fc<G extends GeoJSON.Geometry>(features: GeoJSON.Feature<G>[]): Fc<G> {
  return { type: 'FeatureCollection', features };
}
function head(title: string, sub: string): string {
  return `<b>${escapeHtml(title)}</b><div class="hm-sub">${escapeHtml(sub)}</div>`;
}
function row(label: string, value: string): string {
  return `<div class="hm-row"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
}
function note(text: string): string {
  return `<div class="hm-note">${escapeHtml(text)}</div>`;
}
function aircraft(n: number): string {
  return `${n}${NBSP}aéronef${n > 1 ? 's' : ''}`;
}
/** « 03/10 » d'un jour UTC « 2026-10-03 » (sans fuseau). */
function utcDay(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

/** Sources de la phase B (ajoutées par DeckGLMap à la place de celle des rectangles « ZIT »). */
export const SOV_B_SOURCE_IDS: readonly string[] = [SRC_SOV_GNSS, SRC_SOV_DRONES];

export function sovBSourceSpec(): GeoJSONSourceSpecification {
  return { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
}

/** Zones drones d'abord (sous les mailles), puis mailles GNSS ; toutes masquées jusqu'à setLayerVisibility. */
export const SOV_B_LAYERS: readonly LayerSpecification[] = [
  {
    id: LYR_SOV_DRONES_FILL, type: 'fill', source: SRC_SOV_DRONES, layout: { visibility: 'none' },
    paint: { 'fill-color': DRONE_ZONE_HEX, 'fill-opacity': 0.16 },
  },
  {
    id: LYR_SOV_DRONES_LINE, type: 'line', source: SRC_SOV_DRONES, layout: { visibility: 'none' },
    paint: { 'line-color': DRONE_ZONE_HEX, 'line-width': 0.8, 'line-opacity': 0.8 },
  },
  {
    id: LYR_SOV_GNSS_FILL, type: 'fill', source: SRC_SOV_GNSS, layout: { visibility: 'none' },
    paint: { 'fill-color': COLOR, 'fill-opacity': ['coalesce', ['get', 'fillOpacity'], 0.3] },
  },
  {
    id: LYR_SOV_GNSS_LINE, type: 'line', source: SRC_SOV_GNSS, layout: { visibility: 'none' },
    paint: { 'line-color': COLOR, 'line-width': ['coalesce', ['get', 'lineWidth'], 0.8], 'line-opacity': 0.9 },
  },
];

/** Maille de 0,5° depuis son coin sud-ouest, [lng, lat]. */
function cellPolygon(c: GnssCell): GeoJSON.Polygon {
  const w = c.lon;
  const s = c.lat;
  return { type: 'Polygon', coordinates: [[[w, s], [w + CELL_DEG, s], [w + CELL_DEG, s + CELL_DEG], [w, s + CELL_DEG], [w, s]]] };
}

function cellBody(c: GnssCell, day: string, general: boolean, late: boolean): string {
  const verdict = !c.inFrance ? 'Hors de France : jamais comptée.'
    : general ? 'Dégradation générale ce jour-là, probablement météo spatiale : non comptée.'
      : 'À vérifier : seules la DGAC et l’ANFR qualifient un brouillage.';
  return head('Maille GNSS : précision de position dégradée', `${coordText(c.lat + CELL_DEG / 2, c.lon + CELL_DEG / 2)} · mailles du ${utcDay(day)}, jour UTC complet`)
    + row('Part dégradée', c.pct === null ? 'n.d.' : `${frNumber(c.pct, 1)}${NBSP}%`)
    + row('Au calcul', aircraft(c.good + c.degraded))
    + row('Précision dégradée', aircraft(c.degraded))
    + row('Sans précision déclarée', aircraft(c.unknown))
    + note(verdict)
    + (late ? note('(en retard) : couleurs retirées') : '');
}

/**
 * Mailles jaunes et orange du jour UTC complet précédent (`cellsDay`) ; rien si la veille n'est pas couverte (`cellsDay` nul ou `cells` vide)
 * ou si la grille n'a jamais été complète. La couleur d'une maille française suit `days[cellsDay].general`, jamais `generalDegradation`
 * (fenêtre glissante).
 */
export function gnssCellFeatures(g: GnssResponse | null, now: number): Fc<GeoJSON.Polygon> {
  if (g === null || g.readAt === null || g.cellsDay === null || g.cells.length === 0) return fc([]);
  const day = g.cellsDay;
  const late = isSovereigntyDataLate('adsb-gnss', g.readAt, now);
  const general = g.days.days.find((d) => d.date === day)?.general === true;
  return fc(g.cells.filter((c) => c.level === 'jaune' || c.level === 'orange').map((c): GeoJSON.Feature<GeoJSON.Polygon> => {
    const outline = c.inFrance && general;
    const color = late || !c.inFrance ? SOV_ABROAD_HEX : levelHex(c.level === 'orange' ? 'orange' : 'jaune');
    return {
      type: 'Feature',
      geometry: cellPolygon(c),
      properties: {
        cell: `${c.lat}:${c.lon}`, color, fillOpacity: outline ? 0 : c.inFrance ? 0.32 : 0.2, lineWidth: outline ? 1.6 : 0.8,
        body: cellBody(c, day, general, late),
      },
    };
  }));
}

/** Zones drones du fichier publié : identifiant, remarque, édition du jeu (l'infobulle est construite au survol). */
export function droneZoneFeatures(file: DroneZonesFile | null): Fc<GeoJSON.MultiPolygon> {
  if (file === null) return fc([]);
  return fc(file.zones.map((z): GeoJSON.Feature<GeoJSON.MultiPolygon> => ({
    type: 'Feature',
    geometry: { type: 'MultiPolygon', coordinates: z.polygons },
    properties: { id: z.id, remarque: z.remarque ?? '', edition: file.edition },
  })));
}

/** « 07-2025 » pour l'édition « 2025-07-01 » de la Géoplateforme ; n.d. sinon. */
function editionText(edition: unknown): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(typeof edition === 'string' ? edition : '');
  return m ? `${m[2]}-${m[1]}` : 'n.d.';
}

/** Infobulle d'une zone drones (appelée par sovTooltipHtml de sovereignty-map.ts), texte tiers échappé. */
export function droneZoneTooltipHtml(props: Readonly<Record<string, unknown>>): string {
  const remarque = typeof props['remarque'] === 'string' ? props['remarque'] : '';
  return '<div class="hm-tip">'
    + head('Zone drones : vol interdit', 'DGAC / IGN, Géoplateforme')
    + note(`Couche officielle « ${DRONES_TITLE} »`)
    + (remarque !== '' ? row('Remarque', remarque) : '')
    + note(`Zone permanente hors agglomérations, à jour au ${editionText(props['edition'])} ; les interdictions temporaires (NOTAM) ne sont pas couvertes.`)
    + note('Tracé simplifié pour la carte : la carte officielle fait foi.')
    + '</div>';
}
