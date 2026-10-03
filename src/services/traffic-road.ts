// src/services/traffic-road.ts : lecture client du trafic routier (spec 2026-10-03 trafics § 2.1, § 2.2, § 2.6) : réseau national
// des DIR et congestion urbaine TomTom, collectés par le serveur (T4) ; plus aucun budget ni cache dans le navigateur. Le clic sur un
// bouchon d'agglomération lit la vitesse du tronçon (/api/traffic/flow, budget tenu par le serveur).
import type { RoadNationalResponse, RoadUrbanResponse } from '../types/index.ts';
import { isRecord, isStringArray } from './health-surveillance.ts';
import {
  isBool, isNum, isNumOrNull, isPoint, isStr, isStrOrNull, listOf, loadSlot, mergeSlot, numbersIn, trafficSlotStatus, type SourceSlot, type TrafficStatus,
} from './traffic-source.ts';

export const ROAD_NATIONAL_URL = '/api/traffic/road-national';
export const ROAD_URBAN_URL = '/api/traffic/road-urban';
/** Cache client : 4 min, sous la relève routière de 5 min (App.ts). */
export const ROAD_TTL_MS = 4 * 60_000;

export interface RoadTrafficState { national: SourceSlot<RoadNationalResponse>; urban: SourceSlot<RoadUrbanResponse> }

const ROAD_KINDS: ReadonlySet<string> = new Set(['accident', 'obstruction', 'queue', 'weather', 'closure', 'lane', 'works', 'info']);
const SECTION_STATUS: ReadonlySet<string> = new Set(['freeFlow', 'heavy', 'congested', 'unknown']);

const isRoadEvent = (e: Record<string, unknown>): boolean => isStr(e.id) && isStr(e.kind) && ROAD_KINDS.has(e.kind) && isStr(e.subtype)
  && isStr(e.label) && isStrOrNull(e.road) && isStrOrNull(e.place) && isStrOrNull(e.direction) && isStr(e.dir) && isStr(e.start)
  && isStrOrNull(e.end) && isBool(e.safety) && isBool(e.planned) && isBool(e.longTerm) && isNumOrNull(e.lat) && isNumOrNull(e.lon)
  && isStr(e.detail);
const isDirCount = (e: Record<string, unknown>): boolean => isStr(e.dir) && isNum(e.incidents);
const isSpeedStation = (e: Record<string, unknown>): boolean => isStr(e.id) && isStr(e.dir) && isStrOrNull(e.road) && isNum(e.speed)
  && isNumOrNull(e.flow) && isNumOrNull(e.lat) && isNumOrNull(e.lon);
const isOfficialAgglo = (e: Record<string, unknown>): boolean => isStr(e.network) && isStr(e.label) && isStr(e.at)
  && numbersIn(e, ['sections', 'freeFlow', 'heavy', 'congested', 'unknown']) && isNumOrNull(e.congestedPct);
const isSection = (e: Record<string, unknown>): boolean => isStr(e.id) && isStr(e.network) && isStr(e.status) && SECTION_STATUS.has(e.status)
  && Array.isArray(e.path) && e.path.every(isPoint);
const isConcededJam = (e: Record<string, unknown>): boolean => isStr(e.motorway) && isNumOrNull(e.lengthKm) && isStrOrNull(e.from)
  && isStrOrNull(e.to) && isStrOrNull(e.operator) && (e.importance === 1 || e.importance === 2 || e.importance === 3) && isStr(e.text);

export function isRoadNationalResponse(v: unknown): v is RoadNationalResponse {
  if (!isRecord(v) || !isStrOrNull(v.publishedAt) || !isStringArray(v.errors)) return false;
  const { counts, speeds, conceded } = v;
  return listOf(v.events, isRoadEvent) && listOf(v.longTerm, isRoadEvent) && listOf(v.byDir, isDirCount)
    && numbersIn(counts, ['incidents', 'accidents', 'closures', 'obstructions', 'weather', 'works'])
    && isRecord(speeds) && isStrOrNull(speeds.at) && numbersIn(speeds, ['stations', 'under50']) && isNumOrNull(speeds.median)
    && listOf(speeds.slowest, isSpeedStation)
    && listOf(v.agglos, isOfficialAgglo) && listOf(v.sections, isSection)
    && isRecord(conceded) && isStrOrNull(conceded.at) && listOf(conceded.jams, isConcededJam);
}

const isUrbanJam = (e: Record<string, unknown>): boolean => isStrOrNull(e.road) && isStrOrNull(e.from) && isStrOrNull(e.to)
  && numbersIn(e, ['lengthKm', 'delayMin', 'lat', 'lon']) && (e.magnitude === 1 || e.magnitude === 2 || e.magnitude === 3)
  && isStrOrNull(e.start) && Array.isArray(e.path) && e.path.every(isPoint);
const isUrbanAgglo = (e: Record<string, unknown>): boolean => isStr(e.name) && numbersIn(e, ['jams', 'jamKm', 'delayMin']) && isStr(e.collectedAt)
  && (e.longest === null || (isRecord(e.longest) && isUrbanJam(e.longest)));

export function isRoadUrbanResponse(v: unknown): v is RoadUrbanResponse {
  return isRecord(v) && isStrOrNull(v.collectedAt) && listOf(v.agglos, isUrbanAgglo) && listOf(v.jams, isUrbanJam)
    && numbersIn(v.quota, ['callsToday', 'limit']) && isStringArray(v.errors);
}

/** Ne rejette jamais : une route en échec porte `error` et garde ses dernières données. */
export async function fetchRoadTraffic(previous: RoadTrafficState | null, now: number = Date.now()): Promise<RoadTrafficState> {
  const [national, urban] = await Promise.all([
    loadSlot(ROAD_NATIONAL_URL, ROAD_TTL_MS, previous?.national, now, isRoadNationalResponse, 'des DIR'),
    loadSlot(ROAD_URBAN_URL, ROAD_TTL_MS, previous?.urban, now, isRoadUrbanResponse, 'TomTom'),
  ]);
  return { national, urban };
}

/** Écriture d'une lecture dans l'état courant (fusion à l'écriture, S3) : une route en échec garde ses données actuelles. */
export function mergeRoadTraffic(current: RoadTrafficState | null, incoming: RoadTrafficState): RoadTrafficState {
  return { national: mergeSlot(current?.national, incoming.national), urban: mergeSlot(current?.urban, incoming.urban) };
}

/** Panneau des sources : publication DIR (« Trafic ») ou collecte TomTom (« TomTom agglomérations »). */
export function roadStatus(state: RoadTrafficState, key: 'national' | 'urban', now: number): TrafficStatus {
  return key === 'national'
    ? trafficSlotStatus(state.national, 'dir', state.national.data?.publishedAt ?? null, now)
    : trafficSlotStatus(state.urban, 'tomtom', state.urban.data?.collectedAt ?? null, now);
}

// ─── Vitesse d'un tronçon (clic sur un bouchon d'agglomération) ───

export interface TrafficFlowSegment {
  currentSpeed: number; freeFlowSpeed: number; currentTravelTime: number; freeFlowTravelTime: number;
  confidence: number; roadClosure: boolean; frc?: string;
}

const FLOW_TTL_MS = 15 * 60_000;
const flowCache = new Map<string, { data: TrafficFlowSegment; at: number }>();

/** Flux TomTom d'un tronçon (/api/traffic/flow) ; null en échec. Gardé 15 min ; aucun budget dans le navigateur (T4). */
export async function fetchTrafficFlowSegment(lat: number, lon: number, zoom = 10, now: number = Date.now()): Promise<TrafficFlowSegment | null> {
  const safeZoom = Math.max(0, Math.min(22, Math.round(zoom)));
  const key = `${lat.toFixed(4)},${lon.toFixed(4)},${safeZoom}`;
  const hit = flowCache.get(key);
  if (hit && now - hit.at < FLOW_TTL_MS) return hit.data;
  try {
    const resp = await fetch(`/api/traffic/flow?point=${lat},${lon}&zoom=${safeZoom}`, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) return null;
    const json: unknown = await resp.json();
    if (!isRecord(json) || json.detailedError !== undefined) return null;
    // L'API TomTom v4 imbrique les valeurs sous `flowSegmentData`.
    const p = isRecord(json.flowSegmentData) ? json.flowSegmentData : json;
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const currentSpeed = num(p.currentSpeed);
    const freeFlowSpeed = num(p.freeFlowSpeed);
    const currentTravelTime = num(p.currentTravelTime);
    const freeFlowTravelTime = num(p.freeFlowTravelTime);
    const confidence = num(p.confidence);
    // Un champ absent ou illisible : tronçon indisponible (n.d.), jamais un zéro inventé ni mis en cache.
    if (currentSpeed === null || freeFlowSpeed === null || currentTravelTime === null || freeFlowTravelTime === null || confidence === null) {
      return null;
    }
    const segment: TrafficFlowSegment = {
      currentSpeed, freeFlowSpeed, currentTravelTime, freeFlowTravelTime, confidence, roadClosure: p.roadClosure === true,
      ...(typeof p.frc === 'string' ? { frc: p.frc } : {}),
    };
    flowCache.set(key, { data: segment, at: now });
    return segment;
  } catch {
    return null;
  }
}

/** Tests seulement. */
export function resetTrafficFlowCache(): void {
  flowCache.clear();
}

/** Clés du budget et du cache TomTom par navigateur, retirés (spec § 2.6). */
export const LEGACY_TOMTOM_KEYS = ['fm-tomtom-traffic-budget', 'fm-tomtom-traffic-cache'] as const;

/** Efface les anciennes clés TomTom du navigateur ; un stockage refusé ou absent est ignoré. */
export function clearLegacyTomTomStorage(storage: Pick<Storage, 'removeItem'> | null): void {
  if (!storage) return;
  for (const key of LEGACY_TOMTOM_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      // Stockage refusé : rien à effacer.
    }
  }
}
