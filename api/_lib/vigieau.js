// api/_lib/vigieau.js : restrictions d'eau en vigueur par département (VigiEau, successeur de Propluvia ; spec 2026-10-04
// environnement § 3.1, contrats § 2.6). Un stock (E2) : affiché, jamais dans le score ni dans une situation. Lecture stricte
// (source-http.js : non 2xx, page HTML, défi anti-robot, corps vide = erreur nommée), cache partagé de 6 h ; série quotidienne
// depuis la mise en service (kv-history.js), un échantillon par date d'arrêtés (« référence en construction » dans le panneau).
import { appendSample, readSeries } from './kv-history.js';
import { parisDay } from './paris-time.js';
import { cachedSource, fetchStrictJson, sourceError } from './source-http.js';

export const VIGIEAU_URL = 'https://api.vigieau.gouv.fr/api/departements';
/** Relève de 6 h (limite annoncée : 300 requêtes, en-tête x-ratelimit-reset de 1 s le 04/10). */
export const DROUGHT_TTL_SEC = 21_600;
export const DROUGHT_SERIES_KEY = 'env:drought:daily';
const SERIES_MAX_AGE_MS = 400 * 86_400_000;
const SERIES_MIN_INTERVAL_MS = 20 * 3_600_000;
const LEVELS = new Set(['vigilance', 'alerte', 'alerte_renforcee', 'crise']);

function level(value, code) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && LEVELS.has(value)) return value;
  throw new Error(`niveau inconnu « ${String(value)} » (${code})`);
}

/** Départements VigiEau ; lève sur une forme inattendue ou un niveau inconnu (jamais mis en cache). */
export function parseVigieauDepartements(json) {
  if (!Array.isArray(json) || json.length === 0) throw new Error('liste des départements vide ou illisible');
  return json.map((d) => {
    if (!d || typeof d !== 'object' || typeof d.code !== 'string' || typeof d.nom !== 'string') throw new Error('département illisible');
    return {
      dept: d.code, name: d.nom, region: typeof d.region === 'string' ? d.region : '',
      // Amendement 15 : « unavailable » = donnée indisponible (niveaux null), jamais « aucun arrêté ».
      available: d.availability?.AEP?.status !== 'unavailable',
      max: level(d.niveauGraviteMax, d.code), superficielle: level(d.niveauGraviteSupMax, d.code),
      souterraine: level(d.niveauGraviteSouMax, d.code), potable: level(d.niveauGraviteAepMax, d.code),
    };
  });
}

/** Date des arrêtés : availability.AEP.asOf la plus récente ; null si aucune n'est lisible. */
export function latestAsOf(json) {
  let best = null;
  let bestMs = -Infinity;
  for (const d of Array.isArray(json) ? json : []) {
    const asOf = d?.availability?.AEP?.asOf;
    const ms = typeof asOf === 'string' ? Date.parse(asOf) : Number.NaN;
    if (Number.isFinite(ms) && ms > bestMs) { best = new Date(ms).toISOString(); bestMs = ms; }
  }
  return best;
}

/** Comptes par niveau des départements publiés ; un département « unavailable » n'est dans aucune case (amendement 15). */
export function droughtCounts(depts) {
  const counts = { vigilance: 0, alerte: 0, alerte_renforcee: 0, crise: 0, aucun: 0 };
  for (const d of depts) if (d.available) counts[d.max ?? 'aucun'] += 1;
  return counts;
}

export function emptyDrought(errors) {
  return {
    asOf: null, departments: [], counts: { vigilance: 0, alerte: 0, alerte_renforcee: 0, crise: 0, aucun: 0 },
    history: { days: [], since: null }, readAt: null, errors,
  };
}

async function readVigieau(now) {
  return cachedSource('env:vigieau', { ttlSec: DROUGHT_TTL_SEC, staleSec: 7 * 86_400, shared: true }, async () => {
    const json = await fetchStrictJson(VIGIEAU_URL);
    return { departments: parseVigieauDepartements(json), asOf: latestAsOf(json), readAt: new Date(now).toISOString() };
  });
}

/** Série quotidienne : un jour par date d'arrêtés (le dernier échantillon du jour), plus ancien d'abord. */
export async function readDroughtHistory(now = Date.now()) {
  const samples = await readSeries(DROUGHT_SERIES_KEY, { maxAgeMs: SERIES_MAX_AGE_MS, now });
  const byDate = new Map();
  for (const s of samples) {
    if (typeof s.date !== 'string') continue;
    byDate.set(s.date, {
      date: s.date, vigilance: Number(s.vigilance) || 0, alerte: Number(s.alerte) || 0,
      alerte_renforcee: Number(s.alerte_renforcee) || 0, crise: Number(s.crise) || 0,
    });
  }
  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { days, since: days[0]?.date ?? null };
}

/**
 * Relève (serveur de production toutes les minutes, route en dev) : lecture VigiEau au plus toutes les 6 h (cache), puis un
 * échantillon daté par les arrêtés ; même date ou moins de 20 h après le précédent : rien d'ajouté. Lève si VigiEau échoue
 * sans valeur connue.
 */
export async function ensureDroughtFresh(now = Date.now()) {
  const v = await readVigieau(now);
  if (v.asOf !== null) {
    const c = droughtCounts(v.departments);
    await appendSample(DROUGHT_SERIES_KEY, {
      at: v.asOf, date: parisDay(Date.parse(v.asOf)), vigilance: c.vigilance, alerte: c.alerte, alerte_renforcee: c.alerte_renforcee, crise: c.crise,
    }, { maxAgeMs: SERIES_MAX_AGE_MS, minIntervalMs: SERIES_MIN_INTERVAL_MS, now });
  }
  return v;
}

/** Réponse de la route : 200 si VigiEau a été lu (ou servi du cache avec sa date), sinon 502 avec l'erreur nommée. */
export async function loadDrought(now = Date.now()) {
  let v = null;
  const errors = [];
  try {
    v = await ensureDroughtFresh(now);
  } catch (err) {
    errors.push(sourceError('VigiEau', err));
  }
  const history = await readDroughtHistory(now);
  if (!v) return { ...emptyDrought(errors), history };
  return { asOf: v.asOf, departments: v.departments, counts: droughtCounts(v.departments), history, readAt: v.readAt, errors };
}
