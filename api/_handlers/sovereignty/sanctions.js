// api/_handlers/sovereignty/sanctions.js : registre national des gels (spec 2026-10-04 souveraineté § 3.4 ; contrats § 2.7). Date de
// publication, comptes par nature, différences d'identifiants, historique des publications ; jamais une fiche nominative (lien vers le
// registre officiel dans le panneau). 200 si une publication est connue ou si la date a été lue ; 502 sinon. Échéance de 15 s : une
// lecture du fichier plus longue continue en arrière-plan, l'état gardé est servi avec la note « Registre des gels : lecture en cours ».
import { GELS_PENDING_NOTE, ensureGelsFresh, storedGels } from '../../_lib/gels-avoirs.js';
import { ROUTE_BUDGET_MS, withinBudget } from '../../_lib/route-budget.js';
import { handlePreflight, sendSourceJson, sourceError } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=1800, stale-while-revalidate=3600';
export const PENDING_CACHE_CONTROL = 's-maxage=60, stale-while-revalidate=120';

/**
 * Réponse complète (SanctionsResponse) ; ne lève jamais.
 * @param {number} [now]
 * @param {{ budgetMs?: number }} [options]
 */
export async function loadSanctions(now = Date.now(), { budgetMs = ROUTE_BUDGET_MS } = {}) {
  const work = ensureGelsFresh(now).catch((err) => ({
    readAt: null, dateCheckedAt: null, current: null, history: { publications: [], since: null }, errors: [sourceError('Registre des gels', err)],
  }));
  return withinBudget(work, budgetMs, () => storedGels(now, GELS_PENDING_NOTE));
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadSanctions(Date.now());
  const ok = body.current !== null || body.dateCheckedAt !== null;
  sendSourceJson(res, body, { ok, cacheControl: body.errors.includes(GELS_PENDING_NOTE) ? PENDING_CACHE_CONTROL : CACHE_CONTROL });
}
