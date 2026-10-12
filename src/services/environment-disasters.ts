// src/services/environment-disasters.ts : lecture client de la couche Catastrophes (GDACS) (spec 2026-10-12 GDACS) : territoire
// français (tous niveaux) et monde (orange, rouge) sur 7 jours. Lu au démarrage et relevé sans arrêt (situations outre-mer).
import type { DisastersResponse } from '../types/index.ts';
import { isRecord, isStringArray } from './health-surveillance.ts';
import {
  environmentSlotStatus, isBool, isOneOf, isStr, isStrOrNull, listOf, loadSlot, mergeSlot, numbersIn, type EnvironmentStatus, type SourceSlot,
} from './environment-source.ts';

export const DISASTERS_URL = '/api/environment/disasters';
/** Cache client : 8 min, sous la relève de 10 min. */
export const DISASTERS_TTL_MS = 8 * 60_000;

export interface DisastersState { disasters: SourceSlot<DisastersResponse> }

const TYPES: ReadonlySet<string> = new Set(['cyclone', 'seisme', 'inondation', 'volcan', 'secheresse', 'feu']);
const LEVELS: ReadonlySet<string> = new Set(['vert', 'orange', 'rouge']);
const isAlert = (a: Record<string, unknown>): boolean => isStr(a.id) && isOneOf(a.type, TYPES) && isOneOf(a.level, LEVELS) && isStr(a.name)
  && isStringArray(a.countries) && isStrOrNull(a.frenchTerritory) && numbersIn(a, ['lat', 'lon']) && isStr(a.from) && isStr(a.to)
  && isBool(a.current) && isStrOrNull(a.severity) && isStrOrNull(a.url);

export function isDisastersResponse(v: unknown): v is DisastersResponse {
  return isRecord(v) && isStrOrNull(v.readAt) && listOf(v.alerts, isAlert) && isStringArray(v.errors);
}

export async function fetchDisasters(previous: DisastersState | null, now: number = Date.now()): Promise<DisastersState> {
  return { disasters: await loadSlot(DISASTERS_URL, DISASTERS_TTL_MS, previous?.disasters, now, isDisastersResponse, 'GDACS') };
}

export function mergeDisasters(current: DisastersState | null, incoming: DisastersState): DisastersState {
  return { disasters: mergeSlot(current?.disasters, incoming.disasters) };
}

/** Panneau des sources (« GDACS ») : relevé du serveur, retard au-delà de 30 min ; un territoire en panne est nommé. */
export function disastersStatus(state: DisastersState, now: number): EnvironmentStatus {
  return environmentSlotStatus(state.disasters, 'gdacs', state.disasters.data?.readAt ?? null, now);
}
