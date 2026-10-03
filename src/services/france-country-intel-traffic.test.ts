// src/services/france-country-intel-traffic.test.ts
// Entrées Trafics du score France (spec 2026-10-03 trafics § 2.6, arbitrage 14 de la phase B) : formule et seuils inchangés,
// seules les entrées changent de source. Aucune cible de france-country-intel.test.ts n'est touchée.
import { describe, expect, it } from 'vitest';
import { railOverviewFixture, roadNationalFixture, roadUrbanFixture } from '../components/layer-panel/traffic.fixture.ts';
import { buildFranceSignals, type FranceRawData } from './france-country-intel.ts';

function raw(over: Partial<FranceRawData> = {}): FranceRawData {
  return {
    newsItems: [], isnrData: null, cyberData: null, meteoAlerts: [], floodSegments: [], railTrains: [], roadEvents: [], urbanJamCount: 0,
    powerOutages: [], telecomOutages: [], defenseAlerts: [], jammingSignals: [], militaryFlightsCount: 0, maritimeCount: 0, activeFires: [],
    marketData: [], ecowattResponse: null, gasState: null, nuclearState: null, eolienLive: null, aisAnomalies: [], timeline: { days: [], lanes: [] },
    briefLang: 'fr', oilDashboard: null, fuelTensionDashboard: null, ...over,
  };
}

describe('score France : entrées Trafics', () => {
  it('rail : trains signalés (en cours et à venir) ; « fortes » = supprimés ou retardés (ancien critique ou élevé)', () => {
    const s = buildFranceSignals(raw({ railTrains: railOverviewFixture().trains }));
    expect(s.railDisruptions).toBe(8);
    expect(s.railSevere).toBe(7);
  });
  it('route : événements DIR en cours et bouchons des agglomérations TomTom', () => {
    const urbanJamCount = roadUrbanFixture().agglos.reduce((n, a) => n + a.jams, 0);
    expect(urbanJamCount).toBe(286);
    expect(buildFranceSignals(raw({ roadEvents: roadNationalFixture().events, urbanJamCount })).roadIncidents).toBe(65 + 286);
    expect(buildFranceSignals(raw()).roadIncidents).toBe(0);
  });
});
