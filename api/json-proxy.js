/**
 * api/json-proxy.js — Vercel Edge Function
 * Proxy JSON générique pour APIs externes (CORS bypass).
 * Miroir prod du plugin Vite src/plugins/json-proxy.ts.
 *
 * Endpoint: GET /api/json-proxy?url=<api_url>
 * Response: Le JSON de l'API externe tel quel.
 *
 * Domaines whitelistés : api.ransomware.live, services.nvd.nist.gov
 */

export const config = { runtime: 'edge' };

const ALLOWED_DOMAINS = [
  'api.ransomware.live',
  'ransomware.live',
  'services.nvd.nist.gov',
  'nvd.nist.gov',
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
    const resp = await fetch(targetUrl, {
      headers: {
        'User-Agent': ua,
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `Upstream HTTP ${resp.status} ${resp.statusText}`, proxyError: true }), {
        status: resp.status,
        headers: JSON_HEADERS,
      });
    }

    const data = await resp.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        ...JSON_HEADERS,
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Fetch failed', proxyError: true }), {
      status: 502,
      headers: JSON_HEADERS,
    });
  }
}
