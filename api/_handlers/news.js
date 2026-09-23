// api/_handlers/news.js
// Vercel Node function — read API for ingested news items (Neon Postgres).
//
// GET /api/news?since=ISO|epochMs&until=ISO|epochMs&before=ISO|epochMs&category=...&severity=a,b&region=...&noise=exclude&limit=500
//   Returns the most recent ingested news items, joined with their feed
//   metadata (name/region/tier), ordered by published_at DESC NULLS LAST.
//   `noise=exclude` drops items Jev flagged as noise (is_noise=true) —
//   no-op until NEWS_SCORING has scored at least some rows.
//
// All SQL is fully parameterized ($1..$n placeholders via sql.query).
// If DATABASE_URL is missing or the DB is unreachable → 503 (the client
// falls back to direct RSS fetching).
//
// relevance/noise/alertable/scope are additive columns (see scripts/init-db.mjs
// and api/ingest/news.ts's ensureJevColumns) that may not exist yet on a given
// deployment — read via `to_jsonb(n)->>'…'` so the query never fails on a
// missing column (to_jsonb of a row only ever contains columns that exist).

import { neon } from '@neondatabase/serverless';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;

/**
 * Dérive le champ `scoredBy` exposé au client depuis `classifier_version`
 * ('kw-1' → keyword pass, 'groq-1'/'groq-2'/… → Groq, 'jev-1'/… → Jev).
 * @param {unknown} classifierVersion
 * @returns {'keywords' | 'groq' | 'jev' | null}
 */
export function scoredByFromVersion(classifierVersion) {
  if (typeof classifierVersion !== 'string' || classifierVersion.length === 0) return null;
  if (classifierVersion.startsWith('jev-')) return 'jev';
  if (classifierVersion.startsWith('groq-')) return 'groq';
  if (classifierVersion.startsWith('kw-')) return 'keywords';
  return null;
}

/**
 * Convertit une ligne SQL (colonnes de base + colonnes Jev optionnelles lues
 * via to_jsonb) en item de réponse `/api/news`. Fonction pure — testable
 * sans base de données.
 * @param {Record<string, unknown>} row
 * @returns {object}
 */
export function mapNewsRow(row) {
  return {
    id: toNumberOrNull(row.id),
    feedId: toStringOrNull(row.feed_id),
    feedName: toStringOrNull(row.feed_name),
    feedRegion: toStringOrNull(row.feed_region),
    tier: toNumberOrNull(row.tier),
    title: toStringOrNull(row.title),
    link: toStringOrNull(row.link),
    description: toStringOrNull(row.description),
    publishedAt: toIsoOrNull(row.published_at),
    collectedAt: toIsoOrNull(row.collected_at),
    category: toStringOrNull(row.category),
    severity: toStringOrNull(row.severity),
    confidence: toNumberOrNull(row.confidence),
    lat: toNumberOrNull(row.lat),
    lon: toNumberOrNull(row.lon),
    scoredBy: scoredByFromVersion(row.classifier_version),
    relevance: toNumberOrNull(row.relevance),
    noise: toBooleanOrNull(row.is_noise),
    alertable: toBooleanOrNull(row.alertable),
    scope: toStringOrNull(row.scope),
  };
}

/**
 * Parse a date query param: ISO 8601 string or epoch milliseconds.
 * Returns a Date, or null if the value is invalid.
 * @param {string | null | undefined} raw
 * @param {Date} fallback
 * @returns {Date | null}
 */
export function parseDateParam(raw, fallback) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const trimmed = String(raw).trim();
  const date = /^\d+$/.test(trimmed) ? new Date(Number(trimmed)) : new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function toIsoOrNull(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function toNumberOrNull(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function toStringOrNull(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

/**
 * @param {unknown} value
 * @returns {boolean | null}
 */
function toBooleanOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

/**
 * Core query logic, shared between the Vercel handler and the Vite dev proxy.
 * @param {URLSearchParams} searchParams
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function queryNews(searchParams) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return { status: 503, body: { error: 'ingestion database not configured' } };
  }

  const since = parseDateParam(searchParams.get('since'), new Date(Date.now() - DAY_MS));
  if (!since) {
    return { status: 400, body: { error: 'invalid since parameter (expect ISO 8601 or epoch ms)' } };
  }

  let limit = parseInt(searchParams.get('limit') ?? '', 10);
  if (!Number.isFinite(limit)) limit = DEFAULT_LIMIT;
  limit = Math.min(Math.max(limit, 1), MAX_LIMIT);

  const conditions = ['n.published_at >= $1'];
  /** @type {unknown[]} */
  const params = [since.toISOString()];

  const category = searchParams.get('category');
  if (category) {
    params.push(category.trim());
    conditions.push(`n.category = $${params.length}`);
  }

  const severity = searchParams.get('severity');
  if (severity) {
    const severities = severity
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (severities.length > 0) {
      params.push(severities);
      conditions.push(`n.severity = ANY($${params.length})`);
    }
  }

  const region = searchParams.get('region');
  if (region) {
    params.push(region.trim());
    conditions.push(`f.region = $${params.length}`);
  }

  const noise = searchParams.get('noise');
  if (noise === 'exclude') {
    // Colonne additive (peut ne pas exister avant migration) : lue via
    // to_jsonb pour ne jamais faire échouer la requête ; absente → false.
    conditions.push(`coalesce((to_jsonb(n)->>'is_noise')::boolean, false) = false`);
  }

  const until = parseDateParam(searchParams.get('until'), null);
  if (until) {
    params.push(until.toISOString());
    conditions.push(`n.published_at < $${params.length}`);
  }

  const before = parseDateParam(searchParams.get('before'), null);
  if (before) {
    params.push(before.toISOString());
    conditions.push(`n.published_at < $${params.length}`);
  }

  params.push(limit);
  const limitPlaceholder = `$${params.length}`;

  const queryText = `
    SELECT
      n.id, n.feed_id, f.name AS feed_name, f.region AS feed_region, f.tier,
      n.title, n.link, n.description, n.published_at, n.collected_at,
      n.category, n.severity, n.confidence, n.lat, n.lon, n.classifier_version,
      to_jsonb(n)->>'relevance' AS relevance,
      to_jsonb(n)->>'is_noise' AS is_noise,
      to_jsonb(n)->>'alertable' AS alertable,
      to_jsonb(n)->>'scope' AS scope
    FROM news_items n
    LEFT JOIN feeds f ON f.id = n.feed_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY n.published_at DESC NULLS LAST, n.id DESC
    LIMIT ${limitPlaceholder}
  `;

  try {
    const sql = neon(databaseUrl);
    const rows = await sql.query(queryText, params);
    const items = rows.map(mapNewsRow);

    return {
      status: 200,
      body: { items, count: items.length, generatedAt: new Date().toISOString() },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown database error';
    console.error('[api/news] query failed:', message);
    return { status: 503, body: { error: 'news database unavailable' } };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const { status, body } = await queryNews(url.searchParams);

  if (status === 200) {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  }
  res.status(status).json(body);
}
