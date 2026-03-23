// src/services/isnr-synthesis.ts
// Frontend service: calls /api/intelligence/v1/synthesis and caches the result.

import type { NetworkBarometerResult } from './network-barometer.ts';
import type { NewsItem } from '../types/index.ts';

export interface ISNRSynthesisResult {
  briefing: string | null;
  stabilityImpact: number | null;
  fromCache: boolean;
  computedAt: Date;  // parsed from ISO string returned by the endpoint
}

const ENDPOINT = '/api/intelligence/v1/synthesis';
const CACHE_TTL_MS = 5 * 60_000;

let _cache: { data: ISNRSynthesisResult; ts: number } | null = null;

export async function fetchISNRSynthesis(
  barometer: NetworkBarometerResult,
  newsItems: NewsItem[],
): Promise<ISNRSynthesisResult | null> {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return _cache.data;
  }

  // Extract headlines: title + source name
  const headlines = newsItems.map(item =>
    `[${item.source}] ${item.title}`,
  );

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scores: barometer, headlines }),
    });

    if (!res.ok) {
      console.warn(`[isnr-synthesis] endpoint returned ${res.status}`);
      return null;
    }

    const data = await res.json() as {
      briefing: string | null;
      stabilityImpact: number | null;
      fromCache: boolean;
      computedAt: string;
    };

    const result: ISNRSynthesisResult = {
      briefing: data.briefing,
      stabilityImpact: data.stabilityImpact,
      fromCache: data.fromCache,
      computedAt: new Date(data.computedAt),  // ISO string → Date
    };

    _cache = { data: result, ts: Date.now() };
    return result;
  } catch (err) {
    console.warn('[isnr-synthesis] fetch failed', err);
    return null;
  }
}
