// tests/app-webcams-wiring.test.ts
// Câblage de la couche Webcams dans App.ts et ses déclarations. App.ts ne s'instancie pas sous vitest : ces tests lisent sa source.
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
const vite = read('../vite.config.ts');
const pkg = read('../package.json');

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

describe('câblage de la couche Webcams', () => {
  it('clés : type, défaut éteint, URL, fil sous la carte, thème Environnement seulement, restauration', () => {
    expect(types).toMatch(/crime: boolean;[^]*?webcams: boolean;/);
    expect(app).toMatch(/const DEFAULT_LAYERS[^]*?crime: false,\s*webcams: false,/);
    expect(feed).toContain('webcams: false,');
    expect(urlState).toContain("'webcams'");
    expect(ALL_PRESETABLE_LAYER_KEYS).toContain('webcams');
    expect(THEME_LAYERS.environment).toContain('webcams');
    for (const [theme, keys] of Object.entries(THEME_LAYERS)) if (theme !== 'environment') expect(keys).not.toContain('webcams');
    expect(methodBody('restoreActiveLayerPanelsAfterRefresh')).toContain("'crime',\n      'webcams',");
  });
  it('couche autonome de premier niveau dans le tiroir (comme Manifestations), puce, légende, aide', () => {
    expect(layerPanel).toMatch(/\{ key: 'webcams', label: 'WEBCAMS', icon: [^\n]*camera[^\n]*\},/);
    expect(layerPanel).not.toMatch(/key: 'webcams'[^\n]*sublayerOf/);
    expect(layerPanel).toContain("this.helpSection(fmIcon('camera'), 'Webcams'");
    expect(app).toContain("{ id: 'webcams', label: 'Webcams', icon: 'camera', layerKeys: ['webcams'] }");
    expect(app).toMatch(/id: 'webcams',\s*role: 'standalone',\s*label: 'WEBCAMS',\s*legend: WEBCAMS_LEGEND,/);
  });
  it('panneau paresseux, ouverture, lecture unique, croix', () => {
    expect(methodBody('ensureLazyPanelForLayer')).toContain("case 'webcams': return [this.ensureWebcamsPanel()];");
    expect(methodBody('getFloatingPanelInstance')).toContain("case 'webcams': return this.webcamsPanel;");
    expect(methodBody('_handlePanelVisibility')).toContain('this.openWebcamsPanel();');
    expect(methodBody('ensureWebcamsPanel')).toContain('this.closeWebcamsLayer()');
    const load = methodBody('loadWebcams');
    expect(load).toContain("dedupe('webcams'");
    expect(load).toContain('fetchWebcamsDataset()');
    expect(load).toContain('this.mapContainer?.updateWebcamsLayer(this.currentWebcams);');
    expect(methodBody('openWebcamsPanel')).toContain('if (this.currentWebcams === null)');
    expect(app).not.toMatch(/webcamsPoll|WEBCAMS_POLL/);
  });
  it('carte : points regroupés, visibilité, clic relayé jusqu’à la fiche', () => {
    expect(app).toContain('this.mapContainer.setOnWebcamClick((id) => this.onWebcamMapClick(id));');
    expect(methodBody('onWebcamMapClick')).toContain('this.webcamsPanel?.select(id);');
    expect(container).toContain('this.deckMap?.setOnWebcamClick(handler);');
    expect(deck).toContain('updateWebcamsLayer(data: WebcamsDataset | null): void');
    expect(deck).toContain('this.map.addSource(SRC_WEBCAMS, webcamSourceSpec());');
    expect(deck).toMatch(/for \(const id of WEBCAM_LAYER_IDS\) this\.setVis\(id, vis\(layers\.webcams \?\? false\)\);/);
    expect(deck).toContain("} else if (categoryId === 'webcams') {");
  });
  it('aucun effet sur le score ; fichier hors précache ; commande de recensement', () => {
    expect(read('../src/services/webcams.ts')).not.toMatch(/stability|situation|isnr/i);
    expect(vite).toContain("'data/webcams.json'");
    expect(pkg).toContain('"build:webcams": "node scripts/build-webcams.mjs"');
  });
  it('CSS : colonne du panneau comme les autres panneaux de couche', () => {
    expect(css).toContain('.webcams-panel-modal,');
    expect(css).toContain('.webcams-panel-modal::before,');
    expect(css).toContain('#app.ui-v2 .webcams-panel-modal,');
  });
});
