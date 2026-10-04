// api/_lib/peeringdb.js : annuaire PeeringDB des points d'échange Internet en France (spec 2026-10-04 souveraineté § 3.3 ; contrats
// § 2.6). Un annuaire, sans état en direct (l'état de France-IX n'est pas publié en flux ouvert) ; lecture anonyme, cache partagé de
// 24 h ; nom, ville, date de mise à jour publiée, lien vers la fiche. Hors score.
import { cachedSource, cleanText, fetchStrictJson, sourceError } from './source-http.js';

export const PEERINGDB_IX_URL = 'https://www.peeringdb.com/api/ix?country=FR';
export const PEERINGDB_TTL_SEC = 86_400;
const TIMEOUT_MS = 20_000;

export function ixUrl(id) {
  return `https://www.peeringdb.com/ix/${id}`;
}

/** Points d'échange à l'état « ok », triés par nom (ordre français) ; lève sur une réponse sans liste ou sans point lisible. */
export function parseIx(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.data)) throw new Error('réponse illisible (liste « data » absente)');
  const items = json.data
    .filter((x) => x && typeof x === 'object' && x.status === 'ok' && Number.isInteger(x.id) && typeof x.name === 'string' && x.name.trim() !== ''
      && (x.country === undefined || x.country === 'FR'))
    .map((x) => ({
      id: x.id,
      name: cleanText(x.name),
      city: typeof x.city === 'string' && x.city.trim() !== '' ? cleanText(x.city) : null,
      updated: typeof x.updated === 'string' && Number.isFinite(Date.parse(x.updated)) ? x.updated : null,
      url: ixUrl(x.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  if (items.length === 0) throw new Error('aucun point d’échange en France');
  return items;
}

/**
 * Annuaire du jour ; ne lève jamais : panne nommée « PeeringDB : HTTP 503 » (cause après les deux-points).
 * @param {number} [now]
 */
export async function loadExchanges(now = Date.now()) {
  try {
    const exchanges = await cachedSource('sov:peeringdb:ix', { ttlSec: PEERINGDB_TTL_SEC, shared: true }, async () => ({
      readAt: new Date(now).toISOString(), items: parseIx(await fetchStrictJson(PEERINGDB_IX_URL, { timeoutMs: TIMEOUT_MS })),
    }));
    return { exchanges, errors: [] };
  } catch (err) {
    return { exchanges: null, errors: [sourceError('PeeringDB', err)] };
  }
}
