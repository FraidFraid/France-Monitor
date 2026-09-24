import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';

import { getOrRefresh, __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';

/** Redis stub en mémoire — simule api/_utils/redis.js sans dépendre de l'environnement. */
function createFakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string, _ttlSec: number) {
      store.set(key, value);
    },
  };
}

/** Redis absent — reproduit exactement api/_utils/redis.js quand UPSTASH_* n'est pas configuré. */
const NO_REDIS = {
  async get() {
    return null;
  },
  async set() {
    // no-op
  },
};

function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

beforeEach(() => {
  __resetSwrCacheForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('swr-cache · getOrRefresh (Redis absent, mémoire seule)', () => {
  it('appelle le producer une seule fois puis sert le cache mémoire tant que frais', async () => {
    let calls = 0;
    const producer = async () => {
      calls += 1;
      return `v${calls}`;
    };

    const first = await getOrRefresh('k1', { ttlSec: 10, redis: NO_REDIS }, producer);
    assert.equal(first.cache, 'miss');
    assert.equal(first.value, 'v1');
    assert.equal(calls, 1);

    const second = await getOrRefresh('k1', { ttlSec: 10, redis: NO_REDIS }, producer);
    assert.equal(second.cache, 'hit');
    assert.equal(second.value, 'v1');
    assert.equal(calls, 1, 'le producer ne doit pas être rappelé tant que la valeur est fraîche');
  });

  it('rafraîchit après expiration du TTL quand il n\'y a pas de fenêtre stale', async () => {
    let calls = 0;
    const producer = async () => {
      calls += 1;
      return `v${calls}`;
    };

    await getOrRefresh('k2', { ttlSec: 10, redis: NO_REDIS }, producer);
    await vi.advanceTimersByTimeAsync(11_000);

    const result = await getOrRefresh('k2', { ttlSec: 10, redis: NO_REDIS }, producer);
    assert.equal(result.cache, 'miss');
    assert.equal(result.value, 'v2');
    assert.equal(calls, 2);
  });

  it('propage l\'erreur du producer quand aucune valeur de repli n\'existe', async () => {
    const producer = async () => {
      throw new Error('boom');
    };

    await assert.rejects(
      getOrRefresh('k3', { ttlSec: 10, redis: NO_REDIS }, producer),
      /boom/,
    );
  });

  it('single-flight : des appels concurrents sur la même clé absente ne déclenchent qu\'un seul producer', async () => {
    let calls = 0;
    const producer = () => {
      calls += 1;
      return delay('v1', 50);
    };

    const p1 = getOrRefresh('k4', { ttlSec: 10, redis: NO_REDIS }, producer);
    const p2 = getOrRefresh('k4', { ttlSec: 10, redis: NO_REDIS }, producer);

    await vi.advanceTimersByTimeAsync(50);
    const [r1, r2] = await Promise.all([p1, p2]);

    assert.equal(calls, 1, 'un seul producer doit être lancé pour deux appels concurrents');
    assert.equal(r1.value, 'v1');
    assert.equal(r2.value, 'v1');
  });
});

describe('swr-cache · fenêtre stale-while-revalidate', () => {
  it('sert la valeur périmée si le producer dépasse timeoutMs, puis se met à jour en tâche de fond', async () => {
    let calls = 0;
    const producer = () => {
      calls += 1;
      return calls === 1 ? Promise.resolve('v1') : delay('v2', 5_000);
    };

    const seeded = await getOrRefresh('k5', { ttlSec: 10, staleSec: 50, timeoutMs: 100, redis: NO_REDIS }, producer);
    assert.equal(seeded.value, 'v1');

    // Avance au-delà du TTL (10 s) mais dans la fenêtre stale (jusqu'à 60 s).
    await vi.advanceTimersByTimeAsync(15_000);

    const pending = getOrRefresh('k5', { ttlSec: 10, staleSec: 50, timeoutMs: 100, redis: NO_REDIS }, producer);
    await vi.advanceTimersByTimeAsync(100); // déclenche le budget timeoutMs avant que le producer (5s) n'aboutisse
    const duringTimeout = await pending;

    assert.equal(duringTimeout.cache, 'stale');
    assert.equal(duringTimeout.value, 'v1', 'la valeur périmée doit être servie pendant le rafraîchissement en cours');

    // Laisse le producer d'arrière-plan aboutir et persister sa valeur.
    await vi.advanceTimersByTimeAsync(5_000);

    const afterBackgroundRefresh = await getOrRefresh(
      'k5',
      { ttlSec: 10, staleSec: 50, timeoutMs: 100, redis: NO_REDIS },
      producer,
    );
    assert.equal(afterBackgroundRefresh.cache, 'hit');
    assert.equal(afterBackgroundRefresh.value, 'v2', 'le rafraîchissement en tâche de fond doit avoir mis à jour le cache');
  });

  it('sert la valeur fraîche immédiatement si le producer répond dans le budget timeoutMs', async () => {
    let calls = 0;
    const producer = () => {
      calls += 1;
      return calls === 1 ? Promise.resolve('v1') : delay('v2', 20);
    };

    await getOrRefresh('k6', { ttlSec: 10, staleSec: 50, timeoutMs: 200, redis: NO_REDIS }, producer);
    await vi.advanceTimersByTimeAsync(15_000);

    const pending = getOrRefresh('k6', { ttlSec: 10, staleSec: 50, timeoutMs: 200, redis: NO_REDIS }, producer);
    await vi.advanceTimersByTimeAsync(20);
    const result = await pending;

    assert.equal(result.cache, 'miss');
    assert.equal(result.value, 'v2');
  });

  it('retombe sur une valeur très périmée (au-delà de ttl+stale) si le producer échoue', async () => {
    let calls = 0;
    const producer = async () => {
      calls += 1;
      if (calls === 1) return 'v1';
      throw new Error('upstream down');
    };

    await getOrRefresh('k7', { ttlSec: 10, staleSec: 20, redis: NO_REDIS }, producer);
    // Au-delà de ttl + stale (30s).
    await vi.advanceTimersByTimeAsync(31_000);

    const result = await getOrRefresh('k7', { ttlSec: 10, staleSec: 20, redis: NO_REDIS }, producer);
    assert.equal(result.cache, 'stale');
    assert.equal(result.value, 'v1', 'même très périmée, la valeur doit être servie plutôt que de lever');
  });
});

describe('swr-cache · couche Redis (survit à un cold start simulé)', () => {
  it('relit depuis Redis quand le cache mémoire est vide (nouvelle instance)', async () => {
    const redis = createFakeRedis();
    let calls = 0;
    const producer = async () => {
      calls += 1;
      return `v${calls}`;
    };

    const first = await getOrRefresh('k8', { ttlSec: 100, redis }, producer);
    assert.equal(first.value, 'v1');
    assert.equal(redis.store.size, 1, 'la valeur doit être écrite dans Redis');

    // Simule un cold start : la mémoire de l'instance est vidée, mais Redis persiste.
    __resetSwrCacheForTests();

    const second = await getOrRefresh('k8', { ttlSec: 100, redis }, producer);
    assert.equal(second.cache, 'hit');
    assert.equal(second.value, 'v1');
    assert.equal(calls, 1, 'le producer ne doit pas être rappelé : la valeur vient de Redis');
  });

  it('écrit dans Redis avec un TTL égal à ttlSec + staleSec', async () => {
    const redis = createFakeRedis();
    const setSpy = vi.spyOn(redis, 'set');
    const producer = async () => 'v1';

    await getOrRefresh('k9', { ttlSec: 60, staleSec: 300, redis }, producer);

    assert.equal(setSpy.mock.calls.length, 1);
    assert.equal(setSpy.mock.calls[0]?.[2], 360);
  });

  it('ignore une entrée Redis corrompue comme si elle était absente', async () => {
    const redis = createFakeRedis();
    redis.store.set('k10', 'not-json{{');
    let calls = 0;
    const producer = async () => {
      calls += 1;
      return 'recovered';
    };

    const result = await getOrRefresh('k10', { ttlSec: 60, redis }, producer);
    assert.equal(result.cache, 'miss');
    assert.equal(result.value, 'recovered');
    assert.equal(calls, 1);
  });
});
