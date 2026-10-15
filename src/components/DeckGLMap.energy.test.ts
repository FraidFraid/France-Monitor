// src/components/DeckGLMap.energy.test.ts
// @vitest-environment happy-dom
// Registre de l'énergie (spec 2026-10-15) : légende comptée sur les couches allumées, pictos d'alerte, masquage par état.
import type maplibregl from 'maplibre-gl';
import { describe, expect, it } from 'vitest';

import { DeckGLMap } from './DeckGLMap.ts';
import type { MapLayers } from '../types/index.ts';
import type { EnergyEntry, EnergyKeyModel } from './deckgl/energy-map.ts';
import {
  LYR_BIOMETHANE_CLUSTERS, LYR_BIOMETHANE_SITES, LYR_ENERGY_INFRA_CIRCLE, LYR_ENERGY_INFRA_NUCLEAR_RING, LYR_GAS_STORAGES, LYR_OIL_DEPOTS_HIT,
  LYR_WIND_CLUSTER, LYR_WIND_CLUSTER_COUNT, SRC_ENERGY_ALERTS,
} from './deckgl/constants.ts';

class FakeMap {
  data = new Map<string, GeoJSON.FeatureCollection>();
  filters = new Map<string, unknown>();
  getSource(id: string): unknown { return { setData: (d: GeoJSON.FeatureCollection) => this.data.set(id, d) }; }
  getLayer(): object { return {}; }
  setFilter(id: string, f: unknown): void { this.filters.set(id, f); }
  setLayoutProperty(): void { /* rien */ }
  getZoom(): number { return 6; }
  getBounds(): { contains: () => boolean } { return { contains: () => true }; }
  project(): { x: number; y: number } { return { x: 0, y: 0 }; }
  triggerRepaint(): void { /* rien */ }
}

const e = (id: string, state: EnergyEntry['state']): EnergyEntry => ({ id, name: id, state, sector: 'nucleaire', coordinates: [2, 47] });

function setup(): { deck: DeckGLMap; map: FakeMap; models: EnergyKeyModel[] } {
  const deck = new DeckGLMap({} as HTMLElement);
  const map = new FakeMap();
  Reflect.set(deck, 'map', map as unknown as maplibregl.Map);
  const models: EnergyKeyModel[] = [];
  deck.setOnEnergyKeyChange((m) => models.push(m));
  return { deck, map, models };
}

function record(deck: DeckGLMap, key: string, entries: EnergyEntry[]): void {
  const fn: unknown = Reflect.get(deck, 'recordEnergy');
  if (typeof fn !== 'function') throw new Error('recordEnergy absent');
  fn.call(deck, key, entries);
}

describe('registre de l’énergie', () => {
  it('compte seulement les couches allumées et dessine les pictos de leurs alertes', () => {
    const { deck, map, models } = setup();
    deck.setLayerVisibility({ nuclearFleet: true } as MapLayers);
    record(deck, 'nuclearFleet', [e('a', 'arret'), e('b', 'normal')]);
    record(deck, 'gasNetwork', [e('c', 'tension')]);
    expect(models.at(-1)?.counts.arret).toBe(1);
    expect(models.at(-1)?.counts.tension).toBe(0);
    expect(map.data.get(SRC_ENERGY_ALERTS)?.features.map((f) => f.properties?.id)).toEqual(['a']);
  });

  it('couche éteinte : plus de picto ni de compte', () => {
    const { deck, map, models } = setup();
    deck.setLayerVisibility({ nuclearFleet: true } as MapLayers);
    record(deck, 'nuclearFleet', [e('a', 'arret')]);
    deck.setLayerVisibility({ nuclearFleet: false } as MapLayers);
    expect(map.data.get(SRC_ENERGY_ALERTS)?.features).toHaveLength(0);
    expect(models.at(-1)?.visible).toBe(false);
  });

  it('état masqué : filtre posé sur les calques, gardé quand la couche nucléaire impose son filtre', () => {
    const { deck, map } = setup();
    deck.setHiddenEnergyStates(new Set(['normal']));
    const hide = ['!', ['in', ['coalesce', ['get', 'energyState'], 'nonSuivi'], ['literal', ['normal']]]];
    expect(map.filters.get(LYR_GAS_STORAGES)).toEqual(['all', ['==', ['get', 'type'], 'storage'], hide]);
    deck.setLayerVisibility({ nuclearFleet: true } as MapLayers);
    expect(map.filters.get(LYR_ENERGY_INFRA_CIRCLE)).toEqual(['all', ['==', ['get', 'type'], 'nuclear'], hide]);
  });

  it('les calques compagnons (anneau nucléaire, zones de survol) suivent le masquage', () => {
    const { deck, map } = setup();
    deck.setLayerVisibility({ nuclearFleet: true } as MapLayers);
    deck.setHiddenEnergyStates(new Set(['normal']));
    const hide = ['!', ['in', ['coalesce', ['get', 'energyState'], 'nonSuivi'], ['literal', ['normal']]]];
    expect(map.filters.get(LYR_ENERGY_INFRA_NUCLEAR_RING)).toEqual(['all', ['==', ['get', 'type'], 'nuclear'], hide]);
    expect(map.filters.get(LYR_OIL_DEPOTS_HIT)).toEqual(hide);
  });

  it('groupes (éoliennes, biométhane) cachés seulement quand tous leurs états possibles sont masqués', () => {
    const { deck, map } = setup();
    deck.setHiddenEnergyStates(new Set(['nonSuivi']));
    expect(map.filters.get(LYR_WIND_CLUSTER)).toEqual(['has', 'point_count']);
    expect(map.filters.get(LYR_BIOMETHANE_CLUSTERS)).toEqual(['all', ['has', 'point_count'], false]);
    deck.setHiddenEnergyStates(new Set(['nonSuivi', 'maintenance']));
    expect(map.filters.get(LYR_WIND_CLUSTER)).toEqual(['all', ['has', 'point_count'], false]);
    expect(map.filters.get(LYR_WIND_CLUSTER_COUNT)).toEqual(['all', ['has', 'point_count'], false]);
    deck.setHiddenEnergyStates(new Set());
    expect(map.filters.get(LYR_WIND_CLUSTER)).toEqual(['has', 'point_count']);
    expect(map.filters.get(LYR_BIOMETHANE_SITES)).toEqual(['!', ['has', 'point_count']]);
  });

  it('les sites de biométhane comptent avec la couche Gaz, sans effacer les stockages', () => {
    const { deck, models } = setup();
    deck.setLayerVisibility({ gasNetwork: true } as MapLayers);
    record(deck, 'gasNetwork', [e('s1', 'normal')]);
    deck.updateBiomethaneSites([
      { id: 'b1', name: 'B1', latitude: 47, longitude: 2, status: 'active', sourceName: 'test' },
    ]);
    expect(models.at(-1)?.counts.normal).toBe(1);
    expect(models.at(-1)?.counts.nonSuivi).toBe(1);
  });
});
