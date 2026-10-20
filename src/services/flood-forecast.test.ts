// src/services/flood-forecast.test.ts : lecture d'une prévision de hauteur Vigicrues.
import { describe, expect, it } from 'vitest';
import type { FloodStation } from '../types/index.ts';
import { forecastText, readForecast } from './flood-forecast.ts';

const NOW = Date.parse('2026-10-20T10:00:00Z');
const at = (h: number): string => new Date(NOW + h * 3_600_000).toISOString();
const station = (heightM: number | null, means: number[]): FloodStation => ({
  code: 'Y341400501', name: 'Quissac', lat: 43.9, lon: 4.0, lastAt: at(0), heightM, flowM3s: null, change1hM: null, heightSeries: [], flowSeries: [],
  forecast: means.length === 0 ? null : { producedAt: at(-1), points: means.map((v, i) => ({ at: at(i + 1), min: v - 0.3, mean: v, max: v + 0.3 })) },
});

describe('prévision Vigicrues', () => {
  it('hausse : pic de la moyenne prévue, avec sa fourchette et son échéance', () => {
    expect(readForecast(station(1.8, [2.0, 2.4, 2.2]), NOW)).toMatchObject({ trend: 'hausse', inHours: 2, key: { mean: 2.4 } });
    expect(forecastText(station(1.8, [2.0, 2.4, 2.2]), NOW)).toBe('Prévision Vigicrues : hausse jusqu’à 2,40\u00a0m dans 2\u00a0h (2,10 à 2,70\u00a0m)');
  });
  it('baisse : dernier point prévu (Quissac le 20/10 : 1,72 → 1,59 m)', () => {
    expect(forecastText(station(1.75, [1.72, 1.68, 1.62, 1.59]), NOW)).toBe('Prévision Vigicrues : baisse vers 1,59\u00a0m dans 4\u00a0h (1,29 à 1,89\u00a0m)');
  });
  it('points déjà passés écartés (prévision de la veille) : rien, jamais « maintenant » sur une valeur périmée', () => {
    const st = station(2.2, [2.63]);
    expect(readForecast(st, NOW + 2 * 3_600_000)).toBeNull();
  });
  it('écart de moins de 5 cm : stable ; sans prévision : rien', () => {
    expect(readForecast(station(1.6, [1.62, 1.61]), NOW)?.trend).toBe('stable');
    expect(forecastText(station(1.6, []), NOW)).toBeNull();
  });
});
