/**
 * source-quality-history.ts — Historisation locale du comportement des sources.
 *
 * Objectif : remplacer les scores de fiabilité codés en dur par des scores
 * CALCULÉS depuis le comportement réellement observé (succès, disponibilité,
 * fallbacks), historisés en seaux journaliers sur une fenêtre glissante.
 *
 * Deux couches :
 *  1. Fonctions PURES (temps injecté) : agrégation en seaux journaliers depuis
 *     les DELTAS des compteurs cumulatifs du Watchdog, purge, calcul de métriques.
 *     Testables sans DOM.
 *  2. Couche d'intégration : abonnement au Watchdog, échantillonnage débouncé,
 *     persistance localStorage. Gardée par `typeof window`.
 */

import { Watchdog } from './watchdog.ts';
import type { DataSourceStatus, WatchdogSnapshot } from '../types/index.ts';
import type { ObservedMetrics } from './qualityMeta.ts';

// ─── Constantes ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'fm-source-quality-history';
const SCHEMA_VERSION = 1;
const DAY_MS = 86_400_000;
/** Fenêtre d'historique conservée (jours). Au-delà : purge. */
const MAX_HISTORY_DAYS = 14;
/** Intervalle minimal entre deux échantillons d'une même source. */
const SAMPLE_INTERVAL_MS = 5 * 60_000;
/** Délai minimal entre deux écritures localStorage. */
const WRITE_DEBOUNCE_MS = 30_000;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Seau journalier d'observations pour une source (compteurs et mesures agrégés). */
export interface DailyBucket {
  date: string;             // 'YYYY-MM-DD' (UTC)
  fetches: number;
  failures: number;
  fallbacks: number;
  sumResponseMs: number;
  nResponseSamples: number;
  okSamples: number;
  staleSamples: number;
  errorSamples: number;
}

/** Échantillon instantané tiré d'un snapshot Watchdog. */
export interface SourceSample {
  status: DataSourceStatus['status'];
  fetchCount: number;    // cumulatif session
  failureCount: number;  // cumulatif session
  fallbackCount: number; // cumulatif session
  responseTimeMs: number | null;
}

/** État historisé d'une source (seaux + dernière base cumulative + dernier échantillon). */
export interface SourceHistoryState {
  buckets: DailyBucket[];
  lastCumulative: { fetches: number; failures: number; fallbacks: number } | null;
  lastSampleAt: number | null;
}

/** Store complet persisté. */
export interface QualityHistoryStore {
  version: number;
  sources: Record<string, SourceHistoryState>;
}

// ─── Helpers purs ──────────────────────────────────────────────────────────────

/** Clé de jour UTC 'YYYY-MM-DD' à partir d'un timestamp ms. */
export function dateKeyUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function createBucket(date: string): DailyBucket {
  return {
    date,
    fetches: 0,
    failures: 0,
    fallbacks: 0,
    sumResponseMs: 0,
    nResponseSamples: 0,
    okSamples: 0,
    staleSamples: 0,
    errorSamples: 0,
  };
}

export function createSourceHistoryState(): SourceHistoryState {
  return { buckets: [], lastCumulative: null, lastSampleAt: null };
}

export function createHistoryStore(): QualityHistoryStore {
  return { version: SCHEMA_VERSION, sources: {} };
}

/**
 * Delta d'un compteur cumulatif.
 *  - premier échantillon (aucune base) : on pose la base, delta = 0 (pas de comptage rétroactif).
 *  - reset de session (compteur repassé sous la base) : on prend la valeur brute.
 */
function counterDelta(current: number, previous: number | null): number {
  if (previous === null) return 0;
  const delta = current - previous;
  return delta < 0 ? Math.max(0, current) : delta;
}

/** Retire les seaux hors de la fenêtre de MAX_HISTORY_DAYS jours (comparaison de clés de jour). */
export function purgeOldBuckets(
  buckets: DailyBucket[],
  nowMs: number,
  maxDays = MAX_HISTORY_DAYS,
): DailyBucket[] {
  const cutoffKey = dateKeyUTC(nowMs - (maxDays - 1) * DAY_MS);
  return buckets.filter((bucket) => bucket.date >= cutoffKey);
}

/**
 * Intègre un échantillon dans l'état d'une source (PUR).
 * Convertit les compteurs cumulatifs en deltas, empile dans le seau du jour,
 * purge la fenêtre, met à jour la base cumulative et l'horodatage.
 * Les statuts 'loading' sont ignorés (aucun signal exploitable).
 */
export function ingestSourceSample(
  state: SourceHistoryState,
  sample: SourceSample,
  nowMs: number,
): SourceHistoryState {
  if (sample.status === 'loading') return state;

  const prev = state.lastCumulative;
  const dFetches = counterDelta(sample.fetchCount, prev ? prev.fetches : null);
  const dFailures = counterDelta(sample.failureCount, prev ? prev.failures : null);
  const dFallbacks = counterDelta(sample.fallbackCount, prev ? prev.fallbacks : null);

  const date = dateKeyUTC(nowMs);
  const buckets = state.buckets.map((bucket) => ({ ...bucket }));
  let bucket = buckets.find((entry) => entry.date === date);
  if (!bucket) {
    bucket = createBucket(date);
    buckets.push(bucket);
  }

  bucket.fetches += dFetches;
  bucket.failures += dFailures;
  bucket.fallbacks += dFallbacks;
  if (sample.responseTimeMs !== null && sample.responseTimeMs >= 0) {
    bucket.sumResponseMs += sample.responseTimeMs;
    bucket.nResponseSamples += 1;
  }
  if (sample.status === 'ok') bucket.okSamples += 1;
  else if (sample.status === 'stale') bucket.staleSamples += 1;
  else if (sample.status === 'error') bucket.errorSamples += 1;

  const purged = purgeOldBuckets(buckets, nowMs).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );

  return {
    buckets: purged,
    lastCumulative: {
      fetches: sample.fetchCount,
      failures: sample.failureCount,
      fallbacks: sample.fallbackCount,
    },
    lastSampleAt: nowMs,
  };
}

/**
 * Applique une salve d'échantillons au store (PUR), avec throttle par source.
 * Un échantillon est ignoré si la source a déjà été échantillonnée depuis
 * moins de `sampleIntervalMs`.
 */
export function recordSamples(
  store: QualityHistoryStore,
  incoming: Array<{ key: string; sample: SourceSample }>,
  nowMs: number,
  sampleIntervalMs = SAMPLE_INTERVAL_MS,
): QualityHistoryStore {
  const sources: Record<string, SourceHistoryState> = { ...store.sources };
  for (const { key, sample } of incoming) {
    if (!key || sample.status === 'loading') continue;
    const state = sources[key] ?? createSourceHistoryState();
    if (state.lastSampleAt !== null && nowMs - state.lastSampleAt < sampleIntervalMs) continue;
    sources[key] = ingestSourceSample(state, sample, nowMs);
  }
  return { version: store.version, sources };
}

/**
 * Calcule les métriques observées à partir des seaux (PUR).
 * Retourne null si aucune observation exploitable.
 */
export function computeObservedMetrics(buckets: DailyBucket[]): ObservedMetrics | null {
  if (buckets.length === 0) return null;

  let fetches = 0;
  let failures = 0;
  let fallbacks = 0;
  let sumResponseMs = 0;
  let nResponseSamples = 0;
  let okSamples = 0;
  let staleSamples = 0;
  let errorSamples = 0;
  const days = new Set<string>();

  for (const bucket of buckets) {
    fetches += bucket.fetches;
    failures += bucket.failures;
    fallbacks += bucket.fallbacks;
    sumResponseMs += bucket.sumResponseMs;
    nResponseSamples += bucket.nResponseSamples;
    okSamples += bucket.okSamples;
    staleSamples += bucket.staleSamples;
    errorSamples += bucket.errorSamples;
    const bucketSamples = bucket.okSamples + bucket.staleSamples + bucket.errorSamples;
    if (bucketSamples > 0 || bucket.fetches > 0) days.add(bucket.date);
  }

  const samples = okSamples + staleSamples + errorSamples;
  if (samples === 0 && fetches === 0) return null;

  const uptimeRate = samples > 0
    ? okSamples / samples
    : fetches > 0 ? clamp01((fetches - failures) / fetches) : 0;
  const successRate = fetches > 0 ? clamp01((fetches - failures) / fetches) : uptimeRate;
  const fallbackRate = fetches > 0 ? clamp01(fallbacks / fetches) : 0;
  const avgResponseMs = nResponseSamples > 0 ? Math.round(sumResponseMs / nResponseSamples) : null;

  return {
    successRate: round3(successRate),
    uptimeRate: round3(uptimeRate),
    fallbackRate: round3(fallbackRate),
    avgResponseMs,
    samples,
    observationDays: days.size,
  };
}

// ─── Couche d'intégration (DOM) ──────────────────────────────────────────────

let memStore: QualityHistoryStore | null = null;
let unsubscribe: (() => void) | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingWrite = false;

function hasWindow(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function loadStore(): QualityHistoryStore {
  if (memStore) return memStore;
  const fresh = createHistoryStore();
  if (!hasWindow()) {
    memStore = fresh;
    return fresh;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as QualityHistoryStore;
      if (parsed && parsed.version === SCHEMA_VERSION && parsed.sources) {
        memStore = parsed;
        return parsed;
      }
    }
  } catch {
    // localStorage indisponible ou store corrompu → on repart de zéro.
  }
  memStore = fresh;
  return fresh;
}

function flushWrite(): void {
  if (!hasWindow() || !memStore) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memStore));
  } catch {
    // Quota dépassé → on ignore, l'historique reste en mémoire.
  }
}

function scheduleWrite(): void {
  if (!hasWindow()) return;
  if (writeTimer !== null) {
    pendingWrite = true;
    return;
  }
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flushWrite();
    if (pendingWrite) {
      pendingWrite = false;
      scheduleWrite();
    }
  }, WRITE_DEBOUNCE_MS);
}

function snapshotToSample(status: DataSourceStatus): SourceSample {
  return {
    status: status.status,
    fetchCount: status.fetchCount ?? 0,
    failureCount: status.failureCount ?? 0,
    fallbackCount: status.fallbackCount ?? 0,
    responseTimeMs: status.responseTimeMs ?? null,
  };
}

function handleSnapshots(snapshots: WatchdogSnapshot[], nowMs: number): void {
  const store = loadStore();
  const incoming = snapshots.map((snap) => ({
    key: snap.status.name,
    sample: snapshotToSample(snap.status),
  }));
  memStore = recordSamples(store, incoming, nowMs);
  scheduleWrite();
}

/**
 * Démarre l'historisation : abonnement au Watchdog + persistance débouncée.
 * Idempotent (un second appel renvoie le désabonnement existant).
 * No-op hors DOM. Retourne une fonction d'arrêt.
 */
export function startQualityHistoryTracking(): () => void {
  if (unsubscribe) return unsubscribe;
  if (!hasWindow()) return () => {};

  loadStore();
  const off = Watchdog.on('update', (snapshots) => {
    handleSnapshots(snapshots, Date.now());
  });

  unsubscribe = () => {
    off();
    if (writeTimer !== null) {
      clearTimeout(writeTimer);
      writeTimer = null;
    }
    flushWrite();
    unsubscribe = null;
  };
  return unsubscribe;
}

/**
 * Lit les métriques observées d'une source depuis le store local.
 * Retourne null hors DOM ou en l'absence d'historique.
 */
export function getObservedMetrics(sourceName: string): ObservedMetrics | null {
  if (!hasWindow()) return null;
  const store = loadStore();
  const state = store.sources[sourceName];
  if (!state) return null;
  return computeObservedMetrics(state.buckets);
}
