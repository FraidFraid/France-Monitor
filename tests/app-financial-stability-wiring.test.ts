// tests/app-financial-stability-wiring.test.ts
// Câblage du bloc « Stabilité financière » dans App.ts (spec 2026-10-12) : remplace MarketStrip, relevé avec la finance, deux
// lignes au panneau des sources, entrées du tableau de qualité. App.ts ne s'instancie pas sous vitest : ces tests lisent sa source.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../src/App.ts');
const quality = read('../src/services/sources-quality-dashboard.ts');

describe('App.ts', () => {
  it('MarketStrip retiré, FinancialStabilityStrip monté dans la bande sous la carte', () => {
    expect(existsSync(new URL('../src/components/MarketStrip.ts', import.meta.url))).toBe(false);
    expect(app).not.toMatch(/MarketStrip\b/);
    expect(app).toContain("import { FinancialStabilityStrip } from './components/FinancialStabilityStrip.ts';");
    expect(app).toMatch(/new FinancialStabilityStrip\(marketStripContainer\)/);
  });
  it('relevé avec la finance ; CAC 40 repris de fetchMarketData ; deux sources nommées', () => {
    expect(app).toMatch(/private startFinancePolling\(\)[^]*?this\.loadFinancialStability\(\)/);
    expect(app).toMatch(/private renderFinancialStrip\(\)[^]*?symbol === 'CAC\.INDX'/);
    expect(app).toMatch(/updateSource\(BCE_SOURCE_NAME, bceStatus\(/);
    expect(app).toMatch(/updateSource\(SPREAD_SOURCE_NAME, spreadStatus\(/);
  });
  it('fetchMarketData toujours relevé (score et poste v2)', () => {
    expect(app).toMatch(/this\.currentMarketData = data;/);
  });
});

describe('tableau de qualité des sources', () => {
  it('BCE (officielle) et Écart OAT-Bund (marché, non officiel)', () => {
    expect(quality).toMatch(/id: 'bce',[^]*?watchdogNames: \['BCE'\]/);
    expect(quality).toMatch(/id: 'oat-bund',[^]*?watchdogNames: \['Écart OAT-Bund'\]/);
  });
});
