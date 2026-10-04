// tests/environment-map-wiring.test.ts
// Carte de l'environnement (spec 2026-10-04 environnement § 2 ; contrats § 5) : DeckGLMap.ts et MapContainer.ts ne s'instancient pas
// en entier sous vitest ; ces tests lisent leur source, comme tests/traffic-map-wiring.test.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const deck = read('src/components/DeckGLMap.ts');
const container = read('src/components/MapContainer.ts');
const constants = read('src/components/deckgl/constants.ts');

/** Définition d'une couche MapLibre dans DeckGLMap.ts : de `id: X,` à la fermeture de son addLayer. */
const layerBlock = (id: string): string => {
  const start = deck.indexOf(`      id: ${id},\n`);
  return start < 0 ? '' : deck.slice(start, deck.indexOf('\n    });', start));
};

describe('DeckGLMap : couches Environnement de deckgl/environment-map.ts', () => {
  it('sources et couches nouvelles ; couches existantes lisant la couleur portée par l’objet, sans repli', () => {
    expect(deck).toContain('for (const id of ENV_SOURCE_IDS) this.map.addSource(id, envSourceSpec());');
    expect(deck).toContain('for (const layer of ENV_LAYERS) {');
    expect(deck).toContain("this.map.addLayer(layer, before && this.map.getLayer(before) ? before : undefined);");
    expect(layerBlock('LYR_WEATHER_FILL')).toContain("'fill-color': ['get', 'fillColor'],");
    for (const id of ['LYR_WEATHER_LINE_YELLOW', 'LYR_WEATHER_LINE_ORANGE', 'LYR_WEATHER_LINE_RED']) {
      expect(layerBlock(id), id).toContain("'line-color': ['get', 'lineColor'],");
    }
    expect(layerBlock('LYR_FIRES_GLOW')).toContain("filter: ['==', ['get', 'glow'], true],");
    for (const id of ['LYR_FIRES_GLOW', 'LYR_FIRES_POINTS']) expect(layerBlock(id), id).toContain("'circle-color': ['get', 'color'],");
    expect(layerBlock('LYR_FLOODS')).toContain("['get', 'color'],");
    expect(layerBlock('LYR_FLOODS')).not.toMatch(/geometryFidelity|filter:/);
    for (const id of ['SRC_FLOOD_STATIONS', 'LYR_FLOOD_STATIONS', 'SRC_RADAR_PICK', 'LYR_RADAR_PICK', 'SRC_FIRES_ABROAD', 'LYR_FIRES_ABROAD', 'SRC_FOREST_DANGER',
      'LYR_FOREST_DANGER_FILL', 'LYR_FOREST_DANGER_LINE']) expect(constants).toContain(`export const ${id} = `);
  });
  it('visibilité par couche (ENV_LAYER_KEYS) ; crues avec leur clé ; option météo des forêts ; sommets d’écho avec Radar ou Feux', () => {
    expect(deck).toContain("for (const id of ENV_LAYER_KEYS.environmental) this.setVis(id, vis(envLayerOn(layers, 'environmental')));");
    expect(deck).toContain("const floodsOn = envLayerOn(layers, 'floods');");
    expect(deck).toContain('for (const id of ENV_LAYER_KEYS.floods) this.setVis(id, vis(floodsOn));');
    expect(deck).toContain('for (const id of ENV_LAYER_KEYS.fires) this.setVis(id, vis(firesOn));');
    expect(deck).toContain('for (const id of FOREST_DANGER_LAYERS) this.setVis(id, vis(firesOn && this._forestDangerFill));');
    expect(deck).toContain('this.setVis(RADAR_2D_LAYER_ID, vis(this.radar2dShown()));');
    expect(deck).toContain('return this.currentLayers?.weatherRadar ?? false;');
    expect(deck).toContain('this.setVis(ECHO_TOPS_LAYER_ID, vis(this.echoTopsShown(this._echoTopsEnabled)));');
    expect(deck).toContain("return enabled && ((this.currentLayers?.weatherRadar ?? false) || (this.currentLayers?.fires ?? false));");
  });
  it('image radar nette, sous les autres couches', () => {
    expect(deck).toContain("'raster-resampling': 'nearest',");
    expect(deck).toContain('}, this.map.getLayer(ECHO_TOPS_LAYER_ID) ? ECHO_TOPS_LAYER_ID : this.map.getLayer(LYR_WEATHER_FILL) ? LYR_WEATHER_FILL : undefined);');
  });
  it('infobulle de la couche du dessus, préparée avec la donnée ; point du profil radar au clic', () => {
    expect(deck).toContain('this.initEnvironmentInteractions();');
    expect(deck).toContain('const hit = topEnvHit(visible.length > 0 ? map.queryRenderedFeatures(e.point, { layers: visible }) : []);');
    expect(deck).toContain('const html = hit ? envTooltipHtml(hit.layer.id, hit.properties ?? {}) : null;');
    expect(deck).toContain("if (!this.onRadarPointPick || !(this.currentLayers?.weatherRadar ?? false)) return;");
  });
  it('méthodes de la carte et de son conteneur ; anciennes méthodes retirées', () => {
    for (const sig of [
      'updateVigilanceLayer(v: VigilanceResponse | null, echeance: VigilanceEcheance, now: number): Promise<void>',
      'updateFloodsLayer(f: FloodsResponse | null, now: number): void', 'highlightFloodSection(id: string | null): void', 'focusFloodSection(id: string): void',
      'updateFiresLayer(f: FiresResponse | null, now: number, opts: { forestDangerFill: boolean }): void', 'highlightFoyer(id: string | null): void',
      'setRadarPick(point: { lat: number; lon: number } | null): void', 'setOnRadarPointPick(handler: (lat: number, lon: number) => void): void',
    ]) {
      expect(deck).toContain(sig);
      expect(container).toContain(sig);
    }
    expect(container).toContain('if (this.onRadarPointPick) this.deckMap.setOnRadarPointPick(this.onRadarPointPick);');
    expect(container).toContain('if (this.radarPick) this.deckMap.setRadarPick(this.radarPick);');
    expect(container).toContain('this.radarPick = point;');
    for (const old of ['updateWeather(', 'updateFloods(', 'updateFires(', 'highlightFloodSegment(', 'highlightFire(', 'setFirePointsVisible(',
      'updateTerminator(', 'updateDayNightOptions(', 'refreshWeatherRadar(', 'setOnWeatherRadarFrame(', 'updateTopageVisual(']) {
      expect(deck, old).not.toContain(old);
      expect(container, old).not.toContain(old);
    }
  });
});
