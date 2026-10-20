// src/components/deckgl/env-context.test.ts : carte de l'onglet Environnement, « l'anormal d'abord » (20/10/2026).
import { describe, expect, it } from 'vitest';
import type { FilterSpecification } from 'maplibre-gl';
import { NOTHING, envContextFilter, envContextRevealed } from './env-context.ts';

const none = new Set<string>();

describe('l’anormal d’abord', () => {
  it('hors de l’onglet ou pastille révélée : filtre d’origine', () => {
    const base: FilterSpecification = ['!', ['has', 'point_count']];
    expect(envContextFilter('webcams', base, false, none)).toBe(base);
    expect(envContextFilter('webcams', base, true, new Set(['webcams']))).toBe(base);
  });
  it('contexte sans pastille : rien (radar, remplissages, webcams, monde des feux)', () => {
    for (const id of ['pollen-fill', 'air-quality-fill', 'drought-fill', 'webcams', 'fires-abroad', 'forest-danger-fill']) {
      expect(envContextFilter(id, null, true, none)).toEqual(NOTHING);
    }
  });
  it('anormal gardé : stations en hausse, foyers confirmés, séismes notables, catastrophes françaises ; combiné au filtre d’origine', () => {
    expect(envContextFilter('flood-stations', null, true, none)).toEqual(['==', ['get', 'rising'], true]);
    expect(envContextFilter('fires-pts', null, true, none)).toEqual(['==', ['get', 'glow'], true]);
    expect(envContextFilter('quakes', null, true, none)).toEqual(['==', ['get', 'notable'], true]);
    expect(envContextFilter('disasters-pulse', ['>', ['get', 'period'], 0], true, none))
      .toEqual(['all', ['>', ['get', 'period'], 0], ['==', ['get', 'french'], true]]);
  });
  it('calque sans règle (vigilance, tronçons de crue) : inchangé', () => {
    expect(envContextFilter('weather-fill', null, true, none)).toBeNull();
  });
  it('radar et Seveso : révélés par leur pastille, toujours hors de l’onglet', () => {
    expect(envContextRevealed('weatherRadar', true, none)).toBe(false);
    expect(envContextRevealed('weatherRadar', true, new Set(['weatherRadar']))).toBe(true);
    expect(envContextRevealed('seveso', false, none)).toBe(true);
  });
});
