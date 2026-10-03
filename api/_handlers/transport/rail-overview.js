// api/_handlers/transport/rail-overview.js : réseau ferroviaire, perturbations du jour par axe grandes lignes
// et par région TER (API SNCF ; spec 2026-10-03 panneaux trafic § 2.4). Cache 5 min ; sans réponse SNCF :
// 502 non mis en cache. /api/transport/disruptions reste pour le panneau actuel jusqu'à la tâche 16.
import { buildRailOverview, fetchDisruptions, readCancelledTripStops, sncfAuth } from '../../_lib/sncf-rail.js';
import { cachedSource, handlePreflight, sendSourceJson, sourceError } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=600';

/** Réponse complète (RailOverviewResponse) à l'instant `now`. */
export async function loadRailOverview(now = Date.now()) {
  const auth = sncfAuth();
  const empty = { updatedAt: null, longDistance: { active: 0, delayed15: 0 }, axes: [], regions: [], topDelays: [], trains: [] };
  if (!auth) return { ...empty, errors: ['SNCF : clé absente (SNCF_API_KEY)'] };
  try {
    return await cachedSource('traffic:sncf:overview', { ttlSec: 300, staleSec: 3600, shared: false }, async () => {
      const disruptions = await fetchDisruptions(now, auth);
      const { stops, failures } = await readCancelledTripStops(disruptions, auth, now);
      const errors = failures > 0 ? [`SNCF, itinéraires des trains supprimés : ${failures} non lu${failures > 1 ? 's' : ''}`] : [];
      return { ...buildRailOverview(disruptions, stops), errors };
    });
  } catch (err) {
    return { ...empty, errors: [sourceError('SNCF', err)] };
  }
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadRailOverview(Date.now());
  sendSourceJson(res, body, { ok: body.updatedAt !== null, cacheControl: CACHE_CONTROL });
}
