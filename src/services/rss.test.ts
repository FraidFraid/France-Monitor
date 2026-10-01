import { describe, expect, it } from 'vitest';
import { mapIngestItem } from './rss.ts';

describe('rss : aucun tiret cadratin', () => {
  it('titre et description d’un article /api/news', () => {
    const item = mapIngestItem({
      title: 'Grève — la SNCF annonce un trafic perturbé',
      link: 'https://exemple.fr/a',
      description: 'Trafic — perturbations attendues',
      publishedAt: '2026-10-01T08:00:00Z',
    } as Parameters<typeof mapIngestItem>[0]);
    expect(item?.title).toBe('Grève : la SNCF annonce un trafic perturbé');
    expect(item?.summary).toBe('Trafic : perturbations attendues');
  });
});
