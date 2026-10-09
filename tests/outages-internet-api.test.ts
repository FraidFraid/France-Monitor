import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { IODA_BASE, INTERNET_PENDING_NOTE, __resetInternetForTests } from '../api/_lib/outages-internet.js';
import { ROUTE_BUDGET_MS } from '../api/_lib/route-budget.js';
import handler, { CACHE_CONTROL, PENDING_CACHE_CONTROL } from '../api/_handlers/outages/internet.js';
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
  /** Appelle la route avec une collecte qui ne répond jamais, puis fait expirer l'échéance de 15 s. */
  async function callPastBudget(at: number) {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(at);
    stubFetch(() => new Promise(() => {}));
    const pending = callHandler<InternetOutagesResponse>(handler);
    await vi.advanceTimersByTimeAsync(ROUTE_BUDGET_MS + 1);
    return pending;
  }
  it('échéance de 15 s dépassée, rien de gardé : route en 502 de même forme, note « collecte en cours », jamais mise en cache', async () => {
    const { status, body, cache } = await callPastBudget(NOW);
    expect([status, cache]).toEqual([502, 'no-store']);
    expect(Object.keys(body).sort()).toEqual(KEYS);
    expect(body.iodaReadAt).toBeNull();
    expect(body.errors).toEqual([INTERNET_PENDING_NOTE]);
  });
  it('échéance de 15 s dépassée, relevé gardé : 200, relevé servi avec la note, cache court de 60 s', async () => {
    stubFetch(route);
    await callHandler<InternetOutagesResponse>(handler);
    __resetSwrCacheForTests();
    const { status, body, cache } = await callPastBudget(NOW + 11 * 60_000);
    expect([status, cache]).toEqual([200, PENDING_CACHE_CONTROL]);
    expect(PENDING_CACHE_CONTROL).toBe('s-maxage=60, stale-while-revalidate=120');
    expect(body.iodaReadAt).toBe('2026-10-08T20:30:00.000Z');
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.errors).toEqual([INTERNET_PENDING_NOTE]);
  });
});
