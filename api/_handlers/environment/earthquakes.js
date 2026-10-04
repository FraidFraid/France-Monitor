// api/_handlers/environment/earthquakes.js : panneau Séismes (spec 2026-10-04 environnement § 3.3). GET seulement ; BCSF-RéNaSS,
// EMSC en repli ; 200 si l'un a répondu (ou une valeur en cache, avec sa date), sinon 502 non mis en cache avec les pannes nommées.
import { emptyQuakes, loadEarthquakes } from '../../_lib/seismes.js';
import { handlePreflight, sendSourceJson, sourceError } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=600';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  try {
    const body = await loadEarthquakes(Date.now());
    sendSourceJson(res, body, { ok: body.readAt !== null, cacheControl: CACHE_CONTROL });
  } catch (err) {
    console.error('[environment/earthquakes]', err);
    sendSourceJson(res, emptyQuakes([sourceError('Séismes', err)]), { ok: false, cacheControl: CACHE_CONTROL });
  }
}
