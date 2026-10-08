// src/utils/metropolesElectric.test.ts
import { describe, expect, it } from 'vitest';
import { classifyMetropoles, METRO_LEGEND_LABELS, METRO_LEVEL, METROPOLE_COLORS } from './metropolesElectric.ts';

describe('charge métropolitaine : couleurs de niveau', () => {
  it('trois classes sur les jetons de niveau (mêmes teintes qu’avant)', () => {
    expect(METRO_LEVEL).toEqual({ small: 'vert', medium: 'orange', large: 'rouge' });
    expect(METROPOLE_COLORS.large.color).toBe('rgba(255,59,48,0.82)');
    expect(METROPOLE_COLORS.medium.color).toBe('rgba(255,149,0,0.78)');
    expect(METROPOLE_COLORS.small.color).toBe('rgba(52,199,89,0.74)');
    expect(METROPOLE_COLORS.small.glowColor).toBe('rgba(52,199,89,0.2)');
    expect(METRO_LEGEND_LABELS).toEqual({ small: 'Charge relative faible', medium: 'Charge relative moyenne', large: 'Charge relative forte' });
  });
  it('seuils de classe inchangés (60 % et 20 % du maximum)', () => {
    const m = (code: string, mw: number) => ({ code, name: code, lon: 0, lat: 0, consommation: mw, date_heure: '2026-10-02T06:00:00+00:00' });
    expect(classifyMetropoles([m('a', 100), m('b', 61), m('c', 60), m('d', 20)]).map((x) => x.sizeClass)).toEqual(['large', 'large', 'medium', 'small']);
  });
});
