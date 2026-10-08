// api/_handlers/outages/telecom.js : panneau Télécoms (spec 2026-10-08 panneaux pannes § 2.1). Dernier fichier ARCEP classé (collecte
// lancée si elle est due), fichier précédent, historique de 30 jours. 200 si un fichier est servi, 502 sinon (même forme). Échéance de
// 15 s : une collecte plus longue continue en arrière-plan, le relevé précédent est servi avec la note « ARCEP : lecture en cours ».
import { TELECOM_PENDING_NOTE, emptyTelecom, ensureTelecomFresh, storedTelecom } from '../../_lib/outages-telecom.js';
import { ROUTE_BUDGET_MS, withinBudget } from '../../_lib/route-budget.js';
import { handlePreflight, sendSourceJson, sourceError } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=600, stale-while-revalidate=1800';
export const PENDING_CACHE_CONTROL = 's-maxage=60, stale-while-revalidate=120';

/** Réponse complète (TelecomOutagesResponse) ; ne lève jamais. */
export async function loadTelecom(now = Date.now(), { budgetMs = ROUTE_BUDGET_MS } = {}) {
  const work = ensureTelecomFresh(now).catch((err) => emptyTelecom([sourceError('ARCEP', err)]));
  return withinBudget(work, budgetMs, () => storedTelecom(now, TELECOM_PENDING_NOTE));
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadTelecom(Date.now());
  sendSourceJson(res, body, { ok: body.file !== null, cacheControl: body.errors.includes(TELECOM_PENDING_NOTE) ? PENDING_CACHE_CONTROL : CACHE_CONTROL });
}
