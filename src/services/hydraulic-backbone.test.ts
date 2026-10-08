// src/services/hydraulic-backbone.test.ts
import { describe, expect, it } from 'vitest';
import type { FloodSectionRef } from '../types/index.ts';
import { HYDRAULIC_BACKBONE_SEEDS } from '../config/hydraulic-backbone.ts';
import { buildHydraulicBackboneAssets, hydroCause, type HydroCauseInput } from './hydraulic-backbone.ts';

const base: HydroCauseInput = { floodLevel: null, weatherPressure: 0, ecowattSignal: null, isStep: false, observationTrend: 'unavailable' };

describe('cause des contraintes hydrauliques', () => {
  it('la plus forte contribution l’emporte ; à égalité, la crue d’abord', () => {
    expect(hydroCause({ ...base, floodLevel: 'orange', weatherPressure: 1, observationTrend: 'rising' })).toBe('crue vigilance orange');
    expect(hydroCause({ ...base, floodLevel: 'yellow', weatherPressure: 2 })).toBe('vigilance pluie-inondation orange');
    expect(hydroCause({ ...base, floodLevel: 'orange', weatherPressure: 2 })).toBe('crue vigilance orange');
    expect(hydroCause({ ...base, floodLevel: 'red' })).toBe('crue vigilance rouge');
  });
  it('Écowatt ne compte que pour les STEP', () => {
    expect(hydroCause({ ...base, ecowattSignal: 'red', isStep: true })).toBe('Écowatt rouge');
    expect(hydroCause({ ...base, ecowattSignal: 'red', isStep: false })).toBeNull();
  });
  it('tendance mesurée Hub’Eau, sinon aucune cause', () => {
    expect(hydroCause({ ...base, floodLevel: 'green', ecowattSignal: 'green', isStep: true, observationTrend: 'falling' })).toBe('débit en baisse');
    expect(hydroCause({ ...base, observationTrend: 'rising' })).toBe('débit en hausse');
    expect(hydroCause({ ...base, observationTrend: 'mixed' })).toBe('débits contrastés');
    expect(hydroCause(base)).toBeNull();
  });
  it('les ouvrages portent leur cause ; la classification ne change pas', () => {
    const seed = HYDRAULIC_BACKBONE_SEEDS.find((s) => s.river === "Eau d'Olle");
    expect(seed).toBeTruthy();
    const line = { type: 'LineString' as const, coordinates: [[6.0, 45.2], [6.1, 45.3]] };
    const flood: FloodSectionRef = { id: 'f', name: "Eau d'Olle", level: 'orange', geometry: line };
    const NOW = Date.parse('2026-10-02T07:00:00Z');
    const withFlood = buildHydraulicBackboneAssets(null, [flood], [], null, NOW);
    expect(withFlood.find((a) => a.id === seed?.id)?.signals.cause).toBe('crue vigilance orange');
    const calm = buildHydraulicBackboneAssets(null, [], [], null, NOW);
    expect(calm.every((a) => a.signals.cause === null)).toBe(true);
    // Classification inchangée : valeurs fixes sur une entrée connue.
    expect(withFlood.find((a) => a.id === seed?.id)?.signals.hydro_trend).toBe('normal');
    expect(calm.every((a) => a.signals.hydro_trend === 'normal')).toBe(true);
  });
});
