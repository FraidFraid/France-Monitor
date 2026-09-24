import { describe, it, expect } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import { summarizeEvent, eventStatusAt, diffEvent, mediaGroupOf } from '../api/_lib/event-model.js';

const H = 60 * 60 * 1000;
const T0 = Date.parse('2026-09-23T06:00:00Z');
const a = (id: number, feedId: string, feedName: string, tier: number, hours: number, extra: Record<string, unknown> = {}) => ({
  id, title: `titre ${id}`, feedId, feedName, tier, publishedAt: T0 + hours * H,
  category: 'security', severity: 'medium', lat: null, lon: null, ...extra,
});

describe('summarizeEvent', () => {
  it('compte une seule source indépendante pour une dépêche reprise par le groupe EBRA', () => {
    const agg = summarizeEvent([
      a(1, 'le-progres', 'Le Progrès', 3, 0),
      a(2, 'le-dauphine', 'Le Dauphiné', 3, 0.5),
      a(3, 'dna', 'DNA', 3, 1),
      a(4, 'l-est-republicain', "L'Est Républicain", 3, 1),
    ]);
    expect(agg.sourceCount).toBe(4);
    expect(agg.independentCount).toBe(1);
  });

  it('prend le titre du flux de meilleur rang, la gravité maximale et la catégorie dominante', () => {
    const agg = summarizeEvent([
      a(1, 'le-progres', 'Le Progrès', 3, 0, { title: 'Titre PQR', severity: 'high' }),
      a(2, 'le-monde', 'Le Monde', 1, 2, { title: 'Titre national', category: 'general' }),
      a(3, 'sud-ouest', 'Sud Ouest', 3, 3, { severity: 'low' }),
    ]);
    expect(agg.title).toBe('Titre national');
    expect(agg.severity).toBe('high');
    expect(agg.category).toBe('security');
    expect(agg.independentCount).toBe(3);
    expect(agg.firstSeen).toBe(T0);
    expect(agg.lastSeen).toBe(T0 + 3 * H);
    expect(agg.sourceNames).toEqual(['Le Progrès', 'Le Monde', 'Sud Ouest']);
  });

  it('regroupe Radio France et France Médias Monde', () => {
    expect(mediaGroupOf('france-bleu')).toBe(mediaGroupOf('france-info'));
    expect(mediaGroupOf('rfi')).toBe(mediaGroupOf('france-24-fr'));
    expect(mediaGroupOf('mediapart')).toBe('mediapart');
  });
});

describe('eventStatusAt', () => {
  it('active < 12 h, en refroidissement < 48 h, clos au-delà', () => {
    expect(eventStatusAt(T0, T0 + 11 * H)).toBe('active');
    expect(eventStatusAt(T0, T0 + 13 * H)).toBe('cooling');
    expect(eventStatusAt(T0, T0 + 49 * H)).toBe('closed');
  });
});

describe('diffEvent', () => {
  it('journalise création, aggravation, corroboration et réouverture', () => {
    expect(diffEvent(null, { severity: 'medium', independentCount: 1, status: 'active' })).toEqual([{ kind: 'created', from: null, to: 'medium' }]);
    expect(diffEvent(
      { severity: 'medium', independentCount: 1, status: 'cooling' },
      { severity: 'critical', independentCount: 3, status: 'active' },
    )).toEqual([
      { kind: 'escalated', from: 'medium', to: 'critical' },
      { kind: 'corroborated', from: '1', to: '3' },
      { kind: 'reopened', from: 'cooling', to: 'active' },
    ]);
  });

  it('ne journalise rien quand rien ne change', () => {
    const s = { severity: 'high', independentCount: 2, status: 'active' };
    expect(diffEvent(s, { ...s })).toEqual([]);
  });
});

describe('summarizeEvent — titre', () => {
  it('décode les entités HTML du titre représentatif', () => {
    const agg = summarizeEvent([a(1, 'midi-libre', 'Midi Libre', 3, 0, { title: 'Proc&#xE8;s de l&#039;assassinat  de Federico Aramburu' })]);
    expect(agg.title).toBe("Procès de l'assassinat de Federico Aramburu");
  });
});

describe('summarizeEvent — ordre', () => {
  it('liste les sources dans l’ordre d’apparition, quel que soit l’ordre reçu', () => {
    const agg = summarizeEvent([
      a(2, 'le-monde', 'Le Monde', 1, 1),
      a(1, 'le-progres', 'Le Progrès', 3, 0),
    ]);
    expect(agg.sourceNames).toEqual(['Le Progrès', 'Le Monde']);
  });
});
