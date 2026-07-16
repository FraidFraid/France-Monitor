import { describe, expect, it } from 'vitest';
import {
  buildFireObservationSources,
  FIRE_OBSERVATION_CNRS_URL,
  FIRE_OBSERVATION_LSA_SAF_URL,
} from './fire-observation-model.ts';
import type { FireObservationRuntimeState } from '../types/index.ts';

const NOW = Date.parse('2026-07-16T13:00:00Z');
const runtime: FireObservationRuntimeState = {
  mtgFrp: {
    status: 'ok',
    observedAt: NOW - 10 * 60_000,
    fetchedAt: NOW,
    source: 'EUMETSAT LSA SAF',
  },
  radar2d: {
    status: 'not-configured',
    observedAt: null,
    fetchedAt: null,
    source: 'Météo-France DPRadar',
  },
};

describe('buildFireObservationSources', () => {
  it('describes the five sources in operational reading order', () => {
    const sources = buildFireObservationSources({ multiSource: false, runtime, now: NOW });
    expect(sources.map(source => source.id)).toEqual([
      'firms',
      'gibs',
      'mtg-frp',
      'radar-2d',
      'radar-3d',
    ]);
    expect(sources.map(source => source.status)).toEqual([
      'ACTIF',
      'ACTIF À LA DEMANDE',
      'ACTIF',
      'CONFIGURATION REQUISE',
      'NON CONNECTÉ',
    ]);
    expect(sources[2].timing).toContain('10 min');
    expect(sources[2].label).toBe('MTG-FRP');
    expect(sources[2].timing).toContain('45 min');
    expect(sources[2].observation).toContain('Observation');
    expect(sources[2].observation).toContain('10 min');
    expect(sources[2].qualification).toBe('DÉMONSTRATION');
    expect(sources[3].timing).toContain('5 min');
    expect(sources[3].observation).toBeUndefined();
  });

  it('adapts FIRMS revisit copy to available satellites', () => {
    expect(buildFireObservationSources({ multiSource: false, runtime, now: NOW })[0].timing)
      .toContain('~3 h');
    expect(buildFireObservationSources({ multiSource: true, runtime, now: NOW })[0].timing)
      .toContain('~1 h');
  });

  it('uses direct institutional HTTPS documentation URLs', () => {
    expect(FIRE_OBSERVATION_CNRS_URL).toMatch(/^https:\/\/www\.cnrs\.fr\//);
    expect(FIRE_OBSERVATION_LSA_SAF_URL).toMatch(/^https:\/\/lsa-saf\.eumetsat\.int\//);
  });

  it('provides icons while keeping 3D analysis explicitly disconnected', () => {
    const errorRuntime: FireObservationRuntimeState = {
      ...runtime,
      radar2d: { ...runtime.radar2d, status: 'error' },
    };
    const sources = buildFireObservationSources({ multiSource: true, runtime: errorRuntime, now: NOW });
    expect(sources.map(source => source.icon)).toEqual([
      'flame',
      'satellite',
      'timer',
      'wind',
      'wind',
    ]);
    expect(sources.find(source => source.id === 'radar-2d')?.status).toBe('INDISPONIBLE');
    expect(sources.find(source => source.id === 'radar-2d')?.role).toContain('2D');
    expect(sources.find(source => source.id === 'radar-2d')?.role).not.toContain('hauteur');
    expect(sources.find(source => source.id === 'radar-3d')?.status).toBe('NON CONNECTÉ');
    expect(sources.find(source => source.id === 'radar-3d')?.role).toContain('panache');
  });
});
