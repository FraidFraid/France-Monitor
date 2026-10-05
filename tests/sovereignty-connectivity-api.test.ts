// tests/sovereignty-connectivity-api.test.ts : visibilité des six grands réseaux français (RIPEstat) et annuaire des points d'échange
// (PeeringDB), route /api/sovereignty/connectivity (spec 2026-10-04 souveraineté § 3.3 ; contrats § 2.6, arbitrage 31) sur les réponses
// réelles du 04/10/2026 : instantanés de 8 h, jamais en continu ; un réseau illisible est nommé, jamais compté à 0 ; série de 30 jours
// alimentée seulement par des instantanés complets.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { __resetKvForTests, __setKvClientForTests, readSeries } from '../api/_lib/kv-history.js';
import {
  MAJOR_NETWORKS, RIPE_PENDING_NOTE, RIPE_SAMPLES_KEY, RIPE_SAMPLES_MAX_AGE_MS, RIPE_TIMEOUT_MS, __resetRipeForTests, ensureRipeFresh, parseRoutingStatus,
  routingStatusUrl,
} from '../api/_lib/ripestat.js';
import { PEERINGDB_IX_URL, parseIx } from '../api/_lib/peeringdb.js';
import handler, { CACHE_CONTROL, PENDING_CACHE_CONTROL, loadConnectivity } from '../api/_handlers/sovereignty/connectivity.js';
import type { ConnectivityResponse } from '../src/types/index.ts';
import { type FakeResponse, callHandler, respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/sovereignty/${name}`, import.meta.url), 'utf8');
const ripe = (asn: number, queryTime = '2026-10-04T08:00:00'): unknown => {
  const json = JSON.parse(fx(`ripestat-routing-status-AS${asn}.json`)) as { data: Record<string, unknown> };
  return { ...json, data: { ...json.data, query_time: queryTime } };
};
const NOW = Date.parse('2026-10-04T16:47:54+02:00');
const H = 3_600_000;
const UA = 'FranceMonitor/1.0 (+https://www.francemonitor.com)';

/** RIPEstat par ressource (instantané `queryTime`), PeeringDB réel ; `override` remplace une réponse. */
function sources(queryTime = '2026-10-04T08:00:00', override: (url: string) => FakeResponse | null = () => null) {
  return stubFetch((url) => {
    const o = override(url);
    if (o) return o;
    const m = /resource=AS(\d+)&sourceapp=francemonitor$/.exec(url);
    if (m) return respond(ripe(Number(m[1]), queryTime) as object);
    if (url === PEERINGDB_IX_URL) return respond(fx('peeringdb-ix-fr.json'));
    return respond('introuvable', 404);
  });
}

beforeEach(() => {
  __resetSwrCacheForTests();
  __resetKvForTests();
  __resetRipeForTests();
  __setKvClientForTests({ get: async () => null, set: async () => undefined });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { __setKvClientForTests(null); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('RIPEstat routing-status', () => {
  it('adresse identifiée (sourceapp) ; six grands réseaux dans l’ordre du contrat', () => {
    expect(routingStatusUrl(3215)).toBe('https://stat.ripe.net/data/routing-status/data.json?resource=AS3215&sourceapp=francemonitor');
    expect(MAJOR_NETWORKS.map((n) => `${n.asn}:${n.name}`)).toEqual(['3215:Orange', '15557:SFR', '5410:Bouygues Telecom', '12322:Free', '2200:RENATER', '16276:OVHcloud']);
  });
  it('Free le 04/10 : 323 routeurs sur 325 en IPv4, 314 sur 314 en IPv6, 99,38 %, instantané de 08:00 UTC', () => {
    expect(parseRoutingStatus(ripe(12322), 12322, 'Free')).toEqual({
      asn: 12322, name: 'Free', v4Seeing: 323, v4Total: 325, v6Seeing: 314, v6Total: 314, v4Prefixes: 538, v6Prefixes: 527, visibilityPct: 99.38,
      queryTime: '2026-10-04T08:00:00.000Z',
    });
    expect(parseRoutingStatus(ripe(2200), 2200, 'RENATER').visibilityPct).toBe(99.69);
  });
  it('réponse illisible, autre réseau, visibilité ou instantané absents : erreur, jamais 0', () => {
    const free = ripe(12322) as { data: Record<string, unknown> };
    expect(() => parseRoutingStatus({ status: 'error' }, 12322, 'Free')).toThrow('réponse illisible');
    expect(() => parseRoutingStatus(free, 3215, 'Orange')).toThrow('ressource inattendue (12322)');
    expect(() => parseRoutingStatus({ ...free, data: { ...free.data, visibility: {} } }, 12322, 'Free')).toThrow('visibilité non publiée');
    expect(() => parseRoutingStatus({ ...free, data: { ...free.data, query_time: null } }, 12322, 'Free')).toThrow('instantané non daté');
    const zero = { ...free, data: { ...free.data, visibility: { v4: { ris_peers_seeing: 0, total_ris_peers: 0 }, v6: { ris_peers_seeing: 0, total_ris_peers: 0 } } } };
    expect(() => parseRoutingStatus(zero, 12322, 'Free')).toThrow('visibilité non publiée');
    const over = { ...free, data: { ...free.data, visibility: { v4: { ris_peers_seeing: 326, total_ris_peers: 325 }, v6: { ris_peers_seeing: 314, total_ris_peers: 314 } } } };
    expect(() => parseRoutingStatus(over, 12322, 'Free')).toThrow('visibilité non publiée');
  });
});

describe('relève RIPEstat', () => {
  it('six réseaux lus, en-tête FranceMonitor ; un échantillon de visibilité minimale (Free, 99,38 %)', async () => {
    const log = sources();
    const r = await ensureRipeFresh(NOW);
    expect([r.readAt, r.snapshotAt, r.errors]).toEqual(['2026-10-04T14:47:54.000Z', '2026-10-04T08:00:00.000Z', []]);
    expect(r.networks.map((n) => `${n.name} ${n.v4Seeing}/${n.v4Total} ${n.v6Seeing}/${n.v6Total} ${n.visibilityPct}`)).toEqual([
      'Orange 325/325 314/314 100', 'SFR 325/325 314/314 100', 'Bouygues Telecom 325/325 314/314 100', 'Free 323/325 314/314 99.38',
      'RENATER 324/325 314/314 99.69', 'OVHcloud 325/325 314/314 100',
    ]);
    expect(r.networks[0]).not.toHaveProperty('queryTime');
    expect(log.urls).toHaveLength(6);
    for (const init of log.inits) expect(sentHeader(init, 'User-Agent')).toBe(UA);
    expect(await readSeries(RIPE_SAMPLES_KEY, { maxAgeMs: RIPE_SAMPLES_MAX_AGE_MS, now: NOW })).toEqual([{ at: '2026-10-04T08:00:00.000Z', minPct: 99.38 }]);
  });
  it('moins d’une heure après : aucune lecture ; une heure après, même instantané : six lectures, toujours un seul échantillon', async () => {
    sources();
    await ensureRipeFresh(NOW);
    const quiet = sources();
    await ensureRipeFresh(NOW + 30 * 60_000);
    expect(quiet.urls).toHaveLength(0);
    const again = sources();
    await ensureRipeFresh(NOW + H);
    expect(again.urls).toHaveLength(6);
    expect(await readSeries(RIPE_SAMPLES_KEY, { maxAgeMs: RIPE_SAMPLES_MAX_AGE_MS, now: NOW + H })).toHaveLength(1);
  });
  it('instantané de 16:00 incomplet (SFR en panne) : cinq réseaux, panne nommée, aucun échantillon ; complet ensuite : deuxième échantillon', async () => {
    sources();
    await ensureRipeFresh(NOW);
    sources('2026-10-04T16:00:00', (url) => (url.includes('resource=AS15557&') ? respond('indisponible', 503) : null));
    const partial = await ensureRipeFresh(NOW + 2 * H);
    expect([partial.networks.length, partial.snapshotAt, partial.errors]).toEqual([5, '2026-10-04T16:00:00.000Z', ['RIPEstat, AS15557 : HTTP 503']]);
    expect(await readSeries(RIPE_SAMPLES_KEY, { maxAgeMs: RIPE_SAMPLES_MAX_AGE_MS, now: NOW + 2 * H })).toHaveLength(1);
    sources('2026-10-04T16:00:00');
    await ensureRipeFresh(NOW + 3 * H);
    expect((await readSeries(RIPE_SAMPLES_KEY, { maxAgeMs: RIPE_SAMPLES_MAX_AGE_MS, now: NOW + 3 * H })).map((s) => s.at))
      .toEqual(['2026-10-04T08:00:00.000Z', '2026-10-04T16:00:00.000Z']);
  });
  it('délai de 60 s (constante unique) ; Orange hors délai deux fois : relu une fois en fin de relève, panne nommée, aucun échantillon', async () => {
    expect(RIPE_TIMEOUT_MS).toBe(60_000);
    const log = sources('2026-10-04T08:00:00', (url) => {
      if (url.includes('resource=AS3215&')) throw new DOMException('signal timed out', 'TimeoutError');
      return null;
    });
    const r = await ensureRipeFresh(NOW);
    expect(r.networks.map((n) => n.name)).toEqual(['SFR', 'Bouygues Telecom', 'Free', 'RENATER', 'OVHcloud']);
    expect(r.errors).toEqual(['RIPEstat, AS3215 : délai dépassé (60000 ms)']);
    expect(log.urls.filter((u) => u.includes('resource=AS3215&'))).toHaveLength(2);
    expect(log.urls.at(-1)).toBe(routingStatusUrl(3215));
    expect(await readSeries(RIPE_SAMPLES_KEY, { maxAgeMs: RIPE_SAMPLES_MAX_AGE_MS, now: NOW })).toEqual([]);
  });
  it('Orange hors délai à la première lecture, lu à la seconde : six réseaux, aucune panne, un échantillon', async () => {
    let orangeCalls = 0;
    const log = sources('2026-10-04T08:00:00', (url) => {
      if (url.includes('resource=AS3215&') && orangeCalls++ === 0) throw new DOMException('signal timed out', 'TimeoutError');
      return null;
    });
    const r = await ensureRipeFresh(NOW);
    expect([r.networks.length, r.errors]).toEqual([6, []]);
    expect(log.urls).toHaveLength(7);
    expect(log.urls.at(-1)).toBe(routingStatusUrl(3215));
    expect(await readSeries(RIPE_SAMPLES_KEY, { maxAgeMs: RIPE_SAMPLES_MAX_AGE_MS, now: NOW })).toEqual([{ at: '2026-10-04T08:00:00.000Z', minPct: 99.38 }]);
  });
  it('limite de débit (HTTP 429) : jamais de seconde tentative', async () => {
    const log = sources('2026-10-04T08:00:00', (url) => (url.includes('resource=AS15557&') ? respond('trop de requêtes', 429) : null));
    const r = await ensureRipeFresh(NOW);
    expect(r.errors).toEqual(['RIPEstat, AS15557 : HTTP 429']);
    expect(log.urls).toHaveLength(6);
  });
  it('aucun réseau lu : dernier relevé servi avec sa date, six pannes nommées', async () => {
    sources();
    await ensureRipeFresh(NOW);
    sources('2026-10-04T08:00:00', (url) => (url.includes('stat.ripe.net') ? respond('indisponible', 503) : null));
    const r = await ensureRipeFresh(NOW + H);
    expect([r.readAt, r.snapshotAt, r.networks.length, r.errors.length]).toEqual(['2026-10-04T14:47:54.000Z', '2026-10-04T08:00:00.000Z', 6, 6]);
  });
});

describe('PeeringDB', () => {
  it('27 points d’échange en France, triés par nom, lien vers la fiche, date de mise à jour publiée', () => {
    const items = parseIx(JSON.parse(fx('peeringdb-ix-fr.json')));
    expect(items).toHaveLength(27);
    expect(items.slice(0, 4).map((x) => x.name)).toEqual(['1-FR FREE', 'Association HwHost', 'AuvernIX', 'BéarnIX']);
    expect(items.find((x) => x.id === 34)).toEqual({ id: 34, name: 'SFINX', city: 'Paris', updated: '2021-07-23T12:16:46Z', url: 'https://www.peeringdb.com/ix/34' });
    expect(items.every((x) => x.updated !== null)).toBe(true);
    expect(() => parseIx({ meta: {} })).toThrow('réponse illisible (liste « data » absente)');
  });
});

describe('route GET /api/sovereignty/connectivity', () => {
  it('réseaux, série de 30 jours, points d’échange ; 200 et cache de 30 min', async () => {
    sources();
    const { status, body, cache } = await callHandler<ConnectivityResponse>(handler);
    expect([status, cache, body.snapshotAt, body.networks.length, body.errors]).toEqual([200, CACHE_CONTROL, '2026-10-04T08:00:00.000Z', 6, []]);
    expect([body.history.samples, body.history.since]).toEqual([[{ at: '2026-10-04T08:00:00.000Z', minPct: 99.38 }], '2026-10-04T08:00:00.000Z']);
    expect([body.exchanges?.items.length, body.exchanges?.readAt]).toEqual([27, '2026-10-04T14:47:54.000Z']);
    expect(body.unread).toEqual([]);
    expect(body.history.prefixSamples).toEqual([{ at: '2026-10-04T08:00:00.000Z', prefixes: { 3215: 968, 15557: 159, 5410: 22, 12322: 1065, 2200: 79, 16276: 752 } }]);
  });
  it('un réseau non lu (SFR en panne) : jamais omis, nommé avec sa panne, jamais compté à 0 ; tous les pourcentages finis', async () => {
    sources('2026-10-04T08:00:00', (url) => (url.includes('resource=AS15557&') ? respond('indisponible', 503) : null));
    const { body } = await callHandler<ConnectivityResponse>(handler);
    expect(body.networks.map((n) => n.asn)).toEqual([3215, 5410, 12322, 2200, 16276]);
    expect(body.unread).toEqual([{ asn: 15557, name: 'SFR', error: 'RIPEstat, AS15557 : HTTP 503' }]);
    expect(body.networks.every((n) => Number.isFinite(n.visibilityPct))).toBe(true);
    expect(body.history.samples).toEqual([]);
  });
  it('RIPEstat jamais lu : les six réseaux non lus, nommés', async () => {
    sources('2026-10-04T08:00:00', (url) => (url.includes('stat.ripe.net') ? respond('indisponible', 503) : null));
    const { body } = await callHandler<ConnectivityResponse>(handler);
    expect([body.networks.length, body.unread?.length, body.unread?.every((u) => u.error !== null)]).toEqual([0, 6, true]);
  });
  it('RIPEstat en panne, PeeringDB lu : 200 partiel, réseaux vides et nommés ; tout en panne : 502 non mis en cache, même forme', async () => {
    sources('2026-10-04T08:00:00', (url) => (url.includes('stat.ripe.net') ? respond('indisponible', 503) : null));
    const partial = await callHandler<ConnectivityResponse>(handler);
    expect([partial.status, partial.body.snapshotAt, partial.body.networks, partial.body.exchanges?.items.length]).toEqual([200, null, [], 27]);
    expect(partial.body.errors).toContain('RIPEstat, AS3215 : HTTP 503');
    __resetSwrCacheForTests();
    __resetKvForTests();
    __resetRipeForTests();
    sources('2026-10-04T08:00:00', () => respond('indisponible', 503));
    const down = await callHandler<ConnectivityResponse>(handler);
    expect([down.status, down.cache, down.body.snapshotAt, down.body.exchanges]).toEqual([502, 'no-store', null, null]);
    expect(down.body.errors).toContain('PeeringDB : HTTP 503');
  });
  it('PeeringDB en panne, RIPEstat lu : 200 partiel, six réseaux, annuaire nul et panne nommée', async () => {
    sources('2026-10-04T08:00:00', (url) => (url === PEERINGDB_IX_URL ? respond('indisponible', 503) : null));
    const { status, body } = await callHandler<ConnectivityResponse>(handler);
    expect([status, body.networks.length, body.exchanges, body.errors]).toEqual([200, 6, null, ['PeeringDB : HTTP 503']]);
  });
  it('échéance de la route : relevé gardé servi avec la note, cache de 60 s, réseaux non lus sans panne, PeeringDB en retard nommé', async () => {
    sources();
    await ensureRipeFresh(NOW - 2 * H);
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    __resetSwrCacheForTests();
    const b = await loadConnectivity(NOW, { budgetMs: 20 });
    expect(b.errors).toEqual([RIPE_PENDING_NOTE, 'PeeringDB : délai dépassé (échéance de la route)']);
    expect([b.networks.length, b.unread]).toEqual([6, []]);
    expect(PENDING_CACHE_CONTROL).toBe('s-maxage=60, stale-while-revalidate=120');
  });
  it('première lecture sans relevé gardé, RIPEstat et PeeringDB trop lents : 502 no-store, six non lus sans panne, causes nommées dans errors', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    const b = await loadConnectivity(NOW, { budgetMs: 20 });
    expect([b.networks.length, b.unread?.length, b.unread?.every((u) => u.error === null), b.snapshotAt, b.exchanges]).toEqual([0, 6, true, null, null]);
    expect(b.errors).toEqual([RIPE_PENDING_NOTE, 'PeeringDB : délai dépassé (échéance de la route)']);
  });
  it('aucun fetch direct dans les modules du lot', () => {
    for (const file of ['ripestat.js', 'peeringdb.js']) {
      expect(readFileSync(new URL(`../api/_lib/${file}`, import.meta.url), 'utf8')).not.toMatch(/\bfetch\(/);
    }
  });
});
