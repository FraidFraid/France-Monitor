// api/utils/redis.js
// Upstash Redis client wrapper used by Vercel Node and Edge handlers.
// Never throws: returns safe null/false fallbacks on any error.

import { Redis } from '@upstash/redis';

const BASE_URL = process.env.UPSTASH_REDIS_REST_URL;
const AUTH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = BASE_URL && AUTH_TOKEN
  ? new Redis({
      url: BASE_URL,
      token: AUTH_TOKEN,
    })
  : null;

/**
 * @param {string} key
 * @returns {Promise<string | null>}
 */
export async function redisGet(key) {
  if (!redis) return null;
  try {
    const result = await redis.get(key);
    return typeof result === 'string' ? result : result == null ? null : JSON.stringify(result);
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @param {string} value  — must already be JSON.stringify'd
 * @param {number} ttlSec
 * @returns {Promise<void>}
 */
export async function redisSet(key, value, ttlSec) {
  if (!redis) return;
  try {
    await redis.set(key, value, { ex: ttlSec });
  } catch {
    // fire-and-forget: cache failure never propagates
  }
}

/**
 * SET key value NX EX ttlSec.
 * Returns true if written (key was absent), false if key already existed.
 * @param {string} key
 * @param {string} value — must already be JSON.stringify'd
 * @param {number} ttlSec
 * @returns {Promise<boolean>}
 */
export async function redisSetNX(key, value, ttlSec) {
  if (!redis) return false;
  try {
    const result = await redis.set(key, value, { nx: true, ex: ttlSec });
    return result === 'OK';
  } catch {
    return false;
  }
}

/**
 * MGET — fetches multiple keys in one pipeline call.
 * Returns an array of the same length as keys; absent keys are null.
 * @param {string[]} keys
 * @returns {Promise<Array<string | null>>}
 */
export async function redisMGet(keys) {
  if (!redis || keys.length === 0) return keys.map(() => null);
  try {
    const result = await redis.mget(...keys);
    if (!Array.isArray(result)) return keys.map(() => null);
    return result.map((item) => (typeof item === 'string' ? item : item == null ? null : JSON.stringify(item)));
  } catch {
    return keys.map(() => null);
  }
}

/**
 * RPUSH — append value to a Redis list.
 * @param {string} key
 * @param {string} value
 * @returns {Promise<void>}
 */
export async function redisRPush(key, value) {
  if (!redis) return;
  try {
    await redis.rpush(key, value);
  } catch (e) {
    console.error('[redis] RPUSH failed', key, e);
  }
}

/**
 * LTRIM — trim a Redis list to the range [start, stop].
 * @param {string} key
 * @param {number} start
 * @param {number} stop
 * @returns {Promise<void>}
 */
export async function redisLTrim(key, start, stop) {
  if (!redis) return;
  try {
    await redis.ltrim(key, start, stop);
  } catch (e) {
    console.error('[redis] LTRIM failed', key, e);
  }
}
