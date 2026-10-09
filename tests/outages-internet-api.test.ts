import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { IODA_BASE, __resetInternetForTests } from '../api/_lib/outages-internet.js';
import handler, { CACHE_CONTROL, PENDING_CACHE_CONTROL, loadInternet } from '../api/_handlers/outages/internet.js';
import { internetRoute as route } from './helpers/outages-b-fixtures.ts';
import { callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';
import type { InternetOutagesResponse } from '../src/types/index.ts';

const NOW = Date.parse('2026-10-08T20:30:00Z');
const KEYS = ['errors', 'events', 'iodaReadAt', 'radar', 'readAt', 'ripe'];

beforeEach(() => {
  __resetSwrCacheForTests(); __resetKvForTests(); __resetInternetForTests();
  const store = new Map<string, string>();
  __setKvClientForTests({ get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => { store.set(k, v); } });
  vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', '');
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
});
afterEach(() => { __setKvClientForTests(null); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('/api/outages/internet', () => {
  it('200, forme exacte, cache de 5 min', async () => {
    stubFetch(route);
    const { status, body, cache } = await callHandler<InternetOutagesResponse>(handler);
    expect([status, cache]).toEqual([200, CACHE_CONTROL]);
    expect(CACHE_CONTROL).toBe('s-maxage=300, stale-while-revalidate=900');
    expect(Object.keys(body).sort()).toEqual(KEYS);
    expect(body.iodaReadAt).toBe('2026-10-08T20:30:00.000Z');
    expect(body.radar).toEqual({ configured: false, readAt: null, items: [] });
  });
  it('IODA en panne et jamais lu : 502 de même forme, sans cache CDN, première erreur nommée IODA', async () => {
    stubFetch((url) => (url.startsWith(IODA_BASE) ? respond('panne', 503) : route(url)));
    const { status, body, cache } = await callHandler<InternetOutagesResponse>(handler);
    expect(status).toBe(502);
    expect(cache).toBe('no-store');
    expect(Object.keys(body).sort()).toEqual(KEYS);
    expect(body.iodaReadAt).toBeNull();
    expect(body.events).toEqual([]);
    expect(body.errors[0]).toMatch(/^IODA/);
  });
  it('échéance dépassée, rien de gardé : réponse vide avec la note, cache court, 502', async () => {
    stubFetch(() => new Promise(() => {}));
    const body = await loadInternet(NOW, { budgetMs: 5 });
    expect(body.iodaReadAt).toBeNull();
    expect(body.errors).toEqual(['Internet : collecte en cours']);
    expect(PENDING_CACHE_CONTROL).toBe('s-maxage=60, stale-while-revalidate=120');
  });
  it('échéance dépassée, relevé gardé : relevé servi avec la note, 200 et cache court', async () => {
    const log = stubFetch(route);
    await callHandler<InternetOutagesResponse>(handler);
    expect(log.urls.length).toBeGreaterThan(0);
    stubFetch(() => new Promise(() => {}));
    vi.setSystemTime(NOW + 11 * 60_000);
    const body = await loadInternet(NOW + 11 * 60_000, { budgetMs: 5 });
    expect(body.iodaReadAt).toBe('2026-10-08T20:30:00.000Z');
    expect(body.errors).toEqual(['Internet : collecte en cours']);
  });
});
