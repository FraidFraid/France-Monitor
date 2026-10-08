// api/_handlers/sovereignty/military.js : aéronefs militaires au-dessus de la France (spec 2026-10-04 souveraineté § 2.1 ; contrats
// § 2.2 ; décision du 08/10/2026 : plus aucun masquage). Dernière collecte adsb.lol /v2/mil du serveur (lancée si elle est due) :
// tous les appareils avec leur identité publiée, français aussi comptés par département, urgences confirmées sur deux lectures,
// historique horaire de 7 jours.
// 200 si une collecte de moins de 2 h est servie (avec sa date) ; 502 sinon, jamais mis en cache. Échéance de 15 s : une collecte
// plus longue (file adsb.lol occupée) continue en arrière-plan, la route sert la précédente en le disant.
import { MIL_PENDING_NOTE, ensureMilitaryFresh, storedMilitary } from '../../_lib/military-collect.js';
import { ROUTE_BUDGET_MS, withinBudget } from '../../_lib/route-budget.js';
import { handlePreflight, sendSourceJson } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=60, stale-while-revalidate=120';

/**
 * Réponse complète (MilitaryResponse) à l'instant `now` ; ne lève jamais.
 * @param {number} [now]
 * @param {{ budgetMs?: number }} [options]
 */
export function loadMilitary(now = Date.now(), { budgetMs = ROUTE_BUDGET_MS } = {}) {
  return withinBudget(ensureMilitaryFresh(now), budgetMs, () => storedMilitary(now, MIL_PENDING_NOTE));
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadMilitary(Date.now());
  sendSourceJson(res, body, { ok: body.readAt !== null, cacheControl: CACHE_CONTROL });
}
