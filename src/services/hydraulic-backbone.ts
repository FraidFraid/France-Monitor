import { HYDRAULIC_BACKBONE_SEEDS } from '../config/hydraulic-backbone.ts';
import type {
  EcowattResponse,
  FloodSegment,
  FloodVigilanceLevel,
  HydraulicBackboneAsset,
  HydraulicTrend,
  MeteoAlert,
} from '../types/index.ts';

const REGION_TO_CODE: Record<string, string> = {
  'Ile-de-France': '11',
  'Île-de-France': '11',
  'Centre-Val de Loire': '24',
  'Bourgogne-Franche-Comté': '27',
  'Normandie': '28',
  'Hauts-de-France': '32',
  'Grand Est': '44',
  'Pays de la Loire': '52',
  'Bretagne': '53',
  'Nouvelle-Aquitaine': '75',
  'Occitanie': '76',
  'Auvergne-Rhône-Alpes': '84',
  "Provence-Alpes-Côte d'Azur": '93',
  'Corse': '94',
};

const REGION_TO_DEPARTMENTS: Record<string, string[]> = {
  'Île-de-France': ['75', '77', '78', '91', '92', '93', '94', '95'],
  'Centre-Val de Loire': ['18', '28', '36', '37', '41', '45'],
  'Bourgogne-Franche-Comté': ['21', '25', '39', '58', '70', '71', '89', '90'],
  'Normandie': ['14', '27', '50', '61', '76'],
  'Hauts-de-France': ['02', '59', '60', '62', '80'],
  'Grand Est': ['08', '10', '51', '52', '54', '55', '57', '67', '68', '88'],
  'Pays de la Loire': ['44', '49', '53', '72', '85'],
  'Bretagne': ['22', '29', '35', '56'],
  'Nouvelle-Aquitaine': ['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87'],
  'Occitanie': ['09', '11', '12', '30', '31', '32', '34', '46', '48', '65', '66', '81', '82'],
  'Auvergne-Rhône-Alpes': ['01', '03', '07', '15', '26', '38', '42', '43', '63', '69', '73', '74'],
  "Provence-Alpes-Côte d'Azur": ['04', '05', '06', '13', '83', '84'],
  'Corse': ['2A', '2B'],
  'Guadeloupe': ['971'],
  'Martinique': ['972'],
  'Guyane': ['973'],
  'La Réunion': ['974'],
  'Mayotte': ['976'],
};

const REGIONAL_DEPENDENCY: Record<string, number> = {
  'Auvergne-Rhône-Alpes': 9,
  "Provence-Alpes-Côte d'Azur": 8,
  'Occitanie': 8,
  'Nouvelle-Aquitaine': 7,
  'Grand Est': 7,
  'Bourgogne-Franche-Comté': 6,
  'Bretagne': 5,
  'Corse': 9,
  'Guyane': 10,
  'La Réunion': 9,
  'Martinique': 8,
  'Guadeloupe': 8,
};

const ISOLATION_FACTOR: Record<string, number> = {
  'Corse': 3,
  'Guyane': 5,
  'La Réunion': 4,
  'Martinique': 4,
  'Guadeloupe': 4,
  'Mayotte': 5,
};

const FLOOD_LEVEL_SCORES: Record<FloodVigilanceLevel, number> = {
  green: 0,
  yellow: 1,
  orange: 2,
  red: 3,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (value: number): number => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function flattenFloodCoordinates(segment: FloodSegment): [number, number][] {
  const geometry = segment.displayGeometry ?? segment.geometry;
  if (geometry.type === 'LineString') {
    return geometry.coordinates as [number, number][];
  }
  return (geometry.coordinates as [number, number][][]).flat();
}

function getNearestFloodLevel(
  asset: Pick<HydraulicBackboneAsset, 'location' | 'river'>,
  floods: FloodSegment[],
): FloodVigilanceLevel | null {
  if (floods.length === 0) return null;

  const normalizedRiver = normalize(asset.river);
  let bestByName: FloodVigilanceLevel | null = null;
  let nearestLevel: FloodVigilanceLevel | null = null;
  let nearestDistanceKm = Infinity;

  for (const segment of floods) {
    const segmentName = normalize(segment.name);
    if (normalizedRiver && segmentName.includes(normalizedRiver)) {
      if (!bestByName || FLOOD_LEVEL_SCORES[segment.level] > FLOOD_LEVEL_SCORES[bestByName]) {
        bestByName = segment.level;
      }
      continue;
    }

    const coords = flattenFloodCoordinates(segment);
    for (const [lon, lat] of coords) {
      const distanceKm = haversineKm(asset.location.lat, asset.location.lon, lat, lon);
      if (distanceKm < nearestDistanceKm) {
        nearestDistanceKm = distanceKm;
        nearestLevel = segment.level;
      }
    }
  }

  if (bestByName) return bestByName;
  return nearestDistanceKm <= 35 ? nearestLevel : null;
}

function getWeatherPressure(asset: HydraulicBackboneAsset, alerts: MeteoAlert[]): number {
  const departments = new Set(REGION_TO_DEPARTMENTS[asset.location.region] ?? []);
  if (departments.size === 0) return 0;

  let pressure = 0;
  for (const alert of alerts) {
    if (!departments.has(alert.departmentCode)) continue;
    const relevantRisk = alert.risks.includes('rain-flood') || alert.risks.includes('flood');
    if (!relevantRisk) continue;

    if (alert.level === 'red') pressure = Math.max(pressure, 3);
    else if (alert.level === 'orange') pressure = Math.max(pressure, 2);
    else if (alert.level === 'yellow') pressure = Math.max(pressure, 1);
  }

  return pressure;
}

function getDownstreamRisk(asset: HydraulicBackboneAsset): number {
  let risk = 2;

  if (asset.subtype === 'pumped_storage') risk += 2;
  if (asset.subtype === 'dam' || asset.subtype === 'reservoir') risk += 3;
  if ((asset.reservoir_volume ?? 0) >= 500) risk += 4;
  else if ((asset.reservoir_volume ?? 0) >= 150) risk += 3;
  else if ((asset.reservoir_volume ?? 0) >= 30) risk += 2;

  if ((asset.capacity_mw ?? 0) >= 400) risk += 2;
  if (['Rhône', 'Rhin', 'Durance', 'Dordogne', 'Garonne', 'Truyère'].some((river) => normalize(asset.river).includes(normalize(river)))) {
    risk += 1;
  }

  return clamp(risk, 1, 10);
}

function computeCriticality(asset: HydraulicBackboneAsset): number {
  const capacityScore = asset.capacity_mw != null
    ? clamp((Math.log1p(asset.capacity_mw) / Math.log1p(1800)) * 40, 0, 40)
    : 0;
  const reservoirScore = asset.reservoir_volume != null
    ? clamp((Math.log1p(asset.reservoir_volume) / Math.log1p(3650)) * 25, 0, 25)
    : 0;
  const regionalDependency = (REGIONAL_DEPENDENCY[asset.location.region] ?? 5) * 2;
  const downstreamRisk = getDownstreamRisk(asset) * 2;
  const isolationScore = (ISOLATION_FACTOR[asset.location.region] ?? 0) * 3;
  const storageBonus = asset.type === 'step_storage' ? 6 : 0;

  return Math.round(clamp(capacityScore + reservoirScore + regionalDependency + downstreamRisk + isolationScore + storageBonus, 0, 100));
}

function computeHydroTrend(
  asset: HydraulicBackboneAsset,
  ecowatt: EcowattResponse | null,
  floods: FloodSegment[],
  alerts: MeteoAlert[],
): HydraulicTrend {
  const regionCode = REGION_TO_CODE[asset.location.region];
  const mix = regionCode ? ecowatt?.mixes[regionCode] : undefined;
  const ecowattSignal = regionCode ? ecowatt?.signals[regionCode] : undefined;
  const floodLevel = getNearestFloodLevel(asset, floods);
  const weatherPressure = getWeatherPressure(asset, alerts);
  const hydroShare = mix && mix.total > 0 ? mix.hydro / mix.total : null;

  let score = 0;

  if (hydroShare != null) {
    if (hydroShare >= 0.30) score += 1;
    else if (hydroShare <= 0.08) score -= 1;
  }

  if (ecowattSignal === 'red') score += asset.type === 'step_storage' ? 3 : 1;
  else if (ecowattSignal === 'orange') score += asset.type === 'step_storage' ? 2 : 1;

  if (floodLevel) score += FLOOD_LEVEL_SCORES[floodLevel];
  score += weatherPressure;

  if (!regionCode && (ISOLATION_FACTOR[asset.location.region] ?? 0) >= 4) {
    score += 1;
  }

  if (score <= -1) return 'low';
  if (score >= 6) return 'stress';
  if (score >= 3) return 'high';
  return 'normal';
}

export function buildHydraulicBackboneAssets(
  ecowatt: EcowattResponse | null,
  floods: FloodSegment[] = [],
  alerts: MeteoAlert[] = [],
): HydraulicBackboneAsset[] {
  const lastUpdate = ecowatt?.national.timestamp?.toISOString() ?? new Date().toISOString();

  return HYDRAULIC_BACKBONE_SEEDS
    .map((seed) => {
      const baseAsset: HydraulicBackboneAsset = {
        ...seed,
        criticality_score: 0,
        signals: {
          hydro_trend: 'normal',
          last_update: lastUpdate,
        },
      };

      const criticalityScore = computeCriticality(baseAsset);
      const hydroTrend = computeHydroTrend(baseAsset, ecowatt, floods, alerts);

      return {
        ...baseAsset,
        criticality_score: criticalityScore,
        signals: {
          hydro_trend: hydroTrend,
          last_update: lastUpdate,
        },
      };
    })
    .sort((a, b) => b.criticality_score - a.criticality_score || a.name.localeCompare(b.name, 'fr'));
}
