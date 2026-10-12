// api/_handlers/environment/disasters.js : couche Catastrophes (GDACS) (spec 2026-10-12 GDACS). GET seulement ; 200 si une requête
// GDACS a répondu (ou un relevé précédent servi avec sa date), sinon 502 non mis en cache avec la panne nommée.
import { emptyDisasters, loadDisasters } from '../../_lib/gdacs.js';
import { handlePreflight, sendSourceJson, sourceError } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=600';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  try {
    const body = await loadDisasters(Date.now());
    sendSourceJson(res, body, { ok: body.readAt !== null, cacheControl: CACHE_CONTROL });
  } catch (err) {
    console.error('[environment/disasters]', err);
    sendSourceJson(res, emptyDisasters([sourceError('GDACS', err)]), { ok: false, cacheControl: CACHE_CONTROL });
  }
}
