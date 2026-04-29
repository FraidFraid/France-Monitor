/**
 * french-ports.ts — Ports maritimes français avec zone de surveillance.
 * Utilisé pour le filtrage et la contextualisation des navires AIS.
 * Source : Grand Ports Maritimes (GPM) + ports régionaux
 */

import {
  FRENCH_MARITIME_TERRITORIES,
  getFrenchMaritimeTerritory,
  isInFrenchMaritimeArea,
  type FrenchMaritimeTerritory,
  type FrenchMaritimeTerritoryCode,
} from './frenchMaritimeTerritories.ts';

export interface FrenchPort {
  id: string;
  name: string;
  locode: string;          // UN/LOCODE
  lat: number;
  lon: number;
  radiusKm: number;        // Rayon de la zone de surveillance
  type: 'commercial' | 'military' | 'fishing' | 'mixed';
  region: string;
  trafficMTons?: number;   // Trafic annuel en millions de tonnes (pour triage)
}

export const FRENCH_PORTS: FrenchPort[] = [
  // ─── Grands Ports Maritimes (GPM) ───
  { id: 'leh', name: 'Le Havre',           locode: 'FRLEH', lat: 49.494,  lon: 0.108,    radiusKm: 25, type: 'commercial', region: 'Normandie',          trafficMTons: 73 },
  { id: 'mrs', name: 'Marseille-Fos',      locode: 'FRMRS', lat: 43.296,  lon: 5.380,    radiusKm: 30, type: 'commercial', region: 'PACA',               trafficMTons: 78 },
  { id: 'dkk', name: 'Dunkerque',          locode: 'FRDKK', lat: 51.036,  lon: 2.377,    radiusKm: 20, type: 'commercial', region: 'Hauts-de-France',    trafficMTons: 51 },
  { id: 'rou', name: 'Rouen',              locode: 'FRURO', lat: 49.443,  lon: 1.100,    radiusKm: 20, type: 'commercial', region: 'Normandie',          trafficMTons: 22 },
  { id: 'nte', name: 'Nantes-St-Nazaire',  locode: 'FRNTS', lat: 47.218,  lon: -2.200,   radiusKm: 25, type: 'commercial', region: 'Pays de la Loire',   trafficMTons: 31 },
  { id: 'brd', name: 'Bordeaux',           locode: 'FRBOD', lat: 44.838,  lon: -0.578,   radiusKm: 20, type: 'commercial', region: 'Nouvelle-Aquitaine', trafficMTons: 9  },
  { id: 'srs', name: 'La Rochelle',        locode: 'FRLRH', lat: 46.160,  lon: -1.151,   radiusKm: 15, type: 'commercial', region: 'Nouvelle-Aquitaine', trafficMTons: 10 },
  { id: 'set', name: 'Sète',              locode: 'FRSET', lat: 43.404,  lon: 3.696,    radiusKm: 15, type: 'commercial', region: 'Occitanie',          trafficMTons: 4  },
  // ─── Ports militaires ───
  { id: 'bst', name: 'Brest (Marine)',     locode: 'FRBST', lat: 48.383,  lon: -4.495,   radiusKm: 20, type: 'military',   region: 'Bretagne' },
  { id: 'tln', name: 'Toulon (Marine)',    locode: 'FRTLN', lat: 43.124,  lon: 5.928,    radiusKm: 20, type: 'military',   region: 'PACA' },
  { id: 'chb', name: 'Cherbourg',         locode: 'FRCHER', lat: 49.646,  lon: -1.622,   radiusKm: 15, type: 'mixed',     region: 'Normandie' },
  // ─── Ports de ferry / passagers ───
  { id: 'cal', name: 'Calais',            locode: 'FRCQF', lat: 50.960,  lon: 1.850,    radiusKm: 15, type: 'commercial', region: 'Hauts-de-France',    trafficMTons: 3  },
  { id: 'dpe', name: 'Dieppe',            locode: 'FRDDP', lat: 49.929,  lon: 1.085,    radiusKm: 10, type: 'mixed',     region: 'Normandie' },
  { id: 'ler', name: 'Roscoff',           locode: 'FRROS', lat: 48.726,  lon: -3.985,   radiusKm: 10, type: 'mixed',     region: 'Bretagne' },
  { id: 'sml', name: 'Saint-Malo',        locode: 'FRSML', lat: 48.651,  lon: -2.025,   radiusKm: 10, type: 'mixed',     region: 'Bretagne' },
  // ─── Ports DROM ───
  { id: 'ftd', name: 'Fort-de-France',    locode: 'MQFDF', lat: 14.609,  lon: -61.079,  radiusKm: 20, type: 'mixed',     region: 'Martinique' },
  { id: 'ptp', name: 'Pointe-à-Pitre',   locode: 'GPPTP', lat: 16.242,  lon: -61.534,  radiusKm: 20, type: 'mixed',     region: 'Guadeloupe' },
  { id: 'reu', name: 'La Réunion',        locode: 'RERNU', lat: -20.930, lon: 55.467,   radiusKm: 20, type: 'commercial',region: 'Réunion' },
  { id: 'dza', name: 'Dzaoudzi',           locode: 'YTDZA', lat: -12.783, lon: 45.283,   radiusKm: 18, type: 'mixed',     region: 'Mayotte' },
  { id: 'ddc', name: 'Dégrad des Cannes',  locode: 'GFCAY', lat: 4.850,   lon: -52.270,  radiusKm: 30, type: 'commercial',region: 'Guyane' },
  { id: 'sxm', name: 'Marigot',            locode: 'MFMAR', lat: 18.067,  lon: -63.083,  radiusKm: 12, type: 'mixed',     region: 'Saint-Martin' },
  { id: 'sbh', name: 'Gustavia',           locode: 'BLGUS', lat: 17.897,  lon: -62.852,  radiusKm: 10, type: 'mixed',     region: 'Saint-Barthélemy' },
  { id: 'spm', name: 'Saint-Pierre',       locode: 'PMSPI', lat: 46.780,  lon: -56.173,  radiusKm: 15, type: 'fishing',   region: 'Saint-Pierre-et-Miquelon' },
];

export { FRENCH_MARITIME_TERRITORIES, getFrenchMaritimeTerritory, isInFrenchMaritimeArea };
export type { FrenchMaritimeTerritory, FrenchMaritimeTerritoryCode };

export function isInFranceZone(lat: number, lon: number, territoryCode?: FrenchMaritimeTerritoryCode): boolean {
  return isInFrenchMaritimeArea(lat, lon, territoryCode, 'strict');
}

export function getNearestPort(lat: number, lon: number): { port: FrenchPort; distanceKm: number } | null {
  let nearest: FrenchPort | null = null;
  let minDist = Infinity;
  for (const port of FRENCH_PORTS) {
    const dlat = (lat - port.lat) * 111;
    const dlon = (lon - port.lon) * 111 * Math.cos((lat * Math.PI) / 180);
    const dist = Math.sqrt(dlat * dlat + dlon * dlon);
    if (dist < minDist) { minDist = dist; nearest = port; }
  }
  if (!nearest || minDist > 500) return null;
  return { port: nearest, distanceKm: Math.round(minDist * 10) / 10 };
}
