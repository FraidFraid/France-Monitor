import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetKvForTests, __setKvClientForTests, kvSetJson } from '../api/_lib/kv-history.js';
import { FLOW_BUDGET, URBAN_FRAMES } from '../api/_lib/tomtom-urban.js';
import handler, { CACHE_CONTROL } from '../api/_handlers/traffic/road-urban.js';
import flowHandler from '../api/_handlers/traffic/flow.js';
import type { RoadUrbanResponse } from '../src/types/index.ts';
import { callHandler, fixtureJson, fixtureText, respond, stubFetch } from './helpers/traffic-fixtures.ts';

const NOW = Date.parse('2026-10-03T14:00:00+02:00');
const LYON = fixtureJson<object>('tomtom-lyon-ouest-cat6.json');

beforeEach(() => {
  __resetKvForTests();
  __setKvClientForTests({ get: async () => null, set: async () => {} });
  vi.stubEnv('VITE_TOMTOM_API_KEY', '');
  vi.stubEnv('TOMTOM_API_KEY', 'cle-de-test');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); __setKvClientForTests(null); __resetKvForTests(); });

describe('/api/traffic/road-urban', () => {
  it('200, cache 5 min, 12 agglomérations datées de la collecte, quota du jour', async () => {
    stubFetch((url) => (url.includes('bbox=4.7') || url.includes('bbox=4.86') ? respond(LYON) : respond({ incidents: [] })));
    const { status, body, cache } = await callHandler<RoadUrbanResponse>(handler);
    expect([status, cache]).toEqual([200, CACHE_CONTROL]);
    expect(body.agglos).toHaveLength(12);
    expect(body.agglos.every((a) => a.collectedAt === '2026-10-03T12:00:00.000Z')).toBe(true);
    expect(body.quota).toEqual({ callsToday: URBAN_FRAMES.length, limit: 2500 });
  });
  it('aucune collecte réussie (clé refusée) : 502 non mis en cache, erreurs nommées', async () => {
    stubFetch(() => respond(fixtureText('tomtom-401.json'), 401));
    const { status, body, cache } = await callHandler<RoadUrbanResponse>(handler);
    expect([status, cache]).toEqual([502, 'no-store']);
    expect(body.collectedAt).toBeNull();
    expect(body.errors).toContain('TomTom, Marseille : HTTP 401');
  });
});

describe('/api/traffic/flow : budget serveur journalier', () => {
  it('sous le budget : appel TomTom identifié ; budget atteint : 429 sans appel', async () => {
    const log = stubFetch(() => respond({ flowSegmentData: { currentSpeed: 16, freeFlowSpeed: 24 } }));
    const ok = await callHandler(flowHandler, { point: '45.764,4.8357', zoom: '10' });
    expect(ok.status).toBe(200);
    expect(log.urls).toHaveLength(1);
    await kvSetJson('traffic:tomtom:flow:2026-10-03', FLOW_BUDGET, 172_800, NOW);
    const refused = await callHandler<{ error: string }>(flowHandler, { point: '45.764,4.8357', zoom: '10' });
    expect([refused.status, refused.cache, refused.body.error]).toEqual([429, 'no-store', 'Budget TomTom du jour atteint pour le survol des tronçons']);
    expect(log.urls).toHaveLength(1);
  });
});
