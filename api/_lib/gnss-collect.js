// api/_lib/gnss-collect.js : collecte serveur de la grille GNSS (spec 2026-10-04 souveraineté § 3.1 ; contrats § 2.5, arbitrages 2,
// 17, 33, 34 ; amendement 7, O15 à O17). Toutes les 10 min (dev 30 min), cinq lectures adsb.lol /v2/point qui couvrent la métropole,
// par la file unique du client adsb.lol (6 s d'écart garanti, recul de 10 min sur 429, d'une heure sur 401 ou 403).
// Deux cumuls en mémoire du processus, nourris des mêmes lectures :
// - 24 h glissantes : comptes sans lieu servis en direct (mailles orange françaises hors dégradation générale, `degraded.rolling24h`),
//   dégradation générale décidée avec le Kp de la même fenêtre (arbitrage 34), « référence en construction » sous 23 h 50 ;
// - un cumul par jour UTC : à la première lecture du jour suivant, le jour se ferme ; ses mailles localisées ne sont servies que le
//   lendemain (O17 : une maille qui se colore en direct peut signaler une protection en cours, et un brouillage peut être autorisé),
//   et seulement si le jour est couvert (chacun des cinq points lu sans intervalle de plus de trois cycles : un point jamais lu, par
//   exemple un cycle toujours arrêté avant lui, laisse le jour non couvert, jamais « calme »). Ses comptes vont au journal des
//   14 jours (`sov:gnss:days`) ; les deux derniers jours fermés donnent `degraded.previousUtcDays` (veille d'abord, null si non couvert).
// Une collecte n'est « complète » qu'avec ses cinq lectures : alors seulement `readAt` change. Un échec au milieu d'un cycle l'arrête,
// garde les lectures faites dans les cumuls et sert la dernière grille complète avec sa date : la donnée vieillit et passe « en retard »
// à 40 min, honnêtement. Au redémarrage, les cumuls recommencent ; les mailles de la veille déjà fermée restent servies depuis la
// dernière collecte gardée (`sov:gnss:last`).
/* global console -- journal du serveur (Node) */
import { adsbLolBlockedUntil, adsbLolGet } from './adsb-lol.js';
import {
  GNSS_WINDOW_MS, createGnssWindow, frenchMeasuredCells, gnssSummary, maxKpInWindow, utcDay, utcDayBefore, utcDayStart,
} from './gnss-grid.js';
import { isDevServer, kvGetJson, kvSetJson, upsertLogEntry } from './kv-history.js';
import { loadSpaceWeather } from './noaa-swpc.js';
import { parisParts } from './paris-time.js';

/** Centres et rayons (milles nautiques) des cinq lectures (faits § 5.1) : Ouest, Nord-Est, Sud-Ouest, Sud-Est, Corse. */
export const GNSS_POINTS = [[48.8, -1.5, 200], [49.0, 4.5, 200], [44.8, -0.5, 200], [44.0, 4.5, 200], [42.2, 9.1, 80]];
export const GNSS_INTERVAL_MS = 10 * 60_000;
/** Serveur de dev : autre adresse IP, cadence bridée (arbitrage 2). */
export const DEV_GNSS_INTERVAL_MS = 30 * 60_000;
export const GNSS_LAST_KEY = 'sov:gnss:last';
export const GNSS_DAYS_KEY = 'sov:gnss:days';
/** File adsb.lol occupée au-delà de l'échéance de la route : note d'avancement, jamais une panne (même phrase que les vols). */
export const GNSS_PENDING_NOTE = 'adsb.lol : collecte en cours';
/** Cumul de moins de 23 h 50 (redémarrage du serveur) : note d'avancement. */
export const GNSS_CONSTRUCTION_NOTE = 'Grille GNSS : référence en construction';
export const GNSS_TOO_OLD_ERROR = 'Grille GNSS : dernière collecte complète de plus de 2 jours';
/**
 * Jour UTC couvert : chacun des cinq points lu sans intervalle de plus de trois cycles (30 min ; 90 min sur le serveur de dev), de
 * 00:00 à sa première lecture, entre deux lectures et de sa dernière lecture à 24:00.
 */
export const GNSS_DAY_MAX_GAP_CYCLES = 3;
const LAST_TTL_SEC = 2 * 86_400;
const DAYS_MAX_AGE_MS = 14 * 86_400_000;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const DAYS_LOG = { idOf: (e) => e.date, dateOf: (e) => `${e?.date}T00:00:00Z`, maxAgeMs: DAYS_MAX_AGE_MS };

/** Cumul de 24 h glissantes. */
let gnssWindow = createGnssWindow();
/** Jour UTC des dernières lectures : `{ day, window }`. */
let today = null;
/** Jour UTC terminé, à fermer à la fin du cycle : `{ day, window }`. */
let ended = null;
/** Dernier jour fermé par ce processus : `{ day, cells }` (`cells` null si le jour n'est pas couvert). */
let lastClosed = null;
let queue = Promise.resolve();

/** Réservé aux tests : cumuls vides et file libre (simule un redémarrage ; le stockage clé-valeur reste). */
export function __resetGnssForTests() {
  gnssWindow = createGnssWindow();
  today = null;
  ended = null;
  lastClosed = null;
  queue = Promise.resolve();
}

/** Chemin adsb.lol d'une lecture : « /v2/point/49.0/4.5/200 ». */
export function pointPath([lat, lon, nm]) {
  return `/v2/point/${lat.toFixed(1)}/${lon.toFixed(1)}/${nm}`;
}

/** Réponse sans grille (contrat GnssResponse sans spaceWeather, ajouté par la route). */
export function emptyGnssBody(errors = []) {
  return {
    readAt: null, windowStart: null, reads: 0, aircraft: 0, cells: [], cellsDay: null, frenchCells: 0, generalDegradation: false,
    degraded: { rolling24h: 0, previousUtcDays: [null, null] }, days: { days: [], since: null }, errors,
  };
}

function intervalMs() {
  return isDevServer() ? DEV_GNSS_INTERVAL_MS : GNSS_INTERVAL_MS;
}

/** Cycle dû : aucun essai, ou dernier essai plus vieux que la cadence (une minute de tolérance pour la relève). */
export function isGnssDue(attemptedAt, now) {
  const t = attemptedAt ? Date.parse(attemptedAt) : Number.NaN;
  return !Number.isFinite(t) || now - t >= intervalMs() - MINUTE_MS;
}

function clockParis(ms) {
  const p = parisParts(ms);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

function errorsOf(record) {
  return record && typeof record === 'object' && Array.isArray(record.errors) ? record.errors : [];
}

/** Champs de la réponse repris un à un d'un enregistrement gardé : jamais un champ interne ni un champ d'un ancien format. */
function pickBody(record, errors) {
  const body = emptyGnssBody(errors);
  for (const key of Object.keys(body)) if (key !== 'errors' && record[key] !== undefined) body[key] = record[key];
  return body;
}

/** Corps servi depuis l'enregistrement gardé : grille complète de moins de 2 jours avec sa date (S1), sinon vide et panne nommée. */
function servedBody(record, errors, now) {
  if (!record || typeof record !== 'object' || typeof record.readAt !== 'string') return emptyGnssBody(errors);
  if (now - Date.parse(record.readAt) >= LAST_TTL_SEC * 1000) {
    return emptyGnssBody([...errors.filter((e) => e !== GNSS_CONSTRUCTION_NOTE), GNSS_TOO_OLD_ERROR]);
  }
  return pickBody(record, errors);
}

/** Essai sans grille complète : la dernière grille complète garde sa date, l'essai est mémorisé pour la cadence. */
async function recordAttempt(stored, errors, attemptedAt, now) {
  const kept = stored && typeof stored === 'object' && typeof stored.readAt === 'string' ? pickBody(stored, errors) : emptyGnssBody(errors);
  const record = { ...kept, attemptedAt };
  await kvSetJson(GNSS_LAST_KEY, record, LAST_TTL_SEC, now);
  return servedBody(record, errors, now);
}

/** Lecture d'un point versée aux deux cumuls ; la première lecture d'un nouveau jour UTC termine le jour précédent. */
function addRead(acList, atMs, point) {
  gnssWindow.add(acList, atMs);
  const day = utcDay(atMs);
  // Une horloge source qui recule de quelques secondes autour de minuit ne rouvre jamais un jour : seul un jour plus récent le termine.
  if (today !== null && day > today.day) {
    ended = today;
    today = null;
  }
  if (today === null) today = { day, window: createGnssWindow() };
  today.window.add(acList, atMs, point);
}

/** Entrée du journal des jours : comptes de mailles françaises, `covered` gardé au stockage seulement (jamais servi). */
function dayEntry(day, summary, covered) {
  return { date: day, jaune: summary.jaune, orange: summary.orange, general: summary.general, covered };
}

/**
 * Ferme le jour terminé : comptes et couverture au journal ; mailles gardées pour le lendemain si le jour est couvert. Dégradation
 * générale du jour avec le Kp le plus haut du jour.
 */
async function closeEndedDay(kp, now) {
  if (ended === null) return;
  const { day, window } = ended;
  ended = null;
  const start = utcDayStart(day);
  const cells = window.cells();
  const maxGapMs = GNSS_DAY_MAX_GAP_CYCLES * intervalMs();
  const covered = GNSS_POINTS.every((p) => window.largestGapMs(start, start + DAY_MS, pointPath(p)) <= maxGapMs);
  await upsertLogEntry(GNSS_DAYS_KEY, dayEntry(day, gnssSummary(cells, maxKpInWindow(kp, start, start + DAY_MS)), covered), { ...DAYS_LOG, now });
  lastClosed = { day, cells: covered ? cells : null };
}

/** Mailles orange françaises hors dégradation générale d'un jour fermé du journal ; null si le jour manque ou n'est pas couvert. */
function closedDayCount(log, day) {
  const e = log.find((x) => x && x.date === day);
  if (!e || e.covered !== true) return null;
  if (e.general === true) return 0;
  return Number.isInteger(e.orange) && e.orange >= 0 ? e.orange : null;
}

/** Mailles localisées de la veille : celles fermées par ce processus, sinon celles de la dernière collecte gardée ; null sinon. */
function veilleCells(veille, stored) {
  if (lastClosed !== null && lastClosed.day === veille) return lastClosed.cells;
  if (stored && typeof stored === 'object' && stored.cellsDay === veille && Array.isArray(stored.cells)) return stored.cells;
  return null;
}

/**
 * Un cycle : cinq lectures dans l'ordre de GNSS_POINTS, arrêt au premier échec ; grille calculée seulement si les cinq ont répondu.
 * @param {number} [now]
 */
export async function collectGnss(now = Date.now()) {
  const attemptedAt = new Date(now).toISOString();
  const stored = await kvGetJson(GNSS_LAST_KEY, now);
  const blockedUntil = adsbLolBlockedUntil();
  if (blockedUntil !== null && blockedUntil > now) {
    return recordAttempt(stored, [`Grille GNSS : adsb.lol en recul jusqu'à ${clockParis(blockedUntil)}, aucune lecture`], attemptedAt, now);
  }
  const errors = [];
  let readAtMs = now;
  let done = 0;
  for (let i = 0; i < GNSS_POINTS.length; i += 1) {
    try {
      const path = pointPath(GNSS_POINTS[i]);
      const read = await adsbLolGet(path);
      const at = Number.isFinite(read.now) ? read.now : now;
      addRead(read.ac, at, path);
      readAtMs = Math.max(readAtMs, at);
      done += 1;
    } catch (err) {
      errors.push(`Grille GNSS, lecture ${i + 1} sur ${GNSS_POINTS.length} : ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
  }
  gnssWindow.prune(readAtMs);
  let kp = null;
  const kpPoints = async () => {
    kp ??= (await loadSpaceWeather(now)).spaceWeather.kp;
    return kp;
  };
  if (ended !== null) await closeEndedDay(await kpPoints(), now);
  if (done < GNSS_POINTS.length || today === null) return recordAttempt(stored, errors, attemptedAt, now);

  const points = await kpPoints();
  const windowStartMs = Math.max(gnssWindow.startedAt ?? readAtMs, readAtMs - GNSS_WINDOW_MS);
  const rolling = gnssSummary(gnssWindow.cells(), maxKpInWindow(points, windowStartMs, readAtMs));
  const dayStart = utcDayStart(today.day);
  const current = gnssSummary(today.window.cells(), maxKpInWindow(points, dayStart, readAtMs));
  const log = await upsertLogEntry(GNSS_DAYS_KEY, dayEntry(today.day, current, false), { ...DAYS_LOG, now });
  const days = [...log].reverse().map((e) => ({ date: e.date, jaune: e.jaune, orange: e.orange, general: e.general === true }));
  const veille = utcDayBefore(today.day);
  const cells = veilleCells(veille, stored);
  const building = readAtMs - windowStartMs < GNSS_WINDOW_MS - GNSS_INTERVAL_MS;
  const body = {
    readAt: new Date(readAtMs).toISOString(),
    windowStart: new Date(windowStartMs).toISOString(),
    reads: gnssWindow.reads,
    aircraft: gnssWindow.aircraft,
    cells: cells ?? [],
    cellsDay: cells === null ? null : veille,
    frenchCells: cells === null ? 0 : frenchMeasuredCells(cells).length,
    generalDegradation: rolling.general,
    degraded: { rolling24h: rolling.degraded, previousUtcDays: [closedDayCount(log, veille), closedDayCount(log, utcDayBefore(today.day, 2))] },
    days: { days, since: days[0]?.date ?? null },
    errors: building ? [GNSS_CONSTRUCTION_NOTE] : [],
  };
  await kvSetJson(GNSS_LAST_KEY, { ...body, attemptedAt }, LAST_TTL_SEC, now);
  return body;
}

/**
 * Dernière grille, après un nouveau cycle s'il est dû (route et relève serveur) ; file : jamais deux cycles à la fois. Une exception
 * pendant le cycle est nommée et mémorisée comme un essai : la relève ne relance pas un cycle chaque minute.
 * @param {number} [now]
 */
export function ensureGnssFresh(now = Date.now()) {
  const turn = queue.then(async () => {
    const last = await kvGetJson(GNSS_LAST_KEY, now);
    if (last && !isGnssDue(last.attemptedAt ?? null, now)) return servedBody(last, errorsOf(last), now);
    try {
      return await collectGnss(now);
    } catch (err) {
      const error = `Grille GNSS, erreur inattendue : ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[collecte gnss] ${error}`);
      return recordAttempt(last, [error], new Date(now).toISOString(), now);
    }
  });
  queue = turn.then(() => undefined, () => undefined);
  return turn;
}

/**
 * Grille gardée, sans attendre le cycle en cours (échéance de la route) : servie avec ses erreurs et `note`.
 * @param {number} now
 * @param {string} note
 */
export async function storedGnss(now, note) {
  const record = await kvGetJson(GNSS_LAST_KEY, now);
  return servedBody(record, [...errorsOf(record), note], now);
}
