/**
 * enedis-adapter.ts — Adapter pattern for Enedis DataFair API.
 *
 * Decouples DataFair v1 schema from internal PowerOutage interface.
 * Handles schema variations and provides type-safe mapping.
 */

// ═══ DataFair Raw Record Types ═══

/**
 * Raw record from indicateur-continuite-dalimentation dataset.
 * Fields use year-keyed columns (aaa2020, aaa2021, aaa2022...).
 */
export interface DataFairContinuityRecord {
  _id: string;
  _i?: number;
  // Department code variations
  code_departement?: string;
  code_dep?: string;
  code_dept?: string;
  departement_code?: string;
  insee_departement?: string;
  code_insee_departement?: string;
  dep?: string;
  departement?: string;
  // Year-keyed values (dynamic)
  [key: string]: string | number | null | undefined;
}

/**
 * Raw record from duree-moyenne-de-coupure-bt dataset.
 */
export interface DataFairDurationRecord {
  _id: string;
  annee: string;
  duree_annuelle_moyenne_de_coupure_non_planifiees_par_client_minutes?: string | number;
  duree_annuelle_moyenne_de_coupure_planifiees_par_client_minutes?: string | number;
}

/**
 * Raw record from frequence-moyenne-de-coupure-par-client-bt dataset.
 */
export interface DataFairFrequencyRecord {
  _id: string;
  annee: string;
  frequence_moyenne_de_coupure_longue_non_planifiee_par_client_bt?: string | number;
  frequence_moyenne_de_coupure_longue_planifiee_par_client_bt?: string | number;
  frequence_moyenne_de_coupure_breve_par_client_bt?: string | number;
}

/**
 * Scraped incident from /incidents/enedis endpoint.
 */
export interface ScrapedIncident {
  id: string;
  departmentCode: string;
  departmentName: string;
  affectedCount: number;
  cause: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  scrapedAt: number;
}

// ═══ Adapted Output Types ═══

export interface ContinuityByDepartment {
  departmentCode: string;
  latestYear: number;
  continuityPct: number;
}

export interface NationalDuration {
  year: number;
  plannedMinutes: number;
  unplannedMinutes: number;
  totalMinutes: number;
}

export interface NationalFrequency {
  year: number;
  longUnplanned: number;
  longPlanned: number;
  brief: number;
  total: number;
}

// ═══ Adapter Functions ═══

// Candidate keys for department code extraction
const DEPT_CODE_KEYS = [
  'code_departement',
  'code_dep',
  'code_dept',
  'departement_code',
  'insee_departement',
  'code_insee_departement',
  'dep',
  'departement',
] as const;

/**
 * Adapter: Maps DataFair continuity records to department percentage map.
 *
 * @param records - Raw DataFair API records
 * @returns Map of departmentCode -> continuity percentage
 */
export function adaptContinuityRecords(
  records: DataFairContinuityRecord[]
): Map<string, number> {
  const result = new Map<string, number>();

  for (const record of records) {
    const deptCode = extractDepartmentCode(record);
    if (!deptCode) continue;

    const latestValue = extractLatestYearValue(record);
    if (latestValue !== null && Number.isFinite(latestValue) && latestValue >= 0) {
      result.set(deptCode, latestValue);
    }
  }

  return result;
}

/**
 * Adapter: Extracts national duration metrics from DataFair records.
 *
 * @param records - Raw DataFair API records
 * @returns Latest year's duration metrics, or null if unavailable
 */
export function adaptDurationRecords(
  records: DataFairDurationRecord[]
): NationalDuration | null {
  let bestYear = -1;
  let best: NationalDuration | null = null;

  for (const record of records) {
    const year = parseInt(String(record.annee ?? ''), 10);
    if (!Number.isFinite(year)) continue;

    const planned = parseNumericField(
      record.duree_annuelle_moyenne_de_coupure_planifiees_par_client_minutes
    );
    const unplanned = parseNumericField(
      record.duree_annuelle_moyenne_de_coupure_non_planifiees_par_client_minutes
    );

    if (year > bestYear) {
      bestYear = year;
      best = {
        year,
        plannedMinutes: planned,
        unplannedMinutes: unplanned,
        totalMinutes: planned + unplanned,
      };
    }
  }

  return best;
}

/**
 * Adapter: Extracts national frequency metrics from DataFair records.
 *
 * @param records - Raw DataFair API records
 * @returns Latest year's frequency metrics, or null if unavailable
 */
export function adaptFrequencyRecords(
  records: DataFairFrequencyRecord[]
): NationalFrequency | null {
  let bestYear = -1;
  let best: NationalFrequency | null = null;

  for (const record of records) {
    const year = parseInt(String(record.annee ?? ''), 10);
    if (!Number.isFinite(year)) continue;

    const longUnplanned = parseNumericField(
      record.frequence_moyenne_de_coupure_longue_non_planifiee_par_client_bt
    );
    const longPlanned = parseNumericField(
      record.frequence_moyenne_de_coupure_longue_planifiee_par_client_bt
    );
    const brief = parseNumericField(
      record.frequence_moyenne_de_coupure_breve_par_client_bt
    );

    if (year > bestYear) {
      bestYear = year;
      best = {
        year,
        longUnplanned,
        longPlanned,
        brief,
        total: longUnplanned + longPlanned + brief,
      };
    }
  }

  return best;
}

/**
 * Validates and normalizes scraped incidents.
 *
 * @param raw - Raw incidents from scrapling-proxy
 * @returns Validated incidents with normalized department codes
 */
export function adaptScrapedIncidents(raw: unknown): ScrapedIncident[] {
  if (!Array.isArray(raw)) return [];

  const incidents: ScrapedIncident[] = [];

  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;

    const obj = item as Record<string, unknown>;

    // Validate required fields
    const deptCode = obj.departmentCode;
    const affected = obj.affectedCount;

    if (typeof deptCode !== 'string' || typeof affected !== 'number') continue;

    const normalizedCode = normalizeDepartmentCode(deptCode);
    if (!normalizedCode) continue;

    incidents.push({
      id: String(obj.id ?? `incident-${normalizedCode}`),
      departmentCode: normalizedCode,
      departmentName: String(obj.departmentName ?? normalizedCode),
      affectedCount: Math.round(affected),
      cause: String(obj.cause ?? 'Incident en cours'),
      severity: validateSeverity(obj.severity),
      scrapedAt: typeof obj.scrapedAt === 'number' ? obj.scrapedAt : Date.now(),
    });
  }

  return incidents;
}

// ═══ Private Helpers ═══

function extractDepartmentCode(record: DataFairContinuityRecord): string | null {
  for (const key of DEPT_CODE_KEYS) {
    const raw = record[key];
    if (raw == null) continue;

    const val = String(raw).trim().toUpperCase();
    const normalized = normalizeDepartmentCode(val);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function extractLatestYearValue(record: DataFairContinuityRecord): number | null {
  let bestYear = -1;
  let bestValue: number | null = null;

  for (const [key, raw] of Object.entries(record)) {
    // Match year-keyed columns: aaa2020, aaa2021, etc.
    const match = key.match(/^aaa(20\d{2})$/);
    if (!match || raw == null || raw === '') continue;

    const year = parseInt(match[1], 10);
    const value = parseNumericField(raw);

    if (year > bestYear && Number.isFinite(value)) {
      bestYear = year;
      bestValue = value;
    }
  }

  return bestValue;
}

function parseNumericField(value: unknown): number {
  if (value == null) return 0;
  const str = String(value).replace(',', '.').trim();
  const n = parseFloat(str);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Normalize department code to standard format.
 *
 * - Corse: 20 -> 2A
 * - Mainland: 1 -> 01, 75 stays 75
 * - DROM: 971, 972, etc.
 */
export function normalizeDepartmentCode(input: string): string | null {
  const cleaned = input.trim().toUpperCase();

  // Corse sometimes appears as 20 in some datasets
  if (cleaned === '20') return '2A';
  if (cleaned === '2A' || cleaned === '2B') return cleaned;

  // Numeric departments
  if (/^\d+$/.test(cleaned)) {
    const n = parseInt(cleaned, 10);
    if (Number.isNaN(n)) return null;

    // DROM-COM (3 digits)
    if (n >= 971 && n <= 989) return String(n);

    // Mainland France (01-95)
    if (n >= 1 && n <= 95) return String(n).padStart(2, '0');

    // Safety net for other codes
    if (n >= 96 && n <= 999) return String(n);
  }

  return null;
}

function validateSeverity(value: unknown): 'critical' | 'high' | 'medium' | 'low' {
  if (value === 'critical' || value === 'high' || value === 'medium' || value === 'low') {
    return value;
  }
  return 'medium';
}
