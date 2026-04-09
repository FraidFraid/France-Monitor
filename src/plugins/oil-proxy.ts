import type { Plugin } from 'vite';

const ALLOWED_DOMAINS = [
  'www.statistiques.developpement-durable.gouv.fr',
  'statistiques.developpement-durable.gouv.fr',
  'www.data.gouv.fr',
  'data.gouv.fr',
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

function isAllowedDomain(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_DOMAINS.some((domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export function oilProxyPlugin(): Plugin {
  return {
    name: 'oil-proxy',
    configureServer(server) {
      server.middlewares.use('/api/oil-proxy', async (req, res) => {
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
          const upstream = await fetch(targetUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/json,text/csv,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
              'Cache-Control': 'no-cache',
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(30_000),
          });

          if (!upstream.ok) {
            res.statusCode = upstream.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `Upstream HTTP ${upstream.status}` }));
            return;
          }

          const contentType = upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8';
          const isBinary = /application\/(x-zip-compressed|zip|octet-stream)/i.test(contentType);
          const body = isBinary
            ? Buffer.from(await upstream.arrayBuffer())
            : await upstream.text();
          res.statusCode = 200;
          res.setHeader('Content-Type', contentType);
          res.setHeader('Cache-Control', 'public, max-age=900');
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
