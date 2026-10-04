// src/services/sovereignty-alerts.ts : moniteur d'alertes de la phase B (spec 2026-10-04 souveraineté § 3.1 ; contrats § 6 ; amendement 7,
// O7, O15, O17, S15). Une seule entrée GNSS, sans lieu (O17 : aucune maille localisée en direct), tirée des comptes de la grille
// (gnssDegradedCounts : grille fraîche, hors dégradation générale) : « N mailles françaises au-delà de 10 % sur 24 h glissantes ».
// Gravité moyenne ; élevée seulement si les deux derniers jours UTC complets ont chacun au moins une maille (O7) ; jamais critique.
// Texte prudent (O15) : une précision de position dégradée est à vérifier, seules la DGAC et l'ANFR qualifient un brouillage ; l'entrée
// renvoie au panneau Défense (mailles localisées du jour UTC précédent). Valeurs insécables (R1).
import type { DetectedSituation, GnssResponse } from '../types/index.ts';
import { GNSS_ORANGE_PCT, gnssDegradedCounts } from './sovereignty-levels.ts';

const NBSP = ' ';
const DAY_MS = 86_400_000;
const ORANGE_AT = `au-delà de ${GNSS_ORANGE_PCT}${NBSP}%`;

/** Jour UTC « AAAA-MM-JJ » de `iso` reculé de `back` jours. */
function utcDayBack(iso: string, back: number): string {
  return new Date(Date.parse(iso) - back * DAY_MS).toISOString().slice(0, 10);
}

/** Jour UTC complet : « 2 », « n.d. (jour non couvert) », « n.d. (dégradation générale) » ; jamais un 0 qui aurait l'air d'un calme. */
function previousDayText(g: GnssResponse, readAt: string, back: 1 | 2): string {
  const n = g.degraded.previousUtcDays[back - 1];
  if (n === null) return 'n.d. (jour non couvert)';
  const day = utcDayBack(readAt, back);
  return g.days.days.some((d) => d.date === day && d.general) ? 'n.d. (dégradation générale)' : String(n);
}

/**
 * Entrée du moniteur pour la grille GNSS : aucune si la grille manque, n'a jamais été complète, est en retard (40 min) ou en dégradation
 * générale, ou si aucune maille française n'a dépassé 10 % sur 24 h glissantes.
 */
export function gnssJammingSituations(g: GnssResponse | null, now: number): DetectedSituation[] {
  const counts = gnssDegradedCounts(g, now);
  if (g === null || g.readAt === null || counts === null || counts.rolling24h <= 0) return [];
  const n = counts.rolling24h;
  const [veille, avantVeille] = counts.previousUtcDays;
  const twoDays = veille !== null && veille > 0 && avantVeille !== null && avantVeille > 0;
  const cells = n > 1 ? `${n}${NBSP}mailles françaises` : `${n}${NBSP}maille française`;
  return [{
    id: 'gnss-degraded-24h',
    type: 'GPS_JAMMING_ALERT',
    severity: twoDays ? 'high' : 'medium',
    confidence: 0.6,
    title: `Précision de position GNSS dégradée : ${cells} ${ORANGE_AT} sur 24${NBSP}h glissantes`,
    summary: 'À vérifier : seules la DGAC et l’ANFR qualifient un brouillage. Mailles localisées du jour UTC précédent dans le panneau Défense.',
    affectedZones: ['France'],
    drivers: [
      `Jours UTC complets (${ORANGE_AT}) : veille ${previousDayText(g, g.readAt, 1)}, avant-veille ${previousDayText(g, g.readAt, 2)}`,
      'Hors dégradation générale (météo spatiale)',
      'Compte sans lieu : aucune maille localisée en direct',
    ],
    recommendedActions: [
      { label: 'Signaler à la DGAC et à l’ANFR, seules à qualifier un brouillage', ownerHint: 'Analyste défense', actionType: 'cross-check' },
      { label: 'Suivre le compte à la prochaine collecte', ownerHint: 'Veille', actionType: 'monitor', automatable: true },
    ],
    sourceRefs: ['Grille GNSS (adsb.lol)', 'NOAA SWPC'],
    updatedAt: new Date(g.readAt),
    activateLayers: ['military'],
  }];
}
