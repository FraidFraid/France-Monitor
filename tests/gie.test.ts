import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import agsiHandler from '../api/_handlers/gie/agsi.js';
// @ts-expect-error — module JS sans déclaration de types
import alsiHandler from '../api/_handlers/gie/alsi.js';

// Route GIE (stockage gaz AGSI/ALSI) : dead en prod avant cet audit — seul le
// plugin dev src/plugins/gie-proxy.ts (fallback sans clé) la servait.

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

describe.each([
  { name: 'agsi', handler: agsiHandler, upstreamHost: 'agsi.gie.eu' },
  { name: 'alsi', handler: alsiHandler, upstreamHost: 'alsi.gie.eu' },
])('api/gie/$name', ({ handler, upstreamHost }) => {
  const originalKey = process.env.GIE_API_KEY;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.GIE_API_KEY;
    else process.env.GIE_API_KEY = originalKey;
  });

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

  it('relaie la réponse amont et pose un cache CDN 1h quand la clé est présente', async () => {
    process.env.GIE_API_KEY = 'test-key';
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain(upstreamHost);
      expect((init?.headers as Record<string, string>)['x-key']).toBe('test-key');
      return new Response(JSON.stringify({ data: [{ name: 'Site A' }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const res = mockRes();
    await handler({ method: 'GET' }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, s-maxage=3600, stale-while-revalidate=1800');
    expect(JSON.parse(res.body as string)).toEqual({ data: [{ name: 'Site A' }] });
  });

  it('relaie une erreur amont sans cache CDN', async () => {
    process.env.GIE_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })));

    const res = mockRes();
    await handler({ method: 'GET' }, res);

    expect(res.statusCode).toBe(401);
    expect(res.headers['cache-control']).toBe('no-store');
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
