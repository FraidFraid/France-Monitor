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
/** Maximum courant du jour de Paris en cours : `{ date, jaune, orange, rouge, seen }` (`seen` : `update_time` des cartes vues). */
export const TODAY_KEY = 'env:vigilance:today';
/** Nommé tant que l'archive n'a jamais été relevée en entier : la série n'est pas servie comme un fait. */
export const CONSTITUTION_ERROR = 'historique de la vigilance en cours de constitution';
const DAY_MS = 86_400_000;
/** Jours relus à chaque contrôle (jour courant compris). */
const CHECK_DAYS = 31;
/** Jours gardés dans le stockage clé-valeur. */
const KEEP_DAYS = 35;
/** Jours servis à la route (courbe sur 30 jours). */
const SERVE_DAYS = 30;
const DAILY_TTL_SEC = 40 * 86_400;
/** Une tentative (réussie ou non) n'est pas relancée avant 15 min. */
const ATTEMPT_TTL_SEC = 900;
const TODAY_TTL_SEC = 2 * 86_400;
const SEEN_MAX = 100;
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
  /** Cartes lues pendant ce passage, par jour : fusionnées au gardé (maximum), jamais en dessous. */
  const fresh = new Map();
  const snapshot = () => {
    for (const [date, value] of fresh) {
      const prev = stored.days.find((d) => d.date === date);
      const merged = {
        date,
        jaune: Math.max(prev?.jaune ?? 0, value.jaune),
        orange: Math.max(prev?.orange ?? 0, value.orange),
        rouge: Math.max(prev?.rouge ?? 0, value.rouge),
        publications: value.publications,
      };
      // Jour dont toutes les cartes ne sont pas lues : drapeau, jamais un fait silencieux.
      if (value.publications < (tree.get(date)?.length ?? 0)) merged.partial = true;
      byDate.set(date, merged);
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  };
  // Progression gardée au fil des cartes : un redémarrage en plein amorçage ne perd pas le travail (écritures ordonnées).
  let writes = Promise.resolve();
  const results = await mapLimit(paths, CONCURRENCY, async (path) => {
    const [y, m, d, folder] = path.split('/');
    const c = dayCountsOf(await fetchStrictJson(archiveCarteUrl(y, m, d, folder), { timeoutMs: TIMEOUT_MS }));
    if (due.has(c.date)) {
      const cur = fresh.get(c.date) ?? { date: c.date, jaune: 0, orange: 0, rouge: 0, publications: 0 };
      fresh.set(c.date, {
        date: c.date, jaune: Math.max(cur.jaune, c.jaune), orange: Math.max(cur.orange, c.orange), rouge: Math.max(cur.rouge, c.rouge),
        publications: cur.publications + 1,
      });
      const days = snapshot();
      writes = writes.then(() => writeStored({ days, checkedDay: stored.checkedDay, error: stored.error }, now));
    }
    return c;
  });
  await writes;
  const failures = results.filter((r) => !r.ok);
  const firstError = failures[0]?.error;
  const error = failures.length > 0
    ? `archive vigilance, cartes : ${failures.length} en échec (${firstError instanceof Error ? firstError.message : String(firstError)})`
    : null;
  await writeStored({
    days: snapshot(),
    checkedDay: failures.length === 0 ? today : stored.checkedDay,
    error,
  }, now);
}

let running = null;

/**
 * Relève de l'archive, au plus une fois par jour de Paris après 01:00 (une tentative en échec attend 1 h). Appelée par la
 * relève du serveur en production (tâche 8) et par la route (dev) ; un seul passage à la fois dans le processus.
 */
export function ensureVigilanceArchiveFresh(now = Date.now()) {
  running ??= refresh(now)
    .catch((err) => { console.error('[vigilance-archive] relève en échec :', err); })
    .finally(() => { running = null; });
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
  // Jamais relevée en entier et sans panne nommée : amorçage en cours, nommé (la série n'est pas un fait).
  const error = stored.error ?? (stored.checkedDay === null ? CONSTITUTION_ERROR : null);
  return { days, since: days[0]?.date ?? null, error };
}

/** Nombre de départements d'une couleur dans les comptes d'une échéance. */
const countOf = (period, color) => period.counts.find((c) => c.color === color)?.count ?? 0;

/**
 * Maximum courant du jour de l'échéance J, gardé tant que le jour dure : chaque lecture de la carte en cours le fait monter,
 * jamais descendre (2 orange à 06:50 puis 0 à 14:00 : le jour garde 2). Renvoie l'enregistrement, ou null sans échéance lisible.
 * @param {{ end: string; counts: Array<{ color: number; count: number }> } | null} period
 * @param {string | null} updateTime `update_time` de la carte lue
 */
export async function recordCurrentDay(period, updateTime, now = Date.now()) {
  const end = Date.parse(period?.end ?? '');
  if (!period || !Number.isFinite(end)) return null;
  const date = parisDay(end - 1);
  const stored = await kvGetJson(TODAY_KEY, now);
  const prev = stored?.date === date && Array.isArray(stored.seen) ? stored : { date, jaune: 0, orange: 0, rouge: 0, seen: [] };
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const seen = typeof updateTime === 'string' && !prev.seen.includes(updateTime) ? [...prev.seen, updateTime].slice(-SEEN_MAX) : prev.seen;
  const next = {
    date,
    jaune: Math.max(num(prev.jaune), countOf(period, 2)),
    orange: Math.max(num(prev.orange), countOf(period, 3)),
    rouge: Math.max(num(prev.rouge), countOf(period, 4)),
    seen,
  };
  await kvSetJson(TODAY_KEY, next, TODAY_TTL_SEC, now);
  return next;
}

/**
 * Jour de l'échéance J de la carte en cours superposé à l'historique : maximum par couleur entre la valeur gardée, le maximum
 * courant du jour (`running`) et les comptes de la carte (jamais moins que l'archive) ; publications de l'archive gardées
 * (0 si le jour n'y est pas encore).
 */
export function overlayCurrentDay(days, period, running = null) {
  const end = Date.parse(period?.end ?? '');
  if (!period || !Number.isFinite(end)) return days;
  const date = parisDay(end - 1);
  const prev = days.find((d) => d.date === date);
  const run = running?.date === date ? running : null;
  const best = (color, key) => Math.max(prev?.[key] ?? 0, run?.[key] ?? 0, countOf(period, color));
  const merged = {
    date,
    jaune: best(2, 'jaune'),
    orange: best(3, 'orange'),
    rouge: best(4, 'rouge'),
    publications: prev?.publications ?? 0,
  };
  if (prev?.partial) merged.partial = true;
  return [...days.filter((d) => d.date !== date), merged].sort((a, b) => a.date.localeCompare(b.date));
}

/** Relève de l'archive attendue `waitMs` au plus (l'amorçage continue en arrière-plan) ; ne rejette jamais. */
export async function refreshWithin(now, waitMs) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, waitMs);
    timer.unref?.();
  });
  await Promise.race([ensureVigilanceArchiveFresh(now).then(() => undefined, () => undefined), timeout]).finally(() => clearTimeout(timer));
}
