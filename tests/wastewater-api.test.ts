import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import handler, { buildWastewater } from '../api/_handlers/health/wastewater.js';
import { type FakeResponse, fakeRes, fixtureJson, fixtureText, maxLimitSent, respond, stubFetch } from './helpers/health-fixtures.ts';

type Point = { week: string; start: string; national54: number | null; national12: number | null };
type Body = { points: Point[]; lastYear: Point | null; stationsReporting: number | null; stationsTotal: number; publishedAt: string | null; errors: string[] };

function stubSumeau(override: (url: string) => FakeResponse | null = () => null) {
  return stubFetch((url) => {
    const forced = override(url);
    if (forced) return forced;
    const u = new URL(url);
    if (u.pathname.endsWith('/sum-eau-indicateurs')) return respond(fixtureText('sumeau-meta.json'));
    return respond(fixtureText(u.searchParams.get('limit') === '1' ? 'sumeau-last.json' : 'sumeau-series.json'));
  });
}

async function call(): Promise<{ status: number; body: Body; cache: string }> {
  const res = fakeRes();
  await handler({ method: 'GET' }, res);
  return { status: res.statusCode, body: res.body as Body, cache: res.headers['Cache-Control'] };
}

beforeEach(() => { __resetSwrCacheForTests(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('SUM’eau (livraison du 30/09/2026)', () => {
  it('26 semaines chronologiques, de S13 à S38 ; même semaine un an plus tôt ; stations', async () => {
    const { urls } = stubSumeau();
    const { status, body, cache } = await call();
    expect(status).toBe(200);
    expect(cache).toBe('s-maxage=21600, stale-while-revalidate=86400');
    expect(body.errors).toEqual([]);
    expect(body.points).toHaveLength(26);
    expect(body.points[0]).toEqual({ week: '2026-S13', start: '2026-03-23', national54: 600.1, national12: 699 });
    expect(body.points.at(-1)).toEqual({ week: '2026-S38', start: '2026-09-14', national54: 1838.9, national12: 2820.7 });
    expect(body.points.at(-3)?.national54).toBe(928.7);
    expect(body.lastYear).toEqual({ week: '2025-S38', start: '2025-09-15', national54: 3072.8, national12: 3678 });
    expect([body.stationsReporting, body.stationsTotal]).toEqual([48, 55]);
    expect(body.publishedAt).toBe('2026-09-30T10:30:04+00:00');
    expect(maxLimitSent(urls)).toBe(60);
  });
  it('dernière ligne indisponible : stations nd, série gardée, erreur nommée', async () => {
    stubSumeau((url) => (new URL(url).searchParams.get('limit') === '1' ? respond('erreur', 500) : null));
    const { status, body } = await call();
    expect(status).toBe(200);
    expect([body.stationsReporting, body.stationsTotal]).toEqual([null, 0]);
    expect(body.errors).toEqual(['SUM’eau, stations : HTTP 500']);
  });
  it('série en HTTP 429 : 502 non mis en cache', async () => {
    stubSumeau((url) => (new URL(url).searchParams.get('limit') === '60' ? respond('Too Many Requests', 429) : null));
    const { status, body, cache } = await call();
    expect(status).toBe(502);
    expect(cache).toBe('no-store');
    expect(body.errors).toEqual(['SUM’eau, série nationale : HTTP 429']);
  });
  it('série vide : erreur « aucune ligne », pas une courbe vide silencieuse', async () => {
    stubSumeau((url) => (new URL(url).searchParams.get('limit') === '60' ? respond({ total_count: 0, results: [] }) : null));
    expect((await call()).body.errors).toEqual(['SUM’eau, série nationale : aucune ligne']);
  });
  it('fonction pure : semaine sans valeur gardée nulle (jamais 0)', () => {
    const rows = fixtureJson<{ results: Array<Record<string, unknown>> }>('sumeau-series.json').results;
    const r = buildWastewater([{ ...rows[0], national_54: null }, ...rows.slice(1)], null);
    expect(r.points.at(-1)?.national54).toBeNull();
  });
});
