// src/services/sovereignty-inputs-b.test.ts : entrées du score de la phase B (spec 2026-10-04 souveraineté § 3.1 ; contrats § 6 ;
// amendement 7, O7, O17) : comptes de mailles à précision dégradée sans lieu (gnssDegradedCounts : 24 h glissantes et deux derniers
// jours UTC complets), pastille Défense recalculée (1 ou 2 mailles jaune, 3 et plus orange). Review Focus 3 : l'orage (Kp 5+,
// dégradation générale) ne compte jamais ; une grille en retard ou jamais lue non plus (« non évalué », jamais « 0 »).
import { describe, expect, it } from 'vitest';
import type { GnssResponse } from '../types/index.ts';
import {
  CABLES_WATCH_FIXTURE, CYBER_FIXTURE, GNSS_FIXTURE, GNSS_STORM_FIXTURE, MILITARY_EMERGENCY_FIXTURE, MILITARY_FIXTURE, SOV_FIXTURE_NOW,
} from '../components/layer-panel/sovereignty.fixture.ts';
import { buildSovereigntyInputs } from './sovereignty-inputs.ts';
import { withGnssInputs } from './sovereignty-inputs-b.ts';

const NOW = SOV_FIXTURE_NOW;
const base = () => buildSovereigntyInputs(MILITARY_FIXTURE(), CABLES_WATCH_FIXTURE(), CYBER_FIXTURE(), NOW);
/** Grille du 04/10 avec d'autres comptes sans lieu (le serveur les sert tels quels). */
function counts(rolling24h: number, previousUtcDays: [number | null, number | null]): GnssResponse {
  return { ...GNSS_FIXTURE(), degraded: { rolling24h, previousUtcDays } };
}

describe('entrées du score, phase B', () => {
  it('grille du 04/10 : 2 mailles sur 24 h glissantes, veille 2, avant-veille non couverte ; pastille Défense jaune ; le reste inchangé', () => {
    expect(base().gnssDegraded).toBeNull();
    expect(base().defensePillLevel).toBe('vert');
    const b = withGnssInputs(base(), GNSS_FIXTURE(), MILITARY_FIXTURE(), NOW);
    expect(b.gnssDegraded).toEqual({ rolling24h: 2, previousUtcDays: [2, null] });
    expect(b.defensePillLevel).toBe('jaune');
    // La grille seule a relevé la pastille (vert sans elle) : la tuile « Militaire » le dira (revue de B28, m3).
    expect(b.defensePillFromGnss).toBe(true);
    const { defensePillFromGnss: _fromGnss, ...rest } = b;
    expect({ ...rest, gnssDegraded: null, defensePillLevel: 'vert' }).toEqual(base());
  });
  it('urgence 7700 confirmée (orange) et 2 mailles (jaune) : la couleur vient de l’urgence, pas de la grille', () => {
    const m = MILITARY_EMERGENCY_FIXTURE();
    const b = withGnssInputs(buildSovereigntyInputs(m, CABLES_WATCH_FIXTURE(), CYBER_FIXTURE(), NOW), GNSS_FIXTURE(), m, NOW);
    expect(b.defensePillLevel).toBe('orange');
    expect(b.defensePillFromGnss).toBeUndefined();
    // 3 mailles : orange aussi, déjà donné par l'urgence ; toujours pas « de la grille ».
    expect(withGnssInputs(buildSovereigntyInputs(m, CABLES_WATCH_FIXTURE(), CYBER_FIXTURE(), NOW), counts(3, [3, 3]), m, NOW).defensePillFromGnss).toBeUndefined();
  });
  it('O17 : des comptes seulement, jamais une maille ni un lieu', () => {
    const b = withGnssInputs(base(), GNSS_FIXTURE(), MILITARY_FIXTURE(), NOW);
    expect(Object.keys(b.gnssDegraded ?? {}).sort()).toEqual(['previousUtcDays', 'rolling24h']);
    expect(JSON.stringify(b)).not.toMatch(/"lat"|"lon"|cellsDay/);
  });
  it('3 mailles sur 24 h : pastille orange', () => {
    expect(withGnssInputs(base(), counts(3, [3, 1]), MILITARY_FIXTURE(), NOW).defensePillLevel).toBe('orange');
  });
  it('Review Focus 3 : orage Kp 5+ avec dégradation générale : non évalué (null), pastille de la phase A', () => {
    const b = withGnssInputs(base(), GNSS_STORM_FIXTURE(), MILITARY_FIXTURE(), NOW);
    expect(b.gnssDegraded).toBeNull();
    expect(b.defensePillLevel).toBe('vert');
    expect(b.defensePillFromGnss).toBeUndefined();
  });
  it('grille en retard (40 min) ou jamais lue : non évalué ; adsb.lol indisponible : pastille de la phase A gardée (n.d.)', () => {
    expect(withGnssInputs(base(), { ...GNSS_FIXTURE(), readAt: '2026-10-04T14:05:00.000Z' }, MILITARY_FIXTURE(), NOW).gnssDegraded).toBeNull();
    expect(withGnssInputs(base(), { ...GNSS_FIXTURE(), readAt: null }, MILITARY_FIXTURE(), NOW).gnssDegraded).toBeNull();
    expect(withGnssInputs(base(), null, MILITARY_FIXTURE(), NOW)).toEqual(base());
    const down = buildSovereigntyInputs(null, CABLES_WATCH_FIXTURE(), CYBER_FIXTURE(), NOW);
    const b = withGnssInputs(down, GNSS_FIXTURE(), null, NOW);
    expect(b.defensePillLevel).toBe('nd');
    expect(b.gnssDegraded).toEqual({ rolling24h: 2, previousUtcDays: [2, null] });
  });
});
