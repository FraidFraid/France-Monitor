// src/services/traffic-air.ts : lecture client de l'aperçu aérien du panneau (spec 2026-10-03 trafics § 2.3) : collecte OpenSky du
// serveur (T4), urgences et journal, aéroports, volume, trajectoires. La carte garde /api/traffic/air (air-traffic.ts, 12 s).
import type { AirOverviewResponse } from '../types/index.ts';
import { isRecord, isStringArray } from './health-surveillance.ts';
import { isTrafficDataLate } from './traffic-levels.ts';
import { dataMs, loadSlot, trafficSlotStatus, type SourceSlot, type TrafficStatus } from './traffic-source.ts';

export const AIR_OVERVIEW_URL = '/api/traffic/air-overview';
/** Cache client : 90 s, sous la relève du panneau aérien de 2 min (App.ts). */
export const AIR_OVERVIEW_TTL_MS = 90_000;

export interface AirOverviewState { overview: SourceSlot<AirOverviewResponse> }

export function isAirOverviewResponse(v: unknown): v is AirOverviewResponse {
  return isRecord(v) && (v.at === null || typeof v.at === 'string') && typeof v.airborneZone === 'number'
    && typeof v.airborneFrance === 'number' && typeof v.onGround === 'number' && Array.isArray(v.emergencies)
    && Array.isArray(v.emergencyLog) && Array.isArray(v.airports) && isRecord(v.volume) && Array.isArray(v.volume.samples)
    && Array.isArray(v.volume.sameHourPrevDays) && Array.isArray(v.anomalies) && isRecord(v.credits) && isStringArray(v.errors)
    && v.airports.every((a: unknown) => isRecord(a) && typeof a.icao === 'string' && typeof a.lat === 'number' && typeof a.lon === 'number'
      && (a.departures === undefined || a.departures === null || typeof a.departures === 'number')
      && (a.departuresWindow === undefined || a.departuresWindow === null || isRecord(a.departuresWindow)));
}

/** Ne rejette jamais. */
export async function fetchAirOverview(previous: AirOverviewState | null, now: number = Date.now()): Promise<AirOverviewState> {
  return { overview: await loadSlot(AIR_OVERVIEW_URL, AIR_OVERVIEW_TTL_MS, previous?.overview, now, isAirOverviewResponse) };
}

/** Panneau des sources (« Trafic aérien ») : date de l'état OpenSky. */
export function airStatus(state: AirOverviewState, now: number): TrafficStatus {
  return trafficSlotStatus(state.overview, 'opensky', state.overview.data?.at ?? null, now);
}

/**
 * Fin de la fenêtre des départs (derniers départs mémorisés par le serveur) ; null quand aucun aéroport n'a de départs relevés
 * (en développement, les départs sont coupés hors AIR_DEV_DEPARTURES=1) : « départs non relevés », jamais une panne de la source.
 */
export function airDeparturesEnd(data: AirOverviewResponse | null): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const a of data?.airports ?? []) {
    const end = a.departures !== null && a.departures !== undefined ? a.departuresWindow?.end ?? null : null;
    const ms = dataMs(end);
    if (end !== null && ms !== null && ms > bestMs) { best = end; bestMs = ms; }
  }
  return best;
}

/** Départs relevés mais en retard (amendement 2 : 300 min après la fin de leur fenêtre, source `opensky-departures`) ; false sans départs. */
export function airDeparturesLate(data: AirOverviewResponse | null, now: number): boolean {
  const end = airDeparturesEnd(data);
  return end !== null && isTrafficDataLate('opensky-departures', end, now);
}
