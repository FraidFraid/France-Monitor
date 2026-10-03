import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { __resetSncfStateForTests, tripUrl } from '../api/_lib/sncf-rail.js';
import { SIRI_SX_URL } from '../api/_lib/siri-sx.js';
import overviewHandler, { CACHE_CONTROL } from '../api/_handlers/transport/rail-overview.js';
import situationsHandler from '../api/_handlers/transport/rail-situations.js';
import { ROUTES } from '../api/_routes.js';
import type { RailOverviewResponse, RailSituationsResponse } from '../src/types/index.ts';
import { callHandler, fixtureText, respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

const NOW = Date.parse('2026-10-03T15:10:00+02:00');

beforeEach(() => {
  __resetSwrCacheForTests();
  __resetSncfStateForTests();
  vi.stubEnv('SNCF_API_KEY', 'cle-de-test');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('/api/transport/rail-overview (API SNCF, réponses réelles du 03/10/2026)', () => {
  it('200, cache 5 min ; clé en Basic ; itinéraire du train supprimé relu, échec nommé pour l’autre', async () => {
    const log = stubFetch((url) => {
      if (url.includes('/disruptions?')) return respond(fixtureText('sncf-disruptions.json'));
      if (url === tripUrl('SNCF:2026-10-03:4762:1187:LongDistanceTrain')) return respond(fixtureText('sncf-trip-4762.json'));
      return respond('{"error":"absent"}', 404);
    });
    const { status, body, cache } = await callHandler<RailOverviewResponse>(overviewHandler);
    expect([status, cache]).toEqual([200, 's-maxage=300, stale-while-revalidate=600']);
    expect(sentHeader(log.inits[0], 'Authorization')).toBe(`Basic ${Buffer.from('cle-de-test:').toString('base64')}`);
    expect(body.errors).toEqual(['SNCF, itinéraires des trains supprimés : 1 non lu']);
    expect(body.axes[0]).toMatchObject({ key: 'sud-est', trains: 6, avgDelayMin: 56.7 });
    expect(body.longDistance).toEqual({ active: 15, delayed15: 10 });
    expect(CACHE_CONTROL).toBe('s-maxage=300, stale-while-revalidate=600');
  });
  it.each([
    [respond('{"message":"no token"}', 401), 'SNCF : HTTP 401'],
    [respond('Too Many Requests', 429), 'SNCF : HTTP 429'],
    [respond(fixtureText('challenge-captcha.html')), 'SNCF : page de contrôle anti-robot'],
  ])('panne amont : 502 non mis en cache, erreur nommée', async (failure, message) => {
    stubFetch(() => failure);
    const { status, body, cache } = await callHandler<RailOverviewResponse>(overviewHandler);
    expect([status, cache, body.errors, body.updatedAt]).toEqual([502, 'no-store', [message], null]);
  });
  it('clé absente : aucun appel, erreur nommée', async () => {
    vi.stubEnv('SNCF_API_KEY', '');
    const log = stubFetch(() => respond('{}'));
    const { body } = await callHandler<RailOverviewResponse>(overviewHandler);
    expect(log.urls).toEqual([]);
    expect(body.errors).toEqual(['SNCF : clé absente (SNCF_API_KEY)']);
  });
});

describe('/api/transport/rail-situations (SIRI SX Lite, sans clé)', () => {
  it('200 ; situations classées ; flux en HTTP 500 : 502 non mis en cache', async () => {
    vi.setSystemTime(Date.parse('2026-10-03T13:10:28Z'));
    const log = stubFetch((url) => (url === SIRI_SX_URL ? respond(fixtureText('siri-sx.xml')) : respond('', 404)));
    const ok = await callHandler<RailSituationsResponse>(situationsHandler);
    expect([ok.status, ok.body.at, ok.body.situations.length, ok.body.errors]).toEqual([200, '2026-10-03T13:10:28.519Z', 26, []]);
    expect(sentHeader(log.inits[0], 'User-Agent')).toBe('FranceMonitor/1.0 (+https://www.francemonitor.com)');
    __resetSwrCacheForTests();
    stubFetch(() => respond('erreur', 500));
    const ko = await callHandler<RailSituationsResponse>(situationsHandler);
    expect([ko.status, ko.cache, ko.body.errors]).toEqual([502, 'no-store', ['SIRI SX : HTTP 500']]);
  });
});

describe('route orpheline retirée', () => {
  it('/api/transport/osm-railways n’existe plus (ni gestionnaire, ni miroir de dev)', () => {
    expect(Object.keys(ROUTES)).not.toContain('/api/transport/osm-railways');
    expect(readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')).not.toMatch(/osmRailways/);
    expect(Object.keys(ROUTES)).toEqual(expect.arrayContaining(['/api/transport/rail-overview', '/api/transport/rail-situations', '/api/transport/disruptions']));
  });
});
