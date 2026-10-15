// src/utils/metropolesElectric.test.ts
import { describe, expect, it } from 'vitest';
import { classifyMetropoles, METRO_LEGEND_LABELS, METRO_LEVEL, METROPOLE_COLORS } from './metropolesElectric.ts';

describe('charge métropolitaine : couleurs de niveau', () => {
  it('couleur neutre sur la carte, niveaux gardés pour le panneau', () => {
    expect(METRO_LEVEL).toEqual({ small: 'vert', medium: 'orange', large: 'rouge' });
    // Carte de l'énergie (spec 2026-10-15) : la taille dit la charge, la couleur reste neutre (pas un état).
    expect(METROPOLE_COLORS.large.color).toBe('rgba(199,199,204,0.42)');
    expect(METROPOLE_COLORS.medium.color).toBe('rgba(199,199,204,0.42)');
    expect(METROPOLE_COLORS.small.color).toBe('rgba(199,199,204,0.42)');
    expect(METROPOLE_COLORS.small.glowColor).toBe('rgba(199,199,204,0.12)');
    expect(METRO_LEGEND_LABELS).toEqual({ small: 'Charge relative faible', medium: 'Charge relative moyenne', large: 'Charge relative forte' });
  });
  it('seuils de classe inchangés (60 % et 20 % du maximum)', () => {
    const m = (code: string, mw: number) => ({ code, name: code, lon: 0, lat: 0, consommation: mw, date_heure: '2026-10-02T06:00:00+00:00' });
    expect(classifyMetropoles([m('a', 100), m('b', 61), m('c', 60), m('d', 20)]).map((x) => x.sizeClass)).toEqual(['large', 'large', 'medium', 'small']);
  });
});
