// server/prod/environment-collectors.mjs : collectes serveur du lot Environnement (spec 2026-10-04 environnement § 2.4 et
// E5), ajoutées à la relève d'une minute de server/prod/traffic-collectors.mjs. Chaque collecteur ne fait rien s'il n'est pas
// dû ; les routes appellent les mêmes fonctions, donc sans relève (dev) la collecte se fait à la demande, à la même cadence.
import { ensureFiresFresh } from '../../api/_lib/fires-collect.js';
import { ensureVigilanceArchiveFresh } from '../../api/_lib/vigilance-archive.js';

/** Collecteurs : FIRMS toutes les 15 min, archive de la vigilance une fois par jour de Paris. */
export const ENVIRONMENT_COLLECTORS = [
  { name: 'firms', run: ensureFiresFresh },
  { name: 'vigilance-archive', run: ensureVigilanceArchiveFresh },
];
