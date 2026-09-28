import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import agsiHandler from '../api/_handlers/gie/agsi.js';
// @ts-expect-error — module JS sans déclaration de types
import alsiHandler from '../api/_handlers/gie/alsi.js';

// Route GIE (stockage gaz AGSI/ALSI) : dead en prod avant l'audit de septembre 2026 — seul un
// plugin dev (supprimé le 28/09/2026) la servait.

type Headers = Record<string, string>;

function mockRes() {
  const headers: Headers = {};
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader(k: string, v: string) { headers[k.toLowerCase()] = v; },
    status(c: number) { res.statusCode = c; return res; },
    json(obj: unknown) { res.body = obj; return res; },
    end(b?: unknown) { res.body = b; return res; },
    headers,
  };
  return res;
}

const originalKey = process.env.GIE_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.GIE_API_KEY;
  else process.env.GIE_API_KEY = originalKey;
});

describe.each([
  { name: 'agsi', handler: agsiHandler },
  { name: 'alsi', handler: alsiHandler },
])('api/gie/$name', ({ handler }) => {
  it('503 JSON si GIE_API_KEY est absente, sans appeler l’amont', async () => {
    delete process.env.GIE_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const res = mockRes();
    await handler({ method: 'GET' }, res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'GIE_API_KEY non configurée' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('répond 204 sur OPTIONS sans appeler l’amont', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = mockRes();
    await handler({ method: 'OPTIONS' }, res);
    expect(res.statusCode).toBe(204);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('api/gie/agsi', () => {
  it('relaie la réponse amont et pose un cache CDN 1h quand la clé est présente', async () => {
    process.env.GIE_API_KEY = 'test-key';
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('agsi.gie.eu');
      expect((init?.headers as Record<string, string>)['x-key']).toBe('test-key');
      return new Response(JSON.stringify({ data: [{ name: 'France' }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const res = mockRes();
    await agsiHandler({ method: 'GET' }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, s-maxage=3600, stale-while-revalidate=1800');
    expect(JSON.parse(res.body as string)).toEqual({ data: [{ name: 'France' }] });
  });

  it('relaie une erreur amont sans cache CDN', async () => {
    process.env.GIE_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })));

    const res = mockRes();
    await agsiHandler({ method: 'GET' }, res);

    expect(res.statusCode).toBe(401);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('clé refusée (GIE répond 200 + error) → 502 sans cache, pas un succès mis en cache', async () => {
    process.env.GIE_API_KEY = 'mauvaise-cle';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      last_page: 0, total: 0, error: 'access denied', message: 'Invalid or missing API key', data: [],
    }), { status: 200 })));

    const res = mockRes();
    await agsiHandler({ method: 'GET' }, res);

    expect(res.statusCode).toBe(502);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ error: 'GIE AGSI : Invalid or missing API key' });
  });
});

describe('api/gie/alsi', () => {
  // Forme réelle d'une ligne par terminal (Montoir, relevée le 28/09/2026).
  function alsiRow(gasDayStart: string, sendOut: string) {
    return {
      name: 'Montoir de Bretagne LNG Terminal', gasDayStart, sendOut,
      inventory: { lng: '241.41', gwh: '1609.41' }, dtmi: { lng: '360', gwh: '2400.01' }, dtrs: '337', status: 'C',
    };
  }

  it('interroge chaque terminal par son code EIC et garde la dernière journée publiée', async () => {
    process.env.GIE_API_KEY = 'test-key';
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(url);
      expect((init?.headers as Record<string, string>)['x-key']).toBe('test-key');
      return new Response(JSON.stringify({ data: [alsiRow('2026-09-25', '300'), alsiRow('2026-09-26', '331.7')] }), { status: 200 });
    }));

    const res = mockRes();
    await alsiHandler({ method: 'GET' }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, s-maxage=3600, stale-while-revalidate=1800');
    expect(urls).toHaveLength(4);
    for (const eic of ['63W179356656691A', '63W943693783886F', '63W631527814486R', '21W0000000000451']) {
      expect(urls.some((u) => u.startsWith('https://alsi.gie.eu/api?') && u.includes(`facility=${eic}`))).toBe(true);
    }
    const body = res.body as { terminals: Array<Record<string, unknown>>; errors: unknown[] };
    expect(body.errors).toEqual([]);
    expect(body.terminals).toHaveLength(4);
    expect(body.terminals[2]).toEqual({
      eic: '63W631527814486R',
      gasDayStart: '2026-09-26',
      sendOutGWhDay: 331.7,
      inventoryGWh: 1609.41,
      inventoryMaxGWh: 2400.01,
      referenceSendOutGWhDay: 337,
    });
  });

  it('terminal manquant (clé refusée en 200 + error) → réponse partielle, cache court', async () => {
    process.env.GIE_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('21W0000000000451')) {
        return new Response(JSON.stringify({ error: 'access denied', message: 'Invalid or missing API key', data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [alsiRow('2026-09-26', '100')] }), { status: 200 });
    }));

    const res = mockRes();
    await alsiHandler({ method: 'GET' }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, s-maxage=600, stale-while-revalidate=300');
    const body = res.body as { terminals: unknown[]; errors: unknown[] };
    expect(body.terminals).toHaveLength(3);
    expect(body.errors).toEqual([{ eic: '21W0000000000451', error: 'Invalid or missing API key' }]);
  });

  it('aucun terminal → 502 sans cache', async () => {
    process.env.GIE_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream down', { status: 503 })));

    const res = mockRes();
    await alsiHandler({ method: 'GET' }, res);

    expect(res.statusCode).toBe(502);
    expect(res.headers['cache-control']).toBe('no-store');
    expect((res.body as { errors: unknown[] }).errors).toHaveLength(4);
  });
});
