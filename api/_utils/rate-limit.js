// api/utils/rate-limit.js
// Rate limiting fenêtre fixe par IP et par route, adossé au wrapper Redis Upstash.
// Si Redis est indisponible, le compte se fait dans la mémoire du process (plus de fail-open, audit du 13/11/2026).

import { redisIncrFixedWindow } from './redis.js';

/** Limite par défaut : requêtes par IP par route et par fenêtre. */
export const RATE_LIMIT_PER_MIN = 60;

/** Durée de la fenêtre fixe, en secondes. */
export const WINDOW_SEC = 60;

/** Une adresse IP et rien d'autre : la valeur entre dans une clé Redis, elle ne doit pas être un texte libre. */
const IP_RE = /^[0-9a-fA-F:.]{3,45}$/;

/**
 * Extrait l'IP cliente. En production l'origine n'accepte que Cloudflare (deploy/oracle/Caddyfile, cloudflare_only), qui
 * écrase toujours cf-connecting-ip : c'est la seule valeur que le visiteur ne choisit pas. Le premier élément de
 * x-forwarded-for, lui, est fourni par le client (Cloudflare ajoute la vraie adresse à la suite) : il ne sert qu'en repli,
 * hors Cloudflare (poste de développement).
 * @param {Request} request
 * @returns {string}
 */
export function getClientIp(request) {
  const candidates = [
    request.headers.get('cf-connecting-ip'),
    request.headers.get('x-real-ip'),
    (request.headers.get('x-forwarded-for') || '').split(',')[0],
  ];
  for (const candidate of candidates) {
    const ip = String(candidate || '').trim();
    if (ip && IP_RE.test(ip)) return ip;
  }
  return 'unknown';
}

/** Compteurs de repli (fenêtre fixe) quand Redis ne répond pas ; table bornée, purgée des fenêtres échues. */
/** @type {Map<string, { count: number, resetAt: number }>} */
const memoryWindows = new Map();
const MEMORY_MAX_KEYS = 20_000;

/** @param {string} key @param {number} now */
function memoryIncr(key, now) {
  const entry = memoryWindows.get(key);
  if (entry && now < entry.resetAt) {
    entry.count += 1;
    return entry.count;
  }
  if (memoryWindows.size >= MEMORY_MAX_KEYS) {
    for (const [k, v] of memoryWindows) if (now >= v.resetAt) memoryWindows.delete(k);
    // Table encore pleine (afflux d'adresses) : on repart de zéro plutôt que de grossir sans fin.
    if (memoryWindows.size >= MEMORY_MAX_KEYS) memoryWindows.clear();
  }
  memoryWindows.set(key, { count: 1, resetAt: now + WINDOW_SEC * 1000 });
  return 1;
}

/**
 * Requête Node (en-têtes en objet) vue comme une Request pour checkRateLimit.
 * @param {{ headers?: Record<string, string | string[] | undefined> }} req
 * @returns {Request}
 */
export function asRateLimitRequest(req) {
  return /** @type {Request} */ (/** @type {unknown} */ ({
    headers: {
      /** @param {string} name */
      get(name) {
        const value = req.headers?.[name.toLowerCase()];
        if (Array.isArray(value)) return value[0] ?? null;
        return value ?? null;
      },
    },
  }));
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
  // Redis indisponible (null) : compteur de ce process. La limite ne s'ouvre plus quand Redis tombe ou que son quota est épuisé.
  const count = (await redisIncrFixedWindow(key, WINDOW_SEC)) ?? memoryIncr(key, Date.now());
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
