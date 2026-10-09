// tests/outages-map-wiring.test.ts
// Carte des pannes réseau (spec 2026-10-08) : DeckGLMap.ts et MapContainer.ts ne s'instancient pas en entier sous vitest ; ces tests
// lisent leur source, comme tests/sovereignty-map-wiring.test.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const deck = read('src/components/DeckGLMap.ts');
const container = read('src/components/MapContainer.ts');
const constants = read('src/components/deckgl/constants.ts');
const css = read('src/styles/main.css');

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
    expect(deck).toContain('...OUT_HOVER_LAYERS.filter((id) => id !== LYR_OUT_INTERNET_FILL), ...SOV_HOVER_LAYERS,\n    ].filter(');
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
  it('Internet et Cloud : identifiants exportés, jeton CSS du référentiel', () => {
    for (const id of ['SRC_OUT_INTERNET', 'SRC_OUT_CLOUD_ZONES', 'SRC_OUT_CLOUD_REF', 'LYR_OUT_INTERNET_FILL', 'LYR_OUT_INTERNET_LINE', 'LYR_OUT_CLOUD_REF',
      'LYR_OUT_CLOUD_ZONES']) expect(constants).toContain(`export const ${id} = `);
    expect(css).toContain('--cat-out-ref: #8b8f9a;');
  });
  it('Internet : les départements sont lus par loadDepartementsGeojson() avant setData ; Cloud : deux sources', () => {
    expect(deck).toContain('void loadDepartementsGeojson().then((geo) => {');
    expect(deck).toContain('internetFeatures(r, geo, now)');
    expect(deck).toContain('updateOutagesInternet(r: InternetOutagesResponse | null, now: number): void');
    expect(deck).toContain('updateOutagesCloud(r: CloudOutagesResponse | null, now: number): void');
    expect(deck).toContain('(this.map?.getSource(SRC_OUT_CLOUD_ZONES) as maplibregl.GeoJSONSource | undefined)?.setData(cloudZoneFeatures(r, now));');
    expect(deck).toContain('(this.map?.getSource(SRC_OUT_CLOUD_REF) as maplibregl.GeoJSONSource | undefined)?.setData(cloudReferenceFeatures(r));');
  });
  it('visibilité des couches Internet et Cloud par OUT_LAYER_KEYS', () => {
    expect(deck).toContain('for (const id of OUT_LAYER_KEYS.outagesInternet) this.setVis(id, vis(layers.outagesInternet));');
    expect(deck).toContain('for (const id of OUT_LAYER_KEYS.outagesCloud) this.setVis(id, vis(layers.outagesCloud));');
  });
  it('P22 : la surface Internet est exclue de clickHitsInteractiveFeature (elle bloquerait le profil radar), le contour reste', () => {
    expect(deck).toContain('...OUT_HOVER_LAYERS.filter((id) => id !== LYR_OUT_INTERNET_FILL)');
    expect(deck).not.toContain('...OUT_HOVER_LAYERS, ');
  });
  it('P37a : l’atténuation au survol de la légende couvre les quatre couches pannes ; les branches Internet et Cloud lisent OUT_LAYER_KEYS', () => {
    const legend = deck.slice(deck.indexOf('setLegendHover(categoryId'), deck.indexOf('const applyLegendDim'));
    expect(legend).toContain('...Object.values(OUT_LAYER_KEYS).flat(), OUT_MAINTENANCE_LAYER,');
    expect(legend).toContain("activeLayers = [...OUT_LAYER_KEYS.outagesInternet];");
    expect(legend).toContain("activeLayers = [...OUT_LAYER_KEYS.outagesCloud];");
  });
  it('le conteneur relaie updateOutagesInternet et updateOutagesCloud à la carte WebGL', () => {
    expect(container).toContain('updateOutagesInternet(r: InternetOutagesResponse | null, now: number): void');
    expect(container).toContain('updateOutagesCloud(r: CloudOutagesResponse | null, now: number): void');
    expect(container).toContain('this.deckMap?.updateOutagesInternet(r, now);');
    expect(container).toContain('this.deckMap?.updateOutagesCloud(r, now);');
  });
});
