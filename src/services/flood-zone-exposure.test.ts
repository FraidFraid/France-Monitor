// src/services/flood-zone-exposure.test.ts : zones inondables cartographiées branchées sur l'exposition, la population et la carte.
import { describe, expect, it } from 'vitest';
import type { FloodZone } from '../types/index.ts';
import { exposureFeatures, floodZoneFeatures } from '../components/deckgl/exposure-map.ts';
import { computeExposure, type ExposureAsset, type Hazard } from './environment-exposure.ts';
import { hazardPopulation } from './exposure-population.ts';
import { floodCells, sectionFloodZones } from './flood-zone-geo.ts';

const square = (lon: number, lat: number, d: number): Array<[number, number]> =>
  [[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]];
const line: Array<[number, number]> = [[4.0, 43.7], [4.2, 43.7]];
const crue = (over: Partial<Hazard>): Hazard => ({
  id: 'crue-1', kind: 'crue', label: 'Crue orange · Vidourle', level: 'orange', depts: [], circles: [], lines: [line], bufferKm: 2, rings: [],
  kinds: ['nucleaire', 'seveso-haut', 'hopital', 'seveso-bas', 'ehpad'], since: null, ...over,
});
const asset = (id: string, lon: number, lat: number): ExposureAsset => ({
  id, kind: 'ehpad', name: id, commune: null, dept: '30', lon, lat, detail: null, url: null,
});

describe('zones inondables et exposition', () => {
  it('cases de 0,05° traversées par le tracé, sans doublon, plafonnées', () => {
    expect(floodCells([line], 40).map((c) => c[0])).toEqual([4, 4.05, 4.1, 4.15, 4.2]);
    expect(floodCells([line], 1)).toHaveLength(1);
  });
  it('zones du tronçon : crue fréquente ou moyenne, proches du tracé, sans doublon', () => {
    const zones: FloodZone[] = [
      { id: 'a', scenario: 'moyen', ring: square(4.1, 43.7, 0.005) },
      { id: 'a', scenario: 'moyen', ring: square(4.1, 43.7, 0.005) },
      { id: 'b', scenario: 'extreme', ring: square(4.1, 43.7, 0.005) },
      { id: 'c', scenario: 'frequent', ring: square(4.1, 44.2, 0.005) },
    ];
    expect(sectionFloodZones(zones, [line]).map((z) => z.id)).toEqual(['a']);
  });
  it('là où la zone est cartographiée, l’appartenance remplace la distance ; ailleurs, le tampon de 2 km reste', () => {
    // Deux zones de part et d'autre d'une butte : entre elles, territoire cartographié mais hors zone, sur le tracé même.
    const h = crue({ floodZones: [square(4.03, 43.7, 0.01), square(4.07, 43.7, 0.01)] });
    const inside = asset('dedans', 4.03, 43.705);
    const outsideMapped = asset('hors-zone', 4.05, 43.7);
    const unmapped = asset('non-cartographie', 4.18, 43.71);
    const r = computeExposure([h], [inside, outsideMapped, unmapped]);
    const byId = new Map(r.nearby.map((e) => [e.asset.id, e]));
    expect(byId.get('dedans')?.inFloodZone).toBe(true);
    expect(byId.has('hors-zone')).toBe(false);
    expect(byId.get('non-cartographie')?.inFloodZone).toBeUndefined();
    // Sans zones : la règle des 2 km s'applique partout.
    expect(computeExposure([crue({})], [outsideMapped]).nearby).toHaveLength(1);
  });
  it('population : communes riveraines de la zone ; carte : zone dessinée et infobulle « zone inondable »', () => {
    const h = crue({ floodZones: [square(4.05, 43.7, 0.02)] });
    const communes = [
      { code: '30001', name: 'Riveraine', dept: '30', pop: 1200, lon: 4.05, lat: 43.71 },
      { code: '30002', name: 'Loin', dept: '30', pop: 9000, lon: 4.19, lat: 43.72 },
    ];
    const p = hazardPopulation(h, communes, h.floodZones);
    expect(p.method).toBe('zone-inondable');
    expect(p.communes.map((c) => c.name)).toEqual(['Riveraine']);
    const fc = exposureFeatures(computeExposure([h], [asset('dedans', 4.05, 43.715)]));
    expect(floodZoneFeatures(h.floodZones ?? []).features).toHaveLength(1);
    expect(String(fc.features.at(-1)?.properties?.['body'])).toContain('dans la zone inondable cartographiée');
  });
});
