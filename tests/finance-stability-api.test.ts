// tests/finance-stability-api.test.ts
// GET /api/finance/stability (spec 2026-10-12) : BCE + écart assemblés, pannes nommées dans `errors`, 502 non mis en cache
// quand aucune source n'a répondu ; route générée, OpenAPI, doc et test de fumée à jour.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import handler, { CACHE_CONTROL } from '../api/_handlers/finance/stability.js';
import type { FinancialStabilityResponse } from '../src/types/index.ts';
import { callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';

const NOW = Date.parse('2026-10-12T08:00:00Z');
const CSV = 'KEY,TIME_PERIOD,OBS_VALUE\nK,2026-10-08,0.05\nK,2026-10-09,0.06';
const SCAN = { data: [{ s: 'TVC:FR10Y', d: ['FR10Y', 4.9, 1] }, { s: 'TVC:DE10Y', d: ['DE10Y', 3.47, 0.2] }] };
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

beforeEach(() => {
  __resetSwrCacheForTests(); __resetKvForTests();
  __setKvClientForTests({ get: async () => null, set: async () => {} });
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __setKvClientForTests(null); __resetKvForTests(); });

describe('route', () => {
  it('tout répond : 200, six séries BCE, écart, aucune panne, cache 15 min', async () => {
    stubFetch((url) => (url.includes('tradingview') ? respond(SCAN) : respond(CSV)));
    const { status, body, cache } = await callHandler<FinancialStabilityResponse>(handler);
    expect(status).toBe(200);
    expect(cache).toBe(CACHE_CONTROL);
    expect(body.readAt).toBe('2026-10-12T08:00:00.000Z');
    expect(body.series.map((s) => [s.id, s.value, s.status])).toEqual([
      ['cissFr', 0.06, 'ok'], ['cissEa', 0.06, 'ok'], ['estr', 0.06, 'ok'], ['eurusd', 0.06, 'ok'],
    ]);
    expect(body.rates.map((r) => [r.id, r.value, r.previous])).toEqual([['depot', 0.06, 0.05], ['refi', 0.06, 0.05]]);
    expect(body.spread).toMatchObject({ value: 1.43, status: 'ok' });
    expect(body.errors).toEqual([]);
  });
  it('écart en panne seulement : 200, panne nommée', async () => {
    stubFetch((url) => (url.includes('tradingview') ? respond('x', 503) : respond(CSV)));
    const { status, body } = await callHandler<FinancialStabilityResponse>(handler);
    expect(status).toBe(200);
    expect(body.spread.status).toBe('unavailable');
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatch(/^Écart OAT-Bund/);
  });
  it('aucune source : 502 jamais mis en cache, même corps', async () => {
    stubFetch(() => respond('x', 503));
    const { status, body, cache } = await callHandler<FinancialStabilityResponse>(handler);
    expect(status).toBe(502);
    expect(cache).toBe('no-store');
    expect(body.errors).toHaveLength(7);
  });
});

describe('déclarations de production', () => {
  it('route générée, OpenAPI, doc et test de fumée', () => {
    expect(read('../api/_routes.js')).toContain("'/api/finance/stability': () => import('./_handlers/finance/stability.js')");
    const openapi = JSON.parse(read('../public/openapi.json')) as { paths: Record<string, unknown>; components: { schemas: Record<string, unknown> } };
    expect(openapi.paths['/api/finance/stability']).toBeDefined();
    expect(openapi.components.schemas.FinancialStabilityResponse).toBeDefined();
    expect(read('../docs/api.md')).toContain('`GET /api/finance/stability`');
    expect(read('../.github/workflows/smoke.yml')).toContain('"/api/finance/stability;200"');
  });
});
