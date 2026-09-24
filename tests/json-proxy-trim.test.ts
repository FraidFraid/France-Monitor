import { describe, it, expect } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import { trimUpstreamPayload } from '../api/_handlers/json-proxy.js';

const NOW = Date.parse('2026-09-23T12:00:00Z');

describe('trimUpstreamPayload', () => {
  it('ne garde que les 45 derniers jours de posts.json (limite de 4,5 Mo des fonctions Vercel)', () => {
    const posts = [
      { post_title: 'récent', discovered: '2026-09-20T10:00:00+00:00', country: 'FR' },
      { post_title: 'limite', discovered: '2026-08-10T12:00:00+00:00', country: 'FR' },
      { post_title: 'ancien', discovered: '2026-07-01T00:00:00+00:00', country: 'FR' },
      { post_title: 'sans date' },
    ];
    const out = trimUpstreamPayload('https://data.ransomware.live/posts.json', posts, NOW) as { post_title: string }[];
    expect(out.map((p) => p.post_title)).toEqual(['récent', 'limite']);
  });

  it('laisse les autres URL intactes', () => {
    const data = [{ discovered: '2000-01-01' }];
    expect(trimUpstreamPayload('https://services.nvd.nist.gov/rest/json/cves/2.0', data, NOW)).toBe(data);
    expect(trimUpstreamPayload('https://api.ransomware.live/groups', data, NOW)).toBe(data);
  });
});
