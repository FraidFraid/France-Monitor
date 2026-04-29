import assert from 'node:assert/strict';

import { runFrenchMaritimeTerritoryTests } from '../config/frenchMaritimeTerritories.test.ts';
import { detectSituations } from './situation-engine.ts';
import type { FranceRawData } from './france-country-intel.ts';

function typed<T>(value: unknown): T {
  return value as T;
}

function baseRawData(overrides: Partial<FranceRawData> = {}): FranceRawData {
  return {
    newsItems: [],
    isnrData: null,
    cyberData: null,
    meteoAlerts: [],
    floodSegments: [],
    sncfDisruptions: [],
    trafficIncidents: [],
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
      sourceStatus: { ecogaz: 'ok', grtgaz: 'ok', terega: 'ok', odre: 'ok' },
      lastUpdate: new Date('2026-04-09T08:00:00Z'),
    }),
  });
}

function energyStressFixture(): FranceRawData {
  return baseRawData({
    ecowattResponse: typed<FranceRawData['ecowattResponse']>({
      signals: { '11': 'red', '32': 'orange' },
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
      signals: {},
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
    activeFires: Array.from({ length: 6 }, (_, i) =>
      typed<FranceRawData['activeFires'][number]>({
        id: `fire-${i}`,
        latitude: 43.5 + i * 0.01,
        longitude: 5.1 + i * 0.01,
        brightness: 320,
        confidence: 'high',
        timestamp: new Date(),
      }),
    ),
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

function telecomFixture(): FranceRawData {
  return baseRawData({
    telecomOutages: [
      typed<FranceRawData['telecomOutages'][number]>({ id: 'tel-1', department: 'Nord', operator: 'Orange' }),
      typed<FranceRawData['telecomOutages'][number]>({ id: 'tel-2', department: 'Pas-de-Calais', operator: 'SFR' }),
      typed<FranceRawData['telecomOutages'][number]>({ id: 'tel-3', department: 'Somme', operator: 'Free' }),
    ],
    powerOutages: [
      typed<FranceRawData['powerOutages'][number]>({ id: 'pow-1' }),
      typed<FranceRawData['powerOutages'][number]>({ id: 'pow-2' }),
      typed<FranceRawData['powerOutages'][number]>({ id: 'pow-3' }),
    ],
  });
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

function assertHasSituation(raw: FranceRawData, type: string): void {
  const situations = detectSituations(raw);
  assert.ok(
    situations.some((s) => s.type === type),
    `Expected ${type} in ${situations.map((s) => s.type).join(', ') || 'no situations'}`,
  );
}

export async function runSituationEngineTests(): Promise<void> {
  const cases: Array<{ name: string; run: () => void }> = [
    {
      name: 'French maritime territories geofence DROM and metro waters',
      run: () => runFrenchMaritimeTerritoryTests(),
    },
    {
      name: 'nominal data does not emit situations',
      run: () => {
        assert.deepEqual(detectSituations(nominalFixture()), []);
      },
    },
    {
      name: 'energy stress fixture emits ENERGY_STRESS',
      run: () => assertHasSituation(energyStressFixture(), 'ENERGY_STRESS'),
    },
    {
      name: 'electric imports fixture emits IMPORT_DEPENDENCY_RISK',
      run: () => assertHasSituation(importDependencyFixture(), 'IMPORT_DEPENDENCY_RISK'),
    },
    {
      name: 'flood fixture emits FLOOD_CRISIS',
      run: () => assertHasSituation(floodFixture(), 'FLOOD_CRISIS'),
    },
    {
      name: 'wildfire fixture emits WILDFIRE_ESCALATION',
      run: () => assertHasSituation(wildfireFixture(), 'WILDFIRE_ESCALATION'),
    },
    {
      name: 'cyber fixture emits CYBER_PRESSURE',
      run: () => assertHasSituation(cyberFixture(), 'CYBER_PRESSURE'),
    },
    {
      name: 'social fixture emits SOCIAL_ESCALATION',
      run: () => assertHasSituation(socialFixture(), 'SOCIAL_ESCALATION'),
    },
    {
      name: 'telecom fixture emits TELECOM_DISRUPTION',
      run: () => assertHasSituation(telecomFixture(), 'TELECOM_DISRUPTION'),
    },
    {
      name: 'AIS anomaly fixture emits MARITIME_ANOMALY',
      run: () => assertHasSituation(maritimeFixture(), 'MARITIME_ANOMALY'),
    },
    {
      name: 'defense alerts alone do not emit MARITIME_ANOMALY',
      run: () => {
        const situations = detectSituations(baseRawData({
          defenseAlerts: [typed<FranceRawData['defenseAlerts'][number]>({ severity: 'high', cableName: 'FLAG Europe' })],
        }));
        assert.ok(!situations.some((s) => s.type === 'MARITIME_ANOMALY'));
      },
    },
    {
      name: 'defense fixture emits DEFENSE_SIGNAL_ELEVATED',
      run: () => assertHasSituation(defenseFixture(), 'DEFENSE_SIGNAL_ELEVATED'),
    },
    {
      name: 'fuel fixture emits FUEL_SUPPLY_RISK',
      run: () => assertHasSituation(fuelFixture(), 'FUEL_SUPPLY_RISK'),
    },
  ];

  for (const testCase of cases) {
    testCase.run();
    console.log(`ok - ${testCase.name}`);
  }
}
