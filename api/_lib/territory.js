// api/_lib/territory.js : périmètre « au-dessus de la France » des couches Souveraineté (spec 2026-10-04 souveraineté V2 ;
// contrats, arbitrage 5). Un point est en France s'il est dans un département métropolitain, ou en mer française à moins de 22 km
// (12 milles) de la côte métropolitaine. La marge de 22 km ne vaut qu'en mer : Genève est à 4,4 km de la frontière, mais en Suisse.
// Module à part : api/_lib/ais-snapshot.js importe déjà geo-fr.js, un import inverse ferait un cycle.
import { departementAt, distanceToMetropoleKm } from './geo-fr.js';
import { inFrenchWaters } from './ais-snapshot.js';

/** Mer territoriale : 12 milles nautiques, arrondis à 22 km. */
export const FRANCE_SEA_MARGIN_KM = 22;

/**
 * Vrai si le point est au-dessus de la France (V2) : département métropolitain, ou eaux françaises à moins de 22 km de la côte.
 * @param {number} lat
 * @param {number} lon
 */
export function inFranceV2(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (departementAt(lat, lon) !== null) return true;
  return inFrenchWaters(lat, lon) && distanceToMetropoleKm(lat, lon, FRANCE_SEA_MARGIN_KM) <= FRANCE_SEA_MARGIN_KM;
}

/**
 * Vrai si le point est à moins de `km` du territoire métropolitain, frontières terrestres comprises (approches des urgences : 40 km).
 * @param {number} lat
 * @param {number} lon
 * @param {number} km
 */
export function nearFrance(lat, lon, km) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return distanceToMetropoleKm(lat, lon, km) <= km;
}
