// api/_lib/vigilance-archive.js : départements en vigilance jaune, orange et rouge, maximum par jour de Paris sur 30 jours, lus
// dans l'archive open data de Météo-France (spec 2026-10-04 environnement E5, contrat § 2.1). Une fois par jour de Paris après
// 01:00 : relecture de l'arbre de l'archive (« vigilance-hexagone-tree.json », redirigé vers OVH), puis des cartes des 31
// derniers jours dont le nombre de publications gardé diffère de l'arbre (amorçage : 76 cartes le 04/10/2026, une seule
// fois). Une panne de l'archive est nommée et n'empêche jamais la route : l'historique gardé reste servi.
import { kvGetJson, kvSetJson } from './kv-history.js';
import { mapLimit } from './map-limit.js';
import { parisDay, parisHour } from './paris-time.js';
import { fetchStrictJson, sourceError } from './source-http.js';

export const ARCHIVE_TREE_URL = 'https://files.data.gouv.fr/meteofrance/data/vigilance/vigilance-hexagone-tree.json';
/** Piège : l'arbre s'appelle « hexagone », les cartes sont rangées sous « metropole ». */
const ARCHIVE_BASE = 'https://files.data.gouv.fr/meteofrance/data/vigilance/metropole';
const CARTE_FILE = 'CDP_CARTE_EXTERNE.json';
export const DAILY_KEY = 'env:vigilance:daily';
export const ATTEMPT_KEY = 'env:vigilance:archive-attempt';
const DAY_MS = 86_400_000;
/** Jours relus à chaque contrôle (jour courant compris). */
const CHECK_DAYS = 31;
/** Jours gardés dans le stockage clé-valeur. */
const KEEP_DAYS = 35;
/** Jours servis à la route (courbe sur 30 jours). */
const SERVE_DAYS = 30;
const DAILY_TTL_SEC = 40 * 86_400;
/** Une tentative (réussie ou non) n'est pas relancée avant 1 h. */
const ATTEMPT_TTL_SEC = 3_600;
const CONCURRENCY = 4;
const TIMEOUT_MS = 30_000;

const two = (v) => String(v).padStart(2, '0');

/** URL d'une carte d'archive : `archiveCarteUrl(2026, 10, 3, '140009')`. */
export function archiveCarteUrl(y, m, d, folder) {
  return `${ARCHIVE_BASE}/${y}/${two(m)}/${two(d)}/${folder}/${CARTE_FILE}`;
}

/**
 * Comptes de l'échéance J d'une carte (même schéma que l'API) : jour de Paris de la fin de validité de J moins 1 ms, puis
 * départements par couleur de `max_count_items`. Lève si l'échéance J est illisible.
 */
export function dayCountsOf(carte) {
  const periods = carte?.product?.periods;
  const j = Array.isArray(periods) ? periods.find((p) => p?.echeance === 'J') : undefined;
  const end = Date.parse(j?.end_validity_time ?? '');
  if (!j || !Number.isFinite(end) || !Array.isArray(j.max_count_items)) throw new Error('carte d’archive : échéance J illisible');
  const count = (color) => j.max_count_items
    .filter((m) => Number(m?.color_id) === color)
    .reduce((sum, m) => sum + (Number.isFinite(Number(m.count)) ? Number(m.count) : 0), 0);
  return { date: parisDay(end - 1), jaune: count(2), orange: count(3), rouge: count(4) };
}

/**
 * Dossiers de carte de l'arbre, par jour de Paris de l'heure du dossier (« 2026/09/29/220004 » compte pour le 30/09) ;
 * jours de `fromDay` à `toDay` compris. Les dossiers sans carte (textes seuls) sont écartés. Lève sur un arbre illisible.
 * @returns {Map<string, string[]>}
 */
export function cartesByParisDay(tree, fromDay, toDay) {
  if (tree === null || typeof tree !== 'object' || Array.isArray(tree)) throw new Error('arbre de l’archive illisible');
  const out = new Map();
  for (const [y, months] of Object.entries(tree)) {
    for (const [m, days] of Object.entries(months ?? {})) {
      for (const [d, folders] of Object.entries(days ?? {})) {
        for (const [folder, files] of Object.entries(folders ?? {})) {
          if (!/^\d{6}$/.test(folder) || !Array.isArray(files) || !files.includes(CARTE_FILE)) continue;
          const instant = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(folder.slice(0, 2)), Number(folder.slice(2, 4)), Number(folder.slice(4, 6)));
          if (!Number.isFinite(instant)) continue;
          const day = parisDay(instant);
          if (day < fromDay || day > toDay) continue;
          const list = out.get(day) ?? [];
          list.push(`${y}/${m}/${d}/${folder}`);
          out.set(day, list);
        }
      }
    }
  }
  for (const list of out.values()) list.sort();
  return out;
}

const isDay = (d) => d !== null && typeof d === 'object' && typeof d.date === 'string'
  && ['jaune', 'orange', 'rouge', 'publications'].every((k) => Number.isFinite(d[k]));

/** Valeur gardée `{ days, checkedDay, error }`, jours valides seulement, plus ancien d'abord. */
async function readStored(now) {
  const v = await kvGetJson(DAILY_KEY, now);
  const days = Array.isArray(v?.days) ? v.days.filter(isDay).sort((a, b) => a.date.localeCompare(b.date)) : [];
  return {
    days,
    checkedDay: typeof v?.checkedDay === 'string' ? v.checkedDay : null,
    error: typeof v?.error === 'string' ? v.error : null,
  };
}

async function writeStored(value, now) {
  const keepFrom = parisDay(now - (KEEP_DAYS - 1) * DAY_MS);
  await kvSetJson(DAILY_KEY, { ...value, days: value.days.filter((d) => d.date >= keepFrom) }, DAILY_TTL_SEC, now);
}

async function refresh(now) {
  if (parisHour(now) < 1) return;
  const today = parisDay(now);
  const stored = await readStored(now);
  if (stored.checkedDay === today) return;
  if (await kvGetJson(ATTEMPT_KEY, now)) return;
  await kvSetJson(ATTEMPT_KEY, new Date(now).toISOString(), ATTEMPT_TTL_SEC, now);
  let tree;
  try {
    tree = cartesByParisDay(await fetchStrictJson(ARCHIVE_TREE_URL, { timeoutMs: TIMEOUT_MS }), parisDay(now - (CHECK_DAYS - 1) * DAY_MS), today);
  } catch (err) {
    await writeStored({ ...stored, error: sourceError('archive vigilance', err) }, now);
    return;
  }
  const byDate = new Map(stored.days.map((d) => [d.date, d]));
  const due = new Set([...tree.entries()].filter(([day, folders]) => byDate.get(day)?.publications !== folders.length).map(([day]) => day));
  const paths = [...due].flatMap((day) => tree.get(day) ?? []);
  const results = await mapLimit(paths, CONCURRENCY, async (path) => {
    const [y, m, d, folder] = path.split('/');
    return dayCountsOf(await fetchStrictJson(archiveCarteUrl(y, m, d, folder), { timeoutMs: TIMEOUT_MS }));
  });
  const fresh = new Map();
  let failed = 0;
  let firstError = null;
  for (const r of results) {
    if (!r.ok) {
      failed += 1;
      firstError ??= r.error;
      continue;
    }
    const c = r.value;
    const cur = fresh.get(c.date) ?? { date: c.date, jaune: 0, orange: 0, rouge: 0, publications: 0 };
    fresh.set(c.date, {
      date: c.date, jaune: Math.max(cur.jaune, c.jaune), orange: Math.max(cur.orange, c.orange), rouge: Math.max(cur.rouge, c.rouge),
      publications: cur.publications + 1,
    });
  }
  for (const [date, value] of fresh) if (due.has(date)) byDate.set(date, value);
  const error = failed > 0
    ? `archive vigilance, cartes : ${failed} en échec (${firstError instanceof Error ? firstError.message : String(firstError)})`
    : null;
  await writeStored({
    days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    checkedDay: failed === 0 ? today : stored.checkedDay,
    error,
  }, now);
}

let running = null;

/**
 * Relève de l'archive, au plus une fois par jour de Paris après 01:00 (une tentative en échec attend 1 h). Appelée par la
 * relève du serveur en production (tâche 8) et par la route (dev) ; un seul passage à la fois dans le processus.
 */
export function ensureVigilanceArchiveFresh(now = Date.now()) {
  running ??= refresh(now).finally(() => { running = null; });
  return running;
}

/** Réservé aux tests : oublie un passage en cours. */
export function __resetVigilanceArchiveForTests() {
  running = null;
}

/**
 * Historique servi : 30 jours au plus (plus ancien d'abord), `since` = premier jour gardé ; `error` = dernière panne de
 * l'archive (« archive vigilance : HTTP 404 »), null après une relève réussie.
 */
export async function readVigilanceHistory(now = Date.now()) {
  const stored = await readStored(now);
  const from = parisDay(now - (SERVE_DAYS - 1) * DAY_MS);
  const today = parisDay(now);
  const days = stored.days.filter((d) => d.date >= from && d.date <= today);
  return { days, since: days[0]?.date ?? null, error: stored.error };
}

/**
 * Jour de l'échéance J de la carte en cours superposé à l'historique : maximum par couleur entre la valeur gardée et les
 * comptes de la carte (jamais moins que l'archive) ; publications de l'archive gardées (0 si le jour n'y est pas encore).
 */
export function overlayCurrentDay(days, period) {
  const end = Date.parse(period?.end ?? '');
  if (!period || !Number.isFinite(end)) return days;
  const date = parisDay(end - 1);
  const count = (color) => period.counts.find((c) => c.color === color)?.count ?? 0;
  const prev = days.find((d) => d.date === date);
  const merged = {
    date,
    jaune: Math.max(prev?.jaune ?? 0, count(2)),
    orange: Math.max(prev?.orange ?? 0, count(3)),
    rouge: Math.max(prev?.rouge ?? 0, count(4)),
    publications: prev?.publications ?? 0,
  };
  return [...days.filter((d) => d.date !== date), merged].sort((a, b) => a.date.localeCompare(b.date));
}
