import { describe, expect, it } from 'vitest';
import {
  FLUX_CAPACITY_PERS_MIN_M, momentWord, onSiteAt, relativeLabel, segmentFlowAt, timelineRange, windowCumulative, windowDensity,
} from '../src/services/flux-timeline.ts';
import { parseFluxTiming } from '../src/services/flux-pietons.ts';
import { fluxFeatures, instantBand } from '../src/components/deckgl/flux-pietons-map.ts';
import type { FluxTiming } from '../src/types/index.ts';

const T: FluxTiming = { arriveeMin: 30, pointeArrivee: 1.5, departMin: 15, pointeDepart: 1.8, dureeMin: 60, vitesse: 1.2 };

describe('fenêtre en trapèze', () => {
  it('intégrale 1, pointe = facteur x moyenne, nulle hors fenêtre', () => {
    let area = 0;
    for (let x = 0; x < 30; x += 0.01) area += windowDensity(x + 0.005, 30, 1.5) * 0.01;
    expect(area).toBeCloseTo(1, 3);
    expect(windowDensity(15, 30, 1.5)).toBeCloseTo(1.5 / 30, 6);
    expect(windowDensity(-1, 30, 1.5)).toBe(0);
    expect(windowDensity(31, 30, 1.5)).toBe(0);
  });
  it('cumul : 0 au début, 1/2 au milieu (symétrique), 1 à la fin, croissant', () => {
    expect(windowCumulative(0, 15, 1.8)).toBe(0);
    expect(windowCumulative(7.5, 15, 1.8)).toBeCloseTo(0.5, 6);
    expect(windowCumulative(15, 15, 1.8)).toBe(1);
    let prev = 0;
    for (let x = 0; x <= 15; x += 0.5) { const c = windowCumulative(x, 15, 1.8); expect(c).toBeGreaterThanOrEqual(prev); prev = c; }
  });
});

describe('rejeu', () => {
  it('bornes : premiers passages de la rue la plus lointaine, fin de la dispersion, arrondies à 5 min', () => {
    // 1 440 m à 1,2 m/s = 20 min de marche.
    expect(timelineRange(T, 1440)).toEqual({ min: -50, max: 95 });
  });
  it('une rue lointaine se remplit plus tôt qu’une rue proche ; débit total de la phase conservé', () => {
    const near = { chargeP90: 600, chargeDepartP90: 0, largeur: 4, distance: 0 };
    const far = { ...near, distance: 720 }; // 10 min de marche
    expect(segmentFlowAt(near, T, -25).flow).toBeLessThan(segmentFlowAt(far, T, -25).flow);
    expect(segmentFlowAt(near, T, -5).flow).toBeGreaterThan(0);
    expect(segmentFlowAt(far, T, -5).flow).toBe(0); // ses marcheurs sont déjà passés
    let total = 0;
    for (let m = -45; m <= 0; m += 0.1) total += segmentFlowAt(far, T, m).flow * 0.1;
    expect(total).toBeCloseTo(600, 0);
  });
  it('dispersion après la durée du rassemblement ; rapport à la capacité de la rue', () => {
    const s = { chargeP90: 0, chargeDepartP90: 900, largeur: 2, distance: 0 };
    expect(segmentFlowAt(s, T, 30).flow).toBe(0);
    const peak = segmentFlowAt(s, T, 67.5);
    expect(peak.flow).toBeCloseTo((900 * 1.8) / 15, 6);
    expect(peak.ratio).toBeCloseTo(peak.flow / (FLUX_CAPACITY_PERS_MIN_M * 2), 6);
  });
  it('personnes sur place : 0 avant, toute l’affluence pendant, 0 après', () => {
    expect(onSiteAt(1000, T, -30)).toBe(0);
    expect(onSiteAt(1000, T, -15)).toBeCloseTo(500, 6);
    expect(onSiteAt(1000, T, 30)).toBe(1000);
    expect(onSiteAt(1000, T, 80)).toBe(0);
  });
  it('mots et libellés', () => {
    expect(momentWord(T, -40)).toBe('premiers trajets');
    expect(momentWord(T, -10)).toBe('arrivées');
    expect(momentWord(T, 20)).toBe('rassemblement sur place');
    expect(momentWord(T, 65)).toBe('dispersion');
    expect(relativeLabel(0)).toBe('début');
    expect(relativeLabel(-12)).toBe('début − 12 min');
    expect(relativeLabel(65)).toBe('début + 1 h 05');
  });
});

describe('lecture et carte', () => {
  it('paramètres de temps : valides, sinon null (publication ancienne ou mal formée)', () => {
    expect(parseFluxTiming(T)).toEqual(T);
    expect(parseFluxTiming(null)).toBeNull();
    expect(parseFluxTiming({ ...T, vitesse: 0 })).toBeNull();
    expect(parseFluxTiming({ ...T, dureeMin: '60' })).toBeNull();
  });
  it('instant : débit de chaque rue, rues vides retirées, couleur selon la capacité ; sans distance, totaux de la phase', () => {
    const seg = (distance: number | null) => ({
      type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: [[0, 0], [0.001, 0]] },
      properties: { kind: 'troncon', rue: 'Rue A', largeur: 4, chargeP50: 100, chargeP90: 600, densiteP90: 0.3, pSaturation: 0.2,
        chargeDepartP90: 400, pSaturationDepart: 0.1, pEmprise: 0, parcours: false, pGoulot: 0, distance },
    });
    const at = fluxFeatures([seg(0), seg(720)], 'arrivee', { atMin: -5, timing: T });
    expect(at.features).toHaveLength(1); // la rue lointaine est vide à début − 5 min
    expect(at.features[0]?.properties?.['body']).toContain('pers/min');
    const old = fluxFeatures([seg(null)], 'arrivee', { atMin: -5, timing: T });
    expect(old.features[0]?.properties?.['charge']).toBe(600);
    expect(instantBand(0.4)).toBe('fluide');
    expect(instantBand(0.6)).toBe('jaune');
    expect(instantBand(0.8)).toBe('orange');
    expect(instantBand(1.2)).toBe('rouge');
  });
});
