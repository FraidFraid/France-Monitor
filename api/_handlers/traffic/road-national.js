// api/_handlers/traffic/road-national.js : réseau routier national (spec 2026-10-03 panneaux trafic § 2.1).
// Événements des DIR (DATEX II, instantané horaire et journal appliqué) classés en événements en cours,
// fermetures et chantiers de longue durée (T2), comptes et incidents par DIR ; vitesses mesurées (QTV),
// niveaux officiels par agglomération (Traficolor) et bouchons des autoroutes concédées (CNIR). Cache 5 min.
// Une source en panne n'empêche jamais les autres ; aucune source exploitable : 502 non mis en cache.
import { buildRoadNational, loadDirSituations } from '../../_lib/datex-dir.js';
import { buildSections, loadConceded, loadRefDir, loadSpeeds, loadTraficolorFile, loadTraficolorNetworks } from '../../_lib/dir-measures.js';
import { cachedSource, handlePreflight, sendSourceJson, sourceError } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=600';
const TTL_SEC = 300;
const NETWORK_CONCURRENCY = 4;
const EMPTY_SPEEDS = { at: null, stations: 0, under50: 0, median: null, slowest: [] };
const EMPTY_NATIONAL = { events: [], longTerm: [], counts: { incidents: 0, accidents: 0, closures: 0, obstructions: 0, weather: 0, works: 0 }, byDir: [] };

/** Cache mémoire du processus (cadences courtes : pas d'écriture Redis toutes les 5 min). */
function memo(key, ttlSec, producer) {
  return cachedSource(key, { ttlSec, staleSec: 3600, shared: false }, producer);
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      results[i] = await fn(items[i]).then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
    }
  }));
  return results;
}

async function loadAgglos(errors, readRef) {
  let networks;
  try {
    networks = await memo('traffic:traficolor:networks', 3600, loadTraficolorNetworks);
  } catch (err) {
    errors.push(sourceError('Traficolor', err));
    return { agglos: [], sections: [] };
  }
  const results = await mapLimit(networks, NETWORK_CONCURRENCY, (n) => memo(`traffic:traficolor:${n}`, TTL_SEC, () => loadTraficolorFile(n)));
  // Référentiel indisponible : pas de sections sur la carte (l'erreur est déjà nommée par la partie QTV).
  const paths = await readRef().then((r) => r.paths, () => new Map());
  const agglos = [];
  const sections = [];
  results.forEach((r, i) => {
    if (r.ok) {
      agglos.push(r.value.summary);
      sections.push(...buildSections(networks[i], r.value.parsed, paths));
    } else errors.push(sourceError(`Traficolor, ${networks[i]}`, r.error));
  });
  agglos.sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  return { agglos, sections };
}

/** Réponse complète (RoadNationalResponse) à l'instant `now`. */
export async function loadRoadNational(now = Date.now()) {
  const errors = [];
  const readRef = () => memo('traffic:refdir', 86_400, loadRefDir);
  const [dir, speeds, traficolor, conceded] = await Promise.all([
    memo('traffic:dir', TTL_SEC, () => loadDirSituations(now)).catch((err) => { errors.push(sourceError('DIR', err)); return null; }),
    memo('traffic:qtv', TTL_SEC, () => loadSpeeds(readRef)).catch((err) => { errors.push(sourceError('QTV', err)); return null; }),
    loadAgglos(errors, readRef),
    memo('traffic:cnir', TTL_SEC, loadConceded).catch((err) => { errors.push(sourceError('CNIR', err)); return null; }),
  ]);
  if (dir) errors.push(...dir.errors);
  return {
    publishedAt: dir?.publishedAt ?? null,
    ...(dir ? buildRoadNational(dir.situations, now) : EMPTY_NATIONAL),
    speeds: speeds ?? EMPTY_SPEEDS,
    agglos: traficolor.agglos,
    sections: traficolor.sections,
    conceded: conceded ?? { at: null, jams: [] },
    errors: errors.sort(),
  };
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadRoadNational(Date.now());
  const ok = body.publishedAt !== null || body.speeds.at !== null || body.agglos.length > 0 || body.conceded.at !== null;
  sendSourceJson(res, body, { ok, cacheControl: CACHE_CONTROL });
}
