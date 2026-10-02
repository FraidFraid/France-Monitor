// Câblage des panneaux de couches du lot 2 dans App.ts (spec 2026-10-02 lot 2). App.ts ne s'instancie pas
// sous vitest : ces tests lisent sa source, comme tests/app-floating-switcher-wiring.test.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DROM_LIVE_TTL_MS } from '../src/services/drom-live.ts';
import { ECOWATT_TTL_MS } from '../src/services/ecowatt.ts';

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
    expect(methodBody('_handlePanelVisibility')).toMatch(/key === 'metroLoad'[^]*void this\.loadMetropoles\(\);[^]*this\.metroLoadPanel\?\.show\(this\.currentMetropoles\)/);
    expect(methodBody('ensureMetroLoadPanel')).toContain("this.closeEnergyLayer('metroLoad')");
  });
  it('relève éCO2mix dédiée : 5 min, au-dessus du cache client, démarrée à l’init, pausée onglet caché, arrêtée au nettoyage', () => {
    const minutes = Number(/const POLL_ECO2MIX_MS\s*=\s*(\d+)\s*\*\s*60_000/.exec(app)?.[1]);
    expect(minutes).toBe(5);
    expect(minutes * 60_000).toBeGreaterThan(ECOWATT_TTL_MS);
    const body = methodBody('startEco2mixPolling');
    expect(body).toContain('this.registerPausableInterval(');
    expect(body).toContain('this.loadEcowatt()');
    expect(body).toContain('POLL_ECO2MIX_MS');
    expect(app).toContain('this.startEco2mixPolling();');
    expect(app).toContain('this.removePausableInterval(this._intervalEco2mix); this._intervalEco2mix = null;');
  });
  it('relève DROM : intervalle de 5 min, strictement au-dessus du cache client', () => {
    const minutes = Number(/const POLL_DROM_LIVE_MS\s*=\s*(\d+)\s*\*\s*60_000/.exec(app)?.[1]);
    expect(minutes * 60_000).toBeGreaterThan(DROM_LIVE_TTL_MS);
  });
  it('rafraîchi avec les données ; part nationale portée par chaque métropole (à son propre instant), plus de dénominateur courant', () => {
    const body = methodBody('loadMetropoles');
    expect(body).toContain('this.currentMetropoles = metropoles;');
    expect(body).toContain('this.mapContainer?.updateMetropoles(metropoles);');
    expect(body).toContain('this.metroLoadPanel?.update(metropoles);');
    expect(app).not.toContain('nationalConsumptionMw');
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

describe('panneau Énergie DROM (spec lot 2 § 3.6)', () => {
  it('production en temps réel lue à l’activation, transmise au panneau, erreurs gardées', () => {
    const body = methodBody('loadDromLive');
    expect(body).toContain("await import('./services/drom-live.ts')");
    expect(body).toContain('this.dromEnergyPanel?.setLive(this.currentDromLive, this.currentDromLiveError);');
    expect(methodBody('_handlePanelVisibility')).toMatch(/key === 'dromEnergy'[^]*void this\.loadDromLive\(\);/);
    expect(methodBody('ensureDromEnergyPanel')).toContain('panel.setLive(this.currentDromLive, this.currentDromLiveError);');
  });
  it('rafraîchie toutes les 5 minutes tant que la couche ou le panneau est actif ; intervalle nettoyé', () => {
    expect(app).toMatch(/const POLL_DROM_LIVE_MS\s*=\s*5 \* 60_000;/);
    const poll = methodBody('startDromLivePolling');
    expect(poll).toContain('this.activeLayers.dromEnergy');
    expect(poll).toContain('this.dromEnergyPanel?.isVisible() === true');
    expect(poll).toContain('POLL_DROM_LIVE_MS');
    expect(app).toContain('this.startDromLivePolling();');
    expect(app).toContain('if (this._intervalDromLive !== null) { clearInterval(this._intervalDromLive); this._intervalDromLive = null; }');
  });
});
