import type {
  HealthFeatures,
  HealthRegionMetric,
  HealthDepartmentMetric,
  HealthDataSource,
  ISSLevel,
} from '../types/index.ts';
import { ISS_LEVELS } from '../types/index.ts';

// ═══ Payload ═══════════════════════════════════════════════════════════════

export interface HealthPayload {
  departments: HealthDepartmentMetric[];
  regions: HealthRegionMetric[];
  healthFeatures: HealthFeatures;
}

// ═══ Cache ═════════════════════════════════════════════════════════════════

const HEALTH_CACHE_TTL_MS = 15 * 60_000;
let cache: { fetchedAt: number; payload: HealthPayload } | null = null;

// ═══ Endpoints ═════════════════════════════════════════════════════════════

const EPIDEMIOLOGY_URL = import.meta.env.PROD
  ? '/api/health/epidemiology'
  : 'http://localhost:3001/api/health/epidemiology';

const SENTINELLES_URL = import.meta.env.PROD
  ? '/api/health/sentinelles'
  : 'http://localhost:3001/api/health/sentinelles';

const DRUG_SHORTAGES_URL = import.meta.env.PROD
  ? '/api/health/drug-shortages'
  : 'http://localhost:3001/api/health/drug-shortages';

const DEPARTMENTAL_URL = import.meta.env.PROD
  ? '/api/health/departmental'
  : 'http://localhost:3001/api/health/departmental';

const OSCOUR_SOS_URL = import.meta.env.PROD
  ? '/api/health/oscour-sos'
  : 'http://localhost:3001/api/health/oscour-sos';

const APL_URL = import.meta.env.PROD
  ? '/api/health/apl'
  : 'http://localhost:3001/api/health/apl';

// ═══ Region mappings ═══════════════════════════════════════════════════════

const REGION_CODE_TO_NAME: Record<string, string> = {
  '11': 'Île-de-France', '24': 'Centre-Val de Loire', '27': 'Bourgogne-Franche-Comté',
  '28': 'Normandie', '32': 'Hauts-de-France', '44': 'Grand Est',
  '52': 'Pays de la Loire', '53': 'Bretagne', '75': 'Nouvelle-Aquitaine',
  '76': 'Occitanie', '84': 'Auvergne-Rhône-Alpes', '93': "Provence-Alpes-Côte d'Azur",
  '94': 'Corse',
};

const REGION_NAME_TO_CODE: Record<string, string> = {
  IDF: '11', CVL: '24', BFC: '27', NOR: '28', HDF: '32', GES: '44', PDL: '52',
  BRE: '53', NAQ: '75', OCC: '76', ARA: '84', PAC: '93', COR: '94',
  ILEDEFRANCE: '11', CENTREVALDELOIRE: '24', BOURGOGNEFRANCHECOMTE: '27', NORMANDIE: '28',
  HAUTSDEFRANCE: '32', GRANDEST: '44', PAYSDELALOIRE: '52', BRETAGNE: '53', NOUVELLEAQUITAINE: '75',
  OCCITANIE: '76', AUVERGNERHONEALPES: '84', PROVENCEALPESCOTEDAZUR: '93', CORSE: '94',
};

const DEP_TO_REGION: Record<string, string> = {
  '01': '84', '02': '32', '03': '84', '04': '93', '05': '93', '06': '93', '07': '84', '08': '44', '09': '76',
  '10': '44', '11': '76', '12': '76', '13': '93', '14': '28', '15': '84', '16': '75', '17': '75', '18': '24',
  '19': '75', '21': '27', '22': '53', '23': '75', '24': '75', '25': '27', '26': '84', '27': '28', '28': '24',
  '29': '53', '30': '76', '31': '76', '32': '76', '33': '75', '34': '76', '35': '53', '36': '24', '37': '24',
  '38': '84', '39': '27', '40': '75', '41': '24', '42': '84', '43': '84', '44': '52', '45': '24', '46': '76',
  '47': '75', '48': '76', '49': '52', '50': '28', '51': '44', '52': '44', '53': '52', '54': '44', '55': '44',
  '56': '53', '57': '44', '58': '27', '59': '32', '60': '32', '61': '28', '62': '32', '63': '84', '64': '75',
  '65': '76', '66': '76', '67': '44', '68': '44', '69': '84', '70': '27', '71': '27', '72': '52', '73': '84',
  '74': '84', '75': '11', '76': '28', '77': '11', '78': '11', '79': '75', '80': '32', '81': '76', '82': '76',
  '83': '93', '84': '93', '85': '52', '86': '75', '87': '75', '88': '44', '89': '27', '90': '27', '91': '11',
  '92': '11', '93': '11', '94': '11', '95': '11',
  '2A': '94', '2B': '94',
  '971': '01', '972': '02', '973': '03', '974': '04', '976': '06',
};

const DEPT_NAMES: Record<string, string> = {
  '01': 'Ain', '02': 'Aisne', '03': 'Allier', '04': 'Alpes-de-Haute-Provence', '05': 'Hautes-Alpes',
  '06': 'Alpes-Maritimes', '07': 'Ardèche', '08': 'Ardennes', '09': 'Ariège', '10': 'Aube',
  '11': 'Aude', '12': 'Aveyron', '13': 'Bouches-du-Rhône', '14': 'Calvados', '15': 'Cantal',
  '16': 'Charente', '17': 'Charente-Maritime', '18': 'Cher', '19': 'Corrèze', '21': "Côte-d'Or",
  '22': "Côtes-d'Armor", '23': 'Creuse', '24': 'Dordogne', '25': 'Doubs', '26': 'Drôme',
  '27': 'Eure', '28': 'Eure-et-Loir', '29': 'Finistère', '30': 'Gard', '31': 'Haute-Garonne',
  '32': 'Gers', '33': 'Gironde', '34': 'Hérault', '35': 'Ille-et-Vilaine', '36': 'Indre',
  '37': 'Indre-et-Loire', '38': 'Isère', '39': 'Jura', '40': 'Landes', '41': 'Loir-et-Cher',
  '42': 'Loire', '43': 'Haute-Loire', '44': 'Loire-Atlantique', '45': 'Loiret', '46': 'Lot',
  '47': 'Lot-et-Garonne', '48': 'Lozère', '49': 'Maine-et-Loire', '50': 'Manche',
  '51': 'Marne', '52': 'Haute-Marne', '53': 'Mayenne', '54': 'Meurthe-et-Moselle',
  '55': 'Meuse', '56': 'Morbihan', '57': 'Moselle', '58': 'Nièvre', '59': 'Nord', '60': 'Oise',
  '61': 'Orne', '62': 'Pas-de-Calais', '63': 'Puy-de-Dôme', '64': 'Pyrénées-Atlantiques',
  '65': 'Hautes-Pyrénées', '66': 'Pyrénées-Orientales', '67': 'Bas-Rhin', '68': 'Haut-Rhin',
  '69': 'Rhône', '70': 'Haute-Saône', '71': 'Saône-et-Loire', '72': 'Sarthe', '73': 'Savoie',
  '74': 'Haute-Savoie', '75': 'Paris', '76': 'Seine-Maritime', '77': 'Seine-et-Marne',
  '78': 'Yvelines', '79': 'Deux-Sèvres', '80': 'Somme', '81': 'Tarn', '82': 'Tarn-et-Garonne',
  '83': 'Var', '84': 'Vaucluse', '85': 'Vendée', '86': 'Vienne', '87': 'Haute-Vienne',
  '88': 'Vosges', '89': 'Yonne', '90': 'Territoire de Belfort', '91': 'Essonne',
  '92': 'Hauts-de-Seine', '93': 'Seine-Saint-Denis', '94': 'Val-de-Marne', '95': "Val-d'Oise",
  '2A': 'Corse-du-Sud', '2B': 'Haute-Corse',
  '971': 'Guadeloupe', '972': 'Martinique', '973': 'Guyane', '974': 'La Réunion', '976': 'Mayotte',
};

// ═══ Response types ════════════════════════════════════════════════════════

interface EpidemiologyResponseV2 {
  covid_regional?: Array<{
    region_code?: string;
    region_name?: string;
    date?: string;
    incidence?: number | null;
    hospitalisations?: number | null;
    reanimation?: number | null;
  }>;
}

interface EpidemiologyResponseLegacy {
  rows?: Record<string, unknown>[];
  openAccessMonitorCount?: number;
}

interface SentinellesResponse {
  indicators?: Array<{
    code?: string;
    label?: string;
    region_code?: string;
    incidence?: number;
    week?: string;
  }>;
}

interface DrugShortagesResponse {
  shortages?: Array<{
    drug_name?: string;
    status?: 'tension' | 'rupture' | 'normalisation' | 'unknown';
  }>;
  last_update?: string | null;
  metadata?: { source?: string };
}

interface DepartmentalResponse {
  departments?: Array<{
    dep_code?: string;
    dep_name?: string;
    region_code?: string;
    region_name?: string;
    date?: string;
    hosp?: number | null;
    rea?: number | null;
    incidence?: number | null;
    urgences?: number | null;
    positivity?: number | null;
    source?: string;
  }>;
  metadata?: {
    sources?: {
      drees?: { points?: number; status?: string };
      spf?: { points?: number; status?: string };
    };
  };
}

interface OscourSosResponse {
  departements?: Array<{
    code_insee?: string;
    name?: string;
    top_motifs?: Array<{
      code?: string;
      label?: string;
      trend?: string;
      trend_pct?: number;
      network?: string;
    }>;
  }>;
}

interface AplResponse {
  departements?: Array<{
    code_insee?: string;
    apl_index?: number;
    category?: string;
  }>;
}

// ═══ ISS Computation ═══════════════════════════════════════════════════════

/** Calcul de l'Indice de Stress Sanitaire (ISS) — score 0-100 */
function computeISS(input: {
  incidenceRate: number;
  hospitalizations: number;
  reanimation: number;
  emergencyVisits: number;
  positivityRate: number;
  motifTrendPct: number;
  aplIndex: number | null;
}): number {
  // Pondération adaptative : chaque dimension contribue si la donnée existe
  let weightSum = 0;
  let scoreSum = 0;

  if (input.incidenceRate > 0) {
    scoreSum += clamp((input.incidenceRate / 250) * 100, 0, 100) * 0.30;
    weightSum += 0.30;
  }
  if (input.hospitalizations > 0) {
    scoreSum += clamp((input.hospitalizations / 2500) * 100, 0, 100) * 0.25;
    weightSum += 0.25;
  }
  if (input.reanimation > 0) {
    scoreSum += clamp((input.reanimation / 500) * 100, 0, 100) * 0.20;
    weightSum += 0.20;
  }
  if (input.emergencyVisits > 0) {
    scoreSum += clamp((input.emergencyVisits / 5000) * 100, 0, 100) * 0.15;
    weightSum += 0.15;
  }
  if (input.positivityRate > 0) {
    scoreSum += clamp((input.positivityRate / 15) * 100, 0, 100) * 0.10;
    weightSum += 0.10;
  }
  if (input.motifTrendPct > 0) {
    // 0.8 => +80% vs baseline => contribution max
    scoreSum += clamp((input.motifTrendPct / 0.8) * 100, 0, 100) * 0.12;
    weightSum += 0.12;
  }
  if (input.aplIndex != null && Number.isFinite(input.aplIndex)) {
    // APL faible = stress plus élevé. APL >= 1.4 => faible contribution.
    const vuln = clamp(((1.4 - input.aplIndex) / 1.0) * 100, 0, 100);
    scoreSum += vuln * 0.18;
    weightSum += 0.18;
  }

  if (weightSum === 0) return 0;
  return Math.round(clamp(scoreSum / weightSum, 0, 100));
}

function normalizeAplCategory(value: string | null | undefined): HealthDepartmentMetric['aplCategory'] {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return 'indisponible';
  if (raw.includes('desert')) return 'desert';
  if (raw.includes('frag')) return 'fragile';
  if (raw.includes('sur')) return 'surdote';
  if (raw.includes('bon')) return 'bon';
  return 'indisponible';
}

function motifTrendScore(topMotifs: HealthDepartmentMetric['topMotifs']): number {
  if (!Array.isArray(topMotifs) || topMotifs.length === 0) return 0;
  const best = Math.max(...topMotifs.map((m) => Number.isFinite(m.trendPct) ? m.trendPct : 0));
  return clamp(best, 0, 5);
}

function issToLevel(iss: number): ISSLevel {
  for (const def of ISS_LEVELS) {
    if (iss >= def.range[0] && iss <= def.range[1]) return def.level;
  }
  return iss >= 75 ? 4 : 1;
}

function deriveTrend(incidenceRate: number, positivityRate: number, sentinellesIncidence: number): 'up' | 'down' | 'stable' {
  const ref = Math.max(incidenceRate, sentinellesIncidence);
  if (ref >= 120 || positivityRate >= 10) return 'up';
  if (ref <= 40 && positivityRate <= 4) return 'down';
  return 'stable';
}

// ═══ Main fetch ════════════════════════════════════════════════════════════

export async function fetchHealthData(): Promise<HealthPayload> {
  if (cache && Date.now() - cache.fetchedAt < HEALTH_CACHE_TTL_MS) {
    return cache.payload;
  }

  const emptyPayload: HealthPayload = {
    departments: [],
    regions: [],
    healthFeatures: buildEmptyHealthFeatures(),
  };

  try {
    const [epid, sent, drug, dept, oscourSos, apl] = await Promise.all([
      fetchJson<EpidemiologyResponseV2 | EpidemiologyResponseLegacy>(EPIDEMIOLOGY_URL).catch(() => ({ covid_regional: [], rows: [] }) as EpidemiologyResponseV2 & EpidemiologyResponseLegacy),
      fetchJson<SentinellesResponse>(SENTINELLES_URL).catch(() => ({ indicators: [] }) as SentinellesResponse),
      fetchJson<DrugShortagesResponse>(DRUG_SHORTAGES_URL).catch(() => ({ shortages: [], last_update: null, metadata: {} }) as DrugShortagesResponse),
      fetchJson<DepartmentalResponse>(DEPARTMENTAL_URL).catch(() => ({ departments: [] }) as DepartmentalResponse),
      fetchJson<OscourSosResponse>(OSCOUR_SOS_URL).catch(() => ({ departements: [] }) as OscourSosResponse),
      fetchJson<AplResponse>(APL_URL).catch(() => ({ departements: [] }) as AplResponse),
    ]);

    const sentinellesByRegion = buildSentinellesByRegion(sent?.indicators ?? []);
    const sentIndicators = buildSentinellesNationalIndicators(sent?.indicators ?? []);
    const shortages = Array.isArray(drug?.shortages) ? drug.shortages : [];
    const shortagesLastUpdate = drug?.last_update ? new Date(drug.last_update) : null;
    const shortagesUrl = String(drug?.metadata?.source || 'https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments');

    // ── Build departmental metrics ────────────────────────────────────────
    const motifsByDep = new Map<string, HealthDepartmentMetric['topMotifs']>();
    for (const dep of (oscourSos?.departements ?? [])) {
      const depCode = String(dep?.code_insee ?? '').trim();
      if (!depCode) continue;
      const topMotifs: HealthDepartmentMetric['topMotifs'] = Array.isArray(dep?.top_motifs)
        ? dep.top_motifs
          .map((m) => {
            const trendPct = Number(m?.trend_pct);
            const trendLabel = String(m?.trend ?? (Number.isFinite(trendPct) ? `${trendPct > 0 ? '+' : ''}${Math.round(trendPct * 100)}%` : 'n/d'));
            const networkRaw = String(m?.network ?? '').toUpperCase();
            const network: 'OSCOUR' | 'SOS_MED' = networkRaw.includes('SOS') ? 'SOS_MED' : 'OSCOUR';
            const code = String(m?.code ?? '').trim();
            const label = String(m?.label ?? code).trim();
            if (!code && !label) return null;
            return { code: code || label, label: label || code, trendPct: Number.isFinite(trendPct) ? trendPct : 0, trendLabel, network };
          })
          .filter((m): m is NonNullable<typeof m> => m !== null)
        : [];
      motifsByDep.set(depCode, topMotifs.slice(0, 5));
    }

    const aplByDep = new Map<string, { aplIndex: number | null; aplCategory: HealthDepartmentMetric['aplCategory'] }>();
    for (const dep of (apl?.departements ?? [])) {
      const depCode = String(dep?.code_insee ?? '').trim();
      if (!depCode) continue;
      const aplIndexRaw = Number(dep?.apl_index);
      const aplIndex = Number.isFinite(aplIndexRaw) ? aplIndexRaw : null;
      aplByDep.set(depCode, {
        aplIndex,
        aplCategory: normalizeAplCategory(dep?.category),
      });
    }

    const departments = buildDepartmentMetrics(dept, sentinellesByRegion, epid, motifsByDep, aplByDep);
    const sparseDepartments = departments.length === 0
      ? buildSparseDepartmentMetrics(motifsByDep, aplByDep)
      : [];
    const effectiveDepartments = departments.length > 0 ? departments : sparseDepartments;
    const hasDepartmentalData = effectiveDepartments.length > 0;

    // ── Build regional metrics (aggregate from dept if available, else from epid) ─
    const regions = hasDepartmentalData
      ? aggregateRegionsFromDepartments(effectiveDepartments, sentinellesByRegion)
      : mapEpidemiologyToRegions(epid, sentinellesByRegion);

    // ── Build features ────────────────────────────────────────────────────
    const dreesStatus: 'ok' | 'stale' | 'error' =
      (dept?.metadata?.sources?.drees?.status === 'ok') ? 'ok' :
        (dept?.metadata?.sources?.spf?.status === 'ok') ? 'ok' : 'stale';
    const oscourSosStatus: 'ok' | 'stale' | 'error' = (oscourSos?.departements?.length ?? 0) > 0 ? 'ok' : 'error';
    const aplStatus: 'ok' | 'stale' | 'error' = (apl?.departements?.length ?? 0) > 0 ? 'ok' : 'error';
    const healthFeatures = buildHealthFeatures(
      effectiveDepartments, regions, sentIndicators, shortages, shortagesLastUpdate, shortagesUrl, dreesStatus,
      oscourSosStatus, aplStatus,
    );

    const payload: HealthPayload = { departments: effectiveDepartments, regions, healthFeatures };

    if (effectiveDepartments.length > 0 || regions.length > 0) {
      cache = { fetchedAt: Date.now(), payload };
    }

    return payload;
  } catch (error) {
    console.warn('[Health] Fetch error', error);
    return cache?.payload ?? emptyPayload;
  }
}

// ═══ Department metrics builder ════════════════════════════════════════════

function buildDepartmentMetrics(
  deptResponse: DepartmentalResponse,
  sentinellesByRegion: Map<string, number>,
  epid: EpidemiologyResponseV2 | EpidemiologyResponseLegacy,
  motifsByDep: Map<string, HealthDepartmentMetric['topMotifs']>,
  aplByDep: Map<string, { aplIndex: number | null; aplCategory: HealthDepartmentMetric['aplCategory'] }>,
): HealthDepartmentMetric[] {
  const depts = Array.isArray(deptResponse?.departments) ? deptResponse.departments : [];
  if (depts.length === 0) return [];

  // Also extract regional epidemiology for enrichment
  const epidByRegion = extractEpidByRegion(epid);

  const metrics: HealthDepartmentMetric[] = [];

  for (const d of depts) {
    const depCode = String(d.dep_code ?? '').trim();
    if (!depCode) continue;

    const regionCode = d.region_code ?? DEP_TO_REGION[depCode] ?? '';
    const regionName = d.region_name ?? REGION_CODE_TO_NAME[regionCode] ?? '';
    const depName = d.dep_name ?? DEPT_NAMES[depCode] ?? `Dép. ${depCode}`;

    const hosp = numberFrom(d.hosp);
    const rea = numberFrom(d.rea);
    const incidence = numberFrom(d.incidence);
    const urgences = numberFrom(d.urgences);
    const positivity = numberFrom(d.positivity);
    const topMotifs = motifsByDep.get(depCode) ?? [];
    const aplData = aplByDep.get(depCode);
    const aplIndex = aplData?.aplIndex ?? null;
    const aplCategory = aplData?.aplCategory ?? 'indisponible';

    // Enrich incidence with Sentinelles data for the parent region
    const sentinellesInc = sentinellesByRegion.get(regionCode) ?? 0;
    const compositeIncidence = Math.max(incidence, sentinellesInc);

    // Enrich with epidemiology regional data if dep-level is missing
    const epidRegion = epidByRegion.get(regionCode);
    const spfInc = epidRegion?.incidence ?? null;
    const spfHosp = epidRegion?.hosp ?? null;
    const spfRea = epidRegion?.rea ?? null;

    const iss = computeISS({
      incidenceRate: compositeIncidence > 0 ? compositeIncidence : numberFrom(spfInc),
      hospitalizations: hosp > 0 ? hosp : numberFrom(spfHosp),
      reanimation: rea > 0 ? rea : numberFrom(spfRea),
      emergencyVisits: urgences,
      positivityRate: positivity,
      motifTrendPct: motifTrendScore(topMotifs),
      aplIndex,
    });

    const source: HealthDataSource = sentinellesInc > 0
      ? (incidence > 0 || hosp > 0 ? 'composite' : 'sentinelles')
      : (d.source?.includes('drees') ? 'drees' : 'spf-epid');

    metrics.push({
      depCode,
      depName,
      regionCode,
      regionName,
      incidenceRate: compositeIncidence,
      hospitalizations: hosp,
      reanimation: rea,
      emergencyVisits: urgences,
      positivityRate: positivity,
      spfIncidence: spfInc != null ? numberFrom(spfInc) : null,
      spfHospitalizations: spfHosp != null ? numberFrom(spfHosp) : null,
      spfReanimation: spfRea != null ? numberFrom(spfRea) : null,
      dreesUrgences: urgences > 0 ? urgences : null,
      sentinellesIncidence: sentinellesInc > 0 ? sentinellesInc : null,
      topMotifs,
      aplIndex,
      aplCategory,
      iss,
      issLevel: issToLevel(iss),
      trend: deriveTrend(compositeIncidence, positivity, sentinellesInc),
      source,
      updatedAt: d.date ? new Date(d.date) : new Date(),
    });
  }

  return metrics.sort((a, b) => b.iss - a.iss);
}

function buildSparseDepartmentMetrics(
  motifsByDep: Map<string, HealthDepartmentMetric['topMotifs']>,
  aplByDep: Map<string, { aplIndex: number | null; aplCategory: HealthDepartmentMetric['aplCategory'] }>,
): HealthDepartmentMetric[] {
  const depCodes = new Set<string>([
    ...motifsByDep.keys(),
    ...aplByDep.keys(),
  ]);

  const metrics: HealthDepartmentMetric[] = [];

  for (const depCode of depCodes) {
    const regionCode = DEP_TO_REGION[depCode] ?? '';
    const regionName = REGION_CODE_TO_NAME[regionCode] ?? '';
    const depName = DEPT_NAMES[depCode] ?? `Dép. ${depCode}`;
    const topMotifs = motifsByDep.get(depCode) ?? [];
    const aplData = aplByDep.get(depCode);
    const aplIndex = aplData?.aplIndex ?? null;
    const aplCategory = aplData?.aplCategory ?? 'indisponible';

    const iss = computeISS({
      incidenceRate: 0,
      hospitalizations: 0,
      reanimation: 0,
      emergencyVisits: topMotifs.length > 0 ? 1 : 0,
      positivityRate: 0,
      motifTrendPct: motifTrendScore(topMotifs),
      aplIndex,
    });

    metrics.push({
      depCode,
      depName,
      regionCode,
      regionName,
      incidenceRate: 0,
      hospitalizations: 0,
      reanimation: 0,
      emergencyVisits: 0,
      positivityRate: 0,
      spfIncidence: null,
      spfHospitalizations: null,
      spfReanimation: null,
      dreesUrgences: null,
      sentinellesIncidence: null,
      topMotifs,
      aplIndex,
      aplCategory,
      iss,
      issLevel: issToLevel(iss),
      trend: topMotifs.length > 0 ? 'up' : 'stable',
      source: topMotifs.length > 0 ? 'oscour' : 'drees',
      updatedAt: new Date(),
    });
  }

  return metrics.sort((a, b) => b.iss - a.iss);
}

// ═══ Aggregate regions from departments ════════════════════════════════════

function aggregateRegionsFromDepartments(
  departments: HealthDepartmentMetric[],
  sentinellesByRegion: Map<string, number>,
): HealthRegionMetric[] {
  const byRegion = new Map<string, HealthDepartmentMetric[]>();
  for (const d of departments) {
    if (!d.regionCode) continue;
    const arr = byRegion.get(d.regionCode) ?? [];
    arr.push(d);
    byRegion.set(d.regionCode, arr);
  }

  const regions: HealthRegionMetric[] = [];
  for (const [regionCode, deps] of byRegion) {
    if (deps.length === 0) continue;

    const avgISS = Math.round(deps.reduce((s, d) => s + d.iss, 0) / deps.length);
    const totalHosp = deps.reduce((s, d) => s + d.hospitalizations, 0);
    const totalRea = deps.reduce((s, d) => s + d.reanimation, 0);
    const maxIncidence = Math.max(...deps.map(d => d.incidenceRate));
    const avgPositivity = deps.reduce((s, d) => s + d.positivityRate, 0) / deps.length;
    const sentinellesInc = sentinellesByRegion.get(regionCode) ?? 0;

    // Determine dominant source
    const sourceCounts = new Map<HealthDataSource, number>();
    for (const d of deps) {
      sourceCounts.set(d.source, (sourceCounts.get(d.source) ?? 0) + 1);
    }
    let dominantSource: HealthDataSource = 'composite';
    let maxCount = 0;
    for (const [src, count] of sourceCounts) {
      if (count > maxCount) { dominantSource = src; maxCount = count; }
    }

    const spfIncs = deps.map(d => d.spfIncidence).filter((v): v is number => v !== null);
    const spfHosps = deps.map(d => d.spfHospitalizations).filter((v): v is number => v !== null);

    regions.push({
      regionCode,
      regionName: deps[0].regionName || REGION_CODE_TO_NAME[regionCode] || `Région ${regionCode}`,
      incidenceRate: maxIncidence,
      spfIncidenceRate: spfIncs.length > 0 ? Math.max(...spfIncs) : null,
      sentinellesIncidenceRate: sentinellesInc > 0 ? sentinellesInc : null,
      hospitalizations: totalHosp,
      spfHospitalizations: spfHosps.length > 0 ? spfHosps.reduce((a, b) => a + b, 0) : null,
      reanimation: totalRea,
      positivityRate: Math.round(avgPositivity * 10) / 10,
      iss: avgISS,
      issLevel: issToLevel(avgISS),
      healthStressIndex: avgISS, // backward compat
      trend: deriveTrend(maxIncidence, avgPositivity, sentinellesInc),
      source: dominantSource,
      updatedAt: new Date(Math.max(...deps.map(d => d.updatedAt.getTime()))),
      departmentCount: deps.length,
    });
  }

  return regions.sort((a, b) => b.iss - a.iss);
}

// ═══ Fallback: epidemiology → regions (when no departmental data) ═════════

function mapEpidemiologyToRegions(
  epidemiology: EpidemiologyResponseV2 | EpidemiologyResponseLegacy,
  sentinellesByRegion: Map<string, number>,
): HealthRegionMetric[] {
  const fromV2 = Array.isArray((epidemiology as EpidemiologyResponseV2).covid_regional)
    ? (epidemiology as EpidemiologyResponseV2).covid_regional!
    : [];

  if (fromV2.length > 0) {
    const mapped: HealthRegionMetric[] = [];
    for (const row of fromV2) {
      const regionCode = resolveRegionCode(row.region_code ?? row.region_name ?? '');
      if (!regionCode) continue;

      const incidenceRate = numberFrom(row.incidence);
      const hospitalizations = numberFrom(row.hospitalisations);
      const reanimation = numberFrom(row.reanimation);
      const sentinellesIncidence = sentinellesByRegion.get(regionCode) ?? 0;
      const compositeIncidence = Math.max(incidenceRate, sentinellesIncidence);

      const iss = computeISS({
        incidenceRate: compositeIncidence,
        hospitalizations,
        reanimation,
        emergencyVisits: 0,
        positivityRate: 0,
        motifTrendPct: 0,
        aplIndex: null,
      });

      mapped.push({
        regionCode,
        regionName: row.region_name || REGION_CODE_TO_NAME[regionCode] || `Région ${regionCode}`,
        incidenceRate: compositeIncidence,
        spfIncidenceRate: incidenceRate > 0 ? incidenceRate : null,
        sentinellesIncidenceRate: sentinellesIncidence > 0 ? sentinellesIncidence : null,
        hospitalizations,
        spfHospitalizations: hospitalizations > 0 ? hospitalizations : null,
        reanimation,
        positivityRate: 0,
        iss,
        issLevel: issToLevel(iss),
        healthStressIndex: iss,
        trend: deriveTrend(compositeIncidence, 0, sentinellesIncidence),
        source: sentinellesIncidence > 0 ? 'composite' : 'spf-epid',
        updatedAt: row.date ? new Date(row.date) : new Date(),
        departmentCount: 0,
      });
    }
    return mapped.sort((a, b) => b.iss - a.iss);
  }

  // Legacy fallback
  const legacyRows = Array.isArray((epidemiology as EpidemiologyResponseLegacy).rows)
    ? (epidemiology as EpidemiologyResponseLegacy).rows!
    : [];

  const byRegion = new Map<string, Record<string, unknown>>();
  for (const row of legacyRows) {
    const code = extractRegionCode(row);
    if (!code) continue;
    const prev = byRegion.get(code);
    if (!prev || ((extractRowDate(row)?.getTime() ?? 0) >= (extractRowDate(prev)?.getTime() ?? 0))) {
      byRegion.set(code, row);
    }
  }

  const mapped: HealthRegionMetric[] = [];
  for (const [regionCode, row] of byRegion) {
    const incidenceRate = pickNumber(row, ['tx_incidence', 'taux_incidence', 'incidence', 'nb_pcr']);
    const hospitalizations = pickNumber(row, ['hosp', 'hospitalisations', 'hc', 'sc']);
    const reanimation = pickNumber(row, ['rea', 'reanimation', 'sc']);
    const sentinellesIncidence = sentinellesByRegion.get(regionCode) ?? 0;
    const compositeIncidence = Math.max(incidenceRate, sentinellesIncidence);

    const iss = computeISS({
      incidenceRate: compositeIncidence,
      hospitalizations,
      reanimation,
      emergencyVisits: 0,
      positivityRate: 0,
      motifTrendPct: 0,
      aplIndex: null,
    });

    mapped.push({
      regionCode,
      regionName: extractRegionName(row) || REGION_CODE_TO_NAME[regionCode] || `Région ${regionCode}`,
      incidenceRate: compositeIncidence,
      spfIncidenceRate: incidenceRate > 0 ? incidenceRate : null,
      sentinellesIncidenceRate: sentinellesIncidence > 0 ? sentinellesIncidence : null,
      hospitalizations,
      spfHospitalizations: hospitalizations > 0 ? hospitalizations : null,
      reanimation,
      positivityRate: 0,
      iss,
      issLevel: issToLevel(iss),
      healthStressIndex: iss,
      trend: deriveTrend(compositeIncidence, 0, sentinellesIncidence),
      source: sentinellesIncidence > 0 ? 'composite' : 'spf-epid',
      updatedAt: extractRowDate(row) ?? new Date(),
      departmentCount: 0,
    });
  }

  if (mapped.length > 0) return mapped.sort((a, b) => b.iss - a.iss);

  // Last resort: Sentinelles only
  for (const [regionCode, sentinellesIncidence] of sentinellesByRegion) {
    const iss = computeISS({
      incidenceRate: sentinellesIncidence,
      hospitalizations: 0,
      reanimation: 0,
      emergencyVisits: 0,
      positivityRate: 0,
      motifTrendPct: 0,
      aplIndex: null,
    });
    mapped.push({
      regionCode,
      regionName: REGION_CODE_TO_NAME[regionCode] || `Région ${regionCode}`,
      incidenceRate: sentinellesIncidence,
      spfIncidenceRate: null,
      sentinellesIncidenceRate: sentinellesIncidence,
      hospitalizations: 0,
      spfHospitalizations: null,
      reanimation: 0,
      positivityRate: 0,
      iss,
      issLevel: issToLevel(iss),
      healthStressIndex: iss,
      trend: deriveTrend(sentinellesIncidence, 0, sentinellesIncidence),
      source: 'sentinelles',
      updatedAt: new Date(),
      departmentCount: 0,
    });
  }

  return mapped.sort((a, b) => b.iss - a.iss);
}

// ═══ Sentinelles helpers ═══════════════════════════════════════════════════

function buildSentinellesByRegion(indicators: SentinellesResponse['indicators']): Map<string, number> {
  const latestWeekByRegion = new Map<string, string>();
  const valuesByRegion = new Map<string, number[]>();

  for (const item of indicators ?? []) {
    const regionCode = resolveRegionCode(item?.region_code ?? '');
    const week = String(item?.week ?? '');
    const incidence = numberFrom(item?.incidence);

    if (!regionCode || !week || !Number.isFinite(incidence)) continue;

    const prevWeek = latestWeekByRegion.get(regionCode);
    if (!prevWeek || week >= prevWeek) {
      if (!prevWeek || week > prevWeek) {
        valuesByRegion.set(regionCode, [incidence]);
      } else {
        valuesByRegion.get(regionCode)?.push(incidence);
      }
      latestWeekByRegion.set(regionCode, week);
    }
  }

  const result = new Map<string, number>();
  for (const [regionCode, vals] of valuesByRegion) {
    if (vals.length === 0) continue;
    result.set(regionCode, vals.reduce((s, v) => s + v, 0) / vals.length);
  }

  return result;
}

function buildSentinellesNationalIndicators(
  indicators: SentinellesResponse['indicators'],
): Array<{ code: string; label: string; nationalIncidence: number; trend?: number }> {
  // Group by code and then by week
  const byCode = new Map<string, { label: string; weeks: Map<string, number[]> }>();

  for (const item of indicators ?? []) {
    const code = String(item?.code ?? '').trim();
    const label = String(item?.label ?? code).trim();
    const week = String(item?.week ?? '').trim();
    const incidence = numberFrom(item?.incidence);

    if (!code || !week || !Number.isFinite(incidence)) continue;

    const entry = byCode.get(code) ?? { label, weeks: new Map<string, number[]>() };
    const weekVals = entry.weeks.get(week) ?? [];
    weekVals.push(incidence);
    entry.weeks.set(week, weekVals);
    byCode.set(code, entry);
  }

  const result: Array<{ code: string; label: string; nationalIncidence: number; trend?: number }> = [];

  for (const [code, { label, weeks }] of byCode.entries()) {
    // Sort descending by week String (e.g. 2024-W10, 2024-W09)
    const sortedWeeks = [...weeks.keys()].sort().reverse();
    if (sortedWeeks.length === 0) continue;

    const latestWeek = sortedWeeks[0];
    const prevWeek = sortedWeeks.length > 1 ? sortedWeeks[1] : null;

    const latestVals = weeks.get(latestWeek) ?? [];
    const latestIncidence = latestVals.reduce((s, v) => s + v, 0) / latestVals.length;

    let trend: number | undefined;
    if (prevWeek) {
      const prevVals = weeks.get(prevWeek) ?? [];
      if (prevVals.length > 0) {
        const prevIncidence = prevVals.reduce((s, v) => s + v, 0) / prevVals.length;
        trend = latestIncidence - prevIncidence;
      }
    }

    result.push({
      code,
      label,
      nationalIncidence: Math.round(latestIncidence * 10) / 10,
      trend: trend !== undefined ? Math.round(trend * 10) / 10 : undefined,
    });
  }

  return result;
}

// ═══ Features builder ══════════════════════════════════════════════════════

function buildEmptyHealthFeatures(): HealthFeatures {
  return {
    generatedAt: new Date(),
    nationalISS: 0,
    nationalHealthStressIndex: 0,
    nationalISSLevel: 1,
    regionalCount: 0,
    departmentalCount: 0,
    worseningRegions: 0,
    improvingRegions: 0,
    worseningDepartments: 0,
    improvingDepartments: 0,
    topRiskRegionCodes: [],
    topRiskDepartmentCodes: [],
    sourceStatus: {
      santePubliqueFrance: 'error',
      drees: 'error',
      sentinelles: 'error',
      drugShortages: 'error',
      oscourSos: 'error',
      apl: 'error',
    },
    sentinellesIndicatorPoints: 0,
    sentinellesIndicators: [],
    drugShortagesCount: 0,
    drugShortagesByStatus: { rupture: 0, tension: 0, normalisation: 0, unknown: 0 },
    drugShortagesLastUpdate: null,
    drugShortagesUrl: 'https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments',
    drugShortagesItems: [],
  };
}

function buildHealthFeatures(
  departments: HealthDepartmentMetric[],
  regions: HealthRegionMetric[],
  sentIndicators: Array<{ code: string; label: string; nationalIncidence: number }>,
  shortages: Array<{ drug_name?: string; status?: 'tension' | 'rupture' | 'normalisation' | 'unknown' }>,
  shortagesLastUpdate: Date | null,
  shortagesUrl: string,
  dreesStatus: 'ok' | 'stale' | 'error',
  oscourSosStatus: 'ok' | 'stale' | 'error',
  aplStatus: 'ok' | 'stale' | 'error',
): HealthFeatures {
  const nationalISS = regions.length > 0
    ? Math.round(regions.reduce((sum, r) => sum + r.iss, 0) / regions.length)
    : 0;

  const shortagesCount = shortages.length;
  const drugShortagesByStatus = shortages.reduce(
    (acc, s) => {
      const status = s?.status ?? 'unknown';
      if (status === 'rupture') acc.rupture += 1;
      else if (status === 'tension') acc.tension += 1;
      else if (status === 'normalisation') acc.normalisation += 1;
      else acc.unknown += 1;
      return acc;
    },
    { rupture: 0, tension: 0, normalisation: 0, unknown: 0 },
  );

  const drugShortagesItems = shortages
    .filter((s) => String(s?.drug_name ?? '').trim().length > 0)
    .map((s) => ({
      drugName: String(s?.drug_name ?? '').trim(),
      status: (s?.status ?? 'unknown') as 'tension' | 'rupture' | 'normalisation' | 'unknown',
    }));

  return {
    generatedAt: new Date(),
    nationalISS,
    nationalHealthStressIndex: nationalISS, // backward compat
    nationalISSLevel: issToLevel(nationalISS),
    regionalCount: regions.length,
    departmentalCount: departments.length,
    worseningRegions: regions.filter((r) => r.trend === 'up').length,
    improvingRegions: regions.filter((r) => r.trend === 'down').length,
    worseningDepartments: departments.filter((d) => d.trend === 'up').length,
    improvingDepartments: departments.filter((d) => d.trend === 'down').length,
    topRiskRegionCodes: regions.slice(0, 5).map((r) => r.regionCode),
    topRiskDepartmentCodes: departments.slice(0, 10).map((d) => d.depCode),
    sourceStatus: {
      santePubliqueFrance: regions.length > 0 ? 'ok' : 'error',
      drees: dreesStatus,
      sentinelles: sentIndicators.length > 0 ? 'ok' : 'error',
      drugShortages: shortagesCount > 0 ? 'ok' : 'error',
      oscourSos: oscourSosStatus,
      apl: aplStatus,
    },
    sentinellesIndicatorPoints: sentIndicators.length,
    sentinellesIndicators: sentIndicators,
    drugShortagesCount: shortagesCount,
    drugShortagesByStatus,
    drugShortagesLastUpdate: shortagesLastUpdate,
    drugShortagesUrl: shortagesUrl,
    drugShortagesItems,
  };
}

// ═══ Epidemiology extraction helpers ═══════════════════════════════════════

function extractEpidByRegion(
  epid: EpidemiologyResponseV2 | EpidemiologyResponseLegacy,
): Map<string, { incidence: number; hosp: number; rea: number }> {
  const map = new Map<string, { incidence: number; hosp: number; rea: number }>();

  const v2 = (epid as EpidemiologyResponseV2).covid_regional;
  if (Array.isArray(v2)) {
    for (const row of v2) {
      const code = resolveRegionCode(row.region_code ?? row.region_name ?? '');
      if (!code) continue;
      map.set(code, {
        incidence: numberFrom(row.incidence),
        hosp: numberFrom(row.hospitalisations),
        rea: numberFrom(row.reanimation),
      });
    }
  }

  return map;
}

// ═══ Utility functions ═════════════════════════════════════════════════════

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(16_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return await response.json() as T;
}

function extractRegionCode(row: Record<string, unknown>): string | null {
  const candidates = ['reg', 'code_reg', 'code_region', 'insee_reg', 'region_code'];
  for (const key of candidates) {
    const raw = row[key];
    const code = resolveRegionCode(raw == null ? '' : String(raw));
    if (code) return code;
  }
  const nameCandidates = ['region', 'lib_reg', 'nom_region', 'libelle_region'];
  for (const key of nameCandidates) {
    const raw = row[key];
    const code = resolveRegionCode(raw == null ? '' : String(raw));
    if (code) return code;
  }
  return null;
}

function resolveRegionCode(input: string): string | null {
  const raw = String(input || '').trim();
  if (!raw) return null;

  const digits = raw.replace(/^0+/, '');
  if (/^\d{1,3}$/.test(digits)) {
    const code = digits.padStart(2, '0');
    return REGION_CODE_TO_NAME[code] ? code : null;
  }

  const normalized = normalizeRegionName(raw);
  return REGION_NAME_TO_CODE[normalized] ?? null;
}

function extractRegionName(row: Record<string, unknown>): string | '' {
  const candidates = ['lib_reg', 'region', 'nom_region', 'libelle_region'];
  for (const key of candidates) {
    const raw = row[key];
    if (raw == null) continue;
    const value = String(raw).trim();
    if (value) return value;
  }
  return '';
}

function extractRowDate(row: Record<string, unknown>): Date | null {
  const candidates = ['jour', 'date', 'date_ref', 'semaine', 'updated_at'];
  for (const key of candidates) {
    const raw = row[key];
    if (raw == null) continue;
    const d = new Date(String(raw));
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function pickNumber(row: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const n = numberFrom(row[key]);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function numberFrom(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const n = Number.parseFloat(String(value).replace(',', '.').trim());
  return Number.isFinite(n) ? n : 0;
}

function normalizeRegionName(input: string): string {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
