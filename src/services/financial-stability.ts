// src/services/financial-stability.ts : lecture client du bloc « Stabilité financière » (spec 2026-10-12) : séries BCE, taux
// directeurs et écart OAT-Bund de /api/finance/stability. Cache par URL sous la relève d'App.ts, jamais de rejet, fusion à
// l'écriture (traffic-source.ts) ; deux lignes au panneau des sources : « BCE » et « Écart OAT-Bund ».
import type { DataSourceStatus, FinancialStabilityResponse } from '../types/index.ts';
import { isRecord, isStringArray } from './health-surveillance.ts';
import { isNum, isNumOrNull, isStr, isStrOrNull, listOf, loadSlot, mergeSlot, type SourceSlot } from './traffic-source.ts';

export const FINANCIAL_STABILITY_URL = '/api/finance/stability';
/** Cache client : 4 min, sous la relève de 5 min (POLL_FINANCE_MS). */
export const FINANCIAL_STABILITY_TTL_MS = 4 * 60_000;
export const BCE_SOURCE_NAME = 'BCE';
export const SPREAD_SOURCE_NAME = 'Écart OAT-Bund';

export type FinancialStabilitySlot = SourceSlot<FinancialStabilityResponse>;
export type PartStatus = Pick<DataSourceStatus, 'status' | 'lastUpdate' | 'error'>;

const STATUSES: ReadonlySet<unknown> = new Set(['ok', 'stale', 'unavailable']);
const SERIES_IDS: ReadonlySet<unknown> = new Set(['cissFr', 'cissEa', 'estr', 'eurusd']);
const RATE_IDS: ReadonlySet<unknown> = new Set(['depot', 'refi']);

const isFinPoint = (p: unknown): boolean => isRecord(p) && isStr(p.date) && isNum(p.value);
const isPart = (p: Record<string, unknown>): boolean => STATUSES.has(p.status) && isStrOrNull(p.error);
const isSeries = (s: unknown): boolean => isRecord(s) && SERIES_IDS.has(s.id) && isNumOrNull(s.value) && isStrOrNull(s.date)
  && listOf(s.history, isFinPoint) && isPart(s);
const isRate = (r: unknown): boolean => isRecord(r) && RATE_IDS.has(r.id) && isNumOrNull(r.value) && isStrOrNull(r.since)
  && isNumOrNull(r.previous) && isPart(r);
const isSpread = (s: unknown): boolean => isRecord(s) && isNumOrNull(s.value) && isNumOrNull(s.fr10y) && isNumOrNull(s.de10y)
  && isStrOrNull(s.readAt) && listOf(s.history, isFinPoint) && isPart(s);

export function isFinancialStabilityResponse(v: unknown): v is FinancialStabilityResponse {
  return isRecord(v) && isStr(v.readAt) && listOf(v.series, isSeries) && listOf(v.rates, isRate) && isSpread(v.spread)
    && isStringArray(v.errors);
}

export async function fetchFinancialStability(previous: FinancialStabilitySlot | null, now: number = Date.now()): Promise<FinancialStabilitySlot> {
  return loadSlot(FINANCIAL_STABILITY_URL, FINANCIAL_STABILITY_TTL_MS, previous ?? undefined, now, isFinancialStabilityResponse, 'Stabilité financière');
}

export function mergeFinancialStability(current: FinancialStabilitySlot | null, incoming: FinancialStabilitySlot): FinancialStabilitySlot {
  return mergeSlot(current, incoming);
}

interface Part { status: 'ok' | 'stale' | 'unavailable'; error: string | null }

function partsStatus(slot: FinancialStabilitySlot, parts: (d: FinancialStabilityResponse) => Part[]): PartStatus {
  if (slot.data === null) return { status: slot.error !== null ? 'error' : 'loading', lastUpdate: null, error: slot.error ?? undefined };
  const list = parts(slot.data);
  const errors = [...(slot.error !== null ? [slot.error] : []), ...list.flatMap((p) => (p.error !== null ? [p.error] : []))];
  const error = errors.length > 0 ? errors.join(' ; ') : undefined;
  const lastUpdate = new Date(slot.data.readAt);
  if (list.every((p) => p.status === 'unavailable')) return { status: 'error', lastUpdate, error };
  if (error !== undefined || list.some((p) => p.status !== 'ok')) return { status: 'stale', lastUpdate, error };
  return { status: 'ok', lastUpdate, error: undefined };
}

export function bceStatus(slot: FinancialStabilitySlot): PartStatus {
  return partsStatus(slot, (d) => [...d.series, ...d.rates]);
}

export function spreadStatus(slot: FinancialStabilitySlot): PartStatus {
  return partsStatus(slot, (d) => [d.spread]);
}
