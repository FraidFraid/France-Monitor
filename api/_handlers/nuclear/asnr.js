// api/_handlers/nuclear/asnr.js : événements de sûreté ASNR pour le panneau Nucléaire, la carte et les situations (spec 2026-10-13).
// GET seulement ; 200 si l'ASNR a été lue ou si le journal a des événements ; sinon 502 non mis en cache avec la panne nommée.
import { loadAsnr } from '../../_lib/asnr.js';
import { handlePreflight, sendSourceJson } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=900, stale-while-revalidate=900';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadAsnr(Date.now());
  sendSourceJson(res, body, { ok: body.readAt !== null || body.events.length > 0, cacheControl: CACHE_CONTROL });
}
