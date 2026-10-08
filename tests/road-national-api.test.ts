import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { INDEX_URL, SNAPSHOT_URL, __resetDatexStateForTests } from '../api/_lib/datex-dir.js';
import { CNIR_URL, QTV_URL, REFDIR_URL, TRAFICOLOR_BASE } from '../api/_lib/dir-measures.js';
import handler, { CACHE_CONTROL, loadRoadNational } from '../api/_handlers/traffic/road-national.js';
import type { RoadNationalResponse } from '../src/types/index.ts';
import { type FakeResponse, callHandler, fixtureText, respond, stubFetch } from './helpers/traffic-fixtures.ts';

const NOW = Date.parse('2026-10-03T15:10:00+02:00');

/** Toutes les sources du réseau national, réponses réelles du 03/10/2026 ; `override` remplace une réponse. */
function stubSources(override: (url: string) => FakeResponse | null = () => null) {
  return stubFetch((url) => {
    const forced = override(url);
    if (forced) return forced;
    if (url === SNAPSHOT_URL) return respond(fixtureText('datex-content.xml'));
    if (url === INDEX_URL) return respond('3566873');
    const inc = /\/RRN\/(\d+)\.xml$/.exec(url);
    if (inc) return respond(fixtureText(`datex-inc-${inc[1]}.xml`));
    if (url === QTV_URL) return respond(fixtureText('qtv-dir.xml'));
    if (url === REFDIR_URL) return respond(fixtureText('refdir.csv'));
    if (url === CNIR_URL) return respond(fixtureText('cnir-bouchons.html'));
    if (url === `${TRAFICOLOR_BASE}/`) return respond(fixtureText('traficolor-index.html'));
    const listing = /TRAFICOLOR-DIR\/(\w+)\/\?C=M;O=D$/.exec(url);
    if (listing) return respond(fixtureText(`traficolor-listing-${listing[1]}.html`));
    const file = /TRAFICOLOR-DIR\/(\w+)\/[^/]+\.xml$/.exec(url);
    if (file) return respond(fixtureText(`traficolor-${file[1]}.xml`));
    return respond('introuvable', 404);
  });
}

const failing = (match: (url: string) => boolean, response: FakeResponse) => (url: string) => (match(url) ? response : null);

beforeEach(() => { __resetSwrCacheForTests(); __resetDatexStateForTests(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('/api/traffic/road-national (DIR, QTV, Traficolor, CNIR ; réponses réelles du 03/10/2026)', () => {
  it('200, cache 5 min ; chaque partie porte sa propre date', async () => {
    stubSources();
    const { status, body, cache } = await callHandler<RoadNationalResponse>(handler);
    expect([status, cache]).toEqual([200, CACHE_CONTROL]);
    expect(body.errors).toEqual([]);
    expect(body.publishedAt).toBe('2026-10-03T15:03:35.704+02:00');
    expect(body.counts).toMatchObject({ accidents: 4, closures: 1 });
    expect(body.speeds).toMatchObject({ at: '2026-10-03T15:00:00.000+02:00', stations: 41, under50: 16, median: 67.8 });
    expect(body.agglos.map((a) => [a.label, a.congestedPct, a.at])).toEqual([
      ['Bordeaux', 17.6, '2026-10-03T13:44:40.000Z'], ['Lille', 4.2, '2026-10-03T13:48:26.000Z'], ['Marseille', 48, '2026-10-03T13:48:00.000Z'],
    ]);
    expect(body.conceded.at).toBe('2026-10-03T13:42:00.000Z');
    expect(body.conceded.jams).toHaveLength(6);
    expect(body.sections).toHaveLength(13);
    expect(body.sections.every((x) => x.network === 'TraficMarius' && x.path.length === 2)).toBe(true);
  });
  it('deuxième appel dans les 5 min : aucune requête', async () => {
    const log = stubSources();
    await loadRoadNational(NOW);
    const before = log.urls.length;
    await loadRoadNational(NOW + 60_000);
    expect(log.urls.length).toBe(before);
  });
  it('un réseau Traficolor en HTTP 403 et la page CNIR remplacée par une page de défi : les autres parties restent', async () => {
    stubSources((url) => {
      if (url.includes('/TraficLille/')) return respond('interdit', 403);
      if (url === CNIR_URL) return respond(fixtureText('challenge-captcha.html'));
      return null;
    });
    const { status, body, cache } = await callHandler<RoadNationalResponse>(handler);
    expect(status).toBe(200);
    expect(cache).toBe('s-maxage=300, stale-while-revalidate=600');
    expect(body.errors).toEqual(['CNIR : page de contrôle anti-robot', 'Traficolor, TraficLille : HTTP 403']);
    expect(body.agglos.map((a) => a.label)).toEqual(['Bordeaux', 'Marseille']);
    expect(body.conceded).toEqual({ at: null, jams: [] });
    expect(body.counts.accidents).toBe(4);
  });
  it.each([
    [respond('erreur', 500), 'DIR : HTTP 500'],
    [respond(fixtureText('challenge-captcha.html')), 'DIR : page de contrôle anti-robot'],
    [respond('<!DOCTYPE html><html><body>Maintenance</body></html>'), 'DIR : page HTML reçue au lieu de données'],
  ])('instantané DIR en panne : 200 avec les autres parties, erreur nommée', async (failure, message) => {
    stubSources((url) => (url === SNAPSHOT_URL ? failure : null));
    const { status, body } = await callHandler<RoadNationalResponse>(handler);
    expect(status).toBe(200);
    expect(body.errors).toEqual([message]);
    expect(body.events).toEqual([]);
    expect(body.publishedAt).toBeNull();
    expect(body.speeds.stations).toBe(41);
    expect(body.agglos).toHaveLength(3);
    expect(body.conceded.jams).toHaveLength(6);
  });
  it('référentiel indisponible, Traficolor sain : sections vides, agglomérations servies, erreur nommée une fois', async () => {
    stubSources(failing((u) => u === REFDIR_URL, respond('erreur', 500)));
    const body = await loadRoadNational(NOW);
    expect(body.sections).toEqual([]);
    expect(body.agglos).toHaveLength(3);
    expect(body.errors).toEqual(['QTV : HTTP 500']);
  });
  it('QTV en HTTP 429 : vitesses vides et nommées, le reste servi', async () => {
    stubSources(failing((u) => u === QTV_URL, respond('Too Many Requests', 429)));
    const body = await loadRoadNational(NOW);
    expect(body.errors).toEqual(['QTV : HTTP 429']);
    expect(body.speeds).toEqual({ at: null, stations: 0, under50: 0, median: null, slowest: [] });
  });
  it('toutes les sources en HTTP 500 : 502 non mis en cache, une erreur par source', async () => {
    stubSources(() => respond('erreur', 500));
    const { status, body, cache } = await callHandler<RoadNationalResponse>(handler);
    expect([status, cache]).toEqual([502, 'no-store']);
    expect(body.errors).toEqual(['CNIR : HTTP 500', 'DIR : HTTP 500', 'QTV : HTTP 500', 'Traficolor : HTTP 500']);
    expect(body.publishedAt).toBeNull();
  });
});
