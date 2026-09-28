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
});
