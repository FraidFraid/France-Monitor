// src/components/CommodityStrip.test.ts : cours des matières premières à la française (virgule décimale, milliers groupés,
// unité insécable), comme le bloc « Stabilité financière » voisin.
import { describe, expect, it } from 'vitest';
import { SECTION_LABELS, commodityRowHTML, commoditySparkline, formatCommodityPct, formatCommodityPrice } from './CommodityStrip.ts';
import type { CommodityData } from '../types/index.ts';

const NB = ' ';

describe('format français', () => {
  it('prix : virgule décimale, milliers groupés sans décimale', () => {
    expect(formatCommodityPrice(3.171)).toBe('3,17');
    expect(formatCommodityPrice(483.5)).toBe('483,50');
    expect(formatCommodityPrice(4193.2)).toBe('4 193');
  });
  it('variation : signe, virgule, pourcentage insécable', () => {
    expect(formatCommodityPct(-1.522)).toBe(`−1,52${NB}%`);
    expect(formatCommodityPct(0.78)).toBe(`+0,78${NB}%`);
    expect(formatCommodityPct(0)).toBe(`0,00${NB}%`);
  });
  it('intitulés accentués', () => {
    expect(SECTION_LABELS).toEqual({ energy: 'Énergie', metals: 'Métaux', agro: 'Agro' });
  });
});

describe('courbe de séance', () => {
  const item: CommodityData = {
    symbol: 'NG=F', name: 'Gaz Naturel', category: 'energy', unit: '$/MMBtu', price: 3.171, changePercent: -1.522, trend: 'down',
    lastUpdated: new Date('2026-10-12T18:43:00Z'), history: [3.22, 3.2, 3.171],
  };
  it('ligne pointillée de la clôture de la veille, infobulle « séance du jour » à la française', () => {
    const svg = commoditySparkline(item);
    expect(svg).toContain('class="spark-ref"');
    expect(svg).toContain('<title>séance du jour · plus bas 3,17 · plus haut 3,22</title>');
  });
});

describe('ligne de tableau (refonte du 12/10)', () => {
  const base: CommodityData = {
    symbol: 'BZ=F', name: 'Brent', category: 'energy', unit: '$/bbl', price: 106.52, changePercent: 1.72, trend: 'up',
    lastUpdated: new Date('2026-10-12T18:43:00Z'), history: [104.7, 105.9, 106.52],
  };
  it('même ligne que la stabilité financière : nom, unité, cours, variation, courbe', () => {
    const html = commodityRowHTML(base);
    expect(html).toMatch(/^<div class="fin-row" data-id="BZ=F"/);
    expect(html).toContain('<span class="fin-row__unit">$/bbl</span>');
    expect(html).toContain('<span class="fin-row__value">106,52</span>');
    expect(html).toContain(`<span class="fin-row__note is-up">+1,72${NB}%</span>`);
    expect(html).toContain('class="spark-line"');
  });
  it('mouvement exceptionnel de l’énergie (± 5 %) : variation en alerte jaune', () => {
    expect(commodityRowHTML({ ...base, changePercent: -6.1 })).toContain('fin-row__note is-alert');
    expect(commodityRowHTML({ ...base, category: 'metals', changePercent: -6.1 })).toContain('fin-row__note is-down');
  });
});
