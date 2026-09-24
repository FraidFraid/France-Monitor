import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';

import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
// @ts-expect-error — module JS sans déclaration de types
import gasPirHandler from '../api/_handlers/energy/gas-pir.js';
// @ts-expect-error — module JS sans déclaration de types
import osmRailwaysHandler from '../api/_handlers/transport/osm-railways.js';
// @ts-expect-error — module JS sans déclaration de types
import disruptionsHandler from '../api/_handlers/transport/disruptions.js';
// @ts-expect-error — module JS sans déclaration de types
import eolienHandler from '../api/_handlers/energy/eolien.js';

type Headers = Record<string, string>;

function mockReqRes(query: Record<string, string> = {}, method = 'GET') {
  const headers: Headers = {};
  let statusCode = 200;
  let body: unknown;
  const res = {
    setHeader(k: string, v: string) { headers[k.toLowerCase()] = v; },
    getHeader(k: string) { return headers[k.toLowerCase()]; },
    status(code: number) { statusCode = code; return res; },
    json(payload: unknown) { body = payload; return res; },
    end() { return res; },
    get statusCode() { return statusCode; },
    get body() { return body; },
    headers,
  };
  const req = { method, query };
  return { req, res };
}

beforeEach(() => {
  __resetSwrCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('api/_handlers/energy/gas-pir · cache swr', () => {
  function entsogPayload(points: Array<{ pointKey: string; value: number }>) {
    return {
      operationaldata: points.map((p) => ({
        pointKey: p.pointKey,
        pointLabel: p.pointKey,
        directionKey: 'entry',
        periodFrom: '2026-09-20',
        value: String(p.value),
      })),
    };
  }

  it('sert le cache mémoire au second appel sans re-solliciter ENTSOG', async () => {
    let fetchCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      fetchCalls += 1;
      const isTeréga = url.includes('FR-TSO-0002');
      return {
        ok: true,
        json: async () => entsogPayload(isTeréga
          ? [{ pointKey: 'ITP-00304', value: 1_000_000 }]
          : [
            { pointKey: 'ITP-00137', value: 2_000_000 },
            { pointKey: 'ITP-00115', value: 3_000_000 },
            { pointKey: 'ITP-00039', value: 4_000_000 },
          ]),
      };
    }));

    const first = mockReqRes();
    await gasPirHandler(first.req, first.res);
    assert.equal(first.res.statusCode, 200);
    const firstBody = first.res.body as { status: string; points: unknown[] };
    assert.equal(firstBody.status, 'ok');
    assert.equal(firstBody.points.length, 4);
    assert.equal(first.res.headers['x-cache'], 'miss');
    assert.equal(fetchCalls, 2, 'une requête ENTSOG par TSO');

    const second = mockReqRes();
    await gasPirHandler(second.req, second.res);
    assert.equal(second.res.headers['x-cache'], 'hit');
    assert.equal(fetchCalls, 2, 'le second appel doit être servi depuis le cache, sans nouvel appel ENTSOG');
  });

  it('renvoie 200 avec status "error" (jamais 502) si ENTSOG échoue et qu\'aucun cache n\'existe', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));

    const { req, res } = mockReqRes();
    await gasPirHandler(req, res);

    assert.equal(res.statusCode, 200, 'contrat existant : toujours 200, même en erreur');
    const body = res.body as { status: string; points: unknown[]; error: string };
    assert.equal(body.status, 'error');
    assert.deepEqual(body.points, []);
    assert.match(body.error, /HTTP 503/);
  });
});

describe('api/_handlers/transport/osm-railways · cache swr par bbox', () => {
  it('valide le bbox et renvoie 400 si absent/invalide', async () => {
    const { req, res } = mockReqRes({ bbox: 'not-a-bbox' });
    await osmRailwaysHandler(req, res);
    assert.equal(res.statusCode, 400);
  });

  it('met en cache par bbox et ne réinterroge pas Overpass pour la même zone', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({
          elements: [
            {
              type: 'way',
              id: 1,
              geometry: [{ lat: 48.8, lon: 2.3 }, { lat: 48.9, lon: 2.4 }],
              tags: { railway: 'rail', name: 'Test' },
            },
          ],
        }),
      };
    }));

    const bbox = { bbox: '48.0,2.0,49.0,3.0' };
    const first = mockReqRes(bbox);
    await osmRailwaysHandler(first.req, first.res);
    assert.equal(first.res.statusCode, 200);
    assert.equal(calls, 1);
    assert.equal(first.res.headers['x-cache'], 'miss');
    const geojson = first.res.body as { features: unknown[] };
    assert.equal(geojson.features.length, 1);

    const second = mockReqRes(bbox);
    await osmRailwaysHandler(second.req, second.res);
    assert.equal(calls, 1, 'même bbox → pas de second appel Overpass');
    assert.equal(second.res.headers['x-cache'], 'hit');

    const otherBbox = mockReqRes({ bbox: '10.0,10.0,11.0,11.0' });
    await osmRailwaysHandler(otherBbox.req, otherBbox.res);
    assert.equal(calls, 2, 'un bbox différent doit déclencher un nouvel appel Overpass');
  });
});

describe('api/_handlers/transport/disruptions · cache swr par mode', () => {
  const originalKey = process.env.SNCF_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.SNCF_API_KEY;
    else process.env.SNCF_API_KEY = originalKey;
  });

  it('renvoie 500 sans re-servir le cache si SNCF_API_KEY est absent et rien n\'est en cache', async () => {
    delete process.env.SNCF_API_KEY;
    const { req, res } = mockReqRes({ mode: 'active' });
    await disruptionsHandler(req, res);
    assert.equal(res.statusCode, 500);
  });

  it('met en cache par mode (active vs all) indépendamment', async () => {
    process.env.SNCF_API_KEY = 'test-key';
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({ disruptions: [], pagination: { total_result: 0, items_on_page: 0 } }),
      };
    }));

    const active1 = mockReqRes({ mode: 'active' });
    await disruptionsHandler(active1.req, active1.res);
    assert.equal(active1.res.statusCode, 200);
    assert.equal(active1.res.headers['x-cache'], 'miss');
    const callsAfterActive = calls;
    assert.ok(callsAfterActive >= 1);

    const active2 = mockReqRes({ mode: 'active' });
    await disruptionsHandler(active2.req, active2.res);
    assert.equal(active2.res.headers['x-cache'], 'hit');
    assert.equal(calls, callsAfterActive, 'mode "active" déjà en cache : pas de nouvel appel SNCF');

    const all1 = mockReqRes({ mode: 'all' });
    await disruptionsHandler(all1.req, all1.res);
    assert.equal(all1.res.headers['x-cache'], 'miss');
    assert.ok(calls > callsAfterActive, 'mode "all" est une clé de cache distincte de "active"');
  });
});

describe('api/_handlers/energy/eolien · cache swr (mode live)', () => {
  it('sert le relevé ODRE depuis le cache au second appel', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({ results: [{ date_heure: '2026-09-23T10:00:00Z', eolien: 12_345 }] }),
      };
    }));

    const first = mockReqRes();
    await eolienHandler(first.req, first.res);
    assert.equal(first.res.statusCode, 200);
    assert.equal(first.res.headers['x-cache'], 'miss');
    assert.equal(calls, 1);
    const body = first.res.body as { production_gw: number };
    assert.equal(body.production_gw, 12.35);

    const second = mockReqRes();
    await eolienHandler(second.req, second.res);
    assert.equal(second.res.headers['x-cache'], 'hit');
    assert.equal(calls, 1, 'le second appel doit être servi depuis le cache');
  });
});
