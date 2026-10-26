// tests/app-protests-wiring.test.ts
// Câblage de la couche Manifestations dans App.ts et ses déclarations (spec 2026-10-17 manifestations). App.ts ne s'instancie pas sous
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

describe('câblage de la couche Manifestations', () => {
  it('clés : défaut éteint, URL, fil sous la carte, thème Sécurité, restauration', () => {
    expect(app).toMatch(/const DEFAULT_LAYERS[^]*?outagesCloud: false,\s*protests: false,/);
    expect(feed).toContain('protests: false,');
    expect(urlState).toContain("'protests'");
    expect(ALL_PRESETABLE_LAYER_KEYS).toContain('protests');
    expect(THEME_LAYERS.security).toContain('protests');
    for (const [theme, keys] of Object.entries(THEME_LAYERS)) if (theme !== 'security') expect(keys).not.toContain('protests');
    expect(methodBody('restoreActiveLayerPanelsAfterRefresh')).toContain("'outagesCloud',\n      'protests',");
  });
  it('couche de premier niveau dans le tiroir (hors Souveraineté et Environnement), puce, légende', () => {
    expect(layerPanel).toMatch(/\{ key: 'protests', label: 'MANIFESTATIONS', icon: [^\n]*megaphone[^\n]*\},/);
    expect(layerPanel).not.toMatch(/key: 'protests'[^\n]*sublayerOf/);
    expect(app).toContain("{ id: 'protests', label: 'Manifestations', icon: 'megaphone', layerKeys: ['protests'] }");
    expect(app).toMatch(/id: 'protests',\s*role: 'standalone',\s*label: 'MANIFESTATIONS',\s*legend: PROTESTS_LEGEND,/);
  });
  it('panneau paresseux, ouverture, lecture, croix', () => {
    expect(methodBody('ensureLazyPanelForLayer')).toContain("case 'protests': return [this.ensureProtestsPanel()];");
    expect(methodBody('getFloatingPanelInstance')).toContain("case 'protests': return this.protestsPanel;");
    expect(methodBody('_handlePanelVisibility')).toContain('this.openProtestsPanel();');
    expect(methodBody('ensureProtestsPanel')).toContain('this.closeProtestsLayer()');
    expect(methodBody('ensureProtestsPanel')).toMatch(/if \(this\.mapContainer\?\.canFocusMap\(\)\) panel\.setOnFocusPlace\(/);
  });
  it('lecture : une seule à la fois, carte, panneau et légende ; relève de 10 min seulement couche active ou panneau ouvert', () => {
    const load = methodBody('loadProtests');
    expect(load).toContain("dedupe('protests'");
    expect(load).toContain('this.currentProtests = mergeProtests(this.currentProtests, await fetchProtests(this.currentProtests));');
    expect(load).toContain('this.mapContainer?.updateProtestsLayer(this.protestsForMap());');
    expect(load).toContain('this.protestsPanel?.update(this.currentProtests);');
    expect(methodBody('protestsPollWanted')).toContain('this.activeLayers.protests');
    expect(methodBody('syncProtestsPolling')).toContain('PROTESTS_POLL_MS');
    // Pas de lecture au démarrage couche éteinte : aucune entrée dans la liste des chargements de départ.
    expect(app).not.toMatch(/name: 'protests'/);
  });
  it('carte : clic sur un point relayé jusqu’au panneau ; aucun appel direct aux sources depuis le navigateur', () => {
    expect(app).toContain('this.mapContainer.setOnProtestClick((key) => this.onProtestMapClick(key));');
    expect(container).toContain('this.deckMap?.setOnProtestClick(handler);');
    expect(deck).toContain('updateProtestsLayer(r: ProtestsResponse | null): void');
    const service = read('../src/services/protests.ts');
    expect(service).not.toMatch(/demosphere\.net|gdeltproject\.org|api\.gdelt/);
  });
  it('CSS : colonne du panneau comme les autres panneaux de couche', () => {
    expect(css).toContain('.protests-panel-modal,');
    expect(css).toContain('.protests-panel-modal::before,');
    expect(css).toContain('#app.ui-v2 .protests-panel-modal,');
  });
});
