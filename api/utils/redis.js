// api/utils/redis.js
// Upstash Redis REST helper — works in Edge (fetch) and Node runtimes.
// Never throws: returns null on any network or parse error.

const BASE_URL   = process.env.UPSTASH_REDIS_REST_URL;
const AUTH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

/**
 * @param {string} key
 * @returns {Promise<string | null>}
 */
export async function redisGet(key) {
  if (!BASE_URL || !AUTH_TOKEN) return null;
  try {
    const res = await fetch(`${BASE_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.result ?? null;
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
  if (!BASE_URL || !AUTH_TOKEN) return;
  try {
    await fetch(
      `${BASE_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}/EX/${ttlSec}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      },
    );
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
  if (!BASE_URL || !AUTH_TOKEN) return false;
  try {
    const res = await fetch(
      `${BASE_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}/NX/EX/${ttlSec}`,
      { method: 'POST', headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
    );
    if (!res.ok) return false;
    const json = await res.json();
    return json.result === 'OK';
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
  if (!BASE_URL || !AUTH_TOKEN || keys.length === 0) return keys.map(() => null);
  try {
    const res = await fetch(`${BASE_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([['MGET', ...keys]]),
    });
    if (!res.ok) return keys.map(() => null);
    const json = await res.json();
    return json[0]?.result ?? keys.map(() => null);
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
  if (!BASE_URL || !AUTH_TOKEN) return;
  try {
    await fetch(
      `${BASE_URL}/rpush/${encodeURIComponent(key)}/${encodeURIComponent(value)}`,
      { method: 'POST', headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
    );
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
  if (!BASE_URL || !AUTH_TOKEN) return;
  try {
    await fetch(
      `${BASE_URL}/ltrim/${encodeURIComponent(key)}/${start}/${stop}`,
      { method: 'POST', headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
    );
  } catch (e) {
    console.error('[redis] LTRIM failed', key, e);
  }
}
