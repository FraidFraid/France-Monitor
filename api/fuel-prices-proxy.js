import { safeFetch, readCapped, SafeFetchError, MAX_RESPONSE_BYTES } from './utils/safe-fetch.js';
import { checkRateLimit, rateLimitResponse } from './utils/rate-limit.js';

export const config = { runtime: 'edge' };

const ALLOWED_DOMAINS = [
  'data.economie.gouv.fr',
  'opendatamef.opendatasoft.com',
];

function isAllowedDomain(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return ALLOWED_DOMAINS.includes(hostname);
  } catch {
    return false;
  }
}

function buildOpendatasoftFallbackUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.hostname.toLowerCase() !== 'data.economie.gouv.fr') return null;
    parsed.hostname = 'opendatamef.opendatasoft.com';
    return parsed.toString();
  } catch {
    return null;
  }
}

export default async function handler(request) {
  const rl = await checkRateLimit('fuel-prices-proxy', request);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter);

  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url');

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing ?url= parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!isAllowedDomain(targetUrl)) {
    let targetHost = 'invalid-url';
    try {
      targetHost = new URL(targetUrl).hostname.toLowerCase();
    } catch {
      targetHost = 'invalid-url';
    }
    console.error('[fuel-prices-proxy] 403 domain_not_allowed', JSON.stringify({
      reqUrl: request.url,
      targetUrl,
      targetHost,
      allowedDomains: ALLOWED_DOMAINS,
      vercelEnv: process.env.VERCEL_ENV ?? null,
    }));
    return new Response(JSON.stringify({ error: 'Domain not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // safeFetch : redirections revalidées contre l'allowlist (anti-SSRF).
    // Le fetchOptions est réutilisé pour la requête primaire et le fallback.
    const fetchOpts = { method: 'GET', signal: AbortSignal.timeout(20_000) };
    let { response: resp } = await safeFetch(targetUrl, ALLOWED_DOMAINS, fetchOpts);

    if (resp.status === 403) {
      const fallbackUrls = [buildOpendatasoftFallbackUrl(targetUrl)].filter(Boolean);
      for (const fallbackUrl of fallbackUrls) {
        // Le fallback (opendatasoft) est aussi validé par safeFetch.
        const { response: fallbackResp } = await safeFetch(fallbackUrl, ALLOWED_DOMAINS, fetchOpts);
        resp = fallbackResp;
        if (fallbackResp.ok) break;
      }
    }

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `Upstream HTTP ${resp.status}`, proxyError: true }), {
        status: resp.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Octets bruts (plafonnés) : passthrough fidèle avec le content-type upstream.
    const body = await readCapped(resp, MAX_RESPONSE_BYTES);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': resp.headers.get('content-type') ?? 'application/json; charset=utf-8',
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    if (error instanceof SafeFetchError) {
      const status = error.code === 'DOMAIN_NOT_ALLOWED' || error.code === 'INVALID_URL' ? 403 : 502;
      return new Response(JSON.stringify({ error: 'Fetch refused', code: error.code, proxyError: true }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Fetch failed',
      proxyError: true,
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
