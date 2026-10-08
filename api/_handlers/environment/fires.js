// api/_handlers/environment/fires.js : feux de forêt (spec 2026-10-04 environnement § 2.4). Dernière collecte FIRMS du
// serveur (cycle lancé s'il est dû, api/_lib/fires-collect.js) et météo des forêts (api/_lib/forest-danger.js), chacune avec
// sa propre date. 200 si une collecte FIRMS est servie (2 jours au plus après sa lecture) ou si la météo des forêts est lue ;
// 502 sinon. Échéance de 15 s : un cycle plus long continue en arrière-plan, la route sert la collecte précédente en le disant.
// Une réponse où rien n'a répondu (502, ou dernière collecte servie après un essai FIRMS sans aucune source lue et météo des
// forêts en panne) n'est jamais mise en cache : l'ancienne route gardait même ses pannes 1 h derrière le CDN.
import { FIRMS_PENDING_ERROR, emptyFiresBody, ensureFiresFresh, isFiresDue, storedFires } from '../../_lib/fires-collect.js';
import { loadForestDanger } from '../../_lib/forest-danger.js';
import { PARTIAL_CACHE_CONTROL, handlePreflight, sendSourceJson, sourceError } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=900';
/** Réponse « collecte en cours » : la collecte sera servie dès la fin du cycle, d'où un cache CDN de 30 s. */
export const PENDING_CACHE_CONTROL = 's-maxage=30, stale-while-revalidate=60';
/** Échéance totale de la route (le client abandonne à 20 s). */
export const ROUTE_BUDGET_MS = 15_000;
const MDF_LATE_ERROR = 'Météo des forêts : délai dépassé (échéance de la route)';
const LATE = Symbol('échéance');

/** Résultat de `work`, ou celui de `late()` à l'échéance (le travail continue en arrière-plan). */
async function withinBudget(work, budgetMs, late) {
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(resolve, Math.max(0, budgetMs), LATE); });
  try {
    const outcome = await Promise.race([work, deadline]);
    return outcome === LATE ? late() : outcome;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Réponse complète (FiresResponse) à l'instant `now` ; ne lève jamais.
 * @param {number} [now]
 * @param {{ budgetMs?: number }} [options]
 */
export async function loadFires(now = Date.now(), { budgetMs = ROUTE_BUDGET_MS } = {}) {
  const firmsWork = ensureFiresFresh(now).catch((err) => emptyFiresBody([sourceError('FIRMS', err)]));
  const [firms, mdf] = await Promise.all([
    withinBudget(firmsWork, budgetMs, () => storedFires(now, FIRMS_PENDING_ERROR)),
    withinBudget(loadForestDanger(now), budgetMs, () => ({ forestDanger: null, errors: [MDF_LATE_ERROR] })),
  ]);
  return { ...firms, forestDanger: mdf.forestDanger, errors: [...firms.errors, ...mdf.errors] };
}

/**
 * Cache CDN d'une réponse : jamais quand rien n'a répondu ; 30 s pendant un cycle FIRMS ; réponses partielles comme les autres
 * routes (5 min, relecture en 10 min) ; 5 min sinon.
 * @param {{ readAt: string | null, forestDanger: unknown, errors: string[] }} body
 * @param {number} now
 */
export function firesCacheControl(body, now) {
  // Collecte de plus de 14 min : le cycle dû vient d'être tenté sans qu'aucune source FIRMS réponde (isFiresDue).
  if (body.forestDanger === null && isFiresDue(body.readAt, now)) return 'no-store';
  if (body.errors.includes(FIRMS_PENDING_ERROR)) return PENDING_CACHE_CONTROL;
  return body.errors.length > 0 ? PARTIAL_CACHE_CONTROL : CACHE_CONTROL;
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const now = Date.now();
  const body = await loadFires(now);
  const ok = body.readAt !== null || body.forestDanger !== null;
  const cacheControl = firesCacheControl(body, now);
  if (ok && cacheControl === 'no-store') {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(body);
    return;
  }
  sendSourceJson(res, body, { ok, cacheControl });
}
