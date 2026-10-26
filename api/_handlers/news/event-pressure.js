// api/_handlers/news/event-pressure.js : étendue des mobilisations et des violences sur 24 h complètes (26/10/2026, rejeu du 17/10 :
// docs/rejeu/constats-2026-10-26.md). Compte des ÉVÉNEMENTS consolidés distincts (news_items.event_id), jamais des articles : un sujet
// repris par cent médias compte une fois. La page ne lit que les 1 000 derniers articles (4 à 8 h un jour de semaine) : ce comptage
// se fait donc ici, sur toute la fenêtre.
//
// GET /api/news/event-pressure
//   { readAt, since, socialEvents24h, securityHighEvents24h }
//   socialEvents24h       : événements dont un article social est de gravité moyenne ou plus ;
//   securityHighEvents24h : événements dont un article de sécurité est de gravité élevée ou critique.
// Base absente ou en panne : 503 (le moteur ne lève alors aucune de ces deux situations : une absence n'est pas un calme, mais elle
// n'invente pas de crise non plus).

import { neon } from '@neondatabase/serverless';

const DAY_MS = 24 * 60 * 60 * 1000;
export const CACHE_CONTROL = 'public, s-maxage=600, stale-while-revalidate=600';

export const EVENT_PRESSURE_SQL = `
  SELECT
    COUNT(DISTINCT event_id) FILTER (WHERE category = 'social' AND severity IN ('medium', 'high', 'critical'))::int AS social,
    COUNT(DISTINCT event_id) FILTER (WHERE category = 'security' AND severity IN ('high', 'critical'))::int AS security_high
  FROM news_items
  WHERE published_at >= $1 AND published_at <= $2 AND event_id IS NOT NULL
`;

/**
 * @param {number} nowMs
 * @param {(text: string, params: unknown[]) => Promise<Array<Record<string, unknown>>>} [query]
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function queryEventPressure(nowMs = Date.now(), query) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!query && !databaseUrl) {
    return { status: 503, body: { error: 'ingestion database not configured' } };
  }
  const since = new Date(nowMs - DAY_MS).toISOString();
  const readAt = new Date(nowMs).toISOString();
  try {
    const run = query ?? ((text, params) => neon(/** @type {string} */ (databaseUrl)).query(text, params));
    const rows = await run(EVENT_PRESSURE_SQL, [since, readAt]);
    const row = rows[0] ?? {};
    return {
      status: 200,
      body: {
        readAt,
        since,
        socialEvents24h: Number(row.social) || 0,
        securityHighEvents24h: Number(row.security_high) || 0,
      },
    };
  } catch (error) {
    console.error('[api/news/event-pressure] query failed:', error instanceof Error ? error.message : error);
    return { status: 503, body: { error: 'news database unavailable' } };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' });
  }
  const { status, body } = await queryEventPressure(Date.now());
  res.setHeader('Cache-Control', status === 200 ? CACHE_CONTROL : 'no-store');
  res.status(status).json(body);
}
