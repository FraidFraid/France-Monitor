// api/_lib/gels-avoirs.js : registre national des gels des avoirs, DG Trésor (spec 2026-10-04 souveraineté § 3.4 ; contrats § 2.7,
// Vocabulaire des autorités (amendement 7, S7) pour le panneau : « nouveaux gels » (added), « radiations » (removed), lien « consulter la dernière version du registre » (GELS_REGISTRY_URL).
// arbitrage 17 ; faits § 5.10). API publique (User-Agent exigé depuis janvier 2025 : le nôtre, jamais celui d'un navigateur). La date
// de dernière publication (19 octets, heure de Paris) est relue toutes les heures ; le fichier complet (12 Mo) n'est lu qu'à une
// publication nouvelle et réduit en mémoire : date, nombre d'entrées par nature, identifiants IdRegistre. Aucun nom ni détail
// nominatif n'en sort, ni dans la réponse, ni dans le KV, ni dans un journal. Différence avec la publication précédente par les
// identifiants (premier passage : n.d.). Hors score.
import { kvGetJson, kvSetJson, readLog, upsertLogEntry } from './kv-history.js';
import { parisWallTime } from './paris-time.js';
import { fetchStrictJson, fetchStrictText, sourceError } from './source-http.js';

const GELS_BASE = 'https://gels-avoirs.dgtresor.gouv.fr/ApiPublic/api/v1/publication';
export const GELS_DATE_URL = `${GELS_BASE}/derniere-publication-date`;
export const GELS_FILE_URL = `${GELS_BASE}/derniere-publication-flux-json`;
/** Registre officiel : la seule adresse où lire une fiche nominative. */
export const GELS_REGISTRY_URL = 'https://gels-avoirs.dgtresor.gouv.fr/';
export const GELS_INTERVAL_MS = 60 * 60_000;
export const GELS_STATE_KEY = 'sov:gels:state';
export const GELS_IDS_KEY = 'sov:gels:ids';
export const GELS_HISTORY_KEY = 'sov:gels:history';
export const GELS_HISTORY_MAX_AGE_MS = 400 * 86_400_000;
/** Lecture plus longue que l'échéance de la route : note d'avancement, jamais une panne. */
export const GELS_PENDING_NOTE = 'Registre des gels : lecture en cours';
const KEEP_SEC = GELS_HISTORY_MAX_AGE_MS / 1000;
const MINUTE_MS = 60_000;
const NATURES = { 'Personne physique': 'physiques', 'Personne morale': 'morales', Navire: 'navires' };

let queue = Promise.resolve();

/** Réservé aux tests : file libre. */
export function __resetGelsForTests() {
  queue = Promise.resolve();
}

const pad = (n) => String(n).padStart(2, '0');

/** « 02/10/2026 10:36:17 » (heure de Paris) vers « 2026-10-02T10:36:17+02:00 » (décalage du jour) ; null si illisible. */
export function parseGelsDate(text) {
  const m = /^\s*(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  const [day, month, year, hour, minute, second] = m.slice(1).map(Number);
  const instant = parisWallTime(year, month, day, hour, minute, second);
  if (!Number.isFinite(instant)) return null;
  const offset = Math.round((Date.UTC(year, month - 1, day, hour, minute, second) - instant) / MINUTE_MS);
  const sign = offset >= 0 ? '+' : '-';
  return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

/** DatePublication du fichier, ramenée aux millisecondes (7 décimales publiées) ; null si illisible. */
export function normalizePublicationDate(text) {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?([+-]\d{2}:\d{2}|Z)$/.exec(String(text ?? '').trim());
  if (!m) return null;
  return `${m[1]}${m[2] ? `.${m[2].slice(0, 3).padEnd(3, '0')}` : ''}${m[3]}`;
}

/** Date, comptes par nature et identifiants triés ; aucun nom ni détail. Lève sur un fichier illisible. */
export function summarizeGels(json) {
  const pub = json && typeof json === 'object' ? json.Publications : null;
  const detail = pub && typeof pub === 'object' ? pub.PublicationDetail : null;
  const publishedAt = normalizePublicationDate(pub?.DatePublication);
  if (!Array.isArray(detail) || publishedAt === null) throw new Error('fichier illisible (publication ou entrées absentes)');
  const counts = { physiques: 0, morales: 0, navires: 0 };
  const ids = new Set();
  for (const e of detail) {
    if (!e || typeof e !== 'object' || !Number.isInteger(e.IdRegistre) || ids.has(e.IdRegistre)) continue;
    ids.add(e.IdRegistre);
    const key = NATURES[e.Nature];
    if (key) counts[key] += 1;
  }
  if (ids.size === 0) throw new Error('fichier sans entrée lisible');
  return { publishedAt, total: ids.size, physiques: counts.physiques, morales: counts.morales, navires: counts.navires, ids: [...ids].sort((a, b) => a - b) };
}

/** Entrées ajoutées et retirées depuis la publication précédente ; premier passage : null et null. */
export function diffIds(previous, next) {
  if (!Array.isArray(previous)) return { added: null, removed: null };
  const before = new Set(previous);
  const after = new Set(next);
  return { added: next.filter((id) => !before.has(id)).length, removed: previous.filter((id) => !after.has(id)).length };
}

function sameSecond(a, b) {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) && Math.floor(ta / 1000) === Math.floor(tb / 1000);
}

function asState(value) {
  const v = value && typeof value === 'object' ? value : {};
  return {
    readAt: typeof v.readAt === 'string' ? v.readAt : null,
    dateCheckedAt: typeof v.dateCheckedAt === 'string' ? v.dateCheckedAt : null,
    attemptedAt: typeof v.attemptedAt === 'string' ? v.attemptedAt : null,
    current: v.current && typeof v.current === 'object' ? v.current : null,
    errors: Array.isArray(v.errors) ? v.errors : [],
  };
}

async function readHistory(now) {
  const log = await readLog(GELS_HISTORY_KEY, { dateOf: (p) => p.publishedAt, maxAgeMs: GELS_HISTORY_MAX_AGE_MS, now });
  return [...log].reverse();
}

async function responseOf(state, now, extra = []) {
  const publications = await readHistory(now);
  return {
    readAt: state.readAt, dateCheckedAt: state.dateCheckedAt, current: state.current,
    history: { publications, since: publications[0]?.publishedAt ?? null }, errors: [...state.errors, ...extra],
  };
}

async function save(state, now) {
  await kvSetJson(GELS_STATE_KEY, state, KEEP_SEC, now);
  return responseOf(state, now);
}

function isDue(attemptedAt, now) {
  const t = attemptedAt ? Date.parse(attemptedAt) : Number.NaN;
  return !Number.isFinite(t) || now - t >= GELS_INTERVAL_MS - MINUTE_MS;
}

/** Une relève : date, puis fichier si la date a changé. */
async function refreshGels(now) {
  const nowIso = new Date(now).toISOString();
  const state = asState(await kvGetJson(GELS_STATE_KEY, now));
  if (!isDue(state.attemptedAt, now)) return responseOf(state, now);
  let date;
  try {
    date = parseGelsDate(await fetchStrictText(GELS_DATE_URL, { expect: 'text', timeoutMs: 15_000 }));
    if (date === null) throw new Error('date de publication illisible');
  } catch (err) {
    return save({ ...state, attemptedAt: nowIso, errors: [sourceError('Registre des gels, date', err)] }, now);
  }
  if (state.current !== null && sameSecond(state.current.publishedAt, date)) {
    return save({ ...state, attemptedAt: nowIso, dateCheckedAt: nowIso, errors: [] }, now);
  }
  let summary;
  try {
    summary = summarizeGels(await fetchStrictJson(GELS_FILE_URL, { timeoutMs: 60_000 }));
  } catch (err) {
    return save({ ...state, attemptedAt: nowIso, dateCheckedAt: nowIso, errors: [sourceError('Registre des gels, fichier', err)] }, now);
  }
  const stored = await kvGetJson(GELS_IDS_KEY, now);
  const previous = stored && typeof stored === 'object' && Array.isArray(stored.ids) && typeof stored.publishedAt === 'string' ? stored : null;
  const counts = { total: summary.total, physiques: summary.physiques, morales: summary.morales, navires: summary.navires };
  let publication;
  if (previous !== null && sameSecond(previous.publishedAt, summary.publishedAt)) {
    const known = (await readHistory(now)).find((p) => sameSecond(p.publishedAt, summary.publishedAt));
    publication = { publishedAt: summary.publishedAt, ...counts, added: known?.added ?? null, removed: known?.removed ?? null };
  } else {
    publication = { publishedAt: summary.publishedAt, ...counts, ...diffIds(previous === null ? null : previous.ids, summary.ids) };
    await kvSetJson(GELS_IDS_KEY, { publishedAt: summary.publishedAt, ids: summary.ids }, KEEP_SEC, now);
  }
  await upsertLogEntry(GELS_HISTORY_KEY, publication, {
    idOf: (p) => p.publishedAt, dateOf: (p) => p.publishedAt, maxAgeMs: GELS_HISTORY_MAX_AGE_MS, now,
  });
  return save({ readAt: nowIso, dateCheckedAt: nowIso, attemptedAt: nowIso, current: publication, errors: [] }, now);
}

/**
 * Registre du moment, après une relève si elle est due (route et relève serveur) ; jamais deux relèves à la fois.
 * @param {number} [now]
 */
export function ensureGelsFresh(now = Date.now()) {
  const turn = queue.then(() => refreshGels(now));
  queue = turn.then(() => undefined, () => undefined);
  return turn;
}

/** État gardé, sans attendre la relève en cours (échéance de la route), avec `note`. */
export async function storedGels(now, note) {
  return responseOf(asState(await kvGetJson(GELS_STATE_KEY, now)), now, [note]);
}
