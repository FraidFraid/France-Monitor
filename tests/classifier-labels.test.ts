import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyByKeywords } from '../src/services/classifier.ts';

interface Label {
  id: number;
  title: string;
  description: string;
  expected: { severity: 'info' | 'low' | 'medium' | 'high' | 'critical'; inFrance: boolean; ongoing: boolean } | null;
}
const RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 } as const;
const labels = JSON.parse(readFileSync(new URL('./fixtures/classification/labels.json', import.meta.url), 'utf8')) as Label[];

describe('kw-2 sur le jeu annoté (spec § 2)', () => {
  it('le jeu annoté est complet', () => {
    expect(labels.length).toBeGreaterThanOrEqual(150);
    expect(labels.filter((l) => !l.expected)).toEqual([]);
  });
  it('aucun article annoté ≤ medium ne sort critical', () => {
    const offenders = labels
      .filter((l) => l.expected && RANK[l.expected.severity] <= RANK.medium)
      .filter((l) => classifyByKeywords(l.title, l.description)?.level === 'critical')
      .map((l) => `${l.id} ${l.title}`);
    expect(offenders).toEqual([]);
  });
});
