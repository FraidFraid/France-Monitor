// src/components/layer-panel/chart.test.ts
import { describe, expect, it } from 'vitest';
import { bandTimeline, dotChart, lineChart, multiLineChart, stackedDayBars } from './chart.ts';

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

// ─── Lot Environnement (spec 2026-10-04 E5) ───

describe('trou de mesure (gapMs)', () => {
  it('un écart au-delà de gapMs coupe le tracé ; un point isolé reste un point', () => {
    const pts = [{ at: T0, value: 1 }, { at: T0 + H / 4, value: 2 }, { at: T0 + 3 * H, value: 3 }, { at: T0 + 6 * H, value: 4 }, { at: T0 + 6.25 * H, value: 5 }];
    const svg = lineChart(pts, { ...opts, gapMs: H / 2 });
    expect((svg.match(/<polyline /g) ?? []).length).toBe(2);
    expect(svg).toMatch(/<circle cx="48\.0" cy="[\d.]+" r="1\.5" fill="var\(--sev-green\)"\/>/);
    expect((lineChart(pts, opts).match(/<polyline /g) ?? []).length).toBe(1);
  });
});

describe('plusieurs séries (départements par couleur sur 30 jours)', () => {
  const D = 24 * H;
  const serie = (stroke: string, label: string, values: number[]) => ({ stroke, label, points: values.map((value, i) => ({ at: T0 + i * D, value })) });
  it('échelle commune depuis 0, une polyligne par série, titres échappés, rien sans deux points', () => {
    const svg = multiLineChart([serie('var(--sev-yellow)', 'jaune <b>', [5, 7, 6]), serie('var(--sev-orange)', 'orange', [2, 0, 1])], {
      label: 'Départements en vigilance', from: T0, to: T0 + 2 * D, value: (v) => `${v}`, tick: () => 'j',
    });
    expect((svg.match(/<polyline /g) ?? []).length).toBe(2);
    expect(svg).toContain('stroke="var(--sev-orange)"');
    expect(svg).toContain('<title>jaune &lt;b&gt;</title>');
    expect(svg).toContain('>7<');
    expect(svg).toContain('>0<');
    expect(multiLineChart([serie('var(--sev-red)', 'rouge', [1])], { label: 'x', from: T0, to: T0 + D, value: String, tick: String })).toBe('');
  });
});

describe('frise horaire (vigilance J)', () => {
  const from = Date.parse('2026-10-04T08:00:00Z');
  const to = Date.parse('2026-10-04T22:00:00Z');
  it('une bande par phénomène, un rectangle coloré par créneau, repère « maintenant »', () => {
    const svg = bandTimeline([
      { label: 'pluie-inondation', segments: [{ from, to: from + 6 * H, level: 'orange' }, { from: from + 6 * H, to: from + 10 * H, level: 'jaune' }] },
      { label: 'orages', segments: [{ from, to: from + 10 * H, level: 'jaune' }] },
    ], { label: 'Frise <Aude>', from, to, tick: () => '10:00', nowAt: from + 10 * 60_000 });
    expect(svg).toContain('aria-label="Frise &lt;Aude&gt;"');
    expect((svg.match(/data-level="orange"/g) ?? []).length).toBe(1);
    expect((svg.match(/data-level="jaune"/g) ?? []).length).toBe(2);
    expect(svg).toContain('fill="var(--sev-orange)"');
    expect(svg).toContain('stroke="var(--v2-brand)"');
    expect(svg).toContain('>pluie-inondation<');
    expect(bandTimeline([], { label: 'x', from, to, tick: String })).toBe('');
  });
});

describe('points colorés (magnitude selon l’heure)', () => {
  it('un cercle par point dans la fenêtre, couleur donnée, titre échappé', () => {
    const svg = dotChart([
      { at: T0 + H, value: 2.1, color: 'var(--sev-yellow)', title: 'M 2,1 <Gap>' },
      { at: T0 + 2 * H, value: 4.3, color: 'var(--sev-orange)' },
      { at: T0 + 99 * H, value: 5, color: 'var(--sev-red)' },
    ], { label: 'Séismes', from: T0, to: T0 + 24 * H, value: (v) => v.toFixed(1), tick: () => 't', yMin: 0 });
    expect((svg.match(/<circle /g) ?? []).length).toBe(2);
    expect(svg).toContain('<title>M 2,1 &lt;Gap&gt;</title>');
    expect(svg).not.toContain('var(--sev-red)');
  });
});

describe('barres empilées par jour', () => {
  it('une pile par jour, parts colorées, titre « jour · part : valeur », jamais de barre pour zéro', () => {
    const d = (day: string): number => Date.parse(`${day}T12:00:00Z`);
    const svg = stackedDayBars([
      { day: d('2026-10-03'), parts: [{ value: 86, color: 'var(--sev-green)', label: 'faible' }, { value: 10, color: 'var(--sev-yellow)', label: 'modéré' }] },
      { day: d('2026-10-04'), parts: [{ value: 0, color: 'var(--sev-orange)', label: 'élevé' }, { value: 96, color: 'var(--sev-green)', label: 'faible' }] },
    ], { label: 'Météo des forêts', value: (v) => `${v}`, tick: (ms) => new Date(ms).toISOString().slice(5, 10) });
    expect((svg.match(/<rect /g) ?? []).length).toBe(3);
    expect(svg).toContain('<title>10-03 · modéré : 10</title>');
    expect(svg).not.toContain('var(--sev-orange)');
    expect(stackedDayBars([], { label: 'x', value: String, tick: String })).toBe('');
  });
});

describe('barres empilées et points : bords (fix tâche 10)', () => {
  const d = Date.parse('2026-10-04T12:00:00Z');
  const o = { label: 'Vigilance', value: (v: number) => `${v}`, tick: () => 'j' };
  it('un seul jour : barre plafonnée et centrée, libellé 0 sur l’axe bas', () => {
    const svg = stackedDayBars([{ day: d, parts: [{ value: 5, color: 'var(--sev-yellow)', label: 'jaune' }] }], o);
    expect(svg).toMatch(/<rect x="172\.0"[^>]*width="40\.0"/);
    expect(svg).toContain('>0<');
  });
  it('tout à zéro : le titre le dit', () => {
    const svg = stackedDayBars([{ day: d, parts: [{ value: 0, color: 'var(--sev-yellow)', label: 'jaune' }] }], { ...o, emptyNote: 'aucun département en vigilance sur la période' });
    expect(svg).toContain('aria-label="Vigilance : aucun département en vigilance sur la période"');
    expect(svg).not.toContain('<rect ');
  });
  it('point sous yMin : l’axe s’étend pour l’inclure', () => {
    const svg = dotChart([{ at: T0 + H, value: 2, color: 'var(--sev-green)' }, { at: T0 + 2 * H, value: 8, color: 'var(--sev-red)' }],
      { label: 'x', from: T0, to: T0 + 24 * H, value: (v) => `${v}`, tick: () => 't', yMin: 3 });
    expect(svg).toContain('>2<');
    expect(svg).not.toContain('>3<');
  });
});
