// api/_handlers/environment/pollen.js : panneau Pollens (Atmo France, 20/10/2026). GET seulement ; requêtes WFS toujours filtrées par
// date (api/_lib/pollen.js) ; 200 si un jour a été lu, sinon 502 non mis en cache avec les erreurs nommées.
import { emptyPollen, loadPollen } from '../../_lib/pollen.js';
import { handlePreflight, sendSourceJson, sourceError } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=1800, stale-while-revalidate=3600';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  try {
    const body = await loadPollen(Date.now());
    sendSourceJson(res, body, { ok: body.readAt !== null, cacheControl: CACHE_CONTROL });
  } catch (err) {
    console.error('[environment/pollen]', err);
    sendSourceJson(res, emptyPollen([sourceError('Pollens', err)]), { ok: false, cacheControl: CACHE_CONTROL });
  }
}
