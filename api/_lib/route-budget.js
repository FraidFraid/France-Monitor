// api/_lib/route-budget.js : échéance des routes à collecte serveur (spec 2026-10-04 souveraineté § 2 ; contrats § 2, règle de
// l'échéance de 15 s, modèle api/_handlers/environment/fires.js). Une collecte plus longue continue en arrière-plan ; la route sert
// la collecte précédente en le disant.

/** Échéance totale d'une route (le client abandonne à 20 s). */
export const ROUTE_BUDGET_MS = 15_000;
const LATE = Symbol('échéance');

/**
 * Résultat de `work`, ou celui de `late()` à l'échéance (le travail continue en arrière-plan, son résultat sert la relève suivante).
 * @template T
 * @param {Promise<T>} work
 * @param {number} budgetMs
 * @param {() => T | Promise<T>} late
 * @returns {Promise<T>}
 */
export async function withinBudget(work, budgetMs, late) {
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(resolve, Math.max(0, budgetMs), LATE); });
  try {
    const outcome = await Promise.race([work, deadline]);
    return outcome === LATE ? late() : outcome;
  } finally {
    clearTimeout(timer);
  }
}
