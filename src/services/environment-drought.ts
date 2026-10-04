// src/services/environment-drought.ts : lecture client du panneau Sécheresse (spec 2026-10-04 environnement § 3.1) : arrêtés VigiEau
// par département et série quotidienne. Un stock (E2) : jamais dans le score ni dans une situation. Garde stricte par élément,
// cache sous la relève d'App.ts, jamais de rejet ; panneau des sources daté par les arrêtés (S1).
import type { DroughtLevel, DroughtResponse } from '../types/index.ts';
import { isRecord, isStringArray } from './health-surveillance.ts';
import {
  environmentSlotStatus, isBool, isOneOf, isStr, isStrOrNull, listOf, loadSlot, mergeSlot, numbersIn, type EnvironmentStatus, type SourceSlot,
} from './environment-source.ts';

export const DROUGHT_URL = '/api/environment/drought';
/** Cache client : 50 min, sous la relève du panneau de 60 min (App.ts, ENVIRONMENT_POLL_MS). */
export const DROUGHT_TTL_MS = 50 * 60_000;

export interface DroughtState { drought: SourceSlot<DroughtResponse> }

const LEVELS: ReadonlySet<DroughtLevel> = new Set<DroughtLevel>(['vigilance', 'alerte', 'alerte_renforcee', 'crise']);
const COUNT_KEYS = ['vigilance', 'alerte', 'alerte_renforcee', 'crise'] as const;
const isLevelOrNull = (v: unknown): boolean => v === null || isOneOf(v, LEVELS);
const isDept = (d: Record<string, unknown>): boolean => isStr(d.dept) && isStr(d.name) && isStr(d.region) && isBool(d.available)
  && isLevelOrNull(d.max) && isLevelOrNull(d.superficielle) && isLevelOrNull(d.souterraine) && isLevelOrNull(d.potable);
const isDay = (d: Record<string, unknown>): boolean => isStr(d.date) && numbersIn(d, COUNT_KEYS);

export function isDroughtResponse(v: unknown): v is DroughtResponse {
  if (!isRecord(v) || !isStrOrNull(v.asOf) || !isStrOrNull(v.readAt) || !isStringArray(v.errors)) return false;
  const { history } = v;
  return listOf(v.departments, isDept) && numbersIn(v.counts, [...COUNT_KEYS, 'aucun'])
    && isRecord(history) && listOf(history.days, isDay) && isStrOrNull(history.since);
}

/** Ne rejette jamais. */
export async function fetchDrought(previous: DroughtState | null, now: number = Date.now()): Promise<DroughtState> {
  return { drought: await loadSlot(DROUGHT_URL, DROUGHT_TTL_MS, previous?.drought, now, isDroughtResponse, 'VigiEau') };
}

/** Fusion à l'écriture (S3) : un échec garde les arrêtés actuellement en mémoire, avec leur date. */
export function mergeDrought(current: DroughtState | null, incoming: DroughtState): DroughtState {
  return { drought: mergeSlot(current?.drought, incoming.drought) };
}

/** Panneau des sources (« VigiEau ») : date des arrêtés, retard au-delà de 36 h. */
export function droughtStatus(state: DroughtState, now: number): EnvironmentStatus {
  return environmentSlotStatus(state.drought, 'vigieau', state.drought.data?.asOf ?? null, now);
}
