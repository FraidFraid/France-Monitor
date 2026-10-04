// api/_handlers/environment/floods.js : vigilance crues par tronçon et stations des tronçons en vigilance (spec 2026-10-04
// environnement § 2.2). InfoVigiCru (relevé du serveur, 10 min), territoires et stations (24 h), Hub'Eau (10 min), sans
// clé. InfoVigiCru jamais lu : 502 non mis en cache ; une partie en panne : erreur nommée, cache CDN court.
import { loadFloods } from '../../_lib/vigicrues.js';
import { handlePreflight, sendSourceJson } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=600';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadFloods(Date.now());
  sendSourceJson(res, body, { ok: body.readAt !== null, cacheControl: CACHE_CONTROL });
}
