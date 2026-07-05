import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import type { DataSourceStatus } from '../types/index.ts';
import type { ObservedMetrics } from './qualityMeta.ts';
import {
  getSourcesQualityDashboardData,
  getSourceQualityRegistry,
} from './sources-quality-dashboard.ts';
import { computeSourceQualityScore } from './qualityMappers.ts';

function observed(overrides: Partial<ObservedMetrics> = {}): ObservedMetrics {
  return {
    successRate: overrides.successRate ?? 1,
    uptimeRate: overrides.uptimeRate ?? 1,
    fallbackRate: overrides.fallbackRate ?? 0,
    avgResponseMs: overrides.avgResponseMs ?? 120,
    samples: overrides.samples ?? 20,
    observationDays: overrides.observationDays ?? 5,
  };
}

function status(overrides: Partial<DataSourceStatus> & { name: string }): DataSourceStatus {
  return {
    name: overrides.name,
    lastUpdate: overrides.lastUpdate ?? null,
    status: overrides.status ?? 'loading',
    detail: overrides.detail,
    cacheAgeMs: overrides.cacheAgeMs,
    fetchCount: overrides.fetchCount,
    failureCount: overrides.failureCount,
    fallbackCount: overrides.fallbackCount,
    responseTimeMs: overrides.responseTimeMs,
    error: overrides.error,
  };
}

describe('sources-quality-dashboard', () => {
  it('expose un registre de sources nommées', () => {
    const registry = getSourceQualityRegistry();
    assert.ok(registry.some((source) => source.name === 'Météo-France'));
    assert.ok(registry.some((source) => source.name === 'Hub’Eau hydrométrie'));
    assert.ok(registry.every((source) => source.name.length > 0));
  });

  it('agrège statuts, dégradations et signaux à revoir', () => {
    const registry = getSourceQualityRegistry();
    const data = getSourcesQualityDashboardData({
      now: new Date('2026-06-27T10:00:00.000Z'),
      statuses: [
        status({
          name: 'Météo-France',
          status: 'ok',
          lastUpdate: new Date('2026-06-27T09:58:00.000Z'),
          cacheAgeMs: 2 * 60_000,
          responseTimeMs: 180,
        }),
        status({
          name: 'Hub’Eau hydrométrie',
          status: 'stale',
          lastUpdate: new Date('2026-06-27T08:00:00.000Z'),
          cacheAgeMs: 120 * 60_000,
          fallbackCount: 1,
        }),
        status({
          name: 'Cyber',
          status: 'error',
          lastUpdate: new Date('2026-06-27T07:00:00.000Z'),
          error: 'source indisponible',
        }),
      ],
    });

    assert.equal(data.summary.sourcesTracked.value, String(registry.length));
    assert.equal(data.summary.sourcesActive.value, '1');
    assert.equal(data.summary.sourcesDegraded.value, '2');
    assert.equal(data.sources.find((source) => source.name === 'Météo-France')?.quality.status, 'active');
    assert.equal(data.sources.find((source) => source.name === 'Hub’Eau hydrométrie')?.quality.status, 'cached');
    assert.equal(data.sources.find((source) => source.name === 'Cyber')?.quality.status, 'error');
    assert.ok(data.signalsToReview.some((signal) => signal.source === 'Hub’Eau hydrométrie'));
    assert.ok(data.signalsToReview.some((signal) => signal.source === 'Cyber'));
    assert.ok(data.moduleMatrix.some((row) => row.module === 'Réseau'));
    assert.ok(data.methodScale.some((row) => row.range === '70-100'));
  });
});

describe('computeSourceQualityScore', () => {
  it('combine socle (40 %) et observé (60 %) avec les bonnes pondérations', () => {
    // observé parfait → 100 ; 80*0.4 + 100*0.6 = 92
    const perfect = computeSourceQualityScore(80, observed({ successRate: 1, uptimeRate: 1, fallbackRate: 0 }));
    assert.equal(perfect.provisional, false);
    assert.equal(perfect.observedScore, 100);
    assert.equal(perfect.score, 92);

    // observé partiel : 100*(0.5*0.8 + 0.35*0.6 + 0.15*0.8) = 73 ; 90*0.4 + 73*0.6 = 79.8 → 80
    const partial = computeSourceQualityScore(90, observed({ successRate: 0.8, uptimeRate: 0.6, fallbackRate: 0.2 }));
    assert.equal(partial.observedScore, 73);
    assert.equal(partial.score, 80);
  });

  it('reste provisoire au socle si moins de 10 mesures ou aucune métrique', () => {
    const few = computeSourceQualityScore(65, observed({ samples: 9 }));
    assert.equal(few.provisional, true);
    assert.equal(few.score, 65);
    assert.equal(few.observedScore, null);

    const none = computeSourceQualityScore(50, null);
    assert.equal(none.provisional, true);
    assert.equal(none.score, 50);
    assert.equal(none.observedScore, null);
  });

  it('borne le score et le socle entre 0 et 100', () => {
    const high = computeSourceQualityScore(120, observed({ successRate: 1, uptimeRate: 1, fallbackRate: 0 }));
    assert.equal(high.natureBaseline, 100);
    assert.equal(high.score, 100);

    const low = computeSourceQualityScore(-10, observed({ successRate: 0, uptimeRate: 0, fallbackRate: 1 }));
    assert.equal(low.natureBaseline, 0);
    assert.equal(low.score, 0);
  });
});

describe('sources-quality-dashboard — scores calculés', () => {
  it('sans historique : chaque source est provisoire à son socle de nature', () => {
    const data = getSourcesQualityDashboardData({
      now: new Date('2026-07-04T10:00:00.000Z'),
      statuses: [],
      getObserved: () => null,
    });
    const meteo = data.sources.find((source) => source.name === 'Météo-France');
    assert.ok(meteo);
    assert.equal(meteo.quality.qualityProvisional, true);
    assert.equal(meteo.quality.natureBaseline, 90);
    assert.equal(meteo.quality.reliabilityScore, 90);
    assert.equal(meteo.quality.confidenceScore, 90);
  });

  it('avec métriques observées injectées : score calculé et non provisoire', () => {
    const data = getSourcesQualityDashboardData({
      now: new Date('2026-07-04T10:00:00.000Z'),
      statuses: [],
      getObserved: (name) =>
        name === 'Météo-France' ? observed({ successRate: 1, uptimeRate: 1, fallbackRate: 0, samples: 20, observationDays: 7 }) : null,
    });
    const meteo = data.sources.find((source) => source.name === 'Météo-France');
    assert.ok(meteo);
    assert.equal(meteo.quality.qualityProvisional, false);
    assert.equal(meteo.quality.reliabilityScore, 96); // 90*0.4 + 100*0.6
    assert.equal(meteo.quality.observed?.observationDays, 7);

    const vigicrues = data.sources.find((source) => source.name === 'Vigicrues');
    assert.ok(vigicrues);
    assert.equal(vigicrues.quality.qualityProvisional, true); // pas d’historique injecté
    assert.equal(vigicrues.quality.reliabilityScore, 90);
  });
});
