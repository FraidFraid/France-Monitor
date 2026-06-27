/**
 * json-proxy.ts — Plugin Vite qui proxy les requêtes vers des APIs JSON externes.
 * Utilisé pour contourner les restrictions CORS sur RansomwareLive et NVD.
 *
 * Endpoint: /api/json-proxy?url=<api_url>
 * Response: Le JSON de l'API externe tel quel
 */

import type { Plugin } from 'vite';

// Whitelist des domaines autorisés (sécurité)
const ALLOWED_DOMAINS = [
  'api.ransomware.live',
  'data.ransomware.live',
  'ransomware.live',
  'services.nvd.nist.gov',
  'nvd.nist.gov',
  // Vigicrues (crues) — pas de header CORS, fetch navigateur bloqué en prod.
  'vigicrues.gouv.fr',
];

function isAllowedDomain(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return ALLOWED_DOMAINS.some(domain =>
      parsedUrl.hostname === domain || parsedUrl.hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

export function jsonProxyPlugin(): Plugin {
  return {
    name: 'json-proxy',
    configureServer(server) {
      // Register /api/json-proxy endpoint
      server.middlewares.use('/api/json-proxy', async (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost');
        const targetUrl = url.searchParams.get('url');

        if (!targetUrl) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Missing ?url= parameter' }));
          return;
        }

        // Sécurité: vérifier que le domaine est autorisé
        if (!isAllowedDomain(targetUrl)) {
          console.warn('[json-proxy] Blocked unauthorized domain:', targetUrl);
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Domain not allowed' }));
          return;
        }

        try {
          // User-Agent réaliste pour éviter les blocages
          const userAgents = [
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          ];
          const ua = userAgents[Math.floor(Math.random() * userAgents.length)];

          const resp = await fetch(targetUrl, {
            headers: {
              'User-Agent': ua,
              'Accept': 'application/json',
              'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
              'Cache-Control': 'no-cache',
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(30000),
          });

          if (!resp.ok) {
            console.error('[json-proxy] Upstream error:', resp.status, resp.statusText);
            res.statusCode = resp.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              error: `Upstream HTTP ${resp.status} ${resp.statusText}`,
              proxyError: true,
            }));
            return;
          }

          const data = await resp.json();

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=300');
          res.end(JSON.stringify(data));

        } catch (err) {
          console.error('[json-proxy] Fetch error:', targetUrl, err);
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            error: err instanceof Error ? err.message : 'Fetch failed',
            proxyError: true,
          }));
        }
      });
    },
  };
}
