// @vitest-environment happy-dom
//
// escapeHtml (dans WildfireDossierModal.ts) crée un <div> et lit son innerHTML :
// nécessite un DOM. L'environnement par défaut de vitest.config.ts est 'node'
// (aligné sur les tests métier purs) — ce fichier bascule donc sur happy-dom,
// comme FiresPanel.test.ts et App.radar-2d.test.ts.

import { describe, expect, it } from 'vitest';
import type { ImpactFact } from '../types/index.ts';
import { renderFactRow } from './WildfireDossierModal.ts';

function fact(over: Partial<ImpactFact> = {}): ImpactFact {
  return {
    id: 1, kind: 'area_ha', value: 42000, unit: 'ha',
    quote: '42 000 hectares de forêt ont été détruits',
    sourceUrl: 'https://www.sudouest.fr/a/1', sourceName: 'Sud Ouest',
    sourceLevel: 'secondary', reliability: 'D', hedged: false, provisional: true,
    observedAt: '2026-07-26T08:00:00Z', communes: [],
    credibility: 4, corroboration: ['Sud Ouest'],
    ...over,
  };
}

describe('renderFactRow', () => {
  it('affiche la valeur, la source, le niveau et les deux notes', () => {
    const html = renderFactRow(fact());
    expect(html).toContain('42 000');
    expect(html).toContain('Sud Ouest');
    expect(html).toMatch(/secondaire/i);
    expect(html).toContain('D4');
  });

  it('signale un chiffre provisoire et une formulation approximative', () => {
    const html = renderFactRow(fact({ hedged: true, provisional: true }));
    expect(html).toMatch(/provisoire/i);
    expect(html).toMatch(/approximat/i);
  });

  it('rend un fait qualitatif sans inventer de valeur', () => {
    const html = renderFactRow(fact({ kind: 'evacuation_order', value: null, unit: null }));
    expect(html).toMatch(/évacuation/i);
    expect(html).not.toContain('null');
    expect(html).not.toMatch(/\b0\b/);
  });

  it('échappe le texte tiers — surface XSS la plus directe du projet', () => {
    const html = renderFactRow(fact({
      quote: '<script>alert(1)</script>',
      sourceName: '<img src=x onerror=alert(1)>',
    }));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onerror=');
    expect(html).toContain('&lt;script&gt;');
  });
});
