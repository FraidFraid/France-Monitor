// src/config/vigipirate.ts : posture Vigipirate en vigueur (spec 2026-10-04 souveraineté § 2.1, V4 ; contrats § 3.5, arbitrage 18 ;
// amendement 7, O14 et S1). Le SGDSN ne publie aucun flux : saisie datée, reprise telle quelle de https://www.sgdsn.gouv.fr/vigipirate
// (stades du plan VIGIPIRATE 2026, posture « été-automne 2026 » en vigueur depuis le 22 juin 2026, lus le 04/10/2026). Hors score et
// sans couleur de niveau : c'est une posture, pas un événement (E2). Le serveur relit la page chaque jour (route
// /api/sovereignty/vigipirate, empreinte du texte utile) : une page modifiée après le jour de la saisie fait dire « niveau à
// revérifier sur sgdsn.gouv.fr (page modifiée le JJ/MM) » (src/services/sovereignty-vigipirate.ts) ; une saisie de plus de 120 jours
// fait dire « à vérifier sur sgdsn.gouv.fr » (vigipirateReminderDue). À chaque changement de posture : mettre à jour cette saisie.
import type { VigipirateEntry, VigipirateStade } from '../types/index.ts';

export type { VigipirateEntry, VigipirateStade };

/** Stades du plan VIGIPIRATE 2026 (SGDSN), du stade initial au stade sommital. */
export const VIGIPIRATE_STADES: readonly VigipirateStade[] = ['vigilance', 'vigilance-renforcee', 'alerte-attentat'];

/** Libellés officiels des stades (page du SGDSN). */
export const VIGIPIRATE_LABEL: Readonly<Record<VigipirateStade, string>> = {
  vigilance: 'vigilance',
  'vigilance-renforcee': 'vigilance renforcée',
  'alerte-attentat': 'alerte attentat',
};

/**
 * Rang du stade dans les mots du SGDSN (S1 : jamais « 2 sur 3 ») : « le stade « vigilance renforcée », qui correspond au niveau
 * d’alerte intermédiaire ». Le stade sommital, « alerte attentat », est activable 12 jours renouvelables (vigipirateAlertEnd).
 */
export const VIGIPIRATE_RANK_LABEL: Readonly<Record<VigipirateStade, string>> = {
  vigilance: 'niveau d’alerte initial',
  'vigilance-renforcee': 'niveau d’alerte intermédiaire',
  'alerte-attentat': 'niveau d’alerte sommital',
};

/** Mention de la source de la saisie (S1). */
export const VIGIPIRATE_SOURCE_LABEL = 'Source : site internet du SGDSN';

/** Saisie du 04/10/2026, d'après la page du SGDSN (accents de la posture repris presque mot pour mot). */
export const VIGIPIRATE: VigipirateEntry = {
  stade: 'vigilance-renforcee',
  depuis: '2026-06-22',
  posture: 'été-automne 2026',
  accents: [
    'lutte contre la menace drones',
    'sécurité des sites touristiques et des zones d’affluence',
    'sécurité des bâtiments publics et institutionnels',
  ],
  saisiLe: '2026-10-04',
  lien: 'https://www.sgdsn.gouv.fr/vigipirate',
};
