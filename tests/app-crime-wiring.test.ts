// tests/app-crime-wiring.test.ts
// Câblage de la couche Criminalité dans App.ts et ses déclarations (spec 2026-10-17 criminalité). App.ts ne s'instancie pas sous
// vitest : ces tests lisent sa source.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ALL_PRESETABLE_LAYER_KEYS, THEME_LAYERS } from '../src/config/layer-presets.ts';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../src/App.ts');
const css = read('../src/styles/main.css');
const layerPanel = read('../src/components/LayerPanel.ts');
const urlState = read('../src/utils/urlState.ts');
const feed = read('../src/components/UnderMapNewsFeed.ts');
const deck = read('../src/components/DeckGLMap.ts');
const container = read('../src/components/MapContainer.ts');
const types = read('../src/types/index.ts');

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

describe('câblage de la couche Criminalité', () => {
  it('clés : type, défaut éteint, URL, fil sous la carte, thème Sécurité, restauration', () => {
    expect(types).toMatch(/protests: boolean;[^]*?crime: boolean;/);
    expect(app).toMatch(/const DEFAULT_LAYERS[^]*?protests: false,\s*crime: false,/);
    expect(feed).toContain('crime: false,');
    expect(urlState).toContain("'crime'");
    expect(ALL_PRESETABLE_LAYER_KEYS).toContain('crime');
    expect(THEME_LAYERS.security).toContain('crime');
    for (const [theme, keys] of Object.entries(THEME_LAYERS)) if (theme !== 'security') expect(keys).not.toContain('crime');
    expect(methodBody('restoreActiveLayerPanelsAfterRefresh')).toContain("'protests',\n      'crime',");
  });
  it('couche de premier niveau dans le tiroir, puce, légende', () => {
    expect(layerPanel).toMatch(/\{ key: 'crime', label: 'CRIMINALITÉ', icon: [^\n]*siren[^\n]*\},/);
    expect(layerPanel).not.toMatch(/key: 'crime'[^\n]*sublayerOf/);
    expect(app).toContain("{ id: 'crime', label: 'Criminalité', icon: 'siren', layerKeys: ['crime'] }");
    expect(app).toMatch(/id: 'crime',\s*role: 'standalone',\s*label: 'CRIMINALITÉ',\s*legend: CRIME_LEGEND,/);
  });
  it('panneau paresseux, ouverture, lecture, croix', () => {
    expect(methodBody('ensureLazyPanelForLayer')).toContain("case 'crime': return [this.ensureCrimePanel()];");
    expect(methodBody('getFloatingPanelInstance')).toContain("case 'crime': return this.crimePanel;");
    expect(methodBody('_handlePanelVisibility')).toContain('this.openCrimePanel();');
    expect(methodBody('ensureCrimePanel')).toContain('this.closeCrimeLayer()');
    expect(methodBody('ensureCrimePanel')).toContain('this.mapContainer?.setCrimeIndicator(key);');
    expect(methodBody('ensureCrimePanel')).toMatch(/if \(this\.mapContainer\?\.canFocusMap\(\)\) panel\.setOnFocusPlace\(/);
  });
  it('lecture unique du fichier statique : aucune relève, aucune lecture au démarrage couche éteinte', () => {
    const load = methodBody('loadCrime');
    expect(load).toContain("dedupe('crime'");
    expect(load).toContain('fetchCrimeDataset()');
    expect(load).toContain('this.mapContainer?.updateCrimeLayer(this.currentCrime);');
    expect(load).toContain('this.crimePanel?.update(this.currentCrime, this.crimeError);');
    expect(methodBody('openCrimePanel')).toContain('if (this.currentCrime === null)');
    expect(app).not.toMatch(/crimePoll|CRIME_POLL|name: 'crime'/);
  });
  it('carte : indicateur, villes et départements ; clic sur un rond relayé jusqu’au panneau', () => {
    expect(app).toContain('this.mapContainer.setOnCrimeCityClick((code) => this.onCrimeMapClick(code));');
    expect(container).toContain('this.deckMap?.setOnCrimeCityClick(handler);');
    expect(container).toContain('this.deckMap?.setCrimeIndicator(key);');
    expect(deck).toContain('updateCrimeLayer(data: CrimeDataset | null): void');
    expect(deck).toContain('setCrimeIndicator(key: CrimeIndicatorKey): void');
    expect(deck).toMatch(/for \(const id of CRIME_LAYER_IDS\) this\.setVis\(id, vis\(layers\.crime \?\? false\)\);/);
    expect(deck).toContain('if (layers.crime && this.crimeDirty) void this.renderCrime();');
  });
  it('aucun effet sur le score : le service ne touche ni indice ni situations', () => {
    const service = read('../src/services/crime.ts');
    expect(service).not.toMatch(/stability|situation|isnr/i);
  });
  it('CSS : colonne du panneau comme les autres panneaux de couche', () => {
    expect(css).toContain('.crime-panel-modal,');
    expect(css).toContain('.crime-panel-modal::before,');
    expect(css).toContain('#app.ui-v2 .crime-panel-modal,');
  });
});
