import { describe, it, expect } from 'vitest';
import { DEPARTMENTS, computeInfraFromEcowatt, computeInfraFromOutages } from './stability-index.ts';
import { parisDate } from './ecowatt-official.ts';
import type { EcowattResponse, EcowattSignal } from '../types/index.ts';

const NOW = Date.parse('2026-09-25T08:00:00Z');

function ecowatt(level: EcowattSignal | null): EcowattResponse {
  const mix = { timestamp: new Date(0), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 };
  const official: EcowattResponse['official'] = level ? {
    source: 'rte',
    generatedAt: new Date(NOW).toISOString(),
    days: [{ date: parisDate(NOW), level, message: 'Test', hours: Array.from({ length: 24 }, () => 1) }],
  } : null;
  return { official, mixes: {}, national: mix, interconnections: [], grid: null };
}

describe('computeInfraFromEcowatt — signal national, même niveau pour tous les départements', () => {
  it('rouge → 30, orange → 15, vert/inconnu → 0, quel que soit le département', () => {
    expect(computeInfraFromEcowatt(ecowatt('red'), NOW)).toBe(30);
    expect(computeInfraFromEcowatt(ecowatt('orange'), NOW)).toBe(15);
    expect(computeInfraFromEcowatt(ecowatt('green'), NOW)).toBe(0);
    expect(computeInfraFromEcowatt(ecowatt(null), NOW)).toBe(0);
    expect(computeInfraFromEcowatt(null, NOW)).toBe(0);
  });
});

describe('DEPARTMENTS : noms officiels accentués, Corse, recherche par nom insensible aux accents', () => {
  it('noms accentués (Hérault, Ariège, Ardèche, Réunion…), Corse-du-Sud (2A) et Haute-Corse (2B) en Corse (94)', () => {
    expect(DEPARTMENTS['34'].name).toBe('Hérault');
    expect(DEPARTMENTS['09'].name).toBe('Ariège');
    expect(DEPARTMENTS['07'].name).toBe('Ardèche');
    expect(DEPARTMENTS['13'].name).toBe('Bouches-du-Rhône');
    expect(DEPARTMENTS['21'].name).toBe('Côte-d\'Or');
    expect(DEPARTMENTS['63'].name).toBe('Puy-de-Dôme');
    expect(DEPARTMENTS['974'].name).toBe('La Réunion');
    expect(DEPARTMENTS['2A']).toEqual({ name: 'Corse-du-Sud', regionCode: '94' });
    expect(DEPARTMENTS['2B']).toEqual({ name: 'Haute-Corse', regionCode: '94' });
    expect(Object.keys(DEPARTMENTS)).toHaveLength(101);
  });
  it('panne ARCEP sans coordonnées : le nom du département (avec ou sans accents, tirets ou apostrophes) retrouve son code', () => {
    const site = (department: string, i: number) => ({
      id: `t-${i}`, operator: 'Orange', department, city: 'X', voiceStatus: 'HS' as const, dataStatus: 'HS' as const, reason: 'Incident', since: null,
      coordinates: [0, 0] as [number, number],
    });
    for (const [code, names] of [['34', ['Herault', 'Hérault', 'HÉRAULT']], ['21', ['Cote d Or', 'Côte-d\'Or']], ['2A', ['Corse du Sud', 'Corse-du-Sud']]] as const) {
      for (const name of names) {
        const telecom = Array.from({ length: 5 }, (_, i) => site(name, i));
        expect(computeInfraFromOutages(code, telecom, []), `${code} ${name}`).toEqual({ score: 65, label: 'Panne Réseau', source: 'ARCEP' });
      }
    }
    expect(computeInfraFromOutages('34', Array.from({ length: 5 }, (_, i) => site('Inconnu', i)), [])).toBeNull();
  });
});
