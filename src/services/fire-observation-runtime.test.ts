import { describe, expect, it } from 'vitest';
import type { FireObservationFeedState } from '../types/index.ts';
import { deriveFireObservationStatus } from './fire-observation-runtime.ts';

const NOW = Date.parse('2026-07-16T13:00:00Z');

function feed(
  status: FireObservationFeedState['status'],
  overrides: Partial<FireObservationFeedState> = {},
): FireObservationFeedState {
  return {
    status,
    observedAt: NOW - 10 * 60_000,
    fetchedAt: NOW,
    source: 'test-source',
    ...overrides,
  };
}

describe('deriveFireObservationStatus', () => {
  it('maps configured fresh, stale, missing and error feeds honestly', () => {
    expect(deriveFireObservationStatus(feed('ok'), NOW)).toBe('ACTIF');
    expect(deriveFireObservationStatus(feed('stale'), NOW)).toBe('CACHE · DÉGRADÉ');
    expect(deriveFireObservationStatus(feed('not-configured'), NOW)).toBe(
      'CONFIGURATION REQUISE',
    );
    expect(deriveFireObservationStatus(feed('error'), NOW)).toBe('INDISPONIBLE');
  });

  it('maps an initial request without previous data to loading', () => {
    expect(
      deriveFireObservationStatus(
        feed('loading', { observedAt: null, fetchedAt: null }),
        NOW,
      ),
    ).toBe('CHARGEMENT');
  });

  it('does not mutate the immutable feed state', () => {
    const input = Object.freeze(feed('ok'));

    deriveFireObservationStatus(input, NOW);

    expect(input).toEqual({
      status: 'ok',
      observedAt: NOW - 10 * 60_000,
      fetchedAt: NOW,
      source: 'test-source',
    });
  });
});
