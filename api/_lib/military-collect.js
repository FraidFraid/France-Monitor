// api/_lib/military-collect.js : collecte serveur des aéronefs militaires (spec 2026-10-04 souveraineté § 2.1, V1, V2 ; contrats
// § 2.2). Une lecture adsb.lol /v2/mil toutes les 2 min (5 min sur le serveur de dev), par la file unique d'api/_lib/adsb-lol.js ;
// le drapeau militaire est celui de la source (base communautaire adsb.lol, arbitrage 23). Périmètre V2 : un aéronef est compté
// s'il est au-dessus d'un département ou à moins de 22 km de la côte en mer française ; le reste de la zone d'affichage est « hors de
// France », dessiné en gris, jamais compté. Pays par bloc OACI (api/_lib/icao-country.js), jamais une hypothèse « France ».
// Amendement 7, O10 (réponse ministérielle publiée au JO le 25/10/2016) : les appareils du bloc France sont servis en compte par
// département seulement (ni adresse, ni indicatif, ni type, ni position) ; un appareil marqué PIA ou LADD (`dbFlags`) n'est jamais
// montré, quelle que soit sa nation ; l'immatriculation (`r`) n'est jamais lue. Le serveur garde l'adresse des appareils masqués
// dans son seul stockage clé-valeur (journal des urgences, historique horaire) pour fusionner les lectures, jamais dans la réponse.
// Urgences (7500, 7600, 7700 et champ `emergency`) : règle T3 du Trafic aérien (journal de 7 jours, confirmée sur deux lectures).
// Historique horaire de 7 jours (hex distincts par heure UTC et par famille) dans le stockage clé-valeur ; la collecte elle-même
// vit en mémoire du processus et reste servie 2 h au plus avec sa date (S1).
import { APPROACH_KM, EMERGENCY_SQUAWKS, ZONE_BOUNDS, recordEmergencies } from '../_shared/air-traffic.js';
import { adsbLolGet } from './adsb-lol.js';
import { departementAt } from './geo-fr.js';
import { aircraftFamily, icaoCountry } from './icao-country.js';
import { isDevServer, readLog, upsertLogEntry } from './kv-history.js';
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
/** Bits de `dbFlags` (base adsb.lol) : 4 = PIA (adresse de confidentialité de la FAA), 8 = LADD (diffusion limitée). */
const DB_FLAG_PIA = 4;
const DB_FLAG_LADD = 8;

/** Champ `emergency` d'adsb.lol ramené à un code transpondeur (arbitrage 6). */
const EMERGENCY_TO_SQUAWK = { unlawful: '7500', nordo: '7600', general: '7700', minfuel: '7700', lifeguard: '7700', downed: '7700' };

/**
 * Collecte en mémoire : `{ readAt, sourceNow, attemptedAt, frenchByDept, others, maskedOthers, abroadCount, abroad, current, errors }`
 * (`current` : urgences de la lecture, au format du journal, adresse comprise).
 */
let collection = null;
let inflight = null;

/** Réservé aux tests : aucune collecte en mémoire. */
export function __resetMilitaryForTests() {
  collection = null;
  inflight = null;
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

/** Vrai si la base adsb.lol marque l'appareil PIA ou LADD (O10) ; une valeur numérique en texte compte aussi. */
function hasProtectedIdentity(ac) {
  const flags = Number(ac.dbFlags);
  return Number.isInteger(flags) && (flags & (DB_FLAG_PIA | DB_FLAG_LADD)) !== 0;
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
 * Aéronef de /v2/mil normalisé pour le serveur, ou null : sans position, au sol (« ground »), position de plus de 120 s, hors de la
 * zone d'affichage. Champs de MilitaryAircraft, plus `family` et `protectedIdentity` (PIA ou LADD) qui décident de ce qui est servi
 * (splitByTerritory) ; l'immatriculation n'est jamais lue. `nowMs` : `now` d'adsb.lol (instant de la position = now moins seen_pos).
 * @param {Record<string, unknown>} ac
 * @param {number} nowMs
 */
export function normalizeMilAircraft(ac, nowMs) {
  const pos = usablePosition(ac);
  if (!pos) return null;
  return {
    hex: pos.hex,
    callsign: text(ac.flight),
    type: text(ac.t),
    country: icaoCountry(pos.hex),
    family: aircraftFamily(pos.hex),
    protectedIdentity: hasProtectedIdentity(ac),
    lat: pos.lat,
    lon: pos.lon,
    dept: departementAt(pos.lat, pos.lon),
    altitudeFt: num(ac.alt_baro),
    speedKt: num(ac.gs),
    track: num(ac.track),
    seenAt: new Date(Math.round(nowMs - positionAge(ac) * 1000)).toISOString(),
  };
}

/** Vrai si l'appareil peut être nommé et dessiné (O10) : ni bloc France, ni PIA, ni LADD. */
function isShown(a) {
  return a.family !== 'francais' && !a.protectedIdentity;
}

function byCallsignThenHex(a, b) {
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
 * Partage V2 et règle O10, à partir des aéronefs normalisés :
 * - au-dessus de la France, les appareils du bloc France en compte par département (`frenchByDept`, PIA et LADD compris, mer en
 *   dernier), les autres montrés un par un (`others`, tri par indicatif puis adresse) ou comptés seulement (`maskedOthers`, PIA ou
 *   LADD) ;
 * - hors de France, toutes familles comptées (`abroadCount`), les appareils montrables seuls dessinés (`abroad`, ordre du flux) ;
 * - `seen` : adresses au-dessus de la France par famille, masqués compris, pour l'historique horaire (stockage clé-valeur seulement,
 *   jamais servi).
 * @param {Array<ReturnType<typeof normalizeMilAircraft>>} list
 */
export function splitByTerritory(list) {
  const french = [];
  const others = [];
  const abroad = [];
  const seen = { francais: [], autres: [] };
  let maskedOthers = 0;
  let abroadCount = 0;
  for (const a of list) {
    if (!a) continue;
    if (!inFranceV2(a.lat, a.lon)) {
      abroadCount += 1;
      if (isShown(a)) abroad.push({ hex: a.hex, callsign: a.callsign, type: a.type, country: a.country, lat: a.lat, lon: a.lon });
      continue;
    }
    seen[a.family].push(a.hex);
    if (a.family === 'francais') french.push(a.dept);
    else if (a.protectedIdentity) maskedOthers += 1;
    else {
      others.push({
        hex: a.hex, callsign: a.callsign, type: a.type, country: a.country, lat: a.lat, lon: a.lon, dept: a.dept,
        altitudeFt: a.altitudeFt, speedKt: a.speedKt, track: a.track, seenAt: a.seenAt,
      });
    }
  }
  const counts = new Map();
  for (const dept of french) counts.set(dept, (counts.get(dept) ?? 0) + 1);
  const frenchByDept = [...counts].map(([dept, count]) => ({ dept, count })).sort(byDeptSeaLast);
  others.sort(byCallsignThenHex);
  return { frenchByDept, others, maskedOthers, abroadCount, abroad, seen };
}

/** Code d'urgence : un transpondeur 7500, 7600 ou 7700 l'emporte ; sinon le champ `emergency` ramené à un code ; null sinon. */
function emergencyCode(ac) {
  const squawk = typeof ac.squawk === 'string' ? ac.squawk.trim() : '';
  if (EMERGENCY_SQUAWKS.includes(squawk)) return squawk;
  return typeof ac.emergency === 'string' ? EMERGENCY_TO_SQUAWK[ac.emergency] ?? null : null;
}

/**
 * Urgences de la lecture, au format du journal du serveur, partout dans la zone d'affichage, aéronefs en vol seulement. Première et
 * dernière vue : cette lecture (`atIso`, now d'adsb.lol) ; le journal donne l'épisode. `overFrance` : territoire V2 ou moins de 40 km
 * (approches). Appareil montrable : ShownMilitaryEmergency. Appareil du bloc France, ou PIA ou LADD (O10) : MaskedMilitaryEmergency
 * plus son adresse `icao24`, gardée pour fusionner les lectures d'un épisode et retirée de la réponse (publicEmergency) ; ni
 * indicatif, ni position, ni type, ni pays, même dans le journal.
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
    const family = aircraftFamily(pos.hex);
    const common = {
      squawk,
      firstSeen: atIso,
      lastSeen: atIso,
      overFrance: inFrance || nearFrance(pos.lat, pos.lon, APPROACH_KM),
      emergency: typeof ac.emergency === 'string' && ac.emergency !== 'none' ? ac.emergency : null,
      inFrance,
      dept: departementAt(pos.lat, pos.lon),
    };
    if (family === 'francais' || hasProtectedIdentity(ac)) {
      out.push({ icao24: pos.hex, masked: true, family, ...common });
      continue;
    }
    const altitudeFt = num(ac.alt_baro);
    out.push({
      icao24: pos.hex,
      callsign: text(ac.flight),
      lat: pos.lat,
      lon: pos.lon,
      altitudeM: altitudeFt === null ? null : Math.round(altitudeFt * FEET_TO_M),
      ...common,
      masked: false,
      family: 'autres',
      type: text(ac.t),
      country: icaoCountry(pos.hex),
    });
  }
  return out;
}

/**
 * Urgence servie au client (MilitaryEmergency), champs choisis un à un : une entrée masquée perd son adresse ; une entrée sans
 * `masked: false` explicite est servie masquée (aucune identité par défaut).
 */
function publicEmergency(e) {
  const common = {
    squawk: e.squawk,
    firstSeen: e.firstSeen,
    lastSeen: e.lastSeen,
    overFrance: e.overFrance === true,
    emergency: typeof e.emergency === 'string' ? e.emergency : null,
    inFrance: e.inFrance === true,
    dept: typeof e.dept === 'string' ? e.dept : null,
  };
  if (e.masked !== false) return { masked: true, family: e.family === 'autres' ? 'autres' : 'francais', ...common };
  return {
    icao24: e.icao24,
    callsign: e.callsign ?? null,
    lat: e.lat,
    lon: e.lon,
    altitudeM: e.altitudeM ?? null,
    ...common,
    masked: false,
    family: 'autres',
    type: e.type ?? null,
    country: e.country ?? null,
  };
}

/** « 2026-10-04T14 » : heure UTC d'un instant. */
export function hourKey(ms) {
  return new Date(ms).toISOString().slice(0, 13);
}

const hourDate = (e) => (e && typeof e.hour === 'string' ? `${e.hour}:00:00.000Z` : '');
const union = (a, b) => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])].sort();

/** Historique horaire : hex distincts de l'heure ajoutés ; aucune écriture quand rien de neuf (le stockage n'est pas sollicité). */
async function recordHour(ms, seen, now) {
  const hour = hourKey(ms);
  const { francais, autres } = seen;
  const log = await readLog(MIL_HOURLY_KEY, { dateOf: hourDate, maxAgeMs: KEEP_MS, now });
  const entry = log.find((e) => e.hour === hour);
  if (entry && francais.every((h) => entry.francais.includes(h)) && autres.every((h) => entry.autres.includes(h))) return;
  await upsertLogEntry(MIL_HOURLY_KEY, { hour, francais: union([], francais), autres: union([], autres) }, {
    idOf: (e) => e.hour,
    dateOf: hourDate,
    merge: (old, next) => ({ hour: old.hour, francais: union(old.francais, next.francais), autres: union(old.autres, next.autres) }),
    maxAgeMs: KEEP_MS,
    now,
  });
}

/** Tentative sans nouvelle lecture : collecte précédente gardée avec sa date (S1), ou collecte vide. */
function keepPrevious(now, errors) {
  collection = collection
    ? { ...collection, attemptedAt: now, errors }
    : {
      readAt: null, sourceNow: null, attemptedAt: now, frenchByDept: [], others: [], maskedOthers: 0, abroadCount: 0, abroad: [],
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
  collection = { readAt: new Date(Date.now()).toISOString(), sourceNow: atIso, attemptedAt: now, ...aircraft, current, errors };
  return collection;
}

function emptyBody(errors) {
  return {
    readAt: null, sourceNow: null, frenchByDept: [], others: [], maskedOthers: 0, abroadCount: 0, abroad: [], emergencies: [],
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
      .filter((e) => Array.isArray(e.francais) && Array.isArray(e.autres))
      .map((e) => ({ hour: e.hour, francais: e.francais.length, autres: e.autres.length }))
      .sort((a, b) => a.hour.localeCompare(b.hour));
  } catch (err) {
    errors.push(sourceError('Historique horaire des vols militaires', err));
  }
  // Épisode en cours : l'entrée du journal (première vue gardée), trouvée par l'adresse que seul le serveur connaît.
  const emergencies = c.current.map((e) => emergencyLog.find((l) => l.icao24 === e.icao24 && l.squawk === e.squawk) ?? e);
  return {
    readAt: c.readAt,
    sourceNow: c.sourceNow,
    frenchByDept: c.frenchByDept,
    others: c.others,
    maskedOthers: c.maskedOthers,
    abroadCount: c.abroadCount,
    abroad: c.abroad,
    emergencies: emergencies.map(publicEmergency),
    emergencyLog: emergencyLog.map(publicEmergency),
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
