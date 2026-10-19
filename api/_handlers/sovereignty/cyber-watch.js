// api/_handlers/sovereignty/cyber-watch.js : veille cyber élargie (api/_lib/cyber-watch.js) : DDoS visant la France et routes BGP
// (Cloudflare Radar), serveurs malveillants hébergés en France (abuse.ch), cibles françaises de NoName057(16), domaines imitant des
// services publics, violations notifiées à la CNIL, EPSS, vulnérabilités exploitées de l'ENISA, disponibilité des services publics en
// ligne. 200 si une partie a été lue au moins une fois ; 502 sinon. Échéance de 15 s : la collecte continue en arrière-plan.
import { CYBER_WATCH_PENDING_NOTE, ensureCyberWatchFresh, publicWatch, storedCyberWatch } from '../../_lib/cyber-watch.js';
import { ROUTE_BUDGET_MS, withinBudget } from '../../_lib/route-budget.js';
import { handlePreflight, sendSourceJson } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=120, stale-while-revalidate=600';

export async function loadCyberWatch(now = Date.now(), { budgetMs = ROUTE_BUDGET_MS } = {}) {
  return publicWatch(await withinBudget(ensureCyberWatchFresh(now), budgetMs, () => storedCyberWatch(now, CYBER_WATCH_PENDING_NOTE)));
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadCyberWatch(Date.now());
  sendSourceJson(res, body, { ok: body.readAt !== null, cacheControl: CACHE_CONTROL });
}
