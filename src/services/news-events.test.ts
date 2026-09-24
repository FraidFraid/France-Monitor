import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  digestChanges,
  loadIntelEventsState,
  parseNewsEvent,
  resetNewsEventsCircuit,
  roundDownTo5Min,
  selectBriefEvents,
} from './news-events.ts';
import type { NewsEvent, NewsEventChange } from '../types/index.ts';

function event(overrides: Partial<NewsEvent> = {}): NewsEvent {
  const id = overrides.id ?? 42;
  return {
    id, evidenceId: `E${id}`, title: 'Gironde : plan ORSEC déclenché', category: 'weather', severity: 'high', status: 'active',
    firstSeen: '2026-09-23T04:00:00.000Z', lastSeen: '2026-09-23T06:00:00.000Z', articleCount: 3, sourceCount: 3, independentCount: 2,
    sourceNames: ['Sud Ouest', 'France Info', 'Le Monde'], lat: null, lon: null, ...overrides,
  };
}

describe('parseNewsEvent', () => {
  it('valide la forme et recalcule l’identifiant de preuve', () => {
    expect(parseNewsEvent({ ...event(), evidenceId: 'X1' })?.evidenceId).toBe('E42');
    expect(parseNewsEvent({ ...event(), severity: 'grave' })).toBeNull();
    expect(parseNewsEvent('texte')).toBeNull();
  });
});

describe('roundDownTo5Min', () => {
  it('ramène à la tranche de 5 min inférieure (URL partagée par le CDN)', () => {
    expect(new Date(roundDownTo5Min(Date.parse('2026-09-23T06:07:59Z'))).toISOString()).toBe('2026-09-23T06:05:00.000Z');
  });
});

describe('selectBriefEvents', () => {
  it('garde les événements ouverts graves ou corroborés, gravité puis corroboration', () => {
    const selected = selectBriefEvents([
      event({ id: 1, severity: 'low', independentCount: 1 }),
      event({ id: 2, severity: 'medium', independentCount: 1 }),
      event({ id: 3, severity: 'low', independentCount: 3 }),
      event({ id: 4, severity: 'critical', status: 'closed' }),
      event({ id: 5, severity: 'medium', independentCount: 4 }),
    ]);
    expect(selected.map((e) => e.id)).toEqual(['E5', 'E2', 'E3']);
    expect(selected[0]).toMatchObject({ sources: ['Sud Ouest', 'France Info', 'Le Monde'], independentCount: 4 });
  });
});

describe('digestChanges', () => {
  it('fusionne les changements d’un même événement et retient les valeurs de départ', () => {
    const changes: NewsEventChange[] = [
      { at: '2026-09-23T06:00:00Z', kind: 'corroborated', from: '2', to: '3', event: event({ independentCount: 3 }) },
      { at: '2026-09-23T05:00:00Z', kind: 'escalated', from: 'medium', to: 'high', event: event() },
      { at: '2026-09-23T04:00:00Z', kind: 'corroborated', from: '1', to: '2', event: event() },
      { at: '2026-09-23T05:30:00Z', kind: 'created', from: null, to: 'critical', event: event({ id: 7, severity: 'critical' }) },
    ];
    const digest = digestChanges(changes);
    expect(digest.map((d) => d.event.id)).toEqual([42, 7]);
    expect(digest[0]).toMatchObject({ kinds: ['escalated', 'corroborated'], severityFrom: 'medium', independentFrom: 1, latestAt: '2026-09-23T06:00:00Z' });
  });
});

describe('loadIntelEventsState', () => {
  beforeEach(() => resetNewsEventsCircuit());
  afterEach(() => vi.unstubAllGlobals());

  it('signale l’indisponibilité au lieu de renvoyer un état vide trompeur', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    const state = await loadIntelEventsState({ since: 0, kind: 'default' }, 1);
    expect(state).toMatchObject({ events: [], digest: [], unavailable: true });
  });

  it('arrondit « since » dans l’URL du fil de changements', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.startsWith('/api/events/changes') ? { changes: [], totals: { created: 12 } } : { events: [event()] })));
    vi.stubGlobal('fetch', fetchMock);
    const state = await loadIntelEventsState({ since: Date.parse('2026-09-23T06:07:59Z'), kind: 'last-visit' }, 1);
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain('/api/events/changes?since=2026-09-23T06:05:00.000Z');
    expect(state).toMatchObject({ unavailable: false, totals: { created: 12 } });
    expect(state.events).toHaveLength(1);
  });
});
