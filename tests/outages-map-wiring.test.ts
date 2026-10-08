// tests/outages-map-wiring.test.ts
// Carte des pannes réseau (spec 2026-10-08) : DeckGLMap.ts et MapContainer.ts ne s'instancient pas en entier sous vitest ; ces tests
// lisent leur source, comme tests/sovereignty-map-wiring.test.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const deck = read('src/components/DeckGLMap.ts');
const container = read('src/components/MapContainer.ts');
const constants = read('src/components/deckgl/constants.ts');

describe('DeckGLMap : couches Pannes réseau de deckgl/outages-map.ts', () => {
  it('sources et couches neuves, ajoutées à côté de celles de la Souveraineté ; identifiants exportés', () => {
    expect(deck).toContain('for (const id of OUT_SOURCE_IDS) this.map.addSource(id, outSourceSpec());');
    expect(deck).toContain('for (const layer of OUT_LAYERS) this.map.addLayer(layer);');
    for (const id of ['SRC_OUT_TELECOM', 'SRC_OUT_POWER', 'LYR_OUT_TELECOM_LONG', 'LYR_OUT_TELECOM_RECENT', 'LYR_OUT_TELECOM_MAINT', 'LYR_OUT_POWER_PLANNED',
      'LYR_OUT_POWER_UNPLANNED']) expect(constants).toContain(`export const ${id} = `);
  });
  it('visibilité par couche ; maintenances télécoms visibles seulement couche active et option cochée', () => {
    expect(deck).toContain('for (const id of OUT_LAYER_KEYS.outagesTelecom) this.setVis(id, vis(layers.outagesTelecom));');
    expect(deck).toContain('for (const id of OUT_LAYER_KEYS.outagesElec) this.setVis(id, vis(layers.outagesElec));');
    expect(deck).toContain('this.setVis(OUT_MAINTENANCE_LAYER, vis(layers.outagesTelecom && this.telecomMaintenanceOn));');
    expect(deck).toContain("this.setVis(OUT_MAINTENANCE_LAYER, on && (this.currentLayers?.outagesTelecom ?? false) ? 'visible' : 'none');");
  });
  it('infobulle préparée avec la donnée, survol propre ; clic sur une couche panne gardé (profil radar)', () => {
    expect(deck).toContain('this.initOutagesInteractions();');
    expect(deck).toContain('const hit = topOutHit(layers.length > 0 ? map.queryRenderedFeatures(e.point, { layers }) : []);');
    expect(deck).toContain('const html = hit ? outTooltipHtml(hit.layer.id, hit.properties ?? {}) : null;');
    expect(deck).toContain('...OUT_HOVER_LAYERS, ...SOV_HOVER_LAYERS,\n    ].filter(');
  });
  it('méthodes de la carte et de son conteneur, sans champ de données inutilisé', () => {
    for (const sig of [
      'updateOutagesTelecom(t: TelecomOutagesResponse | null, now: number): void',
      'updateOutagesPower(p: PowerOutagesResponse | null, now: number): void',
      'setTelecomMaintenanceVisible(on: boolean): void',
    ]) {
      expect(deck, sig).toContain(sig);
      expect(container, sig).toContain(sig);
    }
    expect(deck).not.toContain('outTelecom:');
    expect(deck).not.toContain('lastLayers');
    expect(container).toContain('this.deckMap?.updateOutagesTelecom(t, now);');
    expect(container).toContain('this.deckMap?.updateOutagesPower(p, now);');
    expect(container).toContain('this.deckMap?.setTelecomMaintenanceVisible(on);');
  });
});
