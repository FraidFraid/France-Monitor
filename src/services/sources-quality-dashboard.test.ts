import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import type { DataSourceStatus } from '../types/index.ts';
import {
  getSourcesQualityDashboardData,
  getSourceQualityRegistry,
} from './sources-quality-dashboard.ts';

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
