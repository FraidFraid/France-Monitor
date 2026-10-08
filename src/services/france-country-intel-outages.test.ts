// src/services/france-country-intel-outages.test.ts
// Entrées « pannes » du score France (spec 2026-10-08 panneaux pannes § 2.3) : formule inchangée, l'entrée électrique fabriquée disparaît,
// la télécom devient le nombre de pannes imprévues récentes (< 24 h). Aucune cible de france-country-intel.test.ts n'est touchée.
import { describe, expect, it } from 'vitest';
import { telecomFixtureResponse } from '../components/layer-panel/outages.fixture.ts';
import { briefSignalCounts } from './france-intel-brief.ts';
import { buildFranceSignals, computeFranceScoreBreakdown, type FranceRawData } from './france-country-intel.ts';
import type { TelecomOutagesResponse } from '../types/index.ts';

function raw(over: Partial<FranceRawData> = {}): FranceRawData {
  return {
    newsItems: [], isnrData: null, cyber: null, meteoAlerts: [], floodSegments: [], railTrains: [], roadEvents: [], urbanJamCount: 0,
    telecomOutages: null, cableAlerts: [], gnssDegraded: null, militaryFlightsCount: 0, maritimeCount: 0, activeFires: [],
    marketData: [], ecowattResponse: null, gasState: null, nuclearState: null, eolienLive: null, aisAnomalies: [], timeline: { days: [], lanes: [] },
    briefLang: 'fr', oilDashboard: null, fuelTensionDashboard: null, ...over,
  };
}

/** Stock ARCEP de 1 056 sites (octobre 2026) dont `recent` pannes de moins de 24 h. */
function withRecent(recent: number): TelecomOutagesResponse {
  const t = telecomFixtureResponse();
  if (t.summary === null) throw new Error('jeu d’essai Télécoms sans résumé');
  return { ...t, summary: { ...t.summary, total: 1056, recent } };
}

describe('score France : entrées des pannes', () => {
  it('télécom : pannes imprévues récentes (pas le stock) ; fichier non lu ou sans résumé : null, jamais 0', () => {
    const t = withRecent(264);
    expect(t.summary?.total).toBeGreaterThan(264);
    expect(buildFranceSignals(raw({ telecomOutages: t })).telecomOutages).toBe(264);
    expect(buildFranceSignals(raw({ telecomOutages: withRecent(0) })).telecomOutages).toBe(0);
    expect(buildFranceSignals(raw({ telecomOutages: null })).telecomOutages).toBeNull();
    expect(buildFranceSignals(raw({ telecomOutages: { ...t, summary: null } })).telecomOutages).toBeNull();
  });

  it('plus aucun champ électrique dans les signaux', () => {
    expect(Object.keys(buildFranceSignals(raw()))).not.toContain('powerOutages');
  });

  it('pilier Continuité : « Pression électrique » ne lit que l’Écowatt, « Télécom » suit les pannes récentes, null compte comme sans entrée', () => {
    const components = (telecomOutages: TelecomOutagesResponse | null) => {
      const r = raw({ telecomOutages });
      const b = computeFranceScoreBreakdown(r, buildFranceSignals(r), null);
      const continuity = b.pillars.find((p) => p.key === 'continuity');
      return Object.fromEntries((continuity?.components ?? []).map((c) => [c.label, c.value])) as Record<string, number | undefined>;
    };
    expect(components(null)['Pression électrique'] ?? 0).toBe(0);
    expect(components(null)['Télécom'] ?? 0).toBe(0);
    expect(components(withRecent(0))['Télécom'] ?? 0).toBe(0);
    expect(components(withRecent(264))['Télécom'] ?? 0).toBeGreaterThan(0);
    expect(components(withRecent(264))['Pression électrique'] ?? 0).toBe(0);
  });

  it('brief : le drapeau telecomUnavailable suit la source (null = non lu, 0 lu = lu), comme les autres sources non lues', () => {
    expect(briefSignalCounts(buildFranceSignals(raw({ telecomOutages: null })))).toMatchObject({ telecomUnavailable: true });
    expect(briefSignalCounts(buildFranceSignals(raw({ telecomOutages: { ...withRecent(0), summary: null } })))).toMatchObject({ telecomUnavailable: true });
    expect(briefSignalCounts(buildFranceSignals(raw({ telecomOutages: withRecent(0) })))).toMatchObject({ telecomUnavailable: false, telecomOutages: 0 });
    expect(briefSignalCounts(buildFranceSignals(raw({ telecomOutages: withRecent(18) })))).toMatchObject({ telecomUnavailable: false, telecomOutages: 18 });
    expect(briefSignalCounts(buildFranceSignals(raw({ telecomOutages: withRecent(18) })))).not.toHaveProperty('powerOutages');
  });
});
