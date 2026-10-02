import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DromLiveResponse } from '../types/index.ts';
import { fetchDromLive, isDromLiveResponse, resetDromLiveCache } from './drom-live.ts';

const BODY: DromLiveResponse = {
  fetchedAt: 1,
  territories: [{
    code: 'RE', name: 'La Réunion', utcOffsetLabel: 'UTC+4', timeZone: 'Indian/Reunion', state: 'ok', error: null, dataTime: 1,
    status: 'Estimé', totalMw: 336, renewableSharePct: 43, day: [],
    mix: { coal: 75, oil: 118, turbine: null, bio: 67, geothermal: null, hydro: 3, solar: 69, wind: 4, storage: 0, links: null, other: null },
  }],
};

afterEach(() => { vi.unstubAllGlobals(); resetDromLiveCache(); });

describe('service DROM temps réel', () => {
  it('lit la route et garde la réponse 5 minutes', async () => {
    const f = vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => BODY }));
    vi.stubGlobal('fetch', f);
    expect(await fetchDromLive(0)).toEqual(BODY);
    await fetchDromLive(4 * 60_000);
    expect(f).toHaveBeenCalledTimes(1);
    await fetchDromLive(5 * 60_000 + 1);
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[0]?.[0]).toBe('/api/energy/drom-live');
  });
  it('HTTP en erreur ou forme inattendue : erreur levée, rien en cache', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string) => ({ ok: false, status: 502, json: async () => ({}) })));
    await expect(fetchDromLive(0)).rejects.toThrow('HTTP 502');
    vi.stubGlobal('fetch', vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => ({ fetchedAt: 1, territories: 'x' }) })));
    await expect(fetchDromLive(0)).rejects.toThrow('réponse inattendue');
  });
  it('garde de forme', () => {
    expect(isDromLiveResponse(BODY)).toBe(true);
    expect(isDromLiveResponse({ fetchedAt: 1, territories: [{ code: 'RE' }] })).toBe(false);
    expect(isDromLiveResponse(null)).toBe(false);
  });
});
