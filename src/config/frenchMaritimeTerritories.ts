/**
 * frenchMaritimeTerritories.ts — Référentiel géographique des zones maritimes françaises.
 *
 * Les polygones ci-dessous sont volontairement simples: ils matérialisent une zone
 * maritime opérationnelle robuste pour le géofencing AIS, sans dépendre d'un trait
 * de côte fin. Pour affiner un territoire, remplacer `maritimeArea` par un GeoJSON
 * plus précis en conservant la même interface.
 */

export type FrenchMaritimeTerritoryCode =
  | 'FR-METRO'
  | 'GP'
  | 'MQ'
  | 'GF'
  | 'RE'
  | 'YT'
  | 'MF'
  | 'BL'
  | 'PM'
  | 'WF'
  | 'PF'
  | 'NC';

export type FrenchMaritimeDetectionMode = 'strict' | 'wide';

export interface MaritimeBbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface FrenchMaritimeTerritory {
  code: FrenchMaritimeTerritoryCode;
  name: string;
  bbox: MaritimeBbox;
  wideBbox: MaritimeBbox;
  maritimeArea: Array<[number, number]>;
  center: [number, number];
  zoom: number;
  coastalBufferKm: number;
}

function bboxPolygon(bbox: MaritimeBbox): Array<[number, number]> {
  return [
    [bbox.minLon, bbox.minLat],
    [bbox.maxLon, bbox.minLat],
    [bbox.maxLon, bbox.maxLat],
    [bbox.minLon, bbox.maxLat],
    [bbox.minLon, bbox.minLat],
  ];
}

function expandBbox(bbox: MaritimeBbox, degrees: number): MaritimeBbox {
  return {
    minLon: bbox.minLon - degrees,
    minLat: bbox.minLat - degrees,
    maxLon: bbox.maxLon + degrees,
    maxLat: bbox.maxLat + degrees,
  };
}

function territory(
  code: FrenchMaritimeTerritoryCode,
  name: string,
  bbox: MaritimeBbox,
  center: [number, number],
  zoom: number,
  coastalBufferKm = 80,
  wideExpandDegrees = 1.2,
): FrenchMaritimeTerritory {
  const wideBbox = expandBbox(bbox, wideExpandDegrees);
  return {
    code,
    name,
    bbox,
    wideBbox,
    maritimeArea: bboxPolygon(bbox),
    center,
    zoom,
    coastalBufferKm,
  };
}

export const FRENCH_MARITIME_TERRITORIES: FrenchMaritimeTerritory[] = [
  territory('FR-METRO', 'France hexagonale', { minLon: -6.0, minLat: 41.0, maxLon: 10.0, maxLat: 51.5 }, [2.2, 46.6], 5, 120, 0),
  territory('GP', 'Guadeloupe', { minLon: -61.95, minLat: 15.75, maxLon: -60.85, maxLat: 16.65 }, [-61.53, 16.25], 8),
  territory('MQ', 'Martinique', { minLon: -61.35, minLat: 14.25, maxLon: -60.75, maxLat: 14.95 }, [-61.08, 14.6], 9),
  territory('GF', 'Guyane', { minLon: -54.8, minLat: 2.0, maxLon: -51.45, maxLat: 5.95 }, [-53.0, 4.0], 7, 120),
  territory('RE', 'La Réunion', { minLon: 55.15, minLat: -21.45, maxLon: 55.95, maxLat: -20.75 }, [55.53, -21.12], 9),
  territory('YT', 'Mayotte', { minLon: 44.85, minLat: -13.1, maxLon: 45.45, maxLat: -12.55 }, [45.17, -12.83], 9),
  territory('MF', 'Saint-Martin', { minLon: -63.2, minLat: 17.85, maxLon: -62.9, maxLat: 18.2 }, [-63.05, 18.07], 10, 40, 0.6),
  territory('BL', 'Saint-Barthélemy', { minLon: -62.95, minLat: 17.82, maxLon: -62.75, maxLat: 17.98 }, [-62.85, 17.9], 11, 35, 0.6),
  territory('PM', 'Saint-Pierre-et-Miquelon', { minLon: -56.6, minLat: 46.65, maxLon: -56.05, maxLat: 47.25 }, [-56.28, 46.9], 9, 60, 0.8),
  territory('WF', 'Wallis-et-Futuna', { minLon: -178.35, minLat: -14.45, maxLon: -176.05, maxLat: -13.15 }, [-177.2, -13.75], 8, 80),
  territory('PF', 'Polynésie française', { minLon: -154.8, minLat: -28.0, maxLon: -134.0, maxLat: -7.5 }, [-149.57, -17.53], 5, 120, 0),
  territory('NC', 'Nouvelle-Calédonie', { minLon: 158.0, minLat: -23.2, maxLon: 172.5, maxLat: -18.0 }, [166.44, -22.28], 6, 120, 0),
];

export const FRENCH_MARITIME_TERRITORY_BY_CODE = new Map(
  FRENCH_MARITIME_TERRITORIES.map((territoryRef) => [territoryRef.code, territoryRef]),
);

export function isPointInBbox(lat: number, lon: number, bbox: MaritimeBbox): boolean {
  return lon >= bbox.minLon && lon <= bbox.maxLon && lat >= bbox.minLat && lat <= bbox.maxLat;
}

export function isPointInPolygon(lat: number, lon: number, polygon: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    const intersects = (yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function getFrenchMaritimeTerritory(
  lat: number,
  lon: number,
  mode: FrenchMaritimeDetectionMode = 'strict',
): FrenchMaritimeTerritory | null {
  const bboxKey = mode === 'wide' ? 'wideBbox' : 'bbox';
  for (const territoryRef of FRENCH_MARITIME_TERRITORIES) {
    if (!isPointInBbox(lat, lon, territoryRef[bboxKey])) continue;
    if (mode === 'wide' || isPointInPolygon(lat, lon, territoryRef.maritimeArea)) return territoryRef;
  }
  return null;
}

export function isInFrenchMaritimeArea(
  lat: number,
  lon: number,
  territoryCode?: FrenchMaritimeTerritoryCode,
  mode: FrenchMaritimeDetectionMode = 'strict',
): boolean {
  if (!territoryCode) return getFrenchMaritimeTerritory(lat, lon, mode) != null;
  const territoryRef = FRENCH_MARITIME_TERRITORY_BY_CODE.get(territoryCode);
  if (!territoryRef) return false;
  return mode === 'wide'
    ? isPointInBbox(lat, lon, territoryRef.wideBbox)
    : isPointInBbox(lat, lon, territoryRef.bbox) && isPointInPolygon(lat, lon, territoryRef.maritimeArea);
}
