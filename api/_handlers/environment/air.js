// api/_handlers/environment/air.js : panneau Qualité de l'air (spec 2026-10-04 environnement § 3.2). GET seulement ; requêtes WFS
// toujours filtrées (api/_lib/atmo.js) ; 200 si une couche a été lue, sinon 502 non mis en cache avec les erreurs nommées.
import { addDays, emptyAir, loadAirQuality } from '../../_lib/atmo.js';
import { parisDay } from '../../_lib/paris-time.js';
import { handlePreflight, sendSourceJson, sourceError } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=1800, stale-while-revalidate=3600';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const now = Date.now();
  try {
    const body = await loadAirQuality(now);
    sendSourceJson(res, body, { ok: body.readAt !== null, cacheControl: CACHE_CONTROL });
  } catch (err) {
    console.error('[environment/air]', err);
    const j = parisDay(now);
    sendSourceJson(res, emptyAir([j, addDays(j, 1), addDays(j, 2)], [sourceError('Qualité de l’air', err)]), { ok: false, cacheControl: CACHE_CONTROL });
  }
}
