// src/components/CommodityStrip.test.ts : cours des matières premières à la française (virgule décimale, milliers groupés,
// unité insécable), comme le bloc « Stabilité financière » voisin.
import { describe, expect, it } from 'vitest';
import { SECTION_LABELS, formatCommodityPct, formatCommodityPrice } from './CommodityStrip.ts';

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
