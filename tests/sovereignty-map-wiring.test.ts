// tests/sovereignty-map-wiring.test.ts
// Carte de la souveraineté (spec 2026-10-04 souveraineté § 2 ; contrats § 5) : DeckGLMap.ts et MapContainer.ts ne s'instancient pas en
// entier sous vitest ; ces tests lisent leur source, comme tests/environment-map-wiring.test.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const deck = read('src/components/DeckGLMap.ts');
const container = read('src/components/MapContainer.ts');
const constants = read('src/components/deckgl/constants.ts');

describe('DeckGLMap : couches Souveraineté de deckgl/sovereignty-map.ts', () => {
  it('sources et couches neuves ; identifiants exportés', () => {
    expect(deck).toContain('for (const id of SOV_SOURCE_IDS) this.map.addSource(id, sovSourceSpec());');
    expect(deck).toContain('for (const layer of SOV_LAYERS) this.map.addLayer(layer);');
    for (const id of ['SRC_SOV_AIRCRAFT', 'LYR_SOV_AIRCRAFT', 'LYR_SOV_AIRCRAFT_LABEL', 'SRC_SOV_AIRCRAFT_ABROAD', 'LYR_SOV_AIRCRAFT_ABROAD', 'SRC_SOV_EMERGENCIES',
      'LYR_SOV_EMERGENCIES', 'SRC_SOV_NAVY', 'LYR_SOV_NAVY_OBSERVED', 'LYR_SOV_NAVY_REFERENCE', 'SRC_SOV_OSM_WORKS', 'LYR_SOV_OSM_WORKS',
      'SRC_SOV_CABLE_VESSELS', 'LYR_SOV_CABLE_VESSELS']) expect(constants).toContain(`export const ${id} = `);
  });
  it('icônes de la Marine nationale : vu en AIS, référence au port (pointillé), flux figé (gris)', () => {
    for (const icon of ["'mil-ship':", "'mil-ship-ref':", "'mil-ship-stale':"]) expect(deck).toContain(icon);
    expect(deck).toContain('stroke-dasharray="6 5"');
  });
  it('visibilité par couche (SOV_LAYER_KEYS), option des ouvrages OSM, halo des câbles seulement couche visible', () => {
    expect(deck).toContain('for (const id of SOV_LAYER_KEYS.military) this.setVis(id, vis(layers.military));');
    expect(deck).toContain('for (const id of SOV_OPTION_LAYERS.osmWorks) this.setVis(id, vis(layers.military && this.osmWorksVisible));');
    expect(deck).toContain('for (const id of SOV_LAYER_KEYS.subseaCables) this.setVis(id, vis(layers.subseaCables));');
    expect(deck).toContain('if (layers.subseaCables) this.startSubseaPulseAnimation();');
    expect(deck).toContain('else this.stopSubseaPulseAnimation();');
    expect(deck).not.toContain('this.initPulseOverlay();\n    this.startSubseaPulseAnimation();');
  });
  it('une infobulle par objet, préparée avec la donnée ; clic transmis à App.ts ; anciennes infobulles des sites et des câbles retirées', () => {
    expect(deck).toContain('this.initSovereigntyInteractions();');
    expect(deck).toContain('const hit = topSovHit(layers.length > 0 ? map.queryRenderedFeatures(e.point, { layers }) : []);');
    expect(deck).toContain('const html = hit ? sovTooltipHtml(hit.layer.id, hit.properties ?? {}) : null;');
    expect(deck).toContain('if (hit) this.onSovereigntyFeatureClick(hit.layer.id, { ...(hit.properties ?? {}) });');
    expect(deck).not.toMatch(/buildSubseaCableTooltip|hoveredSubseaCableId|hideSubseaCableTooltip|<strong>\$\{p\.name \|\| 'Base'\}/);
  });
  it('réaffichage repeint à l’horloge courante ; clic gardé par les couches Souveraineté ; câbles hors service en gris ; ancien fichier des câbles non lu', () => {
    expect(deck).toContain('this.repaintSovereigntyOnShow(before, layers);');
    expect(deck).toContain('if (layers.military && !was.military) {');
    expect(deck).toContain('...SOV_HOVER_LAYERS,\n    ].filter(');
    expect(deck).toContain("'line-color': sovCableColor('#22c7ff'),");
    expect(deck).not.toContain('/data/submarine-cables.json');
  });
  it('méthodes de la carte et de son conteneur', () => {
    for (const sig of [
      'updateMilitaryLayer(m: MilitaryResponse | null, now: number): void',
      'updateNavyLayer(ships: readonly MilitaryShip[], frozen: boolean, now: number): void',
      'updateDefenseSites(bases: readonly MilitaryBase[]): void',
      'updateOsmWorks(file: DefenseOsmWorksFile | null): void',
      'setOsmWorksVisible(on: boolean): void',
      'updateCablesLayer(file: SubseaCablesFile | null, watch: CablesWatchResponse | null, now: number): void',
      'highlightCable(id: string | null): void',
      'setOnSovereigntyFeatureClick(handler: (layerId: string, props: Record<string, unknown>) => void): void',
    ]) {
      expect(deck, sig).toContain(sig);
      expect(container, sig).toContain(sig);
    }
    expect(container).toContain('if (this.onSovereigntyFeatureClick) this.deckMap.setOnSovereigntyFeatureClick(this.onSovereigntyFeatureClick);');
  });
});
