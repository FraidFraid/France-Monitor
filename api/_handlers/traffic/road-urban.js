// api/_handlers/traffic/road-urban.js : congestion urbaine, 12 agglomérations (spec 2026-10-03 panneaux trafic
// § 2.2). Lit la dernière collecte serveur TomTom (api/_lib/tomtom-urban.js) et lance un cycle s'il est dû :
// aucun appel TomTom par visiteur. Sans aucune collecte réussie : 502 non mis en cache.
import { ensureUrbanFresh } from '../../_lib/tomtom-urban.js';
import { handlePreflight, sendSourceJson } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=600';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await ensureUrbanFresh(Date.now());
  sendSourceJson(res, body, { ok: body.collectedAt !== null, cacheControl: CACHE_CONTROL });
}
