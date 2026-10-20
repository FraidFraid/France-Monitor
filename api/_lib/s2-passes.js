// api/_lib/s2-passes.js : passages Sentinel-2 au-dessus d'une zone (20/10/2026). Pur.
// Une scène STAC est une tuile de 110 km ; un passage du satellite en produit plusieurs à la même minute, et deux orbites
// voisines survolent souvent la même tuile, l'une en entier, l'autre en bordure de fauchée (Vidourle le 20/10 : 31TEJ vue à
// 100 % à 10 h 48, à 15 % à 10 h 38). On regroupe donc les tuiles par passage, on mesure la part de la zone réellement
// couverte par leurs emprises (échantillonnage d'une grille de 12 × 12 points), et la nébulosité est celle de la zone,
// pondérée par la part de chaque tuile, jamais celle d'une tuile entière.

/** Part minimale de la zone couverte pour proposer un passage (en dessous, l'image serait en grande partie vide). */
export const MIN_PASS_COVERAGE = 0.9;
const GRID = 12;

/** Point dans un anneau (lancer de rayon), coordonnées [lon, lat]. */
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Point dans une emprise GeoJSON (Polygon ou MultiPolygon, trous compris) ; sans emprise lisible : faux. */
export function inFootprint(lon, lat, geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return false;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.some((rings) => Array.isArray(rings) && rings.length > 0
    && inRing(lon, lat, rings[0]) && !rings.slice(1).some((hole) => inRing(lon, lat, hole)));
}

/** Points d'échantillonnage de la zone [ouest, sud, est, nord]. */
function samplePoints(bbox) {
  const [w, s, e, n] = bbox;
  const pts = [];
  for (let i = 0; i < GRID; i += 1) {
    for (let j = 0; j < GRID; j += 1) pts.push([w + ((i + 0.5) / GRID) * (e - w), s + ((j + 0.5) / GRID) * (n - s)]);
  }
  return pts;
}

/** Clé d'un passage : satellite et minute d'acquisition (les tuiles d'un même passage partagent la minute). */
function passKey(feature) {
  const p = feature?.properties ?? {};
  const platform = String(p.platform ?? String(feature?.id ?? '').slice(0, 3));
  return `${platform}|${String(p.datetime ?? '').slice(0, 16)}`;
}

/**
 * Passages au-dessus de la zone, du plus récent au plus ancien : `{ id, datetime, cloudCover, coverage, feature }` où `feature`
 * est la tuile qui couvre le plus la zone (vignette, image), `coverage` la part de zone couverte (0 à 1) et `cloudCover` la
 * nébulosité pondérée par la part de chaque tuile (null si aucune tuile ne la publie).
 * @param {Array<{ id?: string, geometry?: unknown, properties?: Record<string, unknown> }>} features
 * @param {[number, number, number, number]} bbox
 */
export function groupPasses(features, bbox) {
  const pts = samplePoints(bbox);
  const groups = new Map();
  for (const f of features) {
    const key = passKey(f);
    const list = groups.get(key);
    if (list) list.push(f);
    else groups.set(key, [f]);
  }
  const out = [];
  for (const tiles of groups.values()) {
    const hits = tiles.map(() => 0);
    let covered = 0;
    for (const [lon, lat] of pts) {
      // Un point vu par plusieurs tuiles du même passage est compté pour la première (même image).
      const k = tiles.findIndex((t) => inFootprint(lon, lat, t.geometry));
      if (k === -1) continue;
      covered += 1;
      hits[k] += 1;
    }
    let weight = 0;
    let cloud = 0;
    tiles.forEach((t, i) => {
      const cc = t?.properties?.['eo:cloud_cover'];
      if (hits[i] === 0 || cc == null || !Number.isFinite(Number(cc))) return;
      weight += hits[i];
      cloud += hits[i] * Number(cc);
    });
    const best = tiles[hits.indexOf(Math.max(...hits))];
    out.push({
      id: String(best?.id ?? ''),
      datetime: String(best?.properties?.datetime ?? ''),
      cloudCover: weight > 0 ? Math.round((cloud / weight) * 10) / 10 : null,
      coverage: covered / pts.length,
      feature: best,
    });
  }
  return out.sort((a, b) => (Date.parse(b.datetime) || 0) - (Date.parse(a.datetime) || 0));
}

/** Fenêtre de traitement d'un passage : ± 20 min autour de son acquisition, pour ne jamais mêler un autre passage. */
export function passTimeRange(datetime) {
  const t = Date.parse(datetime);
  if (!Number.isFinite(t)) throw new Error('date de passage illisible');
  return { from: new Date(t - 20 * 60_000).toISOString(), to: new Date(t + 20 * 60_000).toISOString() };
}
