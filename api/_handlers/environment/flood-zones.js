// api/_handlers/environment/flood-zones.js : zones inondables officielles (TRI, Géorisques) d'une boîte. GET /api/environment/flood-zones?bbox=
// minLon,minLat,maxLon,maxLat (ordre CRS84) [&scenarios=frequent,moyen : scénarios lus, tous par défaut]. 400 si la boîte est invalide ; 200 si un scénario a été lu (vide hors TRI : normal, `covered`
// false) ; 502 non mis en cache sinon, erreurs nommées. Cartographie statique : cache CDN long.
import { emptyFloodZones, loadFloodZones, parseBbox, parseScenarios, roundBbox } from '../../_lib/flood-zones.js';
import { handlePreflight, sendSourceJson, sourceError } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=86400, stale-while-revalidate=604800';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const parsed = parseBbox(req.query?.bbox);
  const scenarios = parseScenarios(req.query?.scenarios);
  if (!parsed.ok || !scenarios.ok) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ error: parsed.ok ? (scenarios.ok ? '' : scenarios.error) : parsed.error });
    return;
  }
  try {
    const body = await loadFloodZones(parsed.bbox, Date.now(), scenarios.scenarios);
    sendSourceJson(res, body, { ok: body.readAt !== null, cacheControl: CACHE_CONTROL });
  } catch (err) {
    console.error('[environment/flood-zones]', err);
    sendSourceJson(res, emptyFloodZones(roundBbox(parsed.bbox), [sourceError('Géorisques, zones inondables', err)]), { ok: false, cacheControl: CACHE_CONTROL });
  }
}
