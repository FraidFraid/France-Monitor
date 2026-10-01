// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { apiRowToNewsItem } from './UnderMapNewsFeed.ts';

describe('fil sous la carte : aucun tiret cadratin', () => {
  it('titre et description d’une ligne /api/news', () => {
    const item = apiRowToNewsItem({
      id: '1', title: 'Grève — la SNCF', link: 'https://exemple.fr/a', publishedAt: '2026-10-01T08:00:00Z',
      description: 'Trafic — perturbé', severity: 'high', category: 'transport',
    });
    expect(item.title).toBe('Grève : la SNCF');
    expect(item.summary).toBe('Trafic : perturbé');
  });
});
