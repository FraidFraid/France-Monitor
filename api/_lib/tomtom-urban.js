// api/_lib/tomtom-urban.js : congestion urbaine par collecte serveur TomTom (spec 2026-10-03 panneaux trafic
// § 2.2, T4). Une seule collecte pour tous les visiteurs : 14 appels `incidentDetails` par cycle (Paris et
// Lyon en deux cadres, dix autres agglomérations en un), toutes les 15 min de 7 h à 21 h (heure de Paris),
// toutes les 30 min la nuit, soit environ 1 130 appels par jour (45 % des 2 500 gratuits ; la relève d'une minute rend la cadence
// effective de 14 min le jour et 29 min la nuit, mesurée par tests/tomtom-urban.test.ts). Seule la catégorie 6
// (embouteillage, magnitude 1 à 3) est demandée et gardée ; jamais la catégorie 8 (route fermée durable).
// Clé côté serveur ; budget du jour compté dans le stockage clé-valeur (kv-history), jamais par navigateur.
import { incrementCounter, kvGetJson, kvSetJson } from './kv-history.js';
import { parisDay, parisHour } from './paris-time.js';
import { fetchStrictJson, sourceError } from './source-http.js';

export const TOMTOM_INCIDENTS_URL = 'https://api.tomtom.com/traffic/services/5/incidentDetails';
export const DAILY_LIMIT = 2500;
/** Appels d'incidents autorisés par jour (le reste du palier gratuit : survol des tronçons et marge de panne). */
export const INCIDENT_BUDGET = 2200;
/** Appels de survol (`/api/traffic/flow`) autorisés par jour. */
export const FLOW_BUDGET = 250;
const LAST_KEY = 'traffic:tomtom:last';
const KEEP_SEC = 2 * 86_400;
const FRAME_CONCURRENCY = 4;
const MAX_PATH_POINTS = 30;
const MINUTE_MS = 60_000;

/** Ordre d'affichage des agglomérations. */
export const AGGLO_ORDER = ['Paris', 'Lyon', 'Marseille', 'Lille', 'Bordeaux', 'Toulouse', 'Nice', 'Strasbourg', 'Nantes', 'Rennes', 'Montpellier', 'Grenoble'];

/** Cadres interrogés (lon min, lat min, lon max, lat max) : 14 appels par cycle. */
export const URBAN_FRAMES = Object.freeze([
  { agglo: 'Paris', bbox: '2.05,48.70,2.35,49.00' },
  { agglo: 'Paris', bbox: '2.35,48.70,2.65,49.00' },
  { agglo: 'Lyon', bbox: '4.70,45.62,4.86,45.86' },
  { agglo: 'Lyon', bbox: '4.86,45.62,5.06,45.86' },
  { agglo: 'Marseille', bbox: '5.20,43.20,5.60,43.45' },
  { agglo: 'Lille', bbox: '2.85,50.52,3.25,50.75' },
  { agglo: 'Bordeaux', bbox: '-0.75,44.75,-0.45,44.95' },
  { agglo: 'Toulouse', bbox: '1.30,43.50,1.55,43.70' },
  { agglo: 'Nice', bbox: '7.10,43.62,7.35,43.78' },
  { agglo: 'Strasbourg', bbox: '7.60,48.48,7.85,48.65' },
  { agglo: 'Nantes', bbox: '-1.70,47.13,-1.42,47.30' },
  { agglo: 'Rennes', bbox: '-1.80,48.05,-1.55,48.17' },
  { agglo: 'Montpellier', bbox: '3.75,43.55,4.00,43.68' },
  { agglo: 'Grenoble', bbox: '5.65,45.10,5.85,45.25' },
]);

const FIELDS = '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,startTime,from,to,length,delay,roadNumbers}}}';

/** Clé TomTom côté serveur (une variable collée avec un saut de ligne casserait l'URL). */
export function tomtomKey() {
  return (process.env.VITE_TOMTOM_API_KEY || process.env.TOMTOM_API_KEY || '').replace(/\s+/g, '');
}

/** URL d'un cadre : embouteillages présents seulement (`categoryFilter=6`). */
export function incidentsUrl(bbox, key) {
  const params = new URLSearchParams({
    key, bbox, fields: FIELDS, language: 'fr-FR', timeValidityFilter: 'present', categoryFilter: '6',
  });
  return `${TOMTOM_INCIDENTS_URL}?${params.toString()}`;
}

/** Cadence : 15 min de 7 h à 21 h (heure de Paris), 30 min la nuit. */
export function urbanCadenceMs(now) {
  const h = parisHour(now);
  return (h >= 7 && h < 21 ? 15 : 30) * MINUTE_MS;
}

/** Collecte due : aucune tentative, ou dernière tentative plus vieille que la cadence (une minute de tolérance). */
export function isUrbanDue(lastAttemptAt, now) {
  const t = lastAttemptAt ? Date.parse(lastAttemptAt) : Number.NaN;
  return !Number.isFinite(t) || now - t >= urbanCadenceMs(now) - MINUTE_MS;
}

function round(v, digits) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Garde au plus 30 points d'un tracé (premier et dernier compris), coordonnées à 5 décimales. */
function thinPath(coords) {
  const step = Math.max(1, Math.ceil(coords.length / MAX_PATH_POINTS));
  const kept = coords.filter((_, i) => i % step === 0);
  if (kept.at(-1) !== coords.at(-1)) kept.push(coords.at(-1));
  return kept.map(([lon, lat]) => [round(lon, 5), round(lat, 5)]);
}

/** Bouchon (contrat UrbanJam) d'un incident TomTom ; null hors catégorie 6 ou hors magnitude 1 à 3. */
export function toUrbanJam(incident) {
  const p = incident?.properties ?? {};
  if (p.iconCategory !== 6 || ![1, 2, 3].includes(p.magnitudeOfDelay)) return null;
  const g = incident.geometry ?? {};
  const coords = g.type === 'Point' ? [g.coordinates] : Array.isArray(g.coordinates) ? g.coordinates : [];
  const valid = coords.filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));
  if (valid.length === 0) return null;
  return {
    road: Array.isArray(p.roadNumbers) && p.roadNumbers.length > 0 ? String(p.roadNumbers[0]) : null,
    from: p.from ? String(p.from) : null,
    to: p.to ? String(p.to) : null,
    lengthKm: round((Number(p.length) || 0) / 1000, 1),
    delayMin: Math.round((Number(p.delay) || 0) / 60),
    magnitude: p.magnitudeOfDelay,
    start: typeof p.startTime === 'string' ? p.startTime : null,
    lat: round(valid[0][1], 5),
    lon: round(valid[0][0], 5),
    path: thinPath(valid),
  };
}

/** Agrégats d'une agglomération (contrat UrbanAgglo). */
export function aggregateAgglo(name, jams, collectedAt) {
  let longest = null;
  for (const j of jams) if (!longest || j.lengthKm > longest.lengthKm) longest = j;
  return {
    name,
    jams: jams.length,
    jamKm: round(jams.reduce((s, j) => s + j.lengthKm, 0), 1),
    delayMin: jams.reduce((s, j) => s + j.delayMin, 0),
    longest,
    collectedAt,
  };
}

function incidentsKey(now) {
  return `traffic:tomtom:incidents:${parisDay(now)}`;
}

function flowKey(now) {
  return `traffic:tomtom:flow:${parisDay(now)}`;
}

/** Appels TomTom du jour (heure de Paris) : incidents et survol. */
export async function readQuota(now = Date.now()) {
  const incidents = Number(await kvGetJson(incidentsKey(now), now)) || 0;
  const flow = Number(await kvGetJson(flowKey(now), now)) || 0;
  return { callsToday: incidents + flow, limit: DAILY_LIMIT };
}

let flowQueue = Promise.resolve();

/**
 * Réserve un appel de survol si le budget du jour le permet. Les réservations sont sérialisées : le compteur
 * est une lecture puis écriture, deux survols simultanés ne doivent pas perdre une mise à jour.
 */
export function reserveFlowCall(now = Date.now()) {
  const turn = flowQueue.then(async () => {
    const used = Number(await kvGetJson(flowKey(now), now)) || 0;
    if (used >= FLOW_BUDGET) return false;
    await incrementCounter(flowKey(now), 1, KEEP_SEC, now);
    return true;
  });
  flowQueue = turn.then(() => undefined, () => undefined);
  return turn;
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

async function withQuota(stored, errors, now) {
  return {
    collectedAt: stored?.collectedAt ?? null,
    agglos: stored?.agglos ?? [],
    jams: stored?.jams ?? [],
    quota: await readQuota(now),
    errors,
  };
}

async function remember(stored, attemptedAt, errors, now) {
  await kvSetJson(LAST_KEY, { ...stored, attemptedAt, errors }, KEEP_SEC, now);
}

/**
 * Un cycle de collecte. Une agglomération dont un cadre échoue est retirée (jamais de chiffre partiel) et
 * nommée dans `errors` ; si tous les cadres échouent, la dernière collecte réussie reste servie (avec sa date).
 */
export async function collectUrban(now = Date.now()) {
  const last = await kvGetJson(LAST_KEY, now);
  const attemptedAt = new Date(now).toISOString();
  const previous = last ? { collectedAt: last.collectedAt ?? null, agglos: last.agglos ?? [], jams: last.jams ?? [] } : { collectedAt: null, agglos: [], jams: [] };
  const key = tomtomKey();
  if (!key) {
    const errors = ['TomTom : clé absente (TOMTOM_API_KEY)'];
    await remember(previous, attemptedAt, errors, now);
    return withQuota(previous, errors, now);
  }
  const used = Number(await kvGetJson(incidentsKey(now), now)) || 0;
  if (used + URBAN_FRAMES.length > INCIDENT_BUDGET) {
    const errors = [`TomTom : budget du jour atteint (${INCIDENT_BUDGET} appels d’incidents)`];
    await remember(previous, attemptedAt, errors, now);
    return withQuota(previous, errors, now);
  }
  await incrementCounter(incidentsKey(now), URBAN_FRAMES.length, KEEP_SEC, now);
  const results = await mapLimit(URBAN_FRAMES, FRAME_CONCURRENCY, (f) => fetchStrictJson(incidentsUrl(f.bbox, key), { timeoutMs: 15_000 }));
  const failed = new Map();
  const byAgglo = new Map();
  results.forEach((r, i) => {
    const { agglo } = URBAN_FRAMES[i];
    if (!r.ok) {
      if (!failed.has(agglo)) failed.set(agglo, sourceError(`TomTom, ${agglo}`, r.error));
      return;
    }
    const seen = byAgglo.get(agglo) ?? new Map();
    for (const incident of Array.isArray(r.value?.incidents) ? r.value.incidents : []) {
      const jam = toUrbanJam(incident);
      const id = String(incident?.properties?.id ?? `${agglo}-${seen.size}`);
      if (jam && !seen.has(id)) seen.set(id, jam);
    }
    byAgglo.set(agglo, seen);
  });
  const errors = [...failed.values()];
  if (failed.size === new Set(URBAN_FRAMES.map((f) => f.agglo)).size) {
    await remember(previous, attemptedAt, errors, now);
    return withQuota(previous, errors, now);
  }
  const agglos = AGGLO_ORDER.filter((name) => byAgglo.has(name) && !failed.has(name))
    .map((name) => aggregateAgglo(name, [...byAgglo.get(name).values()], attemptedAt));
  const jams = agglos.flatMap((a) => [...byAgglo.get(a.name).values()]).sort((a, b) => b.delayMin - a.delayMin);
  const stored = { collectedAt: attemptedAt, agglos, jams };
  await remember(stored, attemptedAt, errors, now);
  return withQuota(stored, errors, now);
}

let queue = Promise.resolve();

/**
 * Dernière collecte, après un nouveau cycle s'il est dû (appelé par la route et par la relève serveur
 * toutes les minutes). Les appels sont mis en file : le marqueur du dernier cycle est relu à son tour de
 * passage, donc deux déclenchements simultanés ne lancent jamais deux cycles.
 */
export function ensureUrbanFresh(now = Date.now()) {
  const turn = queue.then(async () => {
    const last = await kvGetJson(LAST_KEY, now);
    if (last && !isUrbanDue(last.attemptedAt ?? null, now)) return withQuota(last, Array.isArray(last.errors) ? last.errors : [], now);
    return collectUrban(now);
  });
  queue = turn.then(() => undefined, () => undefined);
  return turn;
}
