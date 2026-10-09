// api/_lib/outages-telecom.js : collecteur du panneau Télécoms (spec 2026-10-08 panneaux pannes § 2.1 ; faits § 1). Fichier ARCEP
// « sites indisponibles » du jour (publié vers 11 h à Paris), cherché par sonde directe sur le dépôt OVH (jour de Paris, puis les jours
// précédents jusqu'à 10), daté par son Last-Modified ; le catalogue data.gouv ne sert que de repli quand la sonde ne trouve rien.
// Fichier précédent pour les pannes nouvelles et rétablies ; dédoublonnage (station, opérateur), classement par âge et cause relatif à
// la publication (P1 : un stock n'est pas une panne du moment). Collecte due toutes les 30 min (5 min après un échec partiel) ; dernier
// relevé gardé en KV, servi daté ; historique de 30 jours (un point par jour de fichier, rattrapage de 5 fichiers archivés au plus
// par collecte, le fichier précédent déjà lu n'est jamais retéléchargé).
import { kvGetJson, kvSetJson, readSeries } from './kv-history.js';
import { mapLimit } from './map-limit.js';
import { parisDay, parisLocalToIso } from './paris-time.js';
import { fetchStrictJson, fetchStrictResponse, sourceError } from './source-http.js';

export const ARCEP_DATASET_URL = 'https://www.data.gouv.fr/api/1/datasets/5f7c7fae9cd6c79b58da3e20/';
export const ARCEP_FILE_BASE = 'https://arcep.s3.rbx.io.cloud.ovh.net/sites-indisponibles/all';
export const TELECOM_INTERVAL_MS = 30 * 60_000;
export const TELECOM_LAST_KEY = 'out:telecom:last';
export const TELECOM_HISTORY_KEY = 'out:telecom:history';
export const TELECOM_PENDING_NOTE = 'ARCEP : lecture en cours';
const HISTORY_MAX_AGE_MS = 31 * 86_400_000;
const LAST_TTL_SEC = 3 * 86_400;
const RECENT_MS = 24 * 3_600_000;
const DAY_MS = 86_400_000;
const FILE_TIMEOUT_MS = 30_000;
const CATALOG_TIMEOUT_MS = 15_000;
const MAX_DAY_PROBES = 10;
const BACKFILL_PER_RUN = 5;
const BACKFILL_DAYS = 30;
const MINUTE_MS = 60_000;
const RETRY_MS = 5 * MINUTE_MS;
const TECHS = [['2G', ['voix2g']], ['3G', ['voix3g', 'data3g']], ['4G', ['voix4g', 'data4g']], ['5G', ['data5g']]];

let queue = Promise.resolve();

/** Réservé aux tests : file libre. */
export function __resetTelecomForTests() {
  queue = Promise.resolve();
}

/** URL du fichier d'un jour « AAAA-MM-JJ » sur le dépôt de l'ARCEP. */
export function arcepFileUrl(day) {
  return `${ARCEP_FILE_BASE}/${day}/raw${day}.geojson`;
}

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const status = (v) => (v === 'HS' || v === 'OK' ? v : null);
const errorText = (err) => (err instanceof Error ? err.message : String(err));

/** Jour « AAAA-MM-JJ » décalé de `n` jours. */
function addDays(day, n) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Entité GeoJSON de l'ARCEP → TelecomSite sans classe (cls et band posés par classifyTelecom) ; null sans point lisible ou sans
 * opérateur. Un site sans station ANFR (il en existe : au large de Calais le 08/10, sans département) est gardé, identifié par sa position.
 */
export function normalizeArcepFeature(feature) {
  const p = feature && typeof feature === 'object' ? feature.properties : null;
  const coords = feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
  if (!p || !Array.isArray(coords)) return null;
  const [lon, lat] = coords;
  const station = text(p.station_anfr);
  const operator = text(p.operateur);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !operator) return null;
  const id = station ? `${station}:${operator}` : `${operator}@${lon.toFixed(5)},${lat.toFixed(5)}`;
  const techs = TECHS.filter(([, keys]) => keys.some((k) => p[k] === 'HS')).map(([t]) => t);
  const since = p.debut ? parisLocalToIso(String(p.debut).trim().replace(' ', 'T')) : null;
  return {
    id, operator, dept: text(p.departement), commune: text(p.commune), insee: text(p.code_insee), lat, lon,
    techs, voice: status(p.voix), data: status(p.data),
    cause: p.raison === 'INT' ? 'incident' : p.raison === 'MAINT' ? 'maintenance' : null,
    since, detail: text(p.detail), cls: 'sans-date', band: null,
  };
}

/** Un site par (station, opérateur) : incident avant maintenance, à cause égale le début le plus ancien (arbitrage 1). */
export function dedupeSites(sites) {
  const rank = (s) => (s.cause === 'incident' ? 0 : s.cause === 'maintenance' ? 1 : 2);
  const by = new Map();
  for (const s of sites) {
    const prev = by.get(s.id);
    if (!prev || rank(s) < rank(prev) || (rank(s) === rank(prev) && (s.since ?? '9') < (prev.since ?? '9'))) by.set(s.id, s);
  }
  return [...by.values()];
}

function band(ageMs) {
  if (ageMs < 3 * DAY_MS) return '1-3j';
  if (ageMs < 7 * DAY_MS) return '3-7j';
  if (ageMs < 30 * DAY_MS) return '7-30j';
  return '30j+';
}

const CLASS_ORDER = { recente: 0, longue: 1, maintenance: 2, 'sans-date': 3 };

/** Classe et tranche de chaque site, relatives à la publication du fichier (arbitrage 2) ; récentes d'abord, puis par début. */
export function classifyTelecom(sites, publishedAtMs) {
  const out = sites.map((s) => {
    if (s.cause === 'maintenance') return { ...s, cls: 'maintenance', band: null };
    const t = s.since ? Date.parse(s.since) : Number.NaN;
    if (s.cause !== 'incident' || !Number.isFinite(t) || t > publishedAtMs) return { ...s, cls: 'sans-date', band: null };
    const age = publishedAtMs - t;
    return age < RECENT_MS ? { ...s, cls: 'recente', band: null } : { ...s, cls: 'longue', band: band(age) };
  });
  return out.sort((a, b) => CLASS_ORDER[a.cls] - CLASS_ORDER[b.cls] || (b.since ?? '').localeCompare(a.since ?? '') || a.id.localeCompare(b.id));
}

/** Comptes du fichier ; `previousIds` null : fichier précédent illisible (comparaison n.d.). */
export function summarizeTelecom(sites, previousIds) {
  const ids = new Set(sites.map((s) => s.id));
  const bands = { '1-3j': 0, '3-7j': 0, '7-30j': 0, '30j+': 0 };
  const ops = new Map();
  const depts = new Map();
  let recent = 0; let long = 0; let maintenance = 0; let undated = 0;
  for (const s of sites) {
    const o = ops.get(s.operator) ?? { operator: s.operator, recent: 0, long: 0, maintenance: 0, voiceCut: 0, dataCut: 0 };
    if (s.cls === 'recente') {
      recent += 1; o.recent += 1;
      if (s.voice === 'HS') o.voiceCut += 1;
      if (s.data === 'HS') o.dataCut += 1;
      depts.set(s.dept, (depts.get(s.dept) ?? 0) + 1);
    } else if (s.cls === 'longue') { long += 1; o.long += 1; bands[s.band] += 1; } else if (s.cls === 'maintenance') { maintenance += 1; o.maintenance += 1; } else { undated += 1; }
    ops.set(s.operator, o);
  }
  const byOperator = [...ops.values()].sort((a, b) => b.recent - a.recent || a.operator.localeCompare(b.operator, 'fr'));
  const byDept = [...depts].map(([dept, n]) => ({ dept, recent: n }))
    .sort((a, b) => Number(a.dept === null) - Number(b.dept === null) || b.recent - a.recent || String(a.dept).localeCompare(String(b.dept)));
  return {
    summary: {
      total: sites.length, recent, long, maintenance, undated, bands,
      newSincePrevious: previousIds === null ? null : [...ids].filter((id) => !previousIds.has(id)).length,
      resolvedSincePrevious: previousIds === null ? null : [...previousIds].filter((id) => !ids.has(id)).length,
    },
    byOperator, byDept,
  };
}

/** Un fichier : sites dédoublonnés et heure de publication (Last-Modified, sinon date du catalogue). */
async function readFile(ref) {
  const resp = await fetchStrictResponse(ref.url, { expect: 'json', timeoutMs: FILE_TIMEOUT_MS });
  let json;
  try {
    json = JSON.parse(resp.text);
  } catch {
    throw new Error('JSON illisible');
  }
  const lm = Date.parse(resp.header('last-modified') ?? ref.lastModified ?? '');
  if (!Number.isFinite(lm)) throw new Error('fichier sans date de publication');
  // Une réponse 200 sans liste d'entités (corps d'erreur, schéma changé) n'est pas un fichier vide : jamais « 0 panne » (S3).
  if (!Array.isArray(json?.features)) throw new Error('GeoJSON sans entités');
  const features = json.features;
  const sites = dedupeSites(features.map(normalizeArcepFeature).filter((s) => s !== null));
  if (features.length > 0 && sites.length === 0) throw new Error('GeoJSON sans entité lisible');
  return { day: ref.day, publishedAt: new Date(lm).toISOString(), publishedMs: lm, sites };
}

/**
 * Sonde directe : fichier de `fromDay`, puis des jours précédents, jusqu'à MAX_DAY_PROBES jours. Null si tous sont absents (HTTP 404) ;
 * toute autre erreur est propagée (une panne n'est pas une absence).
 */
async function probeBack(fromDay) {
  for (let i = 0; i < MAX_DAY_PROBES; i += 1) {
    const day = addDays(fromDay, -i);
    try {
      return await readFile({ day, url: arcepFileUrl(day), lastModified: null });
    } catch (err) {
      if (err?.status !== 404) throw err;
    }
  }
  return null;
}

/** Ressources GeoJSON du catalogue data.gouv, plus récentes d'abord : `{ day, url, lastModified }` (repli de la sonde). */
async function catalog() {
  const json = await fetchStrictJson(ARCEP_DATASET_URL, { timeoutMs: CATALOG_TIMEOUT_MS });
  const resources = Array.isArray(json?.resources) ? json.resources : [];
  return resources
    .filter((r) => r && r.format === 'geojson' && typeof r.url === 'string')
    .map((r) => ({ day: (String(r.title ?? '').match(/\d{4}-\d{2}-\d{2}/) ?? String(r.url).match(/\d{4}-\d{2}-\d{2}/) ?? [null])[0], url: r.url, lastModified: r.last_modified ?? null }))
    .filter((r) => r.day !== null)
    .sort((a, b) => b.day.localeCompare(a.day));
}

/**
 * Fichier le plus récent : sonde du jour de Paris puis des jours précédents ; le catalogue n'est consulté que si la sonde ne trouve
 * aucun fichier. Rend `{ current, refs }` (`refs` : liste du catalogue, null en mode sonde). Lève avec les deux causes si tout échoue.
 */
async function locateCurrent(now) {
  const found = await probeBack(parisDay(now));
  if (found) return { current: found, refs: null };
  const probeMsg = `fichier introuvable sur ${MAX_DAY_PROBES} jours`;
  try {
    const refs = await catalog();
    if (refs.length === 0) throw new Error('aucun fichier GeoJSON au catalogue');
    return { current: await readFile(refs[0]), refs };
  } catch (err) {
    throw new Error(`${probeMsg} ; catalogue data.gouv : ${errorText(err)}`);
  }
}

/** Fichier précédent en mémoire : `{ day, publishedAt, publishedMs, ids: Set, recent: number | null }` (`recent` null : déjà dans l'historique). */
function previousFromRecord(day, publishedAt, ids, recent) {
  return { day, publishedAt, publishedMs: Date.parse(publishedAt), ids: new Set(ids), recent };
}

/**
 * Fichier précédent du fichier courant, sans téléchargement inutile : le fichier précédent déjà retenu si le courant n'a pas changé de
 * jour, le courant de la collecte précédente s'il est de la veille, sinon lecture (sonde, ou catalogue si le courant en vient).
 * Rend `{ previous, error, settled }` : `settled` faux = lecture en échec (nouvel essai après 5 min).
 */
async function locatePrevious(current, refs, stored) {
  const prevDay = addDays(current.day, -1);
  if (stored?.file && stored.previousFile && Array.isArray(stored.previousIds) && stored.file.day === current.day) {
    const p = stored.previousFile;
    return { previous: previousFromRecord(p.day, p.publishedAt, stored.previousIds, null), error: null, settled: true, reused: true };
  }
  if (stored?.file && Array.isArray(stored.sites) && stored.file.day === prevDay && stored.summary) {
    return {
      previous: previousFromRecord(stored.file.day, stored.file.publishedAt, stored.sites.map((s) => s.id), stored.summary.recent),
      error: null, settled: true, reused: false,
    };
  }
  try {
    let read;
    if (refs) {
      const ref = refs.find((r) => r.day < current.day);
      read = ref ? await readFile(ref) : null;
    } else {
      read = await probeBack(prevDay);
    }
    if (!read) return { previous: null, error: `ARCEP, fichier précédent : introuvable sur ${MAX_DAY_PROBES} jours`, settled: true, reused: false };
    const recent = classifyTelecom(read.sites, read.publishedMs).filter((s) => s.cls === 'recente').length;
    return { previous: previousFromRecord(read.day, read.publishedAt, read.sites.map((s) => s.id), recent), error: null, settled: true, reused: false };
  } catch (err) {
    return { previous: null, error: sourceError('ARCEP, fichier précédent', err), settled: false, reused: false };
  }
}

/** Réponse vide (jamais lu) : summary null, jamais 0. */
export function emptyTelecom(errors = []) {
  return { readAt: null, file: null, previousFile: null, summary: null, byOperator: [], byDept: [], sites: [], history: [], errors };
}

/** Champs servis (TelecomOutagesResponse), sans l'état interne de la collecte ni l'historique (ajouté à la lecture). */
function served(record) {
  const r = record && typeof record === 'object' ? record : {};
  const base = emptyTelecom();
  return {
    readAt: r.readAt ?? base.readAt, file: r.file ?? base.file, previousFile: r.previousFile ?? base.previousFile, summary: r.summary ?? base.summary,
    byOperator: r.byOperator ?? base.byOperator, byDept: r.byDept ?? base.byDept, sites: r.sites ?? base.sites, history: base.history,
    errors: Array.isArray(r.errors) ? r.errors : base.errors,
  };
}

async function withHistory(body, now, extra = []) {
  const series = await readSeries(TELECOM_HISTORY_KEY, { maxAgeMs: HISTORY_MAX_AGE_MS, now });
  const history = series.map((s) => ({ day: s.day, recent: s.recent })).sort((a, b) => a.day.localeCompare(b.day));
  return { ...body, history, errors: [...body.errors, ...extra] };
}

/** Un point par jour de fichier (clé `day`) : un jour publié deux fois garde le dernier point. Série triée par date de publication. */
async function upsertHistory(series, points, now) {
  const byDay = new Map(series.map((s) => [s.day, s]));
  for (const p of points) byDay.set(p.day, p);
  const next = [...byDay.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  await kvSetJson(TELECOM_HISTORY_KEY, next, Math.ceil(HISTORY_MAX_AGE_MS / 1000), now);
}

/**
 * Rattrapage de l'historique : jusqu'à BACKFILL_PER_RUN fichiers des 30 derniers jours absents de la série, lus directement par leur
 * URL. Un jour sans fichier (404) est retenu dans `absentDays` pour ne pas être redemandé à chaque collecte. Rend les points lus.
 */
async function backfill(currentDay, have, absentDays, now) {
  const wanted = [];
  for (let i = 1; i <= BACKFILL_DAYS && wanted.length < BACKFILL_PER_RUN; i += 1) {
    const day = addDays(currentDay, -i);
    if (!have.has(day) && !absentDays.has(day) && now - Date.parse(`${day}T12:00:00Z`) <= BACKFILL_DAYS * DAY_MS) wanted.push(day);
  }
  const read = await mapLimit(wanted, 2, (day) => readFile({ day, url: arcepFileUrl(day), lastModified: null }));
  const points = [];
  read.forEach((r, i) => {
    if (r.ok) {
      points.push({ at: r.value.publishedAt, day: r.value.day, recent: classifyTelecom(r.value.sites, r.value.publishedMs).filter((s) => s.cls === 'recente').length });
    } else if (r.error?.status === 404) {
      absentDays.add(wanted[i]);
    }
  });
  return points;
}

/** Une collecte : fichier du jour et précédent ; en échec, le dernier relevé est gardé avec l'erreur nommée. */
export async function collectTelecom(now = Date.now()) {
  const triedAt = new Date(now).toISOString();
  const stored = await kvGetJson(TELECOM_LAST_KEY, now);
  const last = stored && typeof stored === 'object' ? stored : null;
  try {
    const { current, refs } = await locateCurrent(now);
    const { previous, error, settled, reused } = await locatePrevious(current, refs, last);
    const sites = classifyTelecom(current.sites, current.publishedMs);
    const { summary, byOperator, byDept } = summarizeTelecom(sites, previous ? previous.ids : null);

    // Historique : un point par jour ; le fichier précédent déjà lu est compté ici, jamais retéléchargé pour le rattrapage.
    const series = await readSeries(TELECOM_HISTORY_KEY, { maxAgeMs: HISTORY_MAX_AGE_MS, now });
    const points = [{ at: current.publishedAt, day: current.day, recent: summary.recent }];
    if (previous && previous.recent !== null) points.push({ at: previous.publishedAt, day: previous.day, recent: previous.recent });
    const have = new Set([...series.map((s) => s.day), ...points.map((p) => p.day)]);
    const absentDays = new Set((Array.isArray(last?.absentDays) ? last.absentDays : []).filter((d) => now - Date.parse(`${d}T12:00:00Z`) <= HISTORY_MAX_AGE_MS));
    try {
      points.push(...await backfill(current.day, have, absentDays, now));
    } catch {
      // Le rattrapage est facultatif : il reprendra à la collecte suivante.
    }
    await upsertHistory(series, points, now);

    const record = {
      readAt: triedAt, file: { day: current.day, publishedAt: current.publishedAt },
      previousFile: previous ? { day: previous.day, publishedAt: previous.publishedAt } : null,
      summary, byOperator, byDept, sites, errors: error ? [error] : [],
      attemptedAt: triedAt, previousAttemptedAt: previous ? (reused ? last.previousAttemptedAt ?? triedAt : triedAt) : null,
      lastTryAt: triedAt, retry: !settled, previousIds: previous ? [...previous.ids] : null, absentDays: [...absentDays],
    };
    await kvSetJson(TELECOM_LAST_KEY, record, LAST_TTL_SEC, now);
    return withHistory(served(record), now);
  } catch (err) {
    const message = sourceError('ARCEP', err);
    // Échec du fichier courant : dernières données gardées, `attemptedAt` inchangé (il ne date que d'une lecture réussie), essai dans 5 min.
    const kept = last?.file
      ? { ...last, lastTryAt: triedAt, retry: true, errors: [message] }
      : { ...emptyTelecom([message]), attemptedAt: null, previousAttemptedAt: null, lastTryAt: triedAt, retry: true, previousIds: null, absentDays: last?.absentDays ?? [] };
    await kvSetJson(TELECOM_LAST_KEY, kept, LAST_TTL_SEC, now);
    return withHistory(served(kept), now);
  }
}

function isDue(record, now) {
  if (!record) return true;
  if (record.retry) {
    const tried = Date.parse(record.lastTryAt ?? '');
    return !Number.isFinite(tried) || now - tried >= RETRY_MS;
  }
  const attempted = Date.parse(record.attemptedAt ?? '');
  return !Number.isFinite(attempted) || now - attempted >= TELECOM_INTERVAL_MS - MINUTE_MS;
}

/** Dernier relevé, après une collecte si elle est due (route et relève serveur) ; jamais deux à la fois. */
export function ensureTelecomFresh(now = Date.now()) {
  const turn = queue.then(async () => {
    const last = await kvGetJson(TELECOM_LAST_KEY, now);
    if (last && typeof last === 'object' && !isDue(last, now)) return withHistory(served(last), now);
    return collectTelecom(now);
  });
  queue = turn.then(() => undefined, () => undefined);
  return turn;
}

/** Relevé gardé, sans attendre la collecte en cours (échéance de la route), avec `note`. */
export async function storedTelecom(now, note) {
  const record = await kvGetJson(TELECOM_LAST_KEY, now);
  return withHistory(served(record), now, [note]);
}
