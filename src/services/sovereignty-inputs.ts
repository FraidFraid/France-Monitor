// src/services/sovereignty-inputs.ts : entrées Souveraineté du score France, des situations, de la frise, des tuiles, de la fiche et du
// moniteur d'alertes (spec 2026-10-04 souveraineté § 2.4 ; contrats § 6 ; amendement 7, O6, O7, O10). Adaptateurs purs sur les
// dernières lectures des services (tâche A9), modèle environment-inputs.ts : la formule du score et ses cibles ne changent pas, seules
// les entrées changent. Une source jamais lue ou en retard donne des listes vides et se dit indisponible ; jamais une valeur inventée
// (V1, S3).
import type {
  CableAlert, CablesWatchResponse, CyberResponse, GnssDegradedCounts, MilitaryEmergency, MilitaryResponse, SovereigntyAvailability,
} from '../types/index.ts';
import { cablesLevel, cyberLevel, defenseLevel, isSovereigntyDataLate, militaryCounts } from './sovereignty-levels.ts';
import { emergencyColoursPill, type LayerLevel } from './traffic-levels.ts';

export interface SovereigntyInputs {
  /** Aéronefs militaires ou d'État visibles en ADS-B au-dessus de la métropole (O9 ; français, autres montrés et masqués) ; 0 si indisponible. */
  militaryFlightsCount: number;
  /** Parmi eux, ceux du bloc d'adresse OACI France, comptés par département (O10, tuile « Militaire ») ; 0 si indisponible. */
  militaryFrenchCount: number;
  /**
   * Urgences qui colorent : affichées sur deux relevés, au-dessus du territoire ou à moins de 40 km (emergencyColoursPill), montrées ou
   * masquées (O10 : une urgence masquée n'a ni adresse, ni indicatif, ni position). Seul un 7500 ouvre « Signal défense » (O7).
   */
  militaryEmergencies: MilitaryEmergency[];
  /** Navires lents confirmés sur un câble, veille évaluée et AIS frais, hors zone muette ; [] sinon (AIS muet : ni score, ni situation). */
  cableAlerts: CableAlert[];
  /** Mailles à précision GNSS dégradée, comptes sans lieu (O17) : phase A, toujours null ; B28 le remplit (gnssDegradedCounts). */
  gnssDegraded: GnssDegradedCounts | null;
  /** Réponse cyber, CERT-FR lu et à l'heure (6 h) ; null sinon. */
  cyber: CyberResponse | null;
  sovereigntyAvailable: SovereigntyAvailability;
  /** Pastilles des panneaux Défense et Vigilance cyber, mêmes fonctions (tuiles « Militaire » et « Cyber », jamais lues par la formule). */
  defensePillLevel: LayerLevel;
  cyberPillLevel: LayerLevel;
  /** Phase B (withGnssInputs, tâche B28) : la grille GNSS seule a relevé la pastille Défense ; absent en phase A. */
  defensePillFromGnss?: boolean;
}

/** Relevé adsb.lol lu et à l'heure (10 min) : sinon aucun aéronef ni urgence n'entre au score. */
function servedMilitary(m: MilitaryResponse | null, now: number): MilitaryResponse | null {
  return m !== null && m.readAt !== null && !isSovereigntyDataLate('adsb-mil', m.readAt, now) ? m : null;
}

/** Veille évaluée et à l'heure : pastille Connectivité lue (relevé de moins de 15 min) et dernier message AIS à l'heure (amendement 5). */
function servedCables(c: CablesWatchResponse | null, now: number): CablesWatchResponse | null {
  if (c === null || c.readAt === null || !c.evaluated) return null;
  if (cablesLevel(c, now).level === 'nd' || isSovereigntyDataLate('ais-cables', c.aisLastMessageAt, now)) return null;
  return c;
}

/**
 * Vigilance cyber qui compte : CERT-FR lu et à l'heure (relevé + 6 h, S2). Le statut non lu d'une alerte récente met la pastille à
 * n.d. sans retirer la réponse du score : les familles lisent chacune leur partie et en écartent ce qui est en retard.
 */
export function servedCyber(c: CyberResponse | null, now: number): CyberResponse | null {
  return c !== null && c.certfr.readAt !== null && !isSovereigntyDataLate('certfr', c.certfr.readAt, now) ? c : null;
}

/** Entrées à l'instant `now` (contrats § 6, phase A : la grille GNSS arrive à B28). */
export function buildSovereigntyInputs(
  military: MilitaryResponse | null, cables: CablesWatchResponse | null, cyber: CyberResponse | null, now: number,
): SovereigntyInputs {
  const m = servedMilitary(military, now);
  const c = servedCables(cables, now);
  const y = servedCyber(cyber, now);
  const counts = m !== null ? militaryCounts(m) : null;
  return {
    militaryFlightsCount: counts?.total ?? 0,
    militaryFrenchCount: counts?.francais ?? 0,
    militaryEmergencies: m?.emergencies.filter(emergencyColoursPill) ?? [],
    // Une alerte « non évaluée (flux de la zone muet) » ne colore jamais la pastille (A12) : elle n'entre pas non plus au score.
    cableAlerts: c?.alerts.filter((a) => a.confirmed && a.zoneMuted !== true) ?? [],
    gnssDegraded: null,
    cyber: y,
    sovereigntyAvailable: { military: m !== null, cables: c !== null, cyber: y !== null },
    defensePillLevel: military !== null ? defenseLevel(military, now).level : 'nd',
    cyberPillLevel: cyber !== null ? cyberLevel(cyber, now).level : 'nd',
  };
}

/**
 * Urgences du moniteur d'alertes : au-dessus du territoire ou à moins de 40 km, relevé à l'heure ; affichées sur deux relevés (colorantes)
 * ou vues une seule fois (à confirmer), les trois codes (O7 : 7700 et 7600 y restent comme urgences aériennes). Hors des approches :
 * jamais une alerte.
 */
export function monitoredMilitaryEmergencies(military: MilitaryResponse | null, now: number): MilitaryEmergency[] {
  return servedMilitary(military, now)?.emergencies.filter((e) => e.overFrance) ?? [];
}
