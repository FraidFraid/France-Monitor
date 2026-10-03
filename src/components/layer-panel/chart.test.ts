// src/components/layer-panel/chart.test.ts
import { describe, expect, it } from 'vitest';
import { lineChart } from './chart.ts';

const H = 3_600_000;
const T0 = Date.parse('2026-10-02T00:00:00Z');
const opts = {
  label: 'Courbe <b>', from: T0, to: T0 + 24 * H, stroke: 'var(--sev-green)',
  value: (v: number) => `${v}`, tick: (ms: number) => `${(ms - T0) / H} h`,
};

describe('courbe des panneaux de couches', () => {
  it('moins de deux points ou fenêtre vide : rien', () => {
    expect(lineChart([], opts)).toBe('');
    expect(lineChart([{ at: T0, value: 1 }], opts)).toBe('');
    expect(lineChart([{ at: T0, value: 1 }, { at: T0 + H, value: 2 }], { ...opts, to: T0 })).toBe('');
  });
  it('tracé, libellé accessible échappé, min et max, bornes de temps', () => {
    const svg = lineChart([{ at: T0, value: 10 }, { at: T0 + 6 * H, value: 30 }, { at: T0 + 12 * H, value: 20 }], opts);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Courbe &lt;b&gt;"');
    expect(svg).toMatch(/<polyline points="0\.0,[\d.]+ 96\.0,[\d.]+ 192\.0,[\d.]+" fill="none" stroke="var\(--sev-green\)"/);
    expect(svg).toContain('>30<');
    expect(svg).toContain('>10<');
    expect(svg).toContain('>0 h<');
    expect(svg).toContain('>24 h<');
  });
  it('repère « maintenant » seulement dans la fenêtre, point au pic', () => {
    const pts = [{ at: T0, value: 10 }, { at: T0 + 6 * H, value: 30 }];
    expect(lineChart(pts, { ...opts, nowAt: T0 + 6 * H })).toContain('stroke="var(--v2-brand)"');
    expect(lineChart(pts, { ...opts, nowAt: T0 + 30 * H })).not.toContain('var(--v2-brand)');
    expect(lineChart(pts, { ...opts, markPeak: true })).toMatch(/<circle cx="96\.0"/);
  });
  it('valeurs non finies ignorées', () => {
    expect(lineChart([{ at: T0, value: Number.NaN }, { at: T0 + H, value: 2 }], opts)).toBe('');
  });
  it('série de comparaison en pointillé et valeur de référence, comprises dans l’échelle, tracées sous la courbe', () => {
    const svg = lineChart([{ at: T0, value: 10 }, { at: T0 + 12 * H, value: 20 }], {
      ...opts, dashed: [{ at: T0, value: 5 }, { at: T0 + 12 * H, value: 8 }], refValue: 30,
    });
    expect(svg).toMatch(/<line x1="0" x2="384" y1="[\d.]+" y2="[\d.]+" stroke="var\(--text-muted\)" stroke-width="1" stroke-dasharray="4 3"\/>/);
    expect(svg).toMatch(/<polyline points="0\.0,[\d.]+ 192\.0,[\d.]+" fill="none" stroke="var\(--text-muted\)" stroke-width="1\.5" stroke-dasharray="4 3"\/>/);
    expect(svg).toContain('>30<');
    expect(svg).toContain('>5<');
    expect(svg.indexOf('stroke-dasharray')).toBeLessThan(svg.indexOf('stroke="var(--sev-green)"'));
    expect(lineChart([{ at: T0, value: 10 }, { at: T0 + H, value: 20 }], opts)).not.toContain('stroke-dasharray');
  });
});
