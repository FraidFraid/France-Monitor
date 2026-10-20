// src/services/environment-pollen.ts : lecture client du panneau Pollens (Atmo France, 20/10/2026) : niveau de J à J+2 agrégé par
// département par /api/environment/pollen. Même socle que la qualité de l'air (SourceSlot, cache sous la relève, jamais de rejet).
import type { PollenDept, PollenDeptDay, PollenResponse, PollenTaxon } from '../types/index.ts';
import { isRecord, isStringArray } from './health-surveillance.ts';
import {
  environmentSlotStatus, isBool, isNum, isOneOf, isStr, isStrOrNull, listOf, loadSlot, mergeSlot, numbersIn, type EnvironmentStatus, type SourceSlot,
} from './environment-source.ts';

export const POLLEN_URL = '/api/environment/pollen';
/** Cache client : 25 min, sous la relève de 30 min du CDN. */
export const POLLEN_TTL_MS = 25 * 60_000;

export interface PollenState { pollen: SourceSlot<PollenResponse> }

const TAXA: ReadonlySet<PollenTaxon> = new Set<PollenTaxon>(['aulne', 'bouleau', 'olivier', 'graminees', 'armoise', 'ambroisie']);
const isTaxonLevel = (t: Record<string, unknown>): boolean => isOneOf(t.taxon, TAXA) && isNum(t.code);
const isDeptDay = (d: Record<string, unknown>): boolean => isStr(d.date) && numbersIn(d, ['maxCode', 'communes', 'high']) && isBool(d.alerte)
  && listOf(d.taxa, isTaxonLevel);
const isDept = (d: Record<string, unknown>): boolean => isStr(d.code) && isStr(d.name) && listOf(d.days, isDeptDay);

export function isPollenResponse(v: unknown): v is PollenResponse {
  if (!isRecord(v) || !isStrOrNull(v.readAt) || !isStrOrNull(v.updatedAt) || !isStringArray(v.days) || !isStringArray(v.sources) || !isStringArray(v.errors)) {
    return false;
  }
  return listOf(v.departments, isDept);
}

export async function fetchPollen(previous: PollenState | null, now: number = Date.now()): Promise<PollenState> {
  return { pollen: await loadSlot(POLLEN_URL, POLLEN_TTL_MS, previous?.pollen, now, isPollenResponse, 'Atmo France, pollens') };
}

export function mergePollen(current: PollenState | null, incoming: PollenState): PollenState {
  return { pollen: mergeSlot(current?.pollen, incoming.pollen) };
}

/** Département et jour d'un état, pour la carte et la vue (null : jour ou département non publié). */
export function pollenDeptDay(dept: PollenDept | undefined, date: string | undefined): PollenDeptDay | null {
  if (!dept || !date) return null;
  return dept.days.find((d) => d.date === date) ?? null;
}

/** Panneau des sources (« Pollens, Atmo France ») : retard au-delà de 36 h après la mise à jour. */
export function pollenStatus(state: PollenState, now: number): EnvironmentStatus {
  return environmentSlotStatus(state.pollen, 'pollen', state.pollen.data?.updatedAt ?? null, now);
}
