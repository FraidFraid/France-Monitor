// src/utils/fuelPriceChart.test.ts
import { describe, expect, it } from 'vitest';
import { renderFuelPriceChartSvg } from './fuelPriceChart.ts';

const s = { fuelType: 'gazole' as const, label: 'Gazole', color: 'var(--cat-gazole)', latestPrice: 1.689, delta7dCents: null, delta30dCents: null,
  points: [{ timestamp: '2026-09-02T00:00:00Z', price: 1.72 }, { timestamp: '2026-10-02T00:00:00Z', price: 1.689 }] };

describe('graphe des prix carburants', () => {
  it('axes en français et couleurs en jetons (pas de blanc translucide en dur)', () => {
    const svg = renderFuelPriceChartSvg([s], { width: 384, height: 170, showAxes: true });
    expect(svg).toMatch(/>1,\d\d</);
    expect(svg).not.toMatch(/>1\.\d\d</);
    expect(svg).not.toMatch(/rgba\(/);
    expect(svg).toContain('stroke="var(--cat-gazole)"');
  });
  it('sans axes : inchangé pour la fiche France', () => {
    expect(renderFuelPriceChartSvg([s], { width: 320, height: 92, showAxes: false })).not.toContain('<text');
  });
});
