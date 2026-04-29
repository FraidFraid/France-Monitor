import type {
  FuelFreshness,
  FuelTensionDashboard,
  FuelTensionDepartmentSummary,
  FuelTensionLevel,
  FuelTensionNationalSummary,
  FuelTensionSignal,
  FuelType,
} from '../types/index.ts';
import { fetchFuelStations, NATIONAL_FUEL_DEPARTMENT_CODES } from './fuel-prices.ts';
import { Watchdog } from './watchdog.ts';

const FUEL_TYPES: FuelType[] = ['gazole', 'sp95', 'sp98', 'e10'];
const FUEL_TENSION_CACHE_TTL_MS = 5 * 60_000;
const HISTORY_STORAGE_KEY = 'france-monitor:fuel-tension-history:v2';
const HISTORY_RETENTION_DAYS = 10;
const TARGET_HISTORY_DAYS = 7;

Watchdog.register('fuel-tension', {
  label: 'Carburants temps réel',
  staleAfterMs: 6 * 60_000,
  detail: 'API prix carburants flux instantané v2 — prix, ruptures, fraîcheur stations',
  freshness: 'TEMPS_REEL',
});

export const FUEL_TENSION_DISCLAIMER_FR = 'Tension carburants : signal quasi temps réel basé sur l’API prix carburants (Ministère de l’Économie). Il ne mesure pas les volumes livrés mais les prix, ruptures et l’actualité des stations.';
export const FUEL_TENSION_DISCLAIMER_EN = 'Fuel tension: near real-time signal based on the public fuel prices API (Ministry of Economy). It tracks prices, outages and update freshness, not delivered volumes.';

export const FUEL_TENSION_THRESHOLDS = {
  priceSpikeCents: 12,
  staleUpdateMinutes: 96 * 60,
  mediumDeltaCents: 3,
  highDeltaCents: 7,
  criticalDeltaCents: 12,
  mediumAnomalyShare: 6,
  highAnomalyShare: 18,
  criticalAnomalyShare: 35,
  freshnessEscalationMinutes: 5 * 24 * 60,
} as const;

interface FuelTensionCacheEntry {
  data: FuelTensionDashboard;
  fetchedAt: number;
}

interface DepartmentFuelHistoryRecord {
  departmentCode: string;
  fuelType: FuelType;
  avgPrice: number | null;
}

interface HistorySnapshot {
  capturedAt: string;
  dayKey: string;
  records: DepartmentFuelHistoryRecord[];
}

interface PersistedHistory {
  version: 2;
  snapshots: HistorySnapshot[];
}

const cache = new Map<string, FuelTensionCacheEntry>();
const inflightRequests = new Map<string, Promise<FuelTensionDashboard>>();

function normalizeDepartmentCode(code: string): string {
  const trimmed = code.trim().toUpperCase();
  if (/^\d$/.test(trimmed)) return `0${trimmed}`;
  return trimmed;
}

function compareDepartmentCodes(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '2A') return b === '2B' ? -1 : -1;
  if (a === '2B') return b === '2A' ? 1 : -1;
  if (b === '2A' || b === '2B') return 1;
  return a.localeCompare(b, 'fr-FR', { numeric: true });
}

function buildCacheKey(departmentCodes?: string[]): string {
  if (!departmentCodes || departmentCodes.length === 0) return 'national';
  return Array.from(new Set(departmentCodes.map(normalizeDepartmentCode))).sort(compareDepartmentCodes).join(',');
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: Array<number | null | undefined>, digits = 1): number | null {
  const filtered = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (filtered.length === 0) return null;
  return round(filtered.reduce((sum, value) => sum + value, 0) / filtered.length, digits);
}

function median(values: Array<number | null | undefined>, digits = 1): number | null {
  const filtered = values
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .sort((a, b) => a - b);

  if (filtered.length === 0) return null;
  const middle = Math.floor(filtered.length / 2);
  if (filtered.length % 2 === 1) return round(filtered[middle], digits);
  return round((filtered[middle - 1] + filtered[middle]) / 2, digits);
}

function maxNumber(values: Array<number | null | undefined>, digits = 1): number | null {
  const filtered = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (filtered.length === 0) return null;
  return round(Math.max(...filtered), digits);
}

function levelFromRank(rank: number): FuelTensionLevel {
  if (rank >= 4) return 'CRITICAL';
  if (rank >= 3) return 'HIGH';
  if (rank >= 2) return 'MEDIUM';
  return 'LOW';
}

function buildFreshness(ageMinutes: number | null, timestamp: string | null): FuelFreshness {
  if (ageMinutes === null) {
    return { timestamp, ageMinutes: null, badge: 'NO_DATA' };
  }
  return { timestamp, ageMinutes, badge: 'QUASI-LIVE' };
}

function getSignalLevel(deltaCents: number | null, anomalyShare: number, avgUpdateAgeMinutes: number | null): FuelTensionLevel {
  let rank = 1;

  if (deltaCents !== null) {
    if (deltaCents > FUEL_TENSION_THRESHOLDS.criticalDeltaCents) rank = Math.max(rank, 4);
    else if (deltaCents >= FUEL_TENSION_THRESHOLDS.highDeltaCents) rank = Math.max(rank, 3);
    else if (deltaCents >= FUEL_TENSION_THRESHOLDS.mediumDeltaCents) rank = Math.max(rank, 2);
  }

  if (anomalyShare > FUEL_TENSION_THRESHOLDS.criticalAnomalyShare) rank = Math.max(rank, 4);
  else if (anomalyShare >= FUEL_TENSION_THRESHOLDS.highAnomalyShare) rank = Math.max(rank, 3);
  else if (anomalyShare >= FUEL_TENSION_THRESHOLDS.mediumAnomalyShare) rank = Math.max(rank, 2);

  if (avgUpdateAgeMinutes !== null && avgUpdateAgeMinutes > FUEL_TENSION_THRESHOLDS.freshnessEscalationMinutes) {
    rank = Math.min(4, rank + 1);
  }

  return levelFromRank(rank);
}

function compareSummaries(a: FuelTensionDepartmentSummary, b: FuelTensionDepartmentSummary): number {
  const rank = (level: FuelTensionLevel) => level === 'CRITICAL' ? 4 : level === 'HIGH' ? 3 : level === 'MEDIUM' ? 2 : 1;
  const byLevel = rank(b.tensionLevel) - rank(a.tensionLevel);
  if (byLevel !== 0) return byLevel;
  const byAnomaly = b.anomalyShare - a.anomalyShare;
  if (byAnomaly !== 0) return byAnomaly;
  const byDelta = (b.maxDeltaPrice7d ?? -Infinity) - (a.maxDeltaPrice7d ?? -Infinity);
  if (byDelta !== 0) return byDelta;
  return compareDepartmentCodes(a.departmentCode, b.departmentCode);
}

function getDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readHistory(): PersistedHistory {
  if (!canUseStorage()) return { version: 2, snapshots: [] };

  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return { version: 2, snapshots: [] };

    const parsed = JSON.parse(raw) as PersistedHistory;
    if (!parsed || !Array.isArray(parsed.snapshots)) return { version: 2, snapshots: [] };

    return {
      version: 2,
      snapshots: parsed.snapshots.filter((snapshot) =>
        typeof snapshot?.capturedAt === 'string' &&
        typeof snapshot?.dayKey === 'string' &&
        Array.isArray(snapshot?.records),
      ),
    };
  } catch {
    return { version: 2, snapshots: [] };
  }
}

function writeHistory(history: PersistedHistory): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // National history is aggregate-only; ignore quota failures and keep runtime data.
  }
}

function pruneSnapshots(snapshots: HistorySnapshot[]): HistorySnapshot[] {
  const retentionCutoff = Date.now() - (HISTORY_RETENTION_DAYS * 24 * 60 * 60_000);
  return snapshots.filter((snapshot) => {
    const timestamp = new Date(snapshot.capturedAt).getTime();
    return Number.isFinite(timestamp) && timestamp >= retentionCutoff;
  });
}

function findComparisonSnapshot(snapshots: HistorySnapshot[], currentCapturedAt: string): HistorySnapshot | null {
  const target = new Date(currentCapturedAt).getTime() - (TARGET_HISTORY_DAYS * 24 * 60 * 60_000);
  const minTarget = target - (24 * 60 * 60_000);
  const maxTarget = target + (24 * 60 * 60_000);

  const candidates = snapshots
    .filter((snapshot) => {
      const timestamp = new Date(snapshot.capturedAt).getTime();
      return Number.isFinite(timestamp) && timestamp >= minTarget && timestamp <= maxTarget;
    })
    .sort((a, b) => Math.abs(new Date(a.capturedAt).getTime() - target) - Math.abs(new Date(b.capturedAt).getTime() - target));

  return candidates[0] ?? null;
}

function buildComparisonMap(snapshot: HistorySnapshot | null): Map<string, number | null> {
  const comparison = new Map<string, number | null>();
  if (!snapshot) return comparison;

  for (const record of snapshot.records) {
    comparison.set(`${record.departmentCode}:${record.fuelType}`, record.avgPrice);
  }

  return comparison;
}

function createEmptyNationalSummary(): FuelTensionNationalSummary {
  return {
    stationCount: 0,
    departmentCount: 0,
    anomalyShare: 0,
    avgUpdateAgeMinutes: null,
    medianUpdateAgeMinutes: null,
    tensionLevel: 'LOW',
    avgPrices: {},
    topDepartments: [],
  };
}

function createEmptyDashboard(departmentCodes: string[], sourceStatus: FuelTensionDashboard['sourceStatus'], errorMessage?: string): FuelTensionDashboard {
  const normalizedCodes = departmentCodes.map(normalizeDepartmentCode).sort(compareDepartmentCodes);
  return {
    generatedAt: new Date().toISOString(),
    departments: normalizedCodes,
    signals: [],
    summaries: [],
    national: createEmptyNationalSummary(),
    sourceStatus,
    degraded: sourceStatus !== 'ok',
    sourceLabel: 'API prix des carburants en France – flux instantané v2 (Ministère de l’Économie)',
    coverageLabel: 'France entière · couverture nationale',
    disclaimerFr: FUEL_TENSION_DISCLAIMER_FR,
    disclaimerEn: FUEL_TENSION_DISCLAIMER_EN,
    errorMessage,
  };
}

function buildHistorySnapshot(
  summaries: FuelTensionDepartmentSummary[],
  capturedAt: string,
): HistorySnapshot {
  const records: DepartmentFuelHistoryRecord[] = [];

  for (const summary of summaries) {
    for (const signal of summary.fuelSignals) {
      records.push({
        departmentCode: summary.departmentCode,
        fuelType: signal.fuelType,
        avgPrice: signal.avgPrice,
      });
    }
  }

  return {
    capturedAt,
    dayKey: getDayKey(new Date(capturedAt)),
    records,
  };
}

function persistHistorySnapshot(
  summaries: FuelTensionDepartmentSummary[],
  capturedAt: string,
): Map<string, number | null> {
  const snapshot = buildHistorySnapshot(summaries, capturedAt);
  const history = readHistory();
  const snapshots = pruneSnapshots(history.snapshots.filter((entry) => entry.dayKey !== snapshot.dayKey));
  snapshots.push(snapshot);
  writeHistory({ version: 2, snapshots });
  return buildComparisonMap(findComparisonSnapshot(snapshots, capturedAt));
}

function buildNationalSummary(summaries: FuelTensionDepartmentSummary[], stationAnomalyCount: number): FuelTensionNationalSummary {
  const stationCount = summaries.reduce((sum, summary) => sum + summary.stationCount, 0);
  const anomalyShare = stationCount > 0 ? round((stationAnomalyCount / stationCount) * 100, 1) : 0;
  const avgUpdateAgeMinutes = average(summaries.map((summary) => summary.avgUpdateAgeMinutes), 0);

  const allFuelSignals = summaries.flatMap((summary) => summary.fuelSignals);
  const avgPrices = FUEL_TYPES.reduce<Partial<Record<FuelType, number>>>((acc, fuelType) => {
    const value = average(
      allFuelSignals
        .filter((signal) => signal.fuelType === fuelType)
        .map((signal) => signal.avgPrice),
      3,
    );
    if (value !== null) acc[fuelType] = value;
    return acc;
  }, {});

  return {
    stationCount,
    departmentCount: summaries.length,
    anomalyShare,
    avgUpdateAgeMinutes,
    medianUpdateAgeMinutes: median(summaries.map((summary) => summary.avgUpdateAgeMinutes), 0),
    tensionLevel: getSignalLevel(
      maxNumber(summaries.map((summary) => summary.maxDeltaPrice7d), 1),
      anomalyShare,
      avgUpdateAgeMinutes,
    ),
    avgPrices,
    topDepartments: summaries.slice(0, 5),
  };
}

export function buildDegradedFuelTensionDashboard(departmentCodes = [...NATIONAL_FUEL_DEPARTMENT_CODES], error?: unknown): FuelTensionDashboard {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'API carburants indisponible';
  return createEmptyDashboard(departmentCodes, 'error', message);
}

async function fetchFuelTensionDashboardUncached(departmentCodes?: string[]): Promise<FuelTensionDashboard> {
  const requestedDepartmentCodes = departmentCodes?.map(normalizeDepartmentCode);
  const stations = await fetchFuelStations(requestedDepartmentCodes);
  const availableDepartmentCodes = Array.from(new Set(stations.map((station) => station.departmentCode))).sort(compareDepartmentCodes);
  const scopeDepartmentCodes = availableDepartmentCodes.length > 0
    ? availableDepartmentCodes
    : (requestedDepartmentCodes && requestedDepartmentCodes.length > 0
      ? requestedDepartmentCodes.sort(compareDepartmentCodes)
      : [...NATIONAL_FUEL_DEPARTMENT_CODES]);

  if (scopeDepartmentCodes.length === 0) {
    return createEmptyDashboard([], 'stale');
  }

  const generatedAt = new Date().toISOString();
  const signals: FuelTensionSignal[] = [];
  const summaries: FuelTensionDepartmentSummary[] = [];
  let stationAnomalyCount = 0;

  for (const departmentCode of scopeDepartmentCodes) {
    const departmentStations = stations.filter((station) => station.departmentCode === departmentCode);
    const departmentName = departmentStations[0]?.departmentName ?? departmentCode;
    const stationAnomalies = new Set<string>();
    const fuelSignals: FuelTensionSignal[] = [];

    for (const fuelType of FUEL_TYPES) {
      const relevantStations = departmentStations.filter((station) => Boolean(station.fuels[fuelType]));
      const stationCount = relevantStations.length;
      const fuelAnomalies = new Set<string>();

      const currentPrices = relevantStations
        .map((station) => station.fuels[fuelType]?.price ?? null)
        .filter((price): price is number => typeof price === 'number' && Number.isFinite(price));
      const avgPrice = average(currentPrices, 3);

      const ages = relevantStations.map((station) => station.fuels[fuelType]?.updateAgeMinutes ?? null);
      const avgUpdateAgeMinutes = average(ages, 0);

      const lastUpdateTimestamp = relevantStations
        .map((station) => station.fuels[fuelType]?.updatedAt ?? null)
        .filter((value): value is string => typeof value === 'string')
        .sort()
        .at(-1) ?? null;

      for (const station of relevantStations) {
        const status = station.fuels[fuelType];
        if (!status) continue;

        const isAnomalous =
          status.ruptureType !== null ||
          (status.updateAgeMinutes !== null && status.updateAgeMinutes > FUEL_TENSION_THRESHOLDS.staleUpdateMinutes);

        if (isAnomalous) {
          fuelAnomalies.add(station.id);
          stationAnomalies.add(station.id);
        }
      }

      const anomalyShare = stationCount > 0 ? round((fuelAnomalies.size / stationCount) * 100, 1) : 0;
      fuelSignals.push({
        departmentCode,
        departmentName,
        fuelType,
        avgPrice,
        deltaPrice7d: null,
        stationCount,
        anomalyShare,
        avgUpdateAgeMinutes,
        tensionLevel: getSignalLevel(null, anomalyShare, avgUpdateAgeMinutes),
        dataFreshness: buildFreshness(avgUpdateAgeMinutes, lastUpdateTimestamp),
      });
    }

    const stationCount = departmentStations.length;
    const anomalyShare = stationCount > 0 ? round((stationAnomalies.size / stationCount) * 100, 1) : 0;
    const avgUpdateAgeMinutes = average(fuelSignals.map((signal) => signal.avgUpdateAgeMinutes), 0);
    const latestTimestamp = fuelSignals
      .map((signal) => signal.dataFreshness.timestamp)
      .filter((value): value is string => typeof value === 'string')
      .sort()
      .at(-1) ?? null;

    stationAnomalyCount += stationAnomalies.size;

    summaries.push({
      departmentCode,
      departmentName,
      stationCount,
      anomalyShare,
      avgUpdateAgeMinutes,
      deltaPrice7d: null,
      maxDeltaPrice7d: null,
      tensionLevel: getSignalLevel(null, anomalyShare, avgUpdateAgeMinutes),
      freshness: buildFreshness(avgUpdateAgeMinutes, latestTimestamp),
      fuelSignals,
    });
  }

  const comparisonMap = persistHistorySnapshot(summaries, generatedAt);

  for (const summary of summaries) {
    for (const signal of summary.fuelSignals) {
      const previousAvgPrice = comparisonMap.get(`${summary.departmentCode}:${signal.fuelType}`) ?? null;
      const deltaPrice7d = signal.avgPrice !== null && previousAvgPrice !== null
        ? round((signal.avgPrice - previousAvgPrice) * 100, 1)
        : null;

      signal.deltaPrice7d = deltaPrice7d;
      signal.tensionLevel = getSignalLevel(deltaPrice7d, signal.anomalyShare, signal.avgUpdateAgeMinutes);
      signals.push(signal);
    }

    summary.deltaPrice7d = average(summary.fuelSignals.map((signal) => signal.deltaPrice7d), 1);
    summary.maxDeltaPrice7d = maxNumber(summary.fuelSignals.map((signal) => signal.deltaPrice7d), 1);
    summary.tensionLevel = getSignalLevel(summary.maxDeltaPrice7d, summary.anomalyShare, summary.avgUpdateAgeMinutes);
  }

  summaries.sort(compareSummaries);

  return {
    generatedAt,
    departments: scopeDepartmentCodes,
    signals,
    summaries,
    national: buildNationalSummary(summaries, stationAnomalyCount),
    sourceStatus: stations.length > 0 ? 'ok' : 'stale',
    degraded: stations.length === 0,
    sourceLabel: 'API prix des carburants en France – flux instantané v2 (Ministère de l’Économie)',
    coverageLabel: 'France entière · couverture nationale',
    disclaimerFr: FUEL_TENSION_DISCLAIMER_FR,
    disclaimerEn: FUEL_TENSION_DISCLAIMER_EN,
  };
}

export async function fetchFuelTensionDashboard(departmentCodes?: string[]): Promise<FuelTensionDashboard> {
  const normalizedCodes = departmentCodes?.map(normalizeDepartmentCode);
  const cacheKey = buildCacheKey(normalizedCodes);
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < FUEL_TENSION_CACHE_TTL_MS) {
    return cached.data;
  }

  const inflight = inflightRequests.get(cacheKey);
  if (inflight) return inflight;

  Watchdog.report('fuel-tension', { type: 'loading' });
  const startedAt = Date.now();
  const request = fetchFuelTensionDashboardUncached(normalizedCodes)
    .then((dashboard) => {
      cache.set(cacheKey, { data: dashboard, fetchedAt: Date.now() });
      inflightRequests.delete(cacheKey);
      if (dashboard.sourceStatus === 'ok') {
        Watchdog.report('fuel-tension', {
          type: 'success',
          responseTimeMs: Date.now() - startedAt,
          detail: `${dashboard.national.stationCount.toLocaleString('fr-FR')} stations · ${dashboard.national.departmentCount} départements · ${dashboard.national.tensionLevel}`,
        });
      } else {
        Watchdog.report('fuel-tension', { type: 'fallback', reason: dashboard.errorMessage ?? 'aucune station exploitable' });
      }
      return dashboard;
    })
    .catch((error) => {
      inflightRequests.delete(cacheKey);
      Watchdog.report('fuel-tension', {
        type: 'failure',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    });

  inflightRequests.set(cacheKey, request);
  return request;
}

export function getFuelTensionLevelColor(level: FuelTensionLevel): string {
  switch (level) {
    case 'CRITICAL':
      return '#EF4444';
    case 'HIGH':
      return '#F97316';
    case 'MEDIUM':
      return '#FBBF24';
    default:
      return '#34D399';
  }
}

export function getFuelBadgeColor(badge: FuelFreshness['badge']): string {
  switch (badge) {
    case 'QUASI-LIVE':
      return '#FBBF24';
    default:
      return '#94A3B8';
  }
}
