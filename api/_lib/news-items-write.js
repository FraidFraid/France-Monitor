// api/_lib/news-items-write.js — insertion des articles classés (extrait de api/ingest/news.ts pour
// tester le SQL sur PGlite : une faute ne doit pas se découvrir en production ; spec 2026-09-28 § 4.4).
import { encodeReasons } from './classification-columns.js';

/**
 * @typedef {{ hash: string, feedId: string, title: string, link: string, description: string | null,
 *   publishedAt: string | null, category: string, severity: string, confidence: number, version: string,
 *   reportedSeverity: string | null, temporality: string | null, zone: string | null, reasons: string[] }} NewsItemRow
 * @param {(strings: TemplateStringsArray, ...params: unknown[]) => Promise<Record<string, unknown>[]>} sql
 * @param {NewsItemRow[]} rows
 * @returns {Promise<Array<{ id: number, title: string }>>} lignes réellement insérées (doublons ignorés)
 */
export async function insertNewsItems(sql, rows) {
  if (rows.length === 0) return [];
  /** @template T @param {(r: NewsItemRow) => T} pick */
  const col = (pick) => rows.map(pick);
  const inserted = await sql`
    INSERT INTO news_items
      (content_hash, feed_id, title, link, description, published_at,
       category, severity, confidence, classifier_version,
       reported_severity, temporality, zone, reasons)
    SELECT * FROM unnest(
      ${col((r) => r.hash)}::text[], ${col((r) => r.feedId)}::text[], ${col((r) => r.title)}::text[],
      ${col((r) => r.link)}::text[], ${col((r) => r.description)}::text[], ${col((r) => r.publishedAt)}::timestamptz[],
      ${col((r) => r.category)}::text[], ${col((r) => r.severity)}::text[], ${col((r) => r.confidence)}::real[],
      ${col((r) => r.version)}::text[], ${col((r) => r.reportedSeverity)}::text[], ${col((r) => r.temporality)}::text[],
      ${col((r) => r.zone)}::text[], ${col((r) => encodeReasons(r.reasons))}::text[]
    )
    ON CONFLICT (content_hash) DO NOTHING
    RETURNING id, title
  `;
  return inserted.map((r) => ({ id: Number(r.id), title: String(r.title) }));
}
