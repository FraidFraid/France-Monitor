// src/services/traffic-rail.ts : lecture client du réseau ferroviaire (spec 2026-10-03 trafics § 2.4) : perturbations SNCF agrégées
// par axe et par région, détail par train, situations SIRI SX ; collectés par le serveur.
import type { RailOverviewResponse, RailSituationsResponse } from '../types/index.ts';
import { isRecord, isStringArray } from './health-surveillance.ts';
import { loadSlot, trafficSlotStatus, type SourceSlot, type TrafficStatus } from './traffic-source.ts';

export const RAIL_OVERVIEW_URL = '/api/transport/rail-overview';
export const RAIL_SITUATIONS_URL = '/api/transport/rail-situations';
/** Cache client : 4 min, sous la relève ferroviaire de 5 min (App.ts). */
export const RAIL_TTL_MS = 4 * 60_000;

export interface RailTrafficState { overview: SourceSlot<RailOverviewResponse>; situations: SourceSlot<RailSituationsResponse> }

/** Groupes d'axes (7, ou 8 avec « Non rattaché ») et de régions : la longueur n'est jamais vérifiée. */
function isGroupList(v: unknown): boolean {
  return Array.isArray(v) && v.every((g: unknown) => isRecord(g) && typeof g.key === 'string' && typeof g.label === 'string');
}

export function isRailOverviewResponse(v: unknown): v is RailOverviewResponse {
  return isRecord(v) && (v.updatedAt === null || typeof v.updatedAt === 'string') && isRecord(v.longDistance)
    && typeof v.longDistance.active === 'number' && typeof v.longDistance.delayed15 === 'number' && isGroupList(v.axes)
    && isGroupList(v.regions) && Array.isArray(v.topDelays) && Array.isArray(v.trains) && isStringArray(v.errors);
}

export function isRailSituationsResponse(v: unknown): v is RailSituationsResponse {
  return isRecord(v) && (v.at === null || typeof v.at === 'string') && Array.isArray(v.situations) && isStringArray(v.errors);
}

/** Ne rejette jamais : chaque route porte son état. */
export async function fetchRailTraffic(previous: RailTrafficState | null, now: number = Date.now()): Promise<RailTrafficState> {
  const [overview, situations] = await Promise.all([
    loadSlot(RAIL_OVERVIEW_URL, RAIL_TTL_MS, previous?.overview, now, isRailOverviewResponse),
    loadSlot(RAIL_SITUATIONS_URL, RAIL_TTL_MS, previous?.situations, now, isRailSituationsResponse),
  ]);
  return { overview, situations };
}

/** Panneau des sources : « SNCF » (dernière mise à jour des perturbations) ou « SIRI SX » (réponse du flux). */
export function railStatus(state: RailTrafficState, key: 'overview' | 'situations', now: number): TrafficStatus {
  return key === 'overview'
    ? trafficSlotStatus(state.overview, 'sncf', state.overview.data?.updatedAt ?? null, now)
    : trafficSlotStatus(state.situations, 'siri-sx', state.situations.data?.at ?? null, now);
}
