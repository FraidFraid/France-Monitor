// api/_lib/forest-danger.js : météo des forêts de Météo-France (spec 2026-10-04 environnement § 2.4, E1, S2). Dispositif
// officiel : niveau de danger 1 à 4 par département pour J1 et J2, publié chaque jour vers 16 h 50 (Paris) de juin à
// l'automne. Fichier annuel open data sans clé (CSV compressé, licence Etalab 2.0), relu toutes les heures entre 14 h et
// 18 h UTC en saison, toutes les 6 h sinon. Le panneau donne les niveaux tels que publiés, jamais recalculés.
// Lecture binaire stricte : non 2xx, page HTML ou de défi, corps vide ou non compressé = erreur nommée.
import { gunzipSync } from 'node:zlib';
import { DEPT_NAMES } from '../_shared/departments.js';
import { parisDay, parisParts } from './paris-time.js';
import { DEFAULT_TIMEOUT_MS, SOURCE_USER_AGENT, SourceFetchError, cachedSource, isChallengePage, looksLikeHtml, sourceError } from './source-http.js';

export const MDF_BASE = 'https://meteofrance.s3.sbg.io.cloud.ovh.net/data/BULLETIN/MDF';
/** Saison : juin à septembre (Paris), ou dernière publication de moins de 72 h (même règle que le client, tâche 1). */
export const FOREST_DANGER_SEASON = { fromMonth: 6, toMonth: 9, offSeasonAfterHours: 72 };
const HEADER = 'date;num_dep;niveau_j1;niveau_j2;nom_dep';
const LEVELS = new Set(['1', '2', '3', '4']);
const DAY_MS = 86_400_000;

/** URL du fichier annuel compressé. */
export function mdfUrl(year) {
  return `${MDF_BASE}/mdf_${year}.csv.gz`;
}

/** « en-saison » de juin à septembre à Paris, ou si la publication a moins de 72 h ; « hors-saison » sinon. */
export function forestDangerSeason(publishedAt, now) {
  const month = parisParts(now).month;
  if (month >= FOREST_DANGER_SEASON.fromMonth && month <= FOREST_DANGER_SEASON.toMonth) return 'en-saison';
  const t = publishedAt ? Date.parse(publishedAt) : Number.NaN;
  return Number.isFinite(t) && now - t < FOREST_DANGER_SEASON.offSeasonAfterHours * 3_600_000 ? 'en-saison' : 'hors-saison';
}

/** Durée du cache : 1 h entre 14 h et 18 h UTC en saison (publication vers 14 h 50 UTC), 6 h sinon. */
export function forestDangerTtlSec(now, publishedAt = null) {
  const hour = new Date(now).getUTCHours();
  return forestDangerSeason(publishedAt, now) === 'en-saison' && hour >= 14 && hour < 18 ? 3_600 : 21_600;
}

function errorName(err) {
  return err && typeof err === 'object' && 'name' in err ? String(err.name) : '';
}

/**
 * Texte d'un fichier gzip lu strictement (corps binaire : Response.text() le corromprait).
 * @param {string} url
 * @param {{ timeoutMs?: number }} [options]
 */
export async function fetchStrictGzipText(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let resp;
  try {
    resp = await fetch(url, { headers: { Accept: '*/*', 'User-Agent': SOURCE_USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const name = errorName(err);
    if (name === 'TimeoutError' || name === 'AbortError') throw new SourceFetchError(`délai dépassé (${timeoutMs} ms)`, { url, kind: 'timeout' });
    throw new SourceFetchError(`réseau : ${err instanceof Error ? err.message : String(err)}`, { url, kind: 'network' });
  }
  if (!resp.ok) throw new SourceFetchError(`HTTP ${resp.status}`, { url, status: resp.status, kind: 'http' });
  let bytes;
  try {
    bytes = Buffer.from(await resp.arrayBuffer());
  } catch {
    throw new SourceFetchError('réseau : lecture de la réponse interrompue', { url, status: resp.status, kind: 'network' });
  }
  if (bytes.length === 0) throw new SourceFetchError('réponse vide', { url, status: resp.status, kind: 'empty' });
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    const head = bytes.subarray(0, 8192).toString('utf8');
    if (isChallengePage(head)) throw new SourceFetchError('page de contrôle anti-robot', { url, status: resp.status, kind: 'challenge' });
    if (looksLikeHtml(head)) throw new SourceFetchError('page HTML reçue au lieu de données', { url, status: resp.status, kind: 'html' });
    throw new SourceFetchError('fichier compressé (gzip) attendu', { url, status: resp.status, kind: 'parse' });
  }
  try {
    return gunzipSync(bytes).toString('utf8');
  } catch {
    throw new SourceFetchError('fichier compressé illisible', { url, status: resp.status, kind: 'parse' });
  }
}

/** Jour calendaire « AAAA-MM-JJ » + n jours. */
function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Météo des forêts (contrat ForestDanger) : dernier jour publié, J1 et J2 (jours de Paris : publication + 1 et + 2), 96
 * départements, et l'historique de la saison (départements par niveau J1, un point par publication, daté de son jour J1).
 * Lève sur un fichier illisible ou sans ligne lisible.
 * @param {string} text
 * @param {number} now
 */
export function parseMdfCsv(text, now) {
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0 || lines[0].trim() !== HEADER) throw new Error('CSV météo des forêts illisible (en-tête inattendu)');
  /** @type {Map<string, Array<{ dept: string, name: string, j1: number, j2: number }>>} */
  const byDate = new Map();
  for (const line of lines.slice(1)) {
    const [date, dept, j1, j2, name] = line.split(';').map((v) => v.trim());
    if (!Number.isFinite(Date.parse(date)) || !/^(\d{2}|2A|2B)$/.test(dept ?? '') || !LEVELS.has(j1) || !LEVELS.has(j2)) continue;
    byDate.set(date, [...(byDate.get(date) ?? []), { dept, name: DEPT_NAMES[dept] ?? name ?? dept, j1: Number(j1), j2: Number(j2) }]);
  }
  const dates = [...byDate.keys()].sort((a, b) => Date.parse(a) - Date.parse(b));
  const publishedAt = dates.at(-1);
  if (!publishedAt) throw new Error('CSV météo des forêts sans ligne lisible');
  const published = Date.parse(publishedAt);
  const j1Date = addDays(parisDay(published), 1);
  const history = dates.map((date) => {
    const rows = byDate.get(date) ?? [];
    const count = (level) => rows.filter((r) => r.j1 === level).length;
    return { date: addDays(parisDay(Date.parse(date)), 1), n1: count(1), n2: count(2), n3: count(3), n4: count(4) };
  });
  return {
    publishedAt,
    j1Date,
    j2Date: addDays(j1Date, 1),
    season: forestDangerSeason(publishedAt, now),
    departments: [...(byDate.get(publishedAt) ?? [])].sort((a, b) => a.dept.localeCompare(b.dept, 'fr')),
    history,
  };
}

let lastPublishedAt = null;

/**
 * Météo des forêts de l'année (fichier de l'année précédente quand celui de l'année n'est pas encore publié, HTTP 404) ;
 * cache partagé `env:mdf:{AAAA}`. Ne lève jamais : `forestDanger` null et l'erreur nommée en cas de panne.
 * @param {number} [now]
 * @returns {Promise<{ forestDanger: import('../../src/types/index.ts').ForestDanger | null, errors: string[] }>}
 */
export async function loadForestDanger(now = Date.now()) {
  const year = parisParts(now).year;
  for (const y of [year, year - 1]) {
    try {
      const ttlSec = forestDangerTtlSec(now, lastPublishedAt);
      const read = await cachedSource(`env:mdf:${y}`, { ttlSec, staleSec: 7 * 86_400, shared: true }, async () => parseMdfCsv(await fetchStrictGzipText(mdfUrl(y)), now));
      // La saison suit l'heure de la lecture, pas celle de la mise en cache.
      const forestDanger = { ...read, season: forestDangerSeason(read.publishedAt, now) };
      lastPublishedAt = forestDanger.publishedAt;
      return { forestDanger, errors: [] };
    } catch (err) {
      if (y === year && err instanceof SourceFetchError && err.status === 404) continue;
      return { forestDanger: null, errors: [sourceError('Météo des forêts', err)] };
    }
  }
  return { forestDanger: null, errors: ['Météo des forêts : aucun fichier publié'] };
}

/** Tests seulement : oublie la dernière publication lue (durée du cache). */
export function __resetForestDangerForTests() {
  lastPublishedAt = null;
}
