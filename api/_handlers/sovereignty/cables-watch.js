// api/_handlers/sovereignty/cables-watch.js : navires lents près des câbles télécom sous-marins (spec 2026-10-04 souveraineté § 2.2 ;
// contrats § 2.3 ; amendement 7, O18 et S9 ; arbitrage FX2). Relevé du relais AIS par le serveur toutes les 5 min, tracés datés du
// Shom et d'OpenStreetMap, mouillage permis hors zone de câbles non signalé, approches d'atterrage et ports (moins de 2 km d'un
// atterrage) : seul un navire déclaré au mouillage dans une zone de câbles du Shom signalé ; bâtiments militaires français écartés
// (type 35 ou nom « FRENCH WARSHIP ») ; confirmation sur deux messages AIS espacés d'au moins 5 min ; flux muet : « non évalué ».
// 200 dès que le relais a répondu une fois (même muet) ; 502 sinon, jamais mis en cache.
import { ensureCablesWatchFresh } from '../../_lib/cable-watch.js';
import { handlePreflight, sendSourceJson } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=120, stale-while-revalidate=300';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await ensureCablesWatchFresh(Date.now());
  sendSourceJson(res, body, { ok: body.readAt !== null, cacheControl: CACHE_CONTROL });
}
