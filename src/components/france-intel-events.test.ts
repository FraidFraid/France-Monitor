import { describe, it, expect } from 'vitest';
import { renderChangesSection, renderEventRow, renderEventsSection, resolveEvidenceRef, safeHref, unavailableEventsState } from './france-intel-events.ts';
import type { IntelEventsState, NewsEvent } from '../types/index.ts';

const NOW = Date.parse('2026-09-23T08:00:00Z');

function event(overrides: Partial<NewsEvent> = {}): NewsEvent {
  const id = overrides.id ?? 42;
  return {
    id, evidenceId: `E${id}`, title: 'Gironde : plan ORSEC', category: 'weather', severity: 'high', status: 'active',
    firstSeen: '2026-09-23T04:00:00.000Z', lastSeen: '2026-09-23T06:00:00.000Z', articleCount: 3, sourceCount: 3, independentCount: 2,
    sourceNames: ['Sud Ouest'], lat: null, lon: null, ...overrides,
  };
}

function state(overrides: Partial<IntelEventsState> = {}): IntelEventsState {
  return { events: [event()], digest: [], totals: {}, anchor: { since: NOW - 3 * 3600_000, kind: 'last-visit' }, fetchedAt: NOW, unavailable: false, ...overrides };
}

describe('rendu des événements', () => {
  it('échappe les titres issus des flux et refuse les liens non http(s)', () => {
    const html = renderEventRow(event({ title: '<img src=x onerror=alert(1)>' }), 'fr', NOW, {
      event: event(), log: [],
      articles: [
        { id: 1, title: 'ok', link: 'javascript:alert(1)', feedName: 'X', publishedAt: null },
        { id: 2, title: 'ok2', link: 'https://example.fr/a?b="c"', feedName: 'Y', publishedAt: null },
      ],
    });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="https://example.fr/a?b=&quot;c&quot;"');
    expect(safeHref(' HTTPS://x.fr ')).toBe('HTTPS://x.fr');
  });

  it('distingue source unique, même groupe et corroboration indépendante', () => {
    expect(renderEventRow(event({ sourceCount: 1, independentCount: 1 }), 'fr', NOW, undefined)).toContain('SOURCE UNIQUE');
    expect(renderEventRow(event({ sourceCount: 4, independentCount: 1 }), 'fr', NOW, undefined)).toContain('4 titres · même groupe');
    expect(renderEventRow(event(), 'fr', NOW, undefined)).toContain('3 sources · 2 indépendantes');
  });

  it('dit que l’historique est indisponible au lieu d’afficher un fil vide', () => {
    expect(renderChangesSection(state({ unavailable: true }), 'fr', NOW, new Map()).body).toContain('Historique serveur indisponible');
    expect(renderEventsSection(state({ unavailable: true, events: [] }), 'fr', NOW, new Map()).body).toContain('Historique serveur indisponible');
  });

  it('affiche les totaux et un message explicite quand rien de notable n’a changé', () => {
    const out = renderChangesSection(state({ totals: { created: 312, corroborated: 4 } }), 'fr', NOW, new Map());
    expect(out.body).toContain('312 nouveaux · 4 corroborés');
    expect(out.body).toContain('Aucune aggravation');
    expect(renderChangesSection(state({ anchor: { since: 0, kind: 'default' } }), 'fr', NOW, new Map()).meta).toBe('première visite · dernières 24 h');
  });

  it('liste toujours un événement cité par le brief, même au-delà des 12 premiers', () => {
    const events = Array.from({ length: 15 }, (_, i) => event({ id: i + 1 }));
    const html = renderEventsSection(state({ events }), 'fr', NOW, new Map(), new Set(['E15'])).body;
    expect(html).toContain('data-event-id="15"');
    expect(html).not.toContain('data-event-id="14"');
  });

  it('journal : libellés au singulier, gravités traduites', () => {
    const html = renderEventRow(event(), 'fr', NOW, {
      event: event(), articles: [],
      log: [
        { at: '2026-09-23T07:00:00Z', kind: 'escalated', from: 'medium', to: 'high' },
        { at: '2026-09-23T06:00:00Z', kind: 'created', from: null, to: 'medium' },
      ],
    });
    expect(html).toContain('aggravé MOYEN → ÉLEVÉ');
    expect(html).toContain('créé · MOYEN');
  });
});

describe('resolveEvidenceRef (relecture finale #3)', () => {
  it('résout S<n> contre les situations figées au moment du brief, pas contre l’instantané courant', () => {
    const atBrief = ['energy-stress', 'cyber-pressure'];
    expect(resolveEvidenceRef('S2', atBrief)).toEqual({ kind: 'situation', id: 'cyber-pressure' });
    expect(resolveEvidenceRef('S3', atBrief)).toBeNull();
    expect(resolveEvidenceRef('E42', atBrief)).toEqual({ kind: 'event', id: 42 });
    expect(resolveEvidenceRef('X1', atBrief)).toBeNull();
  });
});

describe('module non chargé (relecture finale #7)', () => {
  it('donne aux deux sections un message explicite au lieu d’un chargement sans fin', () => {
    const s = unavailableEventsState(NOW);
    expect(renderChangesSection(s, 'fr', NOW, new Map()).body).toContain('Historique serveur indisponible');
    expect(renderEventsSection(s, 'fr', NOW, new Map()).body).toContain('Historique serveur indisponible');
  });
});
