// src/components/deckgl/energy-focus.test.ts
import { describe, expect, it } from 'vitest';
import { ENERGY_FOCUS_KEY, ENERGY_FOCUS_LAYERS, energyFocusKeyHtml, dimOpacity, fullOpacity, energyChipsPressed, energyFocusKeysHtml, energyFocusLayersOf, flowKindsShown, isEnergyLayerKey, toggleEnergyChip } from './energy-focus.ts';
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

describe('mise en avant persistante des pastilles allumées', () => {
  it('plusieurs pastilles : union de leurs calques, sans doublon (flèches partagées)', () => {
    const l = energyFocusLayersOf(['powerGrid', 'oilNetwork']);
    expect(l).toContain('power-region-fill');
    expect(l).toContain('oil-refineries');
    expect(l.filter((id) => id === 'energy-flow-lines')).toHaveLength(1);
    expect(energyFocusLayersOf([])).toEqual([]);
  });
  it('légendes cumulées dans l’ordre des pastilles ; aucune pastille : rien', () => {
    const html = energyFocusKeysHtml(['nuclearFleet', 'oilNetwork']);
    expect(html.indexOf('Parc nucléaire')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('Parc nucléaire')).toBeLessThan(html.indexOf('Pétrole'));
    expect(energyFocusKeysHtml([])).toBe('');
  });
});

describe('flèches des pastilles allumées', () => {
  const on = { powerGrid: true, gasNetwork: true, oilNetwork: true };
  it('sans pastille allumée : toutes les filières des couches allumées', () => {
    expect(flowKindsShown(on, [])).toEqual(['elec', 'gaz', 'petrole']);
    expect(flowKindsShown({ gasNetwork: true }, [])).toEqual(['gaz']);
  });
  it('« Réseau électrique » allumé : seulement l’électricité ; cumul avec « Pétrole »', () => {
    expect(flowKindsShown(on, ['powerGrid'])).toEqual(['elec']);
    expect(flowKindsShown(on, ['powerGrid', 'oilNetwork'])).toEqual(['elec', 'petrole']);
    expect(flowKindsShown(on, ['nuclearFleet'])).toEqual([]);
  });
});

describe('atténuation d’une opacité', () => {
  it('nombre et expression simple : multipliés ; interpolation sur le zoom : chaque palier multiplié (règle MapLibre)', () => {
    expect(dimOpacity(0.8, 0.15)).toBeCloseTo(0.12);
    expect(dimOpacity(['get', 'o'], 0.15)).toEqual(['*', ['get', 'o'], 0.15]);
    expect(dimOpacity(['interpolate', ['linear'], ['zoom'], 7, 0.42, 11, 0.72], 0.15))
      .toEqual(['interpolate', ['linear'], ['zoom'], 7, ['*', 0.42, 0.15], 11, ['*', 0.72, 0.15]]);
    expect(dimOpacity(['step', ['zoom'], 0, 8, 1], 0.5)).toEqual(['step', ['zoom'], ['*', 0, 0.5], 8, ['*', 1, 0.5]]);
  });
});

describe('couche mise en avant à 100 %', () => {
  it('nombre : 1 (0 reste 0) ; expression : sa plus forte opacité ramenée à 1, écarts internes gardés', () => {
    expect(fullOpacity(0.45)).toBe(1);
    expect(fullOpacity(0)).toBe(0);
    const curve = fullOpacity(['interpolate', ['linear'], ['zoom'], 7, 0.4, 11, 0.8]);
    expect(curve).toEqual(['interpolate', ['linear'], ['zoom'], 7, ['*', 0.4, 1.25], 11, ['*', 0.8, 1.25]]);
    const alert = ['case', ['get', 'hasAlert'], 0.5, 0.1];
    expect(fullOpacity(alert)).toEqual(['*', alert, 2]);
    expect(fullOpacity(['case', ['get', 'h'], 1, 0.9])).toEqual(['case', ['get', 'h'], 1, 0.9]);
  });
});

describe('pastilles Énergie cumulables', () => {
  it('une pastille est verte si elle est retenue ou si son panneau est ouvert ; ordre des pastilles gardé', () => {
    const ids = ['powerGrid', 'nuclearFleet', 'oilNetwork', 'military'];
    expect(energyChipsPressed(ids, new Set(['oilNetwork', 'powerGrid']), () => false)).toEqual(['powerGrid', 'oilNetwork']);
    expect(energyChipsPressed(ids, new Set(), (id) => id === 'nuclearFleet')).toEqual(['nuclearFleet']);
    expect(energyChipsPressed(['military'], new Set(), () => true)).toEqual([]);
  });
  it('clic : une pastille éteinte s’allume (son panneau s’ouvre), une pastille verte s’éteint', () => {
    expect(toggleEnergyChip(new Set(['powerGrid']), 'oilNetwork', false)).toEqual({ selected: new Set(['powerGrid', 'oilNetwork']), open: true });
    expect(toggleEnergyChip(new Set(['powerGrid', 'oilNetwork']), 'powerGrid', true)).toEqual({ selected: new Set(['oilNetwork']), open: false });
    expect(toggleEnergyChip(new Set(), 'nuclearFleet', true)).toEqual({ selected: new Set(), open: false });
  });
});
