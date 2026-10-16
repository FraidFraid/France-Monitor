// src/components/map-key/energy-key.test.ts
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { buildEnergyKeyHtml } from './energy-key.ts';
import { buildEnergyKeyModel, type EnergyEntry, type EnergyKeyInput, type EnergyKeyModel, type EnergyLayerKey } from '../deckgl/energy-map.ts';
import type { EnergySector, EnergyState } from '../../services/energy-state.ts';

const e = (id: string, state: EnergyState, sector: EnergySector): EnergyEntry => ({ id, name: id, state, sector, coordinates: [2, 47] });
const ENTRIES = new Map<EnergyLayerKey, EnergyEntry[]>([
  ['nuclearFleet', [e('n1', 'arret', 'nucleaire'), e('n2', 'arret', 'nucleaire'), e('n3', 'normal', 'nucleaire')]],
  ['gasNetwork', [e('g1', 'tension', 'gaz')]],
  ['hydroBackbone', [e('h1', 'nonSuivi', 'hydraulique')]],
  ['windMonitor', [e('w1', 'maintenance', 'eolien')]],
]);

const FLOWS = new Map<EnergyLayerKey, { exports: number; imports: number }>([
  ['powerGrid', { exports: 3, imports: 1 }], ['gasNetwork', { exports: 2, imports: 1 }], ['oilNetwork', { exports: 1, imports: 6 }],
]);

/** Modèle tel que la carte le construit, à partir des couches allumées. */
const model = (over: Partial<EnergyKeyInput> = {}): EnergyKeyModel => buildEnergyKeyModel({
  layers: { nuclearFleet: true, gasNetwork: true, powerGrid: true }, entries: ENTRIES, flows: FLOWS, fuelTension: [],
  hiddenStates: new Set<EnergyState>(), ...over,
});
const base = (over: Partial<EnergyKeyModel> = {}): EnergyKeyModel => ({ ...model(), ...over });

function dom(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

describe('légende de l’énergie', () => {
  it('rien quand aucune couche énergie n’est allumée', () => {
    expect(buildEnergyKeyHtml(base({ visible: false }))).toBe('');
  });
  it('une ligne par état présent, du plus grave au moins grave, avec son nombre ; un état à zéro n’a pas de ligne', () => {
    const el = dom(buildEnergyKeyHtml(base()));
    const rows = [...el.querySelectorAll('[data-key-action^="energy:"]')];
    expect(rows.map((r) => r.getAttribute('data-key-action'))).toEqual(['energy:arret', 'energy:tension', 'energy:normal']);
    expect(rows[0].textContent).toContain('À l’arrêt sans préavis');
    expect(rows[0].querySelector('.mk-n')?.textContent).toBe('2');
    expect(rows[2].querySelector('.mk-n')?.textContent).toBe('1');
  });
  it('un état masqué est barré et aria-pressed=false', () => {
    const el = dom(buildEnergyKeyHtml(base({ hiddenStates: new Set<EnergyState>(['normal']) })));
    const row = el.querySelector('[data-key-action="energy:normal"]');
    expect(row?.classList.contains('mk-row--off')).toBe(true);
    expect(row?.getAttribute('aria-pressed')).toBe('false');
  });
  it('quatre sections dans l’ordre, sans les anciennes', () => {
    const html = buildEnergyKeyHtml(model({ layers: { nuclearFleet: true, oilNetwork: true, powerGrid: true } }));
    const order = ['État des installations', 'Filières', 'Échanges avec l’étranger', 'Contexte'].map((t) => html.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(html).not.toContain('Pictogramme');
    expect(html).not.toContain('Réseaux et flux');
    expect(html).toContain('Les couleurs vives ne servent qu’aux états anormaux');
  });
  it('filières : une pastille colorée par filière présente', () => {
    const html = buildEnergyKeyHtml(model({ layers: { nuclearFleet: true } }));
    expect(html).toContain('#8b5cf6');
    expect(html).toContain('Nucléaire');
    expect(html).not.toContain('Hydraulique');
  });
  it('échanges : une ligne par filière et par sens présents, pétrole par route maritime, détroit', () => {
    const html = buildEnergyKeyHtml(model({ layers: { oilNetwork: true }, flows: new Map([['oilNetwork', { exports: 1, imports: 6 }]]) }));
    expect(html).toContain('Pétrole · import, route maritime, épaisseur = volume');
    expect(html).toContain('Pétrole · export');
    expect(html).toContain('Détroit, point de passage obligé');
    expect(html).toContain('#e3c58f');
    expect(html).not.toContain('Électricité · export');
  });
  it('contexte : fond des régions « ce n’est pas une vigilance », gazoduc rose, groupes', () => {
    const html = buildEnergyKeyHtml(model({ layers: { powerGrid: true, gasNetwork: true, windMonitor: true } }));
    expect(html).toContain('ce n’est pas une vigilance');
    expect(html).toContain('Gazoduc');
    expect(html).toContain('#e64bb4');
    expect(html).not.toContain('Oléoduc');
    expect(html).toContain('orange s’il contient une alerte');
  });
  it('jamais de tiret cadratin', () => {
    expect(buildEnergyKeyHtml(base({ fuelTension: { rouge: 1, orange: 0, jaune: 2 }, metro: true }))).not.toContain('—');
  });
});

describe('légende de la charge métropolitaine', () => {
  it('cercles emboîtés de référence, valeur et unité sur une ligne', () => {
    const html = buildEnergyKeyHtml(model({ layers: { metroLoad: true } }));
    expect(html).toContain('Consommation des métropoles');
    expect(html).toContain('3 000 MW');
    expect(html).toContain('200 MW');
  });
});
