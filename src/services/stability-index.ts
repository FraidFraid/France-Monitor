/**
 * stability-index.ts — Calcul de l'Indice de Stabilité Nationale & Régionale (ISNR)
 *
 * Score 0-100 par département, 0 = stable, 100 = très instable.
 * Agrège 4 dimensions : Social (30%), Sécurité (30%), Infra (20%), Vélocité (20%)
 */

import type {
  NewsItem,
  MeteoAlert,
  FloodSegment,
  EcowattResponse,
  TimeRange,
  ThreatLevel,
  EventCategory,
  ISNRData,
  ISNRScore,
} from '../types/index.ts';

// ═══ Configuration ═══

const DIMENSION_WEIGHTS = {
  social: 0.3,
  security: 0.3,
  infra: 0.3,
  velocity: 0.1,
};

const THREAT_WEIGHTS: Record<ThreatLevel, number> = {
  critical: 100,
  high: 50,
  medium: 25,
  low: 10,
  info: 0,
};

const METEO_LEVEL_WEIGHTS: Record<string, number> = {
  red: 100,
  orange: 60,
  yellow: 30,
  green: 0,
  violet: 100,
};

const FLOOD_LEVEL_WEIGHTS: Record<string, number> = {
  red: 100,
  orange: 60,
  yellow: 30,
  green: 0,
};

// Catégories mappées aux dimensions
const SOCIAL_CATEGORIES: EventCategory[] = ['social'];
const SECURITY_CATEGORIES: EventCategory[] = ['security'];
const INFRA_CATEGORIES: EventCategory[] = ['weather', 'infrastructure', 'energy', 'transport'];

// TimeRange → millisecondes
const TIME_RANGE_MS: Record<TimeRange, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '48h': 48 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  'all': 365 * 24 * 60 * 60 * 1000, // 1 an
};

// ═══ Départements (code → nom) ═══

export const DEPARTMENTS: Record<string, { name: string; regionCode: string }> = {
  '01': { name: 'Ain', regionCode: '84' },
  '02': { name: 'Aisne', regionCode: '32' },
  '03': { name: 'Allier', regionCode: '84' },
  '04': { name: 'Alpes-de-Haute-Provence', regionCode: '93' },
  '05': { name: 'Hautes-Alpes', regionCode: '93' },
  '06': { name: 'Alpes-Maritimes', regionCode: '93' },
  '07': { name: 'Ardeche', regionCode: '84' },
  '08': { name: 'Ardennes', regionCode: '44' },
  '09': { name: 'Ariege', regionCode: '76' },
  '10': { name: 'Aube', regionCode: '44' },
  '11': { name: 'Aude', regionCode: '76' },
  '12': { name: 'Aveyron', regionCode: '76' },
  '13': { name: 'Bouches-du-Rhone', regionCode: '93' },
  '14': { name: 'Calvados', regionCode: '28' },
  '15': { name: 'Cantal', regionCode: '84' },
  '16': { name: 'Charente', regionCode: '75' },
  '17': { name: 'Charente-Maritime', regionCode: '75' },
  '18': { name: 'Cher', regionCode: '24' },
  '19': { name: 'Correze', regionCode: '75' },
  '21': { name: 'Cote-d\'Or', regionCode: '27' },
  '22': { name: 'Cotes-d\'Armor', regionCode: '53' },
  '23': { name: 'Creuse', regionCode: '75' },
  '24': { name: 'Dordogne', regionCode: '75' },
  '25': { name: 'Doubs', regionCode: '27' },
  '26': { name: 'Drome', regionCode: '84' },
  '27': { name: 'Eure', regionCode: '28' },
  '28': { name: 'Eure-et-Loir', regionCode: '24' },
  '29': { name: 'Finistere', regionCode: '53' },
  '30': { name: 'Gard', regionCode: '76' },
  '31': { name: 'Haute-Garonne', regionCode: '76' },
  '32': { name: 'Gers', regionCode: '76' },
  '33': { name: 'Gironde', regionCode: '75' },
  '34': { name: 'Herault', regionCode: '76' },
  '35': { name: 'Ille-et-Vilaine', regionCode: '53' },
  '36': { name: 'Indre', regionCode: '24' },
  '37': { name: 'Indre-et-Loire', regionCode: '24' },
  '38': { name: 'Isere', regionCode: '84' },
  '39': { name: 'Jura', regionCode: '27' },
  '40': { name: 'Landes', regionCode: '75' },
  '41': { name: 'Loir-et-Cher', regionCode: '24' },
  '42': { name: 'Loire', regionCode: '84' },
  '43': { name: 'Haute-Loire', regionCode: '84' },
  '44': { name: 'Loire-Atlantique', regionCode: '52' },
  '45': { name: 'Loiret', regionCode: '24' },
  '46': { name: 'Lot', regionCode: '76' },
  '47': { name: 'Lot-et-Garonne', regionCode: '75' },
  '48': { name: 'Lozere', regionCode: '76' },
  '49': { name: 'Maine-et-Loire', regionCode: '52' },
  '50': { name: 'Manche', regionCode: '28' },
  '51': { name: 'Marne', regionCode: '44' },
  '52': { name: 'Haute-Marne', regionCode: '44' },
  '53': { name: 'Mayenne', regionCode: '52' },
  '54': { name: 'Meurthe-et-Moselle', regionCode: '44' },
  '55': { name: 'Meuse', regionCode: '44' },
  '56': { name: 'Morbihan', regionCode: '53' },
  '57': { name: 'Moselle', regionCode: '44' },
  '58': { name: 'Nievre', regionCode: '27' },
  '59': { name: 'Nord', regionCode: '32' },
  '60': { name: 'Oise', regionCode: '32' },
  '61': { name: 'Orne', regionCode: '28' },
  '62': { name: 'Pas-de-Calais', regionCode: '32' },
  '63': { name: 'Puy-de-Dome', regionCode: '84' },
  '64': { name: 'Pyrenees-Atlantiques', regionCode: '75' },
  '65': { name: 'Hautes-Pyrenees', regionCode: '76' },
  '66': { name: 'Pyrenees-Orientales', regionCode: '76' },
  '67': { name: 'Bas-Rhin', regionCode: '44' },
  '68': { name: 'Haut-Rhin', regionCode: '44' },
  '69': { name: 'Rhone', regionCode: '84' },
  '70': { name: 'Haute-Saone', regionCode: '27' },
  '71': { name: 'Saone-et-Loire', regionCode: '27' },
  '72': { name: 'Sarthe', regionCode: '52' },
  '73': { name: 'Savoie', regionCode: '84' },
  '74': { name: 'Haute-Savoie', regionCode: '84' },
  '75': { name: 'Paris', regionCode: '11' },
  '76': { name: 'Seine-Maritime', regionCode: '28' },
  '77': { name: 'Seine-et-Marne', regionCode: '11' },
  '78': { name: 'Yvelines', regionCode: '11' },
  '79': { name: 'Deux-Sevres', regionCode: '75' },
  '80': { name: 'Somme', regionCode: '32' },
  '81': { name: 'Tarn', regionCode: '76' },
  '82': { name: 'Tarn-et-Garonne', regionCode: '76' },
  '83': { name: 'Var', regionCode: '93' },
  '84': { name: 'Vaucluse', regionCode: '93' },
  '85': { name: 'Vendee', regionCode: '52' },
  '86': { name: 'Vienne', regionCode: '75' },
  '87': { name: 'Haute-Vienne', regionCode: '75' },
  '88': { name: 'Vosges', regionCode: '44' },
  '89': { name: 'Yonne', regionCode: '27' },
  '90': { name: 'Territoire de Belfort', regionCode: '27' },
  '91': { name: 'Essonne', regionCode: '11' },
  '92': { name: 'Hauts-de-Seine', regionCode: '11' },
  '93': { name: 'Seine-Saint-Denis', regionCode: '11' },
  '94': { name: 'Val-de-Marne', regionCode: '11' },
  '95': { name: 'Val-d\'Oise', regionCode: '11' },
  '971': { name: 'Guadeloupe', regionCode: '01' },
  '972': { name: 'Martinique', regionCode: '02' },
  '973': { name: 'Guyane', regionCode: '03' },
  '974': { name: 'La Reunion', regionCode: '04' },
  '976': { name: 'Mayotte', regionCode: '06' },
};

// Mapping région nom → départements (pour feedRegion)
const REGION_TO_DEPTS: Record<string, string[]> = {
  'Ile-de-France': ['75', '77', '78', '91', '92', '93', '94', '95'],
  'Centre-Val de Loire': ['18', '28', '36', '37', '41', '45'],
  'Bourgogne-Franche-Comte': ['21', '25', '39', '58', '70', '71', '89', '90'],
  'Normandie': ['14', '27', '50', '61', '76'],
  'Hauts-de-France': ['02', '59', '60', '62', '80'],
  'Grand Est': ['08', '10', '51', '52', '54', '55', '57', '67', '68', '88'],
  'Pays de la Loire': ['44', '49', '53', '72', '85'],
  'Bretagne': ['22', '29', '35', '56'],
  'Nouvelle-Aquitaine': ['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87'],
  'Occitanie': ['09', '11', '12', '30', '31', '32', '34', '46', '48', '65', '66', '81', '82'],
  'Auvergne-Rhone-Alpes': ['01', '03', '07', '15', '26', '38', '42', '43', '63', '69', '73', '74'],
  'Provence-Alpes-Cote d\'Azur': ['04', '05', '06', '13', '83', '84'],
  'PACA': ['04', '05', '06', '13', '83', '84'],
  'Corse': ['2A', '2B'],
  'Guadeloupe': ['971'],
  'Martinique': ['972'],
  'Guyane': ['973'],
  'La Reunion': ['974'],
  'Mayotte': ['976'],
};

// ═══ Bounding boxes départements (simplifié) ═══
// Utilisé pour assigner un événement géolocalisé à un département

interface DeptBBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

// Quelques départements clés (le reste sera assigné à la région)
const DEPT_BBOXES: Record<string, DeptBBox> = {
  '75': { west: 2.22, south: 48.81, east: 2.47, north: 48.90 }, // Paris
  '92': { west: 2.14, south: 48.78, east: 2.32, north: 48.95 }, // Hauts-de-Seine
  '93': { west: 2.30, south: 48.85, east: 2.60, north: 49.01 }, // Seine-Saint-Denis
  '94': { west: 2.30, south: 48.68, east: 2.62, north: 48.86 }, // Val-de-Marne
  '13': { west: 4.23, south: 43.15, east: 5.80, north: 43.93 }, // Bouches-du-Rhône
  '69': { west: 4.24, south: 45.45, east: 5.16, north: 46.31 }, // Rhône
  '31': { west: 0.44, south: 42.89, east: 2.05, north: 43.92 }, // Haute-Garonne
  '33': { west: -1.26, south: 44.19, east: 0.32, north: 45.58 }, // Gironde
  '59': { west: 2.07, south: 49.97, east: 4.23, north: 51.09 }, // Nord
  '06': { west: 6.63, south: 43.48, east: 7.72, north: 44.36 }, // Alpes-Maritimes
};

// ═══ Cache pour la tendance (scores précédents) ═══

const previousScores: Map<string, number[]> = new Map();

// ═══ Fonctions Utilitaires ═══

export function scoreToLevel(score: number): 'critical' | 'high' | 'medium' | 'low' | 'stable' {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 40) return 'medium';
  if (score >= 20) return 'low';
  return 'stable';
}

export function scoreToEmoji(score: number): string {
  if (score >= 80) return '🔴';
  if (score >= 60) return '🟠';
  if (score >= 40) return '🟡';
  if (score >= 20) return '🟢';
  return '⚪';
}

export function trendToArrow(trend: 'up' | 'down' | 'stable'): string {
  switch (trend) {
    case 'up': return '↗';
    case 'down': return '↘';
    default: return '→';
  }
}

function computeTrend(code: string, currentScore: number): 'up' | 'down' | 'stable' {
  const arr = previousScores.get(code);
  if (!arr || arr.length === 0) return 'stable';
  const diff = currentScore - arr[arr.length - 1];
  if (diff > 5) return 'up';
  if (diff < -5) return 'down';
  return 'stable';
}

// ═══ Géolocalisation → Département ═══

function findDepartmentByCoords(lon: number, lat: number): string | null {
  // Vérifier les bboxes précises
  for (const [code, bbox] of Object.entries(DEPT_BBOXES)) {
    if (lon >= bbox.west && lon <= bbox.east && lat >= bbox.south && lat <= bbox.north) {
      return code;
    }
  }
  return null;
}

function feedRegionToDepts(feedRegion: string): string[] {
  return REGION_TO_DEPTS[feedRegion] ?? [];
}

// ═══ Agrégation des événements par département ═══

export function aggregateByDepartment(items: NewsItem[]): Map<string, NewsItem[]> {
  const result = new Map<string, NewsItem[]>();

  for (const item of items) {
    let deptCodes: string[] = [];

    // 1. Si coordonnées disponibles, chercher le département
    if (item.lon !== undefined && item.lat !== undefined) {
      const dept = findDepartmentByCoords(item.lon, item.lat);
      if (dept) {
        deptCodes = [dept];
      }
    }

    // 2. Sinon, utiliser feedRegion pour distribuer sur la région
    if (deptCodes.length === 0 && item.feedRegion) {
      deptCodes = feedRegionToDepts(item.feedRegion);
    }

    // 3. Fallback : ignorer si aucun département identifié
    for (const code of deptCodes) {
      if (!result.has(code)) {
        result.set(code, []);
      }
      result.get(code)!.push(item);
    }
  }

  return result;
}

// ═══ Calcul des dimensions par département ═══

function computeDimensionScore(
  items: NewsItem[],
  categories: EventCategory[],
  maxScore: number = 100,
): number {
  let total = 0;
  for (const item of items) {
    if (item.threat && categories.includes(item.threat.category)) {
      total += THREAT_WEIGHTS[item.threat.level] ?? 0;
    }
  }
  // Normaliser avec un max raisonnable (12 événements critical = max, seuil ×4 vs avant)
  return Math.min(maxScore, (total / 1200) * maxScore);
}

function computeVelocityScore(items: NewsItem[], _timeRangeMs: number): number {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;

  // Compter les articles de la dernière heure
  const recentCount = items.filter(i => i.pubDate.getTime() > oneHourAgo).length;

  // Score basé sur la densité (25+ articles/h = max — seuil ×5 vs avant)
  return Math.min(100, (recentCount / 25) * 100);
}

function computeInfraFromMeteo(alerts: MeteoAlert[], deptCode: string): number {
  const alert = alerts.find(a => a.departmentCode === deptCode);
  if (!alert) return 0;
  return METEO_LEVEL_WEIGHTS[alert.level] ?? 0;
}

function computeInfraFromFloods(segments: FloodSegment[]): number {
  // Prendre le niveau max des tronçons
  let maxScore = 0;
  for (const seg of segments) {
    const score = FLOOD_LEVEL_WEIGHTS[seg.level] ?? 0;
    if (score > maxScore) maxScore = score;
  }
  return maxScore;
}

function computeInfraFromEcowatt(ecowatt: EcowattResponse | null, deptCode: string): number {
  if (!ecowatt) return 0;
  // Trouver la région du département
  const dept = DEPARTMENTS[deptCode];
  if (!dept) return 0;
  const signal = ecowatt.signals[dept.regionCode];
  if (!signal) return 0;
  // Les tensions électriques (Ecowatt) sont des routines hivernales en France.
  // Elles ne constituent PAS un facteur OSINT de déstabilisation à moins de se traduire par des coupures réelles.
  if (signal === 'red') return 30;
  if (signal === 'orange') return 15;
  return 0;
}

// ═══ Calcul ISNR Principal ═══

export function computeISNR(
  newsItems: NewsItem[],
  meteoAlerts: MeteoAlert[],
  floodSegments: FloodSegment[],
  ecowatt: EcowattResponse | null,
  timeRange: TimeRange,
): ISNRData {
  const now = new Date();
  const timeRangeMs = TIME_RANGE_MS[timeRange];
  const cutoff = now.getTime() - timeRangeMs;

  // Filtrer les événements dans la plage temporelle
  const filteredItems = newsItems.filter(i => i.pubDate.getTime() > cutoff);

  // Agréger par département
  const itemsByDept = aggregateByDepartment(filteredItems);

  const scores: ISNRScore[] = [];
  let nationalTotal = 0;
  let deptCount = 0;

  for (const [code, dept] of Object.entries(DEPARTMENTS)) {
    const items = itemsByDept.get(code) ?? [];

    // Calculer chaque dimension
    const social = Math.round(computeDimensionScore(items, SOCIAL_CATEGORIES));
    const security = Math.round(computeDimensionScore(items, SECURITY_CATEGORIES));

    // Infra = max(météo, crues, ecowatt) + events infra
    const infraFromEvents = computeDimensionScore(items, INFRA_CATEGORIES);
    const infraFromMeteo = computeInfraFromMeteo(meteoAlerts, code);
    const infraFromFlood = computeInfraFromFloods(floodSegments);
    const infraFromEcowatt = computeInfraFromEcowatt(ecowatt, code);
    const infra = Math.round(Math.min(100, Math.max(infraFromEvents, infraFromMeteo, infraFromFlood, infraFromEcowatt)));

    const velocity = Math.round(computeVelocityScore(items, timeRangeMs));

    // Déterminer le driver principal
    let topDriver = undefined;
    const maxDimScore = Math.max(social, security, infra, velocity);

    if (maxDimScore > 0) {
      if (maxDimScore === infra) {
        let source = 'Infrastructures';
        let label = 'Tension Infrastructure';
        if (infra === infraFromMeteo) { source = 'Météo France'; label = 'Alerte Météo'; }
        else if (infra === infraFromEcowatt) { source = 'Ecowatt'; label = 'Tension Électrique'; }
        else if (infra === infraFromFlood) { source = 'Vigicrues'; label = 'Risque Crues'; }
        else if (infra === infraFromEvents) { source = 'Signal Réseau'; label = 'Incidents Infra'; }
        topDriver = { dimension: 'infra', label, score: infra, source };
      } else if (maxDimScore === security) {
        topDriver = { dimension: 'security', label: 'Événements Sécurité', score: security, source: 'Signal Réseau' };
      } else if (maxDimScore === social) {
        topDriver = { dimension: 'social', label: 'Tension Sociale', score: social, source: 'Signal Réseau' };
      } else if (maxDimScore === velocity) {
        topDriver = { dimension: 'velocity', label: 'Vélocité Médiatique', score: velocity, source: 'Signal Réseau' };
      }
    }

    // Score hybride (Moyenne pondérée par défaut, remplacée par Max si alerte)
    const weightedAverage = Math.round(
      social * DIMENSION_WEIGHTS.social +
      security * DIMENSION_WEIGHTS.security +
      infra * DIMENSION_WEIGHTS.infra +
      velocity * DIMENSION_WEIGHTS.velocity
    );

    let score = weightedAverage;
    let status: 'stable' | 'elevated' | 'critical' = 'stable';

    if (maxDimScore >= 75) {
      score = maxDimScore;
      status = 'critical';
    } else if (maxDimScore >= 60) {
      score = maxDimScore;
      status = 'elevated';
    } else {
      if (weightedAverage >= 40) status = 'elevated';
    }

    const trend = computeTrend(code, score);
    const prevArr = previousScores.get(code);
    const momentum = prevArr && prevArr.length > 0 ? score - prevArr[prevArr.length - 1] : 0;

    // Stocker pour la prochaine comparaison (append non-mutatif, fenêtre glissante de 12)
    const next = [...(prevArr ?? []), score].slice(-12);
    previousScores.set(code, next);

    scores.push({
      code,
      name: dept.name,
      score,
      status,
      dimensions: { social, security, infra, velocity },
      trend,
      momentum,
      topDriver: topDriver as any,
      eventCount: items.length,
      lastUpdate: now,
      history: next,
    });

    // Seuil minimal : seuls les depts avec score ≥ 5 entrent dans la moyenne nationale
    // (évite que des alertes météo mineures ou 1 article low gonfle le score pays)
    if (score >= 5) {
      nationalTotal += score;
      deptCount++;
    }
  }

  // Trier par score décroissant, puis par momentum
  scores.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.momentum || 0) - (a.momentum || 0);
  });

  // Score national = moyenne des départements significativement actifs
  const nationalScore = deptCount > 0 ? Math.round(nationalTotal / deptCount) : 0;

  return {
    scores,
    nationalScore,
    timestamp: now,
  };
}

// ═══ Export pour tests ═══

export { REGION_TO_DEPTS, DEPT_BBOXES };
