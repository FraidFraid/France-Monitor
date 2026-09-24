// tests/helpers/pglite-sql.ts — Postgres embarqué (PGlite, WASM) pour tester le SQL
// sans toucher à la base Neon de production. Expose la même forme d'appel que
// `neon(url)` : un gabarit étiqueté sql`…${param}…` qui résout en tableau de lignes.

import { PGlite } from '@electric-sql/pglite';

export type Sql = (strings: TemplateStringsArray, ...params: unknown[]) => Promise<Record<string, unknown>[]>;

/** Schéma de base de l'ingestion (extrait de scripts/init-db.mjs, colonnes utiles aux tests). */
const BASE_SCHEMA = `
  CREATE TABLE feeds (
    id text PRIMARY KEY, url text NOT NULL, name text, region text, tier smallint
  );
  CREATE TABLE news_items (
    id bigserial PRIMARY KEY, content_hash text UNIQUE NOT NULL, feed_id text REFERENCES feeds(id),
    title text NOT NULL, link text NOT NULL, description text, published_at timestamptz,
    collected_at timestamptz DEFAULT now(), category text, severity text, confidence real,
    classifier_version text, lat double precision, lon double precision, geocode_source text,
    is_noise boolean
  );
`;

export async function createTestSql(): Promise<{ sql: Sql; db: PGlite }> {
  const db = new PGlite();
  await db.exec(BASE_SCHEMA);
  const sql: Sql = async (strings, ...params) => {
    const text = strings.reduce((acc, part, i) => `${acc}$${i}${part}`);
    const result = await db.query<Record<string, unknown>>(text, params);
    return result.rows;
  };
  return { sql, db };
}

export interface TestArticle {
  id: number;
  feedId: string;
  title: string;
  publishedAt: number;
  collectedAt?: number;
  category?: string;
  severity?: string;
  isNoise?: boolean;
}

export const TEST_FEEDS: Array<{ id: string; name: string; tier: number }> = [
  { id: 'le-monde', name: 'Le Monde', tier: 1 },
  { id: 'france-info', name: 'France Info', tier: 1 },
  { id: 'le-progres', name: 'Le Progrès', tier: 3 },
  { id: 'le-dauphine', name: 'Le Dauphiné', tier: 3 },
  { id: 'sud-ouest', name: 'Sud Ouest', tier: 3 },
];

export async function seedFeeds(sql: Sql): Promise<void> {
  for (const f of TEST_FEEDS) await sql`INSERT INTO feeds (id, url, name, tier) VALUES (${f.id}, ${`https://${f.id}.example`}, ${f.name}, ${f.tier})`;
}

export async function insertArticles(sql: Sql, articles: TestArticle[]): Promise<void> {
  for (const a of articles) {
    await sql`
      INSERT INTO news_items (id, content_hash, feed_id, title, link, published_at, collected_at, category, severity, is_noise)
      VALUES (${a.id}, ${`h${a.id}`}, ${a.feedId}, ${a.title}, ${`https://example.fr/${a.id}`},
              ${new Date(a.publishedAt).toISOString()}, ${new Date(a.collectedAt ?? a.publishedAt).toISOString()},
              ${a.category ?? 'security'}, ${a.severity ?? 'medium'}, ${a.isNoise ?? null})
    `;
  }
}
