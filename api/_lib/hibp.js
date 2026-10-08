// api/_lib/hibp.js : fuites de données publiées (Have I Been Pwned, liste publique des fuites, sans clé, CC BY 4.0 ; spec 2026-10-04
// souveraineté § 2.3 ; contrats § 2.4, arbitrage 16, règle O5 de l'amendement 7). HIBP ne publie pas de pays : une fuite est comptée
// si son domaine se termine par « .fr » et qu'elle a été ajoutée depuis moins de 30 jours (critère dit dans « Méthode »), ni
// fabriquée, ni liste de spam, ni retirée. Opération REACTIV de l'ANSSI : ne pas amplifier une fuite. La réponse ne porte donc
// qu'un compte, la date d'ajout la plus récente et un lien vers HIBP : ni titre, ni domaine, ni nom de fuite, ni description.
import { cachedSource, fetchStrictJson } from './source-http.js';

export const HIBP_BREACHES_URL = 'https://haveibeenpwned.com/api/v3/breaches';
export const HIBP_PUBLIC_URL = 'https://haveibeenpwned.com/PwnedWebsites';
export const HIBP_TTL_SEC = 6 * 3_600;
export const HIBP_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * Résumé des fuites en « .fr » ajoutées depuis moins de 30 jours à l'instant `now` : `{ count, newestAddedDate, url }`
 * (`newestAddedDate` telle que publiée, null sans fuite). Lève si la réponse n'est pas une liste.
 * @param {unknown} json
 * @param {number} now
 */
export function frenchRecentBreaches(json, now) {
  if (!Array.isArray(json)) throw new Error('liste des fuites illisible');
  let count = 0;
  let newest = null;
  for (const b of json) {
    if (!b || typeof b !== 'object' || typeof b.Domain !== 'string') continue;
    if (!b.Domain.trim().toLowerCase().endsWith('.fr') || b.IsFabricated === true || b.IsSpamList === true || b.IsRetired === true) continue;
    const added = Date.parse(b.AddedDate);
    if (!Number.isFinite(added) || now - added >= HIBP_WINDOW_DAYS * DAY_MS) continue;
    count += 1;
    if (!newest || added > Date.parse(newest)) newest = b.AddedDate;
  }
  return { count, newestAddedDate: newest, url: HIBP_PUBLIC_URL };
}

/**
 * Résumé retenu (`{ readAt, count, newestAddedDate, url }`), relu toutes les 6 h, gardé en mémoire du processus ; lève si la liste
 * n'a jamais été lue.
 * @param {number} now
 */
export function loadHibp(now) {
  return cachedSource('sov:hibp', { ttlSec: HIBP_TTL_SEC, staleSec: 7 * 86_400, shared: false }, async () => ({
    readAt: new Date(now).toISOString(),
    ...frenchRecentBreaches(await fetchStrictJson(HIBP_BREACHES_URL, { timeoutMs: 20_000 }), now),
  }));
}
