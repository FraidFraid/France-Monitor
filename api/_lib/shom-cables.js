// api/_lib/shom-cables.js : câbles, zones de câbles et zones de mouillage du Shom, référence du fichier des câbles (amendement 7,
// règle O18, choix de l'utilisateur du 04/10/2026), et complément OpenStreetMap des câbles que le Shom ne répertorie pas. Service
// WFS sans clé (https://services.data.shom.fr/INSPIRE/wfs, GetCapabilities et GetFeature seulement), lu par
// scripts/fetch-subsea-cables.mjs ; fonctions pures. Attributs S-57 de l'OHI relevés le 04/10/2026 :
// - câbles `CABLES_BDD_WFS:cblsub_lv` (CC BY-SA, citer « Shom ») : `catcbl` 4 « téléphone » (télécom, gardés), 1 électrique,
//   3 ligne de transport, 6 chaîne de corps-mort (segments de moins d'1 km), 0 non renseigné (écartés comme les câbles sans
//   nature d'OpenStreetMap) ; un câble est découpé en plusieurs objets de même `inspireid`, regroupés ici en un seul tracé ;
// - zones de câbles `REGLEMENTATION_NAVIGATION_BDD_WFS:cblare_polygon` et zones de mouillage `…:achare_polygon` (Licence
//   ouverte 2.0) : `restrn` 1 « mouillage interdit », `nobjnm` et `ninfom` nom et information en français.
// Les polygones sont simplifiés à 10 m (Douglas-Peucker) ; relevé du 04/10/2026 : 52 539 sommets ramenés à 16 413 pour les 1 177
// zones de mouillage, 11 692 à 3 622 pour les 63 zones de câbles ; les tracés des câbles ne sont pas simplifiés.
import { haversineKm, inPolygon } from './geo-fr.js';
import {
  SHOM_CABLES_LICENCE, SHOM_REGULATION_LICENCE, SHOM_SOURCE, landingsOf, pointToPathM, round5, tagText, zoneBox,
} from './subsea-cables.js';

export const SHOM_WFS_URL = 'https://services.data.shom.fr/INSPIRE/wfs';
/** Approches de la métropole, Corse comprise (même boîte que la requête Overpass) : ouest, sud, est, nord. */
export const APPROACHES_BBOX = [-6, 41, 10, 51.5];
const REGULATION = {
  dataset: 'Réglementation - Navigation',
  datagouvId: '658f61c5922c8af7c0c71b48',
  datagouvLicense: 'lov2',
  licence: SHOM_REGULATION_LICENCE,
  url: 'https://www.data.gouv.fr/datasets/reglementation-navigation-1/',
};
/** Couches lues, avec la fiche data.gouv.fr qui porte leur licence (identifiant de licence data.gouv.fr vérifié par le script). */
export const SHOM_LAYERS = {
  cables: {
    layer: 'CABLES_BDD_WFS:cblsub_lv',
    dataset: 'Conduites et câbles sous-marins répertoriés par le Shom',
    datagouvId: '668d0c66218bd3b62f1cbe81',
    datagouvLicense: 'cc-by-sa',
    licence: SHOM_CABLES_LICENCE,
    url: 'https://www.data.gouv.fr/datasets/conduites-et-cables-sous-marins-repertories-par-le-shom/',
  },
  cableZones: { layer: 'REGLEMENTATION_NAVIGATION_BDD_WFS:cblare_polygon', ...REGULATION },
  anchorageZones: { layer: 'REGLEMENTATION_NAVIGATION_BDD_WFS:achare_polygon', ...REGULATION },
};
/** Catégorie S-57 « téléphone » : câble de télécommunication. */
export const SHOM_TELECOM_CATCBL = 4;
/** Restriction S-57 « mouillage interdit ». */
const ANCHORING_PROHIBITED = 1;
/** Tolérance de simplification des polygones (m). */
export const ZONE_SIMPLIFY_M = 10;
/** Un câble OpenStreetMap est déjà au Shom si la moitié au moins de ses points à moins de 30 km d'un atterrage français est à moins de 2 km d'un câble télécom du Shom. */
export const COVER_M = 2_000;
export const COVER_SHARE = 0.5;
export const COVER_NEAR_KM = 30;
const SAMPLE_M = 500;
/** Marge (degrés) des boîtes des câbles du Shom : plus de 2 km à toutes les latitudes de la métropole. */
const COVER_BOX_DEG = 0.035;

/** GetCapabilities du service WFS (éditions des couches). */
export function shomCapabilitiesUrl() {
  return `${SHOM_WFS_URL}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities`;
}

/** GetFeature d'une couche sur les approches de la métropole, en GeoJSON [lng, lat] (vérifié le 04/10/2026). */
export function shomFeatureUrl(layer) {
  return `${SHOM_WFS_URL}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=${layer}&OUTPUTFORMAT=application/json`
    + `&SRSNAME=EPSG:4326&BBOX=${APPROACHES_BBOX.join(',')},EPSG:4326`;
}

/**
 * Édition d'une couche lue dans le résumé de GetCapabilities (« Réglementation - navigation 07_2021 » : « 2021-07 ») ; null si le
 * résumé n'en porte pas. Lève si la couche est absente du service (nom changé par le Shom).
 * @param {string} xml
 * @param {string} layer
 */
export function shomEditionOf(xml, layer) {
  const text = String(xml ?? '');
  const start = text.indexOf(`<Name>${layer}</Name>`);
  if (start < 0) throw new Error(`couche ${layer} absente du service WFS du Shom`);
  const end = text.indexOf('</FeatureType>', start);
  const m = /<Abstract>[^<]*?\b(\d{2})_(\d{4})\b[^<]*<\/Abstract>/.exec(text.slice(start, end < 0 ? undefined : end));
  return m ? `${m[2]}-${m[1]}` : null;
}

function features(json, layer) {
  if (!json || typeof json !== 'object' || json.type !== 'FeatureCollection' || !Array.isArray(json.features)) {
    throw new Error(`réponse WFS du Shom sans « features » (${layer})`);
  }
  return json.features;
}

/**
 * Lève si la réponse GetFeature ne rend pas tous les objets annoncés (`numberMatched`) : un fichier incomplet ne doit jamais être écrit.
 * @param {unknown} json
 * @param {string} layer
 */
export function assertWfsComplete(json, layer) {
  const list = features(json, layer);
  const matched = Number(json.numberMatched);
  if (Number.isFinite(matched) && matched !== list.length) {
    throw new Error(`réponse WFS du Shom tronquée (${layer} : ${list.length} objets sur ${matched})`);
  }
}

/** Codes S-57 d'une liste (« 1,5,9 », 4) ; [] si absent (0 : non renseigné). */
function codes(v) {
  return String(v ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
}

/** Identifiant stable d'un objet du Shom : son identifiant INSPIRE sans espaces (« shom/FR000008439600001 »). */
function shomId(f) {
  const inspire = typeof f?.properties?.inspireid === 'string' ? f.properties.inspireid.replace(/\s+/g, '') : '';
  return `shom/${inspire || String(f?.id ?? '')}`;
}

function lineOf(coords) {
  return (Array.isArray(coords) ? coords : [])
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map(([lon, lat]) => [round5(lon), round5(lat)]);
}

function linesOf(geometry) {
  if (geometry?.type === 'LineString') return [lineOf(geometry.coordinates)];
  if (geometry?.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) return geometry.coordinates.map(lineOf);
  return [];
}

/**
 * Câbles télécom du Shom (`catcbl` 4) d'une réponse GetFeature de `cblsub_lv` : objets de même identifiant INSPIRE regroupés en un
 * tracé à plusieurs lignes [lng, lat] arrondies à 5 décimales ; atterrages comme pour OpenStreetMap (un tronçon en mer n'en a
 * aucun) ; sans nom (le Shom n'en publie pas). Source « Shom », licence CC BY-SA. Lève si la réponse n'a pas de liste « features ».
 * @param {unknown} json
 * @param {{ departementAt(lat: number, lon: number): string | null, departementsNear(lat: number, lon: number, km: number): string[] }} geo
 */
export function shomToCables(json, geo) {
  const byId = new Map();
  for (const f of features(json, SHOM_LAYERS.cables.layer)) {
    if (!codes(f?.properties?.catcbl).includes(SHOM_TELECOM_CATCBL)) continue;
    const lines = linesOf(f.geometry).filter((l) => l.length >= 2);
    if (lines.length === 0) continue;
    const id = shomId(f);
    byId.set(id, [...(byId.get(id) ?? []), ...lines]);
  }
  return [...byId].map(([id, path]) => ({
    id, name: null, operator: null, path, landings: landingsOf(path, geo), source: SHOM_SOURCE, licence: SHOM_CABLES_LICENCE,
  }));
}

/** Valeur S-57 STATUS « hors service » (not in use). */
const OUT_OF_SERVICE = 4;
/** Libellés des catégories S-57 de câble écartées (« 0 » : catégorie non renseignée). */
const CATCBL_LABELS = { 0: 'non renseignée', 1: 'électrique', 3: 'ligne de transport', 5: 'télégraphe', 6: 'chaîne de corps-mort' };

/**
 * Comptes d'une réponse GetFeature de `cblsub_lv` pour la sortie du script (revue d'A4) : objets télécom gardés (`catcbl` 4) et
 * objets écartés par catégorie S-57 (clé « 0 » : non renseignée ; une liste « 1,6 » garde sa liste), dont hors service
 * (`status` 4). Lève si la réponse n'a pas de liste « features ».
 * @param {unknown} json
 */
export function shomCableCounts(json) {
  const counts = { objects: 0, telecom: 0, telecomOutOfService: 0, excluded: 0, excludedOutOfService: 0, excludedByCategory: {} };
  for (const f of features(json, SHOM_LAYERS.cables.layer)) {
    const cat = codes(f?.properties?.catcbl);
    const outOfService = codes(f?.properties?.status).includes(OUT_OF_SERVICE);
    counts.objects += 1;
    if (cat.includes(SHOM_TELECOM_CATCBL)) {
      counts.telecom += 1;
      if (outOfService) counts.telecomOutOfService += 1;
      continue;
    }
    const key = cat.length > 0 ? cat.join(',') : '0';
    counts.excluded += 1;
    if (outOfService) counts.excludedOutOfService += 1;
    counts.excludedByCategory[key] = (counts.excludedByCategory[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * Ligne imprimée par le script : objets écartés par catégorie, dont hors service, et objets télécom gardés, dont hors service.
 * @param {ReturnType<typeof shomCableCounts>} counts
 */
export function shomExclusionsText(counts) {
  const byCategory = Object.entries(counts.excludedByCategory)
    .map(([key, n]) => `${CATCBL_LABELS[key] ?? `catégorie ${key}`} : ${n}`)
    .join(', ');
  return `objets du Shom écartés : ${counts.excluded} sur ${counts.objects} (catcbl autre que ${SHOM_TELECOM_CATCBL} · ${byCategory || 'aucun'}), `
    + `dont ${counts.excludedOutOfService} hors service ; objets télécom gardés : ${counts.telecom}, dont ${counts.telecomOutOfService} hors service`;
}

/** Distance (m) d'un point à la droite [a, b] bornée au segment, en mètres locaux. */
function offsetM(p, a, b, kx, ky) {
  const ax = a[0] * kx; const ay = a[1] * ky;
  const dx = b[0] * kx - ax; const dy = b[1] * ky - ay;
  const px = p[0] * kx - ax; const py = p[1] * ky - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
  return Math.hypot(px - t * dx, py - t * dy);
}

/**
 * Anneau fermé [lng, lat] simplifié (Douglas-Peucker, tolérance en mètres) ; un anneau qui tomberait sous 4 sommets est rendu tel quel.
 * @param {Array<[number, number]>} ring
 * @param {number} toleranceM
 */
export function simplifyRing(ring, toleranceM) {
  if (ring.length <= 4) return ring;
  const ky = 111_320;
  const kx = ky * Math.cos((ring[0][1] * Math.PI) / 180);
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop();
    let best = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i += 1) {
      const d = offsetM(ring[i], ring[a], ring[b], kx, ky);
      if (d > best) { best = d; idx = i; }
    }
    if (idx > 0 && best > toleranceM) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = ring.filter((_, i) => keep[i] === 1);
  return out.length >= 4 ? out : ring;
}

/** Polygones [lng, lat] simplifiés ; un anneau extérieur illisible écarte son polygone, un trou illisible est seul retiré. */
function polygonsOf(geometry) {
  const polys = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  const out = [];
  for (const poly of Array.isArray(polys) ? polys : []) {
    const rings = (Array.isArray(poly) ? poly : []).map((ring) => simplifyRing(lineOf(ring), ZONE_SIMPLIFY_M));
    if (rings.length === 0 || rings[0].length < 4) continue;
    out.push([rings[0], ...rings.slice(1).filter((r) => r.length >= 4)]);
  }
  return out;
}

function zoneBase(f) {
  const p = f?.properties ?? {};
  return { id: shomId(f), name: tagText(p.nobjnm) ?? tagText(p.objnam), info: tagText(p.ninfom) ?? tagText(p.inform) };
}

/**
 * Zones de câbles sous-marins du Shom d'une réponse GetFeature de `cblare_polygon` : nom et information en français, catégorie des
 * câbles (`catcbl` 4 : « telecom », 1 ou 3 : « power », sinon null), polygones simplifiés à 10 m. Licence ouverte 2.0.
 * @param {unknown} json
 */
export function shomToCableZones(json) {
  const out = [];
  for (const f of features(json, SHOM_LAYERS.cableZones.layer)) {
    const polygons = polygonsOf(f?.geometry);
    if (polygons.length === 0) continue;
    const cat = codes(f.properties?.catcbl);
    const cableCategory = cat.includes(SHOM_TELECOM_CATCBL) ? 'telecom' : cat.includes(1) || cat.includes(3) ? 'power' : null;
    out.push({ ...zoneBase(f), cableCategory, source: SHOM_SOURCE, licence: SHOM_REGULATION_LICENCE, polygons });
  }
  return out;
}

function segmentsCross(p1, p2, p3, p4) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1); const d2 = d(p3, p4, p2); const d3 = d(p1, p2, p3); const d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function polygonsOverlap(pa, pb) {
  const ra = pa[0];
  const rb = pb[0];
  if (ra.some(([lon, lat]) => inPolygon(lon, lat, pb)) || rb.some(([lon, lat]) => inPolygon(lon, lat, pa))) return true;
  for (let i = 1; i < ra.length; i += 1) {
    for (let j = 1; j < rb.length; j += 1) if (segmentsCross(ra[i - 1], ra[i], rb[j - 1], rb[j])) return true;
  }
  return false;
}

/**
 * Vrai si deux zones se recoupent (un sommet de l'une dans l'autre, ou deux bords qui se croisent).
 * @param {{ polygons: Array<Array<Array<[number, number]>>> }} a
 * @param {{ polygons: Array<Array<Array<[number, number]>>> }} b
 */
export function zonesOverlap(a, b) {
  const [ax0, ay0, ax1, ay1] = zoneBox(a);
  const [bx0, by0, bx1, by1] = zoneBox(b);
  if (ax1 < bx0 || bx1 < ax0 || ay1 < by0 || by1 < ay0) return false;
  return a.polygons.some((pa) => b.polygons.some((pb) => polygonsOverlap(pa, pb)));
}

/**
 * Zones de mouillage du Shom d'une réponse GetFeature de `achare_polygon` : nom et information en français, `anchoringProhibited`
 * (restriction S-57 1), `crossesCableZone` (la zone recoupe une zone de câbles : un navire lent y reste signalé, S9), polygones
 * simplifiés à 10 m. Licence ouverte 2.0.
 * @param {unknown} json
 * @param {Array<{ polygons: Array<Array<Array<[number, number]>>> }>} cableZones
 */
export function shomToAnchorageZones(json, cableZones) {
  const out = [];
  for (const f of features(json, SHOM_LAYERS.anchorageZones.layer)) {
    const polygons = polygonsOf(f?.geometry);
    if (polygons.length === 0) continue;
    const zone = {
      ...zoneBase(f),
      anchoringProhibited: codes(f.properties?.restrn).includes(ANCHORING_PROHIBITED),
      crossesCableZone: false,
      source: SHOM_SOURCE,
      licence: SHOM_REGULATION_LICENCE,
      polygons,
    };
    zone.crossesCableZone = cableZones.some((cz) => zonesOverlap(zone, cz));
    out.push(zone);
  }
  return out;
}

/** Points d'un tracé tous les 500 m au plus. */
function samples(path) {
  const out = [];
  for (const line of path) {
    for (let i = 1; i < line.length; i += 1) {
      const [x0, y0] = line[i - 1];
      const [x1, y1] = line[i];
      const n = Math.max(1, Math.ceil((haversineKm(y0, x0, y1, x1) * 1000) / SAMPLE_M));
      for (let j = 0; j < n; j += 1) out.push([x0 + ((x1 - x0) * j) / n, y0 + ((y1 - y0) * j) / n]);
    }
    if (line.length > 0) out.push(line[line.length - 1]);
  }
  return out;
}

function pathBox(path) {
  let minLon = Infinity; let minLat = Infinity; let maxLon = -Infinity; let maxLat = -Infinity;
  for (const line of path) for (const [lon, lat] of line) {
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  return [minLon - COVER_BOX_DEG, minLat - COVER_BOX_DEG, maxLon + COVER_BOX_DEG, maxLat + COVER_BOX_DEG];
}

/**
 * Câbles OpenStreetMap absents du Shom (complément) : un câble est déjà au Shom si la moitié au moins de ses points (tous les 500 m)
 * situés à moins de 30 km d'un de ses atterrages français est à moins de 2 km d'un câble télécom du Shom. Relevé du 04/10/2026 :
 * les câbles retrouvés le sont à 78 % au moins, les absents à 31 % au plus.
 * @template {{ path: Array<Array<[number, number]>>, landings: Array<{ lat: number, lon: number }> }} C
 * @param {C[]} osmCables
 * @param {Array<{ path: Array<Array<[number, number]>> }>} shomCables
 * @returns {C[]}
 */
export function osmComplement(osmCables, shomCables) {
  const boxed = shomCables.map((s) => ({ path: s.path, box: pathBox(s.path) }));
  const nearShom = ([lon, lat]) => boxed.some(({ path, box }) => lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3]
    && pointToPathM(lat, lon, path) <= COVER_M);
  return osmCables.filter((c) => {
    const near = samples(c.path).filter(([lon, lat]) => c.landings.some((l) => haversineKm(lat, lon, l.lat, l.lon) <= COVER_NEAR_KM));
    if (near.length === 0) return true;
    return near.filter(nearShom).length / near.length < COVER_SHARE;
  });
}
