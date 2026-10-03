import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { detectSituations } from './situation-engine.ts';
import { parisDate } from './ecowatt-official.ts';
import type { FranceRawData } from './france-country-intel.ts';
import type { EcowattOfficial, EcowattSignal } from '../types/index.ts';

// 24/09/2026 10 h à Paris (CEST, UTC+2).
const NOW = Date.parse('2026-09-24T08:00:00Z');

function typed<T>(value: unknown): T {
  return value as T;
}

/** Écowatt est un signal NATIONAL : construit `official` avec un jour = parisDate(NOW). */
function ecowattOfficial(level: EcowattSignal): EcowattOfficial {
  return {
    source: 'rte',
    generatedAt: new Date(NOW).toISOString(),
    days: [{ date: parisDate(NOW), level, message: 'Test', hours: Array.from({ length: 24 }, () => 1) }],
  };
}

function baseRawData(overrides: Partial<FranceRawData> = {}): FranceRawData {
  return {
    newsItems: [],
    isnrData: null,
    cyberData: null,
    meteoAlerts: [],
    floodSegments: [],
    railTrains: [],
    roadEvents: [],
    urbanJamCount: 0,
    powerOutages: [],
    telecomOutages: [],
    defenseAlerts: [],
    jammingSignals: [],
    militaryFlightsCount: 0,
    maritimeCount: 0,
    activeFires: [],
    marketData: [],
    ecowattResponse: null,
    gasState: null,
    nuclearState: null,
    eolienLive: null,
    aisAnomalies: [],
    timeline: { days: [], lanes: [] },
    briefLang: 'fr',
    oilDashboard: null,
    fuelTensionDashboard: null,
    ...overrides,
  };
}

function nominalFixture(): FranceRawData {
  return baseRawData({
    gasState: typed<FranceRawData['gasState']>({
      ecogaz: {
        date: '2026-04-09',
        signal: 'green',
        message: 'Normal',
        forecast: [],
        lastUpdate: new Date('2026-04-09T08:00:00Z'),
      },
      terminals: [],
      storages: [],
      interconnections: [],
      nationalStats: {
        totalStorageCapacityTWh: 100,
        currentStorageTWh: 70,
        averageFillLevel: 70,
        storageTrend: 'stable',
        totalImportGWhDay: 0,
        totalExportGWhDay: 0,
      },
      sourceStatus: { ecogaz: 'ok', grtgaz: 'ok', terega: 'ok', odre: 'ok', agsi: 'ok', alsi: 'ok' },
      lastUpdate: new Date('2026-04-09T08:00:00Z'),
    }),
  });
}

function energyStressFixture(): FranceRawData {
  return baseRawData({
    ecowattResponse: typed<FranceRawData['ecowattResponse']>({
      official: ecowattOfficial('red'),
      mixes: {},
      national: { timestamp: new Date(), nuclear: 30, wind: 1, solar: 1, hydro: 1, gas: 5, other: 2, total: 40 },
      interconnections: [],
    }),
    nuclearState: typed<FranceRawData['nuclearState']>({
      stress: { level: 'TENSION', stressRatio: 0.62 },
    }),
  });
}

function importDependencyFixture(): FranceRawData {
  return baseRawData({
    ecowattResponse: typed<FranceRawData['ecowattResponse']>({
      official: null,
      mixes: {},
      national: { timestamp: new Date(), nuclear: 40, wind: 5, solar: 2, hydro: 4, gas: 10, other: 3, total: 64 },
      interconnections: [
        { country: 'Allemagne', flowMW: 3500, coordinates: [7.5, 49.0] },
        { country: 'Belgique', flowMW: 1500, coordinates: [3.0, 50.0] },
        { country: 'Espagne', flowMW: -500, coordinates: [-1.8, 43.0] },
      ],
    }),
  });
}

function floodFixture(): FranceRawData {
  return baseRawData({
    floodSegments: [
      typed<FranceRawData['floodSegments'][number]>({ id: 'seg-1', name: 'Seine amont', level: 'red' }),
      typed<FranceRawData['floodSegments'][number]>({ id: 'seg-2', name: 'Marne aval', level: 'orange' }),
      typed<FranceRawData['floodSegments'][number]>({ id: 'seg-3', name: 'Oise', level: 'orange' }),
      typed<FranceRawData['floodSegments'][number]>({ id: 'seg-4', name: 'Aisne', level: 'orange' }),
    ],
  });
}

function wildfireFixture(): FranceRawData {
  return baseRawData({
    // La règle ne compte plus les détections au national : elle lit les
    // incidents clusterisés. Un incident au-dessus de la porte 40/300.
    fireIncidents: [
      typed<NonNullable<FranceRawData['fireIncidents']>[number]>({
        id: 'incident-paca',
        centroidLat: 43.5,
        centroidLon: 5.1,
        bboxMinLat: 43.4, bboxMaxLat: 43.6, bboxMinLon: 5.0, bboxMaxLon: 5.2,
        detectionsCount: 120,
        frpMean: 12, frpMax: 90, frpTotal: 1600,
        confidenceMax: 'high',
        startDatetime: '2026-07-26T01:00:00Z',
        endDatetime: '2026-07-26T13:00:00Z',
        durationMinutes: 720,
        satellites: ['SNPP'],
        hasNightDetection: true,
        nearUrban: true,
        clusterMethod: 'dbscan', epsKm: 3, minPoints: 2,
        score: { severityScore: 70, impactScore: 60, labels: [] },
        detectionIds: [],
        deptCodes: ['13'],
        communes: ['Aix-en-Provence'],
      }),
    ],
    meteoAlerts: [
      typed<FranceRawData['meteoAlerts'][number]>({
        department: 'Bouches-du-Rhone',
        departmentCode: '13',
        level: 'orange',
        risks: ['heat', 'wind'],
      }),
    ],
  });
}

function cyberFixture(): FranceRawData {
  return baseRawData({
    cyberData: typed<FranceRawData['cyberData']>({
      meta: { globalScore: 78, trend: 'rising', sources: ['CERT-FR'], lastUpdate: new Date() },
      alerts: {
        count30d: 3,
        latest: [
          { id: 'alert-1', severity: 'critical', title: 'CERT advisory' },
          { id: 'alert-2', severity: 'high', title: 'Sector note' },
        ],
      },
      ransomware: { total30d: 12, topSectors: ['sante'] },
      vulnerabilities: { criticalCount: 4, topCVEs: ['CVE-2026-0001'] },
    }),
  });
}

function socialFixture(): FranceRawData {
  return baseRawData({
    isnrData: typed<FranceRawData['isnrData']>({
      nationalScore: 42,
      timestamp: new Date(),
      scores: [
        { score: 68, eventCount: 12, name: 'Nord', dimensions: { social: 48, security: 55, infra: 20, health: 10 } },
        { score: 61, eventCount: 9, name: 'Bouches-du-Rhone', dimensions: { social: 45, security: 52, infra: 18, health: 12 } },
        { score: 43, eventCount: 7, name: 'Paris', dimensions: { social: 41, security: 35, infra: 15, health: 9 } },
      ],
    }),
  });
}

type Telecom = FranceRawData['telecomOutages'][number];

/** `count` pannes du département `dept`, débutées `ageH` heures avant NOW (null = sans date). */
function telecomBatch(dept: string, count: number, ageH: number | null): Telecom[] {
  const since = ageH === null ? null : new Date(NOW - ageH * 3_600_000).toISOString();
  return Array.from({ length: count }, (_, i) =>
    typed<Telecom>({ id: `tel-${dept}-${ageH}-${i}`, department: dept, operator: 'Orange', since }));
}

function telecomRaw(outages: Telecom[], powerCount = 0): FranceRawData {
  return baseRawData({
    telecomOutages: outages,
    powerOutages: Array.from({ length: powerCount }, (_, i) =>
      typed<FranceRawData['powerOutages'][number]>({ id: `pow-${i}` })),
  });
}

function telecomSituation(raw: FranceRawData) {
  return detectSituations(raw, NOW).find((s) => s.type === 'TELECOM_DISRUPTION');
}

function maritimeFixture(): FranceRawData {
  return baseRawData({
    aisAnomalies: [
      { id: 'silence-1', type: 'radio_silence', severity: 'high', position: [4.85, 43.3], timestamp: Date.now(), mmsis: ['111000111'], description: 'Silence radio · 14 min' },
      { id: 'rendez-1', type: 'rendezvous', severity: 'medium', position: [2.4, 51.05], timestamp: Date.now(), mmsis: ['111000111', '222000222'], description: 'Rendezvous suspect · 1.2 km' },
    ],
  });
}

function defenseFixture(): FranceRawData {
  return baseRawData({
    jammingSignals: [
      typed<FranceRawData['jammingSignals'][number]>({
        id: 'jam-1',
        position: [2.2, 48.8],
        timestamp: Math.round(Date.now() / 1000),
        severity: 'high',
        confidence: 0.9,
        reasons: ['spoofing cluster'],
        affectedIcao24s: ['abc123'],
      }),
    ],
    militaryFlightsCount: 12,
  });
}

function fuelFixture(): FranceRawData {
  return baseRawData({
    fuelTensionDashboard: typed<FranceRawData['fuelTensionDashboard']>({
      national: {
        tensionLevel: 'HIGH',
        anomalyShare: 9.2,
        topDepartments: [
          { departmentName: 'Nord' },
          { departmentName: 'Pas-de-Calais' },
          { departmentName: 'Somme' },
        ],
      },
    }),
    oilDashboard: typed<FranceRawData['oilDashboard']>({
      meta: { status: 'tense', vigilanceScore: 72 },
    }),
  });
}

function assertHasSituation(raw: FranceRawData, type: string, nowMs: number = NOW): void {
  const situations = detectSituations(raw, nowMs);
  assert.ok(
    situations.some((s) => s.type === type),
    `Expected ${type} in ${situations.map((s) => s.type).join(', ') || 'no situations'}`,
  );
}

describe('situation-engine · detectSituations', () => {
  it('nominal data does not emit situations', () => {
    assert.deepEqual(detectSituations(nominalFixture(), NOW), []);
  });

  it('energy stress fixture emits ENERGY_STRESS (Écowatt national : plus de dépendance à des régions)', () => {
    assertHasSituation(energyStressFixture(), 'ENERGY_STRESS', NOW);
  });

  it('signal Écowatt d’un autre jour (pas « aujourd’hui ») → pas de ENERGY_STRESS', () => {
    const situations = detectSituations(energyStressFixture(), NOW + 10 * 24 * 3600_000);
    assert.ok(!situations.some((s) => s.type === 'ENERGY_STRESS'));
  });

  it('electric imports fixture emits IMPORT_DEPENDENCY_RISK', () => {
    assertHasSituation(importDependencyFixture(), 'IMPORT_DEPENDENCY_RISK');
  });

  it('flood fixture emits FLOOD_CRISIS', () => {
    assertHasSituation(floodFixture(), 'FLOOD_CRISIS');
  });

  it('wildfire fixture emits WILDFIRE_ESCALATION', () => {
    assertHasSituation(wildfireFixture(), 'WILDFIRE_ESCALATION');
  });

  it('cyber fixture emits CYBER_PRESSURE', () => {
    assertHasSituation(cyberFixture(), 'CYBER_PRESSURE');
  });

  it('social fixture emits SOCIAL_ESCALATION', () => {
    assertHasSituation(socialFixture(), 'SOCIAL_ESCALATION');
  });

  it('telecom : seuils par département (20 medium, 50 high, 100 critical)', () => {
    assert.equal(telecomSituation(telecomRaw(telecomBatch('59', 19, 2))), undefined);
    assert.equal(telecomSituation(telecomRaw(telecomBatch('59', 20, 2)))?.severity, 'medium');
    assert.equal(telecomSituation(telecomRaw(telecomBatch('59', 49, 2)))?.severity, 'medium');
    assert.equal(telecomSituation(telecomRaw(telecomBatch('59', 50, 2)))?.severity, 'high');
    assert.equal(telecomSituation(telecomRaw(telecomBatch('59', 99, 2)))?.severity, 'high');
    assert.equal(telecomSituation(telecomRaw(telecomBatch('59', 100, 2)))?.severity, 'critical');
  });

  it('telecom : seuils nationaux (300 high, 600 critical) sans concentration', () => {
    const spread = (total: number): Telecom[] =>
      Array.from({ length: total / 10 }, (_, i) => telecomBatch(String(i + 1).padStart(2, '0'), 10, 3)).flat();
    assert.equal(telecomSituation(telecomRaw(spread(290))), undefined);
    assert.equal(telecomSituation(telecomRaw(spread(300)))?.severity, 'high');
    assert.equal(telecomSituation(telecomRaw(spread(600)))?.severity, 'critical');
  });

  it('telecom : frontière des 24 h', () => {
    assert.equal(telecomSituation(telecomRaw(telecomBatch('59', 20, 24)))?.severity, 'medium');
    const justOver = telecomBatch('59', 20, 24).map((o) => ({ ...o, since: new Date(NOW - 24 * 3_600_000 - 1).toISOString() }));
    assert.equal(telecomSituation(telecomRaw(justOver)), undefined);
  });

  it('telecom : sans date, ne compte pas', () => {
    assert.equal(telecomSituation(telecomRaw(telecomBatch('59', 500, null))), undefined);
  });

  it('telecom : un gros stock ancien seul ne donne aucune situation', () => {
    const old = [...telecomBatch('59', 400, 30), ...telecomBatch('34', 300, 24 * 10), ...telecomBatch('75', 300, 24 * 60)];
    assert.equal(telecomSituation(telecomRaw(old)), undefined);
  });

  it('telecom : résumé avec récent, département et stock, sans tiret cadratin', () => {
    const raw = telecomRaw([...telecomBatch('59', 43, 5), ...telecomBatch('34', 10, 5), ...telecomBatch('75', 6, 400)]);
    const s = telecomSituation(raw);
    assert.ok(s);
    assert.ok(s.summary.includes('53\u00a0sites mobiles tombés en 24\u00a0h, dont 43 dans le département Nord (59)'), s.summary);
    assert.ok(s.summary.includes('59\u00a0sites hors service au total dans le fichier ARCEP du jour, pannes anciennes comprises'), s.summary);
    assert.deepEqual(s.affectedZones.slice(0, 2), ['Nord (59)', 'Herault (34)']);
    assert.ok(!s.summary.includes('\u2014'));
  });

  it('telecom : les pannes électriques confirment sans escalader', () => {
    const base = telecomSituation(telecomRaw(telecomBatch('59', 20, 2)));
    const withPower = telecomSituation(telecomRaw(telecomBatch('59', 20, 2), 5));
    assert.equal(withPower?.severity, 'medium');
    assert.ok((withPower?.confidence ?? 0) > (base?.confidence ?? 1));
    assert.equal(telecomSituation(telecomRaw(telecomBatch('59', 19, 2), 9)), undefined);
  });

  it('AIS anomaly fixture emits MARITIME_ANOMALY', () => {
    assertHasSituation(maritimeFixture(), 'MARITIME_ANOMALY');
  });

  it('defense alerts alone do not emit MARITIME_ANOMALY', () => {
    const situations = detectSituations(baseRawData({
      defenseAlerts: [typed<FranceRawData['defenseAlerts'][number]>({ severity: 'high', cableName: 'FLAG Europe' })],
    }));
    assert.ok(!situations.some((s) => s.type === 'MARITIME_ANOMALY'));
  });

  it('defense fixture emits DEFENSE_SIGNAL_ELEVATED', () => {
    assertHasSituation(defenseFixture(), 'DEFENSE_SIGNAL_ELEVATED');
  });

  it('fuel fixture emits FUEL_SUPPLY_RISK', () => {
    assertHasSituation(fuelFixture(), 'FUEL_SUPPLY_RISK');
  });
});

describe('situation-engine · textes en français (refonte UI étape 2, arbitrage A7)', () => {
  it('la situation carburant n’affiche aucune valeur anglaise du moteur', () => {
    const fuel = detectSituations(fuelFixture()).find((s) => s.type === 'FUEL_SUPPLY_RISK');
    assert.ok(fuel);
    const text = [fuel.summary, ...fuel.drivers, ...fuel.recommendedActions.map((a) => a.label)].join(' ');
    assert.ok(!/\b(LOW|MEDIUM|HIGH|CRITICAL|tense)\b/.test(text), text);
    assert.ok(text.includes('Tension carburant forte'), text);
    assert.ok(text.includes('stocks pétroliers sous tension'), text);
  });
});
