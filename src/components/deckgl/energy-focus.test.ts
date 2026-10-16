// src/components/deckgl/energy-focus.test.ts
import { describe, expect, it } from 'vitest';
import { ENERGY_FOCUS_KEY, ENERGY_FOCUS_LAYERS, energyFocusKeyHtml, isEnergyLayerKey } from './energy-focus.ts';
import { ENERGY_LAYER_KEYS } from './energy-map.ts';
import { OUT_LAYER_KEYS } from './outages-map.ts';

describe('survol des pastilles Énergie', () => {
  it('chaque couche a ses calques et sa légende', () => {
    for (const k of ENERGY_LAYER_KEYS) {
      expect(ENERGY_FOCUS_LAYERS[k].length).toBeGreaterThan(0);
      expect(ENERGY_FOCUS_KEY[k].rows.length).toBeGreaterThan(0);
    }
    expect(ENERGY_FOCUS_LAYERS.nuclearFleet).toContain('energy-infra-circles-icon');
    expect(ENERGY_FOCUS_LAYERS.oilNetwork).toContain('energy-choke');
    expect(ENERGY_FOCUS_LAYERS.outagesElec).toEqual(OUT_LAYER_KEYS.outagesElec);
  });
  it('légende courte sans tiret cadratin ; clé inconnue refusée', () => {
    expect(energyFocusKeyHtml('oilNetwork')).toContain('Pétrole');
    expect(energyFocusKeyHtml('oilNetwork')).not.toContain('—');
    expect(isEnergyLayerKey('oilNetwork')).toBe(true);
    expect(isEnergyLayerKey('trafficRoad')).toBe(false);
  });
});
