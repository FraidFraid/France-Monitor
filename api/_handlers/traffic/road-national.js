// api/_handlers/traffic/road-national.js : réseau routier national (spec 2026-10-03 panneaux trafic § 2.1).
// Événements des DIR (DATEX II, instantané horaire et journal appliqué) classés en événements en cours,
// fermetures et chantiers de longue durée (T2), comptes et incidents par DIR. Cache 5 min.
// Vitesses, agglomérations, sections Traficolor et autoroutes concédées : tâche 4. Sans publication DIR : 502 non mis en cache.
import { buildRoadNational, loadDirSituations } from '../../_lib/datex-dir.js';
import { cachedSource, handlePreflight, sendSourceJson, sourceError } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=600';
const TTL_SEC = 300;

/** Réponse complète (RoadNationalResponse) à l'instant `now`. */
export async function loadRoadNational(now = Date.now()) {
  const errors = [];
  let dir = null;
  try {
    dir = await cachedSource('traffic:dir', { ttlSec: TTL_SEC, staleSec: 3600, shared: false }, () => loadDirSituations(now));
    errors.push(...dir.errors);
  } catch (err) {
    errors.push(sourceError('DIR', err));
  }
  const national = dir
    ? buildRoadNational(dir.situations, now)
    : { events: [], longTerm: [], counts: { incidents: 0, accidents: 0, closures: 0, obstructions: 0, weather: 0, works: 0 }, byDir: [] };
  return {
    publishedAt: dir?.publishedAt ?? null,
    ...national,
    speeds: { at: null, stations: 0, under50: 0, median: null, slowest: [] },
    agglos: [],
    sections: [],
    conceded: { at: null, jams: [] },
    errors,
  };
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadRoadNational(Date.now());
  sendSourceJson(res, body, { ok: body.publishedAt !== null, cacheControl: CACHE_CONTROL });
}
