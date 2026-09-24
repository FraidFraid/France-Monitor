// api/_lib/news-events-read.js — lecture des événements pour /api/events, /api/events/detail
// et /api/events/changes. Requêtes paramétrées (gabarit étiqueté neon), mappers purs.
//
// Règle de bruit commune : un événement « info » couvert par un seul groupe de presse n'est
// jamais listé (c'est l'essentiel des faits divers PQR). Il reste en base et peut réapparaître
// dès qu'une deuxième source indépendante le reprend ou que sa gravité monte.

import { neon } from '@neondatabase/serverless';
import { decodeHtmlEntities } from './parse-rss.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const STATUSES = ['active', 'cooling', 'closed'];
const DEFAULT_STATUSES = ['active', 'cooling'];
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;
const MAX_CHANGES = 200;
const MAX_ARTICLES = 50;

/** @typedef {(strings: TemplateStringsArray, ...params: unknown[]) => Promise<Record<string, unknown>[]>} Sql */

const toIso = (v) => (v === null || v === undefined ? null : new Date(v instanceof Date ? v.getTime() : String(v)).toISOString());
const toNum = (v) => (v === null || v === undefined ? null : Number(v));

/** @param {Record<string, unknown>} row  ligne news_events (préfixe facultatif déjà retiré) */
export function mapEventRow(row) {
  const id = Number(row.id);
  return {
    id,
    evidenceId: `E${id}`,
    title: String(row.title),
    category: String(row.category),
    severity: String(row.severity),
    status: String(row.status),
    firstSeen: toIso(row.first_seen),
    lastSeen: toIso(row.last_seen),
    articleCount: Number(row.article_count),
    sourceCount: Number(row.source_count),
    independentCount: Number(row.independent_count),
    sourceNames: Array.isArray(row.source_names) ? row.source_names.map(String) : [],
    lat: toNum(row.lat),
    lon: toNum(row.lon),
  };
}

/** @param {string | null} raw  « active,cooling » ; valeurs inconnues ignorées */
export function parseStatuses(raw) {
  const wanted = String(raw ?? '').split(',').map((s) => s.trim()).filter((s) => STATUSES.includes(s));
  return wanted.length > 0 ? [...new Set(wanted)] : DEFAULT_STATUSES;
}

/** @param {string | null} raw */
export function parseLimit(raw) {
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), MAX_LIMIT) : DEFAULT_LIMIT;
}

/**
 * Borne le « depuis » du fil de changements : absent, invalide ou futur → 24 h ;
 * plus vieux que 7 jours → 7 jours (le journal reste léger à lire).
 * @param {string | null} raw  ISO 8601 ou millisecondes epoch
 * @param {number} now
 * @returns {Date}
 */
export function parseSince(raw, now) {
  const text = String(raw ?? '').trim();
  const ms = /^\d+$/.test(text) ? Number(text) : Date.parse(text);
  if (!Number.isFinite(ms) || ms > now) return new Date(now - DAY_MS);
  return new Date(Math.max(ms, now - 7 * DAY_MS));
}

/**
 * Classement : gravité, puis corroboration (jusqu'à +2 crans pour 3 groupes indépendants),
 * puis fraîcheur.
 * @param {Sql} sql
 * @param {{ statuses: string[], limit: number }} options
 */
export async function listEvents(sql, { statuses, limit }) {
  const rows = await sql`
    SELECT * FROM news_events
    WHERE status = ANY(${statuses}::text[])
      AND NOT (severity = 'info' AND independent_count < 2)
    ORDER BY array_position(ARRAY['info','low','medium','high','critical'], severity) + LEAST(independent_count - 1, 2) DESC,
             last_seen DESC, id DESC
    LIMIT ${limit}
  `;
  return rows.map(mapEventRow);
}

/**
 * @param {Sql} sql
 * @param {number} id
 * @returns {Promise<null | { event: ReturnType<typeof mapEventRow>, articles: object[], log: object[] }>}
 */
export async function getEventDetail(sql, id) {
  const [row] = await sql`SELECT * FROM news_events WHERE id = ${id}`;
  if (!row) return null;
  const articles = await sql`
    SELECT n.id, n.title, n.link, f.name AS feed_name,
           LEAST(coalesce(n.published_at, n.collected_at), n.collected_at + interval '1 hour') AS effective_at
    FROM news_items n LEFT JOIN feeds f ON f.id = n.feed_id
    WHERE n.event_id = ${id}
    ORDER BY effective_at ASC, n.id ASC
    LIMIT ${MAX_ARTICLES}
  `;
  const log = await sql`
    SELECT at, kind, from_value, to_value FROM news_event_log
    WHERE event_id = ${id} ORDER BY at DESC, id DESC LIMIT 50
  `;
  return {
    event: mapEventRow(row),
    articles: articles.map((a) => ({
      id: Number(a.id),
      // Même traitement que mapNewsRow (api/_handlers/news.js) : des titres stockés avant le
      // correctif d'entités (2026-09) restent encodés en base, parfois doublement (&amp;#039;).
      title: decodeHtmlEntities(String(a.title)),
      link: String(a.link),
      feedName: a.feed_name === null ? null : String(a.feed_name),
      publishedAt: toIso(a.effective_at),
    })),
    log: log.map((l) => ({ at: toIso(l.at), kind: String(l.kind), from: l.from_value === null ? null : String(l.from_value), to: l.to_value === null ? null : String(l.to_value) })),
  };
}

/**
 * Fil « depuis votre dernière visite ». Renvoie les totaux de TOUS les changements par type,
 * mais ne détaille que ceux qui méritent l'attention : aggravations, corroborations,
 * réouvertures, créations ou clôtures d'événements graves (high, critical), et créations
 * d'événements déjà corroborés (≥ 2 groupes indépendants).
 * @param {Sql} sql
 * @param {Date} since
 */
export async function listChanges(sql, since) {
  const sinceIso = since.toISOString();
  const totalsRows = await sql`SELECT kind, count(*)::int AS n FROM news_event_log WHERE at >= ${sinceIso} GROUP BY kind`;
  const rows = await sql`
    SELECT l.id AS log_id, l.at, l.kind, l.from_value, l.to_value, e.*
    FROM news_event_log l JOIN news_events e ON e.id = l.event_id
    WHERE l.at >= ${sinceIso}
      AND (l.kind IN ('escalated', 'corroborated', 'reopened')
           OR (l.kind IN ('created', 'closed') AND e.severity IN ('high', 'critical'))
           -- Né déjà corroboré (plusieurs groupes dans le même tick) : seule l'entrée « créé »
           -- existe, sans « corroboré » ; sans cette ligne, l'actualité qui éclate partout
           -- d'un coup manquerait au fil.
           OR (l.kind = 'created' AND e.independent_count >= 2))
    ORDER BY l.at DESC, l.id DESC
    LIMIT ${MAX_CHANGES}
  `;
  /** @type {Record<string, number>} */
  const totals = {};
  for (const r of totalsRows) totals[String(r.kind)] = Number(r.n);
  return {
    since: sinceIso,
    totals,
    changes: rows.map((r) => ({
      at: toIso(r.at),
      kind: String(r.kind),
      from: r.from_value === null ? null : String(r.from_value),
      to: r.to_value === null ? null : String(r.to_value),
      event: mapEventRow(r),
    })),
  };
}

/**
 * Enveloppe commune des trois handlers : GET seul, 503 explicite sans base, cache CDN 60 s.
 * @param {{ method?: string, url?: string }} req
 * @param {{ setHeader: (k: string, v: string) => void, status: (c: number) => { json: (b: unknown) => unknown } }} res
 * @param {string} label  préfixe des journaux
 * @param {(sql: Sql, params: URLSearchParams) => Promise<{ status: number, body: unknown }>} run
 */
export async function serveEventsQuery(req, res, label, run) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method && req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return res.status(503).json({ error: 'events database not configured' });
  const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
  try {
    const { status, body } = await run(neon(databaseUrl), params);
    if (status === 200) res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(status).json(body);
  } catch (error) {
    console.error(`[${label}] query failed:`, error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'events database unavailable' });
  }
}
