// api/_utils/swr-cache.js
// Cache « stale-while-revalidate » à deux étages pour les handlers API lents.
//
// Étage 1 : mémoire du process (survit tant que l'instance Vercel Fluid Compute est
//           réutilisée, perdu au cold start).
// Étage 2 : Redis (Upstash), partagé entre toutes les instances/régions — voir
//           api/_utils/redis.js (never-throw : renvoie null/no-op si Redis n'est pas configuré).
//
// Sémantique par clé :
//   - fraîche (age < ttlSec)                          → renvoyée telle quelle, cache: 'hit'.
//   - périmée mais tolérée (ttlSec <= age < ttl+stale) → on retente le producer, borné à
//     timeoutMs ; succès → valeur fraîche (cache: 'miss') ; échec/délai dépassé → on sert
//     quand même la valeur périmée (cache: 'stale'). Le producer continue en tâche de fond
//     et met à jour le cache dès qu'il aboutit, même après le délai.
//   - absente, ou trop périmée (age >= ttl+stale)      → on attend le producer sans borne de
//     temps ; en cas d'échec, on retombe sur une valeur en cache si une existe encore
//     (aussi périmée soit-elle) plutôt que de faire échouer l'appelant.
//
// Un seul producer tourne à la fois par clé au sein d'une même instance (single-flight) :
// des appels concurrents sur la même clé partagent la même promesse.
//
// Ne lève jamais à cause de Redis : les erreurs Redis sont absorbées par api/_utils/redis.js
// (get renvoie null, set ne fait rien). Ce module ne propage que les erreurs du `producer`,
// et seulement quand aucune valeur de repli n'est disponible.

import { redisGet, redisSet } from './redis.js';

/** @type {Map<string, { value: unknown, storedAt: number }>} */
const memoryCache = new Map();

/** @type {Map<string, Promise<unknown>>} */
const inflight = new Map();

const DEFAULT_REDIS_CLIENT = { get: redisGet, set: redisSet };

/**
 * Exécute `producer` une seule fois par clé, même si plusieurs appels concurrents
 * arrivent avant qu'il n'aboutisse (single-flight au sein de cette instance).
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} producer
 * @returns {Promise<T>}
 */
function runSingleFlight(key, producer) {
  const existing = inflight.get(key);
  if (existing) return /** @type {Promise<T>} */ (existing);

  const p = Promise.resolve()
    .then(() => producer())
    .finally(() => {
      if (inflight.get(key) === p) inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

/**
 * Attend `promise` avec un budget de temps. Ne rejette jamais et ne provoque jamais
 * d'unhandled rejection (la promesse d'origine peut continuer à vivre après le délai).
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: true, value: T } | { ok: false, error?: unknown, timedOut?: boolean }>}
 */
function raceWithTimeout(promise, timeoutMs) {
  const settled = promise.then(
    (value) => /** @type {const} */ ({ ok: true, value }),
    (error) => /** @type {const} */ ({ ok: false, error }),
  );

  if (!timeoutMs || timeoutMs <= 0) return settled;

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, timedOut: true }), timeoutMs);
  });

  return Promise.race([settled, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param {{ get(key: string): Promise<string | null> }} redisClient
 * @param {string} key
 * @returns {Promise<{ value: unknown, storedAt: number } | null>}
 */
async function readRedis(redisClient, key) {
  const raw = await redisClient.get(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.storedAt === 'number' && 'value' in parsed) {
      return parsed;
    }
  } catch {
    // Valeur corrompue : traitée comme absente plutôt que de faire planter l'appelant.
  }
  return null;
}

/**
 * @param {{ set(key: string, value: string, ttlSec: number): Promise<void> }} redisClient
 * @param {string} key
 * @param {unknown} value
 * @param {number} storedAt
 * @param {number} ttlTotalSec
 */
async function writeRedis(redisClient, key, value, storedAt, ttlTotalSec) {
  try {
    await redisClient.set(key, JSON.stringify({ value, storedAt }), Math.max(1, Math.round(ttlTotalSec)));
  } catch {
    // Best-effort — un échec Redis ne doit jamais faire échouer le handler.
  }
}

/**
 * @param {string} key
 * @param {{
 *   ttlSec: number,
 *   staleSec?: number,
 *   timeoutMs?: number,
 *   redis?: { get(key: string): Promise<string | null>, set(key: string, value: string, ttlSec: number): Promise<void> },
 * }} options
 * @param {() => Promise<any>} producer
 * @returns {Promise<{ value: any, cache: 'hit' | 'stale' | 'miss', ageSec: number }>}
 */
export async function getOrRefresh(key, options, producer) {
  const { ttlSec, staleSec = 0, timeoutMs = 8_000, redis = DEFAULT_REDIS_CLIENT } = options;

  let entry = memoryCache.get(key) ?? null;
  if (!entry) {
    const fromRedis = await readRedis(redis, key);
    if (fromRedis) {
      entry = fromRedis;
      memoryCache.set(key, entry);
    }
  }

  const ageSec = entry ? (Date.now() - entry.storedAt) / 1000 : Infinity;

  const persist = async (value) => {
    const storedAt = Date.now();
    memoryCache.set(key, { value, storedAt });
    await writeRedis(redis, key, value, storedAt, ttlSec + staleSec);
  };

  // Fraîche : pas besoin de solliciter le producer.
  if (entry && ageSec < ttlSec) {
    return { value: entry.value, cache: 'hit', ageSec };
  }

  // Périmée mais tolérée : on tente un rafraîchissement borné dans le temps, et on
  // persiste dès que le producer aboutit — même si ça arrive après le délai imparti.
  if (entry && ageSec < ttlSec + staleSec) {
    const shared = runSingleFlight(key, producer);
    shared.then((value) => persist(value), () => {});

    const outcome = await raceWithTimeout(shared, timeoutMs);
    if (outcome.ok) {
      return { value: outcome.value, cache: 'miss', ageSec: 0 };
    }
    return { value: entry.value, cache: 'stale', ageSec };
  }

  // Absente, ou trop périmée pour être servie telle quelle : on attend le producer.
  try {
    const value = await runSingleFlight(key, producer);
    await persist(value);
    return { value, cache: 'miss', ageSec: 0 };
  } catch (error) {
    if (entry) {
      // Le producer échoue mais une valeur (aussi périmée soit-elle) existe encore :
      // on la sert plutôt que de faire échouer l'appelant.
      return { value: entry.value, cache: 'stale', ageSec };
    }
    throw error;
  }
}

/** Réservé aux tests : vide les caches mémoire/single-flight entre deux scénarios. */
export function __resetSwrCacheForTests() {
  memoryCache.clear();
  inflight.clear();
}
