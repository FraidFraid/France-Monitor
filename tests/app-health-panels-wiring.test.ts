// Câblage des panneaux Santé dans App.ts (spec 2026-10-03 § 3). App.ts ne s'instancie pas sous vitest : ces tests lisent
// sa source, comme tests/app-layer-panels-lot2-wiring.test.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { HEALTH_TTL_MS } from '../src/services/health-surveillance.ts';

const app = readFileSync(new URL('../src/App.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8');
const layerPanel = readFileSync(new URL('../src/components/LayerPanel.ts', import.meta.url), 'utf8');

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

const PANELS = [
  ['health', 'Veille sanitaire', 'stethoscope', 'veillePanel', 'ensureVeillePanel', 'veille-panel-modal'],
  ['healthOscour', 'Urgences et SOS Médecins', 'siren', 'urgencesPanel', 'ensureUrgencesPanel', 'urgences-panel-modal'],
  ['healthApl', 'Accès aux soins', 'map-pin', 'accesSoinsPanel', 'ensureAccesSoinsPanel', 'acces-soins-panel-modal'],
  ['hospitals', 'Hôpitaux', 'hospital', 'hopitauxPanel', 'ensureHopitauxPanel', 'hopitaux-panel-modal'],
] as const;

describe('panneaux Santé : un panneau par couche (spec 2026-10-03 § 3)', () => {
  it('quatre panneaux flottants, titre = libellé de la couche ; plus de panneau unique à quatre couches', () => {
    for (const [id, label, icon] of PANELS) expect(app).toContain(`{ id: '${id}', label: '${label}', icon: '${icon}', layerKeys: ['${id}'] }`);
    expect(app).not.toContain("layerKeys: ['health', 'healthOscour', 'healthApl', 'hospitals']");
    expect(layerPanel).toContain("{ key: 'health', label: 'VEILLE SANITAIRE'");
    expect(layerPanel).toContain("{ key: 'healthOscour', label: 'URGENCES ET SOS MÉDECINS'");
    expect(layerPanel).toContain("{ key: 'healthApl', label: 'ACCÈS AUX SOINS'");
    expect(layerPanel).toContain("{ key: 'hospitals', label: 'HÔPITAUX'");
    expect(layerPanel).not.toMatch(/'(Santé \/ Épidémio|OSCOUR \/ SOS Médecins|APL : Déserts médicaux)'/);
  });
  it('création paresseuse, instance, ouverture avec la couche, fermeture qui coupe la couche', () => {
    for (const [id, , , field, ensure] of PANELS) {
      expect(methodBody('ensureLazyPanelForLayer')).toContain(`case '${id}': return [this.${ensure}()];`);
      expect(methodBody('getFloatingPanelInstance')).toContain(`case '${id}': return this.${field};`);
      expect(methodBody(ensure)).toContain(`this.closeHealthLayer('${id}')`);
    }
    const vis = methodBody('_handlePanelVisibility');
    expect(vis).toMatch(/key === 'health'\)[^]*this\.loadHealthSurveillance\('all'\)[^]*this\.veillePanel\?\.show\(this\.currentHealth\);[^]*this\.veillePanel\?\.hide\(\{ silent: true \}\)/);
    expect(vis).toMatch(/key === 'healthOscour'\)[^]*this\.loadHealthSurveillance\(\['syndromic', 'alerts'\]\)[^]*this\.urgencesPanel\?\.show\(this\.currentHealth\);/);
    expect(vis).toMatch(/key === 'healthApl'\)[^]*this\.loadHealthOffer\(\)[^]*this\.accesSoinsPanel\?\.show\(this\.currentHealthOffer\);/);
    expect(vis).toMatch(/key === 'hospitals'\)[^]*this\.loadHealthOffer\(\)[^]*this\.hopitauxPanel\?\.show\(this\.currentHealthOffer\);/);
    expect(methodBody('closeHealthLayer')).toContain('this.onLayerToggle(key, false);');
  });
  it('relève santé : 30 min, au-dessus du cache client de 25 min, pausée onglet caché, immédiate au retour, nettoyée', () => {
    const minutes = Number(/const POLL_HEALTH_MS\s*=\s*(\d+)\s*\*\s*60_000/.exec(app)?.[1]);
    expect(minutes).toBe(30);
    expect(minutes * 60_000).toBeGreaterThan(HEALTH_TTL_MS);
    const poll = methodBody('startHealthPolling');
    expect(poll).toContain('this.registerPausableInterval(');
    expect(poll).toContain('POLL_HEALTH_MS');
    expect(poll).toContain('this.healthSurveillanceKeys()');
    expect(app).toContain('this.startHealthPolling();');
    expect(app).toContain('this.removePausableInterval(this._intervalHealth); this._intervalHealth = null;');
  });
  it('données transmises aux panneaux ; panneau des sources sur la date de la donnée, jamais new Date()', () => {
    const s = methodBody('loadHealthSurveillance');
    expect(s).toContain("import('./services/health-surveillance.ts')");
    expect(s).toContain('this.veillePanel?.update(state);');
    expect(s).toContain('this.urgencesPanel?.update(state);');
    expect(s).toContain('surveillanceStatus(state, key, now)');
    expect(s).toContain('this.currentHealthNational = nationalSummary(state, now);');
    expect(s).not.toContain('new Date()');
    const o = methodBody('loadHealthOffer');
    expect(o).toContain('this.accesSoinsPanel?.update(offer);');
    expect(o).toContain('this.hopitauxPanel?.update(offer);');
    expect(o).toContain("offerStatus(offer, 'apl')");
    expect(o).not.toContain('new Date()');
    expect(methodBody('loadOptionalLayers')).toContain("this.loadHealthSurveillance('all')");
  });
  it('ancien panneau national, baromètre et pastille retirés du câblage', () => {
    for (const gone of ['NationalHealthPanel', 'HealthBarometerPanel', 'barometer-fab', 'open-national-health', 'open-health-barometer',
      'computeHealthBarometer', '__healthBarometerMetrics', 'updateBarometerFabVisibility', 'loadAplData', 'fetchHospitalsData',
      'fetchHealthData', 'Santé SPF / DREES']) {
      expect(app).not.toContain(gone);
    }
  });
  it('fiche thème Santé (v2) : niveau national transmis, liens d’ouverture des panneaux', () => {
    expect(methodBody('updatePoste')).toContain('health: this.currentHealthNational,');
    expect(app).toContain('onOpenLayerPanel: (key) => this.openLayerPanelFromFiche(key),');
    expect(methodBody('openLayerPanelFromFiche')).toContain('this.showFloatingPanel(def.id)');
  });
  it('panneaux en colonne v2 et en feuille basse mobile', () => {
    const mobile = /@media \(max-width: 768px\) \{\s*([^{]*)\{\s*position: fixed !important;/.exec(css)?.[1] ?? '';
    for (const [, , , , , cls] of PANELS) {
      expect(css).toContain(`#app.ui-v2 .${cls},`);
      expect(mobile).toContain(`.${cls}`);
      expect(css).toContain(`.${cls}::before`);
    }
  });
});
