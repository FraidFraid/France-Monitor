import { describe, expect, it } from 'vitest';
import { buildNuclearState } from './nuclear-correlation.ts';
import type { RTEIIPState } from './rte-iip.ts';

const iip = (over: Partial<RTEIIPState> = {}): RTEIIPState => ({
  incidents: [], productionCount: 0, transmissionCount: 0, totalCapacityMW: 0, fetchedAt: new Date('2026-10-02T04:20:00Z'),
  available: true, freshness: 'realtime', productionFeedStatus: 'empty', transmissionFeedStatus: 'empty', hasEverSucceeded: true, ...over,
});

describe('état nucléaire : heures de lecture', () => {
  it('reprend l\'heure de lecture RTE du serveur et celle du flux IIP, pas l\'heure de construction', () => {
    const rteAt = new Date('2026-10-02T04:10:00Z');
    const s = buildNuclearState({ items: [], available: true, fetchedAt: rteAt }, iip());
    expect(s.rteFetchedAt).toEqual(rteAt);
    expect(s.remitFetchedAt).toEqual(new Date('2026-10-02T04:20:00Z'));
    expect(s.fetchedAt.getTime()).toBeGreaterThan(rteAt.getTime());
  });
  it('sans IIP réussi : pas d\'heure REMIT inventée', () => {
    const s = buildNuclearState({ items: [], available: true, fetchedAt: new Date() }, iip({ hasEverSucceeded: false, productionFeedStatus: 'unavailable' as never }));
    expect(s.remitFetchedAt).toBeUndefined();
  });
});
