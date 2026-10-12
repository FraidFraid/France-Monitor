// tests/finance-oat-bund.test.ts
// Écart OAT-Bund du bloc « Stabilité financière » (spec 2026-10-12) : TradingView FR10Y − DE10Y, rejet hors plage, un point par
// jour (Paris) gardé 400 jours, dernier relevé du jour gagnant, clé « dev: » en dev, Redis en panne sans perte de la valeur.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import { DE10Y, FR10Y, SPREAD_LOG_KEY, TV_SCAN_URL, loadSpread, parseSpread } from '../api/_lib/oat-bund.js';
import { respond, stubFetch } from './helpers/traffic-fixtures.ts';

const NOW = Date.parse('2026-10-12T08:00:00Z');
const scan = (fr: unknown, de: unknown) => ({ totalCount: 2, data: [{ s: FR10Y, d: ['FR10Y', fr, 1.1] }, { s: DE10Y, d: ['DE10Y', de, 0.3] }] });

function fakeRedis() {
  const store = new Map<string, { value: string; ttlSec: number }>();
  return {
    store,
    client: {
      get: async (key: string) => store.get(key)?.value ?? null,
      set: async (key: string, value: string, ttlSec: number) => { store.set(key, { value, ttlSec }); },
    },
  };
}

let redis = fakeRedis();
beforeEach(() => {
  __resetSwrCacheForTests(); __resetKvForTests(); redis = fakeRedis(); __setKvClientForTests(redis.client);
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); __setKvClientForTests(null); __resetKvForTests(); });

describe('lecture', () => {
  it('écart = FR10Y − DE10Y arrondi au centième', () => {
    expect(parseSpread(scan(4.8998, 3.4747))).toEqual({ fr10y: 4.8998, de10y: 3.4747, value: 1.43 });
  });
  it('taux absent ou non numérique : erreur', () => {
    expect(() => parseSpread({ data: [{ s: FR10Y, d: ['FR10Y', 4.9] }] })).toThrow(/absent/);
    expect(() => parseSpread(scan('4.9', 3.4))).toThrow(/absent/);
  });
  it('hors de [−1 ; 5] points : rejeté (mauvais symbole)', () => {
    expect(() => parseSpread(scan(9.5, 3.4))).toThrow(/hors plage/);
    expect(() => parseSpread(scan(1, 3))).toThrow(/hors plage/);
    expect(parseSpread(scan(8.4, 3.4)).value).toBe(5);
  });
});

describe('relève et point du jour', () => {
  it('POST sur le scanner, valeur et point du jour enregistré', async () => {
    const log = stubFetch(() => respond(scan(4.8998, 3.4747)));
    const spread = await loadSpread(NOW);
    expect(log.urls).toEqual([TV_SCAN_URL]);
    expect(log.inits[0]?.method).toBe('POST');
    expect(spread).toMatchObject({ value: 1.43, fr10y: 4.8998, de10y: 3.4747, status: 'ok', error: null, readAt: '2026-10-12T08:00:00.000Z' });
    expect(spread.history).toEqual([{ date: '2026-10-12', value: 1.43 }]);
    expect(redis.store.get(SPREAD_LOG_KEY)?.ttlSec).toBe(400 * 86_400);
  });
  it('deux relèves le même jour : un seul point, le dernier', async () => {
    stubFetch(() => respond(scan(4.8, 3.4)));
    await loadSpread(NOW);
    __resetSwrCacheForTests();
    vi.setSystemTime(NOW + 3_600_000);
    stubFetch(() => respond(scan(4.9, 3.4)));
    const spread = await loadSpread(NOW + 3_600_000);
    expect(spread.history).toEqual([{ date: '2026-10-12', value: 1.5 }]);
  });
  it('jours successifs : courbe chronologique, jour sans relève laissé vide', async () => {
    stubFetch(() => respond(scan(4.8, 3.4)));
    await loadSpread(NOW - 2 * 86_400_000);
    __resetSwrCacheForTests();
    stubFetch(() => respond(scan(4.9, 3.4)));
    const spread = await loadSpread(NOW);
    expect(spread.history).toEqual([{ date: '2026-10-10', value: 1.4 }, { date: '2026-10-12', value: 1.5 }]);
  });
  it('serveur de dev : clé préfixée « dev: »', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    stubFetch(() => respond(scan(4.8, 3.4)));
    await loadSpread(NOW);
    expect(redis.store.has(`dev:${SPREAD_LOG_KEY}`)).toBe(true);
    expect(redis.store.has(SPREAD_LOG_KEY)).toBe(false);
  });
  it('Redis en panne à l’écriture : la valeur du jour s’affiche quand même', async () => {
    __setKvClientForTests({ get: async () => null, set: async () => { throw new Error('Redis muet'); } });
    stubFetch(() => respond(scan(4.8, 3.4)));
    const spread = await loadSpread(NOW);
    expect(spread).toMatchObject({ value: 1.4, status: 'ok' });
  });
});

describe('pannes', () => {
  it('TradingView muet sans relevé connu : « unavailable », courbe déjà enregistrée gardée', async () => {
    stubFetch(() => respond(scan(4.8, 3.4)));
    await loadSpread(NOW - 86_400_000);
    __resetSwrCacheForTests();
    stubFetch(() => respond('erreur', 503));
    const spread = await loadSpread(NOW);
    expect(spread).toMatchObject({ value: null, status: 'unavailable', readAt: null });
    expect(spread.error).toMatch(/^Écart OAT-Bund \(TradingView\) : HTTP 503/);
    expect(spread.history).toEqual([{ date: '2026-10-11', value: 1.4 }]);
  });
  it('écart rejeté : « unavailable », jamais de valeur inventée', async () => {
    stubFetch(() => respond(scan(12, 3.4)));
    const spread = await loadSpread(NOW);
    expect(spread).toMatchObject({ value: null, status: 'unavailable' });
    expect(spread.error).toMatch(/hors plage/);
  });
});
