// src/components/deckgl/energy-map.test.ts
import { describe, expect, it } from 'vitest';
import type maplibregl from 'maplibre-gl';
import {
  buildEnergyKeyModel, energyEntriesFrom, energyStateFilter, gasStorageStyle, hydroStyle, shapeIconSvg,
  type EnergyEntry, type EnergyLayerKey,
} from './energy-map.ts';
import type { EnergyState } from '../../services/energy-state.ts';
import {
  companionFilters, discColorExpr, discCompanionLayers, metroLabelOffsetExpr, metroRadiusExpr, metroRadiusPx, ENERGY_ALERT_FILTER, ENERGY_DISC_RADIUS, discIconSize, glyphColorExpr, infraGlyphImageExpr, infraSectorHexExpr,
  nuclearDiscColorExpr, nuclearOpacityExpr, nuclearRingColorExpr, nuclearRingWidthExpr,
} from './energy-map.ts';
import { expression } from '@maplibre/maplibre-gl-style-spec';

/** Évalue une expression MapLibre sur un objet de propriétés, comme le ferait la carte. */
function evalExpr(expr: unknown, properties: Record<string, unknown>): unknown {
  const parsed = expression.createExpression(expr);
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value));
  return parsed.value.evaluate({ zoom: 6 }, { type: 'Point', properties, geometry: [] } as never);
}

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
  it('ne compte que les couches allumées ; filières présentes dans l’ordre de la légende', () => {
    const m = buildEnergyKeyModel({
      layers: { nuclearFleet: true, gasNetwork: true, windMonitor: false },
      entries, flows: new Map(), fuelTension: [], hiddenStates: new Set(),
    });
    expect(m.visible).toBe(true);
    expect(m.counts).toEqual({ arret: 1, tension: 1, reduit: 0, maintenance: 0, normal: 2, nonSuivi: 1 });
    expect(m.sectors).toEqual(['nucleaire', 'gaz']);
    expect(m.clusters).toBe(false);
    expect(m.inventory).toEqual({ biomethane: true, depots: false });
  });
  it('aucune couche énergie allumée : rien à montrer', () => {
    const m = buildEnergyKeyModel({ layers: {}, entries, flows: new Map(), fuelTension: [], hiddenStates: new Set() });
    expect(m.visible).toBe(false);
  });
  it('flux par filière des couches allumées, détroits si le pétrole est importé, tension carburants', () => {
    const m = buildEnergyKeyModel({
      layers: { powerGrid: true, oilNetwork: true, gasNetwork: false },
      entries: new Map(),
      flows: new Map<EnergyLayerKey, { exports: number; imports: number }>([
        ['powerGrid', { exports: 4, imports: 2 }], ['gasNetwork', { exports: 9, imports: 9 }], ['oilNetwork', { exports: 0, imports: 3 }],
      ]),
      fuelTension: ['rouge', 'orange', 'orange', 'vert'],
      hiddenStates: new Set(),
    });
    expect(m.flowKinds).toEqual([{ kind: 'elec', exports: 4, imports: 2 }, { kind: 'petrole', exports: 0, imports: 3 }]);
    expect(m.chokes).toBe(true);
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

describe('disques des installations', () => {
  it('l’état anormal prime sur la teinte de la filière', () => {
    const e = discColorExpr('#e64bb4');
    expect(evalExpr(e, { energyState: 'arret' })).toBe('#ff3b30');
    expect(evalExpr(e, { energyState: 'tension' })).toBe('#ff9500');
    expect(evalExpr(e, { energyState: 'reduit' })).toBe('#ffcc00');
    expect(evalExpr(e, { energyState: 'maintenance' })).toBe('#5c5f6b');
    expect(evalExpr(e, { energyState: 'normal' })).toBe('#e64bb4');
    expect(evalExpr(e, {})).toBe('#e64bb4');
  });
  it('picto foncé sur fond jaune, gris clair en maintenance, blanc sinon', () => {
    const light = glyphColorExpr(false);
    expect(evalExpr(light, { energyState: 'reduit' })).toBe('#1a1a1a');
    expect(evalExpr(light, { energyState: 'maintenance' })).toBe('#d0d3da');
    expect(evalExpr(light, { energyState: 'normal' })).toBe('#ffffff');
    expect(evalExpr(glyphColorExpr(true), { energyState: 'nonSuivi' })).toBe('#14161c');
  });
  it('nucléaire : violet gardé, anneau jaune si réduit, gris et atténué en maintenance', () => {
    expect(evalExpr(nuclearDiscColorExpr(), { energyState: 'reduit' })).toBe('#8b5cf6');
    expect(evalExpr(nuclearDiscColorExpr(), { energyState: 'arret' })).toBe('#ff3b30');
    expect(evalExpr(nuclearRingColorExpr(), { energyState: 'reduit' })).toBe('#ffcc00');
    expect(evalExpr(nuclearRingColorExpr(), { energyState: 'maintenance' })).toBe('#c9ccd6');
    expect(evalExpr(nuclearRingWidthExpr(), { energyState: 'reduit' })).toBe(3.5);
    expect(evalExpr(nuclearRingWidthExpr(), { energyState: 'normal' })).toBe(1.5);
    expect(evalExpr(nuclearOpacityExpr(), { energyState: 'maintenance' })).toBe(0.55);
    expect(evalExpr(nuclearOpacityExpr(), { energyState: 'normal' })).toBe(1);
  });
  it('infrastructures : teinte et picto selon le type', () => {
    expect(evalExpr(infraSectorHexExpr(), { type: 'nuclear' })).toBe('#8b5cf6');
    expect(evalExpr(infraSectorHexExpr(), { type: 'gas-storage' })).toBe('#e64bb4');
    expect(evalExpr(infraSectorHexExpr(), { type: 'refinery' })).toBe('#8fa3bf');
    expect(evalExpr(infraSectorHexExpr(), { type: 'hydro' })).toBe('#2f80ff');
    expect(evalExpr(infraSectorHexExpr(), { type: 'thermal' })).toBe('#eef2f7');
    expect(evalExpr(infraGlyphImageExpr(), { type: 'nuclear' })).toBe('energy-icon-atom');
    expect(evalExpr(infraGlyphImageExpr(), { type: 'thermal' })).toBe('energy-icon-zap');
  });
  it('halo seulement pour l’arrêt et la tension ; tailles', () => {
    expect(evalExpr(ENERGY_ALERT_FILTER, { energyState: 'arret' })).toBe(true);
    expect(evalExpr(ENERGY_ALERT_FILTER, { energyState: 'reduit' })).toBe(false);
    expect(ENERGY_DISC_RADIUS).toEqual({ nuclear: 11, gas: 9, refinery: 9, windPark: 9, powerUnit: 8, hydro: 7, other: 8 });
    expect(discIconSize(19)).toBe(1);
  });
});

describe('calques compagnons d’un disque', () => {
  it('halo sous le disque, limité à l’arrêt et à la tension ; picto au-dessus, même filtre que le disque', () => {
    const base: maplibregl.FilterSpecification = ['==', ['get', 'kind'], 'imprevue'];
    const [halo, icon] = discCompanionLayers({ id: 'd', source: 's', filter: base, radius: 8, color: discColorExpr('#eef2f7'), icon: 'energy-icon-zap', iconColor: glyphColorExpr(true) });
    expect(halo.id).toBe('d-halo');
    expect(halo.type).toBe('circle');
    expect((halo as { filter?: unknown }).filter).toEqual(['all', base, ENERGY_ALERT_FILTER]);
    expect(JSON.stringify(halo.paint)).toContain('15');
    expect(icon.id).toBe('d-icon');
    expect((icon as { filter?: unknown }).filter).toEqual(base);
    expect((icon.layout as Record<string, unknown>)['icon-size']).toBeCloseTo(8 / 19);
    expect(companionFilters(null)).toEqual({ halo: ENERGY_ALERT_FILTER, icon: null });
  });
  it('rayon variable : halo et picto suivent l’expression', () => {
    const [halo, icon] = discCompanionLayers({ id: 'd', source: 's', filter: null, radius: ['match', ['get', 'type'], 'nuclear', 11, 8], color: '#fff', icon: 'x', iconColor: '#fff' });
    expect(evalExpr((halo.paint as Record<string, unknown>)['circle-radius'], { type: 'nuclear' })).toBe(18);
    expect(evalExpr((icon.layout as Record<string, unknown>)['icon-size'], { type: 'x' })).toBeCloseTo(8 / 19);
    expect((icon as { filter?: unknown }).filter).toBeUndefined();
  });
});

describe('charge métropolitaine : cercles proportionnels', () => {
  it('surface proportionnelle à la consommation, rayon minimal lisible', () => {
    expect(metroRadiusPx(3000)).toBeCloseTo(0.47 * Math.sqrt(3000));
    expect(metroRadiusPx(3000) / metroRadiusPx(750)).toBeCloseTo(2);
    expect(metroRadiusPx(10)).toBe(4);
    expect(evalExpr(metroRadiusExpr(), { loadMw: 3000 })).toBeCloseTo(metroRadiusPx(3000));
  });
  it('étiquette juste sous le bord du cercle (décalage en em, police de 11 px au zoom 6)', () => {
    expect(evalExpr(metroLabelOffsetExpr(), { loadMw: 3000 })).toBeCloseTo(0.3 + metroRadiusPx(3000) / 11);
  });
});
