// api/_lib/protest-archive.js : archive horaire de la couche Manifestations tenue par la VM (27/10/2026). Le cron horaire de GitHub
// (.github/workflows/archive-protests.yml) ne passait qu'une fois toutes les 4 h environ : le minuteur fm-archive-protests
// (scripts/archive-protests.mjs) relève la couche toutes les heures sur la VM, et le workflow recopie ces fichiers hors VM.
//
// Un fichier par jour de relevé (UTC) : <dossier>/AAAA-MM-JJ.jsonl, une ligne par rassemblement (clé : id), son dernier état et
// `firstSeenAt` / `lastSeenAt`. Même forme et même fusion que le workflow (group_by(.id) en jq), pour que les deux se fusionnent.
// Lu par /api/social/protests-archive.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** 90 jours sur la VM ; la branche sauvegarde-historique garde tout. */
export const PROTEST_ARCHIVE_KEEP_DAYS = 90;

export function protestArchiveDir() {
  return process.env.PROTEST_ARCHIVE_DIR || '/var/lib/francemonitor/data/manifestations';
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isArchiveDay(day) {
  return typeof day === 'string' && DAY_RE.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`));
}

/** Rassemblement servi par /api/social/protests → ligne d'archive (sans la liste des articles, seulement leur nombre). */
export function archiveRow(item, readAt) {
  const pick = (k) => (item[k] === undefined ? null : item[k]);
  return {
    id: item.id, source: pick('source'), status: pick('status'), title: pick('title'), startsAt: pick('startsAt'), allDay: pick('allDay'),
    city: pick('city'), dept: pick('dept'), lat: pick('lat'), lon: pick('lon'), precision: pick('precision'), place: pick('place'),
    violent: pick('violent'), participants: pick('participants'), edition: pick('edition'),
    articleCount: item.articleCount ?? (Array.isArray(item.articles) ? item.articles.length : 0),
    firstSeenAt: readAt, lastSeenAt: readAt,
  };
}

/** Lignes du fichier ; une ligne illisible (écriture coupée) ou sans id est ignorée. */
export function parseArchive(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row.id === 'string' && typeof row.lastSeenAt === 'string') out.push(row);
    } catch {
      // ligne coupée : ignorée
    }
  }
  return out;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Fusion par id : dernier état du relevé le plus récent, premier et dernier relevé conservés ; tri par début puis id. */
export function mergeArchive(rows, incoming) {
  const byId = new Map();
  for (const row of [...rows, ...incoming]) {
    const prev = byId.get(row.id);
    if (!prev) {
      byId.set(row.id, row);
      continue;
    }
    const latest = cmp(row.lastSeenAt, prev.lastSeenAt) >= 0 ? row : prev;
    byId.set(row.id, {
      ...latest,
      firstSeenAt: cmp(row.firstSeenAt, prev.firstSeenAt) < 0 ? row.firstSeenAt : prev.firstSeenAt,
      lastSeenAt: cmp(row.lastSeenAt, prev.lastSeenAt) > 0 ? row.lastSeenAt : prev.lastSeenAt,
    });
  }
  return [...byId.values()].sort((a, b) => cmp(a.startsAt ?? '', b.startsAt ?? '') || cmp(a.id, b.id));
}

/** Jours archivés, du plus récent au plus ancien. */
export async function listArchiveDays(dir = protestArchiveDir()) {
  try {
    return (await readdir(dir)).map((f) => f.replace(/\.jsonl$/, '')).filter((d) => isArchiveDay(d)).sort().reverse();
  } catch {
    return [];
  }
}

/** Lignes d'un jour ; null si le jour n'est pas archivé. */
export async function readArchiveDay(day, dir = protestArchiveDir()) {
  if (!isArchiveDay(day)) return null;
  try {
    return parseArchive(await readFile(path.join(dir, `${day}.jsonl`), 'utf8'));
  } catch {
    return null;
  }
}
