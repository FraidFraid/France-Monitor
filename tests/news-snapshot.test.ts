// tests/news-snapshot.test.ts : instantané des dernières 24 h de /api/news (20/10/2026) : la requête standard de la page ne relit Neon
// qu'en entier toutes les 3 h, et entre deux seulement les articles collectés depuis le dernier passage d'ingestion.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ text: string; params: unknown[] }> = [];
let rows: Record<string, unknown>[] = [];

vi.mock('@neondatabase/serverless', () => ({
  neon: () => ({
    query: async (text: string, params: unknown[]) => {
      calls.push({ text, params });
      return rows;
    },
  }),
}));

// @ts-expect-error : module JS sans déclaration de types
const { queryNews, markNewsSnapshotStale, resetNewsSnapshot } = await import('../api/_handlers/news.js');

const NOW = Date.parse('2026-10-20T18:00:00Z');
const row = (id: number, publishedMin: number, collectedMin: number): Record<string, unknown> => ({
  id, feed_id: 'f', feed_name: 'F', feed_region: null, tier: 1, title: `t${id}`, link: `https://x/${id}`, description: null,
  published_at: new Date(NOW - publishedMin * 60_000).toISOString(), collected_at: new Date(NOW - collectedMin * 60_000).toISOString(),
  category: null, severity: null, confidence: null, lat: null, lon: null, event_id: null, classifier_version: null,
});
const standard = (): URLSearchParams => new URLSearchParams({ since: new Date(NOW - 24 * 3600_000).toISOString(), limit: '1000' });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  process.env.DATABASE_URL = 'postgres://test';
  calls.length = 0;
  resetNewsSnapshot();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('/api/news : instantané des dernières 24 h', () => {
  it('relecture complète une fois, puis servie de mémoire tant que rien n’a été collecté', async () => {
    // Relecture complète : déjà triée par la base (ORDER BY published_at DESC).
    rows = [row(2, 30, 20), row(1, 60, 50)];
    const a = await queryNews(standard());
    expect(a.body.items.map((i: { id: number }) => i.id)).toEqual([2, 1]);
    const b = await queryNews(standard());
    expect(b.body.items).toHaveLength(2);
    expect(calls).toHaveLength(1);
  });
  it('après un passage d’ingestion : seuls les articles collectés depuis sont lus, fusionnés dans l’ordre de publication', async () => {
    rows = [row(2, 30, 20), row(1, 60, 50)];
    await queryNews(standard());
    rows = [row(3, 45, 5)];
    markNewsSnapshotStale();
    const r = await queryNews(standard());
    expect(calls).toHaveLength(2);
    expect(calls[1]?.text).toContain('collected_at >= $1');
    expect(r.body.items.map((i: { id: number }) => i.id)).toEqual([2, 3, 1]);
  });
  it('au-delà de 3 h : relecture complète ; une requête filtrée va toujours en base', async () => {
    rows = [row(1, 60, 50)];
    await queryNews(standard());
    vi.setSystemTime(NOW + 3 * 3600_000 + 1);
    await queryNews(new URLSearchParams({ since: new Date(NOW).toISOString(), limit: '1000' }));
    expect(calls[1]?.text).not.toContain('collected_at >= $1');
    await queryNews(new URLSearchParams({ since: new Date(NOW).toISOString(), category: 'security' }));
    expect(calls).toHaveLength(3);
  });
});
