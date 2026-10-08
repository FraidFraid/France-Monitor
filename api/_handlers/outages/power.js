// api/_handlers/outages/power.js : panneau Électricité (spec 2026-10-08 panneaux pannes § 2.2). Arrêts de production EDF (imprévus,
// planifiés, annoncés à 7 jours), indisponibilités du transport RTE, signaux des îles, courbe de 30 jours. 200 si EDF ou l'IIP est servi,
// 502 sinon (même forme). Échéance de 15 s : relevé précédent servi avec la note « Électricité : collecte en cours ».
import { POWER_PENDING_NOTE, emptyPower, ensurePowerFresh, storedPower } from '../../_lib/outages-power.js';
import { ROUTE_BUDGET_MS, withinBudget } from '../../_lib/route-budget.js';
import { handlePreflight, sendSourceJson, sourceError } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=900';
export const PENDING_CACHE_CONTROL = 's-maxage=60, stale-while-revalidate=120';

/** Réponse complète (PowerOutagesResponse) ; ne lève jamais. */
export async function loadPower(now = Date.now(), { budgetMs = ROUTE_BUDGET_MS } = {}) {
  const work = ensurePowerFresh(now).catch((err) => emptyPower([sourceError('Électricité', err)]));
  return withinBudget(work, budgetMs, () => storedPower(now, POWER_PENDING_NOTE));
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadPower(Date.now());
  const ok = body.edfReadAt !== null || body.iipReadAt !== null;
  sendSourceJson(res, body, { ok, cacheControl: body.errors.includes(POWER_PENDING_NOTE) ? PENDING_CACHE_CONTROL : CACHE_CONTROL });
}
