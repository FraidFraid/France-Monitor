// api/news/history.js
// Vercel Node function — time-bucketed aggregation of ingested news items
// for the timeline view.
//
// GET /api/news/history?from=ISO|epochMs&to=ISO|epochMs&bucket=hour|day|week
//   Returns counts grouped by (bucket, category, severity):
//   { buckets: [{ t: ISO, category, severity, count }], from, to, bucket }
//
// All SQL is fully parameterized. Missing DATABASE_URL or DB errors → 503.

import { neon } from '@neondatabase/serverless';
import { parseDateParam } from '../news.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const VALID_BUCKETS = new Set(['hour', 'day', 'week']);

/**
 * Core query logic, shared between the Vercel handler and the Vite dev proxy.
 * @param {URLSearchParams} searchParams
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function queryNewsHistory(searchParams) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return { status: 503, body: { error: 'ingestion database not configured' } };
  }

  const now = new Date();
  const from = parseDateParam(searchParams.get('from'), new Date(now.getTime() - 7 * DAY_MS));
  const to = parseDateParam(searchParams.get('to'), now);
  if (!from || !to) {
    return { status: 400, body: { error: 'invalid from/to parameter (expect ISO 8601 or epoch ms)' } };
  }
  if (from.getTime() >= to.getTime()) {
    return { status: 400, body: { error: 'from must be earlier than to' } };
  }

  const bucket = (searchParams.get('bucket') ?? 'hour').trim().toLowerCase();
  if (!VALID_BUCKETS.has(bucket)) {
    return { status: 400, body: { error: 'bucket must be "hour", "day", or "week"' } };
  }

  const queryText = `
    SELECT
      date_trunc($1, published_at) AS t,
      category,
      severity,
      COUNT(*)::int AS count
    FROM news_items
    WHERE published_at >= $2 AND published_at <= $3
    GROUP BY 1, 2, 3
    ORDER BY 1 ASC
  `;
  const params = [bucket, from.toISOString(), to.toISOString()];

  try {
    const sql = neon(databaseUrl);
    const rows = await sql.query(queryText, params);

    const buckets = rows.map((row) => ({
      t: row.t instanceof Date ? row.t.toISOString() : new Date(String(row.t)).toISOString(),
      category: row.category === null || row.category === undefined ? null : String(row.category),
      severity: row.severity === null || row.severity === undefined ? null : String(row.severity),
      count: Number(row.count) || 0,
    }));

    return {
      status: 200,
      body: {
        buckets,
        from: from.toISOString(),
        to: to.toISOString(),
        bucket,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown database error';
    console.error('[api/news/history] query failed:', message);
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
  const { status, body } = await queryNewsHistory(url.searchParams);

  if (status === 200) {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=300');
  }
  res.status(status).json(body);
}
