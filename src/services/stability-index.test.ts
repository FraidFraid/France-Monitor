import { describe, it, expect } from 'vitest';
import { DEPARTMENTS, computeInfraFromEcowatt, computeInfraFromOutages } from './stability-index.ts';
import { telecomFixtureResponse } from '../components/layer-panel/outages.fixture.ts';
import { parisDate } from './ecowatt-official.ts';
import type { EcowattResponse, EcowattSignal, TelecomOutagesResponse } from '../types/index.ts';

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

describe('DEPARTMENTS : noms officiels accentués, Corse', () => {
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
});

describe('computeInfraFromOutages : pannes télécoms imprévues récentes par code de département (spec 2026-10-08 § 2.3)', () => {
  const telecom = (byDept: Array<[string | null, number]>): TelecomOutagesResponse => ({
    ...telecomFixtureResponse(), byDept: byDept.map(([dept, recent]) => ({ dept, recent })),
  });
  const PANNE = { label: 'Panne Réseau', source: 'ARCEP' };

  it('5 pannes récentes et plus : 65 ; 3 et 4 : 50 ; moins de 3 : aucune composante', () => {
    expect(computeInfraFromOutages('34', telecom([['34', 5]]))).toEqual({ score: 65, ...PANNE });
    expect(computeInfraFromOutages('34', telecom([['34', 40]]))).toEqual({ score: 65, ...PANNE });
    expect(computeInfraFromOutages('34', telecom([['34', 4]]))).toEqual({ score: 50, ...PANNE });
    expect(computeInfraFromOutages('34', telecom([['34', 3]]))).toEqual({ score: 50, ...PANNE });
    expect(computeInfraFromOutages('34', telecom([['34', 2]]))).toBeNull();
  });

  it('rattachement par code (Corse 2A et 2B comprises), jamais par le nom ni par un autre département', () => {
    const t = telecom([['2B', 28], ['34', 6], [null, 9]]);
    expect(computeInfraFromOutages('2B', t)?.score).toBe(65);
    expect(computeInfraFromOutages('34', t)?.score).toBe(65);
    expect(computeInfraFromOutages('2A', t)).toBeNull();
    expect(computeInfraFromOutages('21', t)).toBeNull();
  });

  it('fichier non lu (null) : aucune composante, jamais une panne par défaut', () => {
    expect(computeInfraFromOutages('34', null)).toBeNull();
  });
});
