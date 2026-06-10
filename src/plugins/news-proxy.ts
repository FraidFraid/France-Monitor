// src/plugins/news-proxy.ts
// Vite dev proxy for /api/news and /api/news/history.
//
// Mirrors the production Vercel functions by importing their shared query
// logic directly (queryNews / queryNewsHistory from api/news.js and
// api/news/history.js). If DATABASE_URL is not configured, both routes
// answer 503 so the client can exercise its fallback path in dev.

import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { queryNews } from '../../api/news.js';
import { queryNewsHistory } from '../../api/news/history.js';

interface NewsProxyOptions {
  /** Neon Postgres connection string (defaults to process.env.DATABASE_URL). */
  databaseUrl?: string;
}

interface QueryResult {
  status: number;
  body: object;
}

type QueryFn = (searchParams: URLSearchParams) => Promise<QueryResult>;

function makeMiddleware(query: QueryFn) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    query(url.searchParams)
      .then(({ status, body }) => {
        res.statusCode = status;
        res.end(JSON.stringify(body));
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'unknown error';
        console.error('[news-proxy] request failed:', message);
        res.statusCode = 503;
        res.end(JSON.stringify({ error: 'news database unavailable' }));
      });
  };
}

export function newsProxyPlugin(options: NewsProxyOptions = {}): Plugin {
  return {
    name: 'news-proxy',
    configureServer(server) {
      // Make the connection string visible to the shared query functions,
      // which read process.env.DATABASE_URL (same code path as production).
      if (options.databaseUrl && !process.env.DATABASE_URL) {
        process.env.DATABASE_URL = options.databaseUrl;
      }

      // Register the more specific path first: connect's `use('/api/news')`
      // would otherwise also swallow /api/news/history.
      server.middlewares.use('/api/news/history', makeMiddleware(queryNewsHistory as QueryFn));
      server.middlewares.use('/api/news', makeMiddleware(queryNews as QueryFn));
    },
  };
}
