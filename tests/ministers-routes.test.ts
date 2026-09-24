import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import wikidataSearchHandler from '../api/_handlers/ministers/wikidata-search.js';
// @ts-expect-error — module JS sans déclaration de types
import wikidataHandler from '../api/_handlers/ministers/wikidata.js';
// @ts-expect-error — module JS sans déclaration de types
import profileMetaHandler from '../api/_handlers/ministers/profile-meta.js';

// La route /api/ministers/* était dead en prod avant cet audit : src/services/ministers.ts
// l'appelle mais seul le plugin dev src/plugins/ministers-proxy.ts branchait
// handleMinistersRequest. Ces tests couvrent le portage prod minces sous
// api/_handlers/ministers/*.js et le wrapper de cache CDN applyMinistersCdnCache.

type Headers = Record<string, string>;

function mockRes() {
  const headers: Headers = {};
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader(k: string, v: string) { headers[k.toLowerCase()] = v; },
    end(b?: unknown) { res.body = b; },
    headers,
  };
  return res;
}

describe('api/ministers/* — handlers minces prod', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('wikidata-search : 400 + no-store si ?name= manque (pas d’appel amont)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const res = mockRes();
    await wikidataSearchHandler({ url: '/api/ministers/wikidata-search' }, res);

    expect(res.statusCode).toBe(400);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('wikidata-search : 200 + cache CDN 1h sur succès', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ search: [] }), { status: 200 })));

    const res = mockRes();
    await wikidataSearchHandler({ url: '/api/ministers/wikidata-search?name=Test' }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, s-maxage=3600, stale-while-revalidate=7200');
  });

  it('wikidata : 400 + no-store si ?id= manque', async () => {
    const res = mockRes();
    await wikidataHandler({ url: '/api/ministers/wikidata' }, res);

    expect(res.statusCode).toBe(400);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('wikidata : 200 + cache CDN 24h sur succès', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ entities: { Q1: {} } }), { status: 200 })));

    const res = mockRes();
    await wikidataHandler({ url: '/api/ministers/wikidata?id=Q1' }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, s-maxage=86400, stale-while-revalidate=172800');
  });

  it('profile-meta : 400 + no-store si prenom/nom manquent', async () => {
    const res = mockRes();
    await profileMetaHandler({ url: '/api/ministers/profile-meta' }, res);

    expect(res.statusCode).toBe(400);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('404 + no-store quand l’URL ne correspond à aucune sous-route ministers connue', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const res = mockRes();
    await wikidataSearchHandler({ url: '/api/ministers/inconnu' }, res);

    expect(res.statusCode).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
