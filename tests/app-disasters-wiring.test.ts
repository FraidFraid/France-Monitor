// tests/app-disasters-wiring.test.ts
// Câblage de la couche Catastrophes (GDACS) dans App.ts (spec 2026-10-12 GDACS), sur le modèle des couches de la phase B. App.ts ne
// s'instancie pas sous vitest : ces tests lisent sa source.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ENVIRONMENT_LAYER_KEYS } from '../src/config/environment-sources.ts';
import { ALL_PRESETABLE_LAYER_KEYS, THEME_LAYERS } from '../src/config/layer-presets.ts';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../src/App.ts');
const css = read('../src/styles/main.css');
const layerPanel = read('../src/components/LayerPanel.ts');
const urlState = read('../src/utils/urlState.ts');
const feed = read('../src/components/UnderMapNewsFeed.ts');
const quality = read('../src/services/sources-quality-dashboard.ts');

function methodBody(name: string): string {
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

describe('câblage de la couche Catastrophes (GDACS)', () => {
  it('clés, groupe Environnement, vues, restauration', () => {
    expect(ENVIRONMENT_LAYER_KEYS).toContain('disasters');
    expect(app).toMatch(/const DEFAULT_LAYERS[^]*?earthquakes: false,\s*disasters: false,/);
    expect(feed).toContain('disasters: false,');
    expect(urlState).toContain("'disasters'");
    expect(ALL_PRESETABLE_LAYER_KEYS).toContain('disasters');
    expect(THEME_LAYERS.environment).toContain('disasters');
    expect(methodBody('restoreActiveLayerPanelsAfterRefresh')).toContain("'earthquakes',\n      'disasters',");
  });
  it('panneau flottant, couche, tiroir, aide', () => {
    expect(app).toContain("{ id: 'disasters', label: 'Catastrophes', icon: 'globe', layerKeys: ['disasters'] }");
    expect(app).toMatch(/id: 'disasters',\s*groupId: 'environment',\s*role: 'child',\s*dependsOnGroup: true,\s*label: 'CATASTROPHES \(GDACS\)',\s*legend: DISASTERS_LEGEND,/);
    expect(layerPanel).toContain("{ key: 'disasters', label: 'CATASTROPHES (GDACS)', icon: fmIcon('globe'), sublayerOf: 'environmentGroup' }");
    expect(layerPanel).toMatch(/this\.helpItem\(fmIcon\('globe'\), 'Catastrophes \(GDACS\)', '[^']*'\)/);
  });
  it('panneau paresseux, ouverture, lecture, croix', () => {
    expect(methodBody('ensureLazyPanelForLayer')).toContain("case 'disasters': return [this.ensureDisastersPanel()];");
    expect(methodBody('getFloatingPanelInstance')).toContain("case 'disasters': return this.disastersPanel;");
    expect(methodBody('openEnvironmentPanel')).toContain("case 'disasters': this.disastersPanel?.show(this.currentDisasters); break;");
    expect(methodBody('loadEnvironmentSource')).toContain("case 'disasters': return this.loadDisasters();");
    expect(methodBody('ensureDisastersPanel')).toContain("this.closeEnvironmentLayer('disasters')");
    expect(methodBody('ensureDisastersPanel')).toMatch(/if \(this\.mapContainer\?\.canFocusMap\(\)\) panel\.setOnFocusAlert\(/);
  });
  it('chargeur : même forme que les séismes ; relevé au démarrage ; légende ; source cliquable', () => {
    const body = methodBody('loadDisasters');
    for (const p of [
      "this.readEnvironment('disasters',", 'const incoming = await fetchDisasters(this.currentDisasters);',
      'this.currentDisasters = mergeDisasters(this.currentDisasters, incoming);', "this.statusPanel?.updateSource('GDACS', disastersStatus(this.currentDisasters, now));",
      'this.mapContainer?.updateDisastersLayer(data, now);', 'this.disastersPanel?.update(this.currentDisasters);', 'this.refreshEnvironmentLegend();',
      'this.recordEnvironmentSamples(now);', 'this.refreshFranceIntelPanel();',
    ]) expect(body).toContain(p);
    expect(body).not.toContain('new Date()');
    expect(methodBody('loadSecondaryLayers')).toContain("name: 'disasters', task: this.loadDisasters()");
    expect(methodBody('refreshEnvironmentLegend')).toContain('disastersLegend(');
    expect(methodBody('handleSourcePanelClick')).toContain("void this.ensureDisastersPanel().then(() => this.openEnvironmentPanel('disasters'));");
    expect(app).toContain("'GDACS': 'disasters',");
    expect(quality).toContain("watchdogNames: ['GDACS']");
  });
  it('CSS : colonne v2, feuille basse mobile, filet, Méthode', () => {
    const mobile = /@media \(max-width: 768px\) \{\s*([^{]*)\{\s*position: fixed !important;/.exec(css)?.[1] ?? '';
    expect(css).toContain('#app.ui-v2 .disasters-panel-modal,');
    expect(mobile).toContain('.disasters-panel-modal');
    expect(css).toContain('.disasters-panel-modal::before');
    expect(css).toMatch(/#app :is\([^)]*\.disasters-panel-modal[^)]*\) \.fmk \.fmk-sec--ref \.fmk-kv \{/);
  });
});
