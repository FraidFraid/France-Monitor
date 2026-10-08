// api/_lib/kv-history.js : séries horodatées et journaux bornés dans le stockage clé-valeur de l'application
// (Upstash Redis, api/_utils/redis.js), avec la mémoire du processus en repli quand Redis est absent (dev)
// ou muet. Utilisé par les collectes serveur des Trafics (spec 2026-10-03 panneaux trafic, T4) : échantillons
// de volume aérien (8 jours), journal des urgences (7 jours), compteurs de quota TomTom, dernières collectes.
// Un seul processus écrit ces clés (l'API sur la VM) : la mémoire fait foi tant qu'elle est remplie ; au
// redémarrage elle se recharge depuis Redis. Aucune écriture atomique n'est nécessaire.
// Le serveur de dev (NODE_ENV=development) lit les mêmes identifiants Upstash que la production : ses clés
// sont préfixées « dev: » pour ne jamais écraser les séries ni les compteurs de quota de la production.
// Le client lit Redis en mode strict (une panne lève) : kvReadJson distingue ainsi clé absente et panne ;
// kvGetJson et les autres lectures gardent leur comportement (null sur panne).
import { redisGetStrict, redisSet, redisSetStrict } from '../_utils/redis.js';

/** @typedef {{ get(key: string): Promise<string | null>, set(key: string, value: string, ttlSec: number): Promise<void>, setStrict?(key: string, value: string, ttlSec: number): Promise<boolean> }} KvClient */

/** @type {KvClient} */
const DEFAULT_CLIENT = { get: redisGetStrict, set: redisSet, setStrict: redisSetStrict };
/** @type {KvClient} */
let client = DEFAULT_CLIENT;

/** @type {Map<string, { value: unknown, expiresAt: number }>} */
const memory = new Map();

/** Vrai sur le serveur de dev (mêmes identifiants que la production : clés « dev: », collectes à quota bridées). */
export function isDevServer() {
  return process.env.NODE_ENV === 'development';
}

/** Clé réellement écrite : préfixe « dev: » sur le serveur de dev. */
export function storageKey(key) {
  return isDevServer() ? `dev:${key}` : key;
}

/** Réservé aux tests : remplace le client Redis (null : client réel). */
export function __setKvClientForTests(next) {
  client = next ?? DEFAULT_CLIENT;
}

/** Réservé aux tests : vide la mémoire du processus (simule un redémarrage). */
export function __resetKvForTests() {
  memory.clear();
}

/**
 * Valeur JSON d'une clé, en distinguant clé absente et panne de Redis : `{ value, failed }`. Mémoire du processus
 * d'abord, Redis sinon (la mémoire est alors remplie). `failed` vrai seulement si la lecture Redis a échoué ;
 * un JSON illisible compte comme une clé absente (la prochaine écriture le remplace).
 * @param {string} key
 * @param {number} [now]
 * @returns {Promise<{ value: unknown, failed: boolean }>}
 */
export async function kvReadJson(key, now = Date.now()) {
  const hit = memory.get(storageKey(key));
  if (hit && hit.expiresAt > now) return { value: hit.value, failed: false };
  let raw = null;
  try {
    raw = await client.get(storageKey(key));
  } catch {
    return { value: null, failed: true };
  }
  if (raw === null || raw === undefined) return { value: null, failed: false };
  try {
    const value = JSON.parse(raw);
    memory.set(storageKey(key), { value, expiresAt: now + 3_600_000 });
    return { value, failed: false };
  } catch {
    return { value: null, failed: false };
  }
}

/**
 * Valeur JSON d'une clé : mémoire du processus d'abord, Redis sinon (la mémoire est alors remplie).
 * @param {string} key
 * @param {number} [now]
 * @returns {Promise<unknown>} null si absente, expirée ou illisible, ou si Redis est en panne
 */
export async function kvGetJson(key, now = Date.now()) {
  return (await kvReadJson(key, now)).value;
}

/**
 * Écrit une valeur JSON (mémoire et Redis) pour ttlSec secondes. Un échec Redis n'est jamais propagé.
 * @param {string} key
 * @param {unknown} value
 * @param {number} ttlSec
 * @param {number} [now]
 */
export async function kvSetJson(key, value, ttlSec, now = Date.now()) {
  memory.set(storageKey(key), { value, expiresAt: now + ttlSec * 1000 });
  try {
    await client.set(storageKey(key), JSON.stringify(value), Math.max(1, Math.round(ttlSec)));
  } catch {
    // La mémoire suffit jusqu'au prochain redémarrage.
  }
}

/**
 * Écrit une valeur JSON comme kvSetJson, mais rend le résultat de l'écriture Redis au lieu de l'avaler :
 * `{ ok, persisted, error }` (`persisted` faux sans Redis configuré ; `ok` faux si l'écriture Redis a échoué).
 * La mémoire du processus est mise à jour dans tous les cas.
 * @param {string} key
 * @param {unknown} value
 * @param {number} ttlSec
 * @param {number} [now]
 * @returns {Promise<{ ok: boolean, persisted: boolean, error?: string }>}
 */
export async function kvWriteJson(key, value, ttlSec, now = Date.now()) {
  memory.set(storageKey(key), { value, expiresAt: now + ttlSec * 1000 });
  try {
    const write = client.setStrict ?? (async (k, v, t) => { await client.set(k, v, t); return true; });
    const persisted = await write(storageKey(key), JSON.stringify(value), Math.max(1, Math.round(ttlSec)));
    return { ok: true, persisted: persisted !== false };
  } catch (err) {
    return { ok: false, persisted: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Ajoute un échantillon `{ at: ISO, ... }` à une série bornée dans le temps.
 * Les échantillons plus vieux que maxAgeMs sont retirés ; un échantillon arrivé moins de minIntervalMs après
 * le dernier est ignoré (pas de doublon quand deux collectes se suivent de près).
 * @param {string} key
 * @param {{ at: string } & Record<string, unknown>} sample
 * @param {{ maxAgeMs: number, minIntervalMs?: number, now?: number }} options
 * @returns {Promise<{ appended: boolean, samples: Array<{ at: string } & Record<string, unknown>> }>}
 */
export async function appendSample(key, sample, { maxAgeMs, minIntervalMs = 0, now = Date.now() }) {
  const samples = await readSeries(key, { maxAgeMs, now });
  const last = samples.at(-1);
  const t = Date.parse(sample.at);
  if (!Number.isFinite(t)) throw new RangeError(`date d'échantillon illisible : ${sample.at}`);
  if (last && t - Date.parse(last.at) < minIntervalMs) return { appended: false, samples };
  const next = [...samples, sample].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  await kvSetJson(key, next, Math.ceil(maxAgeMs / 1000), now);
  return { appended: true, samples: next };
}

/**
 * Série d'une clé, échantillons de moins de maxAgeMs, dans l'ordre chronologique.
 * @param {string} key
 * @param {{ maxAgeMs: number, now?: number }} options
 */
export async function readSeries(key, { maxAgeMs, now = Date.now() }) {
  const value = await kvGetJson(key, now);
  if (!Array.isArray(value)) return [];
  return value
    .filter((s) => s && typeof s.at === 'string' && Number.isFinite(Date.parse(s.at)) && now - Date.parse(s.at) <= maxAgeMs)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/**
 * Ajoute ou met à jour une entrée de journal (même identifiant : `merge(ancienne, nouvelle)`), puis retire les
 * entrées dont la date (`dateOf`) a plus de maxAgeMs. Journal rendu du plus récent au plus ancien.
 * @template T
 * @param {string} key
 * @param {T} entry
 * @param {{ idOf(e: T): string, dateOf(e: T): string, merge?(old: T, next: T): T, maxAgeMs: number, now?: number }} options
 * @returns {Promise<T[]>}
 */
export async function upsertLogEntry(key, entry, { idOf, dateOf, merge = (_old, next) => next, maxAgeMs, now = Date.now() }) {
  const entries = await readLog(key, { dateOf, maxAgeMs, now });
  const id = idOf(entry);
  const index = entries.findIndex((e) => idOf(e) === id);
  if (index >= 0) entries[index] = merge(entries[index], entry);
  else entries.push(entry);
  const next = entries.sort((a, b) => Date.parse(dateOf(b)) - Date.parse(dateOf(a)));
  await kvSetJson(key, next, Math.ceil(maxAgeMs / 1000), now);
  return next;
}

/**
 * Journal d'une clé, entrées de moins de maxAgeMs, de la plus récente à la plus ancienne.
 * @template T
 * @param {string} key
 * @param {{ dateOf(e: T): string, maxAgeMs: number, now?: number }} options
 * @returns {Promise<T[]>}
 */
export async function readLog(key, { dateOf, maxAgeMs, now = Date.now() }) {
  const value = await kvGetJson(key, now);
  if (!Array.isArray(value)) return [];
  return value
    .filter((e) => Number.isFinite(Date.parse(dateOf(e))) && now - Date.parse(dateOf(e)) <= maxAgeMs)
    .sort((a, b) => Date.parse(dateOf(b)) - Date.parse(dateOf(a)));
}

/**
 * Ajoute `by` à un compteur (quota du jour) et rend la nouvelle valeur ; la clé expire après ttlSec.
 * @param {string} key
 * @param {number} by
 * @param {number} ttlSec
 * @param {number} [now]
 */
export async function incrementCounter(key, by, ttlSec, now = Date.now()) {
  const current = Number(await kvGetJson(key, now)) || 0;
  const next = current + by;
  await kvSetJson(key, next, ttlSec, now);
  return next;
}
