// tests/gnss-grid.test.ts : grille GNSS mesurée (spec 2026-10-04 souveraineté § 3.1 ; contrats § 2.5, arbitrages 28, 32, 34 ;
// amendement 7, O15 à O17) : maille, classe, formule de gpsjam.org, minimum de 5 aéronefs, fenêtre glissante de 24 h, NACp 0 après
// une bonne précision compté dégradé (O16), dégradation générale (un orage géomagnétique n'est jamais une dégradation locale), Kp de
// la fenêtre, couverture d'un jour UTC ; réponses réelles adsb.lol et NOAA du 04/10/2026.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GENERAL_DEGRADATION_KP, GENERAL_DEGRADATION_SHARE, GNSS_CELL_DEG, GNSS_MIN_AIRCRAFT, GNSS_ORANGE_PCT, GNSS_WINDOW_MS, GNSS_YELLOW_PCT,
  cellKey, cellLevel, cellPct, createGnssWindow, degradedCells, frenchMeasuredCells, generalDegradation, gnssSummary, maxKpInWindow, nacClass,
  utcDay, utcDayStart,
} from '../api/_lib/gnss-grid.js';
import type { GnssCell } from '../src/types/index.ts';

const fx = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/sovereignty/${name}`, import.meta.url), 'utf8')) as T;
interface PointRead { now: number; ac: Array<Record<string, unknown>> }
const OUEST = fx<PointRead>('adsb-lol-point-ouest.json');
const SUD_EST = fx<PointRead>('adsb-lol-point-sud-est.json');
const KP = fx<Array<{ time_tag: string; Kp: number }>>('noaa-planetary-k-index.json').map((k) => ({ at: `${k.time_tag}Z`, kp: k.Kp }));
const T = Date.parse('2026-10-04T14:00:00Z');
const H = 3_600_000;
const MIN = 60_000;

function ac(hex: string, lat: number, lon: number, nacP: number | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { hex, lat, lon, alt_baro: 12_000, seen_pos: 1, ...(nacP === null ? {} : { nac_p: nacP }), ...extra };
}
/** n aéronefs distincts dans la maille de coin sud-ouest (lat, lon), même précision déclarée. */
function fill(prefix: string, lat: number, lon: number, n: number, nacP: number | null): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_v, i) => ac(`${prefix}${String(i).padStart(3, '0')}`, lat + 0.2, lon + 0.2, nacP));
}
/** Dix mailles françaises (centres vérifiés dans un département) ; les `degraded` premières à 15 % (16 bons, 4 dégradés), les autres vertes. */
const FRENCH = [[48.5, 2], [48.5, 2.5], [48, 2], [48, 2.5], [47.5, 1.5], [47, 2], [46.5, 2.5], [46, 3], [45.5, 4.5], [45, 5]] as const;
function franceCells(degraded: number): GnssCell[] {
  const w = createGnssWindow();
  w.add(FRENCH.flatMap(([lat, lon], i) => (i < degraded
    ? [...fill(`b${i}-`, lat, lon, 16, 9), ...fill(`d${i}-`, lat, lon, 4, 5)]
    : fill(`b${i}-`, lat, lon, 20, 10))), T);
  return w.cells();
}

describe('constantes de la méthode (spec § 3.1)', () => {
  it('maille de 0,5°, 5 aéronefs, NACp 8, jaune 2 %, orange 10 %, 30 % et Kp 5− (14/3), 24 h', () => {
    expect([GNSS_CELL_DEG, GNSS_MIN_AIRCRAFT, GNSS_YELLOW_PCT, GNSS_ORANGE_PCT, GENERAL_DEGRADATION_SHARE, GNSS_WINDOW_MS])
      .toEqual([0.5, 5, 2, 10, 0.3, 24 * H]);
    expect(GENERAL_DEGRADATION_KP).toBeCloseTo(4.6667, 4);
  });
});

describe('maille, classe, formule', () => {
  it('coin sud-ouest de la maille', () => {
    expect([cellKey(48.73, -1.2), cellKey(48.0, -3.0), cellKey(43.21, 5.27), cellKey(-0.1, 0.1)]).toEqual(['48.5:-1.5', '48:-3', '43:5', '-0.5:0']);
  });
  it('classe par nac_p seul : 8 et plus bon, 1 à 7 dégradé, 0, absent ou illisible inconnu', () => {
    expect([11, 8, 7, 1, 0, null, undefined, '9', -1].map(nacClass))
      .toEqual(['good', 'good', 'degraded', 'degraded', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown']);
  });
  it('100 × (dégradés − 1) / (bons + dégradés), bornée à 0 ; null sous 5 aéronefs au calcul ; 10 % tout juste reste jaune', () => {
    expect(cellPct(8, 2)).toBe(10);
    expect(cellLevel(cellPct(8, 2))).toBe('jaune');
    expect(cellPct(7, 3)).toBe(20);
    expect(cellLevel(cellPct(7, 3))).toBe('orange');
    expect(cellPct(19, 2)).toBeCloseTo(4.7619, 4);
    expect(cellPct(5, 0)).toBe(0);
    expect(cellLevel(cellPct(5, 0))).toBe('vert');
    expect(cellPct(3, 1)).toBeNull();
    expect(cellLevel(null)).toBe('peu');
    expect(cellLevel(cellPct(96, 3))).toBe('jaune');
    expect(cellLevel(cellPct(97, 2))).toBe('vert');
    expect(cellLevel(cellPct(16, 3))).toBe('orange');
  });
});

describe('fenêtre de 24 h', () => {
  it('un aéronef vu bon puis dégradé dans la même maille compte une fois, dégradé ; deux mailles, deux comptes', () => {
    const w = createGnssWindow();
    w.add([ac('abc', 48.2, 2.2, 9), ac('abc', 48.7, 2.2, 9)], T);
    w.add([ac('abc', 48.2, 2.2, 6)], T + H);
    const cells = w.cells();
    expect(cells.find((c) => c.lat === 48 && c.lon === 2)).toMatchObject({ good: 0, degraded: 1, unknown: 0, pct: null, level: 'peu', inFrance: true });
    expect(cells.find((c) => c.lat === 48.5 && c.lon === 2)).toMatchObject({ good: 1, degraded: 0 });
    expect([w.aircraft, w.reads, w.startedAt]).toEqual([1, 2, T]);
  });
  it('nac_p 0 sans bonne précision antérieure et absent comptés à part, jamais au calcul ; au sol, position de plus de 120 s ou illisible : écartés ; adresse « ~ » gardée', () => {
    const w = createGnssWindow();
    w.add([
      ...fill('b', 48, 2, 4, 9), ac('z0', 48.2, 2.2, 0), ac('z1', 48.2, 2.2, 0), ac('zz', 48.2, 2.2, null),
      ac('sol', 48.2, 2.2, 3, { alt_baro: 'ground' }), ac('vieux', 48.2, 2.2, 3, { seen_pos: 300 }), { hex: 'x', lat: '48.2', lon: 2.2, nac_p: 3 },
      ac('~3bf0ff', 48.2, 2.2, 9),
    ], T);
    expect(w.cells()).toEqual([{ lat: 48, lon: 2, good: 5, degraded: 0, unknown: 3, pct: 0, level: 'vert', inFrance: true }]);
  });
  it('fenêtre glissante : une dégradation de plus de 24 h est oubliée, une plus récente reste ; tout oublié : début du cumul nul', () => {
    const w = createGnssWindow();
    w.add([ac('old', 48.2, 2.2, 5), ac('new', 48.2, 2.2, 9)], T);
    w.add([ac('old', 48.2, 2.2, 9), ac('new', 48.2, 2.2, 5)], T + H);
    w.prune(T + 24 * H + 30 * MIN);
    expect(w.cells()[0]).toMatchObject({ good: 1, degraded: 1 });
    expect(w.reads).toBe(1);
    w.prune(T + 25 * H + 1);
    expect([w.cells(), w.reads, w.aircraft, w.startedAt]).toEqual([[], 0, 0, null]);
  });
  it('lectures réelles du 04/10 : 379 aéronefs, 180 mailles, 95 françaises, 3 françaises mesurées et vertes ; orange au sud de l’Angleterre, jamais française', () => {
    const w = createGnssWindow();
    w.add(OUEST.ac, OUEST.now);
    w.add(SUD_EST.ac, SUD_EST.now);
    const cells = w.cells();
    expect([w.aircraft, w.reads, cells.length, cells.filter((c) => c.inFrance).length]).toEqual([379, 2, 180, 95]);
    expect(frenchMeasuredCells(cells).map((c) => `${c.lat}:${c.lon}:${c.level}`)).toEqual(['43.5:1.5:vert', '43.5:4.5:vert', '43:5:vert']);
    expect(cells.filter((c) => c.level === 'orange')).toEqual([
      { lat: 51.5, lon: -2.5, good: 2, degraded: 3, unknown: 2, pct: 40, level: 'orange', inFrance: false },
      { lat: 51, lon: -1.5, good: 3, degraded: 3, unknown: 3, pct: 33.3, level: 'orange', inFrance: false },
    ]);
    expect(cells.find((c) => c.lat === 48 && c.lon === 2)).toEqual({ lat: 48, lon: 2, good: 0, degraded: 1, unknown: 0, pct: null, level: 'peu', inFrance: true });
    expect(degradedCells(cells, generalDegradation(cells, 5))).toEqual([]);
    expect(gnssSummary(cells, 5)).toEqual({ measured: 3, jaune: 0, orange: 0, general: false, degraded: 0 });
  });
});

describe('NACp 0 après une bonne précision : dégradé (O16)', () => {
  it('même appareil : 9 puis 0 dans la même maille, ou 9 dans une maille puis 0 dans la suivante : dégradé là où il déclare 0', () => {
    const w = createGnssWindow();
    w.add([ac('a1', 48.2, 2.2, 9), ac('a2', 48.2, 2.2, 10)], T);
    w.add([ac('a1', 48.2, 2.2, 0), ac('a2', 47.7, 2.2, 0)], T + 10 * MIN);
    const cells = w.cells();
    expect(cells.find((c) => c.lat === 48 && c.lon === 2)).toMatchObject({ good: 1, degraded: 1, unknown: 0 });
    expect(cells.find((c) => c.lat === 47.5 && c.lon === 2)).toMatchObject({ good: 0, degraded: 1, unknown: 0 });
  });
  it('0 avant la bonne précision, 0 sans bonne précision, ou absent après une bonne précision : inconnu, hors calcul', () => {
    const w = createGnssWindow();
    w.add([ac('avant', 48.2, 2.2, 0), ac('jamais', 48.2, 2.2, 0), ac('absent', 48.2, 2.2, 9)], T);
    w.add([ac('avant', 48.7, 2.2, 9), ac('jamais', 48.7, 2.2, 0), ac('absent', 48.7, 2.2, null)], T + 10 * MIN);
    const cells = w.cells();
    expect(cells.find((c) => c.lat === 48 && c.lon === 2)).toMatchObject({ good: 1, degraded: 0, unknown: 2 });
    expect(cells.find((c) => c.lat === 48.5 && c.lon === 2)).toMatchObject({ good: 1, degraded: 0, unknown: 2 });
  });
  it('bonne précision de plus de 24 h, oubliée : un 0 qui suit reste inconnu', () => {
    const w = createGnssWindow();
    w.add([ac('b', 48.2, 2.2, 9)], T);
    w.prune(T + 25 * H);
    w.add([ac('b', 48.2, 2.2, 0)], T + 25 * H);
    expect(w.cells()).toEqual([{ lat: 48, lon: 2, good: 0, degraded: 0, unknown: 1, pct: null, level: 'peu', inFrance: true }]);
  });
  it('quatre aéronefs qui perdent leur précision (0) dans une maille de vingt : 15 %, orange', () => {
    const w = createGnssWindow();
    w.add(fill('p', 48, -3.5, 20, 9), T);
    w.add([...fill('p', 48, -3.5, 16, 9), ...fill('p', 48, -3.5, 4, 0).map((a, i) => ({ ...a, hex: `p${String(16 + i).padStart(3, '0')}` }))], T + 10 * MIN);
    expect(w.cells()).toEqual([{ lat: 48, lon: -3.5, good: 16, degraded: 4, unknown: 0, pct: 15, level: 'orange', inFrance: true }]);
  });
});

describe('dégradation générale : un orage géomagnétique n’est jamais une dégradation locale (Review Focus 3)', () => {
  it('40 % des mailles françaises dégradées et Kp 5− (4,67) : dégradation générale, aucune maille comptée', () => {
    const cells = franceCells(4);
    expect(frenchMeasuredCells(cells)).toHaveLength(10);
    expect(cells.filter((c) => c.level === 'orange')).toHaveLength(4);
    expect(generalDegradation(cells, 4.67)).toBe(true);
    expect(degradedCells(cells, generalDegradation(cells, 4.67))).toEqual([]);
    expect(gnssSummary(cells, 4.67)).toEqual({ measured: 10, jaune: 0, orange: 4, general: true, degraded: 0 });
  });
  it('même grille avec Kp 4,33 (4+) ou Kp inconnu : les quatre mailles orange comptent', () => {
    const cells = franceCells(4);
    for (const kp of [4.33, null]) {
      expect(generalDegradation(cells, kp)).toBe(false);
      expect(degradedCells(cells, generalDegradation(cells, kp)).map((c) => `${c.lat}:${c.lon}:${c.pct}`))
        .toEqual(['48.5:2:15', '48.5:2.5:15', '48:2:15', '48:2.5:15']);
      expect(gnssSummary(cells, kp)).toEqual({ measured: 10, jaune: 0, orange: 4, general: false, degraded: 4 });
    }
  });
  it('30 % tout juste n’est pas « plus de 30 % » : même avec Kp 9, les mailles comptent', () => {
    expect(generalDegradation(franceCells(3), 9)).toBe(false);
  });
  it('Kp de la fenêtre lu sur les tranches réelles : 2,67 le 03/10, 4,33 le 04/10 avant 09:00, 5 sur 24 h au 04/10 16:40', () => {
    expect(maxKpInWindow(KP, Date.parse('2026-10-03T00:00:00Z'), Date.parse('2026-10-04T00:00:00Z'))).toBe(2.67);
    expect(maxKpInWindow(KP, Date.parse('2026-10-04T00:00:00Z'), Date.parse('2026-10-04T08:59:00Z'))).toBe(4.33);
    expect(maxKpInWindow(KP, Date.parse('2026-10-03T14:40:00Z'), Date.parse('2026-10-04T14:40:00Z'))).toBe(5);
    expect(maxKpInWindow([], T, T + H)).toBeNull();
    const cells = franceCells(4);
    expect(generalDegradation(cells, maxKpInWindow(KP, Date.parse('2026-10-04T00:00:00Z'), Date.parse('2026-10-04T08:59:00Z')))).toBe(false);
    expect(generalDegradation(cells, maxKpInWindow(KP, Date.parse('2026-10-03T14:40:00Z'), Date.parse('2026-10-04T14:40:00Z')))).toBe(true);
  });
});

describe('jour UTC et couverture (O17 : mailles localisées du jour UTC précédent seulement)', () => {
  it('jour UTC d’un instant et début du jour', () => {
    expect([utcDay(Date.parse('2026-10-04T23:59:59Z')), utcDay(Date.parse('2026-10-05T00:00:00Z'))]).toEqual(['2026-10-04', '2026-10-05']);
    expect(utcDayStart('2026-10-04')).toBe(Date.parse('2026-10-04T00:00:00Z'));
  });
  it('plus long intervalle sans lecture entre deux bornes : début, entre lectures, fin ; aucune lecture : toute la durée', () => {
    const day = utcDayStart('2026-10-04');
    const w = createGnssWindow();
    expect(w.largestGapMs(day, day + 24 * H)).toBe(24 * H);
    for (const t of [day + 5 * MIN, day + 15 * MIN, day + 50 * MIN, day + 24 * H - 2 * MIN]) w.add([], t);
    expect(w.largestGapMs(day, day + 24 * H)).toBe(24 * H - 52 * MIN);
    expect(w.largestGapMs(day, day + 50 * MIN)).toBe(35 * MIN);
    expect(w.largestGapMs(day + 10 * MIN, day + 40 * MIN)).toBe(25 * MIN);
  });
});
