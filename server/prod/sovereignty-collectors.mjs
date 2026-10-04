// server/prod/sovereignty-collectors.mjs : collectes serveur du lot Souveraineté (spec 2026-10-04 souveraineté § 2 ; contrats, arbitrage 3 ;
// amendement 7, O14), ajoutées à la relève d'une minute de server/prod/traffic-collectors.mjs. Chaque collecteur ne fait rien s'il
// n'est pas dû ; les routes appellent les mêmes fonctions, donc sans relève (dev) la collecte se fait à la demande, à la même cadence.
// Phase B : gnss, noaa, ripestat, gels (tâche B24).
import { ensureCablesWatchFresh } from '../../api/_lib/cable-watch.js';
import { ensureCyberFresh } from '../../api/_lib/cyber-collect.js';
import { ensureMilitaryFresh } from '../../api/_lib/military-collect.js';
import { ensureVigipirateFresh } from '../../api/_lib/vigipirate-page.js';

/**
 * Collecteurs : vols militaires toutes les 2 min, veille des câbles toutes les 5 min, cyber (chaque partie à sa cadence), page
 * Vigipirate du SGDSN une fois par jour.
 */
export const SOVEREIGNTY_COLLECTORS = [
  { name: 'military', run: ensureMilitaryFresh },
  { name: 'cables-watch', run: ensureCablesWatchFresh },
  { name: 'cyber', run: ensureCyberFresh },
  { name: 'vigipirate', run: ensureVigipirateFresh },
];
