// src/services/finance.test.ts : plus aucune courbe inventée (spec 2026-10-12 stabilité financière, D1) : `history` reste vide,
// le générateur pseudo-aléatoire a disparu ; cours et variation du jour inchangés (score et poste v2).
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMarketData } from './finance.ts';

afterEach(() => { vi.unstubAllGlobals(); });

describe('finance.ts', () => {
  it('cours réels, variation du jour, aucune courbe', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ data: [{ symbol: 'CAC.INDX', last: 7832.88, open: 7803.33, date: '2026-10-12T08:00:00Z' }] }),
    })));
    const [cac] = await fetchMarketData();
    expect(cac).toMatchObject({ symbol: 'CAC.INDX', name: 'CAC 40', price: 7832.88, category: 'indices', history: [] });
    expect(cac?.changePercent).toBeCloseTo(0.3787, 3);
  });
  it('plus de générateur de courbe dans le source', () => {
    const src = readFileSync(new URL('./finance.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/buildSyntheticHistory|createSeededRandom|random walk|fausse courbe/);
  });
});
