import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import assert from 'node:assert/strict';

import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
// @ts-expect-error — module JS sans déclaration de types
import ecowattSignalHandler, { __resetEcowattSignalForTests } from '../api/_handlers/energy/ecowatt-signal.js';
// @ts-expect-error — module JS sans déclaration de types
import { normalizeRteSignals, repairMojibake } from '../api/_lib/ecowatt-official.js';
import { isEcowattOfficial } from '../src/services/ecowatt-official.ts';

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

const TOKEN_URL = 'https://digital.iservices.rte-france.com/token/oauth/token';
const SIGNALS_URL = 'https://digital.iservices.rte-france.com/open_api/ecowatt/v5/signals';
const ODRE_MARKER = 'nouveau_signal_ecowatt';

function hoursAllValue(hv: 0 | 1 | 2 | 3) {
  return Array.from({ length: 24 }, (_, pas) => ({ pas, hvalue: hv }));
}

function odreDay(date: string, couleur: 1 | 2 | 3, message: string) {
  const hours = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`h${i}`, 1]));
  return { date, couleur_du_jour: couleur, message, ...hours };
}

const ORIGINAL_CLIENT_ID = process.env.RTE_CLIENT_ID;
const ORIGINAL_CLIENT_SECRET = process.env.RTE_CLIENT_SECRET;

beforeEach(() => {
  __resetSwrCacheForTests();
  __resetEcowattSignalForTests();
  process.env.RTE_CLIENT_ID = 'test-client-id';
  process.env.RTE_CLIENT_SECRET = 'test-client-secret';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (ORIGINAL_CLIENT_ID === undefined) delete process.env.RTE_CLIENT_ID;
  else process.env.RTE_CLIENT_ID = ORIGINAL_CLIENT_ID;
  if (ORIGINAL_CLIENT_SECRET === undefined) delete process.env.RTE_CLIENT_SECRET;
  else process.env.RTE_CLIENT_SECRET = ORIGINAL_CLIENT_SECRET;
});

describe('normalizeRteSignals — normalisation pure de la réponse RTE Écowatt v5', () => {
  it('dvalue → niveau, hvalue 0 conservé, jours et pas triés, jour invalide écarté, generatedAt = max', () => {
    const shuffledGreenValues = [...hoursAllValue(1)].reverse(); // pas décroissant : vérifie le tri
    const raw = {
      signals: [
        { GenerationFichier: '2026-09-24T23:00:00+02:00', jour: '2026-09-26T00:00:00+02:00', dvalue: 2, message: 'Tendu.', values: hoursAllValue(2) },
        { GenerationFichier: '2026-09-25T05:00:00+02:00', jour: '2026-09-25T00:00:00+02:00', dvalue: 1, message: 'Pas d’alerte.', values: shuffledGreenValues },
        { GenerationFichier: '2026-09-24T23:00:00+02:00', jour: '2026-09-27T00:00:00+02:00', dvalue: 9, message: 'dvalue hors bornes', values: hoursAllValue(1) },
        { GenerationFichier: '2026-09-24T23:00:00+02:00', jour: 'pas-une-date', dvalue: 1, message: 'date illisible', values: hoursAllValue(1) },
        { GenerationFichier: '2026-09-24T23:00:00+02:00', jour: '2026-09-29T00:00:00+02:00', dvalue: 1, message: 'pas manquants', values: hoursAllValue(1).slice(0, 23) },
      ],
    };

    const official = normalizeRteSignals(raw);

    expect(official.source).toBe('rte');
    // La plus récente des GenerationFichier, même si son propre jour est valide ou non.
    expect(official.generatedAt).toBe('2026-09-25T05:00:00+02:00');
    // Seuls les deux jours valides sont conservés, triés par date croissante.
    expect(official.days.map((d: { date: string }) => d.date)).toEqual(['2026-09-25', '2026-09-26']);

    const [day25, day26] = official.days;
    expect(day25.level).toBe('green');
    expect(day26.level).toBe('orange');
    // Les pas ont bien été retriés malgré l'entrée mélangée (pas 0 → 23, pas 23 → 0…).
    expect(day25.hours).toEqual(hoursAllValue(1).map((v) => v.hvalue));
    expect(day25.hours).toHaveLength(24);
  });

  it('conserve hvalue 0 (vert avec production décarbonée, API v5)', () => {
    const values = Array.from({ length: 24 }, (_, pas) => ({ pas, hvalue: pas === 3 ? 0 : 1 }));
    const raw = { signals: [{ GenerationFichier: '2026-09-25T05:00:00+02:00', jour: '2026-09-25T00:00:00+02:00', dvalue: 1, message: 'ok', values }] };

    const official = normalizeRteSignals(raw);

    expect(official.days[0].hours[3]).toBe(0);
    expect(official.days[0].hours[0]).toBe(1);
  });
});

describe('repairMojibake — réparation du double encodage UTF-8 lu en Windows-1252', () => {
  it('répare les séquences connues sans abîmer un texte déjà correct', () => {
    expect(repairMojibake('Pas dâ€™alerte.')).toBe('Pas d’alerte.');
    // Déjà propre : ne contient aucune des séquences corrompues → inchangé.
    expect(repairMojibake('Pas d’alerte.')).toBe('Pas d’alerte.');
    expect(repairMojibake('')).toBe('');
  });
});

describe('handler GET /api/energy/ecowatt-signal', () => {
  it('200 { official: { source: "rte", … }, rteStatus: "ok" } satisfaisant isEcowattOfficial', async () => {
    const rtePayload = {
      signals: [
        { GenerationFichier: '2026-09-25T05:00:00+02:00', jour: '2026-09-25T00:00:00+02:00', dvalue: 1, message: 'Pas d’alerte.', values: hoursAllValue(1) },
        { GenerationFichier: '2026-09-25T05:00:00+02:00', jour: '2026-09-26T00:00:00+02:00', dvalue: 1, message: 'Pas d’alerte.', values: hoursAllValue(1) },
        { GenerationFichier: '2026-09-25T05:00:00+02:00', jour: '2026-09-27T00:00:00+02:00', dvalue: 1, message: 'Pas d’alerte.', values: hoursAllValue(1) },
        { GenerationFichier: '2026-09-25T05:00:00+02:00', jour: '2026-09-28T00:00:00+02:00', dvalue: 1, message: 'Pas d’alerte.', values: hoursAllValue(1) },
      ],
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes(TOKEN_URL)) return { ok: true, status: 200, json: async () => ({ access_token: 'tok-1', expires_in: 3600 }) };
      if (url.includes(SIGNALS_URL)) return { ok: true, status: 200, json: async () => rtePayload };
      throw new Error(`URL inattendue en test : ${url}`);
    }));

    const { req, res } = mockReqRes();
    await ecowattSignalHandler(req, res);

    assert.equal(res.statusCode, 200);
    const body = res.body as { official: unknown; rteStatus: string };
    assert.equal(body.rteStatus, 'ok');
    assert.ok(isEcowattOfficial(body.official), 'la réponse doit satisfaire le contrat client isEcowattOfficial');
    assert.equal((body.official as { source: string }).source, 'rte');
    assert.equal(res.headers['cache-control'], 'public, s-maxage=300, stale-while-revalidate=900');
    assert.equal(res.headers['x-cache'], 'miss');
  });

  it('un deuxième appel est servi par le cache SWR (RTE non rappelé)', async () => {
    const rtePayload = { signals: [{ GenerationFichier: '2026-09-25T05:00:00+02:00', jour: '2026-09-25T00:00:00+02:00', dvalue: 1, message: 'Pas d’alerte.', values: hoursAllValue(1) }] };
    let signalsCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes(TOKEN_URL)) return { ok: true, status: 200, json: async () => ({ access_token: 'tok-2', expires_in: 3600 }) };
      if (url.includes(SIGNALS_URL)) { signalsCalls += 1; return { ok: true, status: 200, json: async () => rtePayload }; }
      throw new Error(`URL inattendue en test : ${url}`);
    }));

    const first = mockReqRes();
    await ecowattSignalHandler(first.req, first.res);
    assert.equal(first.res.statusCode, 200);
    assert.equal(signalsCalls, 1);

    const second = mockReqRes();
    await ecowattSignalHandler(second.req, second.res);
    assert.equal(signalsCalls, 1, 'le second appel doit être servi depuis le cache, sans nouvel appel RTE');
    assert.equal(second.res.headers['x-cache'], 'hit');
    assert.equal((second.res.body as { rteStatus: string }).rteStatus, 'ok');
  });

  it('RTE 403 (app pas encore abonnée) → repli ODRÉ, message réparé, rteStatus "unavailable"', async () => {
    const odrePayload = { results: [odreDay('2026-09-24', 1, 'Pas dâ€™alerte.')] };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes(TOKEN_URL)) return { ok: true, status: 200, json: async () => ({ access_token: 'tok-3', expires_in: 3600 }) };
      if (url.includes(SIGNALS_URL)) return { ok: false, status: 403, text: async () => 'Forbidden' };
      if (url.includes(ODRE_MARKER)) return { ok: true, status: 200, json: async () => odrePayload };
      throw new Error(`URL inattendue en test : ${url}`);
    }));

    const { req, res } = mockReqRes();
    await ecowattSignalHandler(req, res);

    assert.equal(res.statusCode, 200);
    const body = res.body as { official: { source: string; generatedAt: string | null; days: { message: string }[] }; rteStatus: string };
    assert.equal(body.rteStatus, 'unavailable');
    assert.equal(body.official.source, 'odre');
    assert.equal(body.official.generatedAt, null);
    assert.equal(body.official.days[0].message, 'Pas d’alerte.');
  });

  it('après un refus RTE, pause de 15 min : pas de nouvel appel RTE entre-temps (quota, pas de martèlement)', async () => {
    const odrePayload = { results: [odreDay('2026-09-24', 1, 'Pas d’alerte.')] };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(TOKEN_URL)) return { ok: true, status: 200, json: async () => ({ access_token: 'tok-5', expires_in: 3600 }) };
      if (url.includes(SIGNALS_URL)) return { ok: false, status: 403, text: async () => 'Forbidden' };
      if (url.includes(ODRE_MARKER)) return { ok: true, status: 200, json: async () => odrePayload };
      throw new Error(`URL inattendue en test : ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await ecowattSignalHandler(mockReqRes().req, mockReqRes().res);
    __resetSwrCacheForTests();
    const second = mockReqRes();
    await ecowattSignalHandler(second.req, second.res);

    const rteCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes(SIGNALS_URL)).length;
    assert.equal(rteCalls, 1, 'RTE ne doit pas être rappelé pendant la pause');
    assert.equal(second.res.statusCode, 200);
    assert.equal((second.res.body as { official: { source: string } }).official.source, 'odre');
  });

  it('identifiants RTE absents → repli ODRÉ directement, sans appel RTE', async () => {
    delete process.env.RTE_CLIENT_ID;
    delete process.env.RTE_CLIENT_SECRET;
    const odrePayload = { results: [odreDay('2026-09-24', 1, 'Pas d’alerte.')] };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('digital.iservices.rte-france.com')) throw new Error('RTE ne doit pas être appelé sans identifiants');
      if (url.includes(ODRE_MARKER)) return { ok: true, status: 200, json: async () => odrePayload };
      throw new Error(`URL inattendue en test : ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { req, res } = mockReqRes();
    await ecowattSignalHandler(req, res);

    assert.equal(res.statusCode, 200);
    const body = res.body as { official: { source: string }; rteStatus: string };
    assert.equal(body.rteStatus, 'unavailable');
    assert.equal(body.official.source, 'odre');
    for (const call of fetchMock.mock.calls) {
      assert.ok(!String(call[0]).includes('digital.iservices.rte-france.com'), 'RTE ne doit jamais être appelé sans identifiants');
    }
  });

  it('RTE et ODRÉ en échec tous les deux → 503, Cache-Control no-store', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes(TOKEN_URL)) return { ok: true, status: 200, json: async () => ({ access_token: 'tok-4', expires_in: 3600 }) };
      if (url.includes(SIGNALS_URL)) return { ok: false, status: 500, text: async () => '' };
      if (url.includes(ODRE_MARKER)) return { ok: false, status: 503, text: async () => '' };
      throw new Error(`URL inattendue en test : ${url}`);
    }));

    const { req, res } = mockReqRes();
    await ecowattSignalHandler(req, res);

    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { error: 'ecowatt unavailable' });
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  it('POST → 405', async () => {
    const { req, res } = mockReqRes({}, 'POST');
    await ecowattSignalHandler(req, res);
    assert.equal(res.statusCode, 405);
  });
});
