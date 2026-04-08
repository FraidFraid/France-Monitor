// src/services/france-intel-brief.ts
import type { FranceIntelData, ISNRDimensionScores } from '../types/index.ts';

interface BriefCacheEntry {
  brief: string | null;
  freshness: 'fresh' | 'cached';
  expiresAt: number;
}

// In-memory cache keyed by lang
const _cache = new Map<'fr' | 'en', BriefCacheEntry>();
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2h

/** Compute national average of an ISNR dimension across all departments. */
function avgDim(
  scores: FranceIntelData['stability']['scores'],
  key: keyof ISNRDimensionScores,
): number {
  if (scores.length === 0) return 0;
  const sum = scores.reduce((acc, s) => acc + (s.dimensions?.[key] ?? 0), 0);
  return Math.round(sum / scores.length);
}

export interface FranceBriefResult {
  brief: string | null;
  freshness: 'fresh' | 'cached';
}

export async function fetchFranceIntelBrief(
  data: FranceIntelData,
  lang: 'fr' | 'en' = 'fr',
): Promise<FranceBriefResult> {
  // Check client-side cache
  const cached = _cache.get(lang);
  if (cached && Date.now() < cached.expiresAt) {
    return { brief: cached.brief, freshness: 'cached' };
  }

  const isnrScore = data.stability.nationalScore;
  const isnrComponents = {
    social:   avgDim(data.stability.scores, 'social'),
    security: avgDim(data.stability.scores, 'security'),
    infra:    avgDim(data.stability.scores, 'infra'),
  };
  const cyberScore      = data.cyber.meta.globalScore;
  const meteoAlertCount = data.meteo.filter(a => a.level === 'orange' || a.level === 'red' || a.level === 'violet').length;
  const topHeadlines    = data.topNews.slice(0, 6).map(n => n.title);
  const signalCounts = data.operational;
  const energy = data.energy ? {
    ecowattSignal: data.energy.ecowattSignal,
    nuclearShare: data.energy.shares.nuclear,
    gasShare: data.energy.shares.gas,
    hydroShare: data.energy.shares.hydro,
    windShare: data.energy.shares.wind,
    solarShare: data.energy.shares.solar,
    totalMw: data.energy.totalMw,
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
