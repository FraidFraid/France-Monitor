// src/plugins/api-router-fallback.ts
//
// Filet de secours dev : sert toute requête /api/* non prise en charge par un
// plugin dev dédié (les src/plugins/*-proxy.ts existants) en appelant le même
// routeur que la production, api/_utils/dispatch.js (voir api/index.js). Permet
// d'ajouter un nouveau endpoint sous api/_handlers/ sans écrire de plugin Vite
// dédié à chaque fois.
//
// DOIT être enregistré EN DERNIER dans la liste des plugins de vite.config.ts
// pour laisser les proxies dev existants répondre en priorité (voir le audit
// 2026-09 : ce fichier ne modifie pas vite.config.ts lui-même).
//
// Vercel fournit en prod `req.query`, `res.status()/.json()/.send()` et un
// `req.body` déjà parsé pour les requêtes JSON (voir le commentaire de
// readRawBody dans dispatch.js) : ce plugin reconstitue ces helpers pour que
// les handlers sous api/_handlers/ se comportent pareil en dev.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv, type ConfigEnv, type Plugin, type UserConfig, type ViteDevServer } from 'vite';

/** Sous-ensemble de req.query façon Vercel : chaîne, ou tableau si la clé est répétée. */
type QueryValue = string | string[];

/** IncomingMessage enrichi des helpers Vercel-like attendus par les handlers sous api/_handlers/. */
interface VercelLikeRequest extends IncomingMessage {
  query?: Record<string, QueryValue>;
  body?: unknown;
}

/** ServerResponse enrichi des helpers Vercel-like attendus par les handlers sous api/_handlers/. */
interface VercelLikeResponse extends ServerResponse {
  status(code: number): VercelLikeResponse;
  json(payload: unknown): VercelLikeResponse;
  send(body: unknown): VercelLikeResponse;
}

/** Signature du module api/_utils/dispatch.js (JS sans déclaration de types). */
interface DispatchModule {
  dispatch: (req: VercelLikeRequest, res: VercelLikeResponse) => Promise<void>;
}

function toQueryObject(searchParams: URLSearchParams): Record<string, QueryValue> {
  const query: Record<string, QueryValue> = {};
  for (const [key, value] of searchParams) {
    const prev = query[key];
    if (prev === undefined) query[key] = value;
    else query[key] = Array.isArray(prev) ? [...prev, value] : [prev, value];
  }
  return query;
}

function withVercelHelpers(res: ServerResponse): VercelLikeResponse {
  const enriched = res as VercelLikeResponse;
  enriched.status = function status(code: number): VercelLikeResponse {
    enriched.statusCode = code;
    return enriched;
  };
  enriched.json = function json(payload: unknown): VercelLikeResponse {
    enriched.setHeader('Content-Type', 'application/json; charset=utf-8');
    enriched.end(JSON.stringify(payload));
    return enriched;
  };
  enriched.send = function send(body: unknown): VercelLikeResponse {
    if (typeof body === 'object' && body !== null) return enriched.json(body);
    enriched.end(body === undefined ? undefined : String(body));
    return enriched;
  };
  return enriched;
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

/** Parse un corps JSON façon Vercel Node runtime (req.body déjà parsé) — no-op hors POST/PUT/PATCH JSON. */
async function attachParsedJsonBody(req: VercelLikeRequest): Promise<void> {
  const method = req.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.includes('application/json')) return;
  try {
    const raw = await readRequestBody(req);
    req.body = raw.length > 0 ? JSON.parse(raw.toString('utf8')) : undefined;
  } catch {
    req.body = undefined; // corps JSON malformé : le handler répondra 400 sur un corps vide.
  }
}

export function apiRouterFallbackPlugin(): Plugin {
  return {
    name: 'api-router-fallback',
    config(_config: UserConfig, { mode }: ConfigEnv) {
      // Charge les .env dans process.env pour que les handlers sous api/_handlers/
      // (process.env.XXX) retrouvent les mêmes clés qu'en prod, sans écraser une
      // variable déjà présente dans l'environnement (shell, CI…).
      const env = loadEnv(mode, process.cwd(), '');
      for (const [key, value] of Object.entries(env)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/')) {
          next();
          return;
        }

        try {
          const { dispatch } = (await import('../../api/_utils/dispatch.js')) as unknown as DispatchModule;
          const vercelReq = req as VercelLikeRequest;
          const vercelRes = withVercelHelpers(res);
          const parsedUrl = new URL(url, 'http://localhost');
          vercelReq.query = toQueryObject(parsedUrl.searchParams);
          await attachParsedJsonBody(vercelReq);
          await dispatch(vercelReq, vercelRes);
        } catch (err) {
          next(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
  };
}
