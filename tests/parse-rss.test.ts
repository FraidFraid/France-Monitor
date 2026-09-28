import { describe, expect, it } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import { dropPlaceholderDrafts, isPlaceholderPubDate, parseRssXml } from '../api/_lib/parse-rss.js';

type Item = { title: string; link: string; pubDate: string };

// Forme réelle d'imazpress.com/feed (rubrique france-monde) : version provisoire datée 1970 puis,
// ~30 min plus tard, la même URL avec son vrai titre et sa vraie date (vu le 28/09/2026).
function imazFeed(items: Array<{ title: string; link: string; pubDate: string }>): string {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Imaz Press</title>${items
    .map((i) => `<item><title><![CDATA[${i.title}]]></title><link>${i.link}</link><pubDate>${i.pubDate}</pubDate><description>x</description></item>`)
    .join('')}</channel></rss>`;
}

describe('parse-rss — dates « zéro » (01/01/1970)', () => {
  it('écarte la version provisoire datée 1970 quand les autres items sont datés', () => {
    const items = parseRssXml(imazFeed([
      { title: 'Saint-Pierre : un nouveau marché de nuit', link: 'https://imazpress.com/saint-pierre-actualite/marche', pubDate: 'Mon, 28 Sep 2026 16:21:00 +0400' },
      { title: 'Actualités du monde : Projet d’attaque contre une base militaire en Angleterre', link: 'https://imazpress.com/france-monde/projet-d-attaque', pubDate: 'Thu, 01 Jan 1970 00:00:00 +0000' },
    ])) as Item[];
    expect(items.map((i) => i.title)).toEqual(['Saint-Pierre : un nouveau marché de nuit']);
  });

  it('garde les vieux articles réellement datés (2014, 2019)', () => {
    const items = parseRssXml(imazFeed([
      { title: 'Récent', link: 'https://a.fr/1', pubDate: 'Mon, 28 Sep 2026 10:00:00 +0200' },
      { title: 'Archive', link: 'https://a.fr/2', pubDate: 'Tue, 11 Mar 2014 09:00:00 +0100' },
    ])) as Item[];
    expect(items).toHaveLength(2);
  });

  it('flux sans aucune vraie date : garde les items à l’heure de collecte', () => {
    const before = Date.now();
    const items = dropPlaceholderDrafts([
      { title: 'A', link: 'https://a.fr/1', pubDate: 'Thu, 01 Jan 1970 00:00:00 +0000' },
      { title: 'B', link: 'https://a.fr/2', pubDate: '1970-01-01T04:00:00+04:00' },
    ]) as Item[];
    expect(items).toHaveLength(2);
    for (const item of items) expect(Date.parse(item.pubDate)).toBeGreaterThanOrEqual(before);
  });

  it('isPlaceholderPubDate : 1970 oui ; vide, illisible ou 1971+ non', () => {
    expect(isPlaceholderPubDate('Thu, 01 Jan 1970 00:00:00 +0000')).toBe(true);
    expect(isPlaceholderPubDate('1970-01-01T04:00:00+04:00')).toBe(true);
    expect(isPlaceholderPubDate(undefined)).toBe(false);
    expect(isPlaceholderPubDate('pas une date')).toBe(false);
    expect(isPlaceholderPubDate('Fri, 01 Jan 1971 00:00:00 +0000')).toBe(false);
  });
});
