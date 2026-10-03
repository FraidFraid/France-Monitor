// api/_handlers/traffic/air-overview.js : panneau Trafic aérien (spec 2026-10-03 panneaux trafic § 2.3) :
// urgences et journal 7 jours, aéroports, volume de vols, trajectoires inhabituelles, crédits OpenSky.
// Lit la collecte serveur partagée (2 min) ; sans collecte réussie : 502 non mis en cache.
import { loadAirOverview } from '../../_lib/air-overview.js';
import { handlePreflight, sendSourceJson } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=60, stale-while-revalidate=120';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadAirOverview(Date.now());
  sendSourceJson(res, body, { ok: body.at !== null, cacheControl: CACHE_CONTROL });
}
