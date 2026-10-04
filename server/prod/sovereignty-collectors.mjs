// server/prod/sovereignty-collectors.mjs : collectes serveur du lot Souveraineté (spec 2026-10-04 souveraineté § 2 ; contrats, arbitrage 3 ;
// amendement 7, O14), ajoutées à la relève d'une minute de server/prod/traffic-collectors.mjs. Chaque collecteur ne fait rien s'il
// n'est pas dû ; les routes appellent les mêmes fonctions, donc sans relève (dev) la collecte se fait à la demande, à la même cadence.
// Phase B : gnss, noaa, ripestat, gels (tâche B24).
import { ensureCablesWatchFresh } from '../../api/_lib/cable-watch.js';
import { ensureCyberFresh } from '../../api/_lib/cyber-collect.js';
import { ensureMilitaryFresh } from '../../api/_lib/military-collect.js';
import { loadSpaceWeather } from '../../api/_lib/noaa-swpc.js';
import { ensureGnssFresh } from '../../api/_lib/gnss-collect.js';
import { ensureRipeFresh } from '../../api/_lib/ripestat.js';
import { ensureGelsFresh } from '../../api/_lib/gels-avoirs.js';
import { ensureVigipirateFresh } from '../../api/_lib/vigipirate-page.js';

/**
 * Collecteurs : vols militaires toutes les 2 min, veille des câbles toutes les 5 min, cyber (chaque partie à sa cadence), page
 * Vigipirate du SGDSN une fois par jour ; phase B : météo spatiale NOAA, grille GNSS (10 min), RIPEstat et registre des gels (1 h).
 */
export const SOVEREIGNTY_COLLECTORS = [
  { name: 'military', run: ensureMilitaryFresh },
  { name: 'cables-watch', run: ensureCablesWatchFresh },
  { name: 'cyber', run: ensureCyberFresh },
  // Phase B (tâche B24) : NOAA avant la grille (Kp de la fenêtre frais au calcul), grille GNSS 10 min, RIPEstat 1 h, registre des gels 1 h.
  { name: 'noaa', run: loadSpaceWeather },
  { name: 'gnss', run: ensureGnssFresh },
  { name: 'ripestat', run: ensureRipeFresh },
  { name: 'gels', run: ensureGelsFresh },
  { name: 'vigipirate', run: ensureVigipirateFresh },
];
