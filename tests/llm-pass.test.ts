import { describe, it, expect, beforeEach, vi } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import { runLlmPass, LLM_CONFIDENCE } from '../api/_lib/llm-pass.js';
// @ts-expect-error — module JS sans déclaration de types
import { ensureClassificationColumns } from '../api/_lib/classification-columns.js';
import { createTestSql, seedFeeds, type Sql } from './helpers/pglite-sql.ts';

const T0 = Date.parse('2026-09-28T06:00:00Z');
const LLM = { url: 'https://llm.test', model: 'm', apiKey: 'k', version: 'groq-2' };
let sql: Sql;

beforeEach(async () => {
  ({ sql } = await createTestSql());
  await seedFeeds(sql);
  await ensureClassificationColumns(sql);
  vi.restoreAllMocks();
}, 30_000);

async function insertItem(row: { id: number; feedId: string; title: string; severity: string; confidence: number; version?: string; publishedAt?: number }) {
  await sql`
    INSERT INTO news_items (id, content_hash, feed_id, title, link, description, published_at, category, severity, confidence, classifier_version)
    VALUES (${row.id}, ${`h${row.id}`}, ${row.feedId}, ${row.title}, ${`https://example.fr/${row.id}`}, ${null},
            ${new Date(row.publishedAt ?? T0).toISOString()}, ${'general'}, ${row.severity}, ${row.confidence}, ${row.version ?? 'kw-2'})
  `;
}
const judgment = (severity: number, extra: Record<string, unknown> = {}) => ({ category: 'security', severity, inFrance: true, ongoing: true, ...extra });
const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const opts = (classify: unknown, n: number, deadline = Date.now() + 60_000) => ({ llm: LLM, insertedIds: ids(n), keywordVersion: 'kw-2', deadline, classify });

describe('runLlmPass', () => {
  it('graves puis ambigus par rang de flux ; qualification écrite ; version du fournisseur', async () => {
    await insertItem({ id: 1, feedId: 'sud-ouest', title: 'Royaume-Uni : attentat déjoué près d’une base', severity: 'critical', confidence: 0.9 });
    await insertItem({ id: 2, feedId: 'le-monde', title: 'Trois morts dans la Manche', severity: 'info', confidence: 0.2 });
    await insertItem({ id: 3, feedId: 'sud-ouest', title: 'Coupure géante dans le Bordelais', severity: 'info', confidence: 0.2 });
    await insertItem({ id: 4, feedId: 'le-monde', title: 'Manifestation à Nantes', severity: 'medium', confidence: 0.65 });
    await insertItem({ id: 5, feedId: 'le-monde', title: 'Déjà reclassé', severity: 'low', confidence: 0.75, version: 'groq-2' });
    const calls: number[][] = [];
    const classify = vi.fn(async (_llm: unknown, batch: Array<{ id: number }>) => {
      calls.push(batch.map((a) => a.id));
      return batch.map((a) => (a.id === 1 ? judgment(4) : a.id === 2 ? judgment(3) : null));
    });
    expect(await runLlmPass(sql, opts(classify, 5))).toEqual({ classified: 2, calls: 1, unreadable: 0, stopped: null });
    expect(calls).toEqual([[1, 2, 3]]);
    const rows = await sql`SELECT id, severity, reported_severity, zone, temporality, reasons, confidence, classifier_version FROM news_items ORDER BY id`;
    expect(rows[0]).toMatchObject({ severity: 'medium', reported_severity: 'critical', zone: 'etranger', temporality: 'en_cours', reasons: 'etranger', classifier_version: 'groq-2' });
    expect(Number(rows[0].confidence)).toBeCloseTo(LLM_CONFIDENCE, 5);
    expect(rows[1]).toMatchObject({ severity: 'high', zone: 'france', reasons: '', classifier_version: 'groq-2' });
    expect(rows[2]).toMatchObject({ severity: 'info', classifier_version: 'kw-2' });
    expect(rows[3]).toMatchObject({ severity: 'medium', classifier_version: 'kw-2' });
    expect(rows[4]).toMatchObject({ severity: 'low', classifier_version: 'groq-2' });
  });

  it('lots de 10, 2 au plus ; HTTP 429 au 2ᵉ lot : le 1ᵉʳ reste écrit, la passe s’arrête', async () => {
    for (const id of ids(25)) await insertItem({ id, feedId: 'le-monde', title: `Article ${id}`, severity: 'info', confidence: 0.2, publishedAt: T0 + id * 1000 });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const classify = vi.fn()
      .mockImplementationOnce(async (_llm: unknown, batch: unknown[]) => batch.map(() => judgment(1)))
      .mockImplementationOnce(async () => { throw Object.assign(new Error('LLM HTTP 429'), { status: 429 }); });
    expect(await runLlmPass(sql, opts(classify, 25))).toEqual({ classified: 10, calls: 2, unreadable: 0, stopped: 'http-429' });
    expect(classify).toHaveBeenCalledTimes(2);
    expect(classify.mock.calls[0][1]).toHaveLength(10);
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM news_items WHERE classifier_version = 'groq-2'`;
    expect(count).toBe(10);
  });

  it('lot illisible ignoré, la passe continue au lot suivant', async () => {
    for (const id of ids(12)) await insertItem({ id, feedId: 'le-monde', title: `Article ${id}`, severity: 'info', confidence: 0.2, publishedAt: T0 + id * 1000 });
    const classify = vi.fn()
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(async (_llm: unknown, batch: unknown[]) => batch.map(() => judgment(2)));
    expect(await runLlmPass(sql, opts(classify, 12))).toEqual({ classified: 2, calls: 2, unreadable: 1, stopped: null });
    expect(classify).toHaveBeenCalledTimes(2);
  });

  it('échéance dépassée ou aucun article inséré : aucun appel', async () => {
    await insertItem({ id: 1, feedId: 'le-monde', title: 'Article', severity: 'info', confidence: 0.2 });
    const classify = vi.fn();
    expect(await runLlmPass(sql, opts(classify, 1, Date.now() - 1))).toEqual({ classified: 0, calls: 0, unreadable: 0, stopped: 'deadline' });
    expect(await runLlmPass(sql, opts(classify, 0))).toEqual({ classified: 0, calls: 0, unreadable: 0, stopped: null });
    expect(classify).not.toHaveBeenCalled();
  });

  it('nombre de lots par passage réglable (revue finale I3)', async () => {
    for (const id of ids(25)) await insertItem({ id, feedId: 'le-monde', title: `Article ${id}`, severity: 'info', confidence: 0.2, publishedAt: T0 + id * 1000 });
    const classify = vi.fn(async (_llm: unknown, batch: unknown[]) => batch.map(() => judgment(1)));
    expect(await runLlmPass(sql, { ...opts(classify, 25), batchesPerTick: 1 })).toEqual({ classified: 10, calls: 1, unreadable: 0, stopped: null });
  });
});
