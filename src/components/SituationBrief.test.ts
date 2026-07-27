// @vitest-environment happy-dom
//
// escapeHtml (dans SituationBrief.ts) échappait via l'astuce DOM textContent→innerHTML,
// qui n'échappe pas les guillemets — exploitable dès qu'une valeur atterrit dans un attribut
// (title). Test sémantique : parser le DOM produit et interroger l'attribut, jamais une
// recherche de sous-chaîne.

import { afterEach, describe, expect, it } from 'vitest';
import { SituationBrief } from './SituationBrief.ts';
import type { DetectedSituation } from '../types/index.ts';

function situation(over: Partial<DetectedSituation> = {}): DetectedSituation {
  return {
    id: 's1',
    type: 'NEWS_ALERT',
    severity: 'critical',
    confidence: 0.8,
    title: 'Titre',
    summary: 'Résumé',
    affectedZones: [],
    drivers: [],
    recommendedActions: [],
    sourceRefs: [],
    updatedAt: new Date('2026-07-27T08:00:00Z'),
    ...over,
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('SituationBrief — échappement des guillemets en attribut', () => {
  it('échappe les guillemets du titre dans l’attribut title de l’item (:260)', () => {
    const container = document.createElement('div');
    const brief = new SituationBrief(container);
    const payload = 'Titre" onmouseover="alert(1)';
    brief.update([situation({ title: payload })]);

    const item = container.querySelector('.sit-brief__item');
    expect(item).not.toBeNull();
    // La charge sort de l'attribut title si le guillemet n'est pas échappé.
    expect(item?.getAttribute('onmouseover')).toBeNull();
    expect(item?.getAttribute('title')).toBe(`Critique · ${payload}`);
    brief.destroy();
  });
});
