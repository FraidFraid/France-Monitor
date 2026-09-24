/**
 * api/ingest/news.ts — Cron d'ingestion serveur du flux news.
 *
 * Cadence : tant que le projet est en Vercel Pro (décision du 24/09/2026), Vercel Cron
 * toutes les 30 min (vercel.json). Au passage en Hobby (docs/runbook-passage-hobby.md),
 * deux déclencheurs distincts, tous deux Authorization: Bearer ${CRON_SECRET} (GET ou POST) —
 *  - Vercel Cron, 1 exécution/jour (limite du palier Hobby : une seule entrée
 *    quotidienne fixe autorisée) : filet de sécurité.
 *  - Upstash QStash, toutes les ~30 min (configuré côté Upstash, hors dépôt) :
 *    cadence réelle. QStash relaie l'auth via l'en-tête
 *    `Upstash-Forward-Authorization` → le handler la voit comme un
 *    `Authorization` normal, aucune logique spécifique requise ici.
 *
 * Pipeline par tick :
 *  1. Auth Bearer CRON_SECRET sinon 401.
 *  2. Verrou anti-chevauchement Upstash Redis (SET ingest_lock NX EX 280) si dispo.
 *  3. Sync de la table `feeds` depuis api/_lib/feeds-snapshot.js (généré depuis
 *     src/config/feeds.ts par scripts/sync-feeds.mjs).
 *  4. Sélection des feeds dus (enabled, next_poll_at, cooldown) — max 40.
 *  5. Fetch (timeout 10 s) → parse (api/_lib/parse-rss.js) → hash sha256 →
 *     classification keyword (api/_lib/server-classifier.js) → INSERT déduped.
 *  5.5 Si GROQ_API_KEY défini ET NEWS_SCORING !== 'jev' : classification LLM
 *     des articles ambigus (confidence < 0.60, max GROQ_BUDGET_PER_TICK = 15/tick)
 *     — UPDATE category/severity in place.
 *  5.6 Si NEWS_SCORING = 'shadow' | 'jev' ET TYPESAFE_API_KEY défini : scoring
 *     Jev (api/_lib/jev-client.js + jev-policy.js) des articles insérés ce
 *     tick (repli sur les plus anciens non encore scorés), budget
 *     JEV_BUDGET_PER_TICK (200 par défaut), concurrence 8. 'shadow' stocke les
 *     réponses et les colonnes dérivées sans toucher category/severity/
 *     confidence ; 'jev' les écrase en plus et remplace la passe Groq
 *     (classifier_version = 'jev-1'). Désactivé par défaut (NEWS_SCORING='off') :
 *     coût nul tant que la variable n'est pas positionnée.
 *  6. Géocodage best-effort des items réellement insérés (max 150/tick,
 *     concurrence 4).
 *  6.5 Regroupement des articles en événements (api/_lib/news-events-db.js) :
 *     rattachement, agrégats, journal des changements, statuts, purge 90 j.
 *     Best-effort : un échec est journalisé sans faire échouer le tick.
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
import {
  scoreArticle,
  JevAuthError,
  JevRateLimitError,
  JevValidationError,
  JevServerError,
} from '../_lib/jev-client.js';
import { buildState } from '../_lib/jev-questions.js';
import { derive as deriveJevJudgment } from '../_lib/jev-policy.js';
import { redisSet } from '../_utils/redis.js';
import { ensureEventTables, runEventPass } from '../_lib/news-events-db.js';

export const config = { maxDuration: 300 };

const GROQ_BUDGET_PER_TICK = 15;
const GROQ_CONFIDENCE = 0.75;

// ─── Scoring Jev (TypeSafe), désactivé par défaut — coût nul tant que
// NEWS_SCORING n'est pas positionné. 'off' (défaut) | 'shadow' | 'jev'. ───
const NEWS_SCORING = (process.env.NEWS_SCORING ?? 'off').trim().toLowerCase();
const JEV_BUDGET_PER_TICK = Number(process.env.JEV_BUDGET_PER_TICK ?? 200) || 200;
const JEV_CONCURRENCY = 8;
const JEV_TIMEOUT_MS = 15_000;
const JEV_MAX_SERVER_ERRORS = 3;
const JEV_CLASSIFIER_VERSION = 'jev-1';

// Dernier état d'ingestion exposé à /api/health-check (Redis, best-effort).
const LAST_TICK_KEY = 'ingest:last-tick';
const LAST_TICK_TTL_S = 24 * 60 * 60;

interface EventPassStats {
  considered: number;
  created: number;
  attached: number;
  skipped: number;
  ambiguous: number;
  logged: number;
  statusChanges: number;
}

interface IngestTickSummary {
  timestamp: string;
  feedsProcessed: number;
  inserted: number;
  errors: Array<{ feedId: string; error: string }>;
  durationMs: number;
  jev?: JevPassResult & { mode: string };
  events?: EventPassStats;
}

// Tables d'événements créées une fois par instance chaude (DDL idempotent, mais 7 allers-retours).
let eventTablesReady = false;

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

interface JevCandidateRow {
  id: number;
  title: string;
  description: string | null;
  published_at: string | Date | null;
  category: string | null;
  severity: string | null;
  confidence: number | null;
  feed_name: string | null;
  feed_region: string | null;
  feed_tier: number | null;
}

interface JevPassResult {
  scored: number;
  skipped: number;
  candidates: number;
  authStopped: boolean;
  rateLimited: boolean;
  validationError: boolean;
  serverErrors: number;
}

// ─── Constantes ───

const MAX_FEEDS_PER_TICK = 40;
const FEED_CONCURRENCY = 6;
const TIME_BUDGET_MS = 240_000;
const FEED_FETCH_TIMEOUT_MS = 10_000;
// 150/tick (concurrence 4) : les ~110 articles insérés par tick avaient un
// budget de géocodage (30) trop bas — le navigateur devait rattraper le
// reste (88 appels geo.api.gouv.fr par visiteur, cf. audit C7).
const MAX_GEOCODES_PER_TICK = 150;
const GEOCODE_CONCURRENCY = 4;
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

// ─── Géocodage best-effort des items insérés (pool de concurrence 4) ───

async function geocodeInserted(sql: NeonSql, items: InsertedItem[], deadline: number): Promise<number> {
  const batch = items.slice(0, MAX_GEOCODES_PER_TICK);
  let geocoded = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < batch.length && Date.now() < deadline) {
      const item = batch[cursor];
      cursor += 1;
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
  }

  const workers = Array.from({ length: Math.min(GEOCODE_CONCURRENCY, batch.length) }, () => worker());
  await Promise.all(workers);
  return geocoded;
}

// ─── Scoring Jev (TypeSafe), mode ombre ou actif ───
// Colonnes additives idempotentes — sûr à rejouer à chaque tick (coût
// négligeable, `IF NOT EXISTS`). cf. scripts/init-db.mjs pour le miroir.
async function ensureJevColumns(sql: NeonSql): Promise<void> {
  await sql`ALTER TABLE news_items ADD COLUMN IF NOT EXISTS jev_answers jsonb`;
  await sql`ALTER TABLE news_items ADD COLUMN IF NOT EXISTS jev_model text`;
  await sql`ALTER TABLE news_items ADD COLUMN IF NOT EXISTS jev_scored_at timestamptz`;
  await sql`ALTER TABLE news_items ADD COLUMN IF NOT EXISTS relevance real`;
  await sql`ALTER TABLE news_items ADD COLUMN IF NOT EXISTS is_noise boolean`;
  await sql`ALTER TABLE news_items ADD COLUMN IF NOT EXISTS alertable boolean`;
  await sql`ALTER TABLE news_items ADD COLUMN IF NOT EXISTS scope text`;
}

/**
 * Sélectionne jusqu'à `JEV_BUDGET_PER_TICK` candidats : d'abord les items
 * insérés ce tick, puis (si le budget n'est pas épuisé) les plus anciens
 * jamais scorés (`jev_scored_at IS NULL`), du plus récent au plus ancien.
 */
async function selectJevCandidates(sql: NeonSql, insertedIds: number[]): Promise<JevCandidateRow[]> {
  let rows: Record<string, unknown>[] = [];
  if (insertedIds.length > 0) {
    rows = await sql`
      SELECT n.id, n.title, n.description, n.published_at, n.category, n.severity, n.confidence,
             f.name AS feed_name, f.region AS feed_region, f.tier AS feed_tier
      FROM news_items n LEFT JOIN feeds f ON f.id = n.feed_id
      WHERE n.id = ANY(${insertedIds}::bigint[])
      ORDER BY n.id ASC
      LIMIT ${JEV_BUDGET_PER_TICK}
    `;
  }

  if (rows.length < JEV_BUDGET_PER_TICK) {
    const remaining = JEV_BUDGET_PER_TICK - rows.length;
    const excluded = insertedIds.length > 0 ? insertedIds : [0];
    const backfill = await sql`
      SELECT n.id, n.title, n.description, n.published_at, n.category, n.severity, n.confidence,
             f.name AS feed_name, f.region AS feed_region, f.tier AS feed_tier
      FROM news_items n LEFT JOIN feeds f ON f.id = n.feed_id
      WHERE n.jev_scored_at IS NULL AND NOT (n.id = ANY(${excluded}::bigint[]))
      ORDER BY n.published_at DESC NULLS LAST
      LIMIT ${remaining}
    `;
    rows = rows.concat(backfill);
  }

  return rows as unknown as JevCandidateRow[];
}

/**
 * Score les candidats via Jev (concurrence JEV_CONCURRENCY) et écrit les
 * colonnes dérivées. En mode 'shadow' : ne touche jamais category/severity/
 * confidence/classifier_version (observation pure, cf. audit §4.6 — le score
 * de stabilité est fixture-locké, on ne le nourrit qu'après comparaison).
 * En mode 'jev' : les écrase et pose classifier_version='jev-1'.
 */
async function runJevPass(
  sql: NeonSql,
  candidates: JevCandidateRow[],
  deadline: number,
  apiKey: string,
): Promise<JevPassResult> {
  const result: JevPassResult = {
    scored: 0,
    skipped: 0,
    candidates: candidates.length,
    authStopped: false,
    rateLimited: false,
    validationError: false,
    serverErrors: 0,
  };

  let stop = false;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (!stop && cursor < candidates.length && Date.now() < deadline) {
      const row = candidates[cursor];
      cursor += 1;

      const state = buildState(
        { title: row.title, description: row.description, published_at: row.published_at },
        { name: row.feed_name, region: row.feed_region, tier: row.feed_tier },
      );

      try {
        const response = await scoreArticle(state, { apiKey, timeoutMs: JEV_TIMEOUT_MS });
        const kw = {
          category: row.category ?? 'general',
          severity: row.severity ?? 'info',
          confidence: typeof row.confidence === 'number' ? row.confidence : 0.2,
        };
        const judgment = deriveJevJudgment(response.answers, kw);
        const answersJson = JSON.stringify(response.answers);

        if (NEWS_SCORING === 'jev') {
          await sql`
            UPDATE news_items SET
              category = ${judgment.category},
              severity = ${judgment.severity},
              confidence = ${judgment.confidence},
              classifier_version = ${JEV_CLASSIFIER_VERSION},
              jev_answers = ${answersJson}::jsonb,
              jev_model = ${response.model},
              jev_scored_at = now(),
              relevance = ${judgment.relevance},
              is_noise = ${judgment.noise},
              alertable = ${judgment.alertable},
              scope = ${judgment.scope}
            WHERE id = ${row.id}
          `;
        } else {
          // shadow : colonnes dérivées seulement, jamais category/severity/confidence.
          await sql`
            UPDATE news_items SET
              jev_answers = ${answersJson}::jsonb,
              jev_model = ${response.model},
              jev_scored_at = now(),
              relevance = ${judgment.relevance},
              is_noise = ${judgment.noise},
              alertable = ${judgment.alertable},
              scope = ${judgment.scope}
            WHERE id = ${row.id}
          `;
        }
        result.scored += 1;
      } catch (err) {
        if (err instanceof JevAuthError) {
          stop = true;
          result.authStopped = true;
        } else if (err instanceof JevRateLimitError) {
          stop = true;
          result.rateLimited = true;
        } else if (err instanceof JevValidationError) {
          // Même forme de requête pour chaque article → bug de code, pas un
          // incident isolé : inutile de la répéter sur le reste du lot.
          stop = true;
          result.validationError = true;
        } else if (err instanceof JevServerError) {
          result.serverErrors += 1;
          if (result.serverErrors >= JEV_MAX_SERVER_ERRORS) stop = true;
        } else {
          // Timeout / erreur réseau (JevTimeoutError) : on passe à l'article suivant.
          result.skipped += 1;
        }
        console.warn('[ingest] Jev scoring error:', err instanceof Error ? err.message : err);
      }
    }
  }

  const workers = Array.from({ length: Math.min(JEV_CONCURRENCY, candidates.length) }, () => worker());
  await Promise.all(workers);
  return result;
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
  let tickSummary: IngestTickSummary | null = null;

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
    // (sautée quand Jev remplace la reclassification, NEWS_SCORING='jev')
    let groqClassified = 0;
    const groqApiKey = process.env['GROQ_API_KEY'];
    if (groqApiKey && insertedItems.length > 0 && NEWS_SCORING !== 'jev') {
      try {
        const ids = insertedItems.map(i => i.id);
        const candidates = await sql`
          SELECT id, title, description
          FROM news_items
          WHERE id = ANY(${ids}::bigint[])
            AND confidence < 0.60
            AND classifier_version = ${CLASSIFIER_VERSION}
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

    // 3.6 Scoring Jev (TypeSafe) — désactivé par défaut (NEWS_SCORING='off').
    let jevResult: JevPassResult | null = null;
    const typesafeApiKey = process.env['TYPESAFE_API_KEY'];
    if ((NEWS_SCORING === 'shadow' || NEWS_SCORING === 'jev') && typesafeApiKey) {
      try {
        await ensureJevColumns(sql);
        const insertedIds = insertedItems.map((i) => i.id);
        const jevCandidates = await selectJevCandidates(sql, insertedIds);
        if (jevCandidates.length > 0) {
          jevResult = await runJevPass(sql, jevCandidates, deadline, typesafeApiKey);
        }
      } catch (err) {
        console.warn('[ingest] Jev pass failed:', err instanceof Error ? err.message : err);
      }
    }

    // 4. Géocodage des items réellement insérés (max 150/tick, concurrence 4)
    const geocoded = await geocodeInserted(sql, insertedItems, deadline);

    // 4.5 Regroupement en événements — best-effort, après le géocodage (pénalité de distance).
    let eventStats: EventPassStats | null = null;
    if (Date.now() < deadline) {
      try {
        if (!eventTablesReady) {
          await ensureEventTables(sql);
          eventTablesReady = true;
        }
        eventStats = (await runEventPass(sql, {
          insertedIds: insertedItems.map((i) => i.id),
          deadline,
        })) as EventPassStats;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[ingest] event pass failed:', message);
        // Visible dans le dernier tick de /api/health-check : un échec répété ne passe pas inaperçu.
        errors.push({ feedId: 'events', error: message });
      }
    }

    // 5. Rétention 90 jours
    await sql`DELETE FROM news_items WHERE collected_at < now() - interval '90 days'`;

    tickSummary = {
      timestamp: new Date().toISOString(),
      feedsProcessed: results.length,
      inserted: insertedItems.length,
      errors,
      durationMs: Date.now() - startedAt,
      ...(jevResult ? { jev: { ...jevResult, mode: NEWS_SCORING } } : {}),
      ...(eventStats ? { events: eventStats } : {}),
    };

    json(res, 200, {
      processedFeeds: results.length,
      newItems: insertedItems.length,
      groqClassified,
      geocoded,
      newsScoring: NEWS_SCORING,
      jev: jevResult,
      events: eventStats,
      durationMs: Date.now() - startedAt,
      errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[api/ingest/news] tick failed:', message);
    tickSummary = {
      timestamp: new Date().toISOString(),
      feedsProcessed: 0,
      inserted: 0,
      errors: [...errors, { feedId: '*', error: message }],
      durationMs: Date.now() - startedAt,
    };
    json(res, 500, { error: message, durationMs: Date.now() - startedAt, errors });
  } finally {
    // Persiste le dernier tick pour /api/health-check (never-throws, TTL 24 h).
    if (tickSummary) {
      await redisSet(LAST_TICK_KEY, JSON.stringify(tickSummary), LAST_TICK_TTL_S);
    }
    if (redis && lockAcquired) {
      try {
        await redis.del(LOCK_KEY);
      } catch {
        // TTL 280 s libèrera le verrou de toute façon.
      }
    }
  }
}
