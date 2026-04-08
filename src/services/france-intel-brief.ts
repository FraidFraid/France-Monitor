// src/services/france-intel-brief.ts
import type { FranceBriefContext } from '../types/index.ts';

interface BriefCacheEntry {
  brief: string | null;
  freshness: 'fresh' | 'cached';
  expiresAt: number;
}

// In-memory cache keyed by lang
const _cache = new Map<'fr' | 'en', BriefCacheEntry>();
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2h

export interface FranceBriefResult {
  brief: string | null;
  freshness: 'fresh' | 'cached';
}

export async function fetchFranceIntelBrief(
  ctx: FranceBriefContext,
  lang: 'fr' | 'en' = 'fr',
): Promise<FranceBriefResult> {
  // Check client-side cache
  const cached = _cache.get(lang);
  if (cached && Date.now() < cached.expiresAt) {
    return { brief: cached.brief, freshness: 'cached' };
  }

  const isnrScore      = ctx.score;
  const isnrComponents = ctx.isnrComponents;
  const cyberScore     = ctx.cyberScore;
  const meteoAlertCount = ctx.signals.meteoAlerts;
  const topHeadlines   = ctx.topHeadlines;
  const signalCounts   = ctx.signals;
  const energy = ctx.energySummary ? {
    ecowattSignal: ctx.energySummary.ecowattSignal,
    nuclearShare:  ctx.energySummary.shares.nuclear,
    gasShare:      ctx.energySummary.shares.gas,
    hydroShare:    ctx.energySummary.shares.hydro,
    windShare:     ctx.energySummary.shares.wind,
    solarShare:    ctx.energySummary.shares.solar,
    totalMw:       ctx.energySummary.totalMw,
  } : null;

  try {
    const res = await fetch('/api/intelligence/v1/france-intel-brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isnrScore,
        isnrComponents,
        cyberScore,
        meteoAlertCount,
        topHeadlines,
        signalCounts,
        energy,
        lang,
      }),
    });

    if (!res.ok) return { brief: null, freshness: 'fresh' };

    const payload = await res.json() as { brief: string | null; fromCache: boolean };
    const result: FranceBriefResult = {
      brief: payload.brief ?? null,
      freshness: payload.fromCache ? 'cached' : 'fresh',
    };

    // Only cache successful (non-null) briefs — a null result should not block for 2h
    if (result.brief !== null) {
      _cache.set(lang, { brief: result.brief, freshness: result.freshness, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    return result;
  } catch {
    return { brief: null, freshness: 'fresh' };
  }
}

/** Clear client-side brief cache (e.g. on lang toggle to force refetch). */
export function clearFranceBriefCache(lang?: 'fr' | 'en'): void {
  if (lang) {
    _cache.delete(lang);
  } else {
    _cache.clear();
  }
}
