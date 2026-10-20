// tests/s2-passes.test.ts : passages Sentinel-2 au-dessus d'une zone (20/10/2026), sur la recherche STAC réelle du Vidourle
// (9 au 16/10/2026) : la tuile 31TEJ est vue en entier à 10 h 48 et seulement en bordure de fauchée à 10 h 38.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MIN_PASS_COVERAGE, groupPasses, inFootprint, passTimeRange } from '../api/_lib/s2-passes.js';

const fc = JSON.parse(readFileSync(new URL('./fixtures/environment/stac-s2-vidourle-2026-10.json', import.meta.url), 'utf8')) as { features: unknown[] };
const BBOX: [number, number, number, number] = [3.95, 43.68, 4.15, 43.80];

describe('passages Sentinel-2', () => {
  it('bordure de fauchée (10 h 38) : 1 % de la zone, écartée ; passage de 10 h 48 : zone entière', () => {
    const passes = groupPasses(fc.features as never, BBOX);
    const byDay = Object.fromEntries(passes.map((p) => [p.datetime.slice(0, 10), p]));
    expect(byDay['2026-10-13'].coverage).toBe(1);
    expect(byDay['2026-10-12'].coverage).toBeLessThan(0.05);
    expect(passes.filter((p) => p.coverage >= MIN_PASS_COVERAGE).map((p) => p.datetime.slice(0, 10))).toEqual(['2026-10-15', '2026-10-13']);
  });
  it('tuiles d’un même passage regroupées ; nébulosité pondérée par la part de zone de chaque tuile', () => {
    const tile = (id: string, w: number, e: number, cc: number) => ({
      id, geometry: { type: 'Polygon', coordinates: [[[w, 43], [e, 43], [e, 44], [w, 44], [w, 43]]] },
      properties: { datetime: '2026-10-13T10:48:00Z', platform: 'sentinel-2c', 'eo:cloud_cover': cc },
    });
    const [p] = groupPasses([tile('A', 3.9, 4.0, 10), tile('B', 4.0, 4.2, 40)], [3.95, 43.5, 4.15, 43.6]);
    expect(p.coverage).toBe(1);
    // A couvre le quart ouest de la zone, B les trois quarts est : 0,25 × 10 + 0,75 × 40.
    expect(p.cloudCover).toBe(32.5);
    expect(p.id).toBe('B');
  });
  it('emprise : trous respectés, géométrie illisible = hors emprise', () => {
    const donut = { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]] };
    expect(inFootprint(0.5, 0.5, donut)).toBe(true);
    expect(inFootprint(2, 2, donut)).toBe(false);
    expect(inFootprint(2, 2, null)).toBe(false);
  });
  it('fenêtre de traitement : le seul passage, à 20 min près', () => {
    expect(passTimeRange('2026-10-13T10:48:00Z')).toEqual({ from: '2026-10-13T10:28:00.000Z', to: '2026-10-13T11:08:00.000Z' });
    expect(() => passTimeRange('x')).toThrow();
  });
});
