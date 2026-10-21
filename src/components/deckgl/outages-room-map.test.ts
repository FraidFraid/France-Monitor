import { describe, expect, it } from 'vitest';
import type { OutageNow } from '../../types/index.ts';
import { roomDeptFeatures } from './outages-room-map.ts';

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
});
