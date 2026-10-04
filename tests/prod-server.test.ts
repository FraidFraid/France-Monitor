import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
// @ts-expect-error — module JS sans déclaration de types
import { addQuery, addResponseHelpers, readBody } from '../server/prod/vercel-compat.mjs';
// @ts-expect-error — module JS sans déclaration de types
import { createApiServer, resolveEntry, DEFAULT_HOST, DEFAULT_PORT } from '../server/prod/http-server.mjs';

// ─── Helpers de test ────────────────────────────────────────────────────────

type FakeReq = Readable & {
  method?: string;
  url?: string;
  headers: Record<string, string>;
  body?: unknown;
  query?: unknown;
};

function fakeReq(opts: { method?: string; url?: string; headers?: Record<string, string>; body?: string | Buffer } = {}): FakeReq {
  const chunks = opts.body ? [Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(opts.body)] : [];
  const req = Readable.from(chunks) as FakeReq;
  req.method = opts.method ?? 'GET';
  req.url = opts.url ?? '/';
  req.headers = opts.headers ?? {};
  return req;
}

function fakeRes() {
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 200,
    headersSent: false,
    body: undefined as unknown,
    setHeader(k: string, v: string) { headers[k.toLowerCase()] = v; },
    getHeader(k: string) { return headers[k.toLowerCase()]; },
    end(b?: unknown) { res.body = b; res.headersSent = true; },
    headers,
  };
  return res;
}

// ─── vercel-compat.mjs ──────────────────────────────────────────────────────

describe('vercel-compat — addQuery', () => {
  it('reproduit la forme de req.query de Vercel (tableau si la clé est répétée)', () => {
    const req = fakeReq({ url: '/api/x?a=1&a=2&b=3' });
    addQuery(req);
    expect(req.query).toEqual({ a: ['1', '2'], b: '3' });
  });

  it("n'écrase pas un req.query déjà posé", () => {
    const req = fakeReq({ url: '/api/x?a=1' });
    (req as any).query = { deja: 'la' };
    addQuery(req);
    expect(req.query).toEqual({ deja: 'la' });
  });
});

describe('vercel-compat — addResponseHelpers', () => {
  it('pose status()/json()/send() chaînables quand absents', () => {
    const res = fakeRes();
    addResponseHelpers(res);
    res.status(201).json({ ok: true });
    expect(res.statusCode).toBe(201);
    expect(res.headers['content-type']).toContain('application/json');
    expect(JSON.parse(String(res.body))).toEqual({ ok: true });
  });

  it("n'écrase pas un helper déjà présent", () => {
    const res = fakeRes();
    const existingStatus = vi.fn(() => res);
    res.status = existingStatus;
    addResponseHelpers(res);
    res.status(418);
    expect(existingStatus).toHaveBeenCalledWith(418);
  });

  it('send() envoie une chaîne telle quelle (Content-Type texte par défaut)', () => {
    const res = fakeRes();
    addResponseHelpers(res);
    res.status(200).send('<p>ok</p>');
    expect(res.body).toBe('<p>ok</p>');
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('send() préserve un Content-Type déjà posé par le handler (ex. proxy upstream)', () => {
    const res = fakeRes();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    addResponseHelpers(res);
    res.status(200).send('{"upstream":true}');
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
  });

  it('send() retombe sur JSON pour un objet', () => {
    const res = fakeRes();
    addResponseHelpers(res);
    res.send({ a: 1 });
    expect(JSON.parse(String(res.body))).toEqual({ a: 1 });
  });

  it('send() avec un Buffer utilise application/octet-stream par défaut', () => {
    const res = fakeRes();
    addResponseHelpers(res);
    res.send(Buffer.from('binaire'));
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(Buffer.isBuffer(res.body)).toBe(true);
  });
});

describe('vercel-compat — readBody', () => {
  it('GET/HEAD : req.body = undefined, sans lire le flux', async () => {
    const req = fakeReq({ method: 'GET' });
    await expect(readBody(req)).resolves.toBeUndefined();
    expect(req.body).toBeUndefined();
  });

  it('JSON : parse le corps en objet', async () => {
    const req = fakeReq({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'bonjour' }),
    });
    await readBody(req);
    expect(req.body).toEqual({ text: 'bonjour' });
  });

  it('JSON malformé : corps vide plutôt qu’une exception', async () => {
    const req = fakeReq({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ pas du json',
    });
    await expect(readBody(req)).resolves.toBeUndefined();
    expect(req.body).toBeUndefined();
  });

  it('formulaire encodé : parse en objet', async () => {
    const req = fakeReq({
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'a=1&b=deux',
    });
    await readBody(req);
    expect(req.body).toEqual({ a: '1', b: 'deux' });
  });

  it('texte : chaîne brute', async () => {
    const req = fakeReq({ method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'bonjour' });
    await readBody(req);
    expect(req.body).toBe('bonjour');
  });

  it('type non reconnu : Buffer brut', async () => {
    const req = fakeReq({ method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from([1, 2, 3]) });
    await readBody(req);
    expect(Buffer.isBuffer(req.body)).toBe(true);
    expect(Array.from(req.body as Buffer)).toEqual([1, 2, 3]);
  });

  it('ne relit pas un req.body déjà posé (idempotent)', async () => {
    const req = fakeReq({ method: 'POST' });
    (req as any).body = { deja: 'parse' };
    await expect(readBody(req)).resolves.toEqual({ deja: 'parse' });
  });
});

// ─── http-server.mjs — table d'aiguillage des fichiers hors routeur ────────

describe('http-server — resolveEntry (sans exécuter les handlers)', () => {
  it('résout les trois fichiers de fonction hors routeur', () => {
    for (const path of ['/api/ingest/news', '/api/fuel-price-series-refresh', '/api/sentinel-ndwi']) {
      const entry = resolveEntry(path);
      expect(typeof entry, path).toBe('function');
    }
  });

  it('renvoie null pour toute autre route (déléguée à dispatch)', () => {
    expect(resolveEntry('/api/environment/vigilance')).toBeNull();
    expect(resolveEntry('/api')).toBeNull();
    expect(resolveEntry('/')).toBeNull();
  });

  it('normalise un slash final', () => {
    expect(typeof resolveEntry('/api/sentinel-ndwi/')).toBe('function');
  });
});

// ─── http-server.mjs — serveur réel (aucun appel réseau, fetch mocké) ──────

describe('createApiServer', () => {
  let server: ReturnType<typeof createApiServer>;
  let baseUrl: string;

  beforeAll(async () => {
    server = createApiServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('/healthz répond 200 { ok: true } — santé du process', async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it('un chemin hors /api et hors /healthz répond 404 (le statique est servi par Caddy)', async () => {
    const res = await fetch(`${baseUrl}/about.html`);
    expect(res.status).toBe(404);
  });

  it('exports par défaut : HOST/PORT par défaut cohérents avec la spec (127.0.0.1:3000)', () => {
    expect(DEFAULT_HOST).toBe('127.0.0.1');
    expect(DEFAULT_PORT).toBe(3000);
  });

  it('une route inconnue sous /api répond 404 JSON via dispatch()', async () => {
    const res = await fetch(`${baseUrl}/api/route-inconnue`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it('sert une vraie route de bout en bout (vercel-compat → dispatch → handler), sans appel réseau (fetch mocké)', async () => {
    const upstreamPayload = { vulnerabilities: [] };
    // On ne mocke QUE l'appel amont du handler (NVD, relayé par /api/json-proxy) : l'appel du test vers son
    // propre serveur local (baseUrl, ci-dessous) doit passer par le vrai fetch réseau (loopback),
    // sinon ce ne serait plus un test de bout en bout du serveur.
    const realFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (input: unknown, init?: unknown) => {
      const href = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
      if (href.startsWith('https://services.nvd.nist.gov/')) {
        return new Response(JSON.stringify(upstreamPayload), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
      }
      return realFetch(input as RequestInfo, init as RequestInit);
    });
    vi.stubGlobal('fetch', fetchMock);

    const upstream = 'https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=1';
    const res = await fetch(`${baseUrl}/api/json-proxy?url=${encodeURIComponent(upstream)}`);

    expect(fetchMock).toHaveBeenCalledWith(upstream, expect.anything());
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    await expect(res.json()).resolves.toEqual(upstreamPayload);
  });

  it('en-tête CORS présent même sur une réponse d’erreur /api', async () => {
    const res = await fetch(`${baseUrl}/api/route-inconnue`);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
