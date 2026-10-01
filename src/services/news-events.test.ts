import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  digestChanges,
  loadIntelEventsState,
  parseNewsEvent,
  pressAlertEvents,
  resetNewsEventsCircuit,
  roundDownTo5Min,
  selectBriefEvents,
} from './news-events.ts';
import type { IntelEventsState, NewsEvent, NewsEventChange, ThreatLevel } from '../types/index.ts';

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

  it('aucun tiret cadratin dans le titre ni les noms de sources', () => {
    const e = parseNewsEvent({ ...event(), title: 'Grève \u2014 la SNCF annonce un trafic perturbé', sourceNames: ['Presse \u2014 Sud'] });
    expect(e?.title).toBe('Grève : la SNCF annonce un trafic perturbé');
    expect(e?.sourceNames).toEqual(['Presse : Sud']);
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

describe('parseNewsEvent — axes de qualification', () => {
  const base = { id: 7, title: 'T', category: 'security', severity: 'medium', status: 'active', firstSeen: '2026-09-28T08:00:00Z', lastSeen: '2026-09-28T09:00:00Z' };
  it('lit gravité signalée, zone, temporalité et motifs connus', () => {
    expect(parseNewsEvent({ ...base, peakSeverity: 'critical', zone: 'etranger', temporality: 'passe', reasons: ['etranger', 'inconnu', 'non_confirme'] }))
      .toMatchObject({ peakSeverity: 'critical', zone: 'etranger', temporality: 'passe', reasons: ['etranger', 'non_confirme'] });
  });
  it('API antérieure : gravité signalée = retenue, axes nuls', () => {
    expect(parseNewsEvent(base)).toMatchObject({ peakSeverity: 'medium', zone: null, temporality: null, reasons: [] });
  });
});

describe('pressAlertEvents', () => {
  const NOW = Date.parse('2026-09-28T10:00:00Z');
  const ev = (id: number, severity: ThreatLevel, lastSeen: string, extra: Partial<NewsEvent> = {}): NewsEvent => ({
    id, evidenceId: `E${id}`, title: `E${id}`, category: 'security', severity, status: 'active', firstSeen: lastSeen, lastSeen,
    articleCount: 2, sourceCount: 4, independentCount: 2, sourceNames: ['Le Monde', 'France Info', 'Sud Ouest', 'RFI'],
    lat: null, lon: null, ...extra,
  });
  const state = (events: NewsEvent[], over: Partial<IntelEventsState> = {}): IntelEventsState => ({
    events, digest: [], totals: {}, anchor: { since: NOW - 3_600_000, kind: 'last-visit' }, fetchedAt: NOW, unavailable: false, ...over,
  });
  it('null si absents, indisponibles ou périmés (repli sur les articles)', () => {
    expect(pressAlertEvents(null, 2, NOW)).toBeNull();
    expect(pressAlertEvents(state([], { unavailable: true }), 2, NOW)).toBeNull();
    expect(pressAlertEvents(state([], { fetchedAt: NOW - 31 * 60_000 }), 2, NOW)).toBeNull();
  });
  it('ouverts, retenus ≥ high, les plus graves puis les plus récents, 3 sources au plus', () => {
    const out = pressAlertEvents(state([
      ev(1, 'high', '2026-09-28T09:00:00Z'), ev(2, 'critical', '2026-09-28T08:00:00Z'), ev(3, 'medium', '2026-09-28T09:30:00Z'),
      ev(4, 'critical', '2026-09-28T09:10:00Z', { status: 'closed' }), ev(5, 'high', '2026-09-28T09:40:00Z'),
    ]), 2, NOW);
    expect(out?.map((e) => e.id)).toEqual([2, 5]);
    expect(out?.[0]).toMatchObject({ severity: 'critical', category: 'security', sources: ['Le Monde', 'France Info', 'Sud Ouest'] });
  });
});

