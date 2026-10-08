// api/_handlers/environment/drought.js : panneau Sécheresse (spec 2026-10-04 environnement § 3.1). GET seulement ; 200 si VigiEau
// a été lu (ou une valeur en cache servie avec sa date), sinon 502 non mis en cache avec l'erreur nommée.
import { emptyDrought, loadDrought } from '../../_lib/vigieau.js';
import { handlePreflight, sendSourceJson, sourceError } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=3600, stale-while-revalidate=7200';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  try {
    const body = await loadDrought(Date.now());
    sendSourceJson(res, body, { ok: body.readAt !== null, cacheControl: CACHE_CONTROL });
  } catch (err) {
    console.error('[environment/drought]', err);
    sendSourceJson(res, emptyDrought([sourceError('Sécheresse', err)]), { ok: false, cacheControl: CACHE_CONTROL });
  }
}
