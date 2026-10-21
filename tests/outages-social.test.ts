// tests/outages-social.test.ts : signalements d'usagers (Bluesky, Mastodon), control room des pannes (21/10/2026).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SOCIAL_QUERIES, __resetSocialForTests, blueskyTimes, ensureSocialFresh, mastodonTimes, socialOutages, socialSignal,
} from '../api/_lib/outages-social.js';
import { respond, stubFetch } from './helpers/traffic-fixtures.ts';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const MIN = 60_000;
const ago = (m: number) => new Date(NOW - m * MIN).toISOString();

describe('signal d’usagers', () => {
  it('jaune à 10 messages en 15 min, orange à 30, pic à 3 fois la normale dès 5 ; calme : rien', () => {
    const calm = Array.from({ length: 40 }, (_, i) => NOW - (60 + i * 60) * MIN);
    expect(socialSignal(calm, NOW).level).toBeNull();
    expect(socialSignal([...Array.from({ length: 10 }, (_, i) => NOW - i * MIN), ...calm], NOW)).toMatchObject({ recent: 10, level: 'jaune' });
    expect(socialSignal(Array.from({ length: 30 }, (_, i) => NOW - i * 20_000), NOW).level).toBe('orange');
    const quiet = Array.from({ length: 20 }, (_, i) => NOW - (2 * 24 * 60 + i * 300) * MIN);
    expect(socialSignal([...Array.from({ length: 5 }, (_, i) => NOW - i * MIN), ...quiet], NOW).level).toBe('jaune');
    expect(socialSignal([NOW - MIN, NOW - 2 * MIN], NOW).level).toBeNull();
  });
  it('lecture Bluesky : dates des messages ; Mastodon : messages filtrés par les mots de la requête, HTML retiré', () => {
    expect(blueskyTimes({ posts: [{ record: { createdAt: ago(1) } }, { record: {} }, { indexedAt: ago(2), record: { createdAt: 'x' } }] })).toEqual([NOW - MIN]);
    const statuses = [
      { created_at: ago(1), content: '<p>Grosse <b>panne</b> chez Orange ce midi</p>' },
      { created_at: ago(2), content: '<p>Belle journée</p>' },
    ];
    expect(mastodonTimes(statuses, ['panne', 'orange'])).toEqual([NOW - MIN]);
  });
});

describe('collecte et pannes signalées', () => {
  beforeEach(() => { __resetSocialForTests(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('pic sur « panne orange » : panne mobile Orange signalée par les usagers, lien de recherche publique, aucun compte gardé', async () => {
    const burst = { posts: Array.from({ length: 12 }, (_, i) => ({ author: { handle: 'x.bsky.social' }, record: { createdAt: ago(i), text: 'panne orange' } })) };
    const log = stubFetch((url) => (url.includes('bsky') && url.includes('panne+orange') ? respond(burst) : url.includes('bsky') ? respond({ posts: [] }) : respond([])));
    await ensureSocialFresh(NOW);
    expect(log.urls.filter((u) => u.includes('bsky')).length).toBe(SOCIAL_QUERIES.length);
    const r = socialOutages(NOW);
    expect(r).toEqual([expect.objectContaining({ network: 'mobile', operator: 'Orange', level: 'jaune', recent: 12 })]);
    expect(r[0]?.link).toContain('bsky.app/search');
    expect(JSON.stringify(r)).not.toContain('x.bsky.social');
  });
  it('source en panne : rien de signalé, erreur nommée ; relève au plus toutes les 2 min', async () => {
    const log = stubFetch(() => respond('down', 503));
    await ensureSocialFresh(NOW);
    expect(socialOutages(NOW)).toEqual([]);
    const n = log.urls.length;
    await ensureSocialFresh(NOW + MIN);
    expect(log.urls.length).toBe(n);
  });
});
