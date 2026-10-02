/**
 * nuclear-proxy.ts — Vite dev proxy pour /api/nuclear/rte-unavailability
 *
 * Reproduit la logique OAuth2 en local pour le développement.
 * Les credentials sont passés depuis vite.config.ts via loadEnv.
 */

import type { Plugin } from 'vite';
// @ts-expect-error — module JS partagé avec la fonction de production
import { fetchAllUnavailabilities } from '../../api/_lib/rte-unavailability-query.js';

const RTE_TOKEN_URL = 'https://digital.iservices.rte-france.com/token/oauth/token';
const API_VERSION   = process.env.RTE_API_VERSION ?? 'v7';
const RTE_UNAV_URL  =
  `https://digital.iservices.rte-france.com/open_api/unavailability_additional_information/${API_VERSION}/generation_unavailabilities`;

const CACHE_TTL_MS = 15 * 60_000;
let _devCache: { data: unknown; fetchedAt: number } | null = null;

export function nuclearProxyPlugin(opts: { clientId: string; clientSecret: string }): Plugin {
  return {
    name: 'nuclear-proxy',
    configureServer(server) {
      server.middlewares.use('/api/nuclear/rte-unavailability', async (_req, res) => {
        if (!opts.clientId || !opts.clientSecret) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'RTE credentials not set in .env', available: false }));
          return;
        }

        if (_devCache && Date.now() - _devCache.fetchedAt < CACHE_TTL_MS) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(_devCache.data));
          return;
        }

        try {
          const tokenResp = await fetch(RTE_TOKEN_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization:
                'Basic ' + Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString('base64'),
            },
            body: 'grant_type=client_credentials',
            signal: AbortSignal.timeout(10_000),
          });

          if (!tokenResp.ok) {
            const body = await tokenResp.text().catch(() => '');
            console.error('[nuclear-proxy] Token error:', tokenResp.status, body);
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `OAuth token failed: ${tokenResp.status}`, available: false }));
            return;
          }

          const { access_token } = (await tokenResp.json()) as { access_token: string };

          const result = await fetchAllUnavailabilities(RTE_UNAV_URL, access_token);
          if (!result.ok) {
            console.error('[nuclear-proxy]', result.error);
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: result.error, available: false }));
            return;
          }
          const items = result.items;

          const payload = { items, available: true, fetchedAt: new Date().toISOString() };
          _devCache = { data: payload, fetchedAt: Date.now() };

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(payload));
        } catch (err) {
          console.error('[nuclear-proxy]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: String(err), available: false }));
        }
      });
    },
  };
}
