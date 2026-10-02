import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../api/_handlers/energy/ecowatt.js';

function fakeRes() {
  const res = { statusCode: 0, body: undefined as unknown, headers: {} as Record<string, unknown>,
    setHeader(k: string, v: unknown) { this.headers[k] = v; },
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.body = b; return this; },
    end() { return this; } };
  return res;
}

afterEach(() => vi.unstubAllGlobals());

describe('/api/energy/ecowatt', () => {
  it('lit le national courant (consommation non nulle) et la série du jour', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      return { ok: true, json: async () => ({ results: [] }) };
    }));
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.body as object)).toEqual(['regional', 'national', 'day']);
    const nat = decodeURIComponent(urls.find((u) => u.includes('eco2mix-national-tr') && u.includes('limit=1&')) ?? '');
    expect(nat).toContain('consommation is not null');
    for (const f of ['prevision_j', 'taux_co2', 'nucleaire', 'gaz', 'fioul', 'charbon', 'bioenergies', 'ech_physiques', 'ech_comm_angleterre']) {
      expect(nat).toContain(f);
    }
    const day = decodeURIComponent(urls.find((u) => u.includes('eco2mix-national-tr') && u.includes('limit=100')) ?? '');
    expect(day).toContain('prevision_j is not null');
    expect(day).toContain('order_by=-date_heure');
  });

  it('502 si une source amont échoue', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    expect(res.statusCode).toBe(502);
  });
});
