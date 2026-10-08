// api/_lib/map-limit.js : lectures en parallèle bornées des routes Trafics (réseaux Traficolor de road-national, cadres TomTom
// des agglomérations). Un seul exemplaire pour le serveur.

/**
 * Applique `fn` à chaque élément, `limit` appels à la fois au plus ; résultats dans l'ordre des éléments, jamais de rejet :
 * chacun vaut `{ ok: true, value }` ou `{ ok: false, error }` (une source en panne n'empêche jamais les autres).
 * @template T, R
 * @param {readonly T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} fn
 * @returns {Promise<Array<{ ok: true, value: R } | { ok: false, error: unknown }>>}
 */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      results[i] = await Promise.resolve()
        .then(() => fn(items[i]))
        .then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
    }
  }));
  return results;
}
