// src/components/layer-panel/pollens.fixture.ts : jeu d'essai des tests Pollens (vue, légende, carte, garde de réponse). Valeurs
// CONSTRUITES à la main au format de /api/environment/pollen : le 20/10/2026 tous les codes réels valent 1 (hors saison), aucun
// niveau élevé à lire ; ce jeu fabrique des niveaux 3 à 6 pour exercer les règles. Copie neuve à chaque appel.
import type { PollenDeptDay, PollenResponse, PollenTaxon } from '../../types/index.ts';

/** 20 octobre 2026, 16 h 00 à Paris (14:00Z). */
export const POLLEN_FIXTURE_NOW = Date.parse('2026-10-20T14:00:00Z');

function day(date: string, maxCode: number, communes: number, high: number, taxa: Array<[PollenTaxon, number]>, alerte = false): PollenDeptDay {
  return { date, maxCode, communes, high, alerte, taxa: taxa.map(([taxon, code]) => ({ taxon, code })) };
}

export function pollenFixture(): PollenResponse {
  const [j, j1, j2] = ['2026-10-20', '2026-10-21', '2026-10-22'];
  const calm: Array<[PollenTaxon, number]> = [['aulne', 1], ['bouleau', 1], ['olivier', 1], ['graminees', 1], ['armoise', 1], ['ambroisie', 1]];
  return {
    readAt: '2026-10-20T14:00:00.000Z', days: [j, j1, j2], updatedAt: '2026-10-20T10:39:06.740Z',
    sources: ['Airparif', 'Atmo Auvergne-Rhône-Alpes', 'AtmoSud'],
    errors: [],
    departments: [
      {
        code: '13', name: 'Bouches-du-Rhône',
        days: [
          day(j, 4, 119, 3, [['olivier', 4], ['armoise', 3], ['aulne', 1]], true),
          day(j1, 3, 119, 0, [['armoise', 3], ['olivier', 2]]),
          day(j2, 2, 119, 0, [['armoise', 2]]),
        ],
      },
      {
        code: '69', name: 'Rhône',
        days: [
          day(j, 5, 267, 12, [['ambroisie', 5], ['graminees', 4], ['armoise', 2], ['aulne', 1]]),
          day(j1, 6, 267, 30, [['ambroisie', 6], ['graminees', 4]]),
          day(j2, 3, 267, 0, [['ambroisie', 3]]),
        ],
      },
      { code: '75', name: 'Paris', days: [day(j, 1, 1, 0, calm), day(j1, 1, 1, 0, calm), day(j2, 1, 1, 0, calm)] },
      { code: '2A', name: 'Corse-du-Sud', days: [day(j, 2, 124, 0, [['olivier', 2], ['aulne', 1]])] },
    ],
  };
}

export function calmPollenFixture(): PollenResponse {
  const p = pollenFixture();
  p.departments = p.departments.filter((d) => d.code === '75' || d.code === '2A');
  return p;
}
