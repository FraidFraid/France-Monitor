// api/_handlers/fires/impacts.js : communes à moins de 10 km d'un foyer (spec 2026-10-04 environnement § 2.4). GET ?lat=&lon= ;
// 400 hors métropole ou coordonnées illisibles ; 200 avec cache CDN d'un jour (communes stables) ; 502 non mis en cache si
// aucun département voisin n'a pu être lu. Aucune estimation de maisons ni d'évacués (api/_lib/fire-impacts.js).
import { isMetropoleBox, loadFireImpacts } from '../../_lib/fire-impacts.js';
import { handlePreflight, sendSourceJson } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=86400, stale-while-revalidate=604800';

/** Premier paramètre d'une requête (chaîne ou tableau), en nombre ; NaN s'il est absent ou vide. */
function numberParam(value) {
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === 'string' && text.trim() !== '' ? Number(text) : Number.NaN;
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const lat = numberParam(req.query?.lat);
  const lon = numberParam(req.query?.lon);
  if (!isMetropoleBox(lat, lon)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ error: 'lat/lon invalides ou hors métropole' });
    return;
  }
  const { body, ok } = await loadFireImpacts(lat, lon, Date.now());
  sendSourceJson(res, body, { ok, cacheControl: CACHE_CONTROL });
}
