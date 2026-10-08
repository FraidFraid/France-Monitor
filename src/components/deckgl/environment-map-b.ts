// src/components/deckgl/environment-map-b.ts : couches Environnement de la phase B (spec 2026-10-04 environnement § 3, contrats § 5),
// parties pures : sources et couches MapLibre, géométries, couleur, rayon et ordre portés par chaque objet, infobulles .hm-tip
// préparées et échappées. MapLibre ne lit pas les variables CSS : niveaux en levelHex (palette L1), catégories en hex de
// environment-legend.ts. Donnée en retard (S2) : teinte neutre, jamais une couleur de niveau. Réexporté par environment-map.ts.
import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl';
import type {
  AirIndexDept, AirQualityResponse, DroughtDept, DroughtLevel, DroughtResponse, EarthquakesResponse, Quake, SeaLevelsResponse, TideGauge, VigilanceCoastDomain,
  VigilanceResponse,
} from '../../types/index.ts';
import { isEnvironmentDataLate, quakeInFrance, quakePlace } from '../../services/environment-levels.ts';
import { levelHex } from '../../services/vigilance.ts';
import { NBSP, frNumber } from '../layer-panel/format.ts';
import { departementName } from '../layer-panel/health-format.ts';
import {
  AIR_INDEX_WORD, COLOR_LEVEL, COLOR_WORD, DROUGHT_LEVEL, DROUGHT_WORD, QUAKE_DISPLAY_MIN, airIndexLevel, capitalize, clockOf, dayMonthClock, formatChangeM,
  formatHeightM, formatKm, formatMagnitude, formatShare, quakeLevel,
} from '../layer-panel/environment-format.ts';
import { CAT_SECHERESSE_VIGILANCE_HEX, DROUGHT_UNAVAILABLE_HEX, ENV_NEUTRAL_HEX, QUAKE_ABROAD_HEX, QUAKE_WEAK_HEX } from '../layer-panel/environment-legend.ts';
import { CAT_PORT_HEX } from '../layer-panel/traffic-legend.ts';
import {
  LYR_AIR_FILL, LYR_AIR_LINE, LYR_DROUGHT_FILL, LYR_DROUGHT_LINE, LYR_QUAKES, LYR_OUT_TELECOM_MAINT, LYR_QUAKE_LABEL, LYR_TIDE_GAUGES, LYR_WEATHER_FILL, SRC_AIR_QUALITY, SRC_DROUGHT,
  SRC_QUAKES, SRC_TIDE_GAUGES,
} from './constants.ts';
import { escapeHtml } from './format-utils.ts';

type Fc<G extends GeoJSON.Geometry = GeoJSON.Geometry> = GeoJSON.FeatureCollection<G>;
const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const OUTLINE_HEX = '#111111';

function fc<G extends GeoJSON.Geometry>(features: GeoJSON.Feature<G>[]): Fc<G> {
  return { type: 'FeatureCollection', features };
}
function point(lon: number, lat: number): GeoJSON.Point {
  return { type: 'Point', coordinates: [lon, lat] };
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
function codeOf(f: GeoJSON.Feature): string {
  const code: unknown = f.properties?.['code'];
  return typeof code === 'string' ? code : String(code ?? '');
}

// ─── Sécheresse (§ 3.1) ───

function droughtWord(level: DroughtLevel | null): string {
  return level === null ? 'aucun arrêté' : DROUGHT_WORD[level];
}

function droughtHex(x: DroughtDept, late: boolean): string {
  // Amendement 15 : donnée indisponible (« unavailable ») en gris, distincte d'un département sans arrêté (non rempli).
  if (!x.available) return DROUGHT_UNAVAILABLE_HEX;
  if (x.max === null) return TRANSPARENT;
  if (late) return ENV_NEUTRAL_HEX;
  const l = DROUGHT_LEVEL[x.max];
  return l === 'categorie' ? CAT_SECHERESSE_VIGILANCE_HEX : levelHex(l);
}

function droughtBody(x: DroughtDept, d: DroughtResponse, late: boolean): string {
  if (!x.available) {
    return head(`${x.name} (${x.dept})`, 'donnée indisponible')
      + note('VigiEau ne publie pas les arrêtés de ce département (« unavailable ») : donnée indisponible, pas une absence d’arrêté.');
  }
  return head(`${x.name} (${x.dept})`, `niveau le plus haut : ${droughtWord(x.max)}`)
    + row('Eaux superficielles', droughtWord(x.superficielle)) + row('Eaux souterraines', droughtWord(x.souterraine)) + row('Eau potable', droughtWord(x.potable))
    + note(`Arrêtés en vigueur au ${dayMonthClock(d.asOf)}${late ? ' (en retard) : couleur retirée' : ''}.`);
}

/** Départements de métropole remplis par le niveau le plus haut de leurs arrêtés ; sans arrêté : non rempli (infobulle gardée). */
export function droughtDeptFeatures(geo: GeoJSON.FeatureCollection, d: DroughtResponse | null, now: number): Fc {
  if (!d) return fc([]);
  const late = isEnvironmentDataLate('vigieau', d.asOf, now);
  const byCode = new Map(d.departments.map((x) => [x.dept, x]));
  return fc(geo.features.flatMap((f): GeoJSON.Feature[] => {
    const code = codeOf(f);
    const x = byCode.get(code);
    if (!x || !f.geometry) return [];
    return [{ type: 'Feature', geometry: f.geometry, properties: { code, color: droughtHex(x, late), body: droughtBody(x, d, late) } }];
  }));
}

// ─── Qualité de l'air (§ 3.2) ───

function airBody(code: string, x: AirIndexDept | undefined, a: AirQualityResponse, late: boolean, now: number): string {
  const name = `${departementName(code)} (${code})`;
  if (!x || x.maxIndex === null) return head(name, 'pas d’indice ATMO publié ce jour') + note('Département non couvert par une AASQA ce jour.');
  const degraded = x.degrade + x.mauvais + x.tresMauvaisEtPlus;
  const day = a.index.date ? `${a.index.date.slice(8, 10)}/${a.index.date.slice(5, 7)}` : 'n.d.';
  return head(name, `indice le plus haut : ${AIR_INDEX_WORD[x.maxIndex] ?? String(x.maxIndex)}`)
    + row('Communes couvertes', frNumber(x.communes, 0))
    + row('Dégradé ou pire', `${frNumber(degraded, 0)} (${formatShare(x.communes > 0 ? (degraded / x.communes) * 100 : null)})`)
    + note(`Indice ATMO du ${day}, mis à jour ${clockOf(a.index.updatedAt, now)}${late ? ' (en retard) : couleur retirée' : ''} ; couleurs de l’échelle FranceMonitor, pas la palette officielle ATMO.`);
}

/** Départements remplis par l'indice ATMO le plus haut de leurs communes (palette L1, amendement 5) ; sans indice : non rempli. */
export function airDeptFeatures(geo: GeoJSON.FeatureCollection, a: AirQualityResponse | null, now: number): Fc {
  if (!a) return fc([]);
  const late = isEnvironmentDataLate('atmo', a.index.updatedAt, now);
  const byCode = new Map(a.index.departments.map((x) => [x.dept, x]));
  return fc(geo.features.flatMap((f): GeoJSON.Feature[] => {
    if (!f.geometry) return [];
    const code = codeOf(f);
    const x = byCode.get(code);
    const color = !x || x.maxIndex === null ? TRANSPARENT : late ? ENV_NEUTRAL_HEX : levelHex(airIndexLevel(x.maxIndex));
    return [{ type: 'Feature', geometry: f.geometry, properties: { code, color, body: airBody(code, x, a, late, now) } }];
  }));
}

// ─── Séismes (§ 3.3) ───

/** Rayon (px) proportionnel à la magnitude : 5,2 pour M 1, 8,5 pour M 2,5, 14 pour M 5. */
export function quakeRadius(m: number): number {
  return Math.round((3 + 2.2 * Math.max(0, m)) * 10) / 10;
}

/** Couleur d'un séisme : en retard neutre ; hors de France gris ; en France l'échelle des magnitudes, sous 2,5 gris clair. */
export function quakeHex(q: Quake, late: boolean): string {
  if (late) return ENV_NEUTRAL_HEX;
  if (!quakeInFrance(q)) return QUAKE_ABROAD_HEX;
  const level = quakeLevel(q.magnitude);
  return level === 'gris' ? QUAKE_WEAK_HEX : levelHex(level);
}

function quakeBody(q: Quake, late: boolean, now: number): string {
  const where = quakeInFrance(q)
    ? (q.dept !== null ? departementName(q.dept) : `en mer, à ${formatKm(q.distanceKm, 0)} des côtes`)
    : `hors de France, à ${formatKm(q.distanceKm, 0)} de la frontière`;
  return head(`${formatMagnitude(q.magnitude)} · ${capitalize(quakePlace(q))}`, where)
    + row('Heure', clockOf(q.at, now)) + row('Profondeur', q.depthKm !== null ? formatKm(q.depthKm, 0) : 'n.d.')
    + row('Statut', q.status) + row('Source', q.source)
    + (q.magnitude < QUAKE_DISPLAY_MIN ? note('Sous le seuil d’affichage (magnitude 2,5) : gris clair.') : '')
    + (late ? note('Relevé en retard : couleur retirée.') : '');
}

export function quakeFeatures(q: EarthquakesResponse | null, now: number): Fc<GeoJSON.Point> {
  if (!q) return fc([]);
  const late = isEnvironmentDataLate('bcsf', q.readAt, now);
  return fc(q.quakes.map((x): GeoJSON.Feature<GeoJSON.Point> => ({
    type: 'Feature', geometry: point(x.lon, x.lat),
    properties: {
      id: x.id, color: quakeHex(x, late), radius: quakeRadius(x.magnitude), sortKey: Math.round(x.magnitude * 10),
      label: quakeInFrance(x) && x.magnitude >= 3 ? formatMagnitude(x.magnitude) : '', body: quakeBody(x, late, now),
    },
  })));
}

// ─── Marégraphes (§ 3.4), avec la couche Vigilance météo ───

function gaugeBody(g: TideGauge, domain: VigilanceCoastDomain | null, late: boolean, now: number): string {
  return head(g.name, domain ? `${domain.name} : ${COLOR_WORD[domain.color]}` : `domaine ${g.coastDomain}`)
    + row('Hauteur d’eau', formatHeightM(g.heightM)) + row(`Variation sur 1${NBSP}h`, formatChangeM(g.change1hM)) + row('Mesure', clockOf(g.lastAt, now))
    + note('Marégraphe SHOM, hauteur au-dessus du zéro hydrographique, marée comprise.')
    + (late ? note('Mesure en retard : couleur retirée.') : '');
}

/** Marégraphes : disque en teinte de port ; anneau de la couleur du domaine littoral du jour quand il est en vigilance. */
export function tideGaugeFeatures(s: SeaLevelsResponse | null, v: VigilanceResponse | null, now: number): Fc<GeoJSON.Point> {
  if (!s) return fc([]);
  const period = v?.periods.find((p) => p.echeance === 'J') ?? null;
  return fc(s.gauges.map((g): GeoJSON.Feature<GeoJSON.Point> => {
    const late = isEnvironmentDataLate('refmar', g.lastAt, now);
    const domain = period?.coast.find((d) => d.code === g.coastDomain) ?? null;
    const ring = late || !domain || domain.color < 2 ? OUTLINE_HEX : levelHex(COLOR_LEVEL[domain.color]);
    return {
      type: 'Feature', geometry: point(g.lon, g.lat),
      properties: { id: String(g.id), color: late || g.lastAt === null ? ENV_NEUTRAL_HEX : CAT_PORT_HEX, ring, body: gaugeBody(g, domain, late, now) },
    };
  }));
}

// ─── Sources, couches, survol ───

const COLOR: ExpressionSpecification = ['coalesce', ['get', 'color'], ENV_NEUTRAL_HEX];
const RADIUS: ExpressionSpecification = ['coalesce', ['get', 'radius'], 4];
const SORT: ExpressionSpecification = ['coalesce', ['get', 'sortKey'], 0];
const RING: ExpressionSpecification = ['coalesce', ['get', 'ring'], OUTLINE_HEX];

export const ENV_B_SOURCE_IDS: readonly string[] = [SRC_DROUGHT, SRC_AIR_QUALITY, SRC_QUAKES, SRC_TIDE_GAUGES];

/** Remplissages départementaux, sous les couches de la phase A. */
export const ENV_B_FILL_LAYERS: readonly LayerSpecification[] = [
  { id: LYR_DROUGHT_FILL, type: 'fill', source: SRC_DROUGHT, layout: { visibility: 'none' }, paint: { 'fill-color': COLOR, 'fill-opacity': 0.45 } },
  { id: LYR_DROUGHT_LINE, type: 'line', source: SRC_DROUGHT, layout: { visibility: 'none' }, paint: { 'line-color': '#1a1a2e', 'line-width': 0.6, 'line-opacity': 0.8 } },
  { id: LYR_AIR_FILL, type: 'fill', source: SRC_AIR_QUALITY, layout: { visibility: 'none' }, paint: { 'fill-color': COLOR, 'fill-opacity': 0.45 } },
  { id: LYR_AIR_LINE, type: 'line', source: SRC_AIR_QUALITY, layout: { visibility: 'none' }, paint: { 'line-color': '#1a1a2e', 'line-width': 0.6, 'line-opacity': 0.8 } },
];

/**
 * Couche sous laquelle insérer chaque remplissage de la phase B (fusionné dans ENV_LAYER_BEFORE de la tâche 15) : sous la vigilance,
 * donc sous les crues et les feux ; sans cette entrée, la boucle d'insertion de la tâche 15 les poserait au-dessus des feux.
 */
export const ENV_B_LAYER_BEFORE: Readonly<Record<string, string>> = Object.fromEntries(ENV_B_FILL_LAYERS.map((l) => [l.id, LYR_WEATHER_FILL]));

/** Points, au-dessus des couches de la phase A. */
export const ENV_B_POINT_LAYERS: readonly LayerSpecification[] = [
  {
    id: LYR_QUAKES, type: 'circle', source: SRC_QUAKES, layout: { 'circle-sort-key': SORT, visibility: 'none' },
    paint: { 'circle-color': COLOR, 'circle-radius': RADIUS, 'circle-opacity': 0.85, 'circle-stroke-width': 1, 'circle-stroke-color': OUTLINE_HEX },
  },
  {
    id: LYR_QUAKE_LABEL, type: 'symbol', source: SRC_QUAKES,
    layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-font': ['Open Sans Semibold'], visibility: 'none' },
    paint: { 'text-color': '#ffffff', 'text-halo-color': '#0a0a0f', 'text-halo-width': 2 },
  },
  {
    id: LYR_TIDE_GAUGES, type: 'circle', source: SRC_TIDE_GAUGES, layout: { visibility: 'none' },
    paint: { 'circle-color': COLOR, 'circle-radius': 6, 'circle-stroke-width': 2, 'circle-stroke-color': RING },
  },
];

/** Couches survolables de la phase B (infobulle préparée avec la donnée, propriété `body`). */
export const ENV_B_HOVERABLE: readonly string[] = [LYR_DROUGHT_FILL, LYR_AIR_FILL, LYR_QUAKES, LYR_TIDE_GAUGES];

/** Couches MapLibre des trois nouvelles couches ; branchées sur MapLayers à la tâche 31 (les marégraphes suivent `environmental`). */
export const ENV_B_LAYER_KEYS: Readonly<Record<'drought' | 'airQuality' | 'earthquakes', readonly string[]>> = {
  drought: [LYR_DROUGHT_FILL, LYR_DROUGHT_LINE],
  airQuality: [LYR_AIR_FILL, LYR_AIR_LINE],
  earthquakes: [LYR_QUAKES, LYR_QUAKE_LABEL],
};

// ─── Réaffichage (S2) ───

/** Dernières réponses reçues par les couches de la phase B (gardées même couche masquée). */
export interface EnvBData {
  drought: DroughtResponse | null;
  air: AirQualityResponse | null;
  quakes: EarthquakesResponse | null;
  seaLevels: SeaLevelsResponse | null;
  vigilance: VigilanceResponse | null;
}

export type EnvBLayerState = Partial<Record<'drought' | 'airQuality' | 'earthquakes' | 'environmental', boolean>>;

/**
 * Sources à repeindre quand une couche passe de masquée à visible : couleurs recalculées avec l'horloge courante (S2), une donnée
 * devenue en retard pendant que la couche était masquée repasse neutre. Les marégraphes suivent la couche Vigilance météo.
 * Départements fournis par l'appelant (null : pas encore lus, sources départementales laissées telles quelles).
 */
export function envBReshowPaints(
  was: EnvBLayerState, layers: EnvBLayerState, data: EnvBData, geo: GeoJSON.FeatureCollection | null, now: number,
): Array<{ source: string; data: GeoJSON.FeatureCollection }> {
  const shown = (k: keyof EnvBLayerState): boolean => (layers[k] ?? false) && !(was[k] ?? false);
  const out: Array<{ source: string; data: GeoJSON.FeatureCollection }> = [];
  if (shown('drought') && geo && data.drought) out.push({ source: SRC_DROUGHT, data: droughtDeptFeatures(geo, data.drought, now) });
  if (shown('airQuality') && geo && data.air) out.push({ source: SRC_AIR_QUALITY, data: airDeptFeatures(geo, data.air, now) });
  if (shown('earthquakes') && data.quakes) out.push({ source: SRC_QUAKES, data: quakeFeatures(data.quakes, now) });
  if (shown('environmental') && data.seaLevels) out.push({ source: SRC_TIDE_GAUGES, data: tideGaugeFeatures(data.seaLevels, data.vigilance, now) });
  return out;
}

/** Couche sous laquelle placer les points de la phase B : la première couche de points ajoutée après la dernière surface (fills) de la carte. */
export const ENV_B_POINTS_ANCHOR = LYR_OUT_TELECOM_MAINT;

/**
 * Place séismes et marégraphes (et l'étiquette des séismes) sous l'ancre, donc au-dessus de toutes les surfaces (tension carburants,
 * zones militaires) quand elles sont actives. À appeler une fois l'ancre ajoutée à la carte.
 */
export function placeEnvBPoints(map: { getLayer(id: string): unknown; moveLayer(id: string, before?: string): unknown }): void {
  if (!map.getLayer(ENV_B_POINTS_ANCHOR)) return;
  for (const l of ENV_B_POINT_LAYERS) if (map.getLayer(l.id)) map.moveLayer(l.id, ENV_B_POINTS_ANCHOR);
}
