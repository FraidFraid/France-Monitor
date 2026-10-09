// La disposition A1 (v2, interface par défaut) ne doit rien changer à l'ancienne interface (?ui=v1) : les conteneurs v2 sont
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

  it('ligne de niveau des panneaux de couche : segments insécables, séparateur rogné en début de ligne', () => {
    expect(css).toMatch(/\.lp \.fmk-level \{ overflow: hidden; \}/);
    expect(css).toMatch(/\.lp \.fmk-level \.fmk-ctx \{ position: relative; white-space: nowrap; \}/);
    expect(css).toMatch(/\.lp \.fmk-level \.fmk-ctx \+ \.fmk-ctx::before \{\s*content: '·' !important; position: absolute; left: -7px;/);
    expect(css).not.toMatch(/\.lp \.fmk-level \.fmk-ctx:not\(:last-child\)::after/);
  });
  it('R1 : valeurs des lignes et des légendes insécables, texte libre des clés-valeurs sécable ; niveaux en couleur de texte', () => {
    expect(css).toContain('.lp .lp-leg b, .lp .lp-row > .lp-val, .lp .lp-bar-row > .lp-val { white-space: nowrap; }');
    const lpRules = [...css.matchAll(/(^|\n)(\.lp[^{}\n]*)\{([^{}]*)\}/g)].filter((m) => /white-space:\s*nowrap/.test(m[3] ?? ''));
    for (const m of lpRules) expect(m[2]).not.toContain('fmk-kv-v');
    expect(css).toContain('.lp .lp-lvl--orange { color: var(--sev-orange); }');
  });
  it('en-tête des panneaux de couches : espace sous la synthèse ou les onglets en marge intérieure (jamais écrasé par la marge du kit)', () => {
    expect(css).toContain('.lp .lp-head { position: sticky; top: 0; z-index: 1; padding: 16px 18px 14px; background: var(--bg-primary); }');
    expect(css).not.toContain('.lp .lp-head > :last-child');
  });
  it('feuille basse (mobile, 768 px comme l’application) : l’en-tête de tous les panneaux de couches défile avec le corps', () => {
    expect(css).toContain('@media (max-width: 768px) { .lp .lp-head { position: static; } }');
    expect(css).not.toContain('@media (max-width: 700px) { .lp .lp-head');
  });
  it('« Méthode et sources » en phrases (libellé fixe, valeur qui passe à la ligne) : les panneaux Santé, Trafics et Environnement seulement', () => {
    const health = '#app :is(.veille-panel-modal, .urgences-panel-modal, .acces-soins-panel-modal, .hopitaux-panel-modal, .traffic-panel-modal, .air-traffic-panel-modal, .transport-panel-modal, .maritime-panel-modal, .vigilance-panel-modal, .floods-panel-modal, .radar-panel-modal, .fires-panel-modal, .drought-panel-modal, .air-panel-modal, .quakes-panel-modal) .fmk .fmk-sec--ref';
    expect(css).toContain(`${health} .fmk-kv { grid-template-columns: 8rem minmax(0, 1fr); }`);
    expect(css).toContain(`${health} .fmk-kv-v { overflow-wrap: anywhere; }`);
    // Les panneaux Énergie gardent leurs valeurs alignées à droite dans « Méthode et sources ».
    expect(css).not.toMatch(/:is\(#app\.ui-v2, \.lp\) \.fmk \.fmk-sec--ref \.fmk-kv/);
  });
  it('R3 : la légende du gros chiffre ne masque pas la couleur de niveau des valeurs qu’elle contient', () => {
    expect(css).toContain('.lp .lp-figure > span { color: var(--text-secondary); font-size: 13px; }');
    expect(css).not.toMatch(/\.lp \.lp-figure span \{/);
  });
  it('panneaux de couches du lot 2 en feuille basse sur mobile', () => {
    const mobile = /@media \(max-width: 768px\) \{\s*([^{]*)\{\s*position: fixed !important;/.exec(css)?.[1] ?? '';
    for (const c of ['.hydraulic-panel-modal', '.eolien-panel-modal', '.drom-energy-panel-modal']) expect(mobile).toContain(c);
  });
  it('jetons de filière et de catégorie du lot 2 définis', () => {
    for (const t of ['--mix-coal', '--mix-oil', '--mix-turbine', '--mix-geo', '--mix-storage', '--mix-links', '--mix-other',
      '--cat-onshore', '--cat-offshore', '--cat-gazole', '--cat-sp95', '--cat-sp98', '--cat-e10', '--cat-gpl',
      '--cat-substation', '--cat-pylon', '--cat-production', '--cat-lng', '--cat-crude', '--cat-renewable']) {
      expect(css).toMatch(new RegExp(`${t}: #[0-9a-f]{6};`));
    }
  });
});
