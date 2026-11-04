// api/_lib/football-data.js : calendrier sportif (04/11/2026). Matchs à venir de Ligue 1, Ligue des champions et Ligue Europa
// (football-data.org, clé gratuite FOOTBALL_DATA_KEY), gardés quand le club qui reçoit est dans la table des stades.
// Collecte due toutes les 6 h (5 min après un échec) ; sans clé, aucune requête et `configured: false`. La clé n'est jamais écrite
// dans une URL, un message d'erreur ni un journal.
import { fetchStrictJson, sourceError } from './source-http.js';
import { stadiumOf } from './stadiums.js';

export const FOOTBALL_API = 'https://api.football-data.org/v4/competitions';
export const FOOTBALL_COMPETITIONS = ['FL1', 'CL', 'EL'];
export const FOOTBALL_INTERVAL_MS = 6 * 3_600_000;
const RETRY_MS = 5 * 60_000;
const DAY_MS = 86_400_000;

/**
 * @typedef {object} FootballMatch
 * @property {string} id
 * @property {string} competition
 * @property {string} home
 * @property {string} away
 * @property {string} kickoff Instant ISO du coup d'envoi.
 * @property {string|null} venue
 * @property {string|null} dept Département du stade, null si le stade n'est pas reconnu.
 */
/** @typedef {{ configured: boolean, readAt: string, matches: FootballMatch[], errors: string[] }} FootballState */

/** @type {FootballState & { attemptedAt: number, ok: boolean } | null} */
let last = null;
let queue = Promise.resolve();

/** Réservé aux tests. */
export function __resetFootballForTests() {
  last = null;
  queue = Promise.resolve();
}

const keyOf = () => (process.env.FOOTBALL_DATA_KEY ?? '').trim();
const day = (/** @type {number} */ t) => new Date(t).toISOString().slice(0, 10);

/**
 * Match de l'API → FootballMatch, ou null s'il est illisible ou si le club recevant n'est pas suivi.
 * @param {any} m
 * @param {string} competition
 * @returns {FootballMatch|null}
 */
export function parseMatch(m, competition) {
  const kick = Date.parse(m?.utcDate ?? '');
  if (!Number.isFinite(kick) || m?.id == null) return null;
  const stadium = stadiumOf(m.homeTeam);
  if (!stadium) return null;
  return {
    id: String(m.id), competition, home: String(m.homeTeam?.name ?? stadium.names[0]), away: String(m.awayTeam?.name ?? 'n.d.'),
    kickoff: new Date(kick).toISOString(), venue: typeof m.venue === 'string' && m.venue.trim() ? m.venue.trim() : null, dept: stadium.dept,
  };
}

async function collect(/** @type {number} */ now) {
  const key = keyOf();
  if (!key) {
    last = { configured: false, readAt: new Date(now).toISOString(), matches: [], errors: [], attemptedAt: now, ok: true };
    return last;
  }
  /** @type {FootballMatch[]} */
  const matches = [];
  /** @type {string[]} */
  const errors = [];
  for (const code of FOOTBALL_COMPETITIONS) {
    try {
      const url = `${FOOTBALL_API}/${code}/matches?dateFrom=${day(now)}&dateTo=${day(now + 7 * DAY_MS)}`;
      const body = await fetchStrictJson(url, { headers: { 'X-Auth-Token': key } });
      for (const m of Array.isArray(body?.matches) ? body.matches : []) {
        const parsed = parseMatch(m, code);
        if (parsed) matches.push(parsed);
      }
    } catch (err) {
      errors.push(sourceError(`Calendrier sportif ${code}`, err).split(key).join('***'));
    }
  }
  const ok = errors.length === 0;
  // Un échec complet garde les derniers matchs connus plutôt que de les effacer.
  const kept = !ok && matches.length === 0 && last?.configured ? last.matches : matches;
  last = { configured: true, readAt: new Date(now).toISOString(), matches: kept, errors, attemptedAt: now, ok };
  return last;
}

/** Dernier relevé, après une collecte si elle est due ; jamais deux à la fois. */
export function ensureFootballFresh(now = Date.now()) {
  const turn = queue.then(async () => {
    const due = !last || last.configured !== Boolean(keyOf()) || now - last.attemptedAt >= (last.ok ? FOOTBALL_INTERVAL_MS : RETRY_MS);
    return due ? collect(now) : last;
  });
  queue = turn.then(() => undefined, () => undefined);
  return turn;
}

/** Relevé gardé sans réseau (lecture du tick) ; sans clé : `configured: false`. */
export function footballSnapshot(now = Date.now()) {
  if (!keyOf()) return { configured: false, readAt: new Date(now).toISOString(), matches: [], errors: [] };
  if (!last) return null;
  const { configured, readAt, matches, errors } = last;
  return { configured, readAt, matches, errors };
}
