// api/_handlers/sovereignty/gnss.js : grille GNSS mesurée et météo spatiale (spec 2026-10-04 souveraineté § 3.1 ; contrats § 2.5,
// arbitrage 34 ; amendement 7, O15 à O17). Dernière grille complète de la collecte serveur (cycle lancé s'il est dû) et météo spatiale
// NOAA, chacune avec sa date : comptes sans lieu en direct, mailles localisées du jour UTC précédent seulement. 200 si une grille ou la
// météo spatiale est servie ; 502 sinon, jamais mis en cache. Échéance de 15 s : un cycle plus long (cinq lectures à 6 s d'écart au
// moins) continue en arrière-plan, la route sert la grille précédente en le disant (« adsb.lol : collecte en cours », cache de 30 s).
import { GNSS_PENDING_NOTE, emptyGnssBody, ensureGnssFresh, storedGnss } from '../../_lib/gnss-collect.js';
import { loadSpaceWeather } from '../../_lib/noaa-swpc.js';
import { ROUTE_BUDGET_MS, withinBudget } from '../../_lib/route-budget.js';
import { handlePreflight, sendSourceJson, sourceError } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=600';
export const PENDING_CACHE_CONTROL = 's-maxage=30, stale-while-revalidate=60';

/**
 * Réponse complète (GnssResponse) à l'instant `now` ; ne lève jamais.
 * @param {number} [now]
 * @param {{ budgetMs?: number }} [options]
 */
export async function loadGnss(now = Date.now(), { budgetMs = ROUTE_BUDGET_MS } = {}) {
  const gridWork = ensureGnssFresh(now).catch((err) => emptyGnssBody([sourceError('Grille GNSS', err)]));
  const [grid, sw] = await Promise.all([
    withinBudget(gridWork, budgetMs, () => storedGnss(now, GNSS_PENDING_NOTE)),
    loadSpaceWeather(now),
  ]);
  return { ...grid, spaceWeather: sw.spaceWeather, errors: [...grid.errors, ...sw.errors] };
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadGnss(Date.now());
  const ok = body.readAt !== null || body.spaceWeather.readAt !== null;
  sendSourceJson(res, body, { ok, cacheControl: body.errors.includes(GNSS_PENDING_NOTE) ? PENDING_CACHE_CONTROL : CACHE_CONTROL });
}
