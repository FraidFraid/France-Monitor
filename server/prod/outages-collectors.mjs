// server/prod/outages-collectors.mjs : collectes serveur du lot Pannes réseau (spec 2026-10-08 panneaux pannes), ajoutées à la relève
// d'une minute de server/prod/traffic-collectors.mjs. Chaque collecteur ne fait rien s'il n'est pas dû ; les routes appellent les mêmes
// fonctions. Télécoms (30 min) ; Électricité (par partie) ; Internet (10 min IODA, 15 min Radar) ; Cloud (B4).
import { ensureTelecomFresh } from '../../api/_lib/outages-telecom.js';
import { ensurePowerFresh } from '../../api/_lib/outages-power.js';
import { ensureInternetFresh } from '../../api/_lib/outages-internet.js';

export const OUTAGES_COLLECTORS = [
  { name: 'outages-telecom', run: ensureTelecomFresh },
  { name: 'outages-power', run: ensurePowerFresh },
  { name: 'outages-internet', run: ensureInternetFresh },
];
