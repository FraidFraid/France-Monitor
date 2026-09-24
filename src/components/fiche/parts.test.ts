import { describe, it, expect } from 'vitest';
import { digestChangeText, nothingToHandleText, renderFiche, severityWord, type FicheModel } from './parts.ts';
import type { ChangeDigestItem, NewsEvent } from '../../types/index.ts';

function model(over: Partial<FicheModel> = {}): FicheModel {
  return {
    key: 'event:42', kind: 'Événement', name: 'Explosion', level: 'rouge', driver: '3 sources indépendantes',
    freshness: 'Dernier article il y a 10 min', essentiel: ['Repris par 3 sources.'], changesMeta: '',
    changes: [{ at: null, text: 'créé · rouge', select: null }], sections: [{ title: 'Facteurs', html: '<ul><li>f</li></ul>' }],
    figures: [{ label: 'Articles', value: '3' }], watch: [{ text: 'Signal Écowatt de demain', horizon: '6 h' }],
    sourcesTitle: 'Articles', sources: [{ label: 'Le Monde', href: 'https://example.org/a', select: null }],
    why: '<p>Classement</p>', whyOpen: false, actions: [{ id: 'map', label: 'Voir sur la carte' }], ...over,
  };
}

describe('renderFiche (spec §6.2)', () => {
  it('rend les parties dans l’ordre de la spec', () => {
    const html = renderFiche(model(), 'fr');
    const order = ['fiche-head', 'fiche-essentiel', 'fiche-changes', 'fiche-extra', 'fiche-figures', 'fiche-watch', 'fiche-sources', 'fiche-why', 'fiche-actions'];
    const positions = order.map((cls) => html.indexOf(cls));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('omet les parties vides', () => {
    const html = renderFiche(model({ changes: [], figures: [], watch: [], sources: [], why: '', actions: [], sections: [] }), 'fr');
    for (const cls of ['fiche-changes', 'fiche-figures', 'fiche-watch', 'fiche-sources', 'fiche-why', 'fiche-actions', 'fiche-extra']) {
      expect(html).not.toContain(cls);
    }
  });

  it('échappe le texte tiers, n’ouvre que les liens http(s) et garde les attributs fermés (revue)', () => {
    const html = renderFiche(model({
      name: '<img src=x onerror=alert(1)>',
      sources: [
        { label: 'piège', href: 'javascript:alert(1)', select: null },
        { label: 'ok', href: 'https://example.org/a?b="c"', select: null },
        { label: 'sit', href: null, select: 'situation:x" onfocus="alert(1)' },
      ],
    }), 'fr');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="https://example.org/a?b=&quot;c&quot;" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('data-select="situation:x&quot; onfocus=&quot;alert(1)"');
  });

  it('garde le volet ouvert quand il l’était ; trois chiffres au plus ; heure inconnue en tiret', () => {
    const figures = [1, 2, 3, 4].map((n) => ({ label: `c${n}`, value: String(n) }));
    const html = renderFiche(model({ whyOpen: true, figures }), 'fr');
    expect(html).toContain('<details class="fiche-why" data-why="event:42" open>');
    expect(html).not.toContain('c4');
    expect(html).toContain('<span class="fiche-time">—</span>');
  });

  it('passe en anglais avec la bascule EN', () => {
    const html = renderFiche(model(), 'en');
    expect(html).toContain('Why this level?');
    expect(html).toContain('Key figures');
  });
});

describe('textes communs', () => {
  const ev = (over: Partial<NewsEvent> = {}): NewsEvent => ({
    id: 42, evidenceId: 'E42', title: 'Explosion', category: 'security', severity: 'high', status: 'active',
    firstSeen: '2026-09-24T07:00:00Z', lastSeen: '2026-09-24T07:30:00Z', articleCount: 3, sourceCount: 3,
    independentCount: 3, sourceNames: [], lat: null, lon: null, ...over,
  });
  const item = (kinds: ChangeDigestItem['kinds'], over: Partial<ChangeDigestItem> = {}): ChangeDigestItem => ({
    event: ev(), kinds, latestAt: '2026-09-24T07:30:00Z', severityFrom: 'medium', independentFrom: 1, ...over,
  });

  it('dit un changement d’événement en mots, sans flèche entre deux niveaux verts', () => {
    expect(digestChangeText(item(['created']), 'fr')).toBe('Nouveau : Explosion');
    expect(digestChangeText(item(['escalated']), 'fr')).toBe('Aggravé (jaune → orange) : Explosion');
    expect(digestChangeText(item(['escalated'], { severityFrom: 'info', event: ev({ severity: 'low' }) }), 'fr')).toBe('Aggravé : Explosion');
    expect(digestChangeText(item(['corroborated']), 'en')).toBe('Corroborated (1 → 3 independent sources): Explosion');
    expect(severityWord('bogus', 'fr')).toBeNull();
  });

  it('« Rien à traiter » accorde le nombre d’éléments suivis', () => {
    expect(nothingToHandleText(1, 'fr')).toBe('Rien à traiter. 1 élément suivi est au vert.');
    expect(nothingToHandleText(14, 'fr')).toBe('Rien à traiter. 14 éléments suivis sont au vert.');
    expect(nothingToHandleText(0, 'en')).toBe('Nothing to handle. 0 tracked items are green.');
  });
});
