// src/components/deckgl/energy-map.test.ts
import { describe, expect, it } from 'vitest';
import type maplibregl from 'maplibre-gl';
import {
  buildEnergyKeyModel, energyAlertFeatures, energyEntriesFrom, energyIconImage, energyStateFilter, gasStorageStyle, hydroStyle, shapeIconSvg,
  type EnergyEntry, type EnergyLayerKey,
} from './energy-map.ts';
import type { EnergyState } from '../../services/energy-state.ts';

const e = (id: string, state: EnergyState, sector: EnergyEntry['sector'] = 'nucleaire'): EnergyEntry =>
  ({ id, name: id, state, sector, coordinates: [2, 47] });

describe('entrées de l’énergie', () => {
  it('lit l’état posé sur chaque objet ; un objet sans état est sans état suivi', () => {
    const feats = [
      { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [1, 45] }, properties: { id: 'a', name: 'A', energyState: 'arret' } },
      { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [2, 46] }, properties: { name: 'B' } },
    ];
    expect(energyEntriesFrom(feats, 'gaz', 'gas')).toEqual([
      { id: 'a', name: 'A', state: 'arret', sector: 'gaz', coordinates: [1, 45] },
      { id: 'gas-1', name: 'B', state: 'nonSuivi', sector: 'gaz', coordinates: [2, 46] },
    ]);
  });
});

describe('pictos d’alerte', () => {
  it('seuls l’arrêt et la tension, le plus grave en dernier, picto de la filière, couleur de l’état', () => {
    const at = (x: EnergyEntry, lon: number): EnergyEntry => ({ ...x, coordinates: [lon, 47] });
    const fc = energyAlertFeatures([at(e('1', 'arret'), 1), at(e('2', 'normal'), 2), at(e('3', 'tension', 'gaz'), 3), at(e('4', 'reduit'), 4)]);
    expect(fc.features.map((f) => f.properties?.id)).toEqual(['3', '1']);
    expect(fc.features[0].properties).toMatchObject({ energyState: 'tension', color: '#ff9500', icon: energyIconImage('flame') });
    expect(fc.features[1].properties).toMatchObject({ energyState: 'arret', color: '#ff3b30', icon: energyIconImage('atom') });
  });
});

describe('pictos d’alerte au même endroit', () => {
  it('un seul picto par emplacement : le plus grave, à égalité le premier inscrit (réacteur avant unité EDF)', () => {
    const fc = energyAlertFeatures([e('nuc', 'arret'), e('edf', 'arret', 'electricite'), e('gaz', 'tension', 'gaz')]);
    expect(fc.features.map((f) => f.properties?.id)).toEqual(['nuc']);
  });
});

describe('masquage par état', () => {
  it('aucun état masqué : le filtre de base est gardé tel quel', () => {
    const base: maplibregl.FilterSpecification = ['==', ['get', 'type'], 'storage'];
    expect(energyStateFilter(base, new Set())).toEqual(base);
    expect(energyStateFilter(null, new Set())).toBeNull();
  });
  it('états masqués : combinés au filtre de base, sans état = sans état suivi', () => {
    expect(energyStateFilter(['==', ['get', 'type'], 'storage'], new Set<EnergyState>(['normal', 'reduit']))).toEqual([
      'all', ['==', ['get', 'type'], 'storage'],
      ['!', ['in', ['coalesce', ['get', 'energyState'], 'nonSuivi'], ['literal', ['reduit', 'normal']]]],
    ]);
    expect(energyStateFilter(null, new Set<EnergyState>(['arret']))).toEqual(
      ['!', ['in', ['coalesce', ['get', 'energyState'], 'nonSuivi'], ['literal', ['arret']]]],
    );
  });
});

describe('formes', () => {
  it('carré et losange blancs, sans débordement', () => {
    expect(shapeIconSvg('square', 64)).toContain('<rect');
    expect(shapeIconSvg('diamond', 64)).toContain('<polygon');
    expect(shapeIconSvg('square', 64)).toContain('fill="white"');
  });
});

describe('modèle de légende', () => {
  const entries = new Map<EnergyLayerKey, EnergyEntry[]>([
    ['nuclearFleet', [e('n1', 'arret'), e('n2', 'normal'), e('n3', 'normal')]],
    ['gasNetwork', [e('g1', 'tension', 'gaz'), e('g2', 'nonSuivi', 'gaz')]],
    ['windMonitor', [e('w1', 'nonSuivi', 'eolien')]],
  ]);
  it('ne compte que les couches allumées, pire état par filière en alerte', () => {
    const m = buildEnergyKeyModel({
      layers: { nuclearFleet: true, gasNetwork: true, windMonitor: false },
      entries, flows: new Map(), fuelTension: [], hiddenStates: new Set(),
    });
    expect(m.visible).toBe(true);
    expect(m.counts).toEqual({ arret: 1, tension: 1, reduit: 0, maintenance: 0, normal: 2, nonSuivi: 1 });
    expect(m.alertSectors).toEqual([['nucleaire', 'arret'], ['gaz', 'tension']]);
    expect(m.shapes).toEqual({ reactor: true, refinery: false, storage: true, hydro: false });
    expect(m.windClusters).toBe(false);
  });
  it('aucune couche énergie allumée : rien à montrer', () => {
    const m = buildEnergyKeyModel({ layers: {}, entries, flows: new Map(), fuelTension: [], hiddenStates: new Set() });
    expect(m.visible).toBe(false);
  });
  it('flux et tension carburants additionnés sur les couches allumées', () => {
    const m = buildEnergyKeyModel({
      layers: { powerGrid: true, oilNetwork: true, gasNetwork: false },
      entries: new Map(),
      flows: new Map<EnergyLayerKey, { exports: number; imports: number }>([
        ['powerGrid', { exports: 4, imports: 2 }], ['gasNetwork', { exports: 9, imports: 9 }], ['oilNetwork', { exports: 0, imports: 3 }],
      ]),
      fuelTension: ['rouge', 'orange', 'orange', 'vert'],
      hiddenStates: new Set(),
    });
    expect(m.flows).toEqual({ exports: 4, imports: 5 });
    expect(m.fuelTension).toEqual({ rouge: 1, orange: 2, jaune: 0 });
    expect(m.regions).toBe(true);
    expect(m.networks).toEqual({ gas: false, oil: true, drom: false });
  });
});

describe('stockages de gaz', () => {
  it('couleur de l’état du remplissage', () => {
    expect(gasStorageStyle(25)).toEqual({ energyState: 'tension', color: '#ff9500' });
    expect(gasStorageStyle(40)).toEqual({ energyState: 'reduit', color: '#ffcc00' });
    expect(gasStorageStyle(88)).toEqual({ energyState: 'normal', color: '#34c759' });
    expect(gasStorageStyle(null)).toEqual({ energyState: 'nonSuivi', color: '#c7c7cc' });
  });
});

describe('hydraulique', () => {
  it('stress orange, haut jaune, normal et bas vert', () => {
    expect(hydroStyle('stress')).toEqual({ energyState: 'tension', color: '#ff9500' });
    expect(hydroStyle('high')).toEqual({ energyState: 'reduit', color: '#ffcc00' });
    expect(hydroStyle('low')).toEqual({ energyState: 'normal', color: '#34c759' });
  });
  it('sans mesure fraîche, aucun état : ni vert ni alerte (donnée en retard = sans état suivi)', () => {
    expect(hydroStyle('normal', false)).toEqual({ energyState: 'nonSuivi', color: '#c7c7cc' });
    expect(hydroStyle('stress', false)).toEqual({ energyState: 'nonSuivi', color: '#c7c7cc' });
  });
});
