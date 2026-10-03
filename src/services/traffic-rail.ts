// src/services/traffic-rail.ts : lecture client du réseau ferroviaire (spec 2026-10-03 trafics § 2.4) : perturbations SNCF agrégées
// par axe et par région, détail par train, situations SIRI SX ; collectés par le serveur.
import type { RailOverviewResponse, RailSituationsResponse } from '../types/index.ts';
import { isRecord, isStringArray } from './health-surveillance.ts';
import {
  isNum, isNumOrNull, isStr, isStrOrNull, listOf, loadSlot, mergeSlot, numbersIn, trafficSlotStatus, type SourceSlot, type TrafficStatus,
} from './traffic-source.ts';

export const RAIL_OVERVIEW_URL = '/api/transport/rail-overview';
export const RAIL_SITUATIONS_URL = '/api/transport/rail-situations';
/** Cache client : 4 min, sous la relève ferroviaire de 5 min (App.ts). */
export const RAIL_TTL_MS = 4 * 60_000;

export interface RailTrafficState { overview: SourceSlot<RailOverviewResponse>; situations: SourceSlot<RailSituationsResponse> }

const AXES: ReadonlySet<string> = new Set(['sud-est', 'atlantique', 'nord', 'est', 'intercites-bercy', 'normandie', 'province']);
const EFFECTS: ReadonlySet<string> = new Set(['retard', 'supprime', 'service-reduit', 'detour', 'modifie', 'ajoute']);
const CAUSES: ReadonlySet<string> = new Set(['intemperies', 'passage-a-niveau', 'obstacle', 'panne-installation', 'panne-train', 'malaise',
  'forces-ordre', 'travaux', 'autre']);

/** Groupe d'axe (7, ou 8 avec « Non rattaché ») ou de région : la longueur de la liste n'est jamais vérifiée. */
const isGroup = (g: Record<string, unknown>): boolean => isStr(g.key) && isStr(g.label)
  && numbersIn(g, ['trains', 'cancelled', 'reduced', 'detour']) && isNumOrNull(g.avgDelayMin) && isNumOrNull(g.maxDelayMin);
const isStop = (s: Record<string, unknown>): boolean => isStr(s.name) && numbersIn(s, ['lat', 'lon']) && isNumOrNull(s.delayMin);
const isTrain = (t: Record<string, unknown>): boolean => isStr(t.id) && isStr(t.number) && isStr(t.kind)
  && (t.axis === null || (isStr(t.axis) && AXES.has(t.axis))) && isStrOrNull(t.region) && isStr(t.origin) && isStr(t.destination)
  && isStr(t.effect) && EFFECTS.has(t.effect) && isNumOrNull(t.delayMin) && (t.status === 'en-cours' || t.status === 'a-venir')
  && isStr(t.updatedAt) && listOf(t.stops, isStop);
const isSituation = (s: Record<string, unknown>): boolean => isStr(s.id) && isStr(s.title) && isStrOrNull(s.cause) && isStr(s.causeKind)
  && CAUSES.has(s.causeKind) && isStr(s.scope) && isStr(s.start) && isStrOrNull(s.end) && isNum(s.trains);

export function isRailOverviewResponse(v: unknown): v is RailOverviewResponse {
  return isRecord(v) && isStrOrNull(v.updatedAt) && numbersIn(v.longDistance, ['active', 'delayed15'])
    && listOf(v.axes, isGroup) && listOf(v.regions, isGroup) && listOf(v.topDelays, isTrain) && listOf(v.trains, isTrain)
    && isStringArray(v.errors);
}

export function isRailSituationsResponse(v: unknown): v is RailSituationsResponse {
  return isRecord(v) && isStrOrNull(v.at) && listOf(v.situations, isSituation) && isStringArray(v.errors);
}

/** Ne rejette jamais : chaque route porte son état. */
export async function fetchRailTraffic(previous: RailTrafficState | null, now: number = Date.now()): Promise<RailTrafficState> {
  const [overview, situations] = await Promise.all([
    loadSlot(RAIL_OVERVIEW_URL, RAIL_TTL_MS, previous?.overview, now, isRailOverviewResponse, 'SNCF'),
    loadSlot(RAIL_SITUATIONS_URL, RAIL_TTL_MS, previous?.situations, now, isRailSituationsResponse, 'SIRI SX'),
  ]);
  return { overview, situations };
}

/** Écriture d'une lecture dans l'état courant (fusion à l'écriture, S3) : une route en échec garde ses données actuelles. */
export function mergeRailTraffic(current: RailTrafficState | null, incoming: RailTrafficState): RailTrafficState {
  return { overview: mergeSlot(current?.overview, incoming.overview), situations: mergeSlot(current?.situations, incoming.situations) };
}

/** Panneau des sources : « SNCF » (dernière mise à jour des perturbations) ou « SIRI SX » (réponse du flux). */
export function railStatus(state: RailTrafficState, key: 'overview' | 'situations', now: number): TrafficStatus {
  return key === 'overview'
    ? trafficSlotStatus(state.overview, 'sncf', state.overview.data?.updatedAt ?? null, now)
    : trafficSlotStatus(state.situations, 'siri-sx', state.situations.data?.at ?? null, now);
}
