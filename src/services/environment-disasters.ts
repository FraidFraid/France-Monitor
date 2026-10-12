// src/services/environment-disasters.ts : lecture client de la couche Catastrophes (GDACS) (spec 2026-10-12 GDACS) : territoire
// français (tous niveaux) et monde (orange, rouge) sur 7 jours. Lu au démarrage et relevé sans arrêt (situations outre-mer).
import type { DisastersResponse, EmsResponse } from '../types/index.ts';
import { isRecord, isStringArray } from './health-surveillance.ts';
import {
  environmentSlotStatus, isBool, isNumOrNull, isOneOf, isStr, isStrOrNull, listOf, loadSlot, mergeSlot, numbersIn, type EnvironmentStatus, type SourceSlot,
} from './environment-source.ts';

export const DISASTERS_URL = '/api/environment/disasters';
/** Cache client : 8 min, sous la relève de 10 min. */
export const DISASTERS_TTL_MS = 8 * 60_000;

export interface DisastersState { disasters: SourceSlot<DisastersResponse>; ems: SourceSlot<EmsResponse> }

export const EMS_URL = '/api/environment/ems';
/** Cache client : 8 min, comme GDACS (le serveur relit la liste toutes les 30 min). */
export const EMS_TTL_MS = 8 * 60_000;

const EMS_CATEGORIES: ReadonlySet<string> = new Set(['feu', 'inondation', 'tempete', 'seisme', 'mouvement', 'volcan', 'industriel', 'transport', 'autre']);
const isRing = (v: unknown): boolean => Array.isArray(v) && v.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n)));
const isZone = (z: Record<string, unknown>): boolean => isStr(z.name) && isRing(z.ring);
const isActivation = (a: Record<string, unknown>): boolean => isStr(a.code) && isOneOf(a.category, EMS_CATEGORIES) && isStr(a.name)
  && isStr(a.place) && isStr(a.territory) && isStr(a.activationTime) && isStrOrNull(a.eventTime) && isBool(a.closed)
  && isStrOrNull(a.gdacsId) && typeof a.products === 'number' && isStr(a.url) && isStrOrNull(a.activator) && isNumOrNull(a.population)
  && listOf(a.zones, isZone) && isNumOrNull(a.lon) && isNumOrNull(a.lat);

export function isEmsResponse(v: unknown): v is EmsResponse {
  return isRecord(v) && isStrOrNull(v.readAt) && listOf(v.active, isActivation) && listOf(v.recent, isActivation)
    && isRecord(v.elsewhere) && typeof v.elsewhere.count === 'number' && isStringArray(v.elsewhere.countries) && isStringArray(v.errors);
}

const TYPES: ReadonlySet<string> = new Set(['cyclone', 'seisme', 'inondation', 'volcan', 'secheresse', 'feu']);
const LEVELS: ReadonlySet<string> = new Set(['vert', 'orange', 'rouge']);
const isAlert = (a: Record<string, unknown>): boolean => isStr(a.id) && isOneOf(a.type, TYPES) && isOneOf(a.level, LEVELS) && isStr(a.name)
  && isStringArray(a.countries) && isStrOrNull(a.frenchTerritory) && numbersIn(a, ['lat', 'lon']) && isStr(a.from) && isStr(a.to)
  && isBool(a.current) && isStrOrNull(a.severity) && isStrOrNull(a.url);

export function isDisastersResponse(v: unknown): v is DisastersResponse {
  return isRecord(v) && isStrOrNull(v.readAt) && listOf(v.alerts, isAlert) && isStringArray(v.errors);
}

export async function fetchDisasters(previous: DisastersState | null, now: number = Date.now()): Promise<DisastersState> {
  const [disasters, ems] = await Promise.all([
    loadSlot(DISASTERS_URL, DISASTERS_TTL_MS, previous?.disasters, now, isDisastersResponse, 'GDACS'),
    loadSlot(EMS_URL, EMS_TTL_MS, previous?.ems, now, isEmsResponse, 'Copernicus EMS'),
  ]);
  return { disasters, ems };
}

export function mergeDisasters(current: DisastersState | null, incoming: DisastersState): DisastersState {
  return { disasters: mergeSlot(current?.disasters, incoming.disasters), ems: mergeSlot(current?.ems, incoming.ems) };
}

/** Panneau des sources (« GDACS ») : relevé du serveur, retard au-delà de 30 min ; un territoire en panne est nommé. */
export function disastersStatus(state: DisastersState, now: number): EnvironmentStatus {
  return environmentSlotStatus(state.disasters, 'gdacs', state.disasters.data?.readAt ?? null, now);
}

/** Panneau des sources (« Copernicus EMS ») : relevé du serveur, retard au-delà de 60 min ; un détail en panne est nommé. */
export function emsStatus(state: DisastersState, now: number): EnvironmentStatus {
  return environmentSlotStatus(state.ems, 'ems', state.ems.data?.readAt ?? null, now);
}
