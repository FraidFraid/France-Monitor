import { describe, it, expect } from 'vitest';
import { collectSituationReportData, type SituationReportContext } from './SituationReport.ts';
import type { DetectedSituation } from '../types/index.ts';

function situation(over: Partial<DetectedSituation> = {}): DetectedSituation {
  return {
    id: 'defense-signal-elevated', type: 'DEFENSE_SIGNAL_ELEVATED', severity: 'watch', confidence: 0.6,
    title: 'Signal défense / renseignement élevé', summary: '12 vols militaires actifs.', affectedZones: ['France'],
    drivers: [], recommendedActions: [], sourceRefs: [], updatedAt: new Date('2026-09-24T07:00:00Z'), ...over,
  };
}

function ctx(over: Partial<SituationReportContext> = {}): SituationReportContext {
  const mix = { timestamp: new Date(0), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 };
  return {
    generatedAt: new Date('2026-09-24T08:00:00Z'),
    permalink: 'https://example.org/?view=app&ui=v2',
    situations: [situation()],
    stability: { scores: [], nationalScore: 47, timestamp: new Date(0) },
    meteoAlerts: [{ department: 'Var', departmentCode: '83', level: 'violet', risks: ['heat'] }],
    floodSegments: [],
    ecowatt: { signals: { '53': 'red' }, mixes: {}, national: mix, interconnections: [] },
    sncfDisruptions: [],
    trafficIncidents: [],
    powerOutages: [],
    telecomOutages: [],
    newsItems: [],
    sources: [],
    version: null,
    ...over,
  };
}

describe('collectSituationReportData — langage commun L1 (refonte UI étape 2)', () => {
  it('une situation « veille » est jaune, jamais verte', () => {
    expect(collectSituationReportData(ctx()).situations[0].level).toBe('jaune');
  });

  it('l’indice de stabilité est dit en mot L1 (A8)', () => {
    expect(collectSituationReportData(ctx()).stability?.statusLabel).toBe('vigilance orange');
    expect(collectSituationReportData(ctx({ stability: { scores: [], nationalScore: 85, timestamp: new Date(0) } })).stability?.statusLabel)
      .toBe('vigilance rouge');
  });

  it('les signaux officiels rouges sont rouges, violet Météo compris', () => {
    const data = collectSituationReportData(ctx());
    expect(data.domainSignals.find((d) => d.domain.startsWith('Écowatt'))?.level).toBe('rouge');
    expect(data.domainSignals.find((d) => d.domain === 'Vigilance météo')?.level).toBe('rouge');
  });
});
