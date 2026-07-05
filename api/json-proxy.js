/**
 * api/json-proxy.js — Vercel Edge Function
 * Proxy JSON générique pour APIs externes (CORS bypass).
 * Miroir prod du plugin Vite src/plugins/json-proxy.ts.
 *
 * Endpoint: GET /api/json-proxy?url=<api_url>
 * Response: Le JSON de l'API externe tel quel.
 * Domaines whitelistés : api.ransomware.live, data.ransomware.live, services.nvd.nist.gov
 */

import { safeFetch, readCapped, SafeFetchError, MAX_RESPONSE_BYTES } from './utils/safe-fetch.js';
import { checkRateLimit, rateLimitResponse } from './utils/rate-limit.js';

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

/** @param {string} url */
function isAllowedDomain(url) {
  try {
    const { hostname } = new URL(url);
    return ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch {
    return false;
  }
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
    });

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `Upstream HTTP ${resp.status} ${resp.statusText}`, proxyError: true }), {
        status: resp.status,
        headers: JSON_HEADERS,
      });
    }

    const bytes = await readCapped(resp, MAX_RESPONSE_BYTES);
    const data = JSON.parse(new TextDecoder().decode(bytes));
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        ...JSON_HEADERS,
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
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
