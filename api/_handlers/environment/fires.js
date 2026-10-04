// api/_handlers/environment/fires.js : feux de forêt (spec 2026-10-04 environnement § 2.4). Dernière collecte FIRMS du
// serveur (cycle lancé s'il est dû, api/_lib/fires-collect.js) et météo des forêts (api/_lib/forest-danger.js), chacune avec
// sa propre date. 200 si une collecte FIRMS existe (même ancienne) ou si la météo des forêts est lue ; 502 sinon. Une réponse
// où rien n'a répondu (502, ou dernière collecte servie après un essai FIRMS sans aucune source lue et météo des forêts en
// panne) n'est jamais mise en cache : l'ancienne route gardait même ses pannes 1 h derrière le CDN.
import { emptyFiresBody, ensureFiresFresh, isFiresDue } from '../../_lib/fires-collect.js';
import { loadForestDanger } from '../../_lib/forest-danger.js';
import { handlePreflight, sendSourceJson, sourceError } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=900';

/** Réponse complète (FiresResponse) à l'instant `now` ; ne lève jamais. */
export async function loadFires(now = Date.now()) {
  const [firms, mdf] = await Promise.all([
    ensureFiresFresh(now).catch((err) => emptyFiresBody([sourceError('FIRMS', err)])),
    loadForestDanger(now),
  ]);
  return { ...firms, forestDanger: mdf.forestDanger, errors: [...firms.errors, ...mdf.errors] };
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const now = Date.now();
  const body = await loadFires(now);
  const ok = body.readAt !== null || body.forestDanger !== null;
  // Collecte de plus de 14 min : le cycle dû vient d'être tenté sans qu'aucune source FIRMS réponde (isFiresDue).
  const answered = body.forestDanger !== null || !isFiresDue(body.readAt, now);
  if (ok && !answered) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(body);
    return;
  }
  sendSourceJson(res, body, { ok, cacheControl: CACHE_CONTROL });
}
