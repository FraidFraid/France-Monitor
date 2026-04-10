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
  SituationSnapshot,
  SituationSeverity,
} from '../types/index.ts';

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

function buildSnapshotPayload(snapshot: FranceCountrySnapshot, slotKey: string): SituationSnapshot {
  const cyberScore  = snapshot.cyber?.meta?.globalScore   ?? null;
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

export async function pushHistorySnapshot(snapshot: FranceCountrySnapshot): Promise<void> {
  const slotKey = currentSlotKey();
  try {
    const lastPushed = localStorage.getItem(PUSH_FLAG_KEY);
    if (lastPushed === slotKey) return;
  } catch {
    // localStorage unavailable — still try the push
  }

  try {
    const payload = buildSnapshotPayload(snapshot, slotKey);
    const res = await fetch('/api/situation-history', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (res.ok) {
      localStorage.setItem(PUSH_FLAG_KEY, slotKey);
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

export async function getHistory(days: 7 | 30, force = false): Promise<HistoryResult> {
  const cached  = readCache(days);
  const now     = Date.now();
  const isFresh = cached !== null && (now - new Date(cached.fetchedAt).getTime()) < CACHE_FRESH_MS;

  if (!force && isFresh && cached) {
    const degraded = cached.response.slots.some(
      s => 'status' in s || (s as SituationSnapshot).dataStatus?.overall === 'degraded',
    );
    return {
      data:                    cached.response,
      source:                  'cached',
      fetchedAt:               cached.fetchedAt,
      isDegraded:              degraded || cached.response.slotCount.missing > 0,
      errorRecoveredFromCache: false,
    };
  }

  try {
    const res  = await fetch(`/api/situation-history?days=${days}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: HistoryResponse = await res.json();
    writeCache(days, data);
    const fetchedAt = new Date().toISOString();
    const degraded  = data.slotCount.missing > 0 || data.slotCount.degraded > 0;
    return {
      data,
      source:                  'fresh',
      fetchedAt,
      isDegraded:              degraded,
      errorRecoveredFromCache: false,
    };
  } catch {
    if (cached) {
      const degraded = cached.response.slotCount.missing > 0 || cached.response.slotCount.degraded > 0;
      return {
        data:                    cached.response,
        source:                  'stale',
        fetchedAt:               cached.fetchedAt,
        isDegraded:              degraded,
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
