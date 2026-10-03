// api/_lib/geo-fr.js : géographie serveur de la France métropolitaine, lue dans le fichier des régions déjà
// servi par l'application (public/data/regions.geojson, 13 régions métropolitaines et 5 DROM). Sert au trafic
// aérien (aéronefs au-dessus du territoire et de ses approches), au rail (région du premier arrêt d'un TER)
// et au relais AIS (distance à la côte des navires sensibles). Sans dépendance (point dans polygone par
// lancer de rayon, distances en projection équirectangulaire locale, précision de l'ordre de 100 m).
import { readFileSync } from 'node:fs';

export const REGIONS_PATH = new URL('../../public/data/regions.geojson', import.meta.url);
const EARTH_KM = 6371;

let cache = null;

/** Régions métropolitaines : nom, anneaux (lon, lat) et boîte englobante. Lecture unique par processus. */
export function metropoleRegions() {
  if (cache) return cache;
  const geo = JSON.parse(readFileSync(REGIONS_PATH, 'utf8'));
  cache = geo.features
    .filter((f) => !String(f.properties?.code ?? '').startsWith('0'))
    .map((f) => {
      const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      let minLon = Infinity; let minLat = Infinity; let maxLon = -Infinity; let maxLat = -Infinity;
      for (const poly of polygons) for (const ring of poly) for (const [lon, lat] of ring) {
        minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      }
      return { code: String(f.properties.code), name: String(f.properties.nom), polygons, bbox: [minLon, minLat, maxLon, maxLat] };
    });
  return cache;
}

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Point dans un polygone GeoJSON (anneau extérieur, trous exclus). */
export function inPolygon(lon, lat, polygon) {
  if (!inRing(lon, lat, polygon[0])) return false;
  for (const hole of polygon.slice(1)) if (inRing(lon, lat, hole)) return false;
  return true;
}

/** Région métropolitaine contenant le point, ou null (mer, étranger, DROM). */
export function regionAt(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  for (const r of metropoleRegions()) {
    const [x0, y0, x1, y1] = r.bbox;
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
    if (r.polygons.some((p) => inPolygon(lon, lat, p))) return r.name;
  }
  return null;
}

/** Vrai si le point est sur le territoire métropolitain (Corse comprise). */
export function insideMetropole(lat, lon) {
  return regionAt(lat, lon) !== null;
}

/** Distance (km) d'un point à un segment, en projection équirectangulaire centrée sur le point. */
function segmentKm(lat, lon, a, b) {
  const k = Math.cos((lat * Math.PI) / 180);
  const ax = (a[0] - lon) * k; const ay = a[1] - lat;
  const bx = (b[0] - lon) * k; const by = b[1] - lat;
  const dx = bx - ax; const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  const px = ax + t * dx; const py = ay + t * dy;
  return Math.hypot(px, py) * (Math.PI / 180) * EARTH_KM;
}

/**
 * Distance (km) au territoire métropolitain : 0 sur le territoire, sinon distance au bord le plus proche
 * (côte, ou frontière terrestre pour un point à l'étranger). `maxKm` borne la recherche (Infinity : aucune).
 */
export function distanceToMetropoleKm(lat, lon, maxKm = Infinity) {
  if (insideMetropole(lat, lon)) return 0;
  const padLat = Number.isFinite(maxKm) ? maxKm / 111 : Infinity;
  const padLon = padLat * 1.6;
  let best = Infinity;
  for (const r of metropoleRegions()) {
    const [x0, y0, x1, y1] = r.bbox;
    if (lon < x0 - padLon || lon > x1 + padLon || lat < y0 - padLat || lat > y1 + padLat) continue;
    for (const poly of r.polygons) for (const ring of poly) {
      for (let i = 1; i < ring.length; i += 1) best = Math.min(best, segmentKm(lat, lon, ring[i - 1], ring[i]));
    }
  }
  return best;
}

/** Distance orthodromique (km) entre deux points. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
