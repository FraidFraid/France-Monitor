// src/services/isnr-synthesis.ts
// Frontend service: calls /api/intelligence/v1/synthesis and caches the result.

import type { NetworkBarometerResult } from './network-barometer.ts';
import type { NewsItem } from '../types/index.ts';

/** Minimal dept context forwarded to the AI prompt */
export interface ISNRDeptContext {
  name: string;
  score: number;
  social: number;
  security: number;
}

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
  isnrNationalScore?: number,
  isnrDepts?: ISNRDeptContext[],
): Promise<ISNRSynthesisResult | null> {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return _cache.data;
  }

  // Extract enriched headlines: [category/level] title (source)
  const headlines = newsItems.map(item => {
    const cat = item.threat?.category ?? '';
    const lvl = item.threat?.level ?? '';
    const prefix = cat && lvl ? `[${cat}/${lvl}]` : '';
    const src = item.source ? `(${item.source})` : '';
    return [prefix, item.title, src].filter(Boolean).join(' ');
  });

  try {
    const body: Record<string, unknown> = { scores: barometer, headlines };
    if (isnrNationalScore !== undefined) {
      body.isnrNationalScore = isnrNationalScore;
    }
    if (isnrDepts && isnrDepts.length > 0) {
      body.isnrDepts = isnrDepts;
    }

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
