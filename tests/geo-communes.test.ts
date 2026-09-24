import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import { parsePoints, resolvePoints } from '../api/_handlers/geo/communes.js';

const passthroughCache = async (_key: string, _opts: unknown, producer: () => Promise<unknown>) => ({ value: await producer(), cache: 'miss', ageSec: 0 });

describe('parsePoints', () => {
  it('normalise à 4 décimales', () => {
    expect(parsePoints('44.841234,-0.580111;45.1,1.2')).toEqual([{ lat: '44.8412', lon: '-0.5801' }, { lat: '45.1000', lon: '1.2000' }]);
  });
  it('refuse les entrées invalides ou trop nombreuses', () => {
    expect(parsePoints('')).toBeNull();
    expect(parsePoints('abc,1')).toBeNull();
    expect(parsePoints('95,1')).toBeNull();
    expect(parsePoints(Array.from({ length: 201 }, () => '44,1').join(';'))).toBeNull();
  });
});

describe('resolvePoints', () => {
  it('résout chaque point via geo.api, dans l’ordre, et distingue « aucune commune » d’un échec amont', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('lat=44.0000')) return new Response(JSON.stringify([{ nom: 'Lanton', codeDepartement: '33' }]));
      if (url.includes('lat=43.0000')) return new Response(JSON.stringify([]));
      return new Response('boom', { status: 502 });
    });
    const out = await resolvePoints(
      [{ lat: '44.0000', lon: '-1.0000' }, { lat: '43.0000', lon: '-3.0000' }, { lat: '42.0000', lon: '9.0000' }],
      { fetchImpl, cache: passthroughCache },
    );
    expect(out).toEqual([{ nom: 'Lanton', codeDepartement: '33' }, null, { error: 'upstream' }]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('geo.api.gouv.fr/communes');
  });
});
