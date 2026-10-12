// src/utils/market-sparkline.test.ts : courbes des marchés et de la stabilité financière (refonte du 12/10/2026) : trait net et lissé
// sans dépassement, aire en dégradé, pastille du dernier point, ligne de référence, vrais trous, infobulle plus bas / plus haut.
import { describe, it, expect } from 'vitest';
import { buildMarketSparkline } from './market-sparkline.ts';

/** Nombres d'un attribut `d` (coordonnées x, y alternées). */
const coords = (d: string): number[] => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
const attr = (svg: string, cls: string, name: string): string[] =>
  [...svg.matchAll(new RegExp(`<[a-z]+ class="${cls}"[^>]*?\\s${name}="([^"]*)"`, 'g'))].map((m) => m[1] ?? '');

describe('buildMarketSparkline', () => {
  it('moins de deux points : rien', () => {
    expect(buildMarketSparkline([], 'neutral')).toBe('');
    expect(buildMarketSparkline([1], 'neutral')).toBe('');
    expect(buildMarketSparkline(undefined, 'neutral')).toBe('');
  });

  it('couleur : bleu-gris neutre par défaut, jaune pour un mouvement exceptionnel, couleur imposée sinon', () => {
    expect(attr(buildMarketSparkline([1, 2, 3], 'neutral'), 'spark-line', 'stroke')).toEqual(['var(--spark-neutral)']);
    expect(attr(buildMarketSparkline([3, 2, 1], 'alert'), 'spark-line', 'stroke')).toEqual(['var(--sev-yellow)']);
    expect(attr(buildMarketSparkline([1, 2], 'neutral', { color: 'var(--sev-red)' }), 'spark-line', 'stroke')).toEqual(['var(--sev-red)']);
  });

  it('trait fin qui ne se déforme pas quand le SVG s’étire', () => {
    const svg = buildMarketSparkline([1, 3, 2], 'neutral');
    expect(attr(svg, 'spark-line', 'vector-effect')).toEqual(['non-scaling-stroke']);
    expect(attr(svg, 'spark-line', 'stroke-width')).toEqual(['1.5']);
  });

  it('lissage monotone : aucune coordonnée hors de la zone de tracé (pas de dépassement)', () => {
    const svg = buildMarketSparkline([1, 10, 1, 10, 1, 9.9, 10, 1], 'neutral');
    const d = attr(svg, 'spark-line', 'd')[0] ?? '';
    expect(d).toContain('C');
    const ys = coords(d).filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(3 - 1e-9);
    expect(Math.max(...ys)).toBeLessThanOrEqual(29 + 1e-9);
  });

  it('aire en dégradé, identifiant unique par courbe', () => {
    const a = buildMarketSparkline([1, 2], 'neutral');
    const b = buildMarketSparkline([1, 2], 'neutral');
    const id = (svg: string): string => /<linearGradient id="([^"]+)"/.exec(svg)?.[1] ?? '';
    expect(id(a)).not.toBe('');
    expect(id(a)).not.toBe(id(b));
    expect(attr(a, 'spark-area', 'fill')).toEqual([`url(#${id(a)})`]);
  });

  it('pastille sur le dernier point', () => {
    const svg = buildMarketSparkline([1, 2, 4], 'neutral');
    const [x, y] = coords(attr(svg, 'spark-dot', 'd')[0] ?? '');
    expect(x).toBe(120);
    expect(y).toBe(3);
  });

  it('ligne de référence pointillée, comprise dans l’échelle', () => {
    const svg = buildMarketSparkline([10, 11, 12], 'neutral', { reference: 8 });
    expect(attr(svg, 'spark-ref', 'stroke-dasharray')).toEqual(['3 3']);
    expect(attr(svg, 'spark-ref', 'y1')).toEqual(['29']);
    expect(buildMarketSparkline([10, 11], 'neutral')).not.toContain('spark-ref');
  });

  it('dates : abscisse par date, trou au-delà de 4 jours (deux tracés, deux aires)', () => {
    const svg = buildMarketSparkline([1, 2, 3, 4], 'neutral', { dates: ['2026-09-01', '2026-09-02', '2026-09-20', '2026-09-21'] });
    const d = attr(svg, 'spark-line', 'd')[0] ?? '';
    expect(d.match(/M/g)).toHaveLength(2);
    expect(attr(svg, 'spark-area', 'd')[0]?.match(/M/g)).toHaveLength(2);
    // Week-end (vendredi → lundi) : pas de trou.
    const weekend = buildMarketSparkline([1, 2], 'neutral', { dates: ['2026-10-09', '2026-10-12'] });
    expect(attr(weekend, 'spark-line', 'd')[0]?.match(/M/g)).toHaveLength(1);
  });

  it('infobulle : période, plus bas et plus haut au format donné', () => {
    const svg = buildMarketSparkline([0.012, 0.05, 0.03], 'neutral', { label: '90 jours', format: (v) => v.toFixed(3).replace('.', ',') });
    expect(svg).toContain('<title>90 jours · plus bas 0,012 · plus haut 0,050</title>');
  });
});
