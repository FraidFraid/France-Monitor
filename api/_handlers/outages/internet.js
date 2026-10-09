// api/_handlers/outages/internet.js : panneau Internet (spec 2026-10-08 panneaux pannes § 3.1). Événements IODA de 30 jours, Cloudflare Radar
// (non configuré sans jeton), rappel RIPEstat. 200 si IODA est servi, 502 sinon (même forme). Échéance de 15 s : relevé précédent avec la note.
import { INTERNET_PENDING_NOTE, emptyInternet, ensureInternetFresh, radarTokenSet, storedInternet } from '../../_lib/outages-internet.js';
import { ROUTE_BUDGET_MS, withinBudget } from '../../_lib/route-budget.js';
import { handlePreflight, sendSourceJson, sourceError } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=900';
export const PENDING_CACHE_CONTROL = 's-maxage=60, stale-while-revalidate=120';

/** Réponse complète (InternetOutagesResponse) ; ne lève jamais. Sur exception, « configuré » reste celui du jeton (P36). */
export async function loadInternet(now = Date.now(), { budgetMs = ROUTE_BUDGET_MS } = {}) {
  const work = ensureInternetFresh(now).catch((err) => emptyInternet([sourceError('Internet', err)], radarTokenSet()));
  return withinBudget(work, budgetMs, () => storedInternet(now, INTERNET_PENDING_NOTE));
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadInternet(Date.now());
  sendSourceJson(res, body, { ok: body.iodaReadAt !== null, cacheControl: body.errors.includes(INTERNET_PENDING_NOTE) ? PENDING_CACHE_CONTROL : CACHE_CONTROL });
}
