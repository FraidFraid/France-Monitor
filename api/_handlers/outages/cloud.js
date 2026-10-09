// api/_handlers/outages/cloud.js : panneau Cloud (spec 2026-10-08 panneaux pannes § 3.2). Pages d'état filtrées France, référentiel.
// 200 si un fournisseur est lu, 502 sinon (même forme). Échéance de 15 s : relevé précédent avec la note « Cloud : collecte en cours ».
import { CLOUD_PENDING_NOTE, emptyCloud, ensureCloudFresh, storedCloud } from '../../_lib/outages-cloud.js';
import { ROUTE_BUDGET_MS, withinBudget } from '../../_lib/route-budget.js';
import { handlePreflight, sendSourceJson, sourceError } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=900, stale-while-revalidate=1800';
export const PENDING_CACHE_CONTROL = 's-maxage=60, stale-while-revalidate=120';

/** Réponse complète (CloudOutagesResponse) ; ne lève jamais. */
export async function loadCloud(now = Date.now(), { budgetMs = ROUTE_BUDGET_MS } = {}) {
  const work = ensureCloudFresh(now).catch((err) => emptyCloud([sourceError('Cloud', err)]));
  return withinBudget(work, budgetMs, () => storedCloud(now, CLOUD_PENDING_NOTE));
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadCloud(Date.now());
  const ok = body.providers.some((p) => p.readAt !== null);
  sendSourceJson(res, body, { ok, cacheControl: body.errors.includes(CLOUD_PENDING_NOTE) ? PENDING_CACHE_CONTROL : CACHE_CONTROL });
}
