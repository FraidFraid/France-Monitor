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
