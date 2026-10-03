// src/services/health-surveillance.ts : lecture client de la veille sanitaire (spec 2026-10-03 § 2.1 à 2.6, S1 à S3).
// Une route par source, cache de 25 min par source (sous la relève de 30 min d'App.ts). Toute réponse non 2xx, illisible
// ou de forme inattendue est une erreur (S3) : la source garde ses dernières données et porte son message d'erreur.
import type {
  AlertLevelsResponse, DataSourceStatus, DrugShortagesV2, InternationalResponse, MinistryMessagesResponse, RecallsResponse,
  SentinellesNationalResponse, SyndromicResponse, WastewaterPoint, WastewaterResponse,
} from '../types/index.ts';
import { isHealthDataLate } from './health-levels.ts';

/** Cache client par source : 25 min, strictement sous la relève santé de 30 min (App.ts). */
export const HEALTH_TTL_MS = 25 * 60_000;
const TIMEOUT_MS = 20_000;

export interface SourceSlot<T> { data: T | null; error: string | null; fetchedAt: number | null }

export interface HealthSurveillanceState {
  syndromic: SourceSlot<SyndromicResponse>;
  alerts: SourceSlot<AlertLevelsResponse>;
  sentinelles: SourceSlot<SentinellesNationalResponse>;
  wastewater: SourceSlot<WastewaterResponse>;
  international: SourceSlot<InternationalResponse>;
  ministry: SourceSlot<MinistryMessagesResponse>;
  drugs: SourceSlot<DrugShortagesV2>;
  recalls: SourceSlot<RecallsResponse>;
}
export type HealthSurveillanceKey = keyof HealthSurveillanceState;

export const HEALTH_SURVEILLANCE_URLS: Readonly<Record<HealthSurveillanceKey, string>> = {
  syndromic: '/api/health/syndromic',
  alerts: '/api/health/alert-levels',
  sentinelles: '/api/health/sentinelles-national',
  wastewater: '/api/health/wastewater',
  international: '/api/health/international',
  ministry: '/api/health/dgs-messages',
  drugs: '/api/health/drug-shortages',
  recalls: '/api/health/recalls',
};

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x: unknown) => typeof x === 'string');
}
function isWeekOrNull(v: unknown): boolean {
  return v === null || (isRecord(v) && typeof v.id === 'string' && typeof v.start === 'string' && typeof v.end === 'string');
}

export function isSyndromicResponse(v: unknown): v is SyndromicResponse {
  return isRecord(v) && isWeekOrNull(v.week) && (v.publishedAt === null || typeof v.publishedAt === 'string') && isStringArray(v.errors)
    && Array.isArray(v.departments) && Array.isArray(v.syndromes)
    && v.syndromes.every((s: unknown) => isRecord(s) && typeof s.key === 'string' && Array.isArray(s.france) && isRecord(s.ages));
}
export function isAlertLevelsResponse(v: unknown): v is AlertLevelsResponse {
  return isRecord(v) && Array.isArray(v.levels) && Array.isArray(v.bulletins) && isWeekOrNull(v.latestWeek)
    && isStringArray(v.ignoredRegionCodes) && isStringArray(v.errors);
}
export function isSentinellesNationalResponse(v: unknown): v is SentinellesNationalResponse {
  return isRecord(v) && isWeekOrNull(v.week) && typeof v.provisional === 'boolean' && Array.isArray(v.indicators)
    && Array.isArray(v.topRegions) && isStringArray(v.errors);
}
export function isWastewaterResponse(v: unknown): v is WastewaterResponse {
  return isRecord(v) && Array.isArray(v.points) && typeof v.stationsTotal === 'number' && isStringArray(v.errors);
}
export function isInternationalResponse(v: unknown): v is InternationalResponse {
  return isRecord(v) && Array.isArray(v.who) && Array.isArray(v.ecdc) && isStringArray(v.errors);
}
export function isMinistryMessagesResponse(v: unknown): v is MinistryMessagesResponse {
  return isRecord(v) && Array.isArray(v.messages) && typeof v.sourceUrl === 'string' && typeof v.officialUrl === 'string' && isStringArray(v.errors);
}
export function isDrugShortagesV2(v: unknown): v is DrugShortagesV2 {
  if (!isRecord(v) || !Array.isArray(v.items) || typeof v.mitmListUrl !== 'string' || !isStringArray(v.errors)) return false;
  const counts = v.counts;
  return isRecord(counts) && ['rupture', 'tension', 'remise', 'arret'].every((k) => typeof counts[k] === 'number');
}
export function isRecallsResponse(v: unknown): v is RecallsResponse {
  return isRecord(v) && typeof v.total === 'number' && typeof v.healthRisk === 'number' && isRecord(v.byRisk)
    && Array.isArray(v.byDay) && Array.isArray(v.latest) && isStringArray(v.errors);
}

/** Échec avant toute réponse : délai (AbortSignal.timeout) ou réseau, en français (jamais « Failed to fetch » brut). */
function networkErrorMessage(err: unknown): string {
  const name = typeof err === 'object' && err !== null && 'name' in err ? err.name : null;
  return name === 'TimeoutError' || name === 'AbortError' ? 'délai dépassé' : 'source injoignable';
}

/** Lecture JSON stricte : HTTP non 2xx ou corps illisible (page HTML d'erreur, défi anti-robot) = erreur (S3). */
export async function readHealthJson(url: string): Promise<unknown> {
  let resp: Response;
  try {
    resp = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new Error(networkErrorMessage(err));
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  try {
    return (await resp.json()) as unknown;
  } catch {
    throw new Error('réponse illisible');
  }
}

const cache = new Map<HealthSurveillanceKey, { data: unknown; at: number }>();

function emptySlot<T>(): SourceSlot<T> {
  return { data: null, error: null, fetchedAt: null };
}

async function load<T>(
  key: HealthSurveillanceKey, wanted: boolean, previous: SourceSlot<T> | undefined, now: number,
  guard: (v: unknown) => v is T, pick: (v: T) => T = (v) => v,
): Promise<SourceSlot<T>> {
  if (!wanted) return previous ?? emptySlot<T>();
  const hit = cache.get(key);
  if (hit && now - hit.at < HEALTH_TTL_MS && guard(hit.data)) return { data: pick(hit.data), error: null, fetchedAt: hit.at };
  try {
    const json = await readHealthJson(HEALTH_SURVEILLANCE_URLS[key]);
    if (!guard(json)) throw new Error('réponse inattendue');
    cache.set(key, { data: json, at: now });
    return { data: pick(json), error: null, fetchedAt: now };
  } catch (err) {
    return { data: previous?.data ?? null, error: err instanceof Error ? err.message : 'erreur inconnue', fetchedAt: previous?.fetchedAt ?? null };
  }
}

/** Champs V2 seulement : les champs historiques de la route (jusqu'à la tâche 19) ne sont pas lus. */
function pickDrugs(v: DrugShortagesV2): DrugShortagesV2 {
  return { items: v.items, counts: v.counts, latestUpdate: v.latestUpdate, mitmListUrl: v.mitmListUrl, errors: v.errors };
}

/**
 * Lit les sources demandées (toutes par défaut) ; les autres gardent leur état précédent. Ne rejette jamais :
 * une source en échec porte `error` et garde ses dernières données.
 */
export async function fetchHealthSurveillance(
  previous: HealthSurveillanceState | null, now: number = Date.now(), keys: readonly HealthSurveillanceKey[] | 'all' = 'all',
): Promise<HealthSurveillanceState> {
  const want = (k: HealthSurveillanceKey): boolean => keys === 'all' || keys.includes(k);
  const [syndromic, alerts, sentinelles, wastewater, international, ministry, drugs, recalls] = await Promise.all([
    load('syndromic', want('syndromic'), previous?.syndromic, now, isSyndromicResponse),
    load('alerts', want('alerts'), previous?.alerts, now, isAlertLevelsResponse),
    load('sentinelles', want('sentinelles'), previous?.sentinelles, now, isSentinellesNationalResponse),
    load('wastewater', want('wastewater'), previous?.wastewater, now, isWastewaterResponse),
    load('international', want('international'), previous?.international, now, isInternationalResponse),
    load('ministry', want('ministry'), previous?.ministry, now, isMinistryMessagesResponse),
    load('drugs', want('drugs'), previous?.drugs, now, isDrugShortagesV2, pickDrugs),
    load('recalls', want('recalls'), previous?.recalls, now, isRecallsResponse),
  ]);
  return { syndromic, alerts, sentinelles, wastewater, international, ministry, drugs, recalls };
}

function copySlot<K extends HealthSurveillanceKey>(target: HealthSurveillanceState, source: HealthSurveillanceState, key: K): void {
  target[key] = source[key];
}

/**
 * Lectures concurrentes (démarrage, activation d'une couche, relève) : chacune part de l'état connu à son lancement ;
 * à son retour, seules les sources qu'elle a lues remplacent l'état le plus récent (une lecture partielle terminée en
 * dernier ne vide pas les autres sources).
 */
export function mergeSurveillance(
  latest: HealthSurveillanceState | null, read: HealthSurveillanceState, keys: readonly HealthSurveillanceKey[] | 'all',
): HealthSurveillanceState {
  if (latest === null || keys === 'all') return read;
  const merged: HealthSurveillanceState = { ...latest };
  for (const key of keys) copySlot(merged, read, key);
  return merged;
}

/** Tests seulement : vide le cache. */
export function resetHealthSurveillanceCache(): void {
  cache.clear();
}

/** Instant d'une date « AAAA-MM-JJ » (midi UTC : le jour est sans ambiguïté) ou ISO ; null si absente ou illisible. */
export function dataDateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  return Number.isFinite(ms) ? ms : null;
}

/** Dernière semaine SUM'eau publiée avec l'indicateur national (54 stations). */
export function lastWastewaterPoint(d: WastewaterResponse | null): (WastewaterPoint & { national54: number }) | null {
  if (!d) return null;
  for (let i = d.points.length - 1; i >= 0; i -= 1) {
    const p = d.points[i];
    if (p.national54 !== null && Number.isFinite(p.national54)) return { ...p, national54: p.national54 };
  }
  return null;
}

function latest(dates: readonly string[]): string | null {
  return dates.reduce<string | null>((max, d) => ((dataDateMs(d) ?? -Infinity) > (dataDateMs(max) ?? -Infinity) ? d : max), null);
}

/** Dernière publication RappelConso : rappel le plus récent, ou dernier jour avec au moins un rappel. */
export function latestRecallDate(d: RecallsResponse | null): string | null {
  if (!d) return null;
  return latest([...d.latest.map((r) => r.date), ...d.byDay.filter((x) => x.total > 0).map((x) => x.day)]);
}

/** Date de la donnée de chaque source (S1), jamais l'heure de lecture ; null si inconnue. */
export function surveillanceDataDate(state: HealthSurveillanceState, key: HealthSurveillanceKey): string | null {
  switch (key) {
    case 'syndromic': return state.syndromic.data?.publishedAt ?? state.syndromic.data?.week?.end ?? null;
    case 'alerts': return state.alerts.data?.latestWeek?.end ?? null;
    case 'sentinelles': return state.sentinelles.data?.week?.end ?? null;
    case 'wastewater': return state.wastewater.data?.publishedAt ?? lastWastewaterPoint(state.wastewater.data)?.start ?? null;
    case 'international': {
      const d = state.international.data;
      return d ? latest([...d.who.map((n) => n.date), ...d.ecdc.map((r) => r.date)]) : null;
    }
    case 'ministry': return latest(state.ministry.data?.messages.map((m) => m.date) ?? []);
    case 'drugs': return state.drugs.data?.latestUpdate ?? null;
    case 'recalls': return latestRecallDate(state.recalls.data);
  }
}

/** Retard S2 selon le rythme de la source ; alertes et messages datés ne sont jamais « en retard ». */
export function surveillanceLate(state: HealthSurveillanceState, key: HealthSurveillanceKey, now: number): boolean {
  switch (key) {
    case 'syndromic': {
      const w = state.syndromic.data?.week;
      return w ? isHealthDataLate('syndromic', w.end, now) : false;
    }
    case 'sentinelles': {
      const w = state.sentinelles.data?.week;
      return w ? isHealthDataLate('sentinelles', w.end, now) : false;
    }
    case 'wastewater': {
      const p = lastWastewaterPoint(state.wastewater.data);
      return p ? isHealthDataLate('wastewater', p.start, now) : false;
    }
    case 'drugs': {
      const d = state.drugs.data?.latestUpdate;
      return d ? isHealthDataLate('ansm', d, now) : false;
    }
    case 'recalls': {
      const d = latestRecallDate(state.recalls.data);
      return d ? isHealthDataLate('recalls', d, now) : false;
    }
    default:
      return false;
  }
}

/** Panneau des sources : date de la donnée (S1) ; « stale » en retard ou après un échec avec données ; « error » sans donnée. */
export function surveillanceStatus(
  state: HealthSurveillanceState, key: HealthSurveillanceKey, now: number,
): Pick<DataSourceStatus, 'status' | 'lastUpdate' | 'error'> {
  const slot = state[key];
  if (slot.data === null) return { status: slot.error !== null ? 'error' : 'loading', lastUpdate: null, error: slot.error ?? undefined };
  const ms = dataDateMs(surveillanceDataDate(state, key));
  return {
    status: slot.error !== null || surveillanceLate(state, key, now) ? 'stale' : 'ok',
    lastUpdate: ms === null ? null : new Date(ms),
    error: slot.error ?? undefined,
  };
}
