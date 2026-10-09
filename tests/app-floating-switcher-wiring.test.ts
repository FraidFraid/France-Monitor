// Câblage de la barre « Panneaux ouverts » de la carte dans App.ts. App.ts ne s'instancie pas sous
// vitest : ces tests lisent sa source et vérifient que les décisions pures
// (services/floating-panel-switcher.ts) sont branchées. Le rendu est contrôlé dans Chrome.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8');

function methodBody(name: string): string {
  const signature = new RegExp(`\\n  (?:private |public )?(?:async )?${name}\\([^{]*\\{`);
  const match = signature.exec(app);
  if (!match) throw new Error(`méthode ${name} introuvable dans App.ts`);
  const start = match.index + match[0].length - 1;
  let depth = 0;
  for (let i = start; i < app.length; i += 1) {
    if (app[i] === '{') depth += 1;
    else if (app[i] === '}') {
      depth -= 1;
      if (depth === 0) return app.slice(start, i + 1);
    }
  }
  throw new Error(`corps de ${name} non refermé`);
}

describe('barre « Panneaux ouverts » de la carte', () => {
  it('un bouton actif referme son panneau (la couche reste active), un bouton inactif l’ouvre', () => {
    const body = methodBody('refreshFloatingPanelSwitcher');
    expect(body).toContain('this.isFloatingPanelVisible(key)');
    expect(body).toContain('this.hideFloatingPanel(key)');
    expect(body).toContain('this.showFloatingPanel(key)');
    expect(methodBody('hideFloatingPanel')).toContain('.hide({ silent: true })');
  });

  it('les panneaux de droite commencent sous la barre (décalage calculé, v1 seulement)', () => {
    expect(methodBody('layoutFloatingPanelSwitcher')).toContain('switcherPanelOffsetPx(');
    expect(methodBody('layoutFloatingPanelSwitcher')).toContain("'--map-switcher-offset'");
    expect(css).toMatch(/--right-panel-top: calc\(var\(--header-height\) \+ 68px \+ var\(--map-switcher-offset, 0px\)\);/);
  });

  it('la barre est placée sous le sélecteur Carte | Satellite, à la hauteur du module', () => {
    const rule = /\.floating-panel-switcher \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('top: 56px;');
  });

  it('au chargement (v1), un seul panneau flottant se rouvre', () => {
    expect(methodBody('restoreActiveLayerPanelsAfterRefresh')).toContain('restorePanelPlan(');
  });

  it('v2 : la mise en page des puces passe par v2SwitcherLayout et ne pose jamais is-compact', () => {
    const body = methodBody('layoutFloatingPanelSwitcher');
    expect(body).toContain('v2SwitcherLayout(');
    // is-compact (repli en icône seule de la v1) n'est posé que hors v2.
    const v2Part = body.slice(body.indexOf('if (this.uiV2) {'));
    expect(v2Part).not.toContain('is-compact');
    expect(body).toMatch(/if \(!this\.uiV2\) \{[^}]*is-compact/);
  });

  it('v2 : l\u2019apparence verte des puces n\u2019est sous aucun @media de largeur (vert à toutes les largeurs)', () => {
    // Retire chaque bloc @media (accolades équilibrées) : ce qui reste est la feuille « sans condition ».
    let outside = '';
    const media: string[] = [];
    for (let i = 0; i < css.length;) {
      const at = css.indexOf('@media', i);
      if (at === -1) { outside += css.slice(i); break; }
      outside += css.slice(i, at);
      const open = css.indexOf('{', at);
      let depth = 0;
      let end = open;
      for (; end < css.length; end += 1) {
        if (css[end] === '{') depth += 1;
        else if (css[end] === '}' && --depth === 0) break;
      }
      media.push(css.slice(at, end + 1));
      i = end + 1;
    }
    const chip = [...outside.matchAll(/#app\.ui-v2 \.floating-panel-switcher__chip \{([^}]*)\}/g)].map((m) => m[1]).join('\n');
    expect(chip).toContain('border: 1px solid rgba(var(--v2-brand-rgb), 0.5);');
    expect(chip).toContain('box-shadow: 0 0 0 1px rgba(var(--v2-brand-rgb), 0.14)');
    expect(chip).toContain('height: 36px;');
    const active = /#app\.ui-v2 \.floating-panel-switcher__chip\.is-active,\s*#app\.ui-v2 \.floating-panel-switcher__chip\.is-active:hover \{([^}]*)\}/.exec(outside)?.[1] ?? '';
    expect(active).toContain('background: var(--v2-brand);');
    expect(active).toContain('color: #04220f;');
    expect(outside).toContain('#app.ui-v2 .floating-panel-switcher__icon { color: var(--v2-brand); }');
    // Aucun @media de largeur ne porte l'apparence des puces ; seuls le placement et le mouvement réduit y restent.
    for (const block of media) {
      if (!block.includes('.floating-panel-switcher')) continue;
      expect(block).not.toMatch(/--v2-brand|background:|border:|box-shadow:|border-radius:|font-size:/);
    }
    expect(css).not.toMatch(/@media \(min-width: 1101px\)\s*\{\s*#app\.ui-v2 \.floating-panel-switcher__chip/);
  });
});
