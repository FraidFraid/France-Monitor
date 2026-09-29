import { describe, it, expect } from 'vitest';
import { dataDateLabel, freshnessOf, parseDataDate, partitionByFreshness } from './freshness.ts';

const NOW = Date.parse('2026-09-29T12:00:00Z');
const H = 3_600_000;

describe('freshness (spec 2026-09-29 § 8)', () => {
  it('au-delà du délai de sa source, une donnée est périmée', () => {
    expect(freshnessOf(NOW - 5 * H, 'meteo', NOW)).toBe('fresh');
    expect(freshnessOf(NOW - 7 * H, 'meteo', NOW)).toBe('stale');
    expect(freshnessOf(NOW - 13 * 24 * H, 'healthAlerts', NOW)).toBe('fresh');
    expect(freshnessOf(NOW - 15 * 24 * H, 'healthAlerts', NOW)).toBe('stale');
  });

  it('une donnée sans date est périmée', () => {
    expect(freshnessOf(null, 'brief', NOW)).toBe('stale');
    expect(parseDataDate('')).toBeNull();
    expect(parseDataDate('2026-05-03')).toBe(Date.parse('2026-05-03'));
  });

  it('sépare le courant du plus ancien', () => {
    const items = [{ d: '2026-09-28' }, { d: '2026-05-03' }, { d: '' }];
    const { current, older } = partitionByFreshness(items, (i) => parseDataDate(i.d), 'healthAlerts', NOW);
    expect(current).toEqual([{ d: '2026-09-28' }]);
    expect(older).toEqual([{ d: '2026-05-03' }, { d: '' }]);
  });

  it('« données du 28/09 à 16:00 » (heure de Paris), « date inconnue »', () => {
    expect(dataDateLabel(Date.parse('2026-09-28T14:00:00Z'), 'fr')).toBe('données du 28/09 à 16:00');
    expect(dataDateLabel(null, 'fr')).toBe('date inconnue');
  });
});
