// api/_handlers/environment/sea-levels.js : section Submersion marine du panneau Vigilance météo (spec 2026-10-04 environnement § 3.4).
// GET seulement ; 200 si un marégraphe a répondu, sinon 502 non mis en cache avec chaque panne nommée.
import { emptySeaLevels, loadSeaLevels } from '../../_lib/tide-gauges.js';
import { handlePreflight, sendSourceJson, sourceError } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=600';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  try {
    const body = await loadSeaLevels(Date.now());
    sendSourceJson(res, body, { ok: body.readAt !== null, cacheControl: CACHE_CONTROL });
  } catch (err) {
    console.error('[environment/sea-levels]', err);
    sendSourceJson(res, emptySeaLevels([sourceError('Marégraphes SHOM', err)]), { ok: false, cacheControl: CACHE_CONTROL });
  }
}
