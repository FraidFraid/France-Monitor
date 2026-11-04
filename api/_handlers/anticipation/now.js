// api/_handlers/anticipation/now.js : scénarios d'anticipation ouverts, agenda de 7 jours et signaux cités (04/11/2026). État calculé chaque
// minute par le serveur (api/_lib/anticipation/room.js) ; toujours 200, bêta.
import { anticipationSnapshot } from '../../_lib/anticipation/room.js';
import { handlePreflight, sendSourceJson } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=30, stale-while-revalidate=60';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  sendSourceJson(res, await anticipationSnapshot(Date.now()), { ok: true, cacheControl: CACHE_CONTROL });
}
