// src/services/drom-live.ts : production par filière des DROM et de la Corse (route /api/energy/drom-live,
// EDF SEI, spec 2026-10-02 lot 2 § 2.2). Cache 5 min, aligné sur le pas EDF et le cache CDN.
import type { DromLiveResponse } from '../types/index.ts';

const DROM_LIVE_URL = '/api/energy/drom-live';
const TTL_MS = 5 * 60_000;
let cache: { data: DromLiveResponse; at: number } | null = null;

export function isDromLiveResponse(value: unknown): value is DromLiveResponse {
  if (!value || typeof value !== 'object') return false;
  const v = value as { fetchedAt?: unknown; territories?: unknown };
  return typeof v.fetchedAt === 'number' && Array.isArray(v.territories) && v.territories.every((t: unknown) => {
    if (!t || typeof t !== 'object') return false;
    const x = t as { code?: unknown; state?: unknown; mix?: unknown; day?: unknown };
    return typeof x.code === 'string' && (x.state === 'ok' || x.state === 'error') && typeof x.mix === 'object' && Array.isArray(x.day);
  });
}

export async function fetchDromLive(now: number = Date.now()): Promise<DromLiveResponse> {
  if (cache && now - cache.at < TTL_MS) return cache.data;
  const resp = await fetch(DROM_LIVE_URL, { signal: AbortSignal.timeout(12_000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json: unknown = await resp.json();
  if (!isDromLiveResponse(json)) throw new Error('réponse inattendue');
  cache = { data: json, at: now };
  return json;
}

/** Tests seulement : vide le cache. */
export function resetDromLiveCache(): void {
  cache = null;
}
