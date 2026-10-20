// api/_lib/flood-zones.js : zones inondables officielles (Directive inondation, cartographie des TRI) lues dans le WFS Géorisques
// (MapServer, sans clé, 20/10/2026). Trois scénarios de débordement de cours d'eau pour la France métropolitaine :
// ALEA_SYNT_01_01FOR_FXX (crue fréquente), _02MOY_FXX (moyenne, ~centennale), _04FAI_FXX (extrême). Seuls les TRI sont cartographiés :
// un résultat vide hors TRI est normal, il se dit « non couvert », jamais une zone inventée.
// Piège d'axes : le WFS 2.0 avec l'URN EPSG:4326 attend la boîte en lat,lon ; NOTRE API parle lon,lat (CRS84), convertie ici.
// Les polygones officiels sont très lourds (5 Mo pour 50 entités) : ils sont simplifiés (Douglas-Peucker ~30 m), arrondis à 5
// décimales, réduits à leur anneau extérieur, puis gardés 7 jours (cartographie statique).
import { cachedSource, fetchStrictJson, sourceError } from './source-http.js';

export const FLOOD_WFS_BASE = 'https://www.georisques.gouv.fr/services';
/** Couches WFS par scénario (métropole). */
export const FLOOD_LAYERS = [
  { scenario: 'frequent', layer: 'ms:ALEA_SYNT_01_01FOR_FXX', label: 'crue fréquente' },
  { scenario: 'moyen', layer: 'ms:ALEA_SYNT_01_02MOY_FXX', label: 'crue moyenne' },
  { scenario: 'extreme', layer: 'ms:ALEA_SYNT_01_04FAI_FXX', label: 'crue extrême' },
];
/** Côté maximal d'une boîte demandée, en degrés. */
export const MAX_BBOX_SPAN_DEG = 1.0;
/** Entités lues au plus par scénario (le serveur n'annonce pas de total dans le GeoJSON). */
export const MAX_FEATURES_PER_SCENARIO = 300;
/**
 * Plafond d'une case de la maille (0,05° de côté au plus) : en ville, la zone est découpée en centaines de petits polygones (Nîmes,
 * crue moyenne : 451 entités, 4,1 Mo bruts) ; 300 y rendrait un sous-ensemble arbitraire.
 */
export const MAX_FEATURES_SMALL_BOX = 2000;

/** Plafond d'entités par scénario pour une boîte arrondie. */
export function featureCap(bbox) {
  const small = bbox[2] - bbox[0] <= BBOX_STEP_DEG + 1e-9 && bbox[3] - bbox[1] <= BBOX_STEP_DEG + 1e-9;
  return small ? MAX_FEATURES_SMALL_BOX : MAX_FEATURES_PER_SCENARIO;
}
/** Pas d'arrondi de la boîte (clé de cache), en degrés. */
export const BBOX_STEP_DEG = 0.05;
/** Tolérance de simplification, en degrés (~30 m). */
export const SIMPLIFY_TOLERANCE_DEG = 0.0003;
export const FLOOD_TTL_SEC = 7 * 86_400;
export const FLOOD_STALE_SEC = 30 * 86_400;
/** Délai d'une lecture WFS (la route doit répondre en ~15 s ; les trois scénarios sont lus en parallèle). */
export const FLOOD_FETCH_TIMEOUT_MS = 12_000;

/**
 * Valide `minLon,minLat,maxLon,maxLat` (ordre CRS84 de notre API).
 * @param {unknown} raw
 * @returns {{ ok: true, bbox: [number, number, number, number] } | { ok: false, error: string }}
 */
export function parseBbox(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, error: 'paramètre bbox manquant (minLon,minLat,maxLon,maxLat)' };
  const parts = raw.split(',');
  if (parts.length !== 4) return { ok: false, error: 'bbox attend quatre nombres : minLon,minLat,maxLon,maxLat' };
  const n = parts.map((p) => (p.trim() === '' ? Number.NaN : Number(p)));
  if (!n.every(Number.isFinite)) return { ok: false, error: 'bbox : nombres invalides' };
  const [minLon, minLat, maxLon, maxLat] = n;
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) return { ok: false, error: 'bbox : coordonnées hors limites' };
  if (minLon >= maxLon || minLat >= maxLat) return { ok: false, error: 'bbox : min doit être inférieur à max (ordre lon,lat)' };
  if (maxLon - minLon > MAX_BBOX_SPAN_DEG || maxLat - minLat > MAX_BBOX_SPAN_DEG) {
    return { ok: false, error: `bbox trop grande : ${MAX_BBOX_SPAN_DEG}° au plus de chaque côté` };
  }
  return { ok: true, bbox: [minLon, minLat, maxLon, maxLat] };
}

const round = (v, decimals) => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};

/** Boîte élargie à la grille de 0.05° (les minimums vers le bas, les maximums vers le haut) : clé de cache et zone lue. */
export function roundBbox(bbox) {
  const lo = (v) => round(Math.floor(v / BBOX_STEP_DEG + 1e-9) * BBOX_STEP_DEG, 4);
  const hi = (v) => round(Math.ceil(v / BBOX_STEP_DEG - 1e-9) * BBOX_STEP_DEG, 4);
  return [lo(bbox[0]), lo(bbox[1]), hi(bbox[2]), hi(bbox[3])];
}

/** URL WFS d'un scénario : la boîte est convertie de lon,lat (notre API) en lat,lon (URN EPSG:4326 du WFS 2.0). */
export function floodUrl(layer, bbox, count = MAX_FEATURES_PER_SCENARIO) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const q = new URLSearchParams({ service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: layer, outputFormat: 'geojson', count: String(count) });
  return `${FLOOD_WFS_BASE}?${q.toString()}&bbox=${minLat},${minLon},${maxLat},${maxLon},urn:ogc:def:crs:EPSG::4326`;
}

function sqDistToSegment(p, a, b) {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

/** Douglas-Peucker itératif d'une ligne ouverte : garde toujours les deux extrémités. */
export function simplifyLine(points, tolerance) {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const tol2 = tolerance * tolerance;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    let max = tol2;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = sqDistToSegment(points[i], points[first], points[last]);
      if (d > max) { index = i; max = d; }
    }
    if (index !== -1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_p, i) => keep[i] === 1);
}

/**
 * Simplifie un anneau fermé (premier point = dernier). Une ligne fermée a ses deux extrémités confondues : on coupe au point le plus
 * éloigné du départ. Rend un anneau fermé de 4 points au moins, sinon null (anneau dégénéré).
 */
export function simplifyRing(ring, tolerance = SIMPLIFY_TOLERANCE_DEG) {
  const open = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring.slice();
  if (open.length < 3) return null;
  let far = 1;
  let best = -1;
  for (let i = 1; i < open.length; i++) {
    const dx = open[i][0] - open[0][0];
    const dy = open[i][1] - open[0][1];
    const d = dx * dx + dy * dy;
    if (d > best) { best = d; far = i; }
  }
  const a = simplifyLine(open.slice(0, far + 1), tolerance);
  const b = simplifyLine([...open.slice(far), open[0]], tolerance);
  const out = [...a, ...b.slice(1)];
  return out.length >= 4 ? out : null;
}

/** Arrondit à 5 décimales (~1 m) et retire les points consécutifs confondus ; refermé si besoin. */
function roundRing(ring) {
  const out = [];
  for (const p of ring) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const q = [round(p[0], 5), round(p[1], 5)];
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  if (out.length > 0 && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push([out[0][0], out[0][1]]);
  return out;
}

/**
 * Zones d'une entité GeoJSON : un anneau extérieur (trous écartés) par polygone, simplifié et arrondi.
 * @returns {Array<{ id: string, scenario: string, ring: Array<[number, number]> }>}
 */
export function featureZones(feature, scenario) {
  const geometry = feature?.geometry;
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  const baseId = String(feature?.properties?.id ?? '');
  const zones = [];
  polygons.forEach((poly, k) => {
    const outer = Array.isArray(poly) ? poly[0] : null;
    if (!Array.isArray(outer)) return;
    const rounded = roundRing(outer);
    // Un petit polygone (< ~100 m) s'effondrerait sous la tolérance : gardé tel quel (arrondi) s'il reste un anneau valide.
    const ring = simplifyRing(rounded) ?? (rounded.length >= 4 ? rounded : null);
    if (!ring) return;
    zones.push({ id: k === 0 ? baseId : `${baseId}-${k}`, scenario, ring });
  });
  return zones;
}

/** Zones d'une FeatureCollection lue ; `truncated` quand le plafond d'entités est atteint. */
export function parseFloodCollection(fc, scenario, cap = MAX_FEATURES_PER_SCENARIO) {
  if (!fc || !Array.isArray(fc.features)) throw new Error('réponse WFS inattendue (pas de FeatureCollection)');
  return { zones: fc.features.flatMap((f) => featureZones(f, scenario)), truncated: fc.features.length >= cap, features: fc.features.length };
}

async function readScenario({ scenario, layer, label }, bbox) {
  const key = `env:flood-zones:v2:${scenario}:${bbox.join(',')}`;
  const cap = featureCap(bbox);
  try {
    const read = await cachedSource(
      key,
      { ttlSec: FLOOD_TTL_SEC, staleSec: FLOOD_STALE_SEC, shared: true, waitMs: FLOOD_FETCH_TIMEOUT_MS + 1_000 },
      async () => parseFloodCollection(await fetchStrictJson(floodUrl(layer, bbox, cap), { timeoutMs: FLOOD_FETCH_TIMEOUT_MS }), scenario, cap),
    );
    return { ok: true, read, label, cap };
  } catch (err) {
    return { ok: false, error: sourceError(`Géorisques, zones inondables (${label})`, err) };
  }
}

/**
 * Zones inondables officielles de la boîte `[minLon, minLat, maxLon, maxLat]` (CRS84, déjà validée par parseBbox).
 * `scenarios` : scénarios lus (tous si null). `readAt` est null si aucun scénario n'a pu être lu. `covered` : au moins une zone trouvée (hors TRI : false, normal).
 */
export async function loadFloodZones(bbox, now = Date.now(), scenarios = null) {
  const rounded = roundBbox(bbox);
  const layers = scenarios ? FLOOD_LAYERS.filter((l) => scenarios.includes(l.scenario)) : FLOOD_LAYERS;
  const results = await Promise.all(layers.map((l) => readScenario(l, rounded)));
  const errors = [];
  const zones = [];
  let anyRead = false;
  for (const r of results) {
    if (!r.ok) { errors.push(r.error); continue; }
    anyRead = true;
    zones.push(...r.read.zones);
    if (r.read.truncated) errors.push(`Géorisques, zones inondables (${r.label}) : tronqué à ${r.cap} entités, réduire la boîte`);
  }
  return { readAt: anyRead ? new Date(now).toISOString() : null, bbox: rounded, zones, covered: zones.length > 0, errors };
}

/**
 * Scénarios demandés (`scenarios=frequent,moyen`) : absent ou vide, les trois ; un nom inconnu rend une erreur (400).
 * @returns {{ ok: true, scenarios: string[] } | { ok: false, error: string }}
 */
export function parseScenarios(raw) {
  const all = FLOOD_LAYERS.map((l) => l.scenario);
  if (raw === undefined || raw === null || raw === '') return { ok: true, scenarios: all };
  const asked = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  const bad = asked.filter((s) => !all.includes(s));
  if (bad.length > 0 || asked.length === 0) return { ok: false, error: `scénario inconnu : ${bad.join(', ') || String(raw)} (frequent, moyen, extreme)` };
  return { ok: true, scenarios: all.filter((s) => asked.includes(s)) };
}

export function emptyFloodZones(bbox, errors) {
  return { readAt: null, bbox, zones: [], covered: false, errors };
}
