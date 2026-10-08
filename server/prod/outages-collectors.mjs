// server/prod/outages-collectors.mjs : collectes serveur du lot Pannes réseau (spec 2026-10-08 panneaux pannes), ajoutées à la relève
// d'une minute de server/prod/traffic-collectors.mjs. Chaque collecteur ne fait rien s'il n'est pas dû ; les routes appellent les mêmes
// fonctions. Télécoms (30 min) ; Électricité (A5), Internet (B2), Cloud (B4).
import { ensureTelecomFresh } from '../../api/_lib/outages-telecom.js';

export const OUTAGES_COLLECTORS = [
  { name: 'outages-telecom', run: ensureTelecomFresh },
];
