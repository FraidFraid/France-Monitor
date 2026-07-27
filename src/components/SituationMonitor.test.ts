// @vitest-environment happy-dom
//
// escapeHtml (dans SituationMonitor.ts) échappait via l'astuce DOM textContent→innerHTML,
// qui n'échappe pas les guillemets — exploitable dès qu'une valeur atterrit dans un attribut
// (title). Test sémantique : parser le DOM produit et interroger l'attribut, jamais une
// recherche de sous-chaîne.

import { afterEach, describe, expect, it } from 'vitest';
import { SituationMonitor } from './SituationMonitor.ts';
import type { DetectedSituation } from '../types/index.ts';

function situation(over: Partial<DetectedSituation> = {}): DetectedSituation {
  return {
    id: 's1',
    type: 'ENERGY_STRESS',
    severity: 'high',
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

describe('SituationMonitor — échappement des guillemets en attribut', () => {
  it('échappe les guillemets de summary dans l’attribut title de l’item (:418)', () => {
    const container = document.createElement('div');
    const monitor = new SituationMonitor(container);
    const payload = 'Résumé" onmouseover="alert(1)';
    monitor.update([situation({ summary: payload })]);

    const item = container.querySelector('.sit-mon__item');
    expect(item).not.toBeNull();
    // La charge sort de l'attribut title si le guillemet n'est pas échappé.
    expect(item?.getAttribute('onmouseover')).toBeNull();
    expect(item?.getAttribute('title')).toBe(payload);
    monitor.destroy();
  });
});
