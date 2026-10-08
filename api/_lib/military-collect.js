// api/_lib/military-collect.js : collecte serveur des aéronefs militaires (spec 2026-10-04 souveraineté § 2.1, V1, V2 ; contrats
// § 2.2). Une lecture adsb.lol /v2/mil toutes les 2 min (5 min sur le serveur de dev), par la file unique d'api/_lib/adsb-lol.js ;
// le drapeau militaire est celui de la source (base communautaire adsb.lol, arbitrage 23). Périmètre V2 : un aéronef est compté
// s'il est au-dessus d'un département ou à moins de 22 km de la côte en mer française ; le reste de la zone d'affichage est « hors de
// France », dessiné en gris, jamais compté. Pays par bloc OACI (api/_lib/icao-country.js), jamais une hypothèse « France ».
// Décision de l'utilisateur du 08/10/2026 (remplace la règle O10) : plus aucun masquage. Tout appareil est servi avec son identité
// publiée par adsb.lol (adresse, indicatif, immatriculation `r`, type, position), appareils du bloc France, PIA, LADD et adresses non
// OACI compris ; les appareils français restent aussi comptés par département (résumé).
// Urgences (7500, 7600, 7700 et champ `emergency`) : règle T3 du Trafic aérien (journal de 7 jours, confirmée sur deux lectures).
// Historique horaire de 7 jours dans le stockage clé-valeur : des comptes seulement (aéronefs distincts par heure UTC et par
// famille), les adresses de l'heure en cours restant en mémoire du processus ; la collecte elle-même vit en mémoire et reste servie
// 2 h au plus avec sa date (S1).
import { APPROACH_KM, EMERGENCY_SQUAWKS, ZONE_BOUNDS, recordEmergencies } from '../_shared/air-traffic.js';
import { adsbLolGet } from './adsb-lol.js';
import { departementAt } from './geo-fr.js';
import { aircraftFamily, icaoCountry } from './icao-country.js';
import { isDevServer, kvSetJson, readLog } from './kv-history.js';
import { sourceError } from './source-http.js';
import { inFranceV2, nearFrance } from './territory.js';

export const MIL_INTERVAL_MS = 2 * 60_000;
/** Serveur de dev : autre adresse IP que la VM, même prudence (cadence du Trafic aérien en dev). */
export const DEV_MIL_INTERVAL_MS = 5 * 60_000;
export const MIL_HOURLY_KEY = 'sov:mil:hourly';
export const MIL_EMERGENCY_KEY = 'sov:mil:emergencies';
/** Zone d'affichage : celle du Trafic aérien (déborde sur les voisins) ; hors de cette zone, rien n'est dessiné ni compté. */
export const DISPLAY_BOUNDS = ZONE_BOUNDS;
/** Position plus vieille que 120 s : écartée. */
export const MAX_POSITION_AGE_SEC = 120;
/** Collecte servie au plus 2 h après sa lecture ; au-delà, 502 et panne nommée. */
export const MIL_SERVE_MAX_MS = 2 * 3_600_000;
/** Échéance de la route atteinte pendant une collecte (file adsb.lol occupée) : collecte précédente servie avec cette note. */
export const MIL_PENDING_NOTE = 'adsb.lol : collecte en cours';
export const MIL_TOO_OLD_ERROR = 'adsb.lol : dernière collecte de plus de 2 h';
const KEEP_MS = 7 * 86_400_000;
/** Une relève d'une minute peut arriver quelques millisecondes avant l'échéance : tolérance de 5 s. */
const TICK_TOLERANCE_MS = 5_000;
const FEET_TO_M = 0.3048;

/** Champ `emergency` d'adsb.lol ramené à un code transpondeur (arbitrage 6). */
const EMERGENCY_TO_SQUAWK = { unlawful: '7500', nordo: '7600', general: '7700', minfuel: '7700', lifeguard: '7700', downed: '7700' };

/**
 * Collecte en mémoire : `{ readAt, sourceNow, attemptedAt, frenchByDept, aircraft, abroadCount, abroad, current, errors }`
 * (`current` : urgences de la lecture, au format du journal, adresse comprise).
 */
let collection = null;
let inflight = null;
/**
 * Adresses vues au-dessus de la France pendant l'heure UTC en cours, par famille : `{ hour, francais: Set, autres: Set }`. Mémoire
 * du processus seulement (dédoublonnage des lectures de l'heure) ; le stockage clé-valeur ne garde que des comptes.
 */
let hourSeen = null;

/** Réservé aux tests : aucune collecte en mémoire (simule un redémarrage du processus ; le stockage clé-valeur reste). */
export function __resetMilitaryForTests() {
  collection = null;
  inflight = null;
  hourSeen = null;
}

function intervalMs() {
  return isDevServer() ? DEV_MIL_INTERVAL_MS : MIL_INTERVAL_MS;
}

function inDisplay(lat, lon) {
  const b = DISPLAY_BOUNDS;
  return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
}

function text(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Âge de la position (s) : `seen_pos`, sinon `seen`, sinon 0. */
function positionAge(ac) {
  const age = num(ac.seen_pos) ?? num(ac.seen);
  return age ?? 0;
}

/** Position lisible, en vol, récente, dans la zone d'affichage ; null sinon. */
function usablePosition(ac) {
  if (!ac || typeof ac !== 'object' || ac.alt_baro === 'ground') return null;
  const lat = num(ac.lat);
  const lon = num(ac.lon);
  if (lat === null || lon === null || positionAge(ac) > MAX_POSITION_AGE_SEC || !inDisplay(lat, lon)) return null;
  const hex = String(ac.hex ?? '').trim().toLowerCase();
  return hex ? { hex, lat, lon } : null;
}

/**
 * Aéronef de /v2/mil normalisé (MilitaryAircraft), ou null : sans position, au sol (« ground »), position de plus de 120 s, hors de la
 * zone d'affichage. `nowMs` : `now` d'adsb.lol (instant de la position = now moins seen_pos).
 * @param {Record<string, unknown>} ac
 * @param {number} nowMs
 */
export function normalizeMilAircraft(ac, nowMs) {
  const pos = usablePosition(ac);
  if (!pos) return null;
  return {
    hex: pos.hex,
    callsign: text(ac.flight),
    registration: text(ac.r),
    type: text(ac.t),
    country: icaoCountry(pos.hex),
    family: aircraftFamily(pos.hex),
    lat: pos.lat,
    lon: pos.lon,
    dept: departementAt(pos.lat, pos.lon),
    altitudeFt: num(ac.alt_baro),
    speedKt: num(ac.gs),
    track: num(ac.track),
    seenAt: new Date(Math.round(nowMs - positionAge(ac) * 1000)).toISOString(),
  };
}

/** Français d'abord, puis par indicatif (sans indicatif en dernier), puis par adresse. */
function byFamilyCallsignHex(a, b) {
  if (a.family !== b.family) return a.family === 'francais' ? -1 : 1;
  if (a.callsign !== b.callsign) {
    if (a.callsign === null) return 1;
    if (b.callsign === null) return -1;
    return a.callsign.localeCompare(b.callsign, 'fr');
  }
  return a.hex.localeCompare(b.hex);
}

/** Ordre des départements : Corse (2A, 2B) à la place du 20 ; mer territoriale (null) en dernier. */
function deptRank(dept) {
  return dept.replace(/^2([AB])$/, '20$1');
}

function byDeptSeaLast(a, b) {
  if (a.dept === b.dept) return 0;
  if (a.dept === null) return 1;
  if (b.dept === null) return -1;
  return deptRank(a.dept) < deptRank(b.dept) ? -1 : 1;
}

/**
 * Partage V2, à partir des aéronefs normalisés :
 * - au-dessus de la France, tous les appareils montrés un par un (`aircraft`, français d'abord puis par indicatif) et les appareils
 *   du bloc France aussi comptés par département (`frenchByDept`, mer en dernier) ;
 * - hors de France, comptés à part (`abroadCount`) et dessinés en gris (`abroad`, ordre du flux) ;
 * - `seen` : adresses au-dessus de la France par famille, pour dédoublonner l'historique horaire en mémoire (jamais servies ni écrites).
 * @param {Array<ReturnType<typeof normalizeMilAircraft>>} list
 */
export function splitByTerritory(list) {
  const french = [];
  const aircraft = [];
  const abroad = [];
  const seen = { francais: [], autres: [] };
  let abroadCount = 0;
  for (const a of list) {
    if (!a) continue;
    if (!inFranceV2(a.lat, a.lon)) {
      abroadCount += 1;
      abroad.push({
        hex: a.hex, callsign: a.callsign, registration: a.registration, type: a.type, country: a.country, family: a.family,
        lat: a.lat, lon: a.lon,
      });
      continue;
    }
    seen[a.family].push(a.hex);
    if (a.family === 'francais') french.push(a.dept);
    aircraft.push(a);
  }
  const counts = new Map();
  for (const dept of french) counts.set(dept, (counts.get(dept) ?? 0) + 1);
  const frenchByDept = [...counts].map(([dept, count]) => ({ dept, count })).sort(byDeptSeaLast);
  aircraft.sort(byFamilyCallsignHex);
  return { frenchByDept, aircraft, abroadCount, abroad, seen };
}

/** Code d'urgence : un transpondeur 7500, 7600 ou 7700 l'emporte ; sinon le champ `emergency` ramené à un code ; null sinon. */
function emergencyCode(ac) {
  const squawk = typeof ac.squawk === 'string' ? ac.squawk.trim() : '';
  if (EMERGENCY_SQUAWKS.includes(squawk)) return squawk;
  return typeof ac.emergency === 'string' ? EMERGENCY_TO_SQUAWK[ac.emergency] ?? null : null;
}

/**
 * Urgences de la lecture, au format du journal du serveur (MilitaryEmergency), partout dans la zone d'affichage, aéronefs en vol
 * seulement. Première et dernière vue : cette lecture (`atIso`, now d'adsb.lol) ; le journal donne l'épisode. `overFrance` : territoire
 * V2 ou moins de 40 km (approches).
 * @param {Array<Record<string, unknown>>} acList
 * @param {string} atIso
 */
export function militaryEmergenciesFrom(acList, atIso) {
  const out = [];
  for (const ac of acList) {
    const pos = usablePosition(ac);
    if (!pos) continue;
    const squawk = emergencyCode(ac);
    if (!squawk) continue;
    const inFrance = inFranceV2(pos.lat, pos.lon);
    const altitudeFt = num(ac.alt_baro);
    out.push({
      icao24: pos.hex,
      callsign: text(ac.flight),
      registration: text(ac.r),
      squawk,
      lat: pos.lat,
      lon: pos.lon,
      altitudeM: altitudeFt === null ? null : Math.round(altitudeFt * FEET_TO_M),
      firstSeen: atIso,
      lastSeen: atIso,
      overFrance: inFrance || nearFrance(pos.lat, pos.lon, APPROACH_KM),
      family: aircraftFamily(pos.hex),
      type: text(ac.t),
      country: icaoCountry(pos.hex),
      emergency: typeof ac.emergency === 'string' && ac.emergency !== 'none' ? ac.emergency : null,
      inFrance,
      dept: departementAt(pos.lat, pos.lon),
    });
  }
  return out;
}

const strOrNull = (v) => (typeof v === 'string' ? v : null);
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Urgence servie au client (MilitaryEmergency), champs choisis un à un ; null pour une entrée sans position, comme celles qu'écrivait
 * l'ancienne règle de masquage (avant le 08/10/2026) : elle n'est plus servie.
 */
function publicEmergency(e) {
  if (!e || typeof e.icao24 !== 'string' || numOrNull(e.lat) === null || numOrNull(e.lon) === null) return null;
  return {
    icao24: e.icao24,
    callsign: strOrNull(e.callsign),
    registration: strOrNull(e.registration),
    squawk: e.squawk,
    lat: e.lat,
    lon: e.lon,
    altitudeM: numOrNull(e.altitudeM),
    firstSeen: e.firstSeen,
    lastSeen: e.lastSeen,
    overFrance: e.overFrance === true,
    family: e.family === 'francais' ? 'francais' : 'autres',
    type: strOrNull(e.type),
    country: strOrNull(e.country),
    emergency: strOrNull(e.emergency),
    inFrance: e.inFrance === true,
    dept: strOrNull(e.dept),
  };
}

const publicEmergencies = (list) => list.map(publicEmergency).filter((e) => e !== null);

/** « 2026-10-04T14 » : heure UTC d'un instant. */
export function hourKey(ms) {
  return new Date(ms).toISOString().slice(0, 13);
}

const hourDate = (e) => (e && typeof e.hour === 'string' ? `${e.hour}:00:00.000Z` : '');

/** Compte d'une famille dans une entrée du journal ; une liste d'adresses d'un ancien format devient son nombre d'éléments distincts. */
function hourCount(v) {
  if (Array.isArray(v)) return new Set(v).size;
  return Number.isInteger(v) && v > 0 ? v : 0;
}

/**
 * Historique horaire : comptes d'aéronefs distincts de l'heure (MilitaryHourCount), jamais d'adresse dans le stockage clé-valeur. Les adresses de l'heure en cours sont dédoublonnées en mémoire ; après un redémarrage dans l'heure, le compte gardé est le
 * plus grand du stockage et de la mémoire (borne basse, jamais un double compte). Aucune écriture quand les comptes n'augmentent
 * pas (le stockage n'est pas sollicité), sauf pour réécrire en comptes une entrée d'un ancien format qui gardait des adresses.
 */
async function recordHour(ms, seen, now) {
  const hour = hourKey(ms);
  if (hourSeen?.hour !== hour) hourSeen = { hour, francais: new Set(), autres: new Set() };
  for (const hex of seen.francais) hourSeen.francais.add(hex);
  for (const hex of seen.autres) hourSeen.autres.add(hex);
  const stored = await readLog(MIL_HOURLY_KEY, { dateOf: hourDate, maxAgeMs: KEEP_MS, now });
  const legacy = stored.some((e) => Array.isArray(e.francais) || Array.isArray(e.autres));
  const log = stored.map((e) => ({ hour: e.hour, francais: hourCount(e.francais), autres: hourCount(e.autres) }));
  const i = log.findIndex((e) => e.hour === hour);
  const before = i >= 0 ? log[i] : null;
  const next = {
    hour,
    francais: Math.max(before?.francais ?? 0, hourSeen.francais.size),
    autres: Math.max(before?.autres ?? 0, hourSeen.autres.size),
  };
  if (!legacy && before && before.francais === next.francais && before.autres === next.autres) return;
  if (i >= 0) log[i] = next;
  else log.push(next);
  log.sort((a, b) => b.hour.localeCompare(a.hour));
  await kvSetJson(MIL_HOURLY_KEY, log, Math.ceil(KEEP_MS / 1000), now);
}

/** Tentative sans nouvelle lecture : collecte précédente gardée avec sa date (S1), ou collecte vide. */
function keepPrevious(now, errors) {
  collection = collection
    ? { ...collection, attemptedAt: now, errors }
    : {
      readAt: null, sourceNow: null, attemptedAt: now, frenchByDept: [], aircraft: [], abroadCount: 0, abroad: [],
      current: [], errors,
    };
  return collection;
}

async function refresh(now) {
  let read;
  try {
    read = await adsbLolGet('/v2/mil', now);
  } catch (err) {
    return keepPrevious(now, [err instanceof Error ? err.message : String(err)]);
  }
  const errors = [];
  const atIso = new Date(read.now).toISOString();
  const { seen, ...aircraft } = splitByTerritory(read.ac.map((ac) => normalizeMilAircraft(ac, read.now)));
  const current = militaryEmergenciesFrom(read.ac, atIso);
  // Historiques dans le stockage clé-valeur : une panne n'efface jamais des positions lues avec succès.
  try {
    await recordEmergencies(current, now, MIL_EMERGENCY_KEY);
  } catch (err) {
    errors.push(sourceError('Journal des urgences militaires', err));
  }
  try {
    await recordHour(read.now, seen, now);
  } catch (err) {
    errors.push(sourceError('Historique horaire des vols militaires', err));
  }
  collection = { readAt: new Date(now).toISOString(), sourceNow: atIso, attemptedAt: now, ...aircraft, current, errors };
  return collection;
}

function emptyBody(errors) {
  return {
    readAt: null, sourceNow: null, frenchByDept: [], aircraft: [], abroadCount: 0, abroad: [], emergencies: [],
    emergencyLog: [], hourly: { hours: [], since: null }, errors,
  };
}

/** Réponse servie (MilitaryResponse) à partir de la collecte en mémoire et des historiques ; `extra` : notes ajoutées. */
async function served(now, extra = []) {
  const c = collection;
  const errors = [...(c?.errors ?? []), ...extra];
  if (!c || c.readAt === null) return emptyBody(errors);
  if (now - Date.parse(c.readAt) > MIL_SERVE_MAX_MS) return emptyBody([...errors, MIL_TOO_OLD_ERROR]);
  let emergencyLog = [];
  let hours = [];
  try {
    emergencyLog = await readLog(MIL_EMERGENCY_KEY, { dateOf: (e) => (e && typeof e.lastSeen === 'string' ? e.lastSeen : ''), maxAgeMs: KEEP_MS, now });
  } catch (err) {
    errors.push(sourceError('Journal des urgences militaires', err));
  }
  try {
    const log = await readLog(MIL_HOURLY_KEY, { dateOf: hourDate, maxAgeMs: KEEP_MS, now });
    hours = log
      .map((e) => ({ hour: e.hour, francais: hourCount(e.francais), autres: hourCount(e.autres) }))
      .sort((a, b) => a.hour.localeCompare(b.hour));
  } catch (err) {
    errors.push(sourceError('Historique horaire des vols militaires', err));
  }
  // Épisode en cours : l'entrée du journal (première vue gardée), trouvée par l'adresse.
  const emergencies = c.current.map((e) => emergencyLog.find((l) => l.icao24 === e.icao24 && l.squawk === e.squawk) ?? e);
  return {
    readAt: c.readAt,
    sourceNow: c.sourceNow,
    frenchByDept: c.frenchByDept,
    aircraft: c.aircraft,
    abroadCount: c.abroadCount,
    abroad: c.abroad,
    emergencies: publicEmergencies(emergencies),
    emergencyLog: publicEmergencies(emergencyLog),
    hourly: { hours, since: hours[0]?.hour ?? null },
    errors: [...new Set(errors)],
  };
}

/**
 * Collecte à jour : nouvelle lecture si la dernière tentative a 2 min ou plus (5 min en dev). Une seule à la fois : la relève et la
 * route partagent la lecture en cours. Une erreur imprévue date quand même la tentative (aucune rafale d'appels).
 * @param {number} [now]
 */
export async function ensureMilitaryFresh(now = Date.now()) {
  if (!collection || now - collection.attemptedAt >= intervalMs() - TICK_TOLERANCE_MS) {
    inflight ??= refresh(now)
      .catch((err) => {
        console.error('[collecte military] collecte interrompue', err instanceof Error ? err.message : String(err));
        return keepPrevious(now, [sourceError('Collecte militaire interrompue', err)]);
      })
      .finally(() => { inflight = null; });
    await inflight;
  }
  return served(now);
}

/**
 * Dernière collecte gardée, sans attendre la collecte en cours (échéance de la route) : servie avec ses erreurs et `note`.
 * @param {number} now
 * @param {string} [note]
 */
export function storedMilitary(now, note) {
  return served(now, note ? [note] : []);
}
