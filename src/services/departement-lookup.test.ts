import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildDepartementIndex } from './departement-lookup.ts';

const square = (x0: number, y0: number, x1: number, y1: number): number[][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];

describe('buildDepartementIndex (spec 2026-09-29 § 6)', () => {
  const index = buildDepartementIndex([
    { properties: { code: '01', nom: 'Ain' }, geometry: { type: 'Polygon', coordinates: [square(4, 45, 5, 46)] } },
    { properties: { code: '69', nom: 'Rhône' }, geometry: { type: 'MultiPolygon', coordinates: [[square(6, 45, 8, 47), square(6.5, 45.5, 7, 46)]] } },
  ]);

  it('trouve le département qui contient le point', () => {
    expect(index.at(4.5, 45.5)).toEqual({ code: '01', nom: 'Ain' });
    expect(index.at(7.5, 46.5)).toEqual({ code: '69', nom: 'Rhône' });
  });

  it('hors de tout département, ou dans un trou : null', () => {
    expect(index.at(0, 0)).toBeNull();
    expect(index.at(6.7, 45.7)).toBeNull();
  });

  it('nom d’un code', () => {
    expect(index.nameOf('01')).toBe('Ain');
    expect(index.nameOf('99')).toBeNull();
  });

  it('sur la géométrie réelle : Lyon, Paris, et La Réunion hors des 96 départements métropolitains', () => {
    const file = path.resolve(import.meta.dirname, '../../public/data/departements.geojson');
    const real = buildDepartementIndex(JSON.parse(readFileSync(file, 'utf8')).features);
    expect(real.at(4.84, 45.76)?.nom).toBe('Rhône');
    expect(real.at(2.35, 48.86)?.nom).toBe('Paris');
    expect(real.at(55.45, -20.9)).toBeNull();
  });
});
