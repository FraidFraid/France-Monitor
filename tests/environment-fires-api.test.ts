// Route /api/environment/fires (spec 2026-10-04 environnement § 2.4) : collecte FIRMS du serveur et météo des forêts, chacune
// datée par sa source ; réponses réelles du 03 et du 04/10/2026.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import { __resetForestDangerForTests, mdfUrl } from '../api/_lib/forest-danger.js';
import handler, { CACHE_CONTROL } from '../api/_handlers/environment/fires.js';
import type { FiresResponse } from '../src/types/index.ts';
import { type FakeResponse, callHandler, fakeRes, respond, stubFetch } from './helpers/traffic-fixtures.ts';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/environment/${name}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-04T10:10:00+02:00');
const FRANCE = fx('firms-france-extrait.csv');
const MODIS = fx('firms-modis-nrt-extrait.csv');

function viirs(sat: string): string {
  const [header, ...lines] = FRANCE.trim().split('\n');
  return `${[header, ...lines.filter((l) => l.split(',')[7] === sat)].join('\n')}\n`;
}

function binary(body: Buffer | string, status = 200): FakeResponse {
  const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  return { ...respond('', status), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) } as FakeResponse;
}

/** FIRMS (`firmsDown` : HTTP 400 partout) et météo des forêts (`mdfDown` : HTTP 503). */
function sources({ firmsDown = false, mdfDown = false } = {}): void {
  stubFetch((url) => {
    if (url === mdfUrl(2026)) return mdfDown ? binary('indisponible', 503) : binary(gzipSync(fx('meteo-des-forets-2026-extrait.csv')));
    if (firmsDown) return respond('Invalid MAP_KEY.', 400);
    if (/\/5\/\d{4}-\d{2}-\d{2}$/.test(url)) return respond(`${(url.includes('/MODIS_NRT/') ? MODIS : FRANCE).split('\n')[0]}\n`);
    if (url.endsWith('/VIIRS_SNPP_NRT/-6,41,10,52/2')) return respond(viirs('N'));
    if (url.endsWith('/VIIRS_NOAA20_NRT/-6,41,10,52/2')) return respond(viirs('N20'));
    if (url.endsWith('/VIIRS_NOAA21_NRT/-6,41,10,52/2')) return respond(viirs('N21'));
    if (url.endsWith('/MODIS_NRT/-6,41,10,52/2')) return respond(MODIS);
    return respond('introuvable', 404);
  });
}

beforeEach(() => {
  __resetSwrCacheForTests();
  __resetForestDangerForTests();
  __resetKvForTests();
  __setKvClientForTests({ get: async () => null, set: async () => {} });
  vi.stubEnv('NASA_FIRMS_API_KEY', 'CLE-SECRETE');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); __setKvClientForTests(null); __resetKvForTests(); });

describe('/api/environment/fires', () => {
  it('200, cache 5 min : détections et foyers de France, météo des forêts du 03/10 (J1 le 04/10)', async () => {
    sources();
    const { status, body, cache } = await callHandler<FiresResponse>(handler);
    expect([status, cache, body.errors]).toEqual([200, CACHE_CONTROL, []]);
    expect(CACHE_CONTROL).toBe('s-maxage=300, stale-while-revalidate=900');
    expect([body.readAt, body.lastAcquisitionAt, body.detections.length, body.foyers.length, body.abroadCount])
      .toEqual(['2026-10-04T08:10:00.000Z', '2026-10-04T03:00:00.000Z', 13, 4, 6]);
    expect(body.forestDanger).toMatchObject({ publishedAt: '2026-10-03T14:50:06Z', j1Date: '2026-10-04', j2Date: '2026-10-05', season: 'en-saison' });
    expect(body.forestDanger?.departments).toHaveLength(96);
    expect(body.forestDanger?.departments.filter((d) => d.j1 === 2)).toHaveLength(10);
  });
  it('météo des forêts en panne : 200 partiel, panne nommée ; cache CDN de 5 min gardé (déjà le plus court, jamais allongé)', async () => {
    sources({ mdfDown: true });
    const { status, body, cache } = await callHandler<FiresResponse>(handler);
    expect([status, cache, body.forestDanger, body.errors]).toEqual([200, CACHE_CONTROL, null, ['Météo des forêts : HTTP 503']]);
    expect(body.detections).toHaveLength(13);
  });
  it('FIRMS en panne, météo des forêts lue : 200, aucune collecte (readAt null), quatre pannes nommées', async () => {
    sources({ firmsDown: true });
    const { status, body } = await callHandler<FiresResponse>(handler);
    expect([status, body.readAt, body.detections]).toEqual([200, null, []]);
    expect(body.errors).toHaveLength(4);
    expect(body.forestDanger?.publishedAt).toBe('2026-10-03T14:50:06Z');
  });
  it('rien n’a répondu : 502 non mis en cache, corps de la même forme', async () => {
    sources({ firmsDown: true, mdfDown: true });
    const { status, body, cache } = await callHandler<FiresResponse>(handler);
    expect([status, cache, body.readAt, body.forestDanger]).toEqual([502, 'no-store', null, null]);
    expect(body.errors).toEqual([
      'FIRMS, Suomi NPP : HTTP 400', 'FIRMS, NOAA-20 : HTTP 400', 'FIRMS, NOAA-21 : HTTP 400', 'FIRMS, MODIS : HTTP 400', 'Météo des forêts : HTTP 503',
    ]);
  });
  it('plus rien ne répond après une collecte : 200 avec la dernière collecte datée, jamais mis en cache', async () => {
    sources();
    expect((await callHandler<FiresResponse>(handler)).cache).toBe(CACHE_CONTROL);
    sources({ firmsDown: true, mdfDown: true });
    __resetSwrCacheForTests();
    vi.setSystemTime(NOW + 16 * 60_000);
    const { status, body, cache } = await callHandler<FiresResponse>(handler);
    expect([status, cache, body.readAt, body.forestDanger, body.detections.length]).toEqual([200, 'no-store', '2026-10-04T08:10:00.000Z', null, 13]);
    expect(body.errors).toHaveLength(5);
  });
  it('OPTIONS : 204 ; POST : 405', async () => {
    const options = fakeRes();
    await handler({ method: 'OPTIONS', query: {} }, options);
    expect(options.statusCode).toBe(204);
    const post = fakeRes();
    await handler({ method: 'POST', query: {} }, post);
    expect(post.statusCode).toBe(405);
  });
});
