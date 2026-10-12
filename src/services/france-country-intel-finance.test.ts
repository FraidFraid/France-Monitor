// src/services/france-country-intel-finance.test.ts : pilier finance du score (spec 2026-10-12 pilier finance) : niveau de stabilité
// financière (CISS France, CISS zone euro, écart OAT-Bund) au lieu des baisses de marché ; même plafond qu'avant ; nouvelles fixtures.
import { describe, expect, it } from 'vitest';
import type { EcbSeries, FinancialStabilityResponse, OatBundSpread } from '../types/index.ts';
import { FINANCE_COMPONENT, buildFranceCountrySnapshot, buildFranceSignals, financeComponent, type FranceRawData } from './france-country-intel.ts';

const NOW = Date.parse('2026-10-12T08:00:00Z');
function raw(over: Partial<FranceRawData> = {}): FranceRawData {
  return {
    newsItems: [], isnrData: null, cyber: null, meteoAlerts: [], floodSegments: [], railTrains: [], roadEvents: [], urbanJamCount: 0,
    telecomOutages: null, cableAlerts: [], gnssDegraded: null, militaryFlightsCount: 0, maritimeCount: 0, activeFires: [],
    marketData: [], ecowattResponse: null, gasState: null, nuclearState: null, eolienLive: null, aisAnomalies: [], timeline: { days: [], lanes: [] },
    briefLang: 'fr', oilDashboard: null, fuelTensionDashboard: null, ...over,
  };
}
const series = (id: EcbSeries['id'], value: number | null, status: EcbSeries['status'] = value === null ? 'unavailable' : 'ok'): EcbSeries =>
  ({ id, value, date: value === null ? null : '2026-10-09', history: [], status, error: null });
const spread = (value: number | null): OatBundSpread =>
  ({ value, fr10y: null, de10y: null, readAt: value === null ? null : '2026-10-12T08:00:00.000Z', history: [], status: value === null ? 'unavailable' : 'ok', error: null });
const fs = (fr: number | null, ea: number | null, sp: number | null): FinancialStabilityResponse =>
  ({ readAt: '2026-10-12T08:00:00.000Z', series: [series('cissFr', fr), series('cissEa', ea)], rates: [], spread: spread(sp), errors: [] });

describe('composante finance (même plafond que les baisses de marché)', () => {
  it('vert ou null 0/0, jaune 20/3, orange 40/6, rouge 60/10', () => {
    expect(FINANCE_COMPONENT).toEqual({ vert: { pillar: 0, pressure: 0 }, jaune: { pillar: 20, pressure: 3 }, orange: { pillar: 40, pressure: 6 }, rouge: { pillar: 60, pressure: 10 } });
    expect(financeComponent(null)).toEqual({ pillar: 0, pressure: 0 });
  });
});

describe('signal financeLevel', () => {
  it('plus haut des trois ; chiffres d’accompagnement', () => {
    const s = buildFranceSignals(raw({ financialStability: fs(0.05, 0.015, 1.43) }), NOW);
    expect([s.financeLevel, s.financeSpread, s.financeCissFr]).toEqual(['rouge', 1.43, 0.05]);
  });
  it('sans réponse, ou toutes séries indisponibles : null', () => {
    expect(buildFranceSignals(raw(), NOW).financeLevel).toBeNull();
    const down = buildFranceSignals(raw({ financialStability: fs(null, null, null) }), NOW);
    expect([down.financeLevel, down.financeSpread, down.financeCissFr]).toEqual([null, null, null]);
  });
  it('les baisses de marché n’entrent plus dans le signal', () => {
    const md = [{ symbol: 'CAC.INDX', name: 'CAC 40', price: 7000, changePercent: -4, trend: 'down' as const, lastUpdated: new Date(NOW), history: [], category: 'indices' as const }];
    expect(buildFranceSignals(raw({ marketData: md }), NOW).financeLevel).toBeNull();
  });
});

describe('score (nouvelles fixtures)', () => {
  const score = (r: FranceRawData): number => buildFranceCountrySnapshot(r, { now: NOW }).score;
  it('tout vert = même score que sans donnée (95, aucune déduction)', () => {
    expect(score(raw({ financialStability: fs(0.05, 0.015, 0.4) }))).toBe(score(raw()));
    expect(score(raw())).toBe(95);
  });
  it('écart rouge seul : déduction réelle, bornée à 3 points', () => {
    const delta = score(raw()) - score(raw({ financialStability: fs(0.05, 0.015, 1.43) }));
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThanOrEqual(3);
  });
  it('décomposition : ligne « Stabilité financière » à la valeur de la composante', () => {
    const snap = buildFranceCountrySnapshot(raw({ financialStability: fs(0.05, 0.015, 1.43) }), { now: NOW });
    const rows = JSON.stringify(snap.scoreBreakdown);
    expect(rows).toContain('"label":"Stabilité financière","value":60');
    expect(rows).not.toContain('Stress marchés');
  });
});

describe('revue finale', () => {
  it('signal financeCissEa', () => {
    expect(buildFranceSignals(raw({ financialStability: fs(0.05, 0.35, 0.4) }), NOW)).toMatchObject({ financeLevel: 'orange', financeCissEa: 0.35 });
  });
});
