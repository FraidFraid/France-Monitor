import { describe, it, expect } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import { replayKeywords, replayEvents, labelMetrics, llmTargets } from '../scripts/replay-classification.mjs';

describe('replayKeywords', () => {
  it('article mots-clés : note kw-2 qualifiée', () => {
    expect(replayKeywords({ scoredBy: 'keywords', title: 'Condamné pour terrorisme : un homme écroué', description: null, category: 'security', severity: 'critical' }))
      .toMatchObject({ severity: 'low', reportedSeverity: 'high', temporality: 'passe', reasons: ['passe'], scoredBy: 'kw-2' });
  });
  it('article groq-1 : note gardée, plafonnée et qualifiée par le titre', () => {
    expect(replayKeywords({ scoredBy: 'groq', title: 'Thaïlande : Bangkok sous les eaux', description: null, category: 'floods', severity: 'critical' }))
      .toMatchObject({ severity: 'medium', reportedSeverity: 'critical', zone: 'etranger', reasons: ['etranger'], scoredBy: 'groq-1' });
  });
});

describe('replayEvents', () => {
  const note = (severity: string, extra: Record<string, unknown> = {}) => ({ severity, zone: 'france', temporality: 'en_cours', reasons: [], ...extra });
  it('gravité corroborée et qualification avec les membres connus', () => {
    const events = [
      { id: 10, title: 'E', severity: 'critical', articleIds: [1, 2, 99] },
      { id: 11, title: 'F', severity: 'high', articleIds: [98] },
      { id: 12, title: 'G', severity: 'critical', articleIds: [3] },
    ];
    const notes = new Map([[1, note('critical')], [2, note('high')], [3, note('critical')]]);
    const feed = new Map([[1, 'france-info'], [2, 'le-monde'], [3, 'sud-ouest']]);
    const [e, f, g] = replayEvents(events, notes, feed);
    expect(e).toMatchObject({ newSeverity: 'high', peakSeverity: 'critical', groups: 2, known: 2, reasons: ['non_confirme'] });
    expect(f).toMatchObject({ newSeverity: 'high', known: 0 });
    expect(g).toMatchObject({ newSeverity: 'medium', peakSeverity: 'critical', groups: 1 });
  });
});

describe('labelMetrics', () => {
  it('critères de la spec § 2 et résultats par catégorie', () => {
    const labels = [
      { id: 1, expected: { severity: 'low', inFrance: true, ongoing: true } },
      { id: 2, expected: { severity: 'high', inFrance: true, ongoing: true } },
      { id: 3, expected: { severity: 'critical', inFrance: true, ongoing: true } },
      { id: 4, expected: { severity: 'medium', inFrance: false, ongoing: true } },
      { id: 5, expected: null },
    ];
    const notes = new Map([
      [1, { severity: 'critical', category: 'security' }], [2, { severity: 'medium', category: 'security' }],
      [3, { severity: 'low', category: 'health' }], [4, { severity: 'high', category: 'security' }], [5, { severity: 'critical', category: 'security' }],
    ]);
    const m = labelMetrics(labels, notes);
    expect(m.total).toBe(4);
    expect(m.overCritical.map((l: { id: number }) => l.id)).toEqual([1]);
    expect(m.seriousCount).toBe(2);
    expect(m.recall).toBe(0.5);
    expect(m.foreignAbove.map((l: { id: number }) => l.id)).toEqual([4]);
    expect(m.byCategory).toEqual({
      security: { total: 3, serious: 1, kept: 1, overCritical: 1 },
      health: { total: 1, serious: 1, kept: 0, overCritical: 0 },
    });
  });
});

describe('llmTargets', () => {
  const articles = [
    { id: 1, scoredBy: 'groq', severity: 'high' },
    { id: 2, scoredBy: 'groq', severity: 'medium' },
    { id: 3, scoredBy: 'keywords', severity: 'critical' },
    { id: 4, scoredBy: 'keywords', severity: 'critical' },
  ];
  const notes = new Map<number, Record<string, string>>([
    [1, { scoredBy: 'groq-1', severity: 'high' }], [2, { scoredBy: 'groq-1', severity: 'medium' }],
    [3, { scoredBy: 'kw-2', severity: 'high' }], [4, { scoredBy: 'kw-2', severity: 'low' }],
  ]);
  it('anciennes notes Groq graves et candidats graves des mots-clés', () => {
    expect(llmTargets(articles, notes, null).map((a: { id: number }) => a.id)).toEqual([1, 3]);
  });
  it('restreint au jeu annoté', () => {
    expect(llmTargets(articles, notes, new Set([3, 4])).map((a: { id: number }) => a.id)).toEqual([3]);
  });
});
