import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetKvForTests, __setKvClientForTests, appendSample, incrementCounter, isDevServer, kvGetJson, kvReadJson, kvSetJson, readLog, readSeries, upsertLogEntry,
} from '../api/_lib/kv-history.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-03T13:10:00Z');

/** Redis simulé : valeurs et durées gardées pour vérifier ce qui est écrit. */
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

type Sample = { at: string; airborneZone: number };
type Entry = { icao24: string; squawk: string; firstSeen: string; lastSeen: string };

beforeEach(() => { __resetKvForTests(); __setKvClientForTests(fakeRedis().client); });
afterEach(() => { vi.unstubAllEnvs(); __setKvClientForTests(null); __resetKvForTests(); });

describe('valeurs JSON', () => {
  it('écrites en mémoire et dans Redis (avec la durée) ; relues depuis Redis après un redémarrage', async () => {
    const redis = fakeRedis();
    __setKvClientForTests(redis.client);
    await kvSetJson('traffic:test', { a: 1 }, 600, NOW);
    expect(redis.store.get('traffic:test')).toEqual({ value: '{"a":1}', ttlSec: 600 });
    __resetKvForTests();
    expect(await kvGetJson('traffic:test', NOW)).toEqual({ a: 1 });
  });
  it('serveur de dev (mêmes identifiants Upstash que la production) : clés préfixées « dev: »', async () => {
    const redis = fakeRedis();
    __setKvClientForTests(redis.client);
    vi.stubEnv('NODE_ENV', 'development');
    await kvSetJson('traffic:tomtom:incidents:2026-10-03', 14, 60, NOW);
    expect([...redis.store.keys()]).toEqual(['dev:traffic:tomtom:incidents:2026-10-03']);
  });
  it('Redis absent ou en panne : la mémoire du processus sert de repli', async () => {
    __setKvClientForTests({ get: async () => { throw new Error('Upstash muet'); }, set: async () => { throw new Error('Upstash muet'); } });
    await kvSetJson('traffic:test', 42, 60, NOW);
    expect(await kvGetJson('traffic:test', NOW)).toBe(42);
    expect(await kvGetJson('traffic:test', NOW + 61_000)).toBeNull();
  });
});

describe('lecture qui distingue clé absente et panne de Redis (collectes à quota)', () => {
  it('valeur en mémoire ou dans Redis ; clé absente ; JSON illisible traité comme absent', async () => {
    const redis = fakeRedis();
    __setKvClientForTests(redis.client);
    expect(await kvReadJson('traffic:test', NOW)).toEqual({ value: null, failed: false });
    await kvSetJson('traffic:test', { a: 1 }, 600, NOW);
    __resetKvForTests();
    expect(await kvReadJson('traffic:test', NOW)).toEqual({ value: { a: 1 }, failed: false });
    redis.store.set('traffic:abime', { value: '{abîmé', ttlSec: 60 });
    expect(await kvReadJson('traffic:abime', NOW)).toEqual({ value: null, failed: false });
  });
  it('Redis en panne : `failed` vrai ; kvGetJson garde son comportement (null, sans erreur)', async () => {
    __setKvClientForTests({ get: async () => { throw new Error('Upstash injoignable'); }, set: async () => {} });
    expect(await kvReadJson('traffic:test', NOW)).toEqual({ value: null, failed: true });
    expect(await kvGetJson('traffic:test', NOW)).toBeNull();
  });
  it('serveur de dev : même critère que le préfixe « dev: »', () => {
    expect(isDevServer()).toBe(false);
    vi.stubEnv('NODE_ENV', 'development');
    expect(isDevServer()).toBe(true);
  });
});

describe('séries horodatées (volume aérien, 8 jours)', () => {
  it('ajout dans l’ordre, échantillons de plus de 8 jours retirés', async () => {
    __setKvClientForTests(fakeRedis().client);
    const opts = { maxAgeMs: 8 * DAY, now: NOW };
    await appendSample('v', { at: new Date(NOW - 9 * DAY).toISOString(), airborneZone: 900 }, { ...opts, now: NOW - 9 * DAY });
    await appendSample('v', { at: new Date(NOW - DAY).toISOString(), airborneZone: 1250 }, opts);
    const { appended, samples } = await appendSample('v', { at: new Date(NOW).toISOString(), airborneZone: 1301 }, opts);
    expect(appended).toBe(true);
    expect((samples as Sample[]).map((s) => s.airborneZone)).toEqual([1250, 1301]);
    expect((await readSeries('v', opts) as Sample[]).length).toBe(2);
  });
  it('un échantillon moins de 10 min après le précédent est ignoré', async () => {
    const opts = { maxAgeMs: 8 * DAY, minIntervalMs: 10 * 60_000, now: NOW };
    await appendSample('v2', { at: new Date(NOW - 5 * 60_000).toISOString(), airborneZone: 1 }, opts);
    const r = await appendSample('v2', { at: new Date(NOW).toISOString(), airborneZone: 2 }, opts);
    expect(r.appended).toBe(false);
    expect(r.samples).toHaveLength(1);
  });
  it('date illisible : RangeError, rien d’écrit', async () => {
    await expect(appendSample('v3', { at: 'hier', airborneZone: 1 }, { maxAgeMs: DAY, now: NOW })).rejects.toThrow(RangeError);
    expect(await readSeries('v3', { maxAgeMs: DAY, now: NOW })).toEqual([]);
  });
});

describe('journal borné (urgences, 7 jours)', () => {
  const opts = {
    idOf: (e: Entry) => `${e.icao24}:${e.squawk}`,
    dateOf: (e: Entry) => e.lastSeen,
    merge: (old: Entry, next: Entry): Entry => ({ ...next, firstSeen: old.firstSeen }),
    maxAgeMs: 7 * DAY,
    now: NOW,
  };
  it('même aéronef et même code : première vue gardée, dernière vue mise à jour', async () => {
    await upsertLogEntry('e', { icao24: '39de4f', squawk: '7700', firstSeen: '2026-10-03T13:00:00Z', lastSeen: '2026-10-03T13:00:00Z' }, opts);
    const log = await upsertLogEntry('e', { icao24: '39de4f', squawk: '7700', firstSeen: '2026-10-03T13:08:00Z', lastSeen: '2026-10-03T13:08:00Z' }, opts);
    expect(log).toEqual([{ icao24: '39de4f', squawk: '7700', firstSeen: '2026-10-03T13:00:00Z', lastSeen: '2026-10-03T13:08:00Z' }]);
  });
  it('entrées de plus de 7 jours retirées, plus récente d’abord', async () => {
    await upsertLogEntry('e2', { icao24: 'a', squawk: '7600', firstSeen: '2026-09-25T10:00:00Z', lastSeen: '2026-09-25T10:00:00Z' }, opts);
    await upsertLogEntry('e2', { icao24: 'b', squawk: '7700', firstSeen: '2026-10-01T10:00:00Z', lastSeen: '2026-10-01T10:00:00Z' }, opts);
    await upsertLogEntry('e2', { icao24: 'c', squawk: '7500', firstSeen: '2026-10-03T10:00:00Z', lastSeen: '2026-10-03T10:00:00Z' }, opts);
    expect((await readLog('e2', opts)).map((e) => e.icao24)).toEqual(['c', 'b']);
  });
});

describe('compteurs de quota', () => {
  it('additionne ; la clé du jour est écrite pour 48 h', async () => {
    const redis = fakeRedis();
    __setKvClientForTests(redis.client);
    expect(await incrementCounter('traffic:tomtom:incidents:2026-10-03', 14, 172_800, NOW)).toBe(14);
    expect(await incrementCounter('traffic:tomtom:incidents:2026-10-03', 14, 172_800, NOW)).toBe(28);
    expect(redis.store.get('traffic:tomtom:incidents:2026-10-03')).toEqual({ value: '28', ttlSec: 172_800 });
  });
});
