// api/utils/rate-limit.js
// Rate limiting fenêtre fixe par IP et par route, adossé au wrapper Redis Upstash.
// Fail-open : si Redis est indisponible, on laisse passer (cohérent avec redis.js).

import { redisIncrFixedWindow } from './redis.js';

/** Limite par défaut : requêtes par IP par route et par fenêtre. */
export const RATE_LIMIT_PER_MIN = 60;

/** Durée de la fenêtre fixe, en secondes. */
export const WINDOW_SEC = 60;

/**
 * Extrait l'IP cliente : premier élément de x-forwarded-for, sinon x-real-ip.
 * @param {Request} request
 * @returns {string}
 */
export function getClientIp(request) {
  const xff = request.headers.get('x-forwarded-for') || '';
  const first = xff.split(',')[0].trim();
  return first || request.headers.get('x-real-ip') || 'unknown';
}

/**
 * Vérifie et incrémente le compteur fenêtre fixe pour (route, IP).
 * @param {string} route — identifiant de route, ex: 'rss-proxy'
 * @param {Request} request
 * @param {number} [limit]
 * @returns {Promise<{ allowed: boolean, remaining: number, retryAfter: number }>}
 */
export async function checkRateLimit(route, request, limit = RATE_LIMIT_PER_MIN) {
  const ip = getClientIp(request);
  const key = `ratelimit:${route}:${ip}`;
  const count = await redisIncrFixedWindow(key, WINDOW_SEC);

  // count === null → Redis indisponible : fail-open.
  if (count == null) {
    return { allowed: true, remaining: limit, retryAfter: 0 };
  }
  if (count > limit) {
    return { allowed: false, remaining: 0, retryAfter: WINDOW_SEC };
  }
  return { allowed: true, remaining: Math.max(0, limit - count), retryAfter: 0 };
}

/**
 * Réponse 429 standard avec Retry-After.
 * @param {number} [retryAfter] — secondes
 * @returns {Response}
 */
export function rateLimitResponse(retryAfter = WINDOW_SEC) {
  return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Retry-After': String(retryAfter || WINDOW_SEC),
    },
  });
}
