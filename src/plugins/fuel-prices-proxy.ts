import type { Plugin } from 'vite';

const ALLOWED_DOMAINS = [
  'data.economie.gouv.fr',
  'opendatamef.opendatasoft.com',
];

function isAllowedDomain(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return ALLOWED_DOMAINS.includes(hostname);
  } catch {
    return false;
  }
}

function buildOpendatasoftFallbackUrl(targetUrl: string): string | null {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.hostname.toLowerCase() !== 'data.economie.gouv.fr') return null;
    parsed.hostname = 'opendatamef.opendatasoft.com';
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
          let upstream = await fetch(targetUrl, {
            method: 'GET',
            signal: AbortSignal.timeout(20_000),
          });

          if (upstream.status === 403) {
            const fallbackUrls = [buildOpendatasoftFallbackUrl(targetUrl)].filter((entry): entry is string => Boolean(entry));
            for (const fallbackUrl of fallbackUrls) {
              const fallbackUpstream = await fetch(fallbackUrl, {
                method: 'GET',
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
