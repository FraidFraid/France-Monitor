// src/services/traffic-air.ts : lecture client de l'aperçu aérien du panneau (spec 2026-10-03 trafics § 2.3) : collecte OpenSky du
// serveur (T4), urgences et journal, aéroports, volume, trajectoires. La carte garde /api/traffic/air (air-traffic.ts, 12 s).
import type { AirOverviewResponse } from '../types/index.ts';
import { isRecord, isStringArray } from './health-surveillance.ts';
import { isTrafficDataLate } from './traffic-levels.ts';
import {
  dataMs, isBool, isNum, isNumOrNull, isStr, isStrOrNull, listOf, loadSlot, mergeSlot, numbersIn, trafficSlotStatus, type SourceSlot, type TrafficStatus,
} from './traffic-source.ts';

export const AIR_OVERVIEW_URL = '/api/traffic/air-overview';
/** Cache client : 90 s, sous la relève du panneau aérien de 2 min (App.ts). */
export const AIR_OVERVIEW_TTL_MS = 90_000;

export interface AirOverviewState { overview: SourceSlot<AirOverviewResponse> }

const SQUAWKS: ReadonlySet<string> = new Set(['7500', '7600', '7700']);

const isEmergency = (e: Record<string, unknown>): boolean => isStr(e.icao24) && isStrOrNull(e.callsign) && isStr(e.squawk) && SQUAWKS.has(e.squawk)
  && numbersIn(e, ['lat', 'lon']) && isNumOrNull(e.altitudeM) && isStr(e.firstSeen) && isStr(e.lastSeen) && isBool(e.overFrance);
const isWindow = (w: unknown): boolean => w === undefined || w === null || (isRecord(w) && isStr(w.begin) && isStr(w.end));
const isBoard = (b: unknown): boolean => b === undefined || b === null || (isRecord(b) && numbersIn(b, ['delayed', 'cancelled']) && isStr(b.at));
/** Départs : absents ou null quand le serveur n'en a pas relevé (« départs non relevés »), jamais une panne. */
const isAirport = (a: Record<string, unknown>): boolean => isStr(a.icao) && isStr(a.iata) && isStr(a.name) && numbersIn(a, ['lat', 'lon', 'onGround', 'approaching'])
  && (a.departures === undefined || isNumOrNull(a.departures)) && isWindow(a.departuresWindow) && isBoard(a.board);
const isAnomaly = (a: Record<string, unknown>): boolean => isStrOrNull(a.callsign) && isStr(a.kind) && isStrOrNull(a.airport) && isStr(a.at);
const isSample = (a: Record<string, unknown>): boolean => isStr(a.at) && numbersIn(a, ['airborneZone', 'airborneFrance']);

export function isAirOverviewResponse(v: unknown): v is AirOverviewResponse {
  if (!isRecord(v) || !isStrOrNull(v.at) || !numbersIn(v, ['airborneZone', 'airborneFrance', 'onGround']) || !isStringArray(v.errors)) return false;
  const { volume, credits } = v;
  return listOf(v.emergencies, isEmergency) && listOf(v.emergencyLog, isEmergency) && listOf(v.airports, isAirport)
    && isRecord(volume) && listOf(volume.samples, isSample) && Array.isArray(volume.sameHourPrevDays) && volume.sameHourPrevDays.every(isNum)
    && listOf(v.anomalies, isAnomaly) && isRecord(credits) && isNumOrNull(credits.remaining);
}

/** Ne rejette jamais. */
export async function fetchAirOverview(previous: AirOverviewState | null, now: number = Date.now()): Promise<AirOverviewState> {
  return { overview: await loadSlot(AIR_OVERVIEW_URL, AIR_OVERVIEW_TTL_MS, previous?.overview, now, isAirOverviewResponse, 'OpenSky') };
}

/** Écriture d'une lecture dans l'état courant (fusion à l'écriture, S3) : un échec garde l'aperçu actuel et sa date. */
export function mergeAirOverview(current: AirOverviewState | null, incoming: AirOverviewState): AirOverviewState {
  return { overview: mergeSlot(current?.overview, incoming.overview) };
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
    const end = a.departures !== null && a.departures !== undefined && typeof a.departuresWindow?.end === 'string' ? a.departuresWindow.end : null;
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
