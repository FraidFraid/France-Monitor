// api/_lib/fires-collect.js : collecte serveur des détections FIRMS (spec 2026-10-04 environnement § 2.4, E3, S2). Une seule
// collecte pour tous les visiteurs, toutes les 15 min : quatre produits NRT (Suomi NPP, NOAA-20, NOAA-21, MODIS) sur la boîte
// de la France, 2 jours lus (aujourd'hui et la veille depuis minuit UTC) puis ramenés à 24 h glissantes ; quota FIRMS de
// 5 000 transactions par 10 min, 4 appels par cycle. Chaque détection est rattachée à un département par point dans polygone ;
// hors de France, elle est comptée à part. L'historique d'empreintes (11 jours, grille d'environ 1 km) donne la récurrence ;
// il est amorcé une fois par jour au plus quand il a moins de 10 jours (8 appels de 5 jours). La clé FIRMS est dans le chemin
// de l'URL : une erreur ne porte qu'un libellé, jamais l'URL. Sans clé : CSV public Europe 24 h, Suomi NPP seul.
import { departementAt } from './geo-fr.js';
import { filterRecentDetections } from './firms-window.js';
import {
  FIRMS_PUBLIC_CSV_URL, FIRMS_PUBLIC_SOURCE, FIRMS_SOURCES, FIRMS_SOURCE_LABEL, firmsAreaUrl, normalizeRows, parseFirmsCsv,
} from './firms.js';
import { clusterFoyers, lastDays, mergeDayCells, pruneDays, splitByDepartement, utcDay } from './fire-foyers.js';
import { kvGetJson, kvSetJson } from './kv-history.js';
import { mapLimit } from './map-limit.js';
import { fetchStrictText, sourceError } from './source-http.js';

export const FIRES_CADENCE_MS = 15 * 60_000;
export const LAST_KEY = 'env:fires:last';
export const DAYS_KEY = 'env:fires:days';
export const BOOTSTRAP_KEY = 'env:fires:bootstrap';
export const MISSING_KEY_ERROR = 'clé FIRMS absente : Suomi NPP seul (CSV public)';
const LAST_TTL_SEC = 2 * 86_400;
const DAYS_TTL_SEC = 12 * 86_400;
const BOOTSTRAP_TTL_SEC = 86_400;
const DAYS_KEPT = 11;
const DAILY_DAYS = 10;
const WINDOW_HOURS = 24;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
/** Passages d'un même satellite à moins de 30 min : un seul passage attendu. */
const PASS_MERGE_MS = 30 * MINUTE_MS;

/** Clé FIRMS du serveur (NASA_FIRMS_API_KEY, alias FIRMS_API_KEY), espaces retirés ; '' si absente. */
export function firmsKey() {
  return String(process.env.NASA_FIRMS_API_KEY || process.env.FIRMS_API_KEY || '').replace(/\s+/g, '');
}

/** Réponse sans aucune collecte (contrat FiresResponse sans forestDanger). */
export function emptyFiresBody(errors = []) {
  return {
    readAt: null, lastAcquisitionAt: null, sources: [], detections: [], abroadCount: 0, abroad: [], foyers: [],
    daily: { days: [], since: null }, nextPasses: [], errors,
  };
}

/** Corps servi à partir de la dernière collecte gardée (date d'origine, S1) et des erreurs du dernier essai. */
function bodyOf(stored, errors) {
  if (!stored || typeof stored !== 'object') return emptyFiresBody(errors);
  const { attemptedAt: _attempt, errors: _old, ...rest } = stored;
  return { ...emptyFiresBody(), ...rest, errors };
}

function redact(text, key) {
  return key ? text.split(key).join('***') : text;
}

/** « FIRMS, NOAA-20 : 2 lignes illisibles » : lignes écartées par parseFirmsCsv (nombre de champs différent de l'en-tête). */
function rejectedWarning(label, rows) {
  const n = Number(rows.rejected) || 0;
  if (n === 0) return null;
  return `${label} : ${n} ${n > 1 ? 'lignes illisibles' : 'ligne illisible'}`;
}

/**
 * Une source lue : lignes brutes (et `warning`, les lignes écartées nommées), ou erreur nommée par son libellé (jamais l'URL,
 * qui porte la clé).
 */
async function readCsv(url, sourceId, label, key) {
  try {
    const rows = parseFirmsCsv(await fetchStrictText(url, { expect: 'text', timeoutMs: 20_000 }));
    return { ok: true, sourceId, rows, warning: rejectedWarning(label, rows) };
  } catch (err) {
    return { ok: false, sourceId, error: redact(sourceError(label, err), key) };
  }
}

function asDays(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [day, v] of Object.entries(value)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && v && Array.isArray(v.cells)) {
      out[day] = { cells: v.cells.filter((c) => typeof c === 'string'), france: Number(v.france) || 0, recurrent: Number(v.recurrent) || 0 };
    }
  }
  return out;
}

function latest(isoList) {
  let best = null;
  for (const iso of isoList) if (best === null || Date.parse(iso) > Date.parse(best)) best = iso;
  return best;
}

/**
 * Prochains passages estimés : chaque passage observé (satellite, heure d'acquisition) revient environ 24 h plus tard ; seuls
 * ceux des 24 h à venir sont gardés, un par satellite à moins de 30 min près. Estimation tirée des détections : un passage
 * sans aucune détection dans la boîte n'est pas connu.
 * @param {Array<{ satellite: string, acquiredAt: string }>} detections
 * @param {number} now
 */
export function nextPassesOf(detections, now) {
  const passes = new Map();
  for (const d of detections) passes.set(`${d.satellite}|${d.acquiredAt}`, { satellite: d.satellite, at: Date.parse(d.acquiredAt) + 24 * HOUR_MS });
  const ahead = [...passes.values()].filter((p) => p.at > now && p.at <= now + 24 * HOUR_MS).sort((a, b) => a.at - b.at);
  const kept = [];
  for (const p of ahead) {
    if (kept.some((k) => k.satellite === p.satellite && Math.abs(k.at - p.at) < PASS_MERGE_MS)) continue;
    kept.push(p);
  }
  return kept.map((p) => ({ satellite: p.satellite, expectedAt: new Date(p.at).toISOString() }));
}

/** Les cinq jours d'un amorçage commencé le `start`. */
function fiveDays(start) {
  return lastDays(new Date(Date.parse(`${start}T00:00:00Z`) + 4 * 86_400_000).toISOString().slice(0, 10), 5);
}

/**
 * Amorçage de l'historique (moins de 10 jours gardés) : 2 lectures de 5 jours par source (J-9 et J-4), une fois par jour au
 * plus (marqueur `env:fires:bootstrap` posé avant les appels). Un intervalle de 5 jours n'est « couvert » que si les quatre
 * sources ont répondu.
 */
async function bootstrapIfDue(key, storedDays, now) {
  const today = utcDay(now);
  const empty = { reads: [], coveredDays: [], errors: [] };
  if (lastDays(today, DAILY_DAYS).filter((d) => storedDays[d]).length >= DAILY_DAYS) return empty;
  if (await kvGetJson(BOOTSTRAP_KEY, now)) return empty;
  await kvSetJson(BOOTSTRAP_KEY, new Date(now).toISOString(), BOOTSTRAP_TTL_SEC, now);
  const starts = [lastDays(today, 10)[0], lastDays(today, 5)[0]];
  const jobs = starts.flatMap((date) => FIRMS_SOURCES.map((id) => ({ id, date })));
  const results = await mapLimit(jobs, 4, (j) => readCsv(
    firmsAreaUrl(key, j.id, { days: 5, date: j.date }), j.id, `FIRMS, amorçage ${FIRMS_SOURCE_LABEL[j.id]} du ${j.date}`, key,
  ));
  const reads = results.map((r) => (r.ok ? r.value : { ok: false, error: 'FIRMS, amorçage : erreur inconnue' }));
  const coveredDays = starts.filter((date) => reads.every((r, i) => jobs[i].date !== date || r.ok)).flatMap(fiveDays);
  return { reads: reads.filter((r) => r.ok), coveredDays, errors: reads.map((r) => (r.ok ? r.warning : r.error)).filter(Boolean) };
}

/**
 * Un cycle de collecte. Au moins une source lue : nouvelle collecte (sources en panne nommées dans `errors`) ; aucune : la
 * dernière collecte réussie reste servie avec sa propre date, et l'essai est mémorisé (pas de nouvel appel avant 15 min).
 * @param {number} [now]
 */
export async function collectFires(now = Date.now()) {
  const attemptedAt = new Date(now).toISOString();
  const today = utcDay(now);
  const stored = await kvGetJson(LAST_KEY, now);
  const storedDays = asDays(await kvGetJson(DAYS_KEY, now));
  const key = firmsKey();
  const errors = [];
  let reads;
  if (key) {
    const results = await mapLimit(FIRMS_SOURCES, 4, (id) => readCsv(firmsAreaUrl(key, id), id, `FIRMS, ${FIRMS_SOURCE_LABEL[id]}`, key));
    reads = results.map((r, i) => (r.ok ? r.value : { ok: false, sourceId: FIRMS_SOURCES[i], error: `FIRMS, ${FIRMS_SOURCE_LABEL[FIRMS_SOURCES[i]]} : erreur inconnue` }));
  } else {
    errors.push(MISSING_KEY_ERROR);
    reads = [await readCsv(FIRMS_PUBLIC_CSV_URL, FIRMS_PUBLIC_SOURCE, `FIRMS, ${FIRMS_SOURCE_LABEL[FIRMS_PUBLIC_SOURCE]}`, '')];
  }
  // Pannes et lignes écartées, dans l'ordre des sources.
  errors.push(...reads.map((r) => (r.ok ? r.warning : r.error)).filter(Boolean));
  const okReads = reads.filter((r) => r.ok);
  if (okReads.length === 0) {
    await kvSetJson(LAST_KEY, { ...bodyOf(stored, errors), attemptedAt, errors }, LAST_TTL_SEC, now);
    return bodyOf(stored, errors);
  }
  const boot = key ? await bootstrapIfDue(key, storedDays, now) : { reads: [], coveredDays: [], errors: [] };
  errors.push(...boot.errors);

  // Départements : un seul calcul par point (point dans polygone).
  const deptMemo = new Map();
  const deptOf = (lat, lon) => {
    const k = `${lat},${lon}`;
    if (!deptMemo.has(k)) deptMemo.set(k, departementAt(lat, lon));
    return deptMemo.get(k);
  };
  const all = okReads.flatMap((r) => normalizeRows(r.rows, r.sourceId));
  const recentIds = new Set(okReads.flatMap((r) => normalizeRows(filterRecentDetections(r.rows, WINDOW_HOURS, now), r.sourceId)).map((d) => d.id));
  const recent = splitByDepartement(all.filter((d) => recentIds.has(d.id)), deptOf);
  // Historique : lectures récentes et d'amorçage (qui recouvrent la veille et le jour), sans doublon d'identifiant.
  const byId = new Map();
  for (const d of [...all, ...boot.reads.flatMap((r) => normalizeRows(r.rows, r.sourceId))]) if (!byId.has(d.id)) byId.set(d.id, d);
  const history = splitByDepartement([...byId.values()], deptOf).france;

  // Historique : une lecture complète (quatre sources) couvre la veille et le jour ; sinon les comptes ne baissent jamais.
  const complete = Boolean(key) && okReads.length === FIRMS_SOURCES.length;
  const covered = new Set([...boot.coveredDays, ...(complete ? lastDays(today, 2) : [])]);
  let days = mergeDayCells(storedDays, history, [...covered]);
  const touched = new Set([...covered, ...history.map((d) => d.acquiredAt.slice(0, 10))]);
  for (const day of touched) {
    if (!days[day]) continue;
    const ofDay = history.filter((d) => d.acquiredAt.startsWith(day));
    const counted = clusterFoyers(ofDay, days, Date.parse(`${day}T23:59:59Z`)).detections;
    const france = counted.length;
    const recurrent = counted.filter((d) => d.recurrent).length;
    days[day] = covered.has(day)
      ? { ...days[day], france, recurrent }
      : { ...days[day], france: Math.max(days[day].france, france), recurrent: Math.max(days[day].recurrent, recurrent) };
  }
  days = pruneDays(days, today, DAYS_KEPT);

  const { detections, foyers } = clusterFoyers(recent.france, days, now);
  const shown = lastDays(today, DAILY_DAYS).filter((d) => days[d]);
  const body = {
    readAt: attemptedAt,
    lastAcquisitionAt: latest(all.map((d) => d.acquiredAt)),
    sources: reads.map((r) => ({
      id: r.sourceId, ok: r.ok, lastAcquisitionAt: r.ok ? latest(normalizeRows(r.rows, r.sourceId).map((d) => d.acquiredAt)) : null,
    })),
    detections,
    abroadCount: recent.abroad.length,
    abroad: recent.abroad,
    foyers,
    daily: { days: shown.map((d) => ({ date: d, france: days[d].france, recurrent: days[d].recurrent })), since: shown[0] ?? null },
    nextPasses: nextPassesOf(all, now),
    errors,
  };
  await kvSetJson(DAYS_KEY, days, DAYS_TTL_SEC, now);
  await kvSetJson(LAST_KEY, { ...body, attemptedAt }, LAST_TTL_SEC, now);
  return body;
}

/** Collecte due : aucun essai, ou dernier essai plus vieux que la cadence (une minute de tolérance pour la relève). */
export function isFiresDue(lastAttemptAt, now) {
  const t = lastAttemptAt ? Date.parse(lastAttemptAt) : Number.NaN;
  return !Number.isFinite(t) || now - t >= FIRES_CADENCE_MS - MINUTE_MS;
}

let queue = Promise.resolve();

/**
 * Dernière collecte, après un nouveau cycle s'il est dû (route et relève serveur toutes les minutes). Les appels sont mis en
 * file : deux déclenchements simultanés ne lancent jamais deux cycles.
 * @param {number} [now]
 */
export function ensureFiresFresh(now = Date.now()) {
  const turn = queue.then(async () => {
    const last = await kvGetJson(LAST_KEY, now);
    if (last && !isFiresDue(last.attemptedAt ?? null, now)) return bodyOf(last, Array.isArray(last.errors) ? last.errors : []);
    return collectFires(now);
  });
  queue = turn.then(() => undefined, () => undefined);
  return turn;
}
