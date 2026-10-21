// api/_handlers/outages/now.js : pannes en cours, toutes sources et tous opérateurs confondus, et 50 dernières entrées du journal
// (control room, spec 2026-10-21 § 5.3). État calculé chaque minute par le serveur (api/_lib/outages-room.js) ; toujours 200.
import { roomSnapshot } from '../../_lib/outages-room.js';
import { handlePreflight, sendSourceJson } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=30, stale-while-revalidate=60';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  sendSourceJson(res, await roomSnapshot(Date.now()), { ok: true, cacheControl: CACHE_CONTROL });
}
