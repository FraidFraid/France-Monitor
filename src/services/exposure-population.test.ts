// src/services/exposure-population.test.ts : habitants des communes touchées par un phénomène de l'onglet Environnement.
import { describe, expect, it } from 'vitest';
import type { Hazard } from './environment-exposure.ts';
import { hazardPopulation, parseCommunes, populationText, type Commune } from './exposure-population.ts';

const c = (code: string, name: string, dept: string, pop: number | null, lon: number, lat: number): Commune => ({ code, name, dept, pop, lon, lat });
const communes: Commune[] = [
  c('30189', 'Nîmes', '30', 148_000, 4.36, 43.84), c('30007', 'Alès', '30', 42_000, 4.08, 44.13),
  c('30321', 'Sommières', '30', 5_000, 4.09, 43.785), c('13055', 'Marseille', '13', 870_000, 5.37, 43.3),
];
const hazard = (over: Partial<Hazard>): Hazard => ({
  id: 'h', kind: 'crue', label: 'Crue orange · Vidourle', level: 'orange', depts: [], circles: [], lines: [], bufferKm: 2, rings: [],
  kinds: [], since: null, ...over,
});
const fr = (n: number): string => n.toLocaleString('fr-FR').replace(/\s/g, ' ');

describe('population exposée', () => {
  it('vigilance départementale : toutes les communes du département, les plus peuplées d’abord', () => {
    const p = hazardPopulation(hazard({ kind: 'vigilance', depts: ['30'] }), communes);
    expect(p.communes.map((x) => x.name)).toEqual(['Nîmes', 'Alès', 'Sommières']);
    expect(p.total).toBe(195_000);
    expect(p.method).toBe('departement');
  });
  it('crue sans zone cartographiée : communes à moins de 3 km du tronçon', () => {
    const p = hazardPopulation(hazard({ lines: [[[4.08, 43.77], [4.10, 43.80]]] }), communes);
    expect(p.communes.map((x) => x.name)).toEqual(['Sommières']);
    expect(p.method).toBe('troncon');
  });
  it('crue avec zone inondable cartographiée : communes à moins de 1,5 km de la zone', () => {
    const zone: Array<[number, number]> = [[4.085, 43.78], [4.095, 43.78], [4.095, 43.79], [4.085, 43.79], [4.085, 43.78]];
    const p = hazardPopulation(hazard({ lines: [[[4.0, 43.7], [4.2, 43.9]]] }), communes, [zone]);
    expect(p.communes.map((x) => x.name)).toEqual(['Sommières']);
    expect(p.method).toBe('zone-inondable');
  });
  it('feu ou séisme : centre dans le rayon', () => {
    const p = hazardPopulation(hazard({ kind: 'feu', circles: [{ lon: 4.36, lat: 43.84, radiusKm: 5 }] }), communes);
    expect(p.communes.map((x) => x.name)).toEqual(['Nîmes']);
  });
  it('texte : communes et habitants, jamais des sinistrés ; aucune commune dit', () => {
    const p = hazardPopulation(hazard({ kind: 'vigilance', depts: ['30'] }), communes);
    expect(populationText(p, fr)).toBe('3 communes, 195 000 habitants (Nîmes, Alès…)');
    expect(populationText(hazardPopulation(hazard({}), communes), fr)).toBe('aucune commune touchée');
  });
  it('fichier compact lu ; ligne illisible écartée', () => {
    expect(parseCommunes({ communes: [['30189', 'Nîmes', '30', 148000, 4.36, 43.84], ['x']] })).toHaveLength(1);
    expect(() => parseCommunes([])).toThrow();
  });
});
