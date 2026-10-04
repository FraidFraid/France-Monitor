// src/services/sovereignty-inputs-b.ts : entrées du score de la phase B (spec 2026-10-04 souveraineté § 3.1 ; contrats § 6 ; amendement 7,
// O7, O17). Comptes de mailles à précision GNSS dégradée, sans lieu (gnssDegradedCounts : 24 h glissantes et deux derniers jours UTC
// complets, null si la grille n'a jamais été complète, est en retard ou en dégradation générale), pastille Défense recalculée avec le compte
// des 24 h (defenseLevel, troisième argument : même règle que le panneau). RIPEstat, PeeringDB, registre des gels et zones drones restent
// hors score. Module à part (arbitrage 2 de la part B) : le corps de buildSovereigntyInputs (tâche A16) n'est pas réécrit.
import type { GnssResponse, MilitaryResponse } from '../types/index.ts';
import type { SovereigntyInputs } from './sovereignty-inputs.ts';
import { defenseLevel, gnssDegradedCount, gnssDegradedCounts } from './sovereignty-levels.ts';

/**
 * Entrées de A16 complétées par la grille GNSS. Grille absente, en retard ou en dégradation générale : `gnssDegraded` null (« GNSS non
 * évalué », jamais « 0 ») et pastille sans GNSS ; relevé adsb.lol absent : pastille de la phase A gardée.
 */
export function withGnssInputs(
  inputs: SovereigntyInputs, gnss: GnssResponse | null, military: MilitaryResponse | null, now: number,
): SovereigntyInputs {
  const gnssDegraded = gnssDegradedCounts(gnss, now);
  const defensePillLevel = military !== null ? defenseLevel(military, now, gnssDegradedCount(gnss, now)).level : inputs.defensePillLevel;
  return { ...inputs, gnssDegraded, defensePillLevel };
}
