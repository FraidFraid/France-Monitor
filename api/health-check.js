// api/health-check.js
// Endpoint public GET de santé opérationnelle — cible des sondes de monitoring.
//
// Agrège deux signaux :
//   - ingest : dernier tick du cron d'ingestion (clé Redis `ingest:last-tick`),
//   - articles : âge du dernier article inséré (Neon Postgres).
//
// Statut : 'ok' si tick < 15 min ET article < 60 min ; 'degraded' si le tick
// est frais mais les articles sont vieux ; 'down' sinon. Jamais de cache.
//
// Node runtime (dépend de api/_lib/db.js → node:crypto). Sans DATABASE_URL → 503.

import { getDb, hasDatabaseUrl } from './_lib/db.js';
import { redisGet } from './utils/redis.js';

const LAST_TICK_KEY = 'ingest:last-tick';
const OK_TICK_MAX_MS = 15 * 60_000;
const OK_ARTICLE_MAX_MS = 60 * 60_000;

/**
 * Statut de santé (fonction pure, testable).
 * @param {number | null} lastTickAgeMs   âge du dernier tick d'ingestion
 * @param {number | null} lastArticleAgeMs âge du dernier article inséré
 * @returns {'ok' | 'degraded' | 'down'}
 */
export function computeHealthStatus(lastTickAgeMs, lastArticleAgeMs) {
  const tickOk = lastTickAgeMs !== null && lastTickAgeMs < OK_TICK_MAX_MS;
  const articleOk = lastArticleAgeMs !== null && lastArticleAgeMs < OK_ARTICLE_MAX_MS;
  if (tickOk && articleOk) return 'ok';
  if (tickOk) return 'degraded';
  return 'down';
}

/**
 * @param {{ statusCode: number, setHeader: (k: string, v: string) => void, end: (b?: string) => void }} res
 * @param {number} status
 * @param {unknown} payload
 */
function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

/**
 * Lit et parse `ingest:last-tick` depuis Redis (best-effort, never-throws).
 * @param {number} now
 * @returns {Promise<{ lastTick: unknown, lastTickAgeMs: number | null }>}
 */
async function readLastTick(now) {
  const raw = await redisGet(LAST_TICK_KEY);
  if (!raw) return { lastTick: null, lastTickAgeMs: null };
  try {
    const lastTick = JSON.parse(raw);
    const ts = typeof lastTick?.timestamp === 'string' ? Date.parse(lastTick.timestamp) : NaN;
    return { lastTick, lastTickAgeMs: Number.isNaN(ts) ? null : now - ts };
  } catch {
    return { lastTick: null, lastTickAgeMs: null };
  }
}

/**
 * Âge du dernier article inséré via le client Neon partagé.
 * @param {number} now
 * @returns {Promise<{ lastArticleAt: string | null, lastArticleAgeMs: number | null, error: string | null }>}
 */
async function readLastArticle(now) {
  try {
    const sql = getDb();
    const rows = await sql`SELECT max(collected_at) AS last FROM news_items`;
    const last = rows?.[0]?.last ?? null;
    if (!last) return { lastArticleAt: null, lastArticleAgeMs: null, error: null };
    const date = new Date(last);
    const time = date.getTime();
    if (Number.isNaN(time)) return { lastArticleAt: null, lastArticleAgeMs: null, error: null };
    return { lastArticleAt: date.toISOString(), lastArticleAgeMs: now - time, error: null };
  } catch (err) {
    return {
      lastArticleAt: null,
      lastArticleAgeMs: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * @param {{ method?: string }} req
 * @param {{ statusCode: number, setHeader: (k: string, v: string) => void, end: (b?: string) => void }} res
 */
export default async function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (!hasDatabaseUrl()) {
    json(res, 503, {
      status: 'down',
      error: 'DATABASE_URL not configured',
      ingest: null,
      articles: null,
    });
    return;
  }

  const now = Date.now();
  const { lastTick, lastTickAgeMs } = await readLastTick(now);
  const { lastArticleAt, lastArticleAgeMs, error: dbError } = await readLastArticle(now);

  const status = computeHealthStatus(lastTickAgeMs, lastArticleAgeMs);

  json(res, 200, {
    status,
    checkedAt: new Date(now).toISOString(),
    ingest: { lastTick, lastTickAgeMs },
    articles: { lastArticleAt, lastArticleAgeMs, error: dbError },
  });
}
