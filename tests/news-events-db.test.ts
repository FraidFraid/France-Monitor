import { describe, it, expect, beforeEach } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import { ensureEventTables, runEventPass } from '../api/_lib/news-events-db.js';
import { createTestSql, seedFeeds, insertArticles, type Sql } from './helpers/pglite-sql.ts';

const H = 60 * 60 * 1000;
const T0 = Date.parse('2026-09-23T06:00:00Z');
const RINER = 'Paris. Teddy Riner visé par des messages haineux : une enquête ouverte pour injures racistes';

let sql: Sql;

beforeEach(async () => {
  ({ sql } = await createTestSql());
  await seedFeeds(sql);
  await ensureEventTables(sql);
});

async function events(): Promise<Record<string, unknown>[]> {
  return sql`SELECT * FROM news_events ORDER BY id`;
}

async function logKinds(): Promise<string[]> {
  const rows = await sql`SELECT kind FROM news_event_log ORDER BY id`;
  return rows.map((r) => String(r.kind));
}

describe('ensureEventTables', () => {
  it('est idempotent', async () => {
    await ensureEventTables(sql);
    const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'news_items' AND column_name = 'event_id'`;
    expect(cols).toHaveLength(1);
  });
});

describe('runEventPass', () => {
  it('regroupe une dépêche reprise et compte les groupes de presse indépendants', async () => {
    await insertArticles(sql, [
      { id: 1, feedId: 'le-progres', title: RINER, publishedAt: T0, severity: 'medium' },
      { id: 2, feedId: 'le-dauphine', title: RINER, publishedAt: T0 + 0.5 * H, severity: 'high' },
      { id: 3, feedId: 'le-monde', title: 'Teddy Riner visé par des messages haineux, le parquet ouvre une enquête pour injures racistes', publishedAt: T0 + H },
      { id: 4, feedId: 'sud-ouest', title: 'Gironde : le pont de Saint-Nazaire fermé pour travaux', publishedAt: T0 + H },
    ]);
    const stats = await runEventPass(sql, { now: T0 + 2 * H, insertedIds: [1, 2, 3, 4] });
    expect(stats).toMatchObject({ considered: 4, created: 2, attached: 2 });
    const [riner, pont] = await events();
    expect(riner).toMatchObject({ article_count: 3, source_count: 3, independent_count: 2, severity: 'high', status: 'active' });
    expect(riner.title).toBe('Teddy Riner visé par des messages haineux, le parquet ouvre une enquête pour injures racistes');
    expect(riner.source_names).toEqual(['Le Progrès', 'Le Dauphiné', 'Le Monde']);
    expect(pont).toMatchObject({ article_count: 1, independent_count: 1 });
    expect(await logKinds()).toEqual(['created', 'created']);
  });

  it('journalise la corroboration au passage suivant, sans rien réécrire ensuite', async () => {
    await insertArticles(sql, [{ id: 1, feedId: 'le-progres', title: RINER, publishedAt: T0 }]);
    await runEventPass(sql, { now: T0 + H });
    await insertArticles(sql, [{ id: 2, feedId: 'france-info', title: RINER, publishedAt: T0 + 2 * H }]);
    await runEventPass(sql, { now: T0 + 3 * H, insertedIds: [2] });
    expect(await logKinds()).toEqual(['created', 'corroborated']);
    const again = await runEventPass(sql, { now: T0 + 3 * H });
    expect(again.considered).toBe(0);
    expect(await logKinds()).toEqual(['created', 'corroborated']);
  });

  it('fait vieillir les statuts : refroidissement après 12 h, clôture après 48 h', async () => {
    await insertArticles(sql, [{ id: 1, feedId: 'le-monde', title: RINER, publishedAt: T0 }]);
    await runEventPass(sql, { now: T0 + H });
    await runEventPass(sql, { now: T0 + 13 * H });
    expect((await events())[0].status).toBe('cooling');
    await runEventPass(sql, { now: T0 + 49 * H });
    expect((await events())[0].status).toBe('closed');
    expect(await logKinds()).toEqual(['created', 'cooling', 'closed']);
  });

  it('ignore le bruit et les gabarits non rendus, qui restent sans événement', async () => {
    await insertArticles(sql, [
      { id: 1, feedId: 'le-progres', title: 'Vidéo. $content.TitleNoTags', publishedAt: T0 },
      { id: 2, feedId: 'le-progres', title: 'Cambriolage dans un pavillon du quartier nord', publishedAt: T0, isNoise: true },
    ]);
    const stats = await runEventPass(sql, { now: T0 + H });
    expect(stats).toMatchObject({ considered: 1, skipped: 1, created: 0 });
    const rows = await sql`SELECT count(*)::int AS n FROM news_items WHERE event_id IS NULL`;
    expect(rows[0].n).toBe(2);
  });

  it('borne une date de publication dans le futur à la collecte + 1 h', async () => {
    await insertArticles(sql, [{ id: 1, feedId: 'le-monde', title: RINER, publishedAt: Date.parse('2034-01-01T00:00:00Z'), collectedAt: T0 }]);
    await runEventPass(sql, { now: T0 + H });
    const [e] = await events();
    expect(new Date(String(e.last_seen)).getTime()).toBe(T0 + H);
  });

  it('respecte le budget par passage : l’arriéré est absorbé sur les passages suivants', async () => {
    await insertArticles(sql, [
      { id: 1, feedId: 'le-monde', title: RINER, publishedAt: T0 },
      { id: 2, feedId: 'sud-ouest', title: 'Gironde : le pont de Saint-Nazaire fermé pour travaux', publishedAt: T0 + H },
      { id: 3, feedId: 'france-info', title: 'Explosion dans une usine chimique de Seine-Maritime', publishedAt: T0 + 2 * H },
    ]);
    expect((await runEventPass(sql, { now: T0 + 3 * H, budget: 2, insertedIds: [3] })).considered).toBe(2);
    // Les articles du tick courant passent en premier, puis l'arriéré du plus ancien au plus récent.
    const first = await sql`SELECT id FROM news_items WHERE event_id IS NOT NULL ORDER BY id`;
    expect(first.map((r) => Number(r.id))).toEqual([1, 3]);
    expect((await runEventPass(sql, { now: T0 + 3 * H, budget: 2 })).considered).toBe(1);
  });

  it('purge les événements et le journal de plus de 90 jours', async () => {
    await insertArticles(sql, [{ id: 1, feedId: 'le-monde', title: RINER, publishedAt: T0 }]);
    await runEventPass(sql, { now: T0 + H });
    await runEventPass(sql, { now: T0 + 91 * 24 * H });
    expect(await events()).toHaveLength(0);
    expect(await logKinds()).toEqual([]);
  });
});
