/**
 * init-db.mjs — Initialise le schéma Postgres (Neon) de l'ingestion news.
 * Idempotent (CREATE TABLE/INDEX IF NOT EXISTS). Lit DATABASE_URL.
 *
 *   DATABASE_URL=postgres://... node scripts/init-db.mjs
 */

import { neon } from '@neondatabase/serverless';
import { ensureEventTables } from '../api/_lib/news-events-db.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[init-db] DATABASE_URL is not set — export the Neon connection string first.');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS feeds (
    id text PRIMARY KEY,
    url text NOT NULL,
    name text,
    region text,
    tier smallint,
    poll_interval_s int DEFAULT 300,
    next_poll_at timestamptz DEFAULT now(),
    consecutive_failures int DEFAULT 0,
    cooldown_until timestamptz,
    last_success_at timestamptz,
    enabled boolean DEFAULT true
  )`,
  `CREATE TABLE IF NOT EXISTS news_items (
    id bigserial PRIMARY KEY,
    content_hash text UNIQUE NOT NULL,
    feed_id text REFERENCES feeds(id),
    title text NOT NULL,
    link text NOT NULL,
    description text,
    published_at timestamptz,
    collected_at timestamptz DEFAULT now(),
    category text,
    severity text,
    confidence real,
    classifier_version text,
    lat double precision,
    lon double precision,
    geocode_source text
  )`,
  `CREATE INDEX IF NOT EXISTS idx_news_collected ON news_items (collected_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_news_cat_sev ON news_items (category, severity, collected_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_news_published ON news_items (published_at DESC)`,
  // Colonnes du scoring Jev (TypeSafe) — additives, miroir de
  // ensureJevColumns() dans api/ingest/news.ts (idempotent des deux côtés :
  // la fonction runtime les repose à chaque tick si NEWS_SCORING est actif,
  // ce script les pose une fois pour un environnement neuf).
  `ALTER TABLE news_items ADD COLUMN IF NOT EXISTS jev_answers jsonb`,
  `ALTER TABLE news_items ADD COLUMN IF NOT EXISTS jev_model text`,
  `ALTER TABLE news_items ADD COLUMN IF NOT EXISTS jev_scored_at timestamptz`,
  `ALTER TABLE news_items ADD COLUMN IF NOT EXISTS relevance real`,
  `ALTER TABLE news_items ADD COLUMN IF NOT EXISTS is_noise boolean`,
  `ALTER TABLE news_items ADD COLUMN IF NOT EXISTS alertable boolean`,
  `ALTER TABLE news_items ADD COLUMN IF NOT EXISTS scope text`,
  // Sert /api/news?noise=exclude : index partiel, ne grossit qu'avec les
  // lignes non-bruit une fois le scoring actif.
  `CREATE INDEX IF NOT EXISTS idx_news_relevant ON news_items (published_at DESC) WHERE is_noise IS NOT TRUE`,
  `CREATE TABLE IF NOT EXISTS situation_snapshots (
    id bigserial PRIMARY KEY,
    taken_at timestamptz DEFAULT now(),
    kind text NOT NULL,
    payload jsonb NOT NULL
  )`,
];

for (const statement of STATEMENTS) {
  const summary = statement.replace(/\s+/g, ' ').slice(0, 72);
  await sql.query(statement);
  console.log(`[init-db] OK: ${summary}…`);
}

// Événements (news_events, news_event_log, news_items.event_id) : même fonction que le cron
// d'ingestion, qui les crée aussi au premier passage.
await ensureEventTables(sql);
console.log('[init-db] OK: tables d’événements');

console.log('[init-db] schema ready.');
