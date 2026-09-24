import { describe, expect, it, vi, beforeEach } from 'vitest';
import { dedupe, fetchJsonOnce, _resetInFlightForTests } from './inflight.ts';

describe('dedupe', () => {
  beforeEach(() => {
    _resetInFlightForTests();
  });

  it('partage la même promesse pour des appels concurrents sur la même clé', async () => {
    let calls = 0;
    const fn = () => {
      calls += 1;
      return new Promise<number>((resolve) => setTimeout(() => resolve(42), 10));
    };

    const [a, b, c] = await Promise.all([
      dedupe('k', fn),
      dedupe('k', fn),
      dedupe('k', fn),
    ]);

    expect(calls).toBe(1);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(c).toBe(42);
  });

  it('ne partage pas entre des clés différentes', async () => {
    let calls = 0;
    const fn = () => {
      calls += 1;
      return Promise.resolve(calls);
    };

    const [a, b] = await Promise.all([dedupe('a', fn), dedupe('b', fn)]);
    expect(calls).toBe(2);
    expect(a).not.toBe(b);
  });

  it('relance fn() après résolution (pas de cache permanent)', async () => {
    let calls = 0;
    const fn = () => {
      calls += 1;
      return Promise.resolve(calls);
    };

    const first = await dedupe('k', fn);
    const second = await dedupe('k', fn);

    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(calls).toBe(2);
  });

  it('propage un rejet à tous les appelants concurrents puis libère la clé', async () => {
    let calls = 0;
    const fn = () => {
      calls += 1;
      return Promise.reject(new Error('boom'));
    };

    const results = await Promise.allSettled([dedupe('k', fn), dedupe('k', fn)]);
    expect(calls).toBe(1);
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('rejected');

    // La clé a été libérée : un nouvel appel relance fn().
    await expect(dedupe('k', fn)).rejects.toThrow('boom');
    expect(calls).toBe(2);
  });
});

describe('fetchJsonOnce', () => {
  beforeEach(() => {
    _resetInFlightForTests();
    vi.restoreAllMocks();
  });

  it('déduplique deux appels concurrents vers la même URL', async () => {
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise((resolve) =>
        setTimeout(() => resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })), 10),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([
      fetchJsonOnce<{ ok: boolean }>('https://example.test/data'),
      fetchJsonOnce<{ ok: boolean }>('https://example.test/data'),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
  });

  it('ne déduplique pas des URLs différentes', async () => {
    // mockImplementation (et non mockResolvedValue) : une instance Response fraîche
    // à chaque appel — un corps de réponse ne se lit qu'une fois, mockResolvedValue
    // partagerait la même instance entre les deux URLs distinctes.
    const fetchMock = vi.fn().mockImplementation(
      () => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([
      fetchJsonOnce('https://example.test/a'),
      fetchJsonOnce('https://example.test/b'),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lève sur réponse HTTP non-OK', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchJsonOnce('https://example.test/err')).rejects.toThrow('HTTP 500');
  });
});
