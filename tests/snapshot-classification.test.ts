import { describe, it, expect } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import { fetchNews } from '../scripts/snapshot-classification.mjs';

describe('fetchNews', () => {
  it('pagine avec before (+1 ms), dédoublonne et s’arrête sur une page incomplète', async () => {
    const pages = [
      { items: [{ id: 3, publishedAt: '2026-09-28T10:00:00.000Z' }, { id: 2, publishedAt: '2026-09-28T09:00:00.000Z' }] },
      { items: [{ id: 2, publishedAt: '2026-09-28T09:00:00.000Z' }, { id: 1, publishedAt: '2026-09-28T08:00:00.000Z' }] },
      { items: [{ id: 1, publishedAt: '2026-09-28T08:00:00.000Z' }] },
    ];
    const urls: string[] = [];
    const getJson = async (url: string) => {
      urls.push(url);
      return pages[urls.length - 1];
    };
    const items = await fetchNews('https://x.test', 0, { getJson, pageSize: 2 });
    expect(items.map((i: { id: number }) => i.id).sort()).toEqual([1, 2, 3]);
    expect(urls).toHaveLength(3);
    expect(new URL(urls[1]).searchParams.get('before')).toBe('2026-09-28T09:00:00.001Z');
  });

  it('s’arrête quand une page pleine n’apporte aucun article nouveau', async () => {
    const page = { items: [{ id: 1, publishedAt: '2026-09-28T08:00:00.000Z' }, { id: 2, publishedAt: '2026-09-28T08:00:00.000Z' }] };
    let calls = 0;
    const items = await fetchNews('https://x.test', 0, {
      getJson: async () => {
        calls += 1;
        return page;
      },
      pageSize: 2,
    });
    expect(items).toHaveLength(2);
    expect(calls).toBe(2);
  });
});
