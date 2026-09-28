import { describe, it, expect } from 'vitest';
import { PressAlertSource, pruneStalePressAlerts } from './press-alert-source.ts';
import { pressAlertEvents } from './news-events.ts';
import type { IntelEventsState, NewsEvent } from '../types/index.ts';

const T0 = Date.parse('2026-09-28T10:00:00Z');
const ev: NewsEvent = {
  id: 1, evidenceId: 'E1', title: 'E1', category: 'security', severity: 'high', status: 'active',
  firstSeen: '2026-09-28T09:00:00Z', lastSeen: '2026-09-28T09:30:00Z', articleCount: 2, sourceCount: 2,
  independentCount: 2, sourceNames: ['Le Monde'], lat: null, lon: null,
};
const state: IntelEventsState = {
  events: [ev], digest: [], totals: {}, anchor: { since: T0 - 3_600_000, kind: 'last-visit' }, fetchedAt: T0, unavailable: false,
};

describe('PressAlertSource (revue finale C2)', () => {
  it('rien avant le premier chargement : repli sur les articles', () => {
    expect(new PressAlertSource().current(2, T0)).toBeNull();
  });
  it('réévalue la fraîcheur à chaque lecture : périmé au-delà de 30 min', () => {
    const source = new PressAlertSource();
    source.update(state, pressAlertEvents);
    expect(source.current(2, T0 + 60_000)?.map((e) => e.id)).toEqual([1]);
    expect(source.current(2, T0 + 31 * 60_000)).toBeNull();
  });
});

describe('pruneStalePressAlerts', () => {
  it('retire du cache les alertes presse de l’autre origine', () => {
    const cache = new Map([['news-alert-1', 1], ['news-event-2', 2], ['weather-alert-x', 3]]);
    pruneStalePressAlerts(cache, true);
    expect([...cache.keys()]).toEqual(['news-event-2', 'weather-alert-x']);
    pruneStalePressAlerts(cache, false);
    expect([...cache.keys()]).toEqual(['weather-alert-x']);
  });
});
