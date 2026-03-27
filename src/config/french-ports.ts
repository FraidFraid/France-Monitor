/**
 * french-ports.ts — Ports maritimes français avec zone de surveillance.
 * Utilisé pour le filtrage et la contextualisation des navires AIS.
 * Source : Grand Ports Maritimes (GPM) + ports régionaux
 */

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
];

// Zone France métropolitaine + ZEE proche-côtière (boîte englobante élargie)
export const FRANCE_BBOX = {
  minLat: 41.0, maxLat: 51.5,
  minLon: -6.0, maxLon: 10.0,
};

// Bboxes DROM
export const DROM_BBOXES = [
  { name: 'Martinique',   minLat: 14.3, maxLat: 14.9, minLon: -61.3, maxLon: -60.7 },
  { name: 'Guadeloupe',   minLat: 15.8, maxLat: 16.6, minLon: -61.9, maxLon: -60.9 },
  { name: 'Guyane',       minLat: 2.0,  maxLat: 6.0,  minLon: -55.0, maxLon: -51.0 },
  { name: 'Réunion',      minLat: -21.5,maxLat: -20.5,minLon: 55.0,  maxLon: 56.0  },
  { name: 'Mayotte',      minLat: -13.1,maxLat: -12.5,minLon: 44.9,  maxLon: 45.4  },
];

export function isInFranceZone(lat: number, lon: number): boolean {
  const inMetro = lat >= FRANCE_BBOX.minLat && lat <= FRANCE_BBOX.maxLat &&
                  lon >= FRANCE_BBOX.minLon && lon <= FRANCE_BBOX.maxLon;
  if (inMetro) return true;
  return DROM_BBOXES.some(b => lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon);
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
