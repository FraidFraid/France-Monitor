// server/prod/outages-collectors.mjs : collectes serveur du lot Pannes réseau (spec 2026-10-08 panneaux pannes), ajoutées à la relève
// d'une minute de server/prod/traffic-collectors.mjs. Chaque collecteur ne fait rien s'il n'est pas dû ; les routes appellent les mêmes
// fonctions. Télécoms (30 min) ; Électricité (par partie) ; Internet (10 min IODA, 15 min Radar) ; Cloud (30 min par page d'état) ;
// control room des pannes (chaque minute, fusion et journal).
import { ensureTelecomFresh } from '../../api/_lib/outages-telecom.js';
import { ensurePowerFresh } from '../../api/_lib/outages-power.js';
import { ensureInternetFresh } from '../../api/_lib/outages-internet.js';
import { ensureCloudFresh } from '../../api/_lib/outages-cloud.js';
import { tickOutagesRoom } from '../../api/_lib/outages-room.js';
import { ensureSocialFresh } from '../../api/_lib/outages-social.js';
import { ensureAtlasFresh } from '../../api/_lib/outages-atlas.js';

export const OUTAGES_COLLECTORS = [
  { name: 'outages-telecom', run: ensureTelecomFresh },
  { name: 'outages-power', run: ensurePowerFresh },
  { name: 'outages-internet', run: ensureInternetFresh },
  { name: 'outages-cloud', run: ensureCloudFresh },
  // Signalements d'usagers (Bluesky, Mastodon), toutes les 2 min.
  { name: 'outages-social', run: ensureSocialFresh },
  // Sondes RIPE Atlas décrochées, toutes les 5 min.
  { name: 'outages-atlas', run: ensureAtlasFresh },
  // Control room (21/10/2026) : en dernier, après les relevés de la minute.
  { name: 'outages-room', run: tickOutagesRoom },
];
