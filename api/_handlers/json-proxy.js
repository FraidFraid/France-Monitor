/**
 * api/json-proxy.js — Vercel Edge Function
 * Proxy JSON générique pour APIs externes (CORS bypass).
 * Miroir prod du plugin Vite src/plugins/json-proxy.ts.
 *
 * Endpoint: GET /api/json-proxy?url=<api_url>
 * Response: Le JSON de l'API externe tel quel.
 * Domaines whitelistés : api.ransomware.live, data.ransomware.live, services.nvd.nist.gov, vigicrues.gouv.fr
 *
 * Root cause du 502 sur ransomware.live (audit 2026-09) : data.ransomware.live/posts.json
 * pèse ~21 Mo côté amont (200 OK vérifié en direct), largement au-dessus du plafond
 * anti-SSRF par défaut MAX_RESPONSE_BYTES (5 Mo) de safe-fetch.js → readCapped()
 * levait RESPONSE_TOO_LARGE, remonté ici en 502. Ce host obtient donc un plafond
 * dédié plus généreux ; les autres domaines gardent le plafond par défaut.
 */

import { safeFetch, readCapped, SafeFetchError, MAX_RESPONSE_BYTES } from '../_utils/safe-fetch.js';
import { checkRateLimit, rateLimitResponse } from '../_utils/rate-limit.js';

export const config = { runtime: 'edge' };

const ALLOWED_DOMAINS = [
  'api.ransomware.live',
  'data.ransomware.live',
  'ransomware.live',
  'services.nvd.nist.gov',
  'nvd.nist.gov',
  // Vigicrues (crues) — l'API ne renvoie PAS de header CORS, le fetch navigateur
  // direct est bloqué en prod → on passe par ce proxy serveur.
  'vigicrues.gouv.fr',
];

// posts.json grossit avec le temps (~21 Mo en 2026-09) : marge au-delà du plafond par défaut.
const RANSOMWARE_MAX_RESPONSE_BYTES = 30 * 1024 * 1024;

/** @param {string} url */
function isAllowedDomain(url) {
  try {
    const { hostname } = new URL(url);
    return ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch {
    return false;
  }
}

/** @param {string} hostname */
function isRansomwareHost(hostname) {
  return hostname === 'ransomware.live' || hostname.endsWith('.ransomware.live');
}

/** @param {string} hostname */
function isNvdHost(hostname) {
  return hostname === 'nvd.nist.gov' || hostname.endsWith('.nvd.nist.gov');
}

/** @param {string} hostname */
function isVigicruesHost(hostname) {
  return hostname === 'vigicrues.gouv.fr' || hostname.endsWith('.vigicrues.gouv.fr');
}

/** Plafond de taille de réponse par host (RESPONSE_TOO_LARGE). @param {string} hostname */
function maxBytesForHost(hostname) {
  return isRansomwareHost(hostname) ? RANSOMWARE_MAX_RESPONSE_BYTES : MAX_RESPONSE_BYTES;
}

/** Cache-Control CDN par host, sur succès uniquement. @param {string} hostname */
function cacheControlForHost(hostname) {
  if (isRansomwareHost(hostname)) return 'public, s-maxage=600, stale-while-revalidate=120';
  if (isNvdHost(hostname)) return 'public, s-maxage=3600, stale-while-revalidate=600';
  if (isVigicruesHost(hostname)) return 'public, s-maxage=300, stale-while-revalidate=60';
  return 'public, s-maxage=300, stale-while-revalidate=60';
}

/** Fenêtre conservée pour posts.json : les consommateurs (cyber.ts, threat-map.ts) ne lisent que 30 jours. */
const RANSOMWARE_POSTS_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;

/**
 * data.ransomware.live/posts.json pèse ≈ 21 Mo (32 000 victimes depuis 2013) alors qu'une fonction
 * Vercel ne peut pas renvoyer plus de 4,5 Mo : on ne relaie que les 45 derniers jours (≈ 300 Ko).
 * Pure et exportée pour les tests.
 * @param {string} targetUrl
 * @param {unknown} data
 * @param {number} [now]
 * @returns {unknown}
 */
export function trimUpstreamPayload(targetUrl, data, now = Date.now()) {
  let url;
  try { url = new URL(targetUrl); } catch { return data; }
  if (!isRansomwareHost(url.hostname) || url.pathname !== '/posts.json' || !Array.isArray(data)) return data;
  const cutoff = now - RANSOMWARE_POSTS_WINDOW_MS;
  return data.filter((post) => {
    const discovered = post && typeof post === 'object' ? Date.parse(String(/** @type {{ discovered?: unknown }} */ (post).discovered ?? '')) : NaN;
    return Number.isFinite(discovered) && discovered >= cutoff;
  });
}

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

/**
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export default async function handler(request) {
  const rl = await checkRateLimit('json-proxy', request);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter);

  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url');

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing ?url= parameter' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  if (!isAllowedDomain(targetUrl)) {
    return new Response(JSON.stringify({ error: 'Domain not allowed' }), {
      status: 403,
      headers: JSON_HEADERS,
    });
  }

  const targetHostname = new URL(targetUrl).hostname;
  const maxBytes = maxBytesForHost(targetHostname);

  try {
    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    // safeFetch : redirections revalidées contre l'allowlist (anti-SSRF)
    const { response: resp } = await safeFetch(targetUrl, ALLOWED_DOMAINS, {
      headers: {
        'User-Agent': ua,
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(20_000),
    }, { maxBytes });

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `Upstream HTTP ${resp.status} ${resp.statusText}`, proxyError: true }), {
        status: resp.status,
        headers: JSON_HEADERS,
      });
    }

    const bytes = await readCapped(resp, maxBytes);
    const data = trimUpstreamPayload(targetUrl, JSON.parse(new TextDecoder().decode(bytes)));
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        ...JSON_HEADERS,
        'Cache-Control': cacheControlForHost(targetHostname),
      },
    });
  } catch (err) {
    if (err instanceof SafeFetchError) {
      const status = err.code === 'DOMAIN_NOT_ALLOWED' || err.code === 'INVALID_URL' ? 403 : 502;
      return new Response(JSON.stringify({ error: 'Fetch refused', code: err.code, proxyError: true }), {
        status,
        headers: JSON_HEADERS,
      });
    }
    return new Response(JSON.stringify({ error: err.message || 'Fetch failed', proxyError: true }), {
      status: 502,
      headers: JSON_HEADERS,
    });
  }
}
