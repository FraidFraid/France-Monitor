// Câblage des panneaux de couches du lot 2 dans App.ts (spec 2026-10-02 lot 2). App.ts ne s'instancie pas
// sous vitest : ces tests lisent sa source, comme tests/app-floating-switcher-wiring.test.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8');

function methodBody(name: string): string {
  // Signature jusqu'à la première ligne qui se termine par « { » (un type de retour peut contenir des accolades).
  const signature = new RegExp(`\\n  (?:private |public )?(?:async )?${name}\\([^]*?\\{[ \\t]*\\n`);
  const match = signature.exec(app);
  if (!match) throw new Error(`méthode ${name} introuvable dans App.ts`);
  const start = match.index + match[0].length - 2;
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

describe('panneau Réseau gaz (spec lot 2 § 3.1)', () => {
  it('l’interrupteur pipeline, sans effet, n’est plus câblé', () => {
    expect(app).not.toContain('setPipelineCallback');
  });
});

describe('panneau Éolien (spec lot 2 § 3.4)', () => {
  it('reçoit la série éCO2mix à la création et à chaque rafraîchissement du réseau', () => {
    expect(methodBody('loadEcowatt')).toContain('this.eolienPanel?.setGrid(this.currentEcowattResponse.grid);');
    expect(methodBody('ensureEolienPanel')).toContain('panel.setGrid(this.currentEcowattResponse?.grid ?? null);');
  });
});

describe('panneau Charge métropolitaine (spec lot 2 § 3.5)', () => {
  it('déclaré comme panneau flottant de la couche metroLoad', () => {
    expect(app).toContain("{ id: 'metroLoad', label: 'Charge métropolitaine', icon: 'building-2', layerKeys: ['metroLoad'] }");
  });
  it('création paresseuse, instance, ouverture avec la couche, fermeture qui coupe la couche', () => {
    expect(methodBody('ensureLazyPanelForLayer')).toContain("case 'metroLoad': return [this.ensureMetroLoadPanel()];");
    expect(methodBody('getFloatingPanelInstance')).toContain("case 'metroLoad': return this.metroLoadPanel;");
    expect(methodBody('_handlePanelVisibility')).toMatch(/key === 'metroLoad'[^]*void this\.loadMetropoles\(\);[^]*this\.metroLoadPanel\?\.show\(this\.currentMetropoles, this\.nationalConsumptionMw\(\)\)/);
    expect(methodBody('ensureMetroLoadPanel')).toContain("this.closeEnergyLayer('metroLoad')");
  });
  it('rafraîchi avec les données ; part nationale sur la consommation éCO2mix (carte et panneau)', () => {
    const body = methodBody('loadMetropoles');
    expect(body).toContain('this.currentMetropoles = metropoles;');
    expect(body).toContain('this.mapContainer?.updateMetropoles(metropoles, this.nationalConsumptionMw() ?? undefined);');
    expect(body).toContain('this.metroLoadPanel?.update(metropoles, this.nationalConsumptionMw());');
    expect(methodBody('nationalConsumptionMw')).toContain('this.currentEcowattResponse?.grid?.consumptionMw ?? null');
  });
  it('empilé, restauré, en colonne v2 et en feuille basse mobile', () => {
    expect(methodBody('layoutEnergyFloatingPanels')).toContain("'.metro-load-panel-modal'");
    expect(methodBody('restoreActiveLayerPanelsAfterRefresh')).toContain("'metroLoad'");
    expect(css).toContain('#app.ui-v2 .metro-load-panel-modal,');
    const mobile = /@media \(max-width: 768px\) \{\s*([^{]*)\{\s*position: fixed !important;/.exec(css)?.[1] ?? '';
    expect(mobile).toContain('.metro-load-panel-modal');
  });
  it('légende de la carte sur les niveaux, libellés « Charge relative … »', () => {
    expect(app).toContain('label: METRO_LEGEND_LABELS.small, color: levelHex(METRO_LEVEL.small)');
  });
});
