// api/_lib/hubeau-stations.js : hauteurs et débits des stations des tronçons en vigilance (spec 2026-10-04
// environnement § 2.2), lus dans Hub'Eau hydrométrie `observations_tr` (sans clé, licence Etalab). Toujours
// par `code_entite`, jamais par département : le filtre `code_departement` n'est pas appliqué par Hub'Eau
// (fixture hubeau-observations-tr-66.json : toute la base, Guadeloupe comprise). H en mm, Q en L/s.
// Séries : un point par quart d'heure au plus, la vraie mesure (aucune interpolation : un trou reste un trou).
import { fetchStrictJson } from './source-http.js';

export const HUBEAU_OBSERVATIONS_URL = 'https://hubeau.eaufrance.fr/api/v2/hydrometrie/observations_tr';
/** Fenêtre lue : 48 h. */
export const WINDOW_MS = 48 * 3_600_000;
/** Codes par requête : 20 stations × 576 mesures (48 h à 5 min) tiennent dans une page de 20 000. */
export const CODES_PER_REQUEST = 20;
/** Pages suivies au plus (HTTP 206 et `next`). */
export const MAX_PAGES = 5;
const PAGE_SIZE = 20_000;
/** Délai d'une page : Hub'Eau répond en 10 à 40 s pour 20 stations sur 48 h (mesuré le 04/10/2026). */
const FETCH_TIMEOUT_MS = 60_000;
const FIELDS = 'code_station,date_obs,resultat_obs,longitude,latitude';
const QUARTER_MS = 15 * 60_000;
const HOUR_MS = 3_600_000;
const CHANGE_TOLERANCE_MS = 10 * 60_000;
const STATION_CODE = /^[A-Z0-9]{10}$/;
const HUBEAU_HOST = 'hubeau.eaufrance.fr';

/** Code de station Hub'Eau lisible (10 caractères) ; tout autre code n'entre jamais dans une adresse. */
function isStationCode(code) {
  return typeof code === 'string' && STATION_CODE.test(code);
}

/** Début de fenêtre au format Hub'Eau (« 2026-10-02T08:10:00Z », sans millisecondes). */
export function sinceIso(now) {
  return `${new Date(now - WINDOW_MS).toISOString().slice(0, 19)}Z`;
}

/**
 * URL d'une lecture Hub'Eau pour des codes de station (10 caractères) et une grandeur (H ou Q).
 * @param {readonly string[]} codes
 * @param {'H' | 'Q'} grandeur
 * @param {string} since ISO UTC
 */
export function observationsUrl(codes, grandeur, since) {
  const safe = codes.filter(isStationCode);
  return `${HUBEAU_OBSERVATIONS_URL}?code_entite=${safe.join(',')}&grandeur_hydro=${grandeur}&date_debut_obs=${since}`
    + `&size=${PAGE_SIZE}&sort=desc&fields=${FIELDS}`;
}

/**
 * @typedef {{ code_station: string, date_obs: string, resultat_obs: number, longitude: number | null, latitude: number | null }} HubeauObservation
 */

/** Observations lisibles d'une page Hub'Eau ; lève si la réponse n'a pas la forme attendue. */
export function parseObservationsPage(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.data)) throw new Error("réponse Hub'Eau sans liste « data »");
  /** @type {HubeauObservation[]} */
  const out = [];
  for (const o of json.data) {
    if (!o || typeof o.code_station !== 'string' || typeof o.date_obs !== 'string') continue;
    if (typeof o.resultat_obs !== 'number' || !Number.isFinite(o.resultat_obs) || !Number.isFinite(Date.parse(o.date_obs))) continue;
    out.push({
      code_station: o.code_station,
      date_obs: o.date_obs,
      resultat_obs: o.resultat_obs,
      longitude: typeof o.longitude === 'number' && Number.isFinite(o.longitude) ? o.longitude : null,
      latitude: typeof o.latitude === 'number' && Number.isFinite(o.latitude) ? o.latitude : null,
    });
  }
  return { observations: out, next: typeof json.next === 'string' && json.next.length > 0 ? json.next : null };
}

/**
 * Toutes les pages d'une lecture (HTTP 206 : page partielle, `next` suivi, MAX_PAGES au plus). Seules les stations
 * demandées sont gardées : Hub'Eau peut renvoyer d'autres stations quand un filtre n'est pas appliqué.
 * @param {readonly string[]} codes
 * @param {'H' | 'Q'} grandeur
 * @param {number} now
 * @returns {Promise<{ observations: HubeauObservation[], truncated: boolean }>}
 */
export async function fetchObservations(codes, grandeur, now) {
  const wanted = new Set(codes);
  /** @type {HubeauObservation[]} */
  const observations = [];
  // Aucun code lisible : un `code_entite` vide ferait lire toute la base Hub'Eau. Aucune lecture.
  if (!codes.some(isStationCode)) return { observations, truncated: false };
  let url = observationsUrl(codes, grandeur, sinceIso(now));
  for (let page = 0; page < MAX_PAGES && url; page += 1) {
    const { observations: rows, next } = parseObservationsPage(await fetchStrictJson(url, { timeoutMs: FETCH_TIMEOUT_MS }));
    for (const o of rows) if (wanted.has(o.code_station)) observations.push(o);
    url = next === null ? null : trustedNext(next);
  }
  return { observations, truncated: url !== null };
}

/** `next` n'est suivi que s'il reste sur hubeau.eaufrance.fr en https ; sinon la lecture échoue, nommée. */
function trustedNext(next) {
  let parsed;
  try {
    parsed = new URL(next);
  } catch {
    throw new Error("réponse Hub'Eau avec une page suivante illisible");
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== HUBEAU_HOST) throw new Error(`réponse Hub'Eau avec une page suivante hors de ${HUBEAU_HOST}`);
  return next;
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

/**
 * Série d'une station : un point par quart d'heure au plus, la première mesure du quart (l'heure ronde du quart ou juste
 * après), valeur convertie (`scale` : mm vers m, L/s vers m³/s), dans la fenêtre de 48 h ; jamais d'interpolation.
 * @param {readonly HubeauObservation[]} obs mesures d'une station
 * @param {number} now
 * @param {number} scale diviseur (1000)
 * @returns {Array<{ at: string, value: number }>}
 */
export function quarterSeries(obs, now, scale) {
  const from = now - WINDOW_MS;
  const sorted = [...obs].sort((a, b) => Date.parse(a.date_obs) - Date.parse(b.date_obs));
  /** @type {Array<{ at: string, value: number }>} */
  const out = [];
  let lastQuarter = Number.NaN;
  for (const o of sorted) {
    const t = Date.parse(o.date_obs);
    if (t < from || t > now) continue;
    const quarter = Math.floor(t / QUARTER_MS);
    if (quarter === lastQuarter) continue;
    lastQuarter = quarter;
    out.push({ at: o.date_obs, value: round3(o.resultat_obs / scale) });
  }
  return out;
}

/**
 * Stations d'un tronçon avec leur dernière mesure, la variation sur 1 h (mesure la plus proche d'une heure avant la
 * dernière, à 10 min près ; sinon null) et les séries de 48 h. Ordre du référentiel conservé.
 * @param {ReadonlyArray<{ code: string, name: string }>} refs
 * @param {readonly HubeauObservation[]} hObs
 * @param {readonly HubeauObservation[]} qObs
 * @param {number} now
 */
export function buildStations(refs, hObs, qObs, now) {
  const byStation = (list) => {
    const map = new Map();
    for (const o of list) {
      const t = Date.parse(o.date_obs);
      if (t > now) continue;
      const arr = map.get(o.code_station) ?? [];
      arr.push(o);
      map.set(o.code_station, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => Date.parse(a.date_obs) - Date.parse(b.date_obs));
    return map;
  };
  const heights = byStation(hObs);
  const flows = byStation(qObs);
  return refs.map(({ code, name }) => {
    const h = heights.get(code) ?? [];
    const q = flows.get(code) ?? [];
    const last = h.at(-1) ?? null;
    const lastQ = q.at(-1) ?? null;
    const located = last ?? lastQ;
    let change1hM = null;
    if (last) {
      const target = Date.parse(last.date_obs) - HOUR_MS;
      let best = null;
      for (const o of h) {
        const d = Math.abs(Date.parse(o.date_obs) - target);
        if (d <= CHANGE_TOLERANCE_MS && (best === null || d < best.d)) best = { o, d };
      }
      if (best) change1hM = round3((last.resultat_obs - best.o.resultat_obs) / 1000);
    }
    return {
      code,
      name,
      lat: located?.latitude ?? null,
      lon: located?.longitude ?? null,
      lastAt: last ? last.date_obs : null,
      flowAt: lastQ ? lastQ.date_obs : null,
      heightM: last ? round3(last.resultat_obs / 1000) : null,
      flowM3s: lastQ ? round3(lastQ.resultat_obs / 1000) : null,
      change1hM,
      heightSeries: quarterSeries(h, now, 1000),
      flowSeries: quarterSeries(q, now, 1000),
    };
  });
}

/** Empreinte courte et stable d'une liste de codes (clé de cache). */
export function codesFingerprint(codes) {
  let hash = 0x811c9dc5;
  for (const ch of [...codes].sort().join(',')) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${codes.length}-${hash.toString(16).padStart(8, '0')}`;
}
