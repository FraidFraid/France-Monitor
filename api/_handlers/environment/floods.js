// api/_handlers/environment/floods.js : vigilance crues par tronçon et stations des tronçons en vigilance (spec 2026-10-04
// environnement § 2.2). InfoVigiCru (relevé du serveur, 10 min), territoires et stations (24 h), Hub'Eau (10 min), sans
// clé. InfoVigiCru jamais lu : 502 non mis en cache ; une partie en panne : erreur nommée, cache CDN court.
import { loadFloods } from '../../_lib/vigicrues.js';
import { handlePreflight, sendSourceJson, sourceError } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=600';
/** Réponse « lecture en cours » : les hauteurs seront dans le cache serveur à la relève suivante, d'où un cache CDN de 30 s. */
export const PENDING_CACHE_CONTROL = 's-maxage=30, stale-while-revalidate=60';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  let body;
  try {
    body = await loadFloods(Date.now());
  } catch (err) {
    // Exception hors des sources : 502 nommé avec un corps FloodsResponse, jamais un 500 générique.
    body = {
      readAt: null, total: 0, counts: { vert: 0, jaune: 0, orange: 0, rouge: 0 }, sections: [],
      stationsReadAt: null, stationsOmitted: 0, errors: [sourceError('Crues, erreur inattendue', err)],
    };
  }
  const pending = body.errors.some((e) => e.includes('lecture en cours'));
  sendSourceJson(res, body, { ok: body.readAt !== null, cacheControl: pending ? PENDING_CACHE_CONTROL : CACHE_CONTROL });
}
