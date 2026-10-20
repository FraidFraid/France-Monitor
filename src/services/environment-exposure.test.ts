// src/services/environment-exposure.test.ts : enjeux exposés aux phénomènes de l'onglet Environnement.
import { describe, expect, it } from 'vitest';
import type { EarthquakesResponse, EmsResponse, FiresResponse, FireFoyer, FloodsResponse, Quake, VigilanceResponse } from '../types/index.ts';
import {
  buildHazards, computeExposure, distanceKm, pointInRing, pointLineKm, quakeRadiusKm, type ExposureAsset,
} from './environment-exposure.ts';

const NOW = Date.parse('2026-10-20T10:00:00Z');
const asset = (over: Partial<ExposureAsset>): ExposureAsset => ({
  id: 'a', kind: 'seveso-haut', name: 'Site', commune: null, dept: '30', lon: 4.36, lat: 43.84, detail: null, url: null, ...over,
});

const vigilance = (depts: Array<{ code: string; color: 1 | 2 | 3 | 4; ph: '1' | '2' | '6' }>): VigilanceResponse => ({
  updateTime: '2026-10-20T06:00:00Z', textsUpdateTime: null, bulletins: [], history: { days: [], since: null }, readAt: '2026-10-20T09:55:00Z', errors: [],
  periods: [{
    echeance: 'J', begin: '2026-10-20T00:00:00Z', end: '2026-10-21T00:00:00Z', maxColor: 3, comment: null, greenDepartments: 90, coast: [], counts: [], perPhenomenon: [],
    departments: depts.map((d) => ({ code: d.code, name: d.code, color: d.color, phenomena: [{ id: d.ph, color: d.color, slots: [] }] })),
  }],
});

const floods = (path: Array<[number, number]>, level: 1 | 2 | 3 | 4 = 3): FloodsResponse => ({
  readAt: '2026-10-20T09:55:00Z', total: 337, counts: { vert: 330, jaune: 0, orange: 1, rouge: 0 }, stationsReadAt: null, stationsOmitted: 0, errors: [],
  sections: [{ id: 'MO12', name: 'Gardon', level, territory: { code: '21', name: null, url: '' }, path: [path], stations: [] }],
});

const foyer = (over: Partial<FireFoyer>): FireFoyer => ({
  id: 'f1', dept: '13', depts: ['13'], lat: 43.5, lon: 5.0, detections: 6, passes: 3, confirmed: true, recurrent: false,
  frpTotalMw: 150, frpMaxMw: 60, firstAt: '2026-10-20T02:00:00Z', lastAt: '2026-10-20T09:00:00Z', satellites: ['NOAA-20'],
  confidenceMax: 'haute', nightDetections: 2, ...over,
});
const fires = (list: FireFoyer[]): FiresResponse => ({
  readAt: null, lastAcquisitionAt: null, sources: [], detections: [], abroadCount: 0, abroad: [], foyers: list,
  daily: { days: [], since: null }, nextPasses: [], forestDanger: null, errors: [],
});

const quake = (over: Partial<Quake>): Quake => ({
  id: 'q1', at: '2026-10-20T08:00:00Z', lat: 43.0, lon: 0.0, depthKm: 8, magnitude: 4.5, magType: 'MLv', type: 'earthquake',
  description: '', status: 'revu', url: null, dept: '65', distanceKm: 0, inFrance: true, source: 'BCSF-RéNaSS', ...over,
});
const quakes = (list: Quake[]): EarthquakesResponse => ({ readAt: null, source: 'BCSF-RéNaSS', quakes: list, nonSeismic: 0, errors: [] });

const ems = (ring: Array<[number, number]>): EmsResponse => ({
  readAt: '2026-10-20T09:00:00Z', recent: [], elsewhere: { count: 0, countries: [] }, errors: [],
  active: [{
    code: 'EMSR900', category: 'inondation', name: 'Flood', place: 'Gard', territory: 'France (Hexagone et Corse)',
    activationTime: '2026-10-20T05:00:00Z', eventTime: null, closed: false, gdacsId: null, products: 2, url: '', activator: 'COGIC',
    population: null, zones: [{ name: 'AOI01', ring }], lon: 4.3, lat: 43.9,
  }],
});

const none = { vigilance: null, floods: null, fires: null, earthquakes: null, ems: null, now: NOW };

describe('géométrie', () => {
  it('distances en km plausibles (Nîmes · Avignon ≈ 38 km)', () => {
    expect(distanceKm(4.36, 43.84, 4.81, 43.95)).toBeGreaterThan(35);
    expect(distanceKm(4.36, 43.84, 4.81, 43.95)).toBeLessThan(40);
  });
  it('distance à une ligne : sur le segment, et au plus proche des extrémités', () => {
    expect(pointLineKm(4.0, 44.0, [[3.9, 44.0], [4.1, 44.0]])).toBeLessThan(0.01);
    expect(pointLineKm(4.0, 44.01, [[3.9, 44.0], [4.1, 44.0]])).toBeCloseTo(1.11, 1);
  });
  it('point dans un anneau', () => {
    const ring: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    expect(pointInRing(0.5, 0.5, ring)).toBe(true);
    expect(pointInRing(1.5, 0.5, ring)).toBe(false);
  });
  it('rayon d’un séisme : 10 km à M4, 30 km à M5, plafonné à 50 km', () => {
    expect(quakeRadiusKm(4)).toBe(10);
    expect(quakeRadiusKm(5)).toBe(30);
    expect(quakeRadiusKm(7)).toBe(50);
  });
});

describe('buildHazards', () => {
  it('vigilance : orange et rouge seulement, regroupée par phénomène et niveau', () => {
    const h = buildHazards({ ...none, vigilance: vigilance([{ code: '30', color: 3, ph: '2' }, { code: '34', color: 3, ph: '2' }, { code: '13', color: 2, ph: '1' }]) });
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ kind: 'vigilance', level: 'orange', label: 'Vigilance orange pluie-inondation', depts: ['30', '34'] });
  });
  it('feux : foyers orange et rouges seulement, jamais une source récurrente', () => {
    const h = buildHazards({ ...none, fires: fires([foyer({}), foyer({ id: 'f2', recurrent: true }), foyer({ id: 'f3', confirmed: false, passes: 1 })]) });
    expect(h.map((x) => x.id)).toEqual(['feu-f1']);
    expect(h[0].level).toBe('rouge');
  });
  it('séismes : en France, M4 et plus, 72 h ; tri du plus grave au moins grave', () => {
    const h = buildHazards({ ...none, earthquakes: quakes([quake({}), quake({ id: 'q2', magnitude: 3.2 }), quake({ id: 'q3', inFrance: false }), quake({ id: 'q4', at: '2026-10-15T00:00:00Z' }), quake({ id: 'q5', magnitude: 5.1 })]) });
    expect(h.map((x) => x.id)).toEqual(['seisme-q5', 'seisme-q1']);
  });
});

describe('computeExposure', () => {
  it('crue : enjeu à moins de 2 km du tronçon, avec sa distance ; au-delà, rien', () => {
    const hz = buildHazards({ ...none, floods: floods([[4.0, 44.0], [4.2, 44.0]]) });
    const near = asset({ id: 'near', lon: 4.1, lat: 44.01 });
    const far = asset({ id: 'far', lon: 4.1, lat: 44.1 });
    const r = computeExposure(hz, [near, far]);
    expect(r.nearby.map((e) => e.asset.id)).toEqual(['near']);
    expect(r.nearby[0].distanceKm).toBeCloseTo(1.1, 1);
    expect(r.nearby[0].hazard.label).toBe('Crue orange · Gardon');
  });
  it('crue jaune : enjeux lourds seulement (pas d’EHPAD ni de Seveso seuil bas)', () => {
    const hz = buildHazards({ ...none, floods: floods([[4.0, 44.0], [4.2, 44.0]], 2) });
    const r = computeExposure(hz, [asset({ id: 'e', kind: 'ehpad', lon: 4.1, lat: 44.0 }), asset({ id: 'b', kind: 'seveso-bas', lon: 4.1, lat: 44.0 }), asset({ id: 'h', kind: 'hopital', lon: 4.1, lat: 44.0 })]);
    expect(r.nearby.map((e) => e.asset.id)).toEqual(['h']);
  });
  it('un enjeu n’apparaît qu’une fois, sous le phénomène le plus grave', () => {
    const hz = buildHazards({ ...none, floods: floods([[5.0, 43.5], [5.1, 43.5]], 2), fires: fires([foyer({})]) });
    const r = computeExposure(hz, [asset({ id: 's', lon: 5.01, lat: 43.5 })]);
    expect(r.nearby).toHaveLength(1);
    expect(r.nearby[0].hazard.kind).toBe('feu');
  });
  it('zone Copernicus EMS : enjeu dedans à distance 0', () => {
    const hz = buildHazards({ ...none, ems: ems([[4.0, 43.8], [4.5, 43.8], [4.5, 44.0], [4.0, 44.0], [4.0, 43.8]]) });
    const r = computeExposure(hz, [asset({ lon: 4.36, lat: 43.84 })]);
    expect(r.nearby[0]).toMatchObject({ distanceKm: 0 });
  });
  it('séisme : pas d’EHPAD ; centrale avant Seveso à niveau égal', () => {
    const hz = buildHazards({ ...none, earthquakes: quakes([quake({ lon: 0, lat: 43 })]) });
    const r = computeExposure(hz, [
      asset({ id: 'e', kind: 'ehpad', lon: 0.01, lat: 43 }), asset({ id: 's', lon: 0.02, lat: 43 }), asset({ id: 'n', kind: 'nucleaire', lon: 0.05, lat: 43 }),
    ]);
    expect(r.nearby.map((e) => e.asset.id)).toEqual(['n', 's']);
  });
  it('vigilance départementale : comptes par type selon le phénomène, centrales et Seveso seuil haut nommés', () => {
    const hz = buildHazards({ ...none, vigilance: vigilance([{ code: '30', color: 3, ph: '6' }]) });
    const r = computeExposure(hz, [
      asset({ id: 'h1', kind: 'hopital', name: 'CHU' }), asset({ id: 'e1', kind: 'ehpad' }), asset({ id: 'e2', kind: 'ehpad' }),
      asset({ id: 's1', kind: 'seveso-haut' }), asset({ id: 'x', kind: 'hopital', dept: '13' }),
    ]);
    expect(r.nearby).toEqual([]);
    expect(r.departmental).toHaveLength(1);
    // Canicule : hôpitaux et EHPAD, pas les Seveso.
    expect(r.departmental[0].counts).toEqual({ hopital: 1, ehpad: 2 });
    expect(r.departmental[0].named).toEqual([]);
  });
  it('rien d’actif : rien d’exposé', () => {
    expect(computeExposure(buildHazards(none), [asset({})])).toEqual({ hazards: [], nearby: [], departmental: [] });
  });
});
