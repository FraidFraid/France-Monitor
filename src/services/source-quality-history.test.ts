import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  computeObservedMetrics,
  createHistoryStore,
  createSourceHistoryState,
  dateKeyUTC,
  ingestSourceSample,
  purgeOldBuckets,
  recordSamples,
  type DailyBucket,
  type SourceSample,
} from './source-quality-history.ts';

const DAY_MS = 86_400_000;

function bucket(overrides: Partial<DailyBucket> & { date: string }): DailyBucket {
  return {
    date: overrides.date,
    fetches: overrides.fetches ?? 0,
    failures: overrides.failures ?? 0,
    fallbacks: overrides.fallbacks ?? 0,
    sumResponseMs: overrides.sumResponseMs ?? 0,
    nResponseSamples: overrides.nResponseSamples ?? 0,
    okSamples: overrides.okSamples ?? 0,
    staleSamples: overrides.staleSamples ?? 0,
    errorSamples: overrides.errorSamples ?? 0,
  };
}

function sample(overrides: Partial<SourceSample>): SourceSample {
  return {
    status: overrides.status ?? 'ok',
    fetchCount: overrides.fetchCount ?? 0,
    failureCount: overrides.failureCount ?? 0,
    fallbackCount: overrides.fallbackCount ?? 0,
    responseTimeMs: overrides.responseTimeMs ?? null,
  };
}

const T0 = Date.UTC(2026, 6, 4, 10, 0, 0); // 2026-07-04 10:00 UTC

describe('source-quality-history — helpers purs', () => {
  it('dateKeyUTC produit une clé de jour UTC', () => {
    assert.equal(dateKeyUTC(T0), '2026-07-04');
    assert.equal(dateKeyUTC(Date.UTC(2026, 0, 1, 23, 59)), '2026-01-01');
  });

  it('premier échantillon : pose la base sans comptage rétroactif', () => {
    const state = ingestSourceSample(
      createSourceHistoryState(),
      sample({ status: 'ok', fetchCount: 5, failureCount: 1, fallbackCount: 0, responseTimeMs: 200 }),
      T0,
    );
    assert.equal(state.buckets.length, 1);
    const b = state.buckets[0];
    assert.equal(b.date, '2026-07-04');
    assert.equal(b.fetches, 0); // pas de comptage du cumul pré-tracking
    assert.equal(b.failures, 0);
    assert.equal(b.okSamples, 1);
    assert.equal(b.nResponseSamples, 1);
    assert.equal(b.sumResponseMs, 200);
    assert.deepEqual(state.lastCumulative, { fetches: 5, failures: 1, fallbacks: 0 });
    assert.equal(state.lastSampleAt, T0);
  });

  it('échantillons suivants : agrège les DELTAS des compteurs cumulatifs', () => {
    let state = ingestSourceSample(
      createSourceHistoryState(),
      sample({ status: 'ok', fetchCount: 5, failureCount: 1, fallbackCount: 0, responseTimeMs: 200 }),
      T0,
    );
    state = ingestSourceSample(
      state,
      sample({ status: 'ok', fetchCount: 9, failureCount: 2, fallbackCount: 1, responseTimeMs: 300 }),
      T0 + 6 * 60_000,
    );
    const b = state.buckets[0];
    assert.equal(b.fetches, 4); // 9 - 5
    assert.equal(b.failures, 1); // 2 - 1
    assert.equal(b.fallbacks, 1); // 1 - 0
    assert.equal(b.okSamples, 2);
    assert.equal(b.nResponseSamples, 2);
    assert.equal(b.sumResponseMs, 500);
  });

  it('reset de session (delta négatif) : prend la valeur brute', () => {
    let state = ingestSourceSample(
      createSourceHistoryState(),
      sample({ status: 'ok', fetchCount: 9, failureCount: 2, fallbackCount: 1 }),
      T0,
    );
    // Deuxième échantillon pour créer un delta réel avant le reset.
    state = ingestSourceSample(
      state,
      sample({ status: 'ok', fetchCount: 12, failureCount: 2, fallbackCount: 1 }),
      T0 + 6 * 60_000,
    );
    assert.equal(state.buckets[0].fetches, 3); // 12 - 9
    // Reset : compteurs repassés sous la base → valeur brute.
    state = ingestSourceSample(
      state,
      sample({ status: 'ok', fetchCount: 2, failureCount: 0, fallbackCount: 0 }),
      T0 + 12 * 60_000,
    );
    assert.equal(state.buckets[0].fetches, 5); // 3 (delta 12-9) + valeur brute 2 (reset)
    assert.equal(state.buckets[0].failures, 0); // base posée à 2, aucun delta positif ensuite
    assert.deepEqual(state.lastCumulative, { fetches: 2, failures: 0, fallbacks: 0 });
  });

  it('statut loading est ignoré (retourne l’état inchangé)', () => {
    const state = createSourceHistoryState();
    const result = ingestSourceSample(state, sample({ status: 'loading', fetchCount: 3 }), T0);
    assert.equal(result, state);
  });

  it('un nouvel échantillon un autre jour crée un nouveau seau', () => {
    let state = ingestSourceSample(createSourceHistoryState(), sample({ status: 'ok', fetchCount: 1 }), T0);
    state = ingestSourceSample(state, sample({ status: 'stale', fetchCount: 2 }), T0 + DAY_MS);
    assert.equal(state.buckets.length, 2);
    assert.deepEqual(state.buckets.map((b) => b.date), ['2026-07-04', '2026-07-05']);
    assert.equal(state.buckets[1].staleSamples, 1);
  });

  it('purgeOldBuckets retire les seaux au-delà de 14 jours', () => {
    const now = Date.UTC(2026, 6, 20, 12); // 2026-07-20
    const kept = purgeOldBuckets(
      [
        bucket({ date: '2026-07-20' }), // aujourd’hui → gardé
        bucket({ date: '2026-07-07' }), // -13 j → gardé (borne)
        bucket({ date: '2026-07-06' }), // -14 j → purgé
        bucket({ date: '2026-06-20' }), // -30 j → purgé
      ],
      now,
    );
    assert.deepEqual(kept.map((b) => b.date), ['2026-07-20', '2026-07-07']);
  });

  it('l’ingestion purge automatiquement les seaux hors fenêtre', () => {
    const state = createSourceHistoryState();
    state.buckets.push(bucket({ date: '2026-06-01', fetches: 99 }));
    const next = ingestSourceSample(state, sample({ status: 'ok', fetchCount: 1 }), T0);
    assert.ok(next.buckets.every((b) => b.date !== '2026-06-01'));
    assert.equal(next.buckets.length, 1);
  });
});

describe('source-quality-history — computeObservedMetrics', () => {
  it('retourne null pour un historique vide', () => {
    assert.equal(computeObservedMetrics([]), null);
    assert.equal(computeObservedMetrics([bucket({ date: '2026-07-04' })]), null);
  });

  it('calcule les métriques nominales', () => {
    const metrics = computeObservedMetrics([
      bucket({
        date: '2026-07-04',
        fetches: 10,
        failures: 1,
        fallbacks: 2,
        okSamples: 8,
        staleSamples: 1,
        errorSamples: 1,
        sumResponseMs: 1000,
        nResponseSamples: 5,
      }),
    ]);
    assert.ok(metrics);
    assert.equal(metrics.successRate, 0.9); // (10-1)/10
    assert.equal(metrics.uptimeRate, 0.8); // 8/10
    assert.equal(metrics.fallbackRate, 0.2); // 2/10
    assert.equal(metrics.avgResponseMs, 200);
    assert.equal(metrics.samples, 10);
    assert.equal(metrics.observationDays, 1);
  });

  it('reflète une source dégradée et borne le taux de fallback', () => {
    const metrics = computeObservedMetrics([
      bucket({
        date: '2026-07-04',
        fetches: 4,
        failures: 3,
        fallbacks: 6, // > fetches → borné à 1
        okSamples: 1,
        staleSamples: 2,
        errorSamples: 3,
      }),
      bucket({ date: '2026-07-05', fetches: 0, failures: 0, okSamples: 0, errorSamples: 2 }),
    ]);
    assert.ok(metrics);
    assert.equal(metrics.successRate, 0.25); // (4-3)/4
    assert.equal(metrics.fallbackRate, 1); // borné
    assert.equal(metrics.samples, 8); // 1+2+3 + 2
    assert.equal(metrics.observationDays, 2);
  });
});

describe('source-quality-history — recordSamples (throttle + multi-source)', () => {
  it('ignore un échantillon pris depuis moins de 5 min', () => {
    let store = createHistoryStore();
    store = recordSamples(store, [{ key: 'A', sample: sample({ status: 'ok', fetchCount: 1 }) }], T0);
    // 2 min plus tard → throttlé
    store = recordSamples(store, [{ key: 'A', sample: sample({ status: 'ok', fetchCount: 2 }) }], T0 + 2 * 60_000);
    assert.equal(computeObservedMetrics(store.sources['A'].buckets)?.samples, 1);
    // 6 min plus tard → accepté
    store = recordSamples(store, [{ key: 'A', sample: sample({ status: 'ok', fetchCount: 3 }) }], T0 + 6 * 60_000);
    assert.equal(computeObservedMetrics(store.sources['A'].buckets)?.samples, 2);
  });

  it('traite plusieurs sources et ignore clés vides et statut loading', () => {
    const store = recordSamples(
      createHistoryStore(),
      [
        { key: 'A', sample: sample({ status: 'ok', fetchCount: 1 }) },
        { key: 'B', sample: sample({ status: 'loading', fetchCount: 1 }) },
        { key: '', sample: sample({ status: 'ok', fetchCount: 1 }) },
      ],
      T0,
    );
    assert.ok(store.sources['A']);
    assert.equal(store.sources['B'], undefined);
    assert.equal(store.sources[''], undefined);
    assert.equal(Object.keys(store.sources).length, 1);
  });
});
