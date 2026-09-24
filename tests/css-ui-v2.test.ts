// La disposition A1 (?ui=v2) ne doit rien changer à l'interface par défaut : les conteneurs v2 sont
// masqués hors de la v2, toute règle qui les affiche est préfixée par #app.ui-v2, et les trois
// largeurs de la spec §9 (ordinateur, tablette, mobile) sont couvertes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8');

describe('styles de la disposition A1 (?ui=v2)', () => {
  it('masque les conteneurs v2 hors de la v2', () => {
    expect(css).toMatch(/(^|\n)\.fm-v2-bar, \.fm-v2-list, \.fm-v2-fiche, \.fm-v2-tabs \{ display: none; \}/);
  });

  it('préfixe par #app.ui-v2 toute règle qui affiche un conteneur v2', () => {
    const shows = [...css.matchAll(/([^{}]*\.fm-v2-(?:bar|list|fiche|tabs)[^{}]*)\{[^}]*display:\s*(?:flex|block)/g)].map((m) => m[1].trim());
    expect(shows.length).toBeGreaterThan(0);
    for (const selector of shows) expect(selector).toMatch(/#app\.ui-v2/);
  });

  it('couvre la tablette (fiche en volet par-dessus la carte) et le mobile (onglets)', () => {
    expect(css).toMatch(/@media \(min-width: 700px\) and \(max-width: 1100px\)\s*\{[^@]*#app\.ui-v2:not\(\[data-v2-fiche="open"\]\) \.fm-v2-fiche/);
    expect(css).toMatch(/@media \(max-width: 699px\)\s*\{[^@]*#app\.ui-v2\[data-v2-tab="map"\] \.map-area/);
  });
});
