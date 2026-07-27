// @vitest-environment happy-dom
//
// escapeHtml (dans WildfireDossierModal.ts) crée un <div> et lit son innerHTML :
// nécessite un DOM. L'environnement par défaut de vitest.config.ts est 'node'
// (aligné sur les tests métier purs) — ce fichier bascule donc sur happy-dom,
// comme FiresPanel.test.ts et App.radar-2d.test.ts.

import { describe, expect, it, vi } from 'vitest';
import type { ImpactFact } from '../types/index.ts';
import { renderDeclaredBlock, renderFactRow } from './WildfireDossierModal.ts';

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
    expect(html).toContain('&lt;script&gt;');

    // Assertion sémantique plutôt qu'une sous-chaîne : `not.toContain('onerror=')`
    // est un proxy trompeur — le payload ne forme aucun élément qu'on l'ait ou
    // non retiré, puisque sourceName est du texte échappé, pas du HTML actif.
    // Ce qui compte est qu'aucun <img>/<script> ne se soit réellement formé.
    const container = document.createElement('div');
    container.innerHTML = html;
    expect(container.querySelectorAll('img').length).toBe(0);
    expect(container.querySelectorAll('script').length).toBe(0);
    const link = container.querySelector('a');
    expect(link?.children.length ?? 0).toBe(0);
  });
});

describe('renderFactRow — validation du schéma de sourceUrl', () => {
  // Finding 1 (CRITICAL, round 1) : escapeHtml neutralise les métacaractères
  // HTML, pas le SCHÉMA d'une URL. `javascript:` ne contient aucun caractère
  // parmi & < > " ' et traverse l'échappement inchangé jusque dans href.
  // Seuls http:/https: sont autorisés ; sinon le fait reste visible (§3.3)
  // mais sans lien cliquable — jamais de href="#" trompeur.

  it('rejette javascript: et ne produit aucun lien, mais garde la provenance textuelle', () => {
    const html = renderFactRow(fact({ sourceUrl: 'javascript:alert(document.cookie)' }));
    const container = document.createElement('div');
    container.innerHTML = html;
    expect(container.querySelector('a')).toBeNull();
    expect(html).toContain('Sud Ouest');
  });

  it('rejette data: et ne produit aucun lien', () => {
    const html = renderFactRow(fact({ sourceUrl: 'data:text/html,<script>alert(1)</script>' }));
    const container = document.createElement('div');
    container.innerHTML = html;
    expect(container.querySelector('a')).toBeNull();
  });

  it('rejette une URL relative et ne produit aucun lien', () => {
    const html = renderFactRow(fact({ sourceUrl: '/a/1' }));
    const container = document.createElement('div');
    container.innerHTML = html;
    expect(container.querySelector('a')).toBeNull();
  });

  it('rejette une chaîne vide et ne produit aucun lien', () => {
    const html = renderFactRow(fact({ sourceUrl: '' }));
    const container = document.createElement('div');
    container.innerHTML = html;
    expect(container.querySelector('a')).toBeNull();
  });

  it('accepte https: et produit toujours un lien normal', () => {
    const html = renderFactRow(fact({ sourceUrl: 'https://www.sudouest.fr/a/1' }));
    const container = document.createElement('div');
    container.innerHTML = html;
    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://www.sudouest.fr/a/1');
  });
});

describe('renderDeclaredBlock', () => {
  // Finding 2 (Important, round 1) : un fait au kind hors énumération (donnée
  // non validée venue d'une future /api/fires/impacts) ne doit jamais faire
  // tomber le rendu de ses voisins — il est ignoré silencieusement.
  it('ignore un fait au kind inconnu sans faire tomber ses voisins', () => {
    const facts: ImpactFact[] = [
      fact({ id: 1, kind: 'area_ha' }),
      fact({ id: 2, kind: 'bogus_kind' as unknown as ImpactFact['kind'] }),
      fact({ id: 3, kind: 'evacuated', value: 12, unit: 'personnes' }),
    ];
    const html = renderDeclaredBlock(facts);
    expect(html).toContain('Surface brûlée');
    expect(html).toContain('Personnes évacuées');
  });

  // Finding 4 (round 2) : isKnownFactKind ne couvre que `kind`. Un fait au
  // kind valide mais dont un AUTRE champ est absent/mal typé (JSON tronqué,
  // donnée non validée à l'exécution) doit être isolé de la même façon —
  // la propriété visée est « un fait malformé, quelle que soit sa forme, ne
  // fait jamais tomber ses voisins », pas seulement « un kind inconnu ».
  it('isole un fait dont sourceName est undefined sans faire tomber ses voisins', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const facts: ImpactFact[] = [
        fact({ id: 1, kind: 'area_ha' }),
        fact({ id: 2, sourceName: undefined as unknown as string }),
        fact({ id: 3, kind: 'evacuated', value: 12, unit: 'personnes' }),
      ];
      const html = renderDeclaredBlock(facts);
      expect(html).toContain('Surface brûlée');
      expect(html).toContain('Personnes évacuées');
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('isole un fait quasi vide ({ id, kind } — JSON tronqué) sans faire tomber ses voisins', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const facts = [
        fact({ id: 1, kind: 'area_ha' }),
        { id: 2, kind: 'evacuated' } as unknown as ImpactFact,
        fact({ id: 3, kind: 'evacuated', value: 12, unit: 'personnes' }),
      ];
      const html = renderDeclaredBlock(facts);
      expect(html).toContain('Surface brûlée');
      expect(html).toContain('Personnes évacuées');
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('journalise chaque fait écarté, qu\'il le soit par kind inconnu ou par le filet try/catch', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const facts = [
        fact({ id: 1, kind: 'bogus_kind' as unknown as ImpactFact['kind'] }),
        { id: 2, kind: 'evacuated' } as unknown as ImpactFact,
      ];
      renderDeclaredBlock(facts);
      expect(warnSpy).toHaveBeenCalledTimes(2);
    } finally {
      warnSpy.mockRestore();
    }
  });

  // Finding 5 (round 3) : un fait écarté par le filet disparaissait sans
  // trace VISIBLE (seul console.warn le savait) — contraire à « une donnée
  // manquante s'affiche comme manquante ». Le décompte doit apparaître sous
  // la liste, correctement accordé au singulier/pluriel, et seulement quand
  // il y a effectivement quelque chose à signaler.
  it('affiche une mention « 1 fait ignoré » quand un seul fait est écarté', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const facts = [
        fact({ id: 1, kind: 'area_ha' }),
        { id: 2, kind: 'evacuated' } as unknown as ImpactFact,
        fact({ id: 3, kind: 'evacuated', value: 12, unit: 'personnes' }),
      ];
      const html = renderDeclaredBlock(facts);
      const container = document.createElement('div');
      container.innerHTML = html;
      expect(container.querySelectorAll('li.wf-fact').length).toBe(2);
      const notice = container.querySelector('.wf-modal__notice');
      expect(notice).not.toBeNull();
      expect(notice?.textContent).toMatch(/1 fait ignoré/);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('accorde au pluriel « 2 faits ignorés » quand deux faits sont écartés', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const facts = [
        fact({ id: 1, kind: 'area_ha' }),
        { id: 2, kind: 'evacuated' } as unknown as ImpactFact,
        { id: 3, kind: 'bogus_kind' } as unknown as ImpactFact,
      ];
      const html = renderDeclaredBlock(facts);
      const container = document.createElement('div');
      container.innerHTML = html;
      const notice = container.querySelector('.wf-modal__notice');
      expect(notice).not.toBeNull();
      expect(notice?.textContent).toMatch(/2 faits ignorés/);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('n\'affiche aucune mention quand tous les faits sont valides', () => {
    const facts: ImpactFact[] = [
      fact({ id: 1, kind: 'area_ha' }),
      fact({ id: 2, kind: 'evacuated', value: 12, unit: 'personnes' }),
    ];
    const html = renderDeclaredBlock(facts);
    const container = document.createElement('div');
    container.innerHTML = html;
    expect(container.querySelector('.wf-modal__notice')).toBeNull();
  });
});
