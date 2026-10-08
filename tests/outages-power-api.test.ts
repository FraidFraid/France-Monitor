import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { IIP_PRODUCTION_URL, IIP_TRANSMISSION_URL, __resetPowerForTests } from '../api/_lib/outages-power.js';
import handler, { CACHE_CONTROL } from '../api/_handlers/outages/power.js';
import { callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';
import type { PowerOutagesResponse } from '../src/types/index.ts';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/outages/${name}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-08T20:00:00Z');
function route(url: string) {
  if (url.startsWith('https://opendata.edf.fr/data-fair/api/v1/datasets/indisponibilites-des-moyens-de-production-edf-sa/lines')) return respond(fx('edf-indispo-2026-10-08.json'));
  if (url === 'https://opendata.edf.fr/data-fair/api/v1/datasets/indisponibilites-des-moyens-de-production-edf-sa') return respond({ dataUpdatedAt: '2026-10-08T10:00:17.798Z' });
  if (url === IIP_PRODUCTION_URL) return respond(fx('iip-production-2026-10-08.xml'), 200, { 'content-type': 'application/xml' });
  if (url === IIP_TRANSMISSION_URL) return respond(fx('iip-transmission-2026-10-08.xml'), 200, { 'content-type': 'application/xml' });
  if (url.includes('/datasets/meteo-reseau-reunion/lines')) return respond(fx('sei-meteo-reseau-reunion-2026-10-08.json'));
  if (url.includes('/datasets/ecorsicawatt/lines')) return respond(fx('sei-ecorsicawatt-2026-10-08.json'));
  return respond('introuvable', 404);
}
beforeEach(() => {
  __resetSwrCacheForTests(); __resetKvForTests(); __resetPowerForTests();
  const store = new Map<string, string>();
  __setKvClientForTests({ get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => { store.set(k, v); } });
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
});
afterEach(() => { __setKvClientForTests(null); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('/api/outages/power', () => {
  it('200, forme exacte, cache de 5 min', async () => {
    stubFetch(route);
    const { status, body, cache } = await callHandler<PowerOutagesResponse>(handler);
    expect([status, cache]).toEqual([200, CACHE_CONTROL]);
    expect(CACHE_CONTROL).toBe('s-maxage=300, stale-while-revalidate=900');
    expect(Object.keys(body).sort()).toEqual(['edfReadAt', 'edfUpdatedAt', 'errors', 'history', 'iipPublishedAt', 'islands', 'planned', 'readAt', 'transmission', 'unplanned', 'upcoming']);
  });
  it('toutes les sources en panne, jamais lues : 502 de même forme, sans cache CDN', async () => {
    stubFetch(() => respond('panne', 503));
    const { status, body, cache } = await callHandler<PowerOutagesResponse>(handler);
    expect(status).toBe(502);
    expect(cache).toBe('no-store');
    expect(Object.keys(body).sort()).toEqual(['edfReadAt', 'edfUpdatedAt', 'errors', 'history', 'iipPublishedAt', 'islands', 'planned', 'readAt', 'transmission', 'unplanned', 'upcoming']);
    expect(body.unplanned).toEqual([]);
    expect(body.errors.length).toBeGreaterThanOrEqual(2);
  });
});
