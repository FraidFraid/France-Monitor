// src/services/environment-sea-levels.ts : lecture client des marégraphes du SHOM (section Submersion marine du panneau Vigilance
// météo, spec 2026-10-04 environnement § 3.4). Lu seulement couche Vigilance active ou panneau ouvert (contrats § 0.7).
import type { SeaLevelsResponse } from '../types/index.ts';
import { isRecord, isStringArray } from './health-surveillance.ts';
import { isEnvironmentDataLate } from './environment-levels.ts';
import {
  environmentSlotStatus, isNum, isNumOrNull, isStr, isStrOrNull, listOf, loadSlot, mergeSlot, numbersIn, type EnvironmentStatus, type SourceSlot,
} from './environment-source.ts';

export const SEA_LEVELS_URL = '/api/environment/sea-levels';
/** Cache client : 8 min ; la relève de la vigilance (5 min) relit donc les marégraphes toutes les 10 min. */
export const SEA_LEVELS_TTL_MS = 8 * 60_000;

export interface SeaLevelsState { seaLevels: SourceSlot<SeaLevelsResponse> }

const isSeriesPoint = (p: Record<string, unknown>): boolean => isStr(p.at) && isNum(p.value);
const isGauge = (g: Record<string, unknown>): boolean => numbersIn(g, ['id', 'lat', 'lon']) && isStr(g.name) && isStr(g.coastDomain) && isStr(g.dept)
  && isStrOrNull(g.lastAt) && isNumOrNull(g.heightM) && isNumOrNull(g.change1hM) && listOf(g.series, isSeriesPoint);

export function isSeaLevelsResponse(v: unknown): v is SeaLevelsResponse {
  return isRecord(v) && isStrOrNull(v.readAt) && v.predictionAvailable === false && listOf(v.gauges, isGauge) && isStringArray(v.errors);
}

export async function fetchSeaLevels(previous: SeaLevelsState | null, now: number = Date.now()): Promise<SeaLevelsState> {
  return { seaLevels: await loadSlot(SEA_LEVELS_URL, SEA_LEVELS_TTL_MS, previous?.seaLevels, now, isSeaLevelsResponse, 'SHOM') };
}

export function mergeSeaLevels(current: SeaLevelsState | null, incoming: SeaLevelsState): SeaLevelsState {
  return { seaLevels: mergeSlot(current?.seaLevels, incoming.seaLevels) };
}

/** Dernière mesure la plus récente des marégraphes ; null sans mesure. */
export function latestGaugeAt(s: SeaLevelsResponse | null): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const g of s?.gauges ?? []) {
    const ms = g.lastAt === null ? Number.NaN : Date.parse(g.lastAt);
    if (g.lastAt !== null && Number.isFinite(ms) && ms > bestMs) { best = g.lastAt; bestMs = ms; }
  }
  return best;
}

/** Plus ancienne dernière mesure parmi les marégraphes qui en ont une ; null sans mesure. */
function oldestGaugeAt(s: SeaLevelsResponse): string | null {
  const dates = s.gauges.map((g) => g.lastAt).filter((d): d is string => d !== null && Number.isFinite(Date.parse(d)));
  return dates.sort((x, y) => Date.parse(x) - Date.parse(y))[0] ?? null;
}

/**
 * Panneau des sources (« Marégraphes SHOM ») : retard jugé marégraphe par marégraphe (dernière mesure + 30 min). Un marégraphe servi
 * périmé après un échec n'a pas d'erreur à lui : un seul en retard suffit à passer la ligne « stale », datée de sa dernière mesure.
 */
export function seaLevelsStatus(state: SeaLevelsState, now: number): EnvironmentStatus {
  const data = state.seaLevels.data;
  const anyLate = data !== null && data.gauges.some((g) => isEnvironmentDataLate('refmar', g.lastAt, now));
  const date = data !== null && anyLate ? oldestGaugeAt(data) : latestGaugeAt(data);
  const status = environmentSlotStatus(state.seaLevels, 'refmar', date, now);
  if (!anyLate || status.status === 'loading' || status.status === 'error') return status;
  const period = status.period ?? 'n.d.';
  return { ...status, status: 'stale', period: period.includes('(en retard)') || period === 'n.d.' ? period : `${period} (en retard)` };
}
