export const config = { runtime: 'edge' };

const ALLOWED_DOMAINS = [
  'data.economie.gouv.fr',
  'opendatamef.opendatasoft.com',
];

function isAllowedDomain(url) {
  try {
    const parsed = new URL(url);
    return ALLOWED_DOMAINS.some((domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function buildOpendatasoftFallbackUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.hostname !== 'data.economie.gouv.fr') return null;
    parsed.hostname = 'opendatamef.opendatasoft.com';
    return parsed.toString();
  } catch {
    return null;
  }
}

export default async function handler(request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url');

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing ?url= parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!isAllowedDomain(targetUrl)) {
    return new Response(JSON.stringify({ error: 'Domain not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    let resp = await fetch(targetUrl, {
      headers: {
        'Accept': 'application/json,text/json;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });

    if (resp.status === 403) {
      const fallbackUrl = buildOpendatasoftFallbackUrl(targetUrl);
      if (fallbackUrl) {
        resp = await fetch(fallbackUrl, {
          headers: {
            'Accept': 'application/json,text/json;q=0.9,*/*;q=0.8',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(20_000),
        });
      }
    }

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `Upstream HTTP ${resp.status}`, proxyError: true }), {
        status: resp.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await resp.text();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': resp.headers.get('content-type') ?? 'application/json; charset=utf-8',
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Fetch failed',
      proxyError: true,
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
