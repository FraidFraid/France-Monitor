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
import { decodeHtmlEntities } from '../_lib/parse-rss.js';
import { decodeReasons } from '../_lib/classification-columns.js';

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
  if (classifierVersion.startsWith('llm-')) return 'llm';
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
    title: toDecodedTextOrNull(row.title),
    link: toStringOrNull(row.link),
    description: toDecodedTextOrNull(row.description),
    publishedAt: toIsoOrNull(row.published_at),
    collectedAt: toIsoOrNull(row.collected_at),
    category: toStringOrNull(row.category),
    severity: toStringOrNull(row.severity),
    confidence: toNumberOrNull(row.confidence),
    lat: toNumberOrNull(row.lat),
    lon: toNumberOrNull(row.lon),
    eventId: toNumberOrNull(row.event_id),
    scoredBy: scoredByFromVersion(row.classifier_version),
    relevance: toNumberOrNull(row.relevance),
    noise: toBooleanOrNull(row.is_noise),
    alertable: toBooleanOrNull(row.alertable),
    scope: toStringOrNull(row.scope),
    reportedSeverity: toStringOrNull(row.reported_severity),
    temporality: toStringOrNull(row.temporality),
    zone: toStringOrNull(row.zone),
    reasons: decodeReasons(row.reasons),
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
 * Texte d'article : décode les entités restées dans les lignes stockées avant la correction de
 * decodeHtmlEntities (rétention 90 jours).
 * @param {unknown} value
 * @returns {string | null}
 */
function toDecodedTextOrNull(value) {
  if (value === null || value === undefined) return null;
  return decodeHtmlEntities(String(value));
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

// ─── Instantané des dernières 24 h (20/10/2026) ───
// La page demande les 1 000 derniers articles des 24 h toutes les 5 min (adresse nouvelle à chaque palier) : environ 1 Mo lu sur Neon
// à chaque fois, l'essentiel avec la passe des événements du transfert mensuel du palier gratuit (5 Go). Le processus d'API garde ces
// articles en mémoire : relecture complète toutes les 3 h, et entre deux, seulement les articles collectés depuis (après chaque
// passage d'ingestion, signalé par markNewsSnapshotStale, ou au plus tard toutes les 30 min). Seule la requête standard (since et
// limit, since dans les 25 dernières heures) en profite ; toute autre requête va en base.
const SNAPSHOT_FULL_MS = 3 * 60 * 60 * 1000;
const SNAPSHOT_INCREMENT_MS = 30 * 60 * 1000;
const SNAPSHOT_WINDOW_MS = 26 * 60 * 60 * 1000;
const SNAPSHOT_MAX_SINCE_AGE_MS = 25 * 60 * 60 * 1000;
const SELECT_COLUMNS = `
      n.id, n.feed_id, f.name AS feed_name, f.region AS feed_region, f.tier,
      n.title, n.link, n.description, n.published_at, n.collected_at,
      n.category, n.severity, n.confidence, n.lat, n.lon, n.event_id, n.classifier_version,
      to_jsonb(n)->>'relevance' AS relevance,
      to_jsonb(n)->>'is_noise' AS is_noise,
      to_jsonb(n)->>'alertable' AS alertable,
      to_jsonb(n)->>'scope' AS scope,
      to_jsonb(n)->>'reported_severity' AS reported_severity,
      to_jsonb(n)->>'temporality' AS temporality,
      to_jsonb(n)->>'zone' AS zone,
      to_jsonb(n)->>'reasons' AS reasons`;

/** @type {{ items: object[], fullAt: number, incrementAt: number, maxCollectedMs: number, stale: boolean } | null} */
let snapshot = null;
/** @type {Promise<void> | null} */
let snapshotInFlight = null;

/** Fin d'un passage d'ingestion : les articles collectés depuis la dernière lecture seront lus à la prochaine requête. */
export function markNewsSnapshotStale() {
  if (snapshot) snapshot.stale = true;
}

/** Réservé aux tests. */
export function resetNewsSnapshot() {
  snapshot = null;
  snapshotInFlight = null;
}

const publishedMs = (item) => (item.publishedAt ? Date.parse(item.publishedAt) : -Infinity);
const collectedMs = (item) => (item.collectedAt ? Date.parse(item.collectedAt) : -Infinity);
/** Ordre de la requête SQL : publication décroissante (sans date en dernier), puis id décroissant. */
const byPublishedDesc = (a, b) => publishedMs(b) - publishedMs(a) || (b.id ?? 0) - (a.id ?? 0);

/** Requête standard (since et limit seulement, since récent) : servie par l'instantané. */
export function isSnapshotQuery(searchParams, since, now) {
  for (const key of searchParams.keys()) if (key !== 'since' && key !== 'limit') return false;
  return now - since.getTime() <= SNAPSHOT_MAX_SINCE_AGE_MS;
}

async function refreshSnapshot(sql, now) {
  if (snapshot === null || now - snapshot.fullAt >= SNAPSHOT_FULL_MS || now < snapshot.fullAt) {
    const rows = await sql.query(`
      SELECT ${SELECT_COLUMNS}
      FROM news_items n
      LEFT JOIN feeds f ON f.id = n.feed_id
      WHERE n.published_at >= $1
      ORDER BY n.published_at DESC NULLS LAST, n.id DESC
      LIMIT $2
    `, [new Date(now - SNAPSHOT_WINDOW_MS).toISOString(), MAX_LIMIT]);
    const items = rows.map(mapNewsRow);
    snapshot = { items, fullAt: now, incrementAt: now, maxCollectedMs: Math.max(-Infinity, ...items.map(collectedMs)), stale: false };
    return;
  }
  if (!snapshot.stale && now - snapshot.incrementAt < SNAPSHOT_INCREMENT_MS) return;
  // Articles collectés depuis la dernière lecture (bornes incluses, doublons écartés par id).
  const from = Number.isFinite(snapshot.maxCollectedMs) ? new Date(snapshot.maxCollectedMs).toISOString() : new Date(now - SNAPSHOT_WINDOW_MS).toISOString();
  const rows = await sql.query(`
    SELECT ${SELECT_COLUMNS}
    FROM news_items n
    LEFT JOIN feeds f ON f.id = n.feed_id
    WHERE n.collected_at >= $1 AND n.published_at >= $2
  `, [from, new Date(now - SNAPSHOT_WINDOW_MS).toISOString()]);
  const fresh = rows.map(mapNewsRow);
  const ids = new Set(fresh.map((i) => i.id));
  const cut = now - SNAPSHOT_WINDOW_MS;
  const items = [...snapshot.items.filter((i) => !ids.has(i.id) && publishedMs(i) >= cut), ...fresh].sort(byPublishedDesc).slice(0, MAX_LIMIT);
  snapshot = {
    items, fullAt: snapshot.fullAt, incrementAt: now, stale: false,
    maxCollectedMs: Math.max(snapshot.maxCollectedMs, ...fresh.map(collectedMs)),
  };
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

  if (isSnapshotQuery(searchParams, since, Date.now())) {
    try {
      const sql = neon(databaseUrl);
      snapshotInFlight ??= refreshSnapshot(sql, Date.now()).finally(() => { snapshotInFlight = null; });
      await snapshotInFlight;
      const sinceMs = since.getTime();
      const items = (snapshot?.items ?? []).filter((i) => publishedMs(i) >= sinceMs).slice(0, limit);
      return { status: 200, body: { items, count: items.length, generatedAt: new Date().toISOString() } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown database error';
      console.error('[api/news] snapshot refresh failed:', message);
      return { status: 503, body: { error: 'news database unavailable' } };
    }
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
    SELECT ${SELECT_COLUMNS}
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
