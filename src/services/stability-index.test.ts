import { describe, it, expect } from 'vitest';
import { computeInfraFromEcowatt } from './stability-index.ts';
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
