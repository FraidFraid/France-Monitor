// src/services/flood-zone-people.test.ts : habitants en zone inondable (carreaux Insee de 200 m).
import { describe, expect, it } from 'vitest';
import { parseCarreaux, roundPeople, zonePeople } from './flood-zone-people.ts';

// Trois carreaux : deux sous la zone (dont un sous deux zones superposées), un dehors.
const dept = parseCarreaux('30', {
  scale: 1e4, lon0: 43_000, lat0: 438_000, communes: ['30189', '30341'],
  cells: [[100, 100, 120, 15, 0], [120, 100, 80, 5, 1], [900, 900, 500, 40, 0]],
});
const square = (w: number, s: number, e: number, n: number): Array<[number, number]> => [[w, s], [e, s], [e, n], [w, n], [w, s]];

describe('habitants en zone inondable', () => {
  it('compte les carreaux dont le centre est en zone, une seule fois, par commune', () => {
    const zone = square(4.305, 43.805, 4.315, 43.815);
    const p = zonePeople([zone, zone], [dept]);
    expect(p.total).toBe(200);
    expect(p.over80).toBeCloseTo(2);
    expect(p.communes).toEqual([{ code: '30189', people: 120 }, { code: '30341', people: 80 }]);
  });
  it('aucune zone ou rien dessous : zéro', () => {
    expect(zonePeople([], [dept]).total).toBe(0);
    expect(zonePeople([square(5, 44, 5.1, 44.1)], [dept]).total).toBe(0);
  });
  it('arrondi : dizaine sous 1 000, centaine au-delà', () => {
    expect(roundPeople(87)).toBe(90);
    expect(roundPeople(12_345)).toBe(12_300);
  });
  it('fichier inattendu : erreur', () => {
    expect(() => parseCarreaux('30', { cells: 'x' })).toThrow();
  });
});
