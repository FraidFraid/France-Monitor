// src/services/traffic-maritime.ts : lecture client de l'instantané maritime du relais AIS (spec 2026-10-03 trafics § 2.5) : navires
// dans les eaux françaises, zones, ports, signalements croisés (T3), navires sensibles. La carte garde le WebSocket du relais.
import type { MaritimeSnapshot } from '../types/index.ts';
import { isRecord, isStringArray } from './health-surveillance.ts';
import { loadSlot, trafficSlotStatus, type SourceSlot, type TrafficStatus } from './traffic-source.ts';

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

export function isMaritimeSnapshot(v: unknown): v is MaritimeSnapshot {
  if (!isRecord(v)) return false;
  const { info, sensitive } = v;
  return (v.at === null || typeof v.at === 'string') && (v.lastMessageAt === null || typeof v.lastMessageAt === 'string')
    && typeof v.vessels === 'number' && typeof v.frenchFlag === 'number' && typeof v.typedShare === 'number'
    && Array.isArray(v.zones) && Array.isArray(v.ports) && Array.isArray(v.signals) && isRecord(v.byType) && Object.values(v.byType).every((n) => typeof n === 'number') && isRecord(info) && typeof info.restricted === 'number'
    && isRecord(sensitive) && typeof sensitive.tankers === 'number' && typeof sensitive.passenger === 'number' && Array.isArray(sensitive.list)
    && isStringArray(v.errors);
}

/** Ne rejette jamais ; sans relais configuré : « relais AIS non configuré », données précédentes gardées. */
export async function fetchMaritimeSnapshot(
  previous: MaritimeState | null, relayUrl: string | null, now: number = Date.now(),
): Promise<MaritimeState> {
  const url = maritimeSnapshotUrl(relayUrl);
  if (url === null) {
    return { snapshot: { data: previous?.snapshot.data ?? null, error: 'relais AIS non configuré', fetchedAt: previous?.snapshot.fetchedAt ?? null } };
  }
  return { snapshot: await loadSlot(url, MARITIME_SNAPSHOT_TTL_MS, previous?.snapshot, now, isMaritimeSnapshot) };
}

/** Panneau des sources (« AIS instantané ») : date du dernier message AIS reçu par le relais. */
export function maritimeStatus(state: MaritimeState, now: number): TrafficStatus {
  return trafficSlotStatus(state.snapshot, 'ais', state.snapshot.data?.lastMessageAt ?? null, now);
}
