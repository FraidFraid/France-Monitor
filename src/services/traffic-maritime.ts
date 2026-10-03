// src/services/traffic-maritime.ts : lecture client de l'instantané maritime du relais AIS (spec 2026-10-03 trafics § 2.5) : navires
// dans les eaux françaises, zones, ports, signalements croisés (T3), navires sensibles. La carte garde le WebSocket du relais.
import type { MaritimeSnapshot } from '../types/index.ts';
import { isRecord, isStringArray } from './health-surveillance.ts';
import {
  isBool, isNum, isStr, isStrOrNull, listOf, loadSlot, numbersIn, trafficSlotStatus, type SourceSlot, type TrafficStatus,
} from './traffic-source.ts';

/** Cache client : 90 s, sous la relève de l'instantané de 2 min (App.ts). */
export const MARITIME_SNAPSHOT_TTL_MS = 90_000;

/**
 * Instantané servi par le relais (partie A, tâche 8) : « wss://hôte/relay » → « https://hôte/relay/snapshot » (Caddy, production),
 * « ws://localhost:8090 » → « http://localhost:8090/snapshot » ; null sans relais lisible.
 */
export function maritimeSnapshotUrl(relayUrl: string | null): string | null {
  if (!relayUrl) return null;
  let url: URL;
  try {
    url = new URL(relayUrl);
  } catch {
    return null;
  }
  const protocol = url.protocol === 'wss:' ? 'https:' : url.protocol === 'ws:' ? 'http:' : url.protocol;
  return protocol === 'https:' || protocol === 'http:' ? `${protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}/snapshot` : null;
}

export interface MaritimeState { snapshot: SourceSlot<MaritimeSnapshot> }

/** Les onze types du relais, tous présents, tous des nombres (leur somme est `vessels`). */
const BY_TYPE_KEYS = ['cargo', 'petrolier', 'passagers', 'peche', 'remorqueur', 'plaisance', 'grande-vitesse', 'service', 'militaire', 'autre', 'inconnu'] as const;
const ZONES: ReadonlySet<string> = new Set(['pas-de-calais', 'manche', 'atlantique', 'mediterranee']);

const isByType = (b: unknown): boolean => isRecord(b) && Object.keys(b).length === BY_TYPE_KEYS.length && numbersIn(b, BY_TYPE_KEYS);
const isZone = (z: Record<string, unknown>): boolean => isStr(z.zone) && ZONES.has(z.zone) && isStr(z.label)
  && numbersIn(z, ['vessels', 'classA', 'classB', 'atAnchor', 'moored', 'underWay', 'restricted', 'fishing']);
const isPort = (p: Record<string, unknown>): boolean => isStr(p.port) && numbersIn(p, ['vessels', 'atAnchor', 'moored', 'underWay']);
const isSignal = (s: Record<string, unknown>): boolean => isStr(s.mmsi) && isStrOrNull(s.name) && isStrOrNull(s.type) && isNum(s.status)
  && isStr(s.statusLabel) && numbersIn(s, ['lat', 'lon']) && isStr(s.since) && isBool(s.confirmed) && isBool(s.sensitive);
const isSensitiveVessel = (s: Record<string, unknown>): boolean => isStr(s.mmsi) && isStrOrNull(s.name) && (s.type === 'petrolier' || s.type === 'passagers')
  && numbersIn(s, ['lat', 'lon', 'distanceNm']);

export function isMaritimeSnapshot(v: unknown): v is MaritimeSnapshot {
  if (!isRecord(v) || !isStrOrNull(v.at) || !isStrOrNull(v.lastMessageAt) || !numbersIn(v, ['vessels', 'frenchFlag', 'typedShare'])
    || !isStringArray(v.errors)) return false;
  const { info, sensitive } = v;
  return isByType(v.byType) && listOf(v.zones, isZone) && listOf(v.ports, isPort) && listOf(v.signals, isSignal)
    && numbersIn(info, ['restricted', 'draught', 'fishing'])
    && isRecord(sensitive) && numbersIn(sensitive, ['tankers', 'passenger']) && listOf(sensitive.list, isSensitiveVessel);
}

/** Ne rejette jamais ; sans relais configuré : « relais AIS non configuré », données précédentes gardées. */
export async function fetchMaritimeSnapshot(
  previous: MaritimeState | null, relayUrl: string | null, now: number = Date.now(),
): Promise<MaritimeState> {
  const url = maritimeSnapshotUrl(relayUrl);
  if (url === null) {
    return { snapshot: { data: previous?.snapshot.data ?? null, error: 'relais AIS non configuré', fetchedAt: previous?.snapshot.fetchedAt ?? null } };
  }
  return { snapshot: await loadSlot(url, MARITIME_SNAPSHOT_TTL_MS, previous?.snapshot, now, isMaritimeSnapshot, 'AIS') };
}

/** Panneau des sources (« AIS instantané ») : date du dernier message AIS reçu par le relais. */
export function maritimeStatus(state: MaritimeState, now: number): TrafficStatus {
  return trafficSlotStatus(state.snapshot, 'ais', state.snapshot.data?.lastMessageAt ?? null, now);
}
