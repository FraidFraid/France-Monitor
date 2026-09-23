import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import handler from '../api/_handlers/opendata-proxy.js';

// Nouveau proxy CDN-caché pour les APIs open data publiques appelées jusqu'ici
// directement par le navigateur (hubeau, ODRE, Enedis, EDF, geo.api.gouv.fr,
// API Adresse, Géoplateforme) — voir docs/audit-2026-09-chargement-jev-ui.md.

type Headers = Record<string, string>;

function mockReq(url: string, method = 'GET') {
  return { method, url, headers: {} as Record<string, string> };
}

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

describe('api/opendata-proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('400 si ?url= est absent', async () => {
    const res = mockRes();
    await handler(mockReq('/api/opendata-proxy'), res);
    expect(res.statusCode).toBe(400);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('403 sur un domaine non whitelisté', async () => {
    const res = mockRes();
    await handler(mockReq(`/api/opendata-proxy?url=${encodeURIComponent('https://evil.example.com/x')}`), res);
    expect(res.statusCode).toBe(403);
  });

  it('403 en http (https obligatoire)', async () => {
    const res = mockRes();
    await handler(mockReq(`/api/opendata-proxy?url=${encodeURIComponent('http://geo.api.gouv.fr/communes/1')}`), res);
    expect(res.statusCode).toBe(403);
  });

  it('405 hors GET', async () => {
    const res = mockRes();
    await handler(mockReq(`/api/opendata-proxy?url=${encodeURIComponent('https://geo.api.gouv.fr/communes/1')}`, 'POST'), res);
    expect(res.statusCode).toBe(405);
  });

  it('204 sur OPTIONS sans appeler l’amont', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = mockRes();
    await handler(mockReq('/api/opendata-proxy', 'OPTIONS'), res);
    expect(res.statusCode).toBe(204);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('proxifie geo.api.gouv.fr avec un cache CDN 7 jours', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ nom: 'Test' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    const res = mockRes();
    await handler(mockReq(`/api/opendata-proxy?url=${encodeURIComponent('https://geo.api.gouv.fr/communes/62752')}`), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, s-maxage=604800, stale-while-revalidate=1209600');
  });

  it('cache 1 jour pour hubeau /referentiel/, 5 min pour les autres routes hubeau', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    const resReferentiel = mockRes();
    await handler(mockReq(`/api/opendata-proxy?url=${encodeURIComponent('https://hubeau.eaufrance.fr/api/v2/hydrometrie/referentiel/stations')}`), resReferentiel);
    expect(resReferentiel.headers['cache-control']).toBe('public, s-maxage=86400, stale-while-revalidate=172800');

    const resObs = mockRes();
    await handler(mockReq(`/api/opendata-proxy?url=${encodeURIComponent('https://hubeau.eaufrance.fr/api/v2/hydrometrie/observations_tr')}`), resObs);
    expect(resObs.headers['cache-control']).toBe('public, s-maxage=300, stale-while-revalidate=600');
  });

  it('cache 10 min pour ODRE et 1 jour pour EDF (métropole/Corse/Réunion)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    const resOdre = mockRes();
    await handler(mockReq(`/api/opendata-proxy?url=${encodeURIComponent('https://odre.opendatasoft.com/api/records/1.0/search/?dataset=x')}`), resOdre);
    expect(resOdre.headers['cache-control']).toBe('public, s-maxage=600, stale-while-revalidate=1200');

    const resEdf = mockRes();
    await handler(mockReq(`/api/opendata-proxy?url=${encodeURIComponent('https://opendata-reunion.edf.fr/api/records/1.0/search/?dataset=x')}`), resEdf);
    expect(resEdf.headers['cache-control']).toBe('public, s-maxage=86400, stale-while-revalidate=172800');
  });

  it('relaie le statut amont et n’ajoute pas de cache CDN sur une erreur', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const res = mockRes();
    await handler(mockReq(`/api/opendata-proxy?url=${encodeURIComponent('https://odre.opendatasoft.com/x')}`), res);
    expect(res.statusCode).toBe(500);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
