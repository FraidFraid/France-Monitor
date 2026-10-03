// src/services/traffic-source.ts : socle des services clients Trafics (spec 2026-10-03 trafics § 1, S1 à S3, T4). Lecture stricte
// partagée avec la santé (HTTP non 2xx, corps illisible ou forme inattendue = erreur), cache par URL sous la relève d'App.ts,
// jamais de rejet ; panneau des sources sur la date de la donnée et le retard propre à chaque source (isTrafficDataLate).
import type { DataSourceStatus } from '../types/index.ts';
import { readHealthJsonShared, type SourceSlot } from './health-surveillance.ts';
import { isTrafficDataLate, type TrafficSource } from './traffic-levels.ts';

export type { SourceSlot };

const cache = new Map<string, { data: unknown; at: number }>();

export function emptySlot<T>(): SourceSlot<T> {
  return { data: null, error: null, fetchedAt: null };
}

/**
 * Lit `url` ; la réponse est gardée `ttlMs` (plus court que la relève). Ne rejette jamais : en échec, la source garde ses
 * dernières données et porte le message (S3) ; un échec n'est jamais mis en cache.
 */
export async function loadSlot<T>(
  url: string, ttlMs: number, previous: SourceSlot<T> | undefined, now: number, guard: (v: unknown) => v is T,
): Promise<SourceSlot<T>> {
  const hit = cache.get(url);
  if (hit && now - hit.at < ttlMs && guard(hit.data)) return { data: hit.data, error: null, fetchedAt: hit.at };
  try {
    const json = await readHealthJsonShared(url);
    if (!guard(json)) throw new Error('réponse inattendue');
    cache.set(url, { data: json, at: now });
    return { data: json, error: null, fetchedAt: now };
  } catch (err) {
    return { data: previous?.data ?? null, error: err instanceof Error ? err.message : 'erreur inconnue', fetchedAt: previous?.fetchedAt ?? null };
  }
}

/** Tests seulement : vide le cache des réponses. */
export function resetTrafficSourceCache(): void {
  cache.clear();
}

/** Instant d'une date ISO ; null si absente ou illisible. */
export function dataMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function parisClock(ms: number, now: number): string {
  const day = (v: number): string => new Date(v).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
  const clock = new Date(ms).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
  if (day(ms) === day(now)) return clock;
  return `${new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit' })} ${clock}`;
}

export type TrafficStatus = Pick<DataSourceStatus, 'status' | 'lastUpdate' | 'error' | 'period'>;

/**
 * Panneau des sources (S1) : date de la donnée, jamais l'heure de lecture ; `period` = heure de la donnée (« (en retard) » selon
 * S2) affichée à la place de « temps réel » ; « stale » en retard, après un échec avec données ou quand une partie de la réponse
 * a échoué (`errors[]`), messages réunis ; « error » sans donnée ; « loading » avant la première lecture.
 */
export function trafficSlotStatus<T extends { errors: string[] }>(
  slot: SourceSlot<T>, source: TrafficSource, dataDate: string | null, now: number,
): TrafficStatus {
  if (slot.data === null) {
    return { status: slot.error !== null ? 'error' : 'loading', lastUpdate: null, error: slot.error ?? undefined, period: undefined };
  }
  const ms = dataMs(dataDate);
  const late = isTrafficDataLate(source, dataDate, now);
  const errors = [...(slot.error !== null ? [slot.error] : []), ...slot.data.errors];
  return {
    status: errors.length > 0 || late ? 'stale' : 'ok',
    lastUpdate: ms === null ? null : new Date(ms),
    error: errors.length > 0 ? errors.join(' ; ') : undefined,
    period: ms === null ? 'n.d.' : `${parisClock(ms, now)}${late ? ' (en retard)' : ''}`,
  };
}
