// api/_handlers/social/protests.js : couche Manifestations (spec 2026-10-17 manifestations). GET seulement ; 200 si une des deux
// sources a répondu, sinon 502 non mis en cache avec les pannes nommées.
import { emptyProtests, loadProtests } from '../../_lib/protests.js';
import { handlePreflight, sendSourceJson, sourceError } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=600';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  try {
    const body = await loadProtests(Date.now());
    sendSourceJson(res, body, { ok: body.readAt !== null, cacheControl: CACHE_CONTROL });
  } catch (err) {
    console.error('[social/protests]', err);
    sendSourceJson(res, emptyProtests([sourceError('Manifestations', err)]), { ok: false, cacheControl: CACHE_CONTROL });
  }
}
