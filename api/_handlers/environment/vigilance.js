// api/_handlers/environment/vigilance.js : vigilance Météo-France normalisée (spec 2026-10-04 environnement § 2.1) :
// carte J et J+1 par département et par phénomène, créneaux, domaines littoraux, comptes, commentaire, bulletins
// national, zonal et départemental, départements en vigilance sur 30 jours (archive open data). 200 si la carte ou
// les textes sont lus (réponse partielle nommée dans `errors`), 502 non mis en cache sinon (clé absente comprise).
import { ensureVigilanceArchiveFresh } from '../../_lib/vigilance-archive.js';
import { loadVigilance } from '../../_lib/meteo-vigilance.js';
import { handlePreflight, sendSourceJson } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=600';
/** Attente maximale de la relève de l'archive (amorçage de 76 cartes : il continue en arrière-plan). */
export const ARCHIVE_WAIT_MS = 1_500;

/** Attend `promise` au plus `ms` millisecondes ; ne rejette jamais. */
function settleWithin(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
  return Promise.race([promise.then(() => undefined, () => undefined), timeout]).finally(() => clearTimeout(timer));
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const now = Date.now();
  // Archive relue au plus une fois par jour : par la relève du serveur en production, à la demande en dev.
  await settleWithin(ensureVigilanceArchiveFresh(now), ARCHIVE_WAIT_MS);
  const body = await loadVigilance(now);
  sendSourceJson(res, body, { ok: body.updateTime !== null || body.textsUpdateTime !== null, cacheControl: CACHE_CONTROL });
}
