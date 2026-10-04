// src/components/deckgl/environment-map.ts : couches Environnement de la carte (spec 2026-10-04 environnement § 2.1 à 2.4 ; contrats
// § 5), parties pures : sources et couches MapLibre, géométries, couleurs, infobulles. MapLibre ne lit pas les variables CSS : niveaux
// en levelHex (palette L1), catégories copiées des jetons de main.css (layer-panel/environment-legend.ts). Donnée en retard (S2) :
// teinte neutre, jamais une couleur de niveau. Couleur, rayon et ordre calculés ici, dans les propriétés ; tout texte est échappé ;
// valeurs insécables (R1). Aucune vue importée.
import type { ExpressionSpecification, GeoJSONSourceSpecification, LayerSpecification } from 'maplibre-gl';
import type {
  FireDetection, FireFoyer, FiresResponse, FloodSection, FloodStation, FloodsResponse, OfficialColorId, VigilanceDepartment, VigilanceEcheance,
  VigilanceResponse,
} from '../../types/index.ts';
import { departementCentroid } from '../../config/departements.ts';
import { forestDangerCurrent, foyerLevel, isEnvironmentDataLate, parisDayOf, stationLate, vigilancePeriodOf } from '../../services/environment-levels.ts';
import { levelHex, type VigilanceLevel } from '../../services/vigilance.ts';
import {
  COLOR_WORD, FOREST_DANGER_LEVEL, FOREST_DANGER_WORD, PHENOMENON_ICON, PHENOMENON_LABEL, SATELLITE_WORD, capitalize, clockOf, formatAge, formatChangeM,
  formatFlowM3s, formatFrp, formatHeightM, parisDayWord, slotText,
} from '../layer-panel/environment-format.ts';
import { NBSP } from '../layer-panel/format.ts';
import { ENV_NEUTRAL_HEX, FIRE_ABROAD_HEX, FIRE_RECURRENT_HEX, FLOOD_STATION_HEX } from '../layer-panel/environment-legend.ts';
import { departementName } from '../layer-panel/health-format.ts';
import type { IconName } from '../shared/icons.ts';
import {
  LYR_FIRES_ABROAD, LYR_FIRES_GLOW, LYR_FIRES_HIGHLIGHT, LYR_FIRES_POINTS, LYR_FLOODS, LYR_FLOOD_STATIONS, LYR_FOREST_DANGER_FILL,
  LYR_FOREST_DANGER_LINE, LYR_RADAR_PICK, LYR_WEATHER_FILL, LYR_WEATHER_ICONS, LYR_WEATHER_LINE, LYR_WEATHER_LINE_ORANGE, LYR_WEATHER_LINE_RED,
  LYR_WEATHER_LINE_YELLOW, SRC_FIRES_ABROAD, SRC_FLOOD_STATIONS, SRC_FOREST_DANGER, SRC_RADAR_PICK, SRC_WEATHER_ICONS,
} from './constants.ts';
import { deptCodeToId, escapeHtml } from './format-utils.ts';

type Fc<G extends GeoJSON.Geometry = GeoJSON.Geometry> = GeoJSON.FeatureCollection<G>;
export type EnvironmentMapLayer = 'environmental' | 'floods' | 'weatherRadar' | 'fires';

function fc<G extends GeoJSON.Geometry>(features: GeoJSON.Feature<G>[]): Fc<G> {
  return { type: 'FeatureCollection', features };
}

function point(lon: number, lat: number): GeoJSON.Point {
  return { type: 'Point', coordinates: [lon, lat] };
}

// ─── Infobulles : gabarit .hm-tip de la santé et des Trafics ; libellés et valeurs échappés ───

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

/** Couleur d'un niveau ; donnée en retard (S2) : teinte neutre, jamais une couleur de niveau. */
function envHex(level: VigilanceLevel, late: boolean): string {
  return late ? ENV_NEUTRAL_HEX : levelHex(level);
}

/** Couleur portée par chaque objet (calculée ici, jamais par la peinture). */
export const ENV_COLOR: ExpressionSpecification = ['coalesce', ['get', 'color'], ENV_NEUTRAL_HEX];
const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const OFFICIAL_LEVEL: Readonly<Record<OfficialColorId, VigilanceLevel>> = { 1: 'vert', 2: 'jaune', 3: 'orange', 4: 'rouge' };
/** Clé du niveau lue par les filtres et l'opacité des couches météo existantes (LYR_WEATHER_LINE_*, LYR_WEATHER_FILL). */
const PAINT_LEVEL: Readonly<Record<OfficialColorId, 'green' | 'yellow' | 'orange' | 'red'>> = { 1: 'green', 2: 'yellow', 3: 'orange', 4: 'red' };

/** « 04/10 14:27 » (heure de Paris, toujours datée). */
function parisStamp(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'n.d.';
  const d = new Date(ms);
  return `${d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit' })}${NBSP}${d.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })}`;
}

// ─── Vigilance météo (§ 2.1) ───

/** Image MapLibre d'un pictogramme de phénomène (enregistrée en SDF par DeckGLMap.registerEnvironmentIcons). */
export function envIconImage(name: IconName): string {
  return `env-icon-${name}`;
}

/** Côté de l'image d'un pictogramme (pixels) : le tracé occupe `ENV_ICON_GLYPH`, le reste est la marge du champ de distance. */
export const ENV_ICON_SIZE = 64;
export const ENV_ICON_GLYPH = 48;
/** Rayon du dégradé du champ de distance (pixels) : la marge autour du tracé en dépend, jamais l'inverse. */
export const ENV_ICON_SDF_RADIUS = 8;
/** Marge de chaque côté du tracé : au moins le rayon, sinon le dégradé serait coupé. */
export const ENV_ICON_MARGIN = (ENV_ICON_SIZE - ENV_ICON_GLYPH) / 2;

/**
 * Champ de distance signé (SDF, alpha d'une image MapLibre `sdf: true`) calculé depuis l'alpha d'un dessin : bord à 0,75 (192),
 * dégradé sur `radius` pixels de part et d'autre. Un dessin enregistré tel quel en SDF a un alpha de 0 ou 255 : bords crénelés.
 * Distance euclidienne exacte (Felzenszwalb), alpha fractionnaire des bords pris en compte (méthode de tiny-sdf).
 */
export function alphaToSdf(rgba: ArrayLike<number>, size: number, radius = ENV_ICON_SDF_RADIUS, cutoff = 0.25): Uint8ClampedArray {
  const n = size * size;
  const INF = 1e20;
  const outer = new Float64Array(n);
  const inner = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const a = (rgba[i * 4 + 3] ?? 0) / 255;
    outer[i] = a === 1 ? 0 : a === 0 ? INF : Math.max(0, 0.5 - a) ** 2;
    inner[i] = a === 1 ? INF : a === 0 ? 0 : Math.max(0, a - 0.5) ** 2;
  }
  edt(outer, size);
  edt(inner, size);
  const out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i += 1) {
    const d = Math.sqrt(outer[i] ?? 0) - Math.sqrt(inner[i] ?? 0);
    out[i] = Math.round(255 - 255 * (d / radius + cutoff));
  }
  return out;
}

/** Transformée de distance euclidienne au carré, en place, lignes puis colonnes. */
function edt(grid: Float64Array, size: number): void {
  const f = new Float64Array(size);
  const z = new Float64Array(size + 1);
  const v = new Int32Array(size);
  const d = new Float64Array(size);
  const pass = (at: (k: number) => number, put: (k: number, val: number) => void): void => {
    for (let q = 0; q < size; q += 1) f[q] = at(q);
    let k = 0;
    v[0] = 0;
    z[0] = -1e20;
    z[1] = 1e20;
    for (let q = 1; q < size; q += 1) {
      let s = 0;
      do {
        const r = v[k] ?? 0;
        s = ((f[q] ?? 0) - (f[r] ?? 0) + q * q - r * r) / (q - r) / 2;
      } while (s <= (z[k] ?? 0) && (k -= 1) > -1);
      k += 1;
      v[k] = q;
      z[k] = s;
      z[k + 1] = 1e20;
    }
    k = 0;
    for (let q = 0; q < size; q += 1) {
      while ((z[k + 1] ?? 0) < q) k += 1;
      const p = v[k] ?? 0;
      d[q] = (q - p) * (q - p) + (f[p] ?? 0);
    }
    for (let q = 0; q < size; q += 1) put(q, d[q] ?? 0);
  };
  for (let x = 0; x < size; x += 1) pass((y) => grid[y * size + x] ?? 0, (y, val) => { grid[y * size + x] = val; });
  for (let y = 0; y < size; y += 1) pass((x) => grid[y * size + x] ?? 0, (x, val) => { grid[y * size + x] = val; });
}

/** Pictogrammes distincts des phénomènes, à enregistrer une fois. */
export const ENV_ICON_NAMES: readonly IconName[] = [...new Set(Object.values(PHENOMENON_ICON))];

function vigilanceBody(d: VigilanceDepartment, v: VigilanceResponse, begin: string, late: boolean, now: number): string {
  const rows = d.phenomena.map((p) => {
    const colored = p.slots.filter((s) => s.color >= 2).map((s) => slotText(s, now));
    return row(capitalize(PHENOMENON_LABEL[p.id]), colored.length > 0 ? colored.join(', ') : `${COLOR_WORD[p.color]}, toute l’échéance`);
  }).join('');
  return head(`${d.name} (${d.code})`, `Vigilance ${COLOR_WORD[d.color]} ${parisDayWord(parisDayOf(Date.parse(begin)), now)}`)
    + rows
    + note(`Météo-France, carte de ${v.updateTime ? clockOf(v.updateTime, now) : 'n.d.'}.`)
    + (late ? note('Carte en retard : couleur retirée.') : '');
}

/**
 * Départements de l'échéance choisie (J ou J+1) : jaune, orange, rouge en levelHex ; vert sans remplissage (hasAlert faux) ; carte en
 * retard : gris neutre. Les polygones (departements.geojson) sont copiés, jamais modifiés. Identifiant numérique pour l'état de survol.
 */
export function vigilanceDeptFeatures(geo: GeoJSON.FeatureCollection, v: VigilanceResponse | null, echeance: VigilanceEcheance, now: number): GeoJSON.FeatureCollection {
  const period = v ? vigilancePeriodOf(v, echeance) : null;
  const late = v !== null && isEnvironmentDataLate('vigilance', v.updateTime, now);
  const byCode = new Map((period?.departments ?? []).map((d) => [d.code, d]));
  return fc(geo.features.map((f): GeoJSON.Feature => {
    const code = String(f.properties?.['code'] ?? '');
    const d = byCode.get(code);
    const color = d ? envHex(OFFICIAL_LEVEL[d.color], late) : null;
    return {
      ...f,
      id: deptCodeToId(code),
      properties: {
        ...(f.properties ?? {}),
        code,
        color,
        fillColor: color ?? TRANSPARENT,
        lineColor: color ?? TRANSPARENT,
        hasAlert: d !== undefined,
        level: PAINT_LEVEL[d?.color ?? 1],
        body: d && v && period ? vigilanceBody(d, v, period.begin, late, now) : '',
      },
    };
  }));
}

/** Pictogramme du phénomène le plus fort au centroïde de chaque département en vigilance ; `now` donne le retard (S2). */
export function vigilanceIconFeatures(v: VigilanceResponse | null, echeance: VigilanceEcheance, now?: number): Fc<GeoJSON.Point> {
  const period = v ? vigilancePeriodOf(v, echeance) : null;
  if (!v || !period) return fc([]);
  const late = now !== undefined && isEnvironmentDataLate('vigilance', v.updateTime, now);
  return fc(period.departments.flatMap((d): GeoJSON.Feature<GeoJSON.Point>[] => {
    const top = d.phenomena[0];
    const centroid = departementCentroid(d.code);
    if (!top || !centroid) return [];
    return [{
      type: 'Feature', geometry: point(centroid[0], centroid[1]),
      properties: { code: d.code, iconImage: envIconImage(PHENOMENON_ICON[top.id]), color: envHex(OFFICIAL_LEVEL[d.color], late), sortKey: d.color },
    }];
  }));
}

// ─── Crues (§ 2.2) ───

function sectionBody(s: FloodSection, f: FloodsResponse, late: boolean, now: number): string {
  return head(s.name, `Vigilance ${COLOR_WORD[s.level]} · ${s.territory.name ?? `territoire ${s.territory.code}`}`)
    + row('Stations suivies', String(s.stations.length))
    + note(`Relevé Vigicrues ${f.readAt ? clockOf(f.readAt, now) : 'n.d.'} (le flux ne publie pas d’heure de bulletin).`)
    + (late ? note('Relevé en retard : couleur retirée.') : '');
}

/** Tronçons jaunes, orange et rouges (aussi en v2) avec leur tracé publié ; relevé en retard : gris neutre. */
export function floodSectionFeatures(f: FloodsResponse | null, now: number): Fc<GeoJSON.MultiLineString> {
  if (!f) return fc([]);
  const late = isEnvironmentDataLate('vigicrues', f.readAt, now);
  return fc(f.sections.filter((s) => s.level >= 2 && s.path.length > 0).map((s): GeoJSON.Feature<GeoJSON.MultiLineString> => ({
    type: 'Feature', id: s.id,
    geometry: { type: 'MultiLineString', coordinates: s.path.map((line) => line.map(([lng, lat]) => [lng, lat])) },
    properties: { id: s.id, name: s.name, color: envHex(OFFICIAL_LEVEL[s.level], late), body: sectionBody(s, f, late, now) },
  })));
}

function stationBody(st: FloodStation, section: FloodSection, late: boolean, now: number): string {
  return head(st.name, `Station de la vigilance ${section.name}`)
    + row('Hauteur', formatHeightM(st.heightM))
    + row('Variation sur 1 h', formatChangeM(st.change1hM))
    + (st.flowM3s !== null ? row('Débit', formatFlowM3s(st.flowM3s)) : '')
    + row('Mesure', st.lastAt ? clockOf(st.lastAt, now) : 'n.d.')
    + note('Hauteur au repère de la station, pas une cote d’alerte : Vigicrues ne publie pas les seuils en API.')
    + (late ? note('Mesure de plus d’une heure : couleur retirée.') : '');
}

/**
 * Stations des tronçons en vigilance : teinte de station, anneau rouge si la hauteur monte sur 1 h, vert si elle baisse ; variation lue
 * au centimètre, comme elle est affichée (« +0,01 m ») : sous 5 mm, aucun anneau ; en retard : gris, sans anneau.
 */
export function floodStationFeatures(f: FloodsResponse | null, now: number): Fc<GeoJSON.Point> {
  if (!f) return fc([]);
  return fc(f.sections.filter((s) => s.level >= 2).flatMap((s) => s.stations.flatMap((st): GeoJSON.Feature<GeoJSON.Point>[] => {
    if (st.lat === null || st.lon === null) return [];
    const late = stationLate(st, now);
    const cm = st.change1hM === null ? 0 : Math.round(st.change1hM * 100);
    const ring = late || cm === 0 ? null : cm > 0 ? levelHex('rouge') : levelHex('vert');
    return [{
      type: 'Feature', geometry: point(st.lon, st.lat),
      properties: {
        code: st.code, section: s.id, color: late ? ENV_NEUTRAL_HEX : FLOOD_STATION_HEX, ring: ring ?? TRANSPARENT, ringWidth: ring ? 2.5 : 0,
        body: stationBody(st, s, late, now),
      },
    }];
  })));
}

// ─── Feux de forêt (§ 2.4) ───

const FOYER_TITLE: Readonly<Record<VigilanceLevel | 'gris', string>> = {
  rouge: 'Foyer confirmé de 100 MW ou plus', orange: 'Foyer confirmé de 10 MW ou plus', jaune: 'Détection isolée', vert: 'Détection', gris: 'Source récurrente, à vérifier',
};

/** Titre de l'infobulle : un foyer confirmé de moins de 10 MW est jaune comme une détection isolée (arbitrage 14), mais il est nommé. */
function foyerTitle(level: VigilanceLevel | 'gris', foyer: FireFoyer | undefined): string {
  return level === 'jaune' && foyer?.confirmed ? 'Foyer confirmé de moins de 10 MW' : FOYER_TITLE[level];
}
const LEVEL_SORT: Readonly<Record<VigilanceLevel | 'gris', number>> = { rouge: 4, orange: 3, jaune: 2, vert: 1, gris: 1 };

function detectionBody(d: FireDetection, foyer: FireFoyer | undefined, level: VigilanceLevel | 'gris', late: boolean, now: number): string {
  return head(foyerTitle(level, foyer), `${departementName(d.dept)} (${d.dept})`)
    + row('Satellite', SATELLITE_WORD[d.satellite])
    + row('Confiance', `${d.confidence} (${d.confidenceRaw})`)
    + row('Puissance (FRP)', formatFrp(d.frpMw))
    + row('Acquisition', `${clockOf(d.acquiredAt, now)} (${formatAge(Date.parse(d.acquiredAt), now)})`)
    + row('Passage', d.daynight === 'N' ? 'de nuit' : 'de jour')
    + (foyer ? row('Foyer', `${foyer.detections}${NBSP}${foyer.detections > 1 ? 'détections' : 'détection'}, ${foyer.passes}${NBSP}${foyer.passes > 1 ? 'passages' : 'passage'}, ${formatFrp(foyer.frpTotalMw)}`) : '')
    + (level === 'gris' ? note('Chaleur vue au moins 5 des 10 derniers jours au même endroit : probablement industrielle, jamais un feu de forêt.') : '')
    + (late ? note('Dernière acquisition de plus de 14 h : couleur retirée.') : '')
    + note(`NASA FIRMS, ${SATELLITE_WORD[d.satellite]}.`);
}

/**
 * Détections en France colorées par leur foyer (foyerLevel) : confiance faible jamais en rouge (plafond orange), récurrent en gris de
 * catégorie, données en retard en gris neutre ; halo (glow) seulement pour les foyers orange ou rouges (confirmés, non récurrents, au
 * moins 10 MW : arbitrage 14 du contrôleur) ; rayon selon la FRP.
 */
export function fireDetectionFeatures(f: FiresResponse | null, now: number): Fc<GeoJSON.Point> {
  if (!f) return fc([]);
  const late = isEnvironmentDataLate('firms', f.lastAcquisitionAt, now);
  const foyers = new Map(f.foyers.map((x) => [x.id, x]));
  return fc(f.detections.map((d): GeoJSON.Feature<GeoJSON.Point> => {
    const foyer = foyers.get(d.foyerId);
    const raw = foyer ? foyerLevel(foyer) : 'jaune';
    const level = raw === 'rouge' && d.confidence === 'faible' ? 'orange' : raw;
    const color = late ? ENV_NEUTRAL_HEX : level === 'gris' ? FIRE_RECURRENT_HEX : levelHex(level);
    return {
      type: 'Feature', geometry: point(d.lon, d.lat),
      properties: {
        id: d.id, foyerId: d.foyerId, color, glow: !late && (level === 'orange' || level === 'rouge'),
        radius: Math.round((3 + Math.min(5, Math.sqrt(Math.max(0, d.frpMw)))) * 10) / 10, sortKey: LEVEL_SORT[level] * 1000 + Math.round(d.frpMw),
        body: detectionBody(d, foyer, level, late, now),
      },
    };
  }));
}

/** Détections hors de France : gris clair, comptées à part, jamais dans la pastille ni le score. */
export function fireAbroadFeatures(f: FiresResponse | null): Fc<GeoJSON.Point> {
  if (!f) return fc([]);
  return fc(f.abroad.map((a): GeoJSON.Feature<GeoJSON.Point> => ({
    type: 'Feature', geometry: point(a.lon, a.lat),
    properties: {
      color: FIRE_ABROAD_HEX,
      body: head('Détection hors de France', SATELLITE_WORD[a.satellite])
        + row('Puissance (FRP)', formatFrp(a.frpMw))
        + row('Acquisition', parisStamp(a.acquiredAt))
        + note('Hors du territoire : comptée à part, jamais dans la pastille ni le score.'),
    },
  })));
}

/**
 * Météo des forêts J1 par département (option, éteinte par défaut) : niveaux 1 à 4 en vert, jaune, orange, rouge ; publication en
 * retard (30 h en saison) : gris neutre ; niveaux échus (J1 passé, hors saison) : rien dessiné.
 */
export function forestDangerFeatures(geo: GeoJSON.FeatureCollection, f: FiresResponse | null, now: number): GeoJSON.FeatureCollection {
  const fd = f?.forestDanger ?? null;
  if (!fd || !forestDangerCurrent(fd, now)) return fc([]);
  const late = isEnvironmentDataLate('mdf', fd.publishedAt, now);
  const byDept = new Map(fd.departments.map((d) => [d.dept, d]));
  return fc(geo.features.flatMap((g): GeoJSON.Feature[] => {
    const code = String(g.properties?.['code'] ?? '');
    const d = byDept.get(code);
    if (!d || !g.geometry) return [];
    return [{
      type: 'Feature', geometry: g.geometry,
      properties: {
        code, color: envHex(FOREST_DANGER_LEVEL[d.j1], late),
        body: head(d.name, `Météo des forêts, ${parisDayWord(fd.j1Date, now)}`)
          + row('Danger', FOREST_DANGER_WORD[d.j1])
          + row('Le lendemain', FOREST_DANGER_WORD[d.j2])
          + note(`Publiée le ${parisStamp(fd.publishedAt)}${late ? ' (en retard) : couleur retirée' : ''}.`),
      },
    }];
  }));
}

// ─── Radar météo (§ 2.3) ───

/** Point choisi sur la carte pour le profil vertical (couche Radar active). */
export function radarPickFeature(lat: number, lon: number): Fc<GeoJSON.Point> {
  return fc([{ type: 'Feature', geometry: point(lon, lat), properties: { lat, lon } }]);
}

// ─── Sources, couches, survol ───

/** Sources nouvelles de l'environnement (les sources météo, crues et feux existent déjà dans DeckGLMap). */
export const ENV_SOURCE_IDS: readonly string[] = [SRC_FOREST_DANGER, SRC_FIRES_ABROAD, SRC_FLOOD_STATIONS, SRC_RADAR_PICK];

export function envSourceSpec(): GeoJSONSourceSpecification {
  return { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
}

/** Couches nouvelles, toutes masquées jusqu'à setLayerVisibility ; insérées sous la couche indiquée par ENV_LAYER_BEFORE. */
export const ENV_LAYERS: readonly LayerSpecification[] = [
  {
    id: LYR_FOREST_DANGER_FILL, type: 'fill', source: SRC_FOREST_DANGER, layout: { visibility: 'none' },
    paint: { 'fill-color': ENV_COLOR, 'fill-opacity': 0.32 },
  },
  {
    id: LYR_FOREST_DANGER_LINE, type: 'line', source: SRC_FOREST_DANGER, layout: { visibility: 'none' },
    paint: { 'line-color': ENV_COLOR, 'line-width': 0.8, 'line-opacity': 0.7 },
  },
  {
    id: LYR_FIRES_ABROAD, type: 'circle', source: SRC_FIRES_ABROAD, layout: { visibility: 'none' },
    paint: {
      'circle-color': ENV_COLOR, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 10, 4], 'circle-opacity': 0.8,
      'circle-stroke-width': 0.5, 'circle-stroke-color': 'rgba(0, 0, 0, 0.4)',
    },
  },
  {
    id: LYR_FLOOD_STATIONS, type: 'circle', source: SRC_FLOOD_STATIONS, layout: { visibility: 'none' },
    paint: {
      'circle-color': ENV_COLOR, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3.5, 12, 6],
      'circle-stroke-color': ['coalesce', ['get', 'ring'], TRANSPARENT], 'circle-stroke-width': ['coalesce', ['get', 'ringWidth'], 0],
    },
  },
  {
    id: LYR_WEATHER_ICONS, type: 'symbol', source: SRC_WEATHER_ICONS,
    layout: { 'icon-image': ['get', 'iconImage'], 'icon-size': 0.55, 'icon-allow-overlap': true, 'symbol-sort-key': ['coalesce', ['get', 'sortKey'], 0], visibility: 'none' },
    paint: { 'icon-color': ENV_COLOR, 'icon-halo-color': '#0a0a0f', 'icon-halo-width': 1.5 },
  },
  {
    id: LYR_RADAR_PICK, type: 'circle', source: SRC_RADAR_PICK, layout: { visibility: 'none' },
    paint: { 'circle-color': TRANSPARENT, 'circle-radius': 7, 'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff' },
  },
];

/** Couche sous laquelle insérer une couche nouvelle : météo des forêts, étranger et pictogrammes de la vigilance sous les feux de France. */
export const ENV_LAYER_BEFORE: Readonly<Record<string, string>> = {
  [LYR_FOREST_DANGER_FILL]: LYR_FIRES_GLOW, [LYR_FOREST_DANGER_LINE]: LYR_FIRES_GLOW, [LYR_FIRES_ABROAD]: LYR_FIRES_GLOW,
  [LYR_WEATHER_ICONS]: LYR_FIRES_GLOW,
};

/** Couches MapLibre de chaque couche Environnement (visibilité, survol de légende). */
export const ENV_LAYER_KEYS: Readonly<Record<EnvironmentMapLayer, readonly string[]>> = {
  environmental: [LYR_WEATHER_FILL, LYR_WEATHER_LINE, LYR_WEATHER_LINE_YELLOW, LYR_WEATHER_LINE_ORANGE, LYR_WEATHER_LINE_RED, LYR_WEATHER_ICONS],
  floods: [LYR_FLOODS, LYR_FLOOD_STATIONS],
  weatherRadar: [LYR_RADAR_PICK],
  fires: [LYR_FIRES_GLOW, LYR_FIRES_POINTS, LYR_FIRES_HIGHLIGHT, LYR_FIRES_ABROAD],
};

/** Météo des forêts : option de la couche Feux. */
export const FOREST_DANGER_LAYERS: readonly string[] = [LYR_FOREST_DANGER_FILL, LYR_FOREST_DANGER_LINE];

/** Couche Environnement active : chaque couche suit sa propre clé (un état ancien reçoit `floods` de migrateStoredLayers). */
export function envLayerOn(layers: Partial<Record<EnvironmentMapLayer, boolean>>, key: EnvironmentMapLayer): boolean {
  return layers[key] ?? false;
}

const HOVERABLE: ReadonlySet<string> = new Set([
  LYR_FIRES_POINTS, LYR_FIRES_ABROAD, LYR_FLOOD_STATIONS, LYR_FLOODS, LYR_FOREST_DANGER_FILL, LYR_WEATHER_FILL,
]);

/** Couches survolées, de la plus haute à la plus basse : celle qu'on voit au-dessus répond (points avant tracés avant surfaces). */
export const ENV_HOVER_LAYERS: readonly string[] = [
  LYR_FIRES_POINTS, LYR_FIRES_ABROAD, LYR_FLOOD_STATIONS, LYR_FLOODS, LYR_FOREST_DANGER_FILL, LYR_WEATHER_FILL,
];

export function topEnvHit<T extends { layer: { id: string } }>(hits: readonly T[]): T | undefined {
  for (const id of ENV_HOVER_LAYERS) {
    const hit = hits.find((f) => f.layer.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** Infobulle préparée avec la donnée (propriété `body`, déjà échappée) ; null hors des couches survolables ou sans corps. */
export function envTooltipHtml(layerId: string, props: Readonly<Record<string, unknown>>): string | null {
  const body = props['body'];
  if (typeof body !== 'string' || body === '' || !HOVERABLE.has(layerId)) return null;
  return tip(body);
}
