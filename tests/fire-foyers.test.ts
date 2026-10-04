// Récurrence et foyers (spec 2026-10-04 environnement § 2.4, E3 ; amendements 1 et 7 du contrôleur) : détections réelles du 03
// et du 04/10/2026 (Fos-sur-Mer vue par Suomi NPP, NOAA-20 et NOAA-21 ; Yonne, Nièvre, limite Allier et Cher ; Dillingen
// en Sarre et Esch au Luxembourg, hors de France ; aciérie de Dunkerque sur 24 h), historique de 10 jours construit ici.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeRows, parseFirmsCsv } from '../api/_lib/firms.js';
import {
  CELL_LAT_DEG, CELL_LON_DEG, MAJOR_FOYER_MW, OLD_FOOTPRINT_DAYS, cellOf, clusterFoyers, isRecurrent, lastDays, mergeDayCells, neighbourCells,
  oldFootprintCells, pruneDays, recurrentCells, splitByDepartement,
} from '../api/_lib/fire-foyers.js';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/environment/${name}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-04T10:10:00+02:00');
const TODAY = '2026-10-04';

/** Départements des points réels (point dans polygone de public/data/departements.geojson, tâche 3) ; le reste hors de France. */
const DEPT_OF = new Map<number, string>([
  [43.43311, '13'], [43.44536, '13'], [43.43602, '13'], [43.43477, '13'], [43.44396, '13'], [43.43877, '13'], [43.4337, '13'], [43.44498, '13'],
  [47.60958, '89'], [46.83337, '58'], [46.8301, '58'], [46.67444, '18'], [46.67775, '03'],
]);
const deptOf = (lat: number): string | null => DEPT_OF.get(lat) ?? null;

type Day = { cells: string[]; france: number; recurrent: number };
const FOS = cellOf(43.439, 4.894);

/** Historique de 10 jours finissant aujourd'hui : `cell` présente les `present` derniers jours. */
function history(cell: string, present: number): Record<string, Day> {
  return Object.fromEntries(lastDays(TODAY, 10).map((d, i) => [d, { cells: i >= 10 - present ? [cell] : [], france: 0, recurrent: 0 }]));
}

/** Aciérie de Dunkerque, relevé réel des 24 h précédant le 04/10/2026 à 10 h 10 : 50 détections VIIRS et 3 MODIS (dont une à 100). */
function dunkerque() {
  return [
    ...normalizeRows(parseFirmsCsv(fx('firms-dunkerque-viirs-24h.csv')), 'VIIRS_SNPP_NRT'),
    ...normalizeRows(parseFirmsCsv(fx('firms-dunkerque-modis-24h.csv')), 'MODIS_NRT'),
  ].map((d) => ({ ...d, dept: '59' }));
}

function detections() {
  const all = normalizeRows(parseFirmsCsv(fx('firms-france-extrait.csv')), 'VIIRS_SNPP_NRT');
  return splitByDepartement(all, deptOf);
}

function det(over: Partial<{ id: string; lat: number; lon: number; acquiredAt: string; satellite: string; confidence: string; confidenceRaw: string; frpMw: number }>) {
  return {
    id: 'x', lat: 44.5, lon: -0.9, acquiredAt: '2026-10-04T02:00:00.000Z', satellite: 'NOAA-20', sensor: 'VIIRS', confidence: 'nominale',
    confidenceRaw: 'n', frpMw: 3, daynight: 'N', dept: '33', ...over,
  };
}

describe('grille de récurrence', () => {
  it('case d’environ 1 km et voisinage 3 × 3', () => {
    expect([CELL_LAT_DEG, CELL_LON_DEG]).toEqual([0.009, 0.0131]);
    expect(cellOf(43.43311, 4.88785)).toBe('4825:373');
    expect(FOS).toBe('4826:373');
    expect(neighbourCells('4825:373')).toHaveLength(9);
    expect(neighbourCells('4825:373')).toEqual(expect.arrayContaining(['4824:372', '4826:374', '4825:373']));
  });
  it('récurrent à 5 jours sur 10 (jour courant compris), pas à 4', () => {
    expect(recurrentCells(history(FOS, 5), TODAY).has('4825:373')).toBe(true);
    expect(isRecurrent(43.43311, 4.88785, history(FOS, 5), TODAY)).toBe(true);
    expect(isRecurrent(43.43311, 4.88785, history(FOS, 4), TODAY)).toBe(false);
  });
  it('un jour de plus de 10 jours ne compte pas', () => {
    const days = { ...history(FOS, 4), '2026-09-24': { cells: [FOS], france: 1, recurrent: 0 } };
    expect(lastDays(TODAY, 10)[0]).toBe('2026-09-25');
    expect(isRecurrent(43.43311, 4.88785, days, TODAY)).toBe(false);
  });
  it('empreintes ajoutées par jour couvert, jours vides gardés ; 11 jours conservés', () => {
    const { france } = detections();
    const days = mergeDayCells({ '2026-09-23': { cells: ['1:1'], france: 2, recurrent: 0 } }, france, ['2026-10-03', '2026-10-04', '2026-10-02']);
    expect(days['2026-10-02']).toEqual({ cells: [], france: 0, recurrent: 0 });
    expect(days['2026-10-04'].cells).toContain('4825:373');
    expect(days['2026-10-03'].cells).toHaveLength(3);
    expect(Object.keys(pruneDays(days, TODAY, 11)).sort()).toEqual(['2026-10-02', '2026-10-03', '2026-10-04']);
  });
});

describe('rattachement par département', () => {
  it('France par département, Sarre (Dillingen) et Luxembourg (Esch) hors de France', () => {
    const { france, abroad } = detections();
    expect(france).toHaveLength(13);
    expect(abroad).toHaveLength(4);
    expect(abroad[0]).toEqual({ lat: 49.35548, lon: 6.74886, acquiredAt: '2026-10-04T01:20:00.000Z', frpMw: 2.88, satellite: 'Suomi NPP' });
  });
});

describe('foyers (24 h)', () => {
  it('Fos-sur-Mer : un foyer confirmé par 4 passages de 3 satellites ; trois détections isolées', () => {
    const { foyers, detections: out } = clusterFoyers(detections().france, {}, NOW);
    expect(foyers.map((f) => [f.dept, f.detections, f.passes, f.confirmed, f.recurrent, f.frpTotalMw])).toEqual([
      ['13', 8, 4, true, false, 21.12],
      ['89', 1, 1, false, false, 11.67],
      ['58', 2, 1, false, false, 9.49],
      ['03', 2, 1, false, false, 9.2],
    ]);
    const fos = foyers[0];
    expect(fos).toMatchObject({
      id: '43.4337_4.8919_2026-10-04_0043_NOAA-21', depts: ['13'], frpMaxMw: 4.15, firstAt: '2026-10-04T00:43:00.000Z',
      lastAt: '2026-10-04T03:00:00.000Z', satellites: ['Suomi NPP', 'NOAA-20', 'NOAA-21'], confidenceMax: 'nominale', nightDetections: 8,
    });
    expect(fos.lat).toBeCloseTo(43.43917, 4);
    expect(fos.lon).toBeCloseTo(4.89352, 4);
    expect(foyers[3]).toMatchObject({ depts: ['03', '18'], dept: '03' });
    expect(out.filter((d) => d.foyerId === fos.id)).toHaveLength(8);
    expect(out.every((d) => d.recurrent === false)).toBe(true);
  });
  it('historique : Fos-sur-Mer vue 5 des 10 derniers jours devient récurrente, classée en dernier, ses détections aussi', () => {
    const { foyers, detections: out } = clusterFoyers(detections().france, history(FOS, 5), NOW);
    expect(foyers.map((f) => [f.dept, f.recurrent])).toEqual([['89', false], ['58', false], ['03', false], ['13', true]]);
    expect(out.filter((d) => d.dept === '13').every((d) => d.recurrent)).toBe(true);
    expect(out.filter((d) => d.dept !== '13').some((d) => d.recurrent)).toBe(false);
  });
  it('amendement 1 restreint aux feux nouveaux : Dunkerque (194,06 MW, confiance MODIS 100), vue 9 des 10 derniers jours, reste récurrente', () => {
    const real = dunkerque();
    const cells = [...new Set(real.map((d) => cellOf(d.lat, d.lon)))];
    // 9 jours sur 10 (relevé du 04/10 : l'aciérie manque un seul jour), dont les 3 premiers de la fenêtre.
    const days = Object.fromEntries(lastDays(TODAY, 10).map((d, i) => [d, { cells: i === 4 ? [] : cells, france: 0, recurrent: 0 }]));
    const { foyers, detections: out } = clusterFoyers(real, days, NOW);
    expect(foyers).toHaveLength(1);
    expect(foyers[0]).toMatchObject({
      dept: '59', detections: 53, passes: 9, confirmed: true, frpTotalMw: 194.06, frpMaxMw: 25.75, confidenceMax: 'haute', recurrent: true,
      satellites: ['Suomi NPP', 'NOAA-20', 'NOAA-21', 'Terra'],
    });
    expect(out.every((d) => d.recurrent)).toBe(true);
    expect(MAJOR_FOYER_MW).toBe(100);
  });
  it('feu nouveau de 5 jours à 120 MW : jamais récurrent ; le même lieu à 11 MW l’est', () => {
    const big = [det({ id: 'a', lat: 43.4392, lon: 4.8935, frpMw: 70 }), det({ id: 'b', lat: 43.4395, lon: 4.8937, frpMw: 50, satellite: 'NOAA-21', acquiredAt: '2026-10-04T02:50:00.000Z' })];
    const major = clusterFoyers(big, history(FOS, 5), NOW);
    expect(major.foyers[0]).toMatchObject({ recurrent: false, confirmed: true, frpTotalMw: 120 });
    expect(major.detections.some((d) => d.recurrent)).toBe(false);
    const small = [det({ id: 'a', lat: 43.4392, lon: 4.8935, frpMw: 6 }), det({ id: 'b', lat: 43.4395, lon: 4.8937, frpMw: 5, satellite: 'NOAA-21', acquiredAt: '2026-10-04T02:50:00.000Z' })];
    expect(clusterFoyers(small, history(FOS, 5), NOW).foyers[0].recurrent).toBe(true);
  });
  it('feu de confiance haute apparu il y a 6 jours : jamais récurrent ; avec des empreintes anciennes, la règle s’applique', () => {
    const high = [det({ id: 'c', lat: 43.4392, lon: 4.8935, confidence: 'haute', confidenceRaw: 'h' })];
    const recent = clusterFoyers(high, history(FOS, 6), NOW);
    expect(recent.foyers[0].recurrent).toBe(false);
    expect(recent.detections[0].recurrent).toBe(false);
    expect(clusterFoyers(high, history(FOS, 10), NOW).foyers[0].recurrent).toBe(true);
  });
  it('« apparu depuis 7 jours au plus » : empreintes depuis 7 jours, garde ; depuis 8 jours (3e jour de la fenêtre), récurrent', () => {
    expect(OLD_FOOTPRINT_DAYS).toBe(3);
    expect(oldFootprintCells(history(FOS, 7), TODAY).size).toBe(0);
    expect(oldFootprintCells(history(FOS, 8), TODAY).has(FOS)).toBe(true);
    const big = [det({ id: 'a', lat: 43.4392, lon: 4.8935, frpMw: 120 })];
    expect(clusterFoyers(big, history(FOS, 7), NOW).foyers[0].recurrent).toBe(false);
    expect(clusterFoyers(big, history(FOS, 8), NOW).foyers[0].recurrent).toBe(true);
  });
  it('foyer majeur (confirmé, 120 MW) classé avant un confirmé et un isolé', () => {
    const list = [
      det({ id: 'iso', lat: 45.0, lon: 0.5, frpMw: 40 }),
      det({ id: 'conf1', lat: 44.0, lon: 1.0, frpMw: 5 }), det({ id: 'conf2', lat: 44.002, lon: 1.0, frpMw: 6, satellite: 'Suomi NPP' }),
      det({ id: 'maj1', lat: 43.0, lon: 2.0, frpMw: 60 }), det({ id: 'maj2', lat: 43.003, lon: 2.0, frpMw: 60, satellite: 'NOAA-21', acquiredAt: '2026-10-04T02:45:00.000Z' }),
    ];
    expect(clusterFoyers(list, {}, NOW).foyers.map((f) => f.id)).toEqual(['maj1', 'conf1', 'iso']);
  });
  it('amendement 7 : deux satellites à 50 min d’écart font deux passages ; même satellite, même heure : un seul', () => {
    const two = clusterFoyers([det({ id: 'p', satellite: 'NOAA-20' }), det({ id: 'q', lat: 44.502, satellite: 'NOAA-21', acquiredAt: '2026-10-04T02:50:00.000Z' })], {}, NOW);
    expect(two.foyers).toHaveLength(1);
    expect(two.foyers[0]).toMatchObject({ passes: 2, confirmed: true });
    const one = clusterFoyers([det({ id: 'p' }), det({ id: 'q', lat: 44.502 })], {}, NOW);
    expect(one.foyers[0]).toMatchObject({ detections: 2, passes: 1, confirmed: false });
  });
  it('lien simple : moins de 1 km et moins de 12 h ; au-delà, deux foyers', () => {
    const far = clusterFoyers([det({ id: 'p' }), det({ id: 'q', lat: 44.51 })], {}, NOW);
    expect(far.foyers).toHaveLength(2);
    const late = clusterFoyers([det({ id: 'p' }), det({ id: 'q', lat: 44.502, acquiredAt: '2026-10-04T14:30:00.000Z' })], {}, NOW);
    expect(late.foyers).toHaveLength(2);
  });
});
