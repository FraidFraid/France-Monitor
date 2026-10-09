// tests/outages-parts.test.ts : cadence et garde par partie (api/_lib/outages-parts.js), communes aux collecteurs Pannes réseau.
import { describe, expect, it } from 'vitest';
import { RETRY_MS, failed, partDue, succeeded } from '../api/_lib/outages-parts.js';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (t: number): string => new Date(t).toISOString();

describe('partDue', () => {
  it('jamais lue : due ; lue avec succès : due à l’intervalle (1 min de tolérance)', () => {
    expect(partDue(undefined, HOUR, NOW)).toBe(true);
    const ok = succeeded({ rows: [] }, iso(NOW));
    expect(partDue(ok, HOUR, NOW + 58 * MIN)).toBe(false);
    expect(partDue(ok, HOUR, NOW + 59 * MIN)).toBe(true);
  });
  it('en échec : retentée après 5 min par défaut', () => {
    const ko = failed(undefined, { rows: [] }, 'X : HTTP 503', iso(NOW));
    expect(RETRY_MS).toBe(5 * MIN);
    expect(partDue(ko, 6 * HOUR, NOW + 4 * MIN)).toBe(false);
    expect(partDue(ko, 6 * HOUR, NOW + 5 * MIN)).toBe(true);
  });
  it('I1 : en échec avec un délai propre (6 h) : pas de nouvel essai avant 6 h', () => {
    const ko = failed(succeeded({ rows: [1] }, iso(NOW - HOUR)), { rows: [] }, 'X : HTTP 500', iso(NOW));
    expect(ko).toMatchObject({ rows: [1], readAt: iso(NOW - HOUR), failedAt: iso(NOW), error: 'X : HTTP 500' });
    expect(partDue(ko, 6 * HOUR, NOW + 5 * MIN, 6 * HOUR)).toBe(false);
    expect(partDue(ko, 6 * HOUR, NOW + 6 * HOUR - MIN, 6 * HOUR)).toBe(false);
    expect(partDue(ko, 6 * HOUR, NOW + 6 * HOUR, 6 * HOUR)).toBe(true);
  });
});
