// src/services/sovereignty-alerts.ts : moniteur d'alertes de la phase B (spec 2026-10-04 souveraineté § 3.1 ; contrats § 6 ; amendement 7,
// O7, O15, O17, S15). Une seule entrée GNSS, sans lieu (O17 : aucune maille localisée en direct), tirée des comptes de la grille
// (gnssDegradedCounts : grille fraîche, hors dégradation générale) : « N mailles françaises au-delà de 10 % sur 24 h glissantes ».
// Gravité moyenne ; élevée par la même règle que la situation « Précision GNSS dégradée » (isGnssDegradationSustained, O7 : au moins
// GNSS_SITUATION_CELLS mailles sur 24 h et sur chacun des deux derniers jours UTC complets) ; jamais critique. Une grille devenue
// inexploitable retire aussitôt l'entrée du moniteur (pruneStaleGnssAlert), sans attendre sa durée de vie.
// Texte prudent (O15) : une précision de position dégradée est à vérifier, seules la DGAC et l'ANFR qualifient un brouillage ; l'entrée
// renvoie au panneau Défense (mailles localisées du jour UTC précédent). Valeurs insécables (R1).
import type { DetectedSituation, GnssResponse } from '../types/index.ts';
import { GNSS_ORANGE_PCT, gnssDegradedCounts, gnssWindowHours, isGnssDegradationSustained, isGnssWindowCovered } from './sovereignty-levels.ts';

const NBSP = '\u00a0';
const DAY_MS = 86_400_000;
const ORANGE_AT = `au-delà de ${GNSS_ORANGE_PCT}${NBSP}%`;
/** Identifiant de l'unique entrée GNSS du moniteur (le même d'une lecture à l'autre : une gravité qui change reste la même alerte). */
export const GNSS_MONITOR_ID = 'gnss-degraded-24h';

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
 * générale, ou si aucune maille française n'a dépassé 10 % sur 24 h glissantes. Fenêtre de moins de 23 h 50 (redémarrage du serveur) :
 * un compte positif donne l'entrée, titrée « mesure partielle de N h » (arbitrage FX2, deuxième tour) ; un compte nul n'en donne aucune.
 */
export function gnssJammingSituations(g: GnssResponse | null, now: number): DetectedSituation[] {
  const counts = gnssDegradedCounts(g, now);
  if (g === null || g.readAt === null || counts === null || counts.rolling24h <= 0) return [];
  const n = counts.rolling24h;
  const cells = n > 1 ? `${n}${NBSP}mailles françaises` : `${n}${NBSP}maille française`;
  const covered = isGnssWindowCovered(g);
  const hours = gnssWindowHours(g);
  const span = covered ? `sur 24${NBSP}h glissantes` : `(mesure partielle de ${hours}${NBSP}h)`;
  return [{
    id: GNSS_MONITOR_ID,
    type: 'GPS_JAMMING_ALERT',
    severity: isGnssDegradationSustained(counts) ? 'high' : 'medium',
    confidence: 0.6,
    title: `Précision de position GNSS dégradée : ${cells} ${ORANGE_AT} ${span}`,
    summary: 'À vérifier : seules la DGAC et l’ANFR qualifient un brouillage. Mailles localisées du jour UTC précédent dans le panneau Défense.',
    affectedZones: ['France'],
    drivers: [
      `Jours UTC complets (${ORANGE_AT}) : veille ${previousDayText(g, g.readAt, 1)}, avant-veille ${previousDayText(g, g.readAt, 2)}`,
      'Hors dégradation générale (météo spatiale)',
      'Compte sans lieu : aucune maille localisée en direct',
      ...(covered ? [] : [`Mesure partielle : ${hours}${NBSP}h sur les 24${NBSP}h de la méthode (cumul repris au dernier redémarrage du serveur)`]),
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

/**
 * Retire du cache du moniteur l'entrée GNSS quand la lecture courante n'en donne plus (grille en retard, en dégradation générale, jamais
 * lue, ou aucune maille sur 24 h) : « aucune entrée » vaut tout de suite, jamais après la durée de vie du cache (modèle
 * pruneStalePressAlerts).
 */
export function pruneStaleGnssAlert<T>(cache: Map<string, T>, current: readonly DetectedSituation[]): void {
  if (!current.some((a) => a.id === GNSS_MONITOR_ID)) cache.delete(GNSS_MONITOR_ID);
}
