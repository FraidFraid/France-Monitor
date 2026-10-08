import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import handler, { __resetRteUnavailabilityForTests } from '../api/_handlers/nuclear/rte-unavailability.js';

function mockRes() {
  let statusCode = 200; let body: unknown;
  const res = {
    setHeader() {}, end() { return res; },
    status(c: number) { statusCode = c; return res; },
    json(p: unknown) { body = p; return res; },
    get statusCode() { return statusCode; }, get body() { return body as { items: unknown[]; available: boolean; error?: string }; },
  };
  return res;
}
const json200 = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers });

describe('API RTE indisponibilités nucléaires', () => {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  beforeEach(() => {
    __resetRteUnavailabilityForTests();
    calls.length = 0;
    process.env.RTE_CLIENT_ID = 'test-id';
    process.env.RTE_CLIENT_SECRET = 'test-secret';
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  function stub(pages: Response[]) {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      if (String(url).includes('/token/')) return json200({ access_token: 'tok' });
      calls.push({ url: String(url), headers: init?.headers ?? {} });
      return pages.shift() ?? json200({ generation_unavailabilities: [] });
    }));
  }

  it('interroge le nucléaire sur J-3 à J+15, dernière version, sans paramètres inexistants', async () => {
    stub([json200({ generation_unavailabilities: [{ identifier: 'a' }] })]);
    const res = mockRes();
    await handler({ method: 'GET' }, res);
    const q = new URL(calls[0].url).searchParams;
    expect(q.get('fuel_type')).toBe('NUCLEAR');
    expect(q.get('last_version')).toBe('true');
    expect(q.get('date_type')).toBe('EVENT_DATE');
    expect(q.has('resource_type')).toBe(false);
    expect(q.has('status')).toBe(false);
    expect(q.has('event_status')).toBe(false);
    expect(q.get('start_date')).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    const days = (Date.parse(q.get('end_date')!) - Date.parse(q.get('start_date')!)) / 86_400_000;
    expect(days).toBeCloseTo(18, 0);
    expect(res.body.items).toHaveLength(1);
  });

  it('suit les réponses 206 avec le continuation_token et concatène les pages', async () => {
    stub([
      json200({ generation_unavailabilities: [{ identifier: 'a' }] }, 206, { continuation_token: 'T1' }),
      json200({ generation_unavailabilities: [{ identifier: 'b' }] }, 206, { continuation_token: 'T2' }),
      json200({ generation_unavailabilities: [{ identifier: 'c' }] }, 200),
    ]);
    const res = mockRes();
    await handler({ method: 'GET' }, res);
    expect(calls).toHaveLength(3);
    expect(calls[0].headers.continuation_token).toBeUndefined();
    expect(calls[1].headers.continuation_token).toBe('T1');
    expect(calls[2].headers.continuation_token).toBe('T2');
    expect(res.body.items.map((i) => (i as { identifier: string }).identifier)).toEqual(['a', 'b', 'c']);
  });

  it('refuse une pagination qui ne se termine pas (pas de résultat tronqué)', async () => {
    stub(Array.from({ length: 12 }, () => json200({ generation_unavailabilities: [] }, 206, { continuation_token: 'T' })));
    const res = mockRes();
    await handler({ method: 'GET' }, res);
    expect(res.statusCode).toBe(502);
    expect(res.body.available).toBe(false);
    expect(calls).toHaveLength(10);
  });
});
