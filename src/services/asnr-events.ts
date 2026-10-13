// src/services/asnr-events.ts : lecture client des événements de sûreté ASNR (spec 2026-10-13). Lu au rythme du parc nucléaire ;
// le journal sert le panneau, la carte et les situations même quand le relevé est en retard.
import type { AsnrEvent, AsnrResponse } from '../types/index.ts';
import {
  environmentSlotStatus, isOneOf, isStr, isStrOrNull, listOf, loadSlot, mergeSlot, type EnvironmentStatus, type SourceSlot,
} from './environment-source.ts';
import { isRecord, isStringArray } from './health-surveillance.ts';

export const ASNR_URL = '/api/nuclear/asnr';
/** Cache client : 30 min (le serveur relit l'ASNR toutes les heures). */
export const ASNR_TTL_MS = 30 * 60_000;
/** Fenêtre des situations (spec) et des anneaux de carte. */
export const ASNR_SITUATION_DAYS = 7;
export const ASNR_MAP_DAYS = 30;

const KINDS: ReadonlySet<string> = new Set(['crise', 'installation', 'radioprotection']);
const isInes = (v: unknown): boolean => v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 7);
const isEvent = (e: Record<string, unknown>): boolean => isStr(e.id) && isStr(e.url) && isStr(e.title)
  && isStr(e.date) && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && isOneOf(e.kind, KINDS) && isInes(e.ines)
  && isStrOrNull(e.plantId) && isStrOrNull(e.site);

export function isAsnrResponse(v: unknown): v is AsnrResponse {
  return isRecord(v) && isStrOrNull(v.readAt) && listOf(v.events, isEvent) && isStringArray(v.errors);
}

export function fetchAsnr(previous: SourceSlot<AsnrResponse> | null, now: number = Date.now()): Promise<SourceSlot<AsnrResponse>> {
  return loadSlot(ASNR_URL, ASNR_TTL_MS, previous ?? undefined, now, isAsnrResponse, 'ASNR');
}

export function mergeAsnr(current: SourceSlot<AsnrResponse> | null, incoming: SourceSlot<AsnrResponse>): SourceSlot<AsnrResponse> {
  return mergeSlot(current, incoming);
}

/** Panneau des sources (« ASNR ») : relevé du serveur, retard au-delà de 3 h ; une partie en panne est nommée. */
export function asnrStatus(slot: SourceSlot<AsnrResponse>, now: number): EnvironmentStatus {
  return environmentSlotStatus(slot, 'asnr', slot.data?.readAt ?? null, now);
}

/** Événements du journal servi ; un relevé en retard les garde (spec : les situations restent calculées sur le journal). */
export function asnrEventsOf(r: AsnrResponse | null): AsnrEvent[] {
  return r?.events ?? [];
}

/** Âge d'un avis en jours, depuis minuit UTC de son jour de publication. */
export function asnrAgeDays(date: string, now: number): number {
  return (now - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;
}
