// api/health-check.js
// Endpoint public GET de santé opérationnelle — cible des sondes de monitoring.
//
// Agrège deux signaux :
//   - ingest : dernier tick du cron d'ingestion (clé Redis `ingest:last-tick`),
//   - articles : âge du dernier article inséré (Neon Postgres).
//
// Statut : 'ok' si tick < 45 min ET article < 90 min ; 'degraded' si le tick
// est frais mais les articles sont vieux ; 'down' sinon. Jamais de cache.
//
// Seuils calés sur le cron d'ingestion qui tourne toutes les 30 min (Upstash QStash) :
// une marge de 45/90 min absorbe un tick manqué ou retardé sans faux « down ».
//
// Node runtime (dépend de api/_lib/db.js → node:crypto). Sans DATABASE_URL → 503.
//
// Identifiants externes (20/10/2026) : `credentials.cdse` dit si Copernicus Data Space accepte le client OAuth des images NDWI
// des crues (refusé le 20/10 sans que rien ne le signale). Testé au plus une fois par heure ; n'entre pas dans `status`.

import { getDb, hasDatabaseUrl } from '../_lib/db.js';
import { redisGet } from '../_utils/redis.js';

const LAST_TICK_KEY = 'ingest:last-tick';
const CDSE_TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const CDSE_CHECK_EVERY_MS = 60 * 60_000;
/** @type {{ at: number, value: { state: 'ok' | 'refused' | 'unreachable' | 'unconfigured', httpStatus: number | null, checkedAt: string } } | null} */
let cdseCheck = null;

/**
 * État du client OAuth CDSE (fonction pure) : 2xx accepté, 400/401/403 refusé, autre réponse ou échec réseau injoignable.
 * @param {number | null} httpStatus  null : pas de réponse
 * @returns {'ok' | 'refused' | 'unreachable'}
 */
export function cdseState(httpStatus) {
  if (httpStatus === null) return 'unreachable';
  if (httpStatus >= 200 && httpStatus < 300) return 'ok';
  if (httpStatus === 400 || httpStatus === 401 || httpStatus === 403) return 'refused';
  return 'unreachable';
}

/**
 * Demande un jeton CDSE (au plus une fois par heure, résultat gardé en mémoire). Jamais d'exception, jamais de secret renvoyé.
 * @param {number} now
 */
async function checkCdse(now) {
  if (cdseCheck && now - cdseCheck.at < CDSE_CHECK_EVERY_MS) return cdseCheck.value;
  const checkedAt = new Date(now).toISOString();
  if (!process.env.CDSE_CLIENT_ID || !process.env.CDSE_CLIENT_SECRET) {
    cdseCheck = { at: now, value: { state: 'unconfigured', httpStatus: null, checkedAt } };
    return cdseCheck.value;
  }
  let httpStatus = null;
  try {
    const body = new URLSearchParams({
      grant_type: 'client_credentials', client_id: process.env.CDSE_CLIENT_ID, client_secret: process.env.CDSE_CLIENT_SECRET,
    });
    const response = await fetch(CDSE_TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(8_000),
    });
    httpStatus = response.status;
  } catch {
    httpStatus = null;
  }
  cdseCheck = { at: now, value: { state: cdseState(httpStatus), httpStatus, checkedAt } };
  return cdseCheck.value;
}
const OK_TICK_MAX_MS = 45 * 60_000;
const OK_ARTICLE_MAX_MS = 90 * 60_000;

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
  const cdse = await checkCdse(now);

  json(res, 200, {
    status,
    checkedAt: new Date(now).toISOString(),
    ingest: { lastTick, lastTickAgeMs },
    articles: { lastArticleAt, lastArticleAgeMs, error: dbError },
    credentials: { cdse },
  });
}
