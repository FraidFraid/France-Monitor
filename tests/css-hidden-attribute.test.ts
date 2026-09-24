// L'attribut `hidden` doit toujours masquer : plusieurs composants (menu « ⋯ » de l'en-tête,
// sélecteur de panneaux flottants, filtres actifs du fil d'actualités) le basculent, mais leur
// classe impose `display: flex`, qui écrasait la règle par défaut du navigateur — le menu « ⋯ »
// restait ouvert dès le chargement (constaté en production le 24/09/2026).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('attribut hidden', () => {
  it('main.css masque tout élément [hidden], même quand sa classe impose un display', () => {
    const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8');
    expect(css).toMatch(/(^|\n)\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });
});
