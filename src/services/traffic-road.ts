// src/services/traffic-road.ts : lecture client du trafic routier (spec 2026-10-03 trafics § 2.1, § 2.2, § 2.6) : réseau national
// des DIR et congestion urbaine TomTom, collectés par le serveur (T4) ; plus aucun budget ni cache dans le navigateur. Le clic sur un
// bouchon d'agglomération lit la vitesse du tronçon (/api/traffic/flow, budget tenu par le serveur).
import type { RoadNationalResponse, RoadUrbanResponse } from '../types/index.ts';
import { isRecord, isStringArray } from './health-surveillance.ts';
import { loadSlot, trafficSlotStatus, type SourceSlot, type TrafficStatus } from './traffic-source.ts';

export const ROAD_NATIONAL_URL = '/api/traffic/road-national';
export const ROAD_URBAN_URL = '/api/traffic/road-urban';
/** Cache client : 4 min, sous la relève routière de 5 min (App.ts). */
export const ROAD_TTL_MS = 4 * 60_000;

export interface RoadTrafficState { national: SourceSlot<RoadNationalResponse>; urban: SourceSlot<RoadUrbanResponse> }

const isDateOrNull = (v: unknown): boolean => v === null || typeof v === 'string';

export function isRoadNationalResponse(v: unknown): v is RoadNationalResponse {
  if (!isRecord(v) || !isDateOrNull(v.publishedAt) || !Array.isArray(v.events) || !Array.isArray(v.longTerm) || !Array.isArray(v.byDir)
    || !Array.isArray(v.agglos) || !Array.isArray(v.sections) || !isStringArray(v.errors)) return false;
  const { counts, speeds, conceded } = v;
  return isRecord(counts) && typeof counts.incidents === 'number' && typeof counts.accidents === 'number'
    && isRecord(speeds) && Array.isArray(speeds.slowest) && isRecord(conceded) && Array.isArray(conceded.jams)
    && v.events.every((e: unknown) => isRecord(e) && typeof e.id === 'string' && typeof e.kind === 'string' && typeof e.label === 'string'
      && typeof e.start === 'string');
}

export function isRoadUrbanResponse(v: unknown): v is RoadUrbanResponse {
  return isRecord(v) && isDateOrNull(v.collectedAt) && Array.isArray(v.agglos) && Array.isArray(v.jams) && isRecord(v.quota)
    && isStringArray(v.errors) && v.agglos.every((a: unknown) => isRecord(a) && typeof a.name === 'string' && typeof a.jamKm === 'number');
}

/** Ne rejette jamais : une route en échec porte `error` et garde ses dernières données. */
export async function fetchRoadTraffic(previous: RoadTrafficState | null, now: number = Date.now()): Promise<RoadTrafficState> {
  const [national, urban] = await Promise.all([
    loadSlot(ROAD_NATIONAL_URL, ROAD_TTL_MS, previous?.national, now, isRoadNationalResponse),
    loadSlot(ROAD_URBAN_URL, ROAD_TTL_MS, previous?.urban, now, isRoadUrbanResponse),
  ]);
  return { national, urban };
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
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
    const segment: TrafficFlowSegment = {
      currentSpeed: num(p.currentSpeed), freeFlowSpeed: num(p.freeFlowSpeed), currentTravelTime: num(p.currentTravelTime),
      freeFlowTravelTime: num(p.freeFlowTravelTime), confidence: num(p.confidence), roadClosure: p.roadClosure === true,
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
