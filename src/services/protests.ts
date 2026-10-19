// src/services/protests.ts : lecture client de la couche Manifestations (spec 2026-10-17 manifestations) : annonces de l'agenda
// militant Démosphère, presse française ingérée et signal de la presse mondiale (GDELT), servis par /api/social/protests. Jamais d'appel direct aux sources.
import type { ProtestArticle, ProtestItem, ProtestsResponse } from '../types/index.ts';
import { isRecord } from './health-surveillance.ts';
import { isBool, isNum, isNumOrNull, isOneOf, isStr, isStrOrNull, listOf, loadSlot, mergeSlot, type SourceSlot } from './environment-source.ts';

export const PROTESTS_URL = '/api/social/protests';
/** Cache client : 5 min, sous la relève de 10 min. */
export const PROTESTS_TTL_MS = 5 * 60_000;
/** Relève du navigateur, couche active ou panneau ouvert. */
export const PROTESTS_POLL_MS = 10 * 60_000;

export type ProtestsState = SourceSlot<ProtestsResponse>;

const SOURCES: ReadonlySet<string> = new Set(['demosphere', 'presse', 'gdelt', 'prefecture']);
const STATUSES: ReadonlySet<string> = new Set(['annonce', 'signale']);

const PRECISIONS: ReadonlySet<string> = new Set(['commune', 'departement']);
const isArticle = (a: Record<string, unknown>): boolean => isStr(a.url) && isStr(a.domain) && isStr(a.seenAt) && isBool(a.violent)
  && isStrOrNull(a.title) && isStrOrNull(a.outlet);
const isItem = (x: Record<string, unknown>): boolean => isStr(x.id) && isOneOf(x.source, SOURCES) && isOneOf(x.status, STATUSES)
  && isStr(x.title) && isStrOrNull(x.startsAt) && isBool(x.allDay) && isStrOrNull(x.city) && isStrOrNull(x.dept)
  && isNumOrNull(x.lat) && isNumOrNull(x.lon) && (x.lat === null) === (x.lon === null)
  && isStrOrNull(x.url) && isStrOrNull(x.place) && isStrOrNull(x.edition) && isBool(x.violent) && isNumOrNull(x.participants)
  && (x.precision === null || isOneOf(x.precision, PRECISIONS)) && listOf(x.articles, isArticle) && isNum(x.articleCount);
const isDemosphere = (d: unknown): boolean => isRecord(d) && isStrOrNull(d.readAt) && isNum(d.editions) && Array.isArray(d.failedEditions)
  && d.failedEditions.every(isStr) && isNum(d.scanned);
const isGdelt = (g: unknown): boolean => isRecord(g) && isStrOrNull(g.readAt) && isNum(g.files) && isNum(g.missingFiles);
const isPresse = (p: unknown): boolean => isRecord(p) && isStrOrNull(p.readAt) && isNum(p.scanned) && isNum(p.matched) && isNum(p.unplaced);

/** Garde stricte du contrat : toute réponse mal formée est rejetée (le panneau garde alors le relevé précédent). */
export function isProtestsResponse(v: unknown): v is ProtestsResponse {
  return isRecord(v) && isStrOrNull(v.readAt) && listOf(v.items, isItem) && isDemosphere(v.demosphere) && isGdelt(v.gdelt) && isPresse(v.presse)
    && Array.isArray(v.errors) && v.errors.every(isStr);
}

export function fetchProtests(previous: ProtestsState | null, now: number = Date.now()): Promise<ProtestsState> {
  return loadSlot(PROTESTS_URL, PROTESTS_TTL_MS, previous ?? undefined, now, isProtestsResponse, 'Manifestations');
}

export function mergeProtests(current: ProtestsState | null, incoming: ProtestsState): ProtestsState {
  return mergeSlot(current, incoming);
}

/** Relevé du serveur en retard au-delà de 30 min (relève de 10 min, cache serveur compris). */
export const PROTESTS_LATE_AFTER_MS = 30 * 60_000;
export function isProtestsLate(readAt: string | null, now: number): boolean {
  const ms = readAt === null ? Number.NaN : Date.parse(readAt);
  return !Number.isFinite(ms) || now - ms > PROTESTS_LATE_AFTER_MS;
}

export type { ProtestArticle, ProtestItem };
