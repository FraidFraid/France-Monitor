import { describe, it, expect } from 'vitest';
import { normalizeCyber, normalizeElec } from './network-barometer.ts';
import { parisDate } from './ecowatt-official.ts';
import type { EcowattResponse, EcowattSignal } from '../types/index.ts';
import { CYBER_FIXTURE, SOV_FIXTURE_NOW } from '../components/layer-panel/sovereignty.fixture.ts';

describe('normalizeCyber : réponse de /api/sovereignty/cyber (arbitrage 11), plus d’ancien tableau ni d’événements de menace', () => {
  it('04/10 : 100 moins la pression consolidée (28) ; deux pannes télécom renforcent les corrélations (33)', () => {
    expect(normalizeCyber(CYBER_FIXTURE(), { telecomOutageCount: 0, cloudIncidentCount: 0 }, SOV_FIXTURE_NOW)).toBe(72);
    expect(normalizeCyber(CYBER_FIXTURE(), { telecomOutageCount: 2, cloudIncidentCount: 0 }, SOV_FIXTURE_NOW)).toBe(67);
  });
});

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

describe('normalizeElec — Écowatt national (green/orange/red), jamais un 100 par défaut', () => {
  it('green → 100, orange → 60, red → 20', () => {
    expect(normalizeElec(ecowatt('green'), NOW)).toBe(100);
    expect(normalizeElec(ecowatt('orange'), NOW)).toBe(60);
    expect(normalizeElec(ecowatt('red'), NOW)).toBe(20);
  });

  it('niveau inconnu (signal officiel indisponible) → null, jamais 100 par défaut', () => {
    expect(normalizeElec(ecowatt(null), NOW)).toBeNull();
  });

  it('signal d’un autre jour (repli open data J-1) → null, pas présenté comme celui du jour', () => {
    const yesterday: EcowattResponse = {
      official: { source: 'odre', generatedAt: null, days: [{ date: '2026-09-24', level: 'red', message: 'Test', hours: Array.from({ length: 24 }, () => 1) }] },
      mixes: {},
      national: { timestamp: new Date(0), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 },
      interconnections: [], grid: null,
    };
    expect(normalizeElec(yesterday, NOW)).toBeNull();
  });
});
