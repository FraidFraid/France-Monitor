import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { ARCEP_DATASET_URL, __resetTelecomForTests, arcepFileUrl } from '../api/_lib/outages-telecom.js';
import handler, { CACHE_CONTROL, loadTelecom } from '../api/_handlers/outages/telecom.js';
import { callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';
import type { TelecomOutagesResponse } from '../src/types/index.ts';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/outages/${name}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-08T20:00:00Z');
const CATALOG = { resources: [
  { title: '2026-10-08.geojson', format: 'geojson', url: arcepFileUrl('2026-10-08'), last_modified: '2026-10-08T09:02:20+00:00' },
  { title: '2026-10-07.geojson', format: 'geojson', url: arcepFileUrl('2026-10-07'), last_modified: '2026-10-07T09:02:12+00:00' },
] };
const ok = (url: string) => {
  if (url === ARCEP_DATASET_URL) return respond(CATALOG);
  if (url === arcepFileUrl('2026-10-08')) return respond(fx('arcep-2026-10-08.geojson'), 200, { 'last-modified': 'Thu, 08 Oct 2026 09:02:20 GMT' });
  if (url === arcepFileUrl('2026-10-07')) return respond(fx('arcep-2026-10-07.geojson'), 200, { 'last-modified': 'Wed, 07 Oct 2026 09:02:12 GMT' });
  return respond('introuvable', 404);
};

beforeEach(() => {
  __resetSwrCacheForTests(); __resetKvForTests(); __resetTelecomForTests();
  const store = new Map<string, string>();
  __setKvClientForTests({ get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => { store.set(k, v); } });
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
});
afterEach(() => { __setKvClientForTests(null); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('/api/outages/telecom', () => {
  it('200 avec le fichier du jour, cache CDN de 10 min', async () => {
    stubFetch(ok);
    const { status, body, cache } = await callHandler<TelecomOutagesResponse>(handler);
    expect(status).toBe(200);
    expect(cache).toBe(CACHE_CONTROL);
    expect(body.summary?.recent).toBe(18);
    expect(Object.keys(body).sort()).toEqual(['byDept', 'byOperator', 'errors', 'file', 'history', 'previousFile', 'readAt', 'sites', 'summary']);
  });
  it('jamais lu et ARCEP en panne : 502 de même forme, erreur nommée', async () => {
    stubFetch(() => respond('panne', 503));
    const { status, body } = await callHandler<TelecomOutagesResponse>(handler);
    expect(status).toBe(502);
    expect(body.summary).toBeNull();
    expect(body.errors[0]).toMatch(/^ARCEP/);
  });
  it('échéance dépassée pendant une collecte : relevé gardé avec la note « ARCEP : lecture en cours »', async () => {
    stubFetch(ok);
    await loadTelecom(NOW);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    stubFetch(async (url) => { await gate; return ok(url); });
    const body = await loadTelecom(NOW + 31 * 60_000, { budgetMs: 5 });
    expect(body.file?.day).toBe('2026-10-08');
    expect(body.errors).toContain('ARCEP : lecture en cours');
    release();
  });
});
