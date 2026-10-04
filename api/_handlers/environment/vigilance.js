// api/_handlers/environment/vigilance.js : vigilance Météo-France normalisée (spec 2026-10-04 environnement § 2.1) :
// carte J et J+1 par département et par phénomène, créneaux, domaines littoraux, comptes, commentaire et bulletins
// national, zonal et départemental. 200 si la carte ou les textes sont lus (réponse partielle nommée dans `errors`),
// 502 non mis en cache sinon (clé absente comprise).
import { loadVigilance } from '../../_lib/meteo-vigilance.js';
import { handlePreflight, sendSourceJson } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=600';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadVigilance(Date.now());
  sendSourceJson(res, body, { ok: body.updateTime !== null || body.textsUpdateTime !== null, cacheControl: CACHE_CONTROL });
}
