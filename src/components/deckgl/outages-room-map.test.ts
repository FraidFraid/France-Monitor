import { describe, expect, it } from 'vitest';
import type { OutageNow } from '../../types/index.ts';
import { roomDeptFeatures, roomServiceFeatures } from './outages-room-map.ts';

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
  it('services exposés : un point par service, lettre du type, niveau de la panne ; filtre réseau ; un service vu par deux pannes : une fois, au niveau le plus grave', () => {
    const exposed = (pts: Array<{ type: 'police' | 'hopital'; name: string; lon: number; lat: number }>) => ({ basis: 'communes' as const, total: pts.length, byType: {}, sample: [], points: pts });
    const a = o({ id: 'a', level: 'jaune', exposed: exposed([{ type: 'police', name: 'Commissariat - Auch', lon: 0.58, lat: 43.64 }]) });
    const b = o({ id: 'b', network: 'internet', level: 'rouge', exposed: exposed([{ type: 'police', name: 'Commissariat - Auch', lon: 0.58, lat: 43.64 }, { type: 'hopital', name: 'CH Auch', lon: 0.6, lat: 43.64 }]) });
    const fc = roomServiceFeatures([a, b], null);
    expect(fc.features.map((f) => [f.properties?.letter, f.properties?.level, f.properties?.name])).toEqual([['C', 'rouge', 'Commissariat - Auch'], ['H', 'rouge', 'CH Auch']]);
    expect(roomServiceFeatures([a, b], 'mobile').features.map((f) => f.properties?.level)).toEqual(['jaune']);
    expect(roomServiceFeatures([o({})], null).features).toEqual([]);
  });
});

