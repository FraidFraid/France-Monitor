import type { Plugin } from 'vite';

const ALLOWED_DOMAINS = [
  'data.economie.gouv.fr',
  'www.data.economie.gouv.fr',
  'opendatamef.opendatasoft.com',
  'odre.opendatasoft.com',
];

function isAllowedDomain(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_DOMAINS.some((domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function buildOpendatasoftFallbackUrl(targetUrl: string): string | null {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.hostname !== 'data.economie.gouv.fr' && parsed.hostname !== 'www.data.economie.gouv.fr') return null;
    parsed.hostname = 'opendatamef.opendatasoft.com';
    return parsed.toString();
  } catch {
    return null;
  }
}

function buildOdreFallbackUrl(targetUrl: string): string | null {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.hostname !== 'data.economie.gouv.fr' && parsed.hostname !== 'www.data.economie.gouv.fr') return null;
    parsed.hostname = 'odre.opendatasoft.com';
    return parsed.toString();
  } catch {
    return null;
  }
}

export function fuelPricesProxyPlugin(): Plugin {
  return {
    name: 'fuel-prices-proxy',
    configureServer(server) {
      server.middlewares.use('/api/fuel-prices-proxy', async (req, res) => {
        const incoming = new URL(req.url ?? '', 'http://localhost');
        const targetUrl = incoming.searchParams.get('url');

        if (!targetUrl) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Missing ?url= parameter' }));
          return;
        }

        if (!isAllowedDomain(targetUrl)) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Domain not allowed' }));
          return;
        }

        try {
          const browserLikeHeaders = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json,text/json;q=0.9,*/*;q=0.8',
            'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Referer': 'https://data.economie.gouv.fr/',
            'Origin': 'https://data.economie.gouv.fr',
          };

          let upstream = await fetch(targetUrl, {
            headers: {
              ...browserLikeHeaders,
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(20_000),
          });

          if (upstream.status === 403) {
            const fallbackUrls = [buildOpendatasoftFallbackUrl(targetUrl), buildOdreFallbackUrl(targetUrl)].filter((entry): entry is string => Boolean(entry));
            for (const fallbackUrl of fallbackUrls) {
              const fallbackUpstream = await fetch(fallbackUrl, {
                headers: {
                  ...browserLikeHeaders,
                },
                redirect: 'follow',
                signal: AbortSignal.timeout(20_000),
              });
              if (fallbackUpstream.ok) {
                upstream = fallbackUpstream;
                break;
              }
              upstream = fallbackUpstream;
            }
          }

          if (!upstream.ok) {
            res.statusCode = upstream.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `Upstream HTTP ${upstream.status}`, proxyError: true }));
            return;
          }

          const body = await upstream.text();
          res.statusCode = 200;
          res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=300');
          res.end(body);
        } catch (error) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            error: error instanceof Error ? error.message : 'Fetch failed',
            proxyError: true,
          }));
        }
      });
    },
  };
}
