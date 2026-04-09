// src/services/france-intel-brief.ts
import type { FranceBriefContext } from '../types/index.ts';

interface BriefCacheEntry {
  brief: string | null;
  freshness: 'fresh' | 'cached';
  expiresAt: number;
}

const PROMPT_VERSION = 'v10';
const _cache = new Map<string, BriefCacheEntry>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 h

function hashCacheSeed(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function buildClientCacheKey(ctx: FranceBriefContext, lang: 'fr' | 'en'): string {
  return `${PROMPT_VERSION}:${lang}:${hashCacheSeed(JSON.stringify({
    score: ctx.score,
    axes: ctx.axes,
    isnrComponents: ctx.isnrComponents,
    cyberScore: ctx.cyberScore,
    signals: ctx.signals,
    topHeadlines: ctx.topHeadlines,
    energySummary: ctx.energySummary,
  }))}`;
}

export interface FranceBriefResult {
  brief: string | null;
  freshness: 'fresh' | 'cached';
}

export async function fetchFranceIntelBrief(
  ctx: FranceBriefContext,
  lang: 'fr' | 'en' = 'fr',
): Promise<FranceBriefResult> {
  const cacheKey = buildClientCacheKey(ctx, lang);
  // Check client-side cache
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return { brief: cached.brief, freshness: 'cached' };
  }

  const countryScore   = ctx.score;
  const axes = ctx.axes;
  const isnrComponents = ctx.isnrComponents;
  const cyberScore     = ctx.cyberScore;
  const meteoAlertCount = ctx.signals.meteoAlerts;
  const topHeadlines   = ctx.topHeadlines;
  const energy = ctx.energySummary ? {
    ecowattSignal: ctx.energySummary.ecowattSignal,
    nuclearShare:  ctx.energySummary.shares.nuclear,
    gasShare:      ctx.energySummary.shares.gas,
    hydroShare:    ctx.energySummary.shares.hydro,
    windShare:     ctx.energySummary.shares.wind,
    solarShare:    ctx.energySummary.shares.solar,
    totalMw:       ctx.energySummary.totalMw,
    oilStocksDays: ctx.energySummary.oilStocksDays,
    oilVigilanceStatus: ctx.energySummary.oilVigilanceStatus,
    fuelTensionLevel: ctx.energySummary.fuelTensionLevel,
    fuelTensionAnomalyShare: ctx.energySummary.fuelTensionAnomalyShare,
  } : null;

  try {
    const res = await fetch('/api/intelligence/v1/france-intel-brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        countryScore,
        axes,
        isnrComponents,
        cyberScore,
        meteoAlertCount,
        topHeadlines,
        signalCounts: {
          criticalNews:          ctx.signals.criticalNews,
          highNews:              ctx.signals.highNews,
          weatherAlerts:         ctx.signals.meteoAlerts,   // API contract uses "weatherAlerts"
          floodAlerts:           ctx.signals.floodAlerts,
          fireDetections:        ctx.signals.fireDetections,
          railDisruptions:       ctx.signals.railDisruptions,
          roadIncidents:         ctx.signals.roadIncidents,
          powerOutages:          ctx.signals.powerOutages,
          telecomOutages:        ctx.signals.telecomOutages,
          cyberAlerts:           ctx.signals.cyberAlerts,
          militaryFlights:       ctx.signals.militaryFlights,
          maritimeTrafficFrance: ctx.signals.maritimeTrafficFrance,
          defenseAlerts:         ctx.signals.defenseAlerts,
          jammingSignals:        ctx.signals.jammingSignals,
          marketStress:          ctx.signals.marketStress,
        },
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
      _cache.set(cacheKey, { brief: result.brief, freshness: result.freshness, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    return result;
  } catch {
    return { brief: null, freshness: 'fresh' };
  }
}

/** Clear client-side brief cache (e.g. on lang toggle to force refetch). */
export function clearFranceBriefCache(lang?: 'fr' | 'en'): void {
  if (lang) {
    for (const key of _cache.keys()) {
      if (key.includes(`:${lang}:`)) _cache.delete(key);
    }
  } else {
    _cache.clear();
  }
}
