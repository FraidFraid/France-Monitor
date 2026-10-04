// api/_handlers/environment/vigilance.js : vigilance Météo-France normalisée (spec 2026-10-04 environnement § 2.1) :
// carte J et J+1 par département et par phénomène, créneaux, domaines littoraux, comptes, commentaire, bulletins
// national, zonal et départemental, départements en vigilance sur 30 jours (archive open data). 200 si la carte ou
// les textes sont lus (réponse partielle nommée dans `errors`), 502 non mis en cache sinon (clé absente comprise).
import { CONSTITUTION_ERROR } from '../../_lib/vigilance-archive.js';
import { loadVigilance } from '../../_lib/meteo-vigilance.js';
import { handlePreflight, sendSourceJson } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=600';
/** Attente maximale de la relève de l'archive (amorçage de 76 cartes : il continue en arrière-plan). */
export const ARCHIVE_WAIT_MS = 1_500;
/** Amorçage en cours : la réponse n'est pas gardée longtemps au CDN. */
export const CONSTITUTION_CACHE_CONTROL = 's-maxage=30, stale-while-revalidate=60';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const now = Date.now();
  // Archive relue au plus une fois par jour : relève attendue en parallèle de la carte et des textes (dev ; prod : tâche 8).
  const body = await loadVigilance(now, ARCHIVE_WAIT_MS);
  const constituting = body.errors.includes(CONSTITUTION_ERROR);
  sendSourceJson(res, body, {
    ok: body.updateTime !== null || body.textsUpdateTime !== null,
    cacheControl: constituting ? CONSTITUTION_CACHE_CONTROL : CACHE_CONTROL,
  });
}
