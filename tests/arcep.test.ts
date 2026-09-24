import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import handler from '../api/_handlers/arcep.js';

// Root cause (audit 2026-09) : data.gouv.fr a migré le fichier quotidien
// "sites indisponibles" de object.files.data.gouv.fr vers un bucket OVH dédié
// (arcep.s3.rbx.io.cloud.ovh.net) — le proxy sondait encore l'ancien host et
// une date figée, d'où un 404 systématique en septembre 2026. Ces tests
// couvrent la sonde HEAD directe, le repli sur le catalogue data.gouv.fr, et
// l'échec total (rien sous 45 jours).

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

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

describe('api/arcep', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sert le geojson du jour trouvé par sonde HEAD directe sur le bucket OVH', async () => {
    const todayStr = isoDateDaysAgo(0);
    const calls: Array<{ url: string; method: string }> = [];

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      if (init?.method === 'HEAD') {
        return url.includes(`/${todayStr}/`) ? new Response(null, { status: 200 }) : new Response(null, { status: 404 });
      }
      return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), { status: 200 });
    }));

    const res = mockRes();
    await handler({ method: 'GET' }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-data-date']).toBe(todayStr);
    expect(res.headers['cache-control']).toBe('public, s-maxage=21600, stale-while-revalidate=86400');
    // Pas besoin du repli catalogue data.gouv.fr quand la sonde du jour répond.
    expect(calls.some((c) => c.url.includes('data.gouv.fr'))).toBe(false);
  });

  it('retombe sur le catalogue data.gouv.fr si aucune sonde HEAD (10 jours) ne répond', async () => {
    const fallbackDate = isoDateDaysAgo(15); // hors fenêtre de sonde (10j), dans les 45j
    const fallbackUrl = `https://arcep.s3.rbx.io.cloud.ovh.net/sites-indisponibles/all/${fallbackDate}/raw${fallbackDate}.geojson`;

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') return new Response(null, { status: 404 });
      if (url.includes('data.gouv.fr')) {
        return new Response(JSON.stringify({
          resources: [{ format: 'geojson', title: `${fallbackDate}.geojson`, url: fallbackUrl }],
        }), { status: 200 });
      }
      if (url === fallbackUrl) {
        return new Response(JSON.stringify({ type: 'FeatureCollection', features: [{ id: 1 }] }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }));

    const res = mockRes();
    await handler({ method: 'GET' }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-data-date']).toBe(fallbackDate);
    expect((res.body as { features: unknown[] }).features).toHaveLength(1);
  });

  it('404 avec cache négatif court quand rien n’est trouvé (sondes + catalogue vides)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') return new Response(null, { status: 404 });
      if (url.includes('data.gouv.fr')) return new Response(JSON.stringify({ resources: [] }), { status: 200 });
      return new Response(null, { status: 404 });
    }));

    const res = mockRes();
    await handler({ method: 'GET' }, res);

    expect(res.statusCode).toBe(404);
    expect(res.headers['cache-control']).toBe('public, s-maxage=3600');
    expect(res.body).toHaveProperty('lastTried');
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
