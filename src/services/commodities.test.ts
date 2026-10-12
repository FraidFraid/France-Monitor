// src/services/commodities.test.ts : matières premières (Yahoo Spark). L'heure de mise à jour est celle du dernier cours relevé,
// jamais `end` (fin de la séance en cours, dans le futur : « MàJ 05:59 » le soir, constat du 12/10/2026).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCommodityData } from './commodities.ts';

afterEach(() => { vi.unstubAllGlobals(); });

const T0 = Date.parse('2026-10-12T04:00:00Z') / 1000;
const flat = {
  'NG=F': {
    symbol: 'NG=F', previousClose: 3.22, start: T0, end: Date.parse('2026-10-13T03:59:00Z') / 1000,
    timestamp: [T0, T0 + 300, T0 + 600], close: [3.2, 3.18, null],
  },
};

describe('fetchCommodityData', () => {
  it('heure de mise à jour : dernier cours non vide, pas la fin de séance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => flat })));
    const [ng] = await fetchCommodityData();
    expect(ng?.lastUpdated.toISOString()).toBe(new Date((T0 + 300) * 1000).toISOString());
    expect(ng?.history).toEqual([3.2, 3.18]);
  });
});
