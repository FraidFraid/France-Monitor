// api/_handlers/transport/rail-situations.js : situations ferroviaires en cours (SIRI SX Lite national, sans clé ;
// spec 2026-10-03 panneaux trafic § 2.4) : cause, classement, axe ou région. Cache 5 min (4,2 Mo par lecture) ;
// sans réponse : 502 non mis en cache.
import { loadRailSituationEntries, situationsAt } from '../../_lib/siri-sx.js';
import { cachedSource, handlePreflight, sendSourceJson, sourceError } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=600';

/** Réponse complète (RailSituationsResponse). */
export async function loadSituations(now = Date.now()) {
  try {
    const r = await cachedSource('traffic:siri-sx', { ttlSec: 300, staleSec: 3600, shared: false }, () => loadRailSituationEntries(now));
    // Valeur servie depuis le cache : les situations échues depuis sont retirées à l'instant courant.
    return { at: r.at, situations: situationsAt(r.entries, now), errors: [] };
  } catch (err) {
    return { at: null, situations: [], errors: [sourceError('SIRI SX', err)] };
  }
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadSituations(Date.now());
  sendSourceJson(res, body, { ok: body.at !== null, cacheControl: CACHE_CONTROL });
}
