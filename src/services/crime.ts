// src/services/crime.ts : lecture client de la couche Criminalité (spec 2026-10-17 criminalité) : délinquance enregistrée par la police et
// la gendarmerie (SSMSI), fichier statique annuel /data/crime.json produit par scripts/build-crime.mjs. Aucune relève : lu une fois,
// gardé en mémoire. Fonctions pures de lecture des valeurs, de classement et de couleur, partagées par le panneau, la carte et la légende.
import type { CrimeCity, CrimeDataset, CrimeDepartment, CrimeIndicator, CrimeIndicatorKey, CrimeValue } from '../types/index.ts';

export const CRIME_URL = '/data/crime.json';

/** Les 16 indicateurs du fichier, dans l'ordre d'affichage. */
export const CRIME_INDICATOR_KEYS: readonly CrimeIndicatorKey[] = [
  'homicides', 'tentatives', 'violencesIntrafamiliales', 'violencesPhysiques', 'violencesSexuelles', 'volsArmes', 'volsViolents',
  'volsSansViolence', 'cambriolages', 'volsVehicules', 'volsDansVehicules', 'volsAccessoires', 'degradations',
  'stupefiantsUsage', 'stupefiantsTrafic', 'escroqueries',
];
export const DEFAULT_CRIME_INDICATOR: CrimeIndicatorKey = 'homicides';

export function isCrimeIndicatorKey(v: unknown): v is CrimeIndicatorKey {
  return typeof v === 'string' && (CRIME_INDICATOR_KEYS as readonly string[]).includes(v);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v: unknown): boolean => v === null || isNum(v);
const isStrOrNull = (v: unknown): boolean => v === null || isStr(v);

function isValue(v: unknown): boolean {
  return Array.isArray(v) && v.length === 3 && v.every(isNumOrNull);
}
function isValues(v: unknown): boolean {
  return isRecord(v) && Object.entries(v).every(([k, x]) => isCrimeIndicatorKey(k) && isValue(x));
}
function isIndicator(v: unknown): boolean {
  return isRecord(v) && isCrimeIndicatorKey(v['key']) && isStr(v['label']) && typeof v['communal'] === 'boolean'
    && (v['base'] === 'habitants' || v['base'] === 'logements');
}
function isDepartment(v: unknown): boolean {
  return isRecord(v) && isStr(v['code']) && isStr(v['name']) && isNumOrNull(v['population']) && isValues(v['values'])
    && Array.isArray(v['homicides']) && v['homicides'].every((h) => isRecord(h) && isNum(h['year']) && isNumOrNull(h['count']));
}
function isCity(v: unknown): boolean {
  return isRecord(v) && isStr(v['code']) && isStr(v['name']) && isStr(v['dept']) && isNum(v['lat']) && isNum(v['lon'])
    && isNum(v['population']) && isValues(v['values']);
}
function isFrance(v: unknown): boolean {
  return isRecord(v) && Object.entries(v).every(([k, list]) => isCrimeIndicatorKey(k) && Array.isArray(list)
    && list.every((p) => isRecord(p) && isNum(p['year']) && isNum(p['count']) && isNumOrNull(p['rate'])));
}

/** Garde stricte du contrat : tout fichier mal formé est rejeté (le panneau le dit, la carte reste vide). */
export function isCrimeDataset(v: unknown): v is CrimeDataset {
  return isRecord(v) && isNum(v['year']) && isNumOrNull(v['previousYear']) && isStrOrNull(v['publishedAt']) && isStr(v['source'])
    && isStr(v['sourceUrl']) && isNum(v['cityMinPopulation'])
    && Array.isArray(v['indicators']) && v['indicators'].length > 0 && v['indicators'].every(isIndicator)
    && isFrance(v['france'])
    && Array.isArray(v['departments']) && v['departments'].every(isDepartment)
    && Array.isArray(v['cities']) && v['cities'].every(isCity);
}

let cached: Promise<CrimeDataset> | null = null;

/** Lecture unique : le résultat est mémorisé, un échec ne l'est pas (la lecture suivante réessaie). */
export function fetchCrimeDataset(fetchImpl: typeof fetch = fetch): Promise<CrimeDataset> {
  cached ??= fetchImpl(CRIME_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`Criminalité : HTTP ${res.status}`);
      return res.json() as Promise<unknown>;
    })
    .then((body) => {
      if (!isCrimeDataset(body)) throw new Error('Criminalité : fichier mal formé');
      return body;
    })
    .catch((error: unknown) => {
      cached = null;
      throw error instanceof Error ? error : new Error('Criminalité : lecture impossible');
    });
  return cached;
}

/** Tests : repart d'un cache vide. */
export function resetCrimeCache(): void {
  cached = null;
}

// ─── Lecture des valeurs ───

export interface CrimeReading {
  count: number | null;
  /** Taux pour mille (habitants ; logements pour les cambriolages). */
  rate: number | null;
  /** Nombre masqué par le secret statistique, taux lissé publié : à dire « estimé ». */
  estimated: boolean;
  previous: number | null;
}

/** Valeur lue : tout à null = n.d. ; nombre null et taux renseigné = estimation lissée. */
export function crimeValue(v: CrimeValue | undefined): CrimeReading {
  if (!v) return { count: null, rate: null, estimated: false, previous: null };
  const [count, rate, previous] = v;
  return { count, rate, estimated: count === null && rate !== null, previous };
}

/** Taux pour mille converti pour 100 000 habitants (affichage des homicides). */
export function ratePer100k(ratePerThousand: number | null): number | null {
  return ratePerThousand === null ? null : ratePerThousand * 100;
}

/** Évolution en % de l'année précédente à l'année ; null sans les deux nombres ou si l'année précédente vaut 0. */
export function evolutionPct(count: number | null, previous: number | null): number | null {
  if (count === null || previous === null || previous === 0) return null;
  return ((count - previous) / previous) * 100;
}

/** Rapport du taux à celui de la France ; null sans l'un des deux ou si la France vaut 0. */
export function ratioToFrance(rate: number | null, franceRate: number | null): number | null {
  if (rate === null || franceRate === null || franceRate <= 0) return null;
  return rate / franceRate;
}

export function indicatorOf(ds: CrimeDataset, key: CrimeIndicatorKey): CrimeIndicator | undefined {
  return ds.indicators.find((i) => i.key === key);
}

/** Dernier point France de l'indicateur à l'année du fichier. */
export function franceLatest(ds: CrimeDataset, key: CrimeIndicatorKey): { year: number; count: number; rate: number | null } | null {
  const series = ds.france[key] ?? [];
  return series.find((p) => p.year === ds.year) ?? series[series.length - 1] ?? null;
}

export function franceRate(ds: CrimeDataset, key: CrimeIndicatorKey): number | null {
  return franceLatest(ds, key)?.rate ?? null;
}

// ─── Classement ───

export interface RankedDepartment { dept: CrimeDepartment; reading: CrimeReading; ratio: number | null }
export interface RankedCity { city: CrimeCity; reading: CrimeReading; ratio: number | null }

const byRateDesc = <T extends { reading: CrimeReading }>(a: T, b: T): number => (b.reading.rate ?? -1) - (a.reading.rate ?? -1);

/** Départements au taux renseigné, du plus élevé au plus bas. */
export function rankDepartments(ds: CrimeDataset, key: CrimeIndicatorKey, limit = Infinity): RankedDepartment[] {
  const fr = franceRate(ds, key);
  return ds.departments
    .map((dept) => { const reading = crimeValue(dept.values[key]); return { dept, reading, ratio: ratioToFrance(reading.rate, fr) }; })
    .filter((r) => r.reading.rate !== null)
    .sort(byRateDesc)
    .slice(0, limit);
}

/** Villes au taux renseigné, du plus élevé au plus bas ; vide pour un indicateur publié au département seulement. */
export function rankCities(ds: CrimeDataset, key: CrimeIndicatorKey, limit = Infinity): RankedCity[] {
  if (indicatorOf(ds, key)?.communal === false) return [];
  const fr = franceRate(ds, key);
  return ds.cities
    .map((city) => { const reading = crimeValue(city.values[key]); return { city, reading, ratio: ratioToFrance(reading.rate, fr) }; })
    .filter((r) => r.reading.rate !== null)
    .sort(byRateDesc)
    .slice(0, limit);
}

// ─── Couleur : taux rapporté à celui de la France ───

export type CrimeBand = 'bas' | 'moyen' | 'jaune' | 'orange' | 'rouge' | 'nd';
/** Seuils du rapport au taux national : sous 0,8 bas, jusqu'à 1,25 moyen, puis jaune dès 1,25, orange dès 1,6, rouge dès 2. */
export const CRIME_RATIO_STEPS = { moyen: 0.8, jaune: 1.25, orange: 1.6, rouge: 2 } as const;

export function crimeBand(ratio: number | null): CrimeBand {
  if (ratio === null || !Number.isFinite(ratio)) return 'nd';
  if (ratio >= CRIME_RATIO_STEPS.rouge) return 'rouge';
  if (ratio >= CRIME_RATIO_STEPS.orange) return 'orange';
  if (ratio >= CRIME_RATIO_STEPS.jaune) return 'jaune';
  if (ratio >= CRIME_RATIO_STEPS.moyen) return 'moyen';
  return 'bas';
}
