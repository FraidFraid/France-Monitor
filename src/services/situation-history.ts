/**
 * situation-history.ts — Client service for the multi-day history feature.
 *
 * pushHistorySnapshot(): fire-and-forget push after each snapshot tick.
 * getHistory(): fetch or return cached HistoryResult.
 */

import type {
  FranceCountrySnapshot,
  HistoryResponse,
  HistoryResult,
  ScoreCoverage,
  SituationSnapshot,
  SituationSeverity,
} from '../types/index.ts';
import { dedupe } from '../utils/inflight.ts';

const SCHEMA_VERSION = 1 as const;
const CACHE_PREFIX   = `fm:situation-history:v${SCHEMA_VERSION}`;
const PUSH_FLAG_KEY  = `${CACHE_PREFIX}:last-pushed-slot`;
const CACHE_FRESH_MS = 20 * 60 * 1000;

function currentSlotKey(now = new Date()): string {
  const h = now.getUTCHours();
  const slotHour = h < 6 ? 0 : h < 12 ? 6 : h < 18 ? 12 : 18;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), slotHour, 0, 0, 0));
  return d.toISOString().slice(0, 16);
}

function buildSnapshotPayload(snapshot: FranceCountrySnapshot, slotKey: string, coverage: ScoreCoverage): SituationSnapshot {
  const cyberScore  = snapshot.cyberScore ?? null;
  const socialScore = snapshot.stability?.nationalScore    ?? null;

  const sevOrder: Record<SituationSeverity, number> = { critical: 4, high: 3, medium: 2, watch: 1 };
  const maxSev: SituationSeverity | null = snapshot.situations.length > 0
    ? snapshot.situations.reduce((best, s) =>
        sevOrder[s.severity] > sevOrder[best] ? s.severity : best,
      snapshot.situations[0].severity)
    : null;

  const avgConf = snapshot.situations.length > 0
    ? snapshot.situations.reduce((sum, s) => sum + s.confidence, 0) / snapshot.situations.length
    : 0;

  return {
    version:    SCHEMA_VERSION,
    slotKey,
    capturedAt: new Date().toISOString(),
    score:      snapshot.score,
    axes: {
      continuity: snapshot.axes?.continuity ?? null,
      defense:    snapshot.axes?.defense    ?? null,
      security:   snapshot.axes?.security   ?? null,
      signal:     snapshot.axes?.signal     ?? null,
      cyber:      cyberScore,
      social:     socialScore,
    },
    situations: snapshot.situations.slice(0, 10).map(s => ({
      id:            s.id,
      type:          s.type,
      severity:      s.severity,
      title:         s.title,
      topDriver:     (s.drivers[0] ?? '').slice(0, 80),
      affectedZones: s.affectedZones.slice(0, 3),
      confidence:    s.confidence,
    })),
    meta: {
      totalSituations: snapshot.situations.length,
      maxSeverity:     maxSev,
      avgConfidence:   Math.round(avgConf * 100) / 100,
    },
    coverage,
    dataStatus: {
      overall: (cyberScore === null || socialScore === null) ? 'degraded' : 'ok',
      sources: {
        countryAxes: snapshot.axes ? 'ok' : 'missing',
        cyber:       cyberScore  !== null ? 'ok' : 'missing',
        social:      socialScore !== null ? 'ok' : 'missing',
      },
    },
  };
}

/**
 * Délai après le chargement de la page au-delà duquel un relevé part même si des sources manquent (sa couverture le dit). Avant,
 * seul un relevé complet part : le 25/10/2026, des relevés pris au premier calcul (moitié des sources) avaient fixé la note du
 * créneau, le serveur gardant le premier reçu (73 puis 90 sans changement de situation).
 */
export const HISTORY_GRACE_MS = 3 * 60_000;

/** Couverture d'un relevé : sources principales de la note lues (true) ou non. */
export function scoreCoverageOf(sources: Readonly<Record<string, boolean>>): ScoreCoverage {
  const entries = Object.entries(sources);
  const missing = entries.filter(([, read]) => !read).map(([key]) => key);
  return { read: entries.length - missing.length, total: entries.length, missing };
}

/** Un relevé part s'il est complet, ou, passé le délai de grâce, avec ce qui a été lu. */
export function historySnapshotReady(coverage: ScoreCoverage, sinceLoadMs: number): boolean {
  return coverage.read >= coverage.total || sinceLoadMs >= HISTORY_GRACE_MS;
}

/** Page ouverte par l'enregistreur de la VM (scripts/score-recorder.mjs) : le relevé lui est remis, pas envoyé au serveur. */
export function isRecorderPage(search: string): boolean {
  return new URLSearchParams(search).get('recorder') === '1';
}

declare global {
  interface Window { __fmRecorderSnapshot?: SituationSnapshot }
}

export async function pushHistorySnapshot(
  snapshot: FranceCountrySnapshot,
  coverage: ScoreCoverage,
  sinceLoadMs: number,
): Promise<void> {
  if (!historySnapshotReady(coverage, sinceLoadMs)) return;
  if (isRecorderPage(window.location.search)) {
    window.__fmRecorderSnapshot = buildSnapshotPayload(snapshot, currentSlotKey(), coverage);
    return;
  }
  const slotKey = currentSlotKey();
  // Un relevé déjà envoyé pour ce créneau n'est renvoyé que s'il couvre plus de sources.
  const flag = `${slotKey}|${coverage.read}`;
  try {
    const [lastSlot, lastRead] = (localStorage.getItem(PUSH_FLAG_KEY) ?? '').split('|');
    if (lastSlot === slotKey && Number(lastRead) >= coverage.read) return;
  } catch {
    // localStorage unavailable — still try the push
  }

  try {
    const payload = buildSnapshotPayload(snapshot, slotKey, coverage);
    const res = await fetch('/api/situation-history', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (res.ok) {
      localStorage.setItem(PUSH_FLAG_KEY, flag);
    }
  } catch {
    // fire-and-forget: silently ignore network errors
  }
}

interface CacheEntry {
  fetchedAt:     string;
  schemaVersion: number;
  days:          7 | 30;
  response:      HistoryResponse;
}

function cacheKey(days: 7 | 30): string {
  return `${CACHE_PREFIX}:${days}j`;
}

function readCache(days: 7 | 30): CacheEntry | null {
  try {
    const raw = localStorage.getItem(cacheKey(days));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (entry.schemaVersion !== SCHEMA_VERSION) {
      localStorage.removeItem(cacheKey(days));
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function writeCache(days: 7 | 30, response: HistoryResponse): void {
  const entry: CacheEntry = {
    fetchedAt:     new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    days,
    response,
  };
  try {
    localStorage.setItem(cacheKey(days), JSON.stringify(entry));
  } catch {
    // quota exceeded — ignore
  }
}

function computeIsDegraded(response: HistoryResponse): boolean {
  if (response.slotCount.missing > 0 || response.slotCount.degraded > 0) return true;
  return response.slots.some(
    s => 'status' in s || (s as SituationSnapshot).dataStatus?.overall === 'degraded',
  );
}

export async function getHistory(days: 7 | 30, force = false): Promise<HistoryResult> {
  const cached  = readCache(days);
  const now     = Date.now();
  const isFresh = cached !== null && (now - new Date(cached.fetchedAt).getTime()) < CACHE_FRESH_MS;

  if (!force && isFresh && cached) {
    return {
      data:                    cached.response,
      source:                  'cached',
      fetchedAt:               cached.fetchedAt,
      isDegraded:              computeIsDegraded(cached.response),
      errorRecoveredFromCache: false,
    };
  }

  try {
    // Single-flight par `days` : plusieurs panneaux peuvent réclamer le
    // même historique quasi simultanément au démarrage (constaté en prod :
    // `situation-history?days=7` ×2 par chargement).
    const url = `/api/situation-history?days=${days}`;
    const data = await dedupe(url, async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as HistoryResponse;
    });
    writeCache(days, data);
    const fetchedAt = new Date().toISOString();
    return {
      data,
      source:                  'fresh',
      fetchedAt,
      isDegraded:              computeIsDegraded(data),
      errorRecoveredFromCache: false,
    };
  } catch {
    if (cached) {
      return {
        data:                    cached.response,
        source:                  'stale',
        fetchedAt:               cached.fetchedAt,
        isDegraded:              computeIsDegraded(cached.response),
        errorRecoveredFromCache: true,
      };
    }
    const empty: HistoryResponse = {
      requestedRange: { from: '', to: '' },
      slotCount: { expected: days * 4, captured: 0, missing: days * 4, degraded: 0 },
      slots: [],
    };
    return {
      data:                    empty,
      source:                  'stale',
      fetchedAt:               new Date().toISOString(),
      isDegraded:              true,
      errorRecoveredFromCache: true,
    };
  }
}
