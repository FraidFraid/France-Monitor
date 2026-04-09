export const config = { runtime: 'edge' };

const ALLOWED_DOMAINS = [
  'www.statistiques.developpement-durable.gouv.fr',
  'statistiques.developpement-durable.gouv.fr',
  'www.data.gouv.fr',
  'data.gouv.fr',
  'data.statistiques.development-durable.gouv.fr',
  'data.statistiques.developpement-durable.gouv.fr',
  'www.insee.fr',
  'insee.fr',
  'www.energiesetmobilites.fr',
  'energiesetmobilites.fr',
  'carbu.com',
  'api.carbu.com',
  'www.jodidata.org',
  'jodidata.org',
];

function isAllowedDomain(url) {
  try {
    const parsed = new URL(url);
    return ALLOWED_DOMAINS.some((domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`));
  } catch {
    return false;
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
    const resp = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/json,text/csv,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `Upstream HTTP ${resp.status}` }), {
        status: resp.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const contentType = resp.headers.get('content-type') ?? 'text/plain; charset=utf-8';
    const isBinary = /application\/(x-zip-compressed|zip|octet-stream)/i.test(contentType);
    const body = isBinary ? await resp.arrayBuffer() : await resp.text();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=300',
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
