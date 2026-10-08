// tests/sovereignty-map-b-wiring.test.ts : câblage de la carte de la phase B (contrats § 5, § 7). DeckGLMap.ts et MapContainer.ts ne
// s'instancient pas sous vitest : ces tests lisent leur source, comme tests/sovereignty-map-wiring.test.ts. Sources et couches B à la
// place des rectangles « ZIT », sous les couches Souveraineté de la phase A ; mailles avec la couche Défense, option des zones drones ;
// méthodes neuves ; retrait complet des zones codées en dur (remplaçant nommé : zones drones DGAC).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');
const deck = read('src/components/DeckGLMap.ts');
const container = read('src/components/MapContainer.ts');

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|js|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

describe('carte de la phase B', () => {
  it('sources et couches B à la place des rectangles, sous les couches de la phase A', () => {
    const addSources = 'for (const id of SOV_B_SOURCE_IDS) this.map.addSource(id, sovBSourceSpec());';
    const addLayers = 'for (const layer of SOV_B_LAYERS) this.map.addLayer(layer);';
    expect(deck).toContain(addSources);
    expect(deck).toContain(addLayers);
    expect(deck.indexOf(addLayers)).toBeLessThan(deck.indexOf('for (const layer of SOV_LAYERS) this.map.addLayer(layer);'));
  });
  it('mailles avec la couche Défense (SOV_LAYER_KEYS), zones drones en option ; méthodes de la carte et du conteneur', () => {
    expect(deck).toContain('for (const id of SOV_LAYER_KEYS.military) this.setVis(id, vis(layers.military));');
    expect(deck).toContain('for (const id of SOV_OPTION_LAYERS.droneZones) this.setVis(id, vis(layers.military && this.droneZonesVisible));');
    expect(deck).toContain('private droneZonesVisible = false;');
    for (const m of ['updateGnssLayer(g: GnssResponse | null, now: number): void {', 'updateDroneZones(file: DroneZonesFile | null): void {', 'setDroneZonesVisible(on: boolean): void {']) {
      expect(deck).toContain(m);
      expect(container).toContain(m);
    }
  });
  it('zones « ZIT » codées en dur retirées partout (remplaçant : zones drones DGAC)', () => {
    const offenders = [...sources(path.join(ROOT, 'src')), ...sources(path.join(ROOT, 'api')), ...sources(path.join(ROOT, 'server'))]
      .filter((f) => /RESTRICTED_ZONE|RestrictedZone|updateMilitaryZones|MILITARY_ZONES|military-zones|(?<![A-Z_])MILITARY_BASES\b/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
