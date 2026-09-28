import { describe, it, expect, beforeEach } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import { ensureClassificationColumns, encodeReasons, decodeReasons } from '../api/_lib/classification-columns.js';
// @ts-expect-error — module JS sans déclaration de types
import { insertNewsItems } from '../api/_lib/news-items-write.js';
import { createTestSql, seedFeeds, type Sql } from './helpers/pglite-sql.ts';

let sql: Sql;
beforeEach(async () => {
  ({ sql } = await createTestSql());
  await seedFeeds(sql);
  await ensureClassificationColumns(sql);
}, 30_000);

const row = (hash: string, extra: Record<string, unknown> = {}) => ({
  hash, feedId: 'le-monde', title: `Titre ${hash}`, link: `https://example.fr/${hash}`, description: null,
  publishedAt: '2026-09-28T08:00:00.000Z', category: 'security', severity: 'medium', confidence: 0.9, version: 'kw-2',
  reportedSeverity: 'critical', temporality: 'en_cours', zone: 'etranger', reasons: ['etranger'], ...extra,
});

describe('colonnes de qualification', () => {
  it('ensureClassificationColumns est idempotent', async () => {
    await ensureClassificationColumns(sql);
    const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'news_items' AND column_name IN ('reported_severity', 'temporality', 'zone', 'reasons') ORDER BY column_name`;
    expect(cols.map((c) => c.column_name)).toEqual(['reasons', 'reported_severity', 'temporality', 'zone']);
  });
  it('encode et décode les motifs', () => {
    expect(encodeReasons(['passe', 'etranger', 'passe'])).toBe('passe,etranger');
    expect(decodeReasons('passe,etranger')).toEqual(['passe', 'etranger']);
    expect(decodeReasons('')).toEqual([]);
    expect(decodeReasons(null)).toEqual([]);
  });
});

describe('insertNewsItems', () => {
  it('écrit les axes, ignore les doublons, accepte description et date nulles', async () => {
    const first = await insertNewsItems(sql, [row('a'), row('b', { publishedAt: null, reasons: [] })]);
    expect(first.map((r: { title: string }) => r.title)).toEqual(['Titre a', 'Titre b']);
    const again = await insertNewsItems(sql, [row('a'), row('c', { reportedSeverity: null, temporality: null, zone: null })]);
    expect(again.map((r: { title: string }) => r.title)).toEqual(['Titre c']);
    const rows = await sql`SELECT content_hash, severity, reported_severity, temporality, zone, reasons, classifier_version FROM news_items ORDER BY content_hash`;
    expect(rows[0]).toMatchObject({ content_hash: 'a', severity: 'medium', reported_severity: 'critical', temporality: 'en_cours', zone: 'etranger', reasons: 'etranger', classifier_version: 'kw-2' });
    expect(rows[1]).toMatchObject({ content_hash: 'b', reasons: '' });
    expect(rows[2]).toMatchObject({ content_hash: 'c', reported_severity: null, zone: null });
  });
  it('aucune ligne : aucun appel SQL', async () => {
    expect(await insertNewsItems(sql, [])).toEqual([]);
  });
});
