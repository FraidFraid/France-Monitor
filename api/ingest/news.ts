/**
 * api/ingest/news.ts — Cron d'ingestion serveur du flux news (Vercel Cron, toutes les 5 min).
 *
 * Pipeline par tick :
 *  1. Auth Bearer CRON_SECRET (standard Vercel Cron) sinon 401.
 *  2. Verrou anti-chevauchement Upstash Redis (SET ingest_lock NX EX 280) si dispo.
 *  3. Sync de la table `feeds` depuis api/_lib/feeds-snapshot.js (généré depuis
 *     src/config/feeds.ts par scripts/sync-feeds.mjs).
 *  4. Sélection des feeds dus (enabled, next_poll_at, cooldown) — max 40.
 *  5. Fetch (timeout 10 s) → parse (api/_lib/parse-rss.js) → hash sha256 →
 *     classification keyword (api/_lib/server-classifier.js) → INSERT déduped.
 *  5.5 Si GROQ_API_KEY défini : classification LLM des articles ambigus
 *     (confidence < 0.60, max 5/tick) — UPDATE category/severity in place.
 *  6. Géocodage best-effort des items réellement insérés (max 30/tick).
 *  7. Purge des items > 90 jours, libération du verrou, stats JSON.
 *
 * Sans DATABASE_URL → 503 explicite (pas de crash au chargement du module).
 */

import { Redis } from '@upstash/redis';
import { getDb, hasDatabaseUrl, contentHash, computeBackoffMs } from '../_lib/db.js';
import { parseRssXml } from '../_lib/parse-rss.js';
import { classify, CLASSIFIER_VERSION } from '../_lib/server-classifier.js';
import { geocodeNewsItem } from '../_lib/server-geocoder.js';
import { FEEDS } from '../_lib/feeds-snapshot.js';
import { classifyWithGroq } from '../_lib/groq-classifier.js';

export const config = { maxDuration: 300 };

const GROQ_BUDGET_PER_TICK = 5;
const GROQ_CONFIDENCE = 0.75;

// ─── Types minimaux Vercel Node (pattern api/sentinel-ndwi.ts) ───

type MinimalRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
};

type MinimalResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
};

type NeonSql = (strings: TemplateStringsArray, ...params: unknown[]) => Promise<Record<string, unknown>[]>;

interface FeedRow {
  id: string;
  url: string;
  name: string | null;
  region: string | null;
  tier: number | null;
  poll_interval_s: number | null;
  consecutive_failures: number | null;
}

interface InsertedItem {
  id: number;
  title: string;
  region: string | null;
}

interface FeedResult {
  feedId: string;
  inserted: InsertedItem[];
  itemCount: number;
  error?: string;
}

// ─── Constantes ───

const MAX_FEEDS_PER_TICK = 40;
const FEED_CONCURRENCY = 6;
const TIME_BUDGET_MS = 240_000;
const FEED_FETCH_TIMEOUT_MS = 10_000;
const MAX_GEOCODES_PER_TICK = 30;
const DEFAULT_POLL_INTERVAL_S = 300;
const LOCK_KEY = 'ingest_lock';
const LOCK_TTL_S = 280;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// ─── Helpers ───

function json(res: MinimalResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    return new Redis({ url, token });
  } catch {
    return null;
  }
}

function parsePublishedAt(pubDate: string | undefined): string | null {
  if (!pubDate) return null;
  const time = Date.parse(pubDate);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString();
}

// ─── Sync feeds config → table feeds ───

async function syncFeeds(sql: NeonSql): Promise<void> {
  const ids = FEEDS.map((f) => f.id);
  // Feeds retirés de la config → désactivés (jamais supprimés : FK news_items).
  await sql`UPDATE feeds SET enabled = false WHERE id <> ALL(${ids}::text[]) AND enabled = true`;

  const CHUNK = 10;
  for (let i = 0; i < FEEDS.length; i += CHUNK) {
    const chunk = FEEDS.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(
        (feed) =>
          sql`
            INSERT INTO feeds (id, url, name, region, tier)
            VALUES (${feed.id}, ${feed.url}, ${feed.name}, ${feed.region}, ${feed.tier})
            ON CONFLICT (id) DO UPDATE SET
              url = EXCLUDED.url,
              name = EXCLUDED.name,
              region = EXCLUDED.region,
              tier = EXCLUDED.tier,
              enabled = true
          `,
      ),
    );
  }
}

// ─── Traitement d'un feed ───

async function processFeed(sql: NeonSql, feed: FeedRow): Promise<FeedResult> {
  const pollIntervalS = feed.poll_interval_s ?? DEFAULT_POLL_INTERVAL_S;

  let items: ReturnType<typeof parseRssXml>;
  try {
    const resp = await fetch(feed.url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) throw new Error(`upstream_http_${resp.status}`);
    const xml = await resp.text();
    items = parseRssXml(xml);
  } catch (error) {
    const failures = (feed.consecutive_failures ?? 0) + 1;
    const backoffS = Math.round(computeBackoffMs(failures) / 1000);
    await sql`
      UPDATE feeds SET
        consecutive_failures = ${failures},
        cooldown_until = now() + make_interval(secs => ${backoffS}),
        next_poll_at = now() + make_interval(secs => ${Math.max(backoffS, pollIntervalS)})
      WHERE id = ${feed.id}
    `;
    const message = error instanceof Error ? error.message : String(error);
    return { feedId: feed.id, inserted: [], itemCount: 0, error: message };
  }

  const inserted: InsertedItem[] = [];

  if (items.length > 0) {
    const hashes: string[] = [];
    const feedIds: string[] = [];
    const titles: string[] = [];
    const links: string[] = [];
    const descriptions: Array<string | null> = [];
    const publishedAts: Array<string | null> = [];
    const categories: string[] = [];
    const severities: string[] = [];
    const confidences: number[] = [];
    const versions: string[] = [];
    const seenHashes = new Set<string>();

    for (const item of items) {
      const hash = contentHash(feed.id, item.link, item.title);
      if (seenHashes.has(hash)) continue; // dédup intra-flux
      seenHashes.add(hash);

      let category = 'general';
      let severity = 'info';
      let confidence = 0.2;
      let version: string = CLASSIFIER_VERSION;
      try {
        const result = classify(item.title, item.description) as {
          category: string;
          severity: string;
          confidence: number;
        };
        category = result.category;
        severity = result.severity;
        confidence = result.confidence;
      } catch {
        // Classifier en erreur : on insère quand même, marqué 'error'.
        category = 'general';
        severity = 'info';
        confidence = 0;
        version = 'error';
      }

      hashes.push(hash);
      feedIds.push(feed.id);
      titles.push(item.title);
      links.push(item.link);
      descriptions.push(item.description ?? null);
      publishedAts.push(parsePublishedAt(item.pubDate));
      categories.push(category);
      severities.push(severity);
      confidences.push(confidence);
      versions.push(version);
    }

    if (hashes.length > 0) {
      const rows = await sql`
        INSERT INTO news_items
          (content_hash, feed_id, title, link, description, published_at,
           category, severity, confidence, classifier_version)
        SELECT * FROM unnest(
          ${hashes}::text[], ${feedIds}::text[], ${titles}::text[], ${links}::text[],
          ${descriptions}::text[], ${publishedAts}::timestamptz[],
          ${categories}::text[], ${severities}::text[], ${confidences}::real[], ${versions}::text[]
        )
        ON CONFLICT (content_hash) DO NOTHING
        RETURNING id, title
      `;
      for (const row of rows) {
        inserted.push({ id: Number(row.id), title: String(row.title), region: feed.region });
      }
    }
  }

  await sql`
    UPDATE feeds SET
      next_poll_at = now() + make_interval(secs => ${pollIntervalS}),
      consecutive_failures = 0,
      cooldown_until = NULL,
      last_success_at = now()
    WHERE id = ${feed.id}
  `;

  return { feedId: feed.id, inserted, itemCount: items.length };
}

// ─── Pool de concurrence avec deadline ───

async function processFeedsPool(sql: NeonSql, feeds: FeedRow[], deadline: number): Promise<FeedResult[]> {
  const results: FeedResult[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < feeds.length && Date.now() < deadline) {
      const feed = feeds[cursor];
      cursor += 1;
      try {
        results.push(await processFeed(sql, feed));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ feedId: feed.id, inserted: [], itemCount: 0, error: message });
      }
    }
  }

  const workers = Array.from({ length: Math.min(FEED_CONCURRENCY, feeds.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── Géocodage best-effort des items insérés ───

async function geocodeInserted(sql: NeonSql, items: InsertedItem[], deadline: number): Promise<number> {
  let geocoded = 0;
  const batch = items.slice(0, MAX_GEOCODES_PER_TICK);

  for (const item of batch) {
    if (Date.now() >= deadline) break;
    try {
      const result = (await geocodeNewsItem(item.title, item.region)) as
        | { lat: number; lon: number; source: string }
        | null;
      if (result) {
        await sql`
          UPDATE news_items
          SET lat = ${result.lat}, lon = ${result.lon}, geocode_source = ${result.source}
          WHERE id = ${item.id}
        `;
        geocoded += 1;
      }
    } catch {
      // best-effort : lat/lon restent null
    }
  }
  return geocoded;
}

// ─── Handler ───

export default async function handler(req: MinimalRequest, res: MinimalResponse): Promise<void> {
  const startedAt = Date.now();

  if (req.method !== 'GET' && req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  // Auth Vercel Cron : Authorization: Bearer ${CRON_SECRET}
  const secret = process.env.CRON_SECRET;
  const auth = headerValue(req.headers['authorization']);
  if (!secret || auth !== `Bearer ${secret}`) {
    json(res, 401, { error: 'Unauthorized' });
    return;
  }

  if (!hasDatabaseUrl()) {
    json(res, 503, { error: 'DATABASE_URL not configured — news ingestion unavailable' });
    return;
  }

  // Verrou anti-chevauchement (best-effort, sans Redis on continue sans verrou).
  const redis = getRedis();
  let lockAcquired = false;
  if (redis) {
    try {
      const result = await redis.set(LOCK_KEY, '1', { nx: true, ex: LOCK_TTL_S });
      lockAcquired = result === 'OK';
      if (!lockAcquired) {
        json(res, 200, { skipped: 'locked', durationMs: Date.now() - startedAt });
        return;
      }
    } catch {
      // Redis indisponible → on continue sans verrou.
    }
  }

  const errors: Array<{ feedId: string; error: string }> = [];

  try {
    const sql = getDb() as unknown as NeonSql;
    const deadline = startedAt + TIME_BUDGET_MS;

    // 1. Sync config → table feeds
    await syncFeeds(sql);

    // 2. Feeds dus
    const dueRows = await sql`
      SELECT id, url, name, region, tier, poll_interval_s, consecutive_failures
      FROM feeds
      WHERE enabled
        AND next_poll_at <= now()
        AND (cooldown_until IS NULL OR cooldown_until <= now())
      ORDER BY tier NULLS LAST, next_poll_at ASC
      LIMIT ${MAX_FEEDS_PER_TICK}
    `;
    const dueFeeds = dueRows as unknown as FeedRow[];

    // 3. Fetch + parse + classify + insert (concurrence 6, budget temps global)
    const results = await processFeedsPool(sql, dueFeeds, deadline);

    const insertedItems: InsertedItem[] = [];
    for (const result of results) {
      insertedItems.push(...result.inserted);
      if (result.error) errors.push({ feedId: result.feedId, error: result.error });
    }

    // 3.5 Optional Groq LLM classification for ambiguous articles
    let groqClassified = 0;
    const groqApiKey = process.env['GROQ_API_KEY'];
    if (groqApiKey && insertedItems.length > 0) {
      try {
        const ids = insertedItems.map(i => i.id);
        const candidates = await sql`
          SELECT id, title, description
          FROM news_items
          WHERE id = ANY(${ids}::bigint[])
            AND confidence < 0.60
            AND classifier_version = ${CLASSIFIER_VERSION}
            AND NOT (category = 'general' AND confidence <= 0.20)
          ORDER BY confidence ASC
          LIMIT ${GROQ_BUDGET_PER_TICK}
        `;

        for (const row of candidates) {
          if (Date.now() >= deadline) break;

          try {
            const result = await classifyWithGroq(
              groqApiKey,
              String(row.title),
              row.description != null ? String(row.description) : null,
            );
            if (result) {
              await sql`
                UPDATE news_items
                SET category = ${result.category},
                    severity = ${result.severity},
                    confidence = ${GROQ_CONFIDENCE},
                    classifier_version = 'groq-1'
                WHERE id = ${row.id}
              `;
              groqClassified++;
            }
          } catch (err) {
            console.warn('[ingest] Groq pass stopped:', err instanceof Error ? err.message : err);
            break;
          }
        }
      } catch (err) {
        console.warn('[ingest] Groq candidate query failed:', err instanceof Error ? err.message : err);
      }
    }

    // 4. Géocodage des items réellement insérés (max 30/tick)
    const geocoded = await geocodeInserted(sql, insertedItems, deadline);

    // 5. Rétention 90 jours
    await sql`DELETE FROM news_items WHERE collected_at < now() - interval '90 days'`;

    json(res, 200, {
      processedFeeds: results.length,
      newItems: insertedItems.length,
      groqClassified,
      geocoded,
      durationMs: Date.now() - startedAt,
      errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[api/ingest/news] tick failed:', message);
    json(res, 500, { error: message, durationMs: Date.now() - startedAt, errors });
  } finally {
    if (redis && lockAcquired) {
      try {
        await redis.del(LOCK_KEY);
      } catch {
        // TTL 280 s libèrera le verrou de toute façon.
      }
    }
  }
}
