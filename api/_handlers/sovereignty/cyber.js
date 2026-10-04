// api/_handlers/sovereignty/cyber.js : Vigilance cyber (spec 2026-10-04 souveraineté § 2.3 ; contrats § 2.4 ; amendement 7, O1, O3, O5,
// S12). Alertes et avis du CERT-FR (dernière version lue sur la page, statut officiel d'une alerte repris de la page liste, exploitation
// signalée citée), rapports Menaces et incidents de l'ANSSI, vulnérabilités exploitées de la CISA citées par le CERT-FR, revendications
// de rançongiciels agrégées (jamais un nom de victime), compte des fuites publiées en .fr, alertes de Cybermalveillance.gouv.fr ;
// chaque partie avec sa date et ses erreurs. 200 si une partie a été lue au moins une fois ; 502 sinon, jamais mis en cache.
// Échéance de 15 s : une collecte plus longue (victims.json fait 21 Mo) continue en arrière-plan, la route sert la précédente en le
// disant.
import { CYBER_PENDING_NOTE, ensureCyberFresh, storedCyber } from '../../_lib/cyber-collect.js';
import { ROUTE_BUDGET_MS, withinBudget } from '../../_lib/route-budget.js';
import { handlePreflight, sendSourceJson } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=600, stale-while-revalidate=1800';

/**
 * Réponse complète (CyberResponse) à l'instant `now` ; ne lève jamais.
 * @param {number} [now]
 * @param {{ budgetMs?: number }} [options]
 */
export function loadCyber(now = Date.now(), { budgetMs = ROUTE_BUDGET_MS } = {}) {
  return withinBudget(ensureCyberFresh(now), budgetMs, () => storedCyber(now, CYBER_PENDING_NOTE));
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadCyber(Date.now());
  sendSourceJson(res, body, { ok: body.readAt !== null, cacheControl: CACHE_CONTROL });
}
