import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { OutageNow } from '../../types/index.ts';
import { roomDeptFeatures, roomNationalLevel } from './outages-room-map.ts';

const OUTLINE = new URL('../../../public/data/france-metro-outline.geojson', import.meta.url);
const depts: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: ['13', '60', '75'].map((code) => ({ type: 'Feature', properties: { code, nom: code }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } })),
};
const o = (over: Partial<OutageNow>): OutageNow => ({
  id: 'x', network: 'mobile', scope: 'departement', operator: null, dept: '13', label: null, level: 'jaune', since: null,
  national: false, measured: true, rung: 'mesuree', evidence: [], ...over,
});

describe('carte de la salle des pannes', () => {
  it('départements touchés au niveau le plus grave ; filtre réseau', () => {
    const fc = roomDeptFeatures([o({ id: 'a' }), o({ id: 'b', network: 'internet', level: 'orange' }), o({ id: 'c', dept: '60' })], null, depts);
    expect(fc.features.map((f) => [f.properties?.code, f.properties?.level])).toEqual([['13', 'orange'], ['60', 'jaune']]);
    expect(roomDeptFeatures([o({})], 'cloud', depts).features).toEqual([]);
  });
  it('contour national : panne nationale la plus grave, null sans panne nationale', () => {
    const nat = [o({ id: 'p', scope: 'operateur', dept: null, national: true, level: 'orange' }), o({ id: 'a', scope: 'national', dept: null, national: true, level: 'rouge' })];
    expect(roomNationalLevel(nat, null)).toBe('rouge');
    expect(roomNationalLevel(nat, 'internet')).toBeNull();
    expect(roomNationalLevel([o({})], null)).toBeNull();
  });
  it('fichier de contour : un seul polygone ou multipolygone, moins de 150 Ko', () => {
    expect(existsSync(OUTLINE)).toBe(true);
    expect(statSync(OUTLINE).size).toBeLessThan(150_000);
    const g = JSON.parse(readFileSync(OUTLINE, 'utf8')) as GeoJSON.FeatureCollection;
    expect(g.features).toHaveLength(1);
    expect(['Polygon', 'MultiPolygon']).toContain(g.features[0]?.geometry.type);
  });
});
