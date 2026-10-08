// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mapIngestItem, mapJsonProxyItem, parseRSSItems } from './rss.ts';

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

  const feed = { name: 'Presse', url: 'https://exemple.fr/rss', tier: 2, region: 'FR' } as unknown as Parameters<typeof mapJsonProxyItem>[1];

  it('élément du proxy JSON', () => {
    const item = mapJsonProxyItem({
      title: 'Grève \u2014 la SNCF', link: 'https://exemple.fr/b', pubDate: '2026-10-01T08:00:00Z', description: 'Trafic \u2014 perturbé',
    }, feed);
    expect(item?.title).toBe('Grève : la SNCF');
    expect(item?.summary).toBe('Trafic : perturbé');
  });

  it('flux XML (parseRSSItems)', () => {
    const xml = '<?xml version="1.0"?><rss><channel><item><title>Grève \u2014 la SNCF</title><link>https://exemple.fr/c</link><pubDate>Thu, 01 Oct 2026 08:00:00 GMT</pubDate><description>Trafic \u2014 perturbé</description></item></channel></rss>';
    const items = parseRSSItems(xml, feed);
    expect(items?.[0].title).toBe('Grève : la SNCF');
    expect(items?.[0].summary).toBe('Trafic : perturbé');
  });
});
