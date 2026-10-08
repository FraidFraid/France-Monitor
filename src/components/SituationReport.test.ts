import { describe, it, expect } from 'vitest';
import { collectSituationReportData, type SituationReportContext } from './SituationReport.ts';
import type { DetectedSituation, EcowattHourValue } from '../types/index.ts';
import { parisDate } from '../services/ecowatt-official.ts';
import { railOverviewFixture, roadNationalFixture } from './layer-panel/traffic.fixture.ts';
import { telecomFixtureResponse } from './layer-panel/outages.fixture.ts';

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
    meteoAlerts: [{ department: 'Var', departmentCode: '83', level: 'red', risks: ['heat'] }],
    floodSegments: [],
    ecowatt: {
      official: {
        source: 'rte',
        generatedAt: new Date(0).toISOString(),
        days: [{ date: parisDate(Date.now()), level: 'red', message: 'Risque de coupures.', hours: Array(24).fill(3) as EcowattHourValue[] }],
      },
      mixes: {}, national: mix, interconnections: [], grid: null,
    },
    railTrains: [],
    roadEvents: [],
    telecomOutages: null,
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

  it('sources santé (hors Watchdog) : période réelle de la donnée à la place de l’âge (S1)', () => {
    const data = collectSituationReportData(ctx({ sources: [{
      sourceId: 'health:syndromic',
      status: { name: 'Santé publique France', status: 'ok', lastUpdate: new Date('2026-09-30T10:01:00Z'), period: 'S39 · publiée le 30/09' },
    }] }));
    expect(data.sources).toEqual([{ label: 'Santé publique France', state: 'ok', ageLabel: 'S39 · publiée le 30/09' }]);
  });

  it('les signaux officiels rouges sont rouges', () => {
    const data = collectSituationReportData(ctx());
    expect(data.domainSignals.find((d) => d.domain.startsWith('Écowatt'))?.level).toBe('rouge');
    expect(data.domainSignals.find((d) => d.domain === 'Vigilance météo')?.level).toBe('rouge');
  });
});

describe('note de situation : signal Transport sur les sources Trafics (spec 2026-10-03 trafics § 2.6)', () => {
  it('trains supprimés ou retardés, accidents et coupures DIR : mêmes phrases ; un train supprimé met le signal en orange', () => {
    const data = collectSituationReportData(ctx({ railTrains: railOverviewFixture().trains, roadEvents: roadNationalFixture().events }));
    const s = data.domainSignals.find((d) => d.domain === 'Transport');
    expect(s?.level).toBe('orange');
    expect(s?.detail).toBe('7 perturbation(s) ferroviaire(s) majeure(s), 5 incident(s) routier(s) majeur(s).');
    expect(collectSituationReportData(ctx()).domainSignals.find((d) => d.domain === 'Transport')).toBeUndefined();
  });
});

describe('note de situation : signal « Pannes réseaux » sur les pannes télécoms récentes (spec 2026-10-08 § 2.3)', () => {
  const withRecent = (recent: number) => {
    const t = telecomFixtureResponse();
    return ctx({ telecomOutages: { ...t, summary: t.summary === null ? null : { ...t.summary, recent } } });
  };
  const signal = (c: SituationReportContext) => collectSituationReportData(c).domainSignals.find((d) => d.domain === 'Pannes réseaux');

  it('antennes en panne imprévue depuis moins de 24 h, avec le jour du fichier ARCEP ; jaune sous 50, orange à partir de 50', () => {
    expect(signal(withRecent(18))).toMatchObject({ level: 'jaune', detail: '18\u00a0antennes en panne imprévue depuis moins de 24\u00a0h (fichier ARCEP du 08/10).' });
    expect(signal(withRecent(1))?.detail).toBe('1\u00a0antenne en panne imprévue depuis moins de 24\u00a0h (fichier ARCEP du 08/10).');
    expect(signal(withRecent(49))?.level).toBe('jaune');
    expect(signal(withRecent(50))?.level).toBe('orange');
  });

  it('aucune panne récente ou fichier non lu : pas de signal, jamais de ligne électrique', () => {
    expect(signal(withRecent(0))).toBeUndefined();
    expect(signal(ctx())).toBeUndefined();
    expect(JSON.stringify(collectSituationReportData(withRecent(60)))).not.toMatch(/électricité|foyers|PDL/);
  });
});
