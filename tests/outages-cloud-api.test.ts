import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { CLOUD_PENDING_NOTE, CLOUD_PROVIDER_ORDER, OVH_STATUS_PAGES, SCALEWAY_SUMMARY_URL, __resetCloudForTests } from '../api/_lib/outages-cloud.js';
import { PARTIAL_CACHE_CONTROL } from '../api/_lib/health-http.js';
import { ROUTE_BUDGET_MS } from '../api/_lib/route-budget.js';
import handler, { CACHE_CONTROL, PENDING_CACHE_CONTROL } from '../api/_handlers/outages/cloud.js';
import { cloudRoute as route } from './helpers/outages-b-fixtures.ts';
import { callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';
import type { CloudOutagesResponse } from '../src/types/index.ts';

const NOW = Date.parse('2026-10-08T20:00:00Z');
const KEYS = ['elsewhere', 'errors', 'incidents', 'maintenances', 'providers', 'readAt', 'reference'];
const STATUS_PAGE_HOSTS = /status-ovhcloud\.com|status\.scaleway\.com|status\.outscale\.com|cloudflarestatus\.com|status\.cloud\.google\.com|status\.aws\.amazon\.com/;

beforeEach(() => {
  __resetSwrCacheForTests(); __resetKvForTests(); __resetCloudForTests();
  const store = new Map<string, string>();
  __setKvClientForTests({ get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => { store.set(k, v); } });
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
});
afterEach(() => { __setKvClientForTests(null); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('/api/outages/cloud', () => {
  it('200, forme exacte, sept fournisseurs dans l’ordre du contrat, cache de 15 min', async () => {
    stubFetch(route);
    const { status, body, cache } = await callHandler<CloudOutagesResponse>(handler);
    expect([status, cache]).toEqual([200, CACHE_CONTROL]);
    expect(CACHE_CONTROL).toBe('s-maxage=900, stale-while-revalidate=1800');
    expect(Object.keys(body).sort()).toEqual(KEYS);
    expect(body.providers.map((p) => p.provider)).toEqual(CLOUD_PROVIDER_ORDER);
    expect(body.readAt).toBe('2026-10-08T20:00:00.000Z');
    expect(body.providers.filter((p) => p.readAt !== null)).toHaveLength(6);
    expect(body.providers.find((p) => p.provider === 'azure')?.readAt).toBeNull();
  });
  it('un seul fournisseur lu suffit : 200 au cache partiel de 5 min (erreurs servies), les autres n.d. avec leur erreur nommée', async () => {
    stubFetch((url) => (url === SCALEWAY_SUMMARY_URL || !STATUS_PAGE_HOSTS.test(url) ? route(url) : respond('panne', 503)));
    const { status, body, cache } = await callHandler<CloudOutagesResponse>(handler);
    expect([status, cache]).toEqual([200, PARTIAL_CACHE_CONTROL]);
    expect(body.providers.filter((p) => p.readAt !== null).map((p) => p.provider)).toEqual(['scaleway']);
    expect(body.providers.find((p) => p.provider === 'ovhcloud')?.error).toMatch(/^OVHcloud \(public-cloud\)/);
  });
  it('toutes les pages d’état en 503 : 502 sans cache de même forme, aucun fournisseur lu, erreur nommée par fournisseur', async () => {
    stubFetch((url) => (STATUS_PAGE_HOSTS.test(url) ? respond('panne', 503) : route(url)));
    const { status, body, cache } = await callHandler<CloudOutagesResponse>(handler);
    expect(status).toBe(502);
    expect(cache).toBe('no-store');
    expect(Object.keys(body).sort()).toEqual(KEYS);
    expect(body.readAt).toBeNull();
    expect(body.providers.every((p) => p.readAt === null && p.zones.length === 0)).toBe(true);
    for (const page of ['public-cloud', 'web-cloud', 'network', 'bare-metal-servers']) {
      expect(body.errors.some((e) => e.startsWith(`OVHcloud (${page}) :`))).toBe(true);
    }
    for (const name of ['Scaleway', 'Outscale', 'Cloudflare', 'Google Cloud', 'AWS']) {
      expect(body.errors.some((e) => e.startsWith(`${name} :`))).toBe(true);
    }
    expect(OVH_STATUS_PAGES).toHaveLength(4);
  });
  /** Appelle la route avec des sources qui ne répondent jamais, puis fait expirer l'échéance de 15 s. */
  async function callPastBudget(at: number) {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(at);
    stubFetch(() => new Promise(() => {}));
    const pending = callHandler<CloudOutagesResponse>(handler);
    await vi.advanceTimersByTimeAsync(ROUTE_BUDGET_MS + 1);
    return pending;
  }
  it('échéance de 15 s dépassée, rien de gardé : route en 502 de même forme, note « collecte en cours », jamais mise en cache', async () => {
    const { status, body, cache } = await callPastBudget(NOW);
    expect([status, cache]).toEqual([502, 'no-store']);
    expect(Object.keys(body).sort()).toEqual(KEYS);
    expect(body.readAt).toBeNull();
    expect(body.errors).toEqual([CLOUD_PENDING_NOTE]);
  });
  it('échéance de 15 s dépassée, relevé gardé : 200, relevé servi avec la note, cache court de 60 s', async () => {
    stubFetch(route);
    await callHandler<CloudOutagesResponse>(handler);
    __resetSwrCacheForTests();
    const { status, body, cache } = await callPastBudget(NOW + 31 * 60_000);
    expect([status, cache]).toEqual([200, PENDING_CACHE_CONTROL]);
    expect(PENDING_CACHE_CONTROL).toBe('s-maxage=60, stale-while-revalidate=120');
    expect(body.readAt).toBe('2026-10-08T20:00:00.000Z');
    expect(body.providers.filter((p) => p.readAt !== null).length).toBeGreaterThan(0);
    expect(body.errors).toContain(CLOUD_PENDING_NOTE);
  });
});
