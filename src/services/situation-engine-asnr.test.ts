// src/services/situation-engine-asnr.test.ts
// Situations ASNR (spec 2026-10-13) : centre de crise → high ; INES ≥ 2 → high ; INES 1 → medium ; INES 0 ou n.d. → aucune ; au-delà de
// 7 jours → aucune. Aucun effet sur le score : ces types sont écartés du plafond (une situation high plafonne sinon à 78).
import { describe, expect, it } from 'vitest';
import type { AsnrEvent } from '../types/index.ts';
import { buildFranceCountrySnapshot, situationsForScore, type FranceRawData } from './france-country-intel.ts';
import { detectAsnrEvents, detectSituations } from './situation-engine.ts';
import { situationTheme } from './themes.ts';

const NOW = Date.parse('2026-10-13T08:00:00Z');

function baseRawData(overrides: Partial<FranceRawData> = {}): FranceRawData {
  return {
    newsItems: [], isnrData: null, cyber: null, meteoAlerts: [], floodSegments: [], railTrains: [], roadEvents: [], urbanJamCount: 0, telecomOutages: null, cableAlerts: [], gnssDegraded: null, militaryFlightsCount: 0, maritimeCount: 0, activeFires: [], marketData: [], ecowattResponse: null,
    gasState: null, nuclearState: null, eolienLive: null, aisAnomalies: [], timeline: { days: [], lanes: [] }, briefLang: 'fr', oilDashboard: null,
    fuelTensionDashboard: null, ...overrides,
  };
}

function ev(over: Partial<AsnrEvent>): AsnrEvent {
  return {
    id: 'asnr-x', url: 'https://www.asnr.fr/actualites/x', title: 'Incident à la centrale nucléaire de Golfech', date: '2026-10-12',
    kind: 'installation', ines: null, plantId: 'nuc-golfech', site: 'Golfech', ...over,
  };
}

describe('detectAsnrEvents', () => {
  it('centre de crise : high, sur la centrale, couche Nucléaire, lien vers l’avis', () => {
    const [s] = detectAsnrEvents(baseRawData({ asnrEvents: [ev({ kind: 'crise', title: 'L’ASNR active son centre de crise à la suite d’un événement à la centrale de Chooz', plantId: 'nuc-chooz', site: 'Chooz' })] }), NOW);
    expect(s).toMatchObject({ type: 'ASNR_CRISIS', severity: 'high', affectedZones: ['Chooz'], activateLayers: ['nuclearFleet'], linkUrl: 'https://www.asnr.fr/actualites/x' });
    expect(s?.lat).toBeCloseTo(50.0908, 3);
    expect(s?.title).not.toContain('—');
  });
  it('INES 2 : high ; INES 1 : medium ; INES 0 ou n.d. : aucune', () => {
    const types = (ines: number | null) => detectAsnrEvents(baseRawData({ asnrEvents: [ev({ ines })] }), NOW).map((s) => [s.type, s.severity]);
    expect(types(2)).toEqual([['NUCLEAR_INCIDENT', 'high']]);
    expect(types(1)).toEqual([['NUCLEAR_INCIDENT', 'medium']]);
    expect(types(0)).toEqual([]);
    expect(types(null)).toEqual([]);
  });
  it('radioprotection sans site : situation sans coordonnées, zone « France »', () => {
    const [s] = detectAsnrEvents(baseRawData({ asnrEvents: [ev({ kind: 'radioprotection', ines: 2, plantId: null, site: null, title: '[Hospices civils de Lyon] Contamination externe d’un travailleur' })] }), NOW);
    expect(s).toMatchObject({ severity: 'high', affectedZones: ['France'] });
    expect(s?.lat).toBeUndefined();
  });
  it('au-delà de 7 jours : aucune situation', () => {
    expect(detectAsnrEvents(baseRawData({ asnrEvents: [ev({ kind: 'crise', date: '2026-10-05' })] }), NOW)).toEqual([]);
  });
  it('thème Énergie ; règle appelée par detectSituations', () => {
    const all = detectSituations(baseRawData({ asnrEvents: [ev({ ines: 2 })] }), NOW);
    expect(all.some((s) => s.type === 'NUCLEAR_INCIDENT')).toBe(true);
    expect(situationTheme('ASNR_CRISIS')).toBe('energy');
    expect(situationTheme('NUCLEAR_INCIDENT')).toBe('energy');
  });
});

describe('score inchangé', () => {
  it('situationsForScore écarte les deux types ASNR', () => {
    const kept = situationsForScore([{ type: 'ASNR_CRISIS' as const }, { type: 'NUCLEAR_INCIDENT' as const }, { type: 'SEISMIC_EVENT' as const }]);
    expect(kept.map((s) => s.type)).toEqual(['SEISMIC_EVENT']);
  });
  it('même score avec ou sans centre de crise ASNR activé', () => {
    const calm = buildFranceCountrySnapshot(baseRawData(), { now: NOW });
    const crisis = buildFranceCountrySnapshot(baseRawData({ asnrEvents: [ev({ kind: 'crise' })] }), { now: NOW });
    expect(crisis.situations.some((s) => s.type === 'ASNR_CRISIS')).toBe(true);
    expect(crisis.score).toBe(calm.score);
    expect(crisis.scoreBreakdown.situationCap).toBeNull();
  });
});
