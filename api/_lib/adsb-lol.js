// api/_lib/adsb-lol.js : client unique d'adsb.lol (spec 2026-10-04 souveraineté § 2.1 ; contrats, arbitrage 2). API ouverte sans
// clé aujourd'hui (licence ODbL 1.0), quota par adresse IP et dynamique : deux appels à 2 s d'écart ont donné un HTTP 429 (faits
// § 5.1). Tous les appels du processus passent par une seule file : au moins 6 s entre la fin d'un appel et le début du suivant,
// même lancés par deux routes en même temps ; recul de 10 min après un 429 ou une page de défi (aucun appel pendant ce temps) ;
// recul d'une heure après un 401 ou un 403 (« adsb.lol : clé requise » : une clé annoncée pour l'avenir n'est jamais ajoutée).
// Lecture stricte par api/_lib/source-http.js, User-Agent FranceMonitor imposé.
import { fetchStrictJson, sourceError } from './source-http.js';

export const ADSB_LOL_BASE = 'https://api.adsb.lol';
/** Écart minimal entre deux appels du processus. */
export const ADSB_MIN_GAP_MS = 6_000;
/** Recul après un HTTP 429 ou une page de contrôle anti-robot. */
export const ADSB_429_BACKOFF_MS = 10 * 60_000;
/** Recul après un HTTP 401 ou 403 hors défi (clé exigée). */
export const ADSB_AUTH_BACKOFF_MS = 60 * 60_000;
/** Délai d'une lecture (/v2/point à 200 milles : environ 330 Ko). */
export const ADSB_TIMEOUT_MS = 20_000;
export const ADSB_KEY_REQUIRED = 'adsb.lol : clé requise';

const PARIS_CLOCK = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** File unique : chaque appel attend la fin du précédent. */
let tail = Promise.resolve();
/** Fin du dernier appel (horloge du processus). */
let lastCallEnd = Number.NEGATIVE_INFINITY;
/** Recul en cours : `{ until, message }`. */
let blocked = null;

/** Réservé aux tests : file vide, aucun recul. */
export function __resetAdsbLolForTests() {
  tail = Promise.resolve();
  lastCallEnd = Number.NEGATIVE_INFINITY;
  blocked = null;
}

/** Fin du recul en cours (ms), ou null. */
export function adsbLolBlockedUntil() {
  return blocked && blocked.until > Date.now() ? blocked.until : null;
}

function adsbError(message, status = null) {
  const err = new Error(message);
  err.name = 'AdsbLolError';
  err.status = status;
  return err;
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** Un appel, à son tour dans la file. */
async function runTurn(path, now) {
  const reference = Math.max(Number.isFinite(now) ? now : 0, Date.now());
  if (blocked && reference < blocked.until) throw adsbError(blocked.message, blocked.status);
  blocked = null;
  const wait = lastCallEnd + ADSB_MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  let json;
  try {
    json = await fetchStrictJson(`${ADSB_LOL_BASE}${path}`, { timeoutMs: ADSB_TIMEOUT_MS });
  } catch (err) {
    const status = err && typeof err === 'object' && Number.isFinite(err.status) ? err.status : null;
    const kind = err && typeof err === 'object' ? err.kind : null;
    if (status === 429 || kind === 'challenge') {
      const until = Date.now() + ADSB_429_BACKOFF_MS;
      const what = status === 429 && kind !== 'challenge' ? 'HTTP 429' : `page de contrôle anti-robot${status ? ` (HTTP ${status})` : ''}`;
      blocked = { until, status, message: `adsb.lol : ${what}, nouvelle tentative après ${PARIS_CLOCK.format(new Date(until))}` };
      throw adsbError(blocked.message, status);
    }
    if (status === 401 || status === 403) {
      blocked = { until: Date.now() + ADSB_AUTH_BACKOFF_MS, status, message: ADSB_KEY_REQUIRED };
      throw adsbError(ADSB_KEY_REQUIRED, status);
    }
    throw adsbError(sourceError('adsb.lol', err), status);
  } finally {
    lastCallEnd = Date.now();
  }
  if (!json || typeof json !== 'object' || !Array.isArray(json.ac)) throw adsbError('adsb.lol : réponse illisible');
  const stamp = Number(json.now);
  // `now` est en millisecondes dans /v2/mil et /v2/point (jeux d'essai du 04/10) ; une valeur en secondes est convertie.
  const sourceNow = Number.isFinite(stamp) && stamp > 0 ? (stamp < 1e12 ? stamp * 1000 : stamp) : Date.now();
  return { ac: json.ac.filter((a) => a && typeof a === 'object'), now: sourceNow, total: Number.isFinite(Number(json.total)) ? Number(json.total) : json.ac.length };
}

/**
 * Lecture d'un chemin d'adsb.lol (« /v2/mil », « /v2/point/48.8/-1.5/200 »), à son tour dans la file unique du processus.
 * Lève une erreur au message déjà nommé (« adsb.lol : HTTP 429, nouvelle tentative après 16:58 », « adsb.lol : clé requise »,
 * « adsb.lol : réponse illisible », « adsb.lol : HTTP 500 ») ; pendant un recul, lève sans appeler.
 * @param {string} path
 * @param {number} [now] instant de référence du recul (par défaut l'horloge)
 * @returns {Promise<{ ac: Array<Record<string, unknown>>, now: number, total: number }>}
 */
export function adsbLolGet(path, now) {
  const turn = tail.then(() => runTurn(path, now));
  tail = turn.then(() => undefined, () => undefined);
  return turn;
}
