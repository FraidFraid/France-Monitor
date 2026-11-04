// server/prod/anticipation-collectors.mjs : collecte serveur de l'anticipation (04/11/2026), ajoutée à la relève d'une minute de
// server/prod/traffic-collectors.mjs. En dernier : elle lit les relevés que les autres collecteurs viennent de rafraîchir.
import { ensureFootballFresh } from '../../api/_lib/football-data.js';
import { tickAnticipation } from '../../api/_lib/anticipation/room.js';

export const ANTICIPATION_COLLECTORS = [
  { name: 'football', run: ensureFootballFresh },
  { name: 'anticipation', run: tickAnticipation },
];
