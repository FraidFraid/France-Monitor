// api/_lib/french-warship.js : pavillon français et bâtiment militaire français, prédicat unique (arbitrage FX2). Module pur, sans
// dépendance Node : la veille des câbles (serveur, cable-watch.js), l'instantané AIS (ais-snapshot.js) et la détection des anomalies
// AIS (navigateur, src/services/ais-anomalies.ts) lisent la même règle.

/** Codes pays (MID) français : métropole et outre-mer. */
const FRENCH_MIDS = new Set(['226', '227', '228', '329', '347', '361', '501', '540', '546', '578', '607', '618', '635', '660']);
/** Type AIS « militaire ». */
const MILITARY_TYPE = 35;
/** Nom AIS des bâtiments de la Marine nationale sans message statique (FX2) ; retenu sous pavillon français seulement (isFrenchFlag). */
const FRENCH_WARSHIP_NAME = 'FRENCH WARSHIP';

/**
 * Pavillon français (métropole et outre-mer) d'après les trois premiers chiffres du MMSI.
 * @param {string | number} mmsi
 * @returns {boolean}
 */
export function isFrenchFlag(mmsi) {
  return FRENCH_MIDS.has(String(mmsi).slice(0, 3));
}

/**
 * Bâtiment militaire français, sous pavillon français (isFrenchFlag : métropole et outre-mer, MID 226 à 228, 329, 501, 540…) : type
 * AIS 35, ou nom AIS qui commence par « FRENCH WARSHIP » (espaces de tête et casse ignorés) ; la Marine nationale émet souvent ce nom
 * sans message statique, donc sans type (arbitrage FX2, deuxième tour : outre-mer compris).
 * @param {{ mmsi: string, name?: string | null, typeCode?: number | null }} v
 * @returns {boolean}
 */
export function isFrenchWarship(v) {
  if (!isFrenchFlag(v.mmsi)) return false;
  return v.typeCode === MILITARY_TYPE
    || (typeof v.name === 'string' && v.name.trim().toUpperCase().startsWith(FRENCH_WARSHIP_NAME));
}
