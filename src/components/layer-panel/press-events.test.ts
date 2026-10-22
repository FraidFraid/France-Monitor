import { describe, expect, it } from 'vitest';
import type { NewsEvent } from '../../types/index.ts';
import { pressEventsFor, pressEventsSection } from './press-events.ts';

const NOW = Date.parse('2026-10-22T08:00:00Z');
const ev = (over: Partial<NewsEvent>): NewsEvent => ({
  id: 1, evidenceId: 'E1', title: 'Titre', category: 'security', severity: 'medium', status: 'active',
  firstSeen: '2026-10-21T10:00:00Z', lastSeen: '2026-10-21T20:00:00Z', articleCount: 3, sourceCount: 3, independentCount: 3,
  sourceNames: ['Le Monde', 'BFM TV'], lat: null, lon: null, zone: 'france', ...over,
});

describe('pressEventsFor', () => {
  const mirage = ev({ id: 2, title: "Un Mirage 2000-D, avion de chasse de l'armée, s'est écrasé près de Nancy", severity: 'critical' });
  const php = ev({ id: 3, title: 'Failles PHP : de nombreux sites inaccessibles', category: 'cyber', severity: 'critical' });
  const riot = ev({ id: 4, title: 'Violences urbaines à Marseille', severity: 'high' });
  it('Défense : sujets militaires de la catégorie sécurité, en France', () => {
    expect(pressEventsFor('defense', [riot, mirage, php]).map((e) => e.id)).toEqual([2]);
    expect(pressEventsFor('defense', [ev({ title: 'Ukraine : frappe russe sur une base militaire', zone: 'etranger' })])).toEqual([]);
  });
  it('Cyber : catégorie cyber', () => {
    expect(pressEventsFor('cyber', [riot, mirage, php]).map((e) => e.id)).toEqual([3]);
  });
  it('ni clos ni vert ; les plus graves puis les plus récents d’abord', () => {
    const closed = ev({ id: 5, category: 'cyber', status: 'closed' });
    const info = ev({ id: 6, category: 'cyber', severity: 'info' });
    const older = ev({ id: 7, category: 'cyber', severity: 'medium', lastSeen: '2026-10-21T08:00:00Z' });
    const newer = ev({ id: 8, category: 'cyber', severity: 'medium', lastSeen: '2026-10-21T21:00:00Z' });
    expect(pressEventsFor('cyber', [closed, info, older, newer, php]).map((e) => e.id)).toEqual([3, 8, 7]);
  });
});

describe('pressEventsSection', () => {
  it('rien à signaler : pas de section', () => {
    expect(pressEventsSection([], NOW)).toEqual([]);
  });
  it('rouge : étiquette URGENT clignotante, titre, heure et sources', () => {
    const [s] = pressEventsSection([ev({ title: 'Crash d’un Mirage <2000D>', severity: 'critical' })], NOW);
    expect(s).toMatchObject({ id: 'presse', title: 'Signalé par la presse', open: true });
    expect(s?.html).toContain('nw-urgent');
    expect(s?.html).toContain('Crash d’un Mirage &lt;2000D&gt;');
    expect(s?.html).toContain('3 sources indépendantes');
    expect(s?.html).toContain('Le Monde, BFM TV');
  });
  it('orange : pas d’URGENT', () => {
    expect(pressEventsSection([ev({ severity: 'high' })], NOW)[0]?.html).not.toContain('nw-urgent');
  });
});
