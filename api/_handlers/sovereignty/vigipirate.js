// api/_handlers/sovereignty/vigipirate.js : relecture de la page Vigipirate du SGDSN (amendement 7, O14 ; arbitrage du contrôleur). Le
// serveur relit https://www.sgdsn.gouv.fr/vigipirate une fois par jour et sert VigipiratePageCheck : date de la dernière lecture
// réussie, empreinte du texte utile, date de la lecture où l'empreinte a changé, erreurs nommées. Jamais le texte de la page. La
// saisie datée (src/config/vigipirate.ts) affiche « niveau à revérifier sur sgdsn.gouv.fr (page modifiée le JJ/MM) » quand la page a
// changé après le jour de la saisie. 200 dès qu'une lecture a réussi (une panne ultérieure est nommée, la dernière lecture servie
// avec sa date) ; 502 sinon, jamais mis en cache.
import { ensureVigipirateFresh } from '../../_lib/vigipirate-page.js';
import { handlePreflight, sendSourceJson } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=3600, stale-while-revalidate=7200';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await ensureVigipirateFresh(Date.now());
  sendSourceJson(res, body, { ok: body.readAt !== null, cacheControl: CACHE_CONTROL });
}
