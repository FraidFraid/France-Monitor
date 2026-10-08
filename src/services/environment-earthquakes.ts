// src/services/environment-earthquakes.ts : lecture client du panneau Séismes (spec 2026-10-04 environnement § 3.3) : 7 jours, France et
// 20 km autour (BCSF-RéNaSS, EMSC en repli). Lu au démarrage et relevé sans arrêt (situation sismique).
import type { EarthquakesResponse, Quake } from '../types/index.ts';
import { isRecord, isStringArray } from './health-surveillance.ts';
import {
  environmentSlotStatus, isBool, isNum, isNumOrNull, isOneOf, isStr, isStrOrNull, listOf, loadSlot, mergeSlot, numbersIn, type EnvironmentStatus, type SourceSlot,
} from './environment-source.ts';

export const EARTHQUAKES_URL = '/api/environment/earthquakes';
/** Cache client : 8 min, sous la relève de 10 min. */
export const EARTHQUAKES_TTL_MS = 8 * 60_000;

export interface EarthquakesState { quakes: SourceSlot<EarthquakesResponse> }

const SOURCES: ReadonlySet<Quake['source']> = new Set<Quake['source']>(['BCSF-RéNaSS', 'EMSC']);
const STATUSES: ReadonlySet<Quake['status']> = new Set<Quake['status']>(['automatique', 'revu']);
const isQuake = (q: Record<string, unknown>): boolean => isStr(q.id) && isStr(q.at) && numbersIn(q, ['lat', 'lon', 'magnitude', 'distanceKm'])
  && isNumOrNull(q.depthKm) && isStrOrNull(q.magType) && isStrOrNull(q.type) && isStr(q.description) && isOneOf(q.status, STATUSES)
  && isStrOrNull(q.url) && isStrOrNull(q.dept) && isBool(q.inFrance) && isOneOf(q.source, SOURCES);

export function isEarthquakesResponse(v: unknown): v is EarthquakesResponse {
  return isRecord(v) && isStrOrNull(v.readAt) && (v.source === null || isOneOf(v.source, SOURCES)) && listOf(v.quakes, isQuake)
    && isNum(v.nonSeismic) && isStringArray(v.errors);
}

export async function fetchEarthquakes(previous: EarthquakesState | null, now: number = Date.now()): Promise<EarthquakesState> {
  return { quakes: await loadSlot(EARTHQUAKES_URL, EARTHQUAKES_TTL_MS, previous?.quakes, now, isEarthquakesResponse, 'BCSF-RéNaSS') };
}

export function mergeEarthquakes(current: EarthquakesState | null, incoming: EarthquakesState): EarthquakesState {
  return { quakes: mergeSlot(current?.quakes, incoming.quakes) };
}

/** Panneau des sources (« BCSF-RéNaSS ») : relevé du serveur, retard au-delà de 30 min ; repli EMSC : l'erreur nomme la panne. */
export function earthquakesStatus(state: EarthquakesState, now: number): EnvironmentStatus {
  return environmentSlotStatus(state.quakes, 'bcsf', state.quakes.data?.readAt ?? null, now);
}
