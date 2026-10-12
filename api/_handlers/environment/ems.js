// api/_handlers/environment/ems.js : activations Copernicus EMS pour la couche Catastrophes (spec 2026-10-12 Copernicus EMS). GET
// seulement ; 200 si la liste a été lue (ou relevé précédent servi avec sa date), sinon 502 non mis en cache avec la panne nommée.
import { loadEms } from '../../_lib/copernicus-ems.js';
import { handlePreflight, sendSourceJson } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=900, stale-while-revalidate=900';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadEms(Date.now());
  sendSourceJson(res, body, { ok: body.readAt !== null, cacheControl: CACHE_CONTROL });
}
