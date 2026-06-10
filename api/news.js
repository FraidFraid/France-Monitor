// api/news.js
// Vercel Node function — read API for ingested news items (Neon Postgres).
//
// GET /api/news?since=ISO|epochMs&category=...&severity=a,b&region=...&limit=500
//   Returns the most recent ingested news items, joined with their feed
//   metadata (name/region/tier), ordered by published_at DESC NULLS LAST.
//
// All SQL is fully parameterized ($1..$n placeholders via sql.query).
// If DATABASE_URL is missing or the DB is unreachable → 503 (the client
// falls back to direct RSS fetching).

import { neon } from '@neondatabase/serverless';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;

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

  const conditions = ['n.collected_at >= $1'];
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

  params.push(limit);
  const limitPlaceholder = `$${params.length}`;

  const queryText = `
    SELECT
      n.id, n.feed_id, f.name AS feed_name, f.region AS feed_region, f.tier,
      n.title, n.link, n.description, n.published_at, n.collected_at,
      n.category, n.severity, n.confidence, n.lat, n.lon
    FROM news_items n
    LEFT JOIN feeds f ON f.id = n.feed_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY n.published_at DESC NULLS LAST
    LIMIT ${limitPlaceholder}
  `;

  try {
    const sql = neon(databaseUrl);
    const rows = await sql.query(queryText, params);

    const items = rows.map((row) => ({
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
    }));

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
