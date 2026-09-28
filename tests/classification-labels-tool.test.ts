import { describe, it, expect } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import { sampleForLabels, reviewSelection, applyCorrections, labelStats, reviewHtml } from '../scripts/classification-labels.mjs';

const art = (id: number, severity: string, scoredBy = 'keywords', publishedAt = '2026-09-28T08:00:00.000Z') => ({
  id, feedId: 'le-monde', feedName: 'Le Monde', tier: 1, title: `Titre ${id}`, description: 'd'.repeat(300),
  publishedAt, category: 'security', severity, confidence: 0.8, scoredBy,
});
const L = (severity: string, inFrance = true, ongoing = true) => ({ severity, inFrance, ongoing });

describe('sampleForLabels', () => {
  const snapshot = {
    takenAt: '2026-09-28T12:00:00.000Z',
    articles: [
      art(1, 'critical'), art(2, 'critical', 'groq'), art(3, 'high'), art(4, 'high', 'groq'),
      art(5, 'medium'), art(6, 'info'), art(7, 'critical', 'keywords', '2034-08-14T09:00:00.000Z'),
    ],
  };
  it('prend tous les critical, les high et le reste, écarte les dates futures, tronque la description', () => {
    const entries = sampleForLabels(snapshot);
    expect(entries.map((e: { id: number }) => e.id).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(entries[0]).toMatchObject({ expected: null, why: '', claude: null, reviewedBy: null });
    expect(entries[0].description).toHaveLength(200);
    expect(entries[0].current).toEqual({ category: 'security', severity: 'critical', scoredBy: 'keywords' });
  });
  it('est déterministe pour une même graine', () => {
    expect(sampleForLabels(snapshot, 7)).toEqual(sampleForLabels(snapshot, 7));
  });
});

describe('reviewSelection', () => {
  it('aveugle : étiquettes high+ de Claude et critical de la production ; vérification : 20 autres au plus', () => {
    const labels = Array.from({ length: 40 }, (_, i) => ({
      id: i + 1,
      current: { severity: i === 10 ? 'critical' : 'low' },
      expected: L(i < 5 ? 'high' : 'low'),
    }));
    const { blind, check } = reviewSelection(labels);
    expect(blind.map((l: { id: number }) => l.id)).toEqual([1, 2, 3, 4, 5, 11]);
    expect(check).toHaveLength(20);
    expect(check.some((l: { id: number }) => l.id <= 5 || l.id === 11)).toBe(false);
  });
});

describe('applyCorrections', () => {
  const labels = [
    { id: 1, expected: L('high'), why: 'Attaque en cours', claude: null, reviewedBy: null },
    { id: 2, expected: L('low'), why: 'Fait divers', claude: null, reviewedBy: null },
    { id: 3, expected: L('info'), why: 'Culture', claude: null, reviewedBy: null },
    { id: 4, expected: L('medium'), why: 'Grève', claude: null, reviewedBy: null },
  ];
  it('aveugle : l’analyste fait foi, l’étiquette de Claude est conservée', () => {
    const [out] = applyCorrections(labels, [{ id: 1, mode: 'blind', severity: 'critical', inFrance: true, ongoing: false }]);
    expect(out).toMatchObject({ expected: L('critical', true, false), claude: L('high'), reviewedBy: 'analyste-aveugle' });
  });
  it('vérification : d’accord ou corrigé, relu dans les deux cas ; absents inchangés', () => {
    const out = applyCorrections(labels, [
      { id: 2, mode: 'check', agree: true, severity: 'low', inFrance: true, ongoing: true },
      { id: 4, mode: 'check', agree: false, severity: 'high', inFrance: false, ongoing: true },
    ]);
    expect(out[1]).toMatchObject({ expected: L('low'), claude: L('low'), reviewedBy: 'analyste-verifie' });
    expect(out[3]).toMatchObject({ expected: L('high', false), claude: L('medium'), reviewedBy: 'analyste-verifie' });
    expect(out[2]).toEqual(labels[2]);
  });
  it('refuse une gravité inconnue', () => {
    expect(() => applyCorrections(labels, [{ id: 1, mode: 'blind', severity: 'rouge', inFrance: true, ongoing: true }])).toThrow();
  });
});

describe('labelStats', () => {
  it('mesure l’accord analyste / Claude', () => {
    const s = labelStats([
      { expected: L('critical'), claude: L('high'), reviewedBy: 'analyste-aveugle' },
      { expected: L('low'), claude: L('low', false), reviewedBy: 'analyste-aveugle' },
      { expected: L('medium'), claude: L('medium'), reviewedBy: 'analyste-verifie' },
      { expected: L('info'), claude: null, reviewedBy: null },
    ]);
    expect(s.blind).toEqual({ count: 2, exact: 0.5, withinOne: 1, inFrance: 0.5, ongoing: 1 });
    expect(s.check).toEqual({ count: 1, agree: 1 });
    expect(s.total).toBe(4);
  });
});

describe('reviewHtml', () => {
  it('ne montre pas l’étiquette de Claude en aveugle et échappe les titres', () => {
    const html = reviewHtml({
      blind: [{ id: 1, title: '</script><b>x</b>', description: '', expected: L('low'), why: 'secret' }],
      check: [],
    });
    expect(html).toContain('<!doctype html>');
    expect(html).not.toContain('</script><b>');
    expect(html).not.toContain('secret');
  });
});
