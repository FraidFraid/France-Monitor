// api/_lib/drone-zones.js : zones drones DGAC « vol interdit » hors agglomérations (spec 2026-10-04 souveraineté § 3.2 ; contrats
// § 1.2, § 8 B21 ; arbitrage 14 de la part B). Pur, sans réseau : adresses WFS de la Géoplateforme, lecture de GetCapabilities et des
// comptes, filtre des agglomérations, simplification Douglas-Peucker des anneaux (tolérance selon la taille de la zone, 4 décimales),
// fichier daté et borné. Utilisé par scripts/fetch-drone-restrictions.mjs et par les tests.
import { cleanText } from './source-http.js';

export const DRONES_WFS_URL = 'https://data.geopf.fr/wfs/ows';
export const DRONES_LAYER = 'TRANSPORTS.DRONES.RESTRICTIONS:carte_restriction_drones_lf';
/** Boîte métropolitaine en CQL : ordre lat, lon, lat, lon (l'ordre lon, lat renvoie 0, faits § 5.6). */
export const METROPOLE_BBOX_CQL = 'BBOX(geom,41,-5.5,51.5,10)';
export const VOL_INTERDIT_CQL = `limite LIKE 'Vol interdit%' AND ${METROPOLE_BBOX_CQL}`;
export const NON_AGGLO_CQL = `${VOL_INTERDIT_CQL} AND NOT (remarque LIKE '%en agglom%')`;
/** Pages de 2 000 zones, ordre naturel de la clé (aucun SORTBY : un tri sur une propriété non unique perd et double des zones). */
export const PAGE_SIZE = 2000;
export const DRONES_FILE_PATH = new URL('../../public/data/drone-restrictions.json', import.meta.url);
export const DRONES_SOURCE = 'DGAC / IGN, Géoplateforme';
export const DRONES_LICENCE = 'CGU cartes.gouv.fr';
/** Borne du fichier publié : 1,5 Mio (contrôle ouvert 23 des contrats). */
export const MAX_FILE_BYTES = 1.5 * 1024 * 1024;
export const MIN_TOLERANCE_DEG = 0.0003;
export const MAX_TOLERANCE_DEG = 0.006;
export const TOLERANCE_DIVISOR = 15;
export const COORD_DECIMALS = 4;

/** Amendement S6 : titre et légende officiels de la couche (GetCapabilities du 04/10/2026), repris tels quels par l'affichage. */
export const DRONES_TITLE = 'Restrictions UAS catégorie Ouverte et Aéromodélisme';
export const DRONES_LEGEND = 'Zones soumises à interdictions ou à restrictions pour l\u2019usage, à titre de loisir, d\u2019aéronefs télépilotés (ou drones), '
  + 'sur le territoire métropolitain, en Guyane, aux Antilles françaises, Saint-Pierre et Miquelon, Mayotte, La Réunion et aux Terres Australes, '
  + 'à jour au 07-2025. Elle intègre partiellement les interdictions s\u2019appuyant sur des données non publiées à l\u2019AIP et ne couvre pas '
  + 'les interdictions temporaires.';
/** Renvoi aux sources qui font foi (amendement S6) : la carte ne remplace ni le SIA ni les arrêtés préfectoraux. */
export const DRONES_POINTER = 'Cette carte ne fait pas foi : consulter le SIA (sia.aviation-civile.gouv.fr) et les arrêtés préfectoraux en vigueur.';
export const DRONES_POINTER_URL = 'https://www.sia.aviation-civile.gouv.fr/';

const GET_FEATURE = `SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=${encodeURIComponent(DRONES_LAYER)}`;

/** Compte des zones d'un filtre CQL (RESULTTYPE=hits, réponse XML). */
export function hitsUrl(cql) {
  return `${DRONES_WFS_URL}?${GET_FEATURE}&RESULTTYPE=hits&CQL_FILTER=${encodeURIComponent(cql)}`;
}

/** Page GeoJSON d'un filtre CQL, à partir de `startIndex`. */
export function pageUrl(cql, startIndex) {
  return `${DRONES_WFS_URL}?${GET_FEATURE}&OUTPUTFORMAT=${encodeURIComponent('application/json')}&COUNT=${PAGE_SIZE}&STARTINDEX=${startIndex}`
    + `&CQL_FILTER=${encodeURIComponent(cql)}`;
}

export function capabilitiesUrl() {
  return `${DRONES_WFS_URL}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities`;
}

/** Édition du jeu (« 2025-07-01 ») lue dans le résumé de la couche ; null si introuvable. */
export function editionFromCapabilities(xml) {
  const text = String(xml ?? '');
  const at = text.indexOf(`<Name>${DRONES_LAYER}</Name>`);
  if (at < 0) return null;
  const end = text.indexOf('</FeatureType>', at);
  const m = /[ÉE]dition\s+(\d{4}-\d{2}-\d{2})/.exec(text.slice(at, end < 0 ? at + 10_000 : end));
  return m ? m[1] : null;
}

/** Attribut numberMatched d'une réponse WFS ; null si absent. */
export function numberMatchedOf(xml) {
  const m = /numberMatched="(\d+)"/.exec(String(xml ?? ''));
  return m ? Number(m[1]) : null;
}

/** Zone d'agglomération (remarque qui contient « en agglomération ») : jamais gardée. */
export function isAgglomeration(remarque) {
  return /en agglom/i.test(String(remarque ?? ''));
}

function diagonal(ring) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

/** Tolérance de simplification d'un anneau : diagonale / 15, bornée de 0,0003° (environ 30 m) à 0,006° (environ 670 m). */
export function ringTolerance(ring) {
  return Math.min(MAX_TOLERANCE_DEG, Math.max(MIN_TOLERANCE_DEG, diagonal(ring) / TOLERANCE_DIVISOR));
}

/** Douglas-Peucker itératif (pile explicite) : points gardés dans l'ordre. */
function douglasPeucker(points, tolerance) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [i0, i1] = stack.pop();
    const [ax, ay] = points[i0];
    const [bx, by] = points[i1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let index = -1;
    for (let i = i0 + 1; i < i1; i += 1) {
      const [px, py] = points[i];
      let d;
      if (len2 === 0) d = Math.hypot(px - ax, py - ay);
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (d > best) {
        best = d;
        index = i;
      }
    }
    if (index > 0 && best > tolerance) {
      keep[index] = 1;
      stack.push([i0, index], [index, i1]);
    }
  }
  return points.filter((_p, i) => keep[i] === 1);
}

const SCALE = 10 ** COORD_DECIMALS;
const round = (v) => Math.round(v * SCALE) / SCALE;

/** Arrondi à 4 décimales, doublons consécutifs retirés, anneau refermé. */
function closedRounded(points) {
  const out = [];
  for (const [x, y] of points) {
    const q = [round(x), round(y)];
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  if (out.length > 0) {
    const [fx, fy] = out[0];
    const [lx, ly] = out[out.length - 1];
    if (fx !== lx || fy !== ly) out.push([fx, fy]);
  }
  return out;
}

/** Anneau simplifié (au moins 4 points, refermé) ; essais à la tolérance, au quart, puis sans simplification ; null si dégénéré. */
export function simplifyRing(ring, tolerance) {
  if (!Array.isArray(ring) || ring.length < 4) return null;
  for (const tol of [tolerance, tolerance / 4, 0]) {
    const out = closedRounded(tol > 0 ? douglasPeucker(ring, tol) : ring);
    if (out.length >= 4) return out;
  }
  return null;
}

/** Zone gardée d'une entité WFS « Vol interdit » hors agglomération ; null sinon (ou tracé dégénéré). */
export function toDroneZone(feature) {
  const props = feature && typeof feature === 'object' && feature.properties && typeof feature.properties === 'object' ? feature.properties : {};
  if (!/^Vol interdit/.test(String(props.limite ?? '')) || isAgglomeration(props.remarque)) return null;
  const g = feature.geometry;
  const polys = g?.type === 'MultiPolygon' ? g.coordinates : g?.type === 'Polygon' ? [g.coordinates] : [];
  const polygons = [];
  for (const poly of Array.isArray(polys) ? polys : []) {
    if (!Array.isArray(poly) || poly.length === 0) continue;
    const tolerance = ringTolerance(poly[0]);
    const outer = simplifyRing(poly[0], tolerance);
    if (!outer) continue;
    const minHole = Math.max(4 * tolerance, 0.002);
    const holes = poly.slice(1).filter((h) => Array.isArray(h) && h.length >= 4 && diagonal(h) >= minHole)
      .map((h) => simplifyRing(h, tolerance)).filter((h) => h !== null);
    polygons.push([outer, ...holes]);
  }
  if (polygons.length === 0) return null;
  const id = String(feature.id ?? '').split('.').pop() ?? '';
  const remarque = cleanText(props.remarque ?? '');
  return { id, remarque: remarque === '' ? null : remarque, polygons };
}

/**
 * Fichier publié (DroneZonesFile) : zones gardées (sans doublon d'identifiant), triées par identifiant ; comptes de la métropole.
 * @param {{ features: unknown[], edition: string, volInterdit: number, nonAgglomeration: number, generatedAt: string }} input
 */
export function buildDroneZonesFile({ features, edition, volInterdit, nonAgglomeration, generatedAt }) {
  const seen = new Set();
  const zones = [];
  for (const f of features) {
    const key = String(f?.id ?? '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const zone = toDroneZone(f);
    if (zone) zones.push(zone);
  }
  zones.sort((a, b) => Number(a.id) - Number(b.id));
  return {
    generatedAt, edition, source: DRONES_SOURCE, licence: DRONES_LICENCE,
    counts: { volInterdit, agglomerations: Math.max(0, volInterdit - nonAgglomeration), kept: zones.length }, zones,
  };
}
