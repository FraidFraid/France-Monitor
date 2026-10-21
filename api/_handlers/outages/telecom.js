// api/_handlers/outages/telecom.js : panneau Télécoms (spec 2026-10-08 panneaux pannes § 2.1). Dernier fichier ARCEP classé (collecte
// lancée si elle est due), fichier précédent, historique de 30 jours. 200 si un fichier est servi, 502 sinon (même forme). Échéance de
// 15 s : une collecte plus longue continue en arrière-plan, le relevé précédent est servi avec la note « ARCEP : lecture en cours ».
import { TELECOM_PENDING_NOTE, emptyTelecom, ensureTelecomFresh, storedTelecom } from '../../_lib/outages-telecom.js';
import { ROUTE_BUDGET_MS, withinBudget } from '../../_lib/route-budget.js';
import { telecomPressReports } from '../../_lib/telecom-press.js';
import { snapshotItems } from '../news.js';
import { handlePreflight, sendSourceJson, sourceError } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=600, stale-while-revalidate=1800';
export const PENDING_CACHE_CONTROL = 's-maxage=60, stale-while-revalidate=120';

/** Pannes signalées par la presse (21/10/2026) ; absentes sans base, erreur nommée si elle est injoignable. */
async function pressPart(now, readItems) {
  try {
    const items = await readItems(now);
    return items === null ? {} : { press: telecomPressReports(items, now) };
  } catch (err) {
    return { pressError: sourceError('Presse', err) };
  }
}

/** Réponse complète (TelecomOutagesResponse) ; ne lève jamais. */
export async function loadTelecom(now = Date.now(), { budgetMs = ROUTE_BUDGET_MS, readItems = snapshotItems } = {}) {
  const work = ensureTelecomFresh(now).catch((err) => emptyTelecom([sourceError('ARCEP', err)]));
  const [body, press] = await Promise.all([
    withinBudget(work, budgetMs, () => storedTelecom(now, TELECOM_PENDING_NOTE)),
    withinBudget(pressPart(now, readItems), budgetMs, () => ({})),
  ]);
  if (press.pressError) return { ...body, errors: [...body.errors, press.pressError] };
  return press.press ? { ...body, press: press.press } : body;
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadTelecom(Date.now());
  sendSourceJson(res, body, { ok: body.file !== null, cacheControl: body.errors.includes(TELECOM_PENDING_NOTE) ? PENDING_CACHE_CONTROL : CACHE_CONTROL });
}
