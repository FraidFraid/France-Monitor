import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { INDEX_URL, SNAPSHOT_URL, __resetDatexStateForTests } from '../api/_lib/datex-dir.js';
import handler, { CACHE_CONTROL, loadRoadNational } from '../api/_handlers/traffic/road-national.js';
import type { RoadNationalResponse } from '../src/types/index.ts';
import { type FakeResponse, callHandler, fixtureText, respond, stubFetch } from './helpers/traffic-fixtures.ts';

const NOW = Date.parse('2026-10-03T15:10:00+02:00');

function stubSources(override: (url: string) => FakeResponse | null = () => null) {
  return stubFetch((url) => {
    const forced = override(url);
    if (forced) return forced;
    if (url === SNAPSHOT_URL) return respond(fixtureText('datex-content.xml'));
    if (url === INDEX_URL) return respond('3566873');
    const m = /\/RRN\/(\d+)\.xml$/.exec(url);
    if (m) return respond(fixtureText(`datex-inc-${m[1]}.xml`));
    return respond('introuvable', 404);
  });
}

beforeEach(() => { __resetSwrCacheForTests(); __resetDatexStateForTests(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('/api/traffic/road-national (DIR, réponses réelles du 03/10/2026)', () => {
  it('200, cache 5 min, publication du dernier fichier du journal, comptes du jour', async () => {
    stubSources();
    const { status, body, cache } = await callHandler<RoadNationalResponse>(handler);
    expect(status).toBe(200);
    expect(cache).toBe(CACHE_CONTROL);
    expect(body.publishedAt).toBe('2026-10-03T15:03:35.704+02:00');
    expect(body.counts).toMatchObject({ accidents: 4, closures: 1 });
    expect(body.errors).toEqual([]);
  });
  it('deuxième appel dans les 5 min : servi par le cache, aucune requête', async () => {
    const log = stubSources();
    await loadRoadNational(NOW);
    const before = log.urls.length;
    await loadRoadNational(NOW + 60_000);
    expect(log.urls.length).toBe(before);
  });
  it.each([
    [respond('erreur', 500), 'DIR : HTTP 500'],
    [respond(fixtureText('challenge-captcha.html')), 'DIR : page de contrôle anti-robot'],
    [respond('<!DOCTYPE html><html><body>Maintenance</body></html>'), 'DIR : page HTML reçue au lieu de données'],
  ])('instantané en panne : 502 non mis en cache, erreur nommée', async (failure, message) => {
    stubSources((url) => (url === SNAPSHOT_URL ? failure : null));
    const { status, body, cache } = await callHandler<RoadNationalResponse>(handler);
    expect([status, cache]).toEqual([502, 'no-store']);
    expect(body.errors).toEqual([message]);
    expect(body.events).toEqual([]);
    expect(body.publishedAt).toBeNull();
  });
});
