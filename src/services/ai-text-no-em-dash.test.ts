import { afterEach, describe, expect, it, vi } from 'vitest';
import { summarizeWithFallback } from './summarization.ts';
import { fetchISNRSynthesis } from './isnr-synthesis.ts';

afterEach(() => vi.unstubAllGlobals());

describe('textes IA : aucun tiret cadratin', () => {
  it('résumé /api/intelligence/v1/summarize', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ summary: 'Grève — trafic perturbé' }) })));
    expect(await summarizeWithFallback('Un texte assez long pour être résumé par le modèle.')).toBe('Grève : trafic perturbé');
  });

  it('briefing /api/intelligence/v1/synthesis', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ briefing: 'Réseau — stable', stabilityImpact: 0, fromCache: false, computedAt: '2026-10-01T08:00:00Z' }),
    })));
    const r = await fetchISNRSynthesis({} as Parameters<typeof fetchISNRSynthesis>[0], []);
    expect(r?.briefing).toBe('Réseau : stable');
  });
});
