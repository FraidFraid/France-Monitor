import { describe, expect, it } from 'vitest';
import { dropPlaceholderDrafts, isPlaceholderDate } from './rss-dates.ts';

describe('rss-dates (client)', () => {
  const now = new Date('2026-09-28T12:00:00Z');

  it('écarte les items datés 1970 quand d’autres items du flux sont datés', () => {
    const items = [
      { title: 'réel', pubDate: new Date('2026-09-28T09:44:00Z') },
      { title: 'provisoire', pubDate: new Date(0) },
    ];
    expect(dropPlaceholderDrafts(items, now).map((i) => i.title)).toEqual(['réel']);
  });

  it('flux sans vraie date : garde tout à l’heure de collecte', () => {
    const out = dropPlaceholderDrafts([{ pubDate: new Date(0) }, { pubDate: new Date(3_600_000) }], now);
    expect(out.map((i) => i.pubDate.toISOString())).toEqual([now.toISOString(), now.toISOString()]);
  });

  it('ne touche pas un flux normal', () => {
    const items = [{ pubDate: new Date('2014-03-11T08:00:00Z') }, { pubDate: new Date('2026-09-28T08:00:00Z') }];
    expect(dropPlaceholderDrafts(items, now)).toBe(items);
    expect(isPlaceholderDate(new Date('1971-01-01T00:00:00Z'))).toBe(false);
    expect(isPlaceholderDate(new Date(Number.NaN))).toBe(false);
  });
});
