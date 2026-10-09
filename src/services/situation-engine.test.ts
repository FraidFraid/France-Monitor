import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { cableAlertSituations, detectSituations, militaryEmergencyAlerts } from './situation-engine.ts';
import {
  CABLES_WATCH_ALERTS_FIXTURE, CYBER_FIXTURE, MILITARY_EMERGENCY_FIXTURE, MILITARY_FRENCH_EMERGENCY_FIXTURE, SOV_FIXTURE_NOW,
} from '../components/layer-panel/sovereignty.fixture.ts';
import { parisDate } from './ecowatt-official.ts';
import type { FranceRawData } from './france-country-intel.ts';
import type { EcowattOfficial, EcowattSignal, TelecomOutagesResponse } from '../types/index.ts';
import { telecomFixtureResponse } from '../components/layer-panel/outages.fixture.ts';

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
    cyber: null,
    meteoAlerts: [],
    floodSegments: [],
    railTrains: [],
    roadEvents: [],
    urbanJamCount: 0,
    telecomOutages: null,
    cableAlerts: [],
    gnssDegraded: null,
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
      stress: { level: 'TENSION', stressRatio: 0.06, unplannedLostMW: 3_600 },
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

/** Vigilance cyber du 04/10 (jeu d'essai de la tâche A9) : ALE-011, ALE-010 et ALE-009 en cours, ALE-011 publiée le 28/09. */
function cyberFixture(): FranceRawData {
  return baseRawData({ cyber: CYBER_FIXTURE() });
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

/** Réponse Télécoms du 08/10 dont le compte des pannes récentes et leur répartition par département sont posés (le reste du jeu d'essai est gardé). */
function telecomResponse(byDept: Array<[string | null, number]>, recent: number = byDept.reduce((n, [, c]) => n + c, 0)): TelecomOutagesResponse {
  const t = telecomFixtureResponse();
  assert.ok(t.summary);
  return { ...t, summary: { ...t.summary, recent }, byDept: byDept.map(([dept, count]) => ({ dept, recent: count })) };
}

function telecomRaw(t: TelecomOutagesResponse | null): FranceRawData {
  return baseRawData({ telecomOutages: t });
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

/** Urgence du 04/10 où RCH161 affiche 7500 sur deux relevés au-dessus du Finistère (O7 : seul un 7500 confirmé ouvre la situation). */
function defenseFixture(): FranceRawData {
  return baseRawData({
    militaryEmergencies: MILITARY_EMERGENCY_FIXTURE().emergencies
      .filter((e) => e.squawk === '7700')
      .map((e) => ({ ...e, squawk: '7500' as const })),
    militaryFlightsCount: 10,
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
    assertHasSituation(cyberFixture(), 'CYBER_PRESSURE', SOV_FIXTURE_NOW);
  });

  it('social fixture emits SOCIAL_ESCALATION', () => {
    assertHasSituation(socialFixture(), 'SOCIAL_ESCALATION');
  });

  it('telecom : seuils par département (20 medium, 50 high, 100 critical)', () => {
    const one = (count: number) => telecomSituation(telecomRaw(telecomResponse([['59', count]])));
    assert.equal(one(19), undefined);
    assert.equal(one(20)?.severity, 'medium');
    assert.equal(one(49)?.severity, 'medium');
    assert.equal(one(50)?.severity, 'high');
    assert.equal(one(99)?.severity, 'high');
    assert.equal(one(100)?.severity, 'critical');
  });

  it('telecom : seuils nationaux (300 high, 600 critical) sans concentration', () => {
    const spread = (total: number) =>
      telecomRaw(telecomResponse(Array.from({ length: total / 10 }, (_, i) => [String(i + 1).padStart(2, '0'), 10] as [string, number])));
    assert.equal(telecomSituation(spread(290)), undefined);
    assert.equal(telecomSituation(spread(300))?.severity, 'high');
    assert.equal(telecomSituation(spread(600))?.severity, 'critical');
  });

  it('telecom : 264 sites tombés en 24 h dont 28 en Haute-Corse : sévérité moyenne, phrase du résumé', () => {
    const t = telecomResponse([['2B', 28]], 264);
    assert.ok(t.summary);
    const s = telecomSituation(telecomRaw(t));
    assert.ok(s);
    assert.equal(s.severity, 'medium');
    assert.ok(s.summary.includes('264\u00a0sites mobiles tombés en 24\u00a0h, dont 28 dans le département Haute-Corse (2B)'), s.summary);
    assert.ok(s.summary.includes(`${t.summary.total.toLocaleString('fr-FR').replace(/[\u202f\u00a0 ]/g, '\u00a0')}\u00a0sites hors service au total dans le fichier ARCEP, pannes anciennes et maintenances comprises`), s.summary);
    assert.deepEqual(s.affectedZones, ['Haute-Corse (2B)']);
    assert.deepEqual(s.sourceRefs, ['ARCEP']);
  });

  it('telecom : fichier non lu (null) ou sans résumé : aucune situation, jamais « 0 site »', () => {
    assert.equal(telecomSituation(telecomRaw(null)), undefined);
    const t = telecomResponse([['59', 500]]);
    assert.equal(telecomSituation(telecomRaw({ ...t, summary: null })), undefined);
  });

  it('telecom : un gros stock ancien seul ne donne aucune situation (aucune panne récente)', () => {
    const t = telecomResponse([], 0);
    assert.ok(t.summary);
    assert.equal(telecomSituation(telecomRaw({ ...t, summary: { ...t.summary, total: 1056, long: 900, maintenance: 156 } })), undefined);
  });

  it('telecom : résumé avec récent, département et stock, sans tiret cadratin', () => {
    const t = telecomResponse([['59', 43], ['34', 10]]);
    assert.ok(t.summary);
    const s = telecomSituation(telecomRaw({ ...t, summary: { ...t.summary, recent: 53, total: 59 } }));
    assert.ok(s);
    assert.ok(s.summary.includes('53\u00a0sites mobiles tombés en 24\u00a0h, dont 43 dans le département Nord (59)'), s.summary);
    assert.ok(s.summary.includes('59\u00a0sites hors service au total dans le fichier ARCEP, pannes anciennes et maintenances comprises'), s.summary);
    assert.deepEqual(s.affectedZones.slice(0, 2), ['Nord (59)', 'Hérault (34)']);
    assert.ok(!s.summary.includes('\u2014'));
  });

  it('telecom : départements accentués, Corse (2A, 2B) ; un département non renseigné n’est jamais classé ni affiché', () => {
    const corse = telecomSituation(telecomRaw(telecomResponse([['2A', 25], ['2B', 4], ['07', 2], [null, 30]])));
    assert.ok(corse);
    assert.deepEqual(corse.affectedZones, ['Corse-du-Sud (2A)', 'Haute-Corse (2B)', 'Ardèche (07)']);
    assert.ok(corse.summary.includes('dont 25 dans le département Corse-du-Sud (2A)'), corse.summary);
    assert.ok(!JSON.stringify(corse).includes('Inconnu'));
    assert.ok(!JSON.stringify(corse).includes('non précisé'));
  });

  it('telecom : sévérité nationale sans département classé : phrase sans « dont »', () => {
    const s = telecomSituation(telecomRaw(telecomResponse([[null, 320]])));
    assert.equal(s?.severity, 'high');
    assert.ok(!s?.summary.includes('dont'), s?.summary);
    assert.deepEqual(s?.affectedZones, ['France']);
  });

  it('telecom : les pannes électriques n’interviennent plus (ni dans les motifs, ni dans la confiance)', () => {
    const s = telecomSituation(telecomRaw(telecomResponse([['59', 20]])));
    assert.equal(s?.severity, 'medium');
    assert.equal(s?.drivers.length, 2);
    assert.ok(!JSON.stringify(s).includes('électrique'));
  });

  it('énergie : Écowatt orange sans nucléaire tendu ni vent faible : « Tension énergétique » ne s’ouvre plus (plus de confirmation par des pannes électriques)', () => {
    const raw = baseRawData({
      ecowattResponse: typed<FranceRawData['ecowattResponse']>({
        official: ecowattOfficial('orange'), mixes: {}, national: { timestamp: new Date(), nuclear: 30, wind: 8, solar: 1, hydro: 1, gas: 5, other: 2, total: 47 }, interconnections: [],
      }),
    });
    assert.ok(!detectSituations(raw, NOW).some((s) => s.type === 'ENERGY_STRESS'));
  });

  it('énergie : avec nucléaire tendu, elle s’ouvre et ne cite aucune panne électrique', () => {
    const s = detectSituations(energyStressFixture(), NOW).find((x) => x.type === 'ENERGY_STRESS');
    assert.ok(s);
    assert.ok(s.drivers.some((d) => d.includes('Parc nucléaire dégradé')));
    assert.ok(!JSON.stringify(s).includes('panne'));
  });

  it('AIS anomaly fixture emits MARITIME_ANOMALY', () => {
    assertHasSituation(maritimeFixture(), 'MARITIME_ANOMALY');
  });

  it('defense alerts alone do not emit MARITIME_ANOMALY', () => {
    const situations = detectSituations(baseRawData({
      cableAlerts: CABLES_WATCH_ALERTS_FIXTURE().alerts.filter((a) => a.confirmed),
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

describe('situation-engine · souveraineté (spec 2026-10-04 souveraineté § 2.4 ; contrats § 6 ; amendement 7, O3, O4, O7, S14, S15)', () => {
  it('« Signal défense » (O7) : 7500 affiché sur deux relevés au-dessus du Finistère, moyenne, à confirmer par les autorités', () => {
    const s = detectSituations(defenseFixture(), SOV_FIXTURE_NOW).find((x) => x.type === 'DEFENSE_SIGNAL_ELEVATED');
    assert.equal(s?.severity, 'medium');
    assert.equal(s?.title, 'Signal défense');
    assert.equal(s?.summary, 'Code 7500 affiché par le transpondeur, à confirmer par les autorités : RCH161 (C17) · Dépt\u00a029.');
    assert.deepEqual(s?.affectedZones, ['Dépt\u00a029']);
    assert.deepEqual(s?.sourceRefs, ['adsb.lol']);
    assert.deepEqual(s?.activateLayers, ['military']);
    assert.deepEqual([s?.lat, s?.lon], [48.2, -4.1]);
    assert.doesNotMatch(JSON.stringify(s), /OpenSky|vols militaires|GPS|au-dessus de la France/);
  });
  it('« Signal défense » (O7) : 7700 et 7600 confirmés, 7500 vu une fois : aucune situation (panneau et moniteur seulement)', () => {
    const [e7700, e7500] = MILITARY_EMERGENCY_FIXTURE().emergencies;
    assert.ok(e7700 && e7500);
    for (const emergencies of [[e7700], [{ ...e7700, squawk: '7600' as const }], [e7500]]) {
      assert.ok(!detectSituations(baseRawData({ militaryEmergencies: emergencies }), SOV_FIXTURE_NOW).some((x) => x.type === 'DEFENSE_SIGNAL_ELEVATED'));
    }
  });
  it('« Signal défense » (décision du 08/10/2026) : 7500 d’un appareil français nommé, avec son département et sa position', () => {
    const french = MILITARY_FRENCH_EMERGENCY_FIXTURE().emergencies
      .filter((e) => e.family === 'francais')
      .map((e) => ({ ...e, squawk: '7500' as const }));
    const s = detectSituations(baseRawData({ militaryEmergencies: french }), SOV_FIXTURE_NOW).find((x) => x.type === 'DEFENSE_SIGNAL_ELEVATED');
    assert.equal(s?.summary, 'Code 7500 affiché par le transpondeur, à confirmer par les autorités : FICTIF04 (EC45, appareil français) · Dépt\u00a069.');
    assert.deepEqual([s?.lat, s?.lon], [45.87, 4.64]);
    assert.deepEqual(s?.coveredAlertIds, ['military-emergency-3bf004-7500']);
  });
  it('« Signal défense » (décision du 08/10/2026) : 7500 d’un appareil marqué PIA sans indicatif : l’adresse est nommée, avec sa position', () => {
    const pia = MILITARY_FRENCH_EMERGENCY_FIXTURE().emergencies
      .filter((e) => e.icao24 === '44f684')
      .map((e) => ({ ...e, callsign: null, firstSeen: '2026-10-04T14:46:24.501Z' }));
    assert.equal(pia.length, 1);
    const s = detectSituations(baseRawData({ militaryEmergencies: pia }), SOV_FIXTURE_NOW).find((x) => x.type === 'DEFENSE_SIGNAL_ELEVATED');
    assert.equal(s?.summary, 'Code 7500 affiché par le transpondeur, à confirmer par les autorités : adresse 44f684 (A400) · Dépt\u00a064.');
    assert.deepEqual([s?.lat, s?.lon], [43.381472, -0.468554]);
  });
  it('« Précision GNSS dégradée » (O7, O15, S15, tâche B28) : 3 mailles GNSS sur 24 h, moyenne ; élevée sur deux jours UTC complets de suite ; DGAC et ANFR', () => {
    const now = detectSituations(baseRawData({ gnssDegraded: { rolling24h: 3, previousUtcDays: [3, null] } }), SOV_FIXTURE_NOW)
      .find((x) => x.type === 'DEFENSE_SIGNAL_ELEVATED');
    assert.equal(now?.severity, 'medium');
    assert.equal(now?.title, 'Précision GNSS dégradée');
    assert.equal(now?.summary, '3\u00a0mailles à précision GNSS dégradée sur 24\u00a0h, à vérifier.');
    assert.deepEqual(now?.affectedZones, ['France']);
    assert.ok(now?.recommendedActions.some((a) => a.label === 'Signaler à la DGAC et à l’ANFR, seules à qualifier un brouillage'));
    assert.doesNotMatch(JSON.stringify(now), /brouillage mesuré|Brouillage GNSS/);
    const twoDays = detectSituations(baseRawData({ gnssDegraded: { rolling24h: 4, previousUtcDays: [3, 5] } }), SOV_FIXTURE_NOW);
    assert.equal(twoDays.find((x) => x.type === 'DEFENSE_SIGNAL_ELEVATED')?.severity, 'high');
    const few = detectSituations(baseRawData({ gnssDegraded: { rolling24h: 2, previousUtcDays: [3, 5] } }), SOV_FIXTURE_NOW);
    assert.ok(!few.some((x) => x.type === 'DEFENSE_SIGNAL_ELEVATED'));
  });
  it('« Signal défense » : 30 aéronefs sans urgence ni maille GNSS ne font aucune situation (un aéronef observé n’est pas un événement)', () => {
    const situations = detectSituations(baseRawData({ militaryFlightsCount: 30 }), SOV_FIXTURE_NOW);
    assert.ok(!situations.some((x) => x.type === 'DEFENSE_SIGNAL_ELEVATED'));
  });
  it('« Vigilance cyber » du 04/10 (S14) : une alerte publiée depuis moins de 7 jours, moyenne ; facteurs datés, exploitation dite (O3)', () => {
    const s = detectSituations(cyberFixture(), SOV_FIXTURE_NOW).find((x) => x.type === 'CYBER_PRESSURE');
    assert.equal(s?.severity, 'medium');
    assert.equal(s?.title, 'Vigilance cyber');
    assert.equal(s?.confidence, 0.85);
    assert.equal(s?.summary, '3\u00a0alertes CERT-FR en cours ; 3\u00a0avis citant une vulnérabilité ajoutée au catalogue KEV depuis moins de 7\u00a0jours.');
    assert.deepEqual(s?.drivers, [
      'CERTFR-2026-ALE-011 : Citrix NetScaler ADC et Gateway, publiée le 28/09, dernière version le 30/09, exploitation signalée par le CERT-FR',
      'CERTFR-2026-ALE-010 : Metabase, publiée le 10/09, exploitation signalée par le CERT-FR',
      'CERTFR-2026-ALE-009 : SonicWall Secure Mobile Access, publiée le 02/09, exploitation signalée par le CERT-FR',
      '3\u00a0avis citant une vulnérabilité ajoutée au catalogue KEV depuis moins de 7\u00a0jours : CERTFR-2026-AVI-1257, CERTFR-2026-AVI-1246, CERTFR-2026-AVI-1236',
      '7\u00a0vulnérabilités exploitées citées par le CERT-FR (catalogue KEV de la CISA, 30\u00a0jours)',
    ]);
    assert.deepEqual(s?.sourceRefs, ['CERT-FR', 'CISA KEV']);
    assert.ok(s?.recommendedActions.some((a) => a.label === 'Relayer l’alerte aux services et opérateurs concernés'));
    assert.equal(s?.linkUrl, 'https://www.cert.ssi.gouv.fr/alerte/CERTFR-2026-ALE-011/');
    assert.doesNotMatch(JSON.stringify(s), /Shodan|Censys|NVD|FrenchBreaches|RansomwareLive|Score cyber|[Ff]aille|pas d’exploitation connue|Pression cyber/);
  });
  it('« Vigilance cyber » : élevée pour deux alertes en cours publiées en moins de 7 jours, jamais critique ; revendications : moyenne au plus (O4)', () => {
    const two = CYBER_FIXTURE();
    two.certfr.alerts = two.certfr.alerts.map((a) => (a.ref === 'CERTFR-2026-ALE-010' ? { ...a, firstVersion: '2026-10-01' } : a));
    const high = detectSituations(baseRawData({ cyber: two }), SOV_FIXTURE_NOW).find((x) => x.type === 'CYBER_PRESSURE');
    assert.equal(high?.severity, 'high');
    // Trois alertes en cours publiées en moins de 7 jours, revendications au plus haut : toujours élevée, jamais critique (indice gelé à 55).
    const three = CYBER_FIXTURE();
    three.certfr.alerts = three.certfr.alerts.map((a) => (a.status === 'en-cours' ? { ...a, firstVersion: '2026-10-02' } : a));
    if (three.ransomware) three.ransomware.ratio = 4.5;
    assert.equal(detectSituations(baseRawData({ cyber: three }), SOV_FIXTURE_NOW).find((x) => x.type === 'CYBER_PRESSURE')?.severity, 'high');
    const red = CYBER_FIXTURE();
    if (red.ransomware) red.ransomware.ratio = 3.2;
    const withClaims = detectSituations(baseRawData({ cyber: red }), SOV_FIXTURE_NOW).find((x) => x.type === 'CYBER_PRESSURE');
    assert.equal(withClaims?.severity, 'medium');
    // Alertes et revendications ensemble : le lien de l'alerte CERT-FR d'abord.
    assert.equal(withClaims?.linkUrl, 'https://www.cert.ssi.gouv.fr/alerte/CERTFR-2026-ALE-011/');
    assert.deepEqual(withClaims?.sourceRefs, ['CERT-FR', 'CISA KEV', 'Ransomware.live']);
    const quiet = CYBER_FIXTURE();
    quiet.certfr.alerts = quiet.certfr.alerts.map((a) => ({ ...a, status: 'cloturee' as const }));
    quiet.certfr.avis = quiet.certfr.avis.map((a) => ({ ...a, kevCves: [] }));
    assert.ok(!detectSituations(baseRawData({ cyber: quiet }), SOV_FIXTURE_NOW).some((x) => x.type === 'CYBER_PRESSURE'));
    if (quiet.ransomware) quiet.ransomware.ratio = 3.2;
    const claims = detectSituations(baseRawData({ cyber: quiet }), SOV_FIXTURE_NOW).find((x) => x.type === 'CYBER_PRESSURE');
    assert.equal(claims?.severity, 'medium');
    // Ouverte par les seules revendications : ni source, ni action, ni facteur du CERT-FR (m3).
    assert.deepEqual(claims?.sourceRefs, ['Ransomware.live']);
    assert.deepEqual(claims?.drivers, ['revendications de la semaine (revendiquées par les groupes, non confirmées) : 3,2\u00a0fois la moyenne · Source : Ransomware.live']);
    assert.deepEqual(claims?.recommendedActions.map((a) => a.label), [
      'Vérifier les revendications auprès du CSIRT régional', 'Vérifier les secteurs critiques visés (santé, énergie, administration)',
    ]);
    assert.doesNotMatch(JSON.stringify(claims), /CERT-FR|Relayer l’alerte/);
    assert.equal(claims?.linkUrl, 'https://www.ransomware.live/t&c');
    assert.equal(claims?.linkLabel, 'Source : Ransomware.live');
    if (quiet.ransomware) quiet.ransomware.lastModified = new Date(SOV_FIXTURE_NOW - 25 * 3_600_000).toISOString();
    assert.ok(!detectSituations(baseRawData({ cyber: quiet }), SOV_FIXTURE_NOW).some((x) => x.type === 'CYBER_PRESSURE'));
  });
  it('« Vigilance cyber » ouverte par des avis KEV seuls : avis du CERT-FR lus, lien vers le premier avis, jamais « Relayer l’alerte »', () => {
    const avis = CYBER_FIXTURE();
    avis.certfr.alerts = avis.certfr.alerts.map((a) => ({ ...a, status: 'cloturee' as const }));
    const s = detectSituations(baseRawData({ cyber: avis }), SOV_FIXTURE_NOW).find((x) => x.type === 'CYBER_PRESSURE');
    assert.equal(s?.severity, 'medium');
    assert.deepEqual(s?.recommendedActions.map((a) => a.label), ['Lire les avis du CERT-FR et appliquer les correctifs publiés']);
    assert.deepEqual([s?.linkLabel, s?.sourceRefs], ['Avis CERTFR-2026-AVI-1257', ['CERT-FR', 'CISA KEV']]);
  });
  it('MARITIME_ANOMALY : un navire lent confirmé sur un câble, AIS frais, s’y ajoute ; source « Câbles (Shom, OpenStreetMap) et AIS »', () => {
    const raw = { ...maritimeFixture(), cableAlerts: CABLES_WATCH_ALERTS_FIXTURE().alerts.filter((a) => a.confirmed) };
    const s = detectSituations(raw, SOV_FIXTURE_NOW).find((x) => x.type === 'MARITIME_ANOMALY');
    assert.ok(s?.sourceRefs.includes('Câbles (Shom, OpenStreetMap) et AIS'));
    assert.match(s?.summary ?? '', /avec 1\u00a0navire lent sur un câble\.$/);
    assert.doesNotMatch(JSON.stringify(s), /Subsea cable alerts|haute sévérité/);
    // FX2 : un navire près de deux câbles compte une fois.
    const [one] = raw.cableAlerts;
    assert.ok(one);
    const twin = detectSituations({ ...raw, cableAlerts: [one, { ...one, id: `${one.mmsi}:shom/FR000008471400001`, cableId: 'shom/FR000008471400001', cableName: null }] }, SOV_FIXTURE_NOW)
      .find((x) => x.type === 'MARITIME_ANOMALY');
    assert.match(twin?.summary ?? '', /avec 1\u00a0navire lent sur un câble\.$/);
    assert.ok(twin?.drivers.includes('1\u00a0navire lent confirmé sur un câble en appui, à vérifier'));
  });
  it('moniteur d’alertes : urgences montrées (critique 7500 affiché sur deux relevés, élevée 7700, moyenne vue une fois)', () => {
    const [e7700, e7500] = MILITARY_EMERGENCY_FIXTURE().emergencies;
    assert.ok(e7700 && e7500);
    const alerts = militaryEmergencyAlerts([e7700, e7500]);
    assert.deepEqual(alerts.map((a) => [a.id, a.type, a.severity]), [
      ['military-emergency-ae0805-7700', 'MILITARY_SURGE_ALERT', 'high'],
      ['military-emergency-4b1a2c-7500', 'MILITARY_SURGE_ALERT', 'medium'],
    ]);
    assert.equal(alerts[0]?.title, '7700 (urgence) : RCH161 (C17)');
    assert.equal(alerts[0]?.summary, 'Code 7700 affiché sur deux relevés, au-dessus de la métropole (Dépt\u00a029) ; pays du bloc OACI : États-Unis.');
    assert.deepEqual([alerts[0]?.lat, alerts[0]?.lon, alerts[0]?.entityId], [48.2, -4.1, 'ae0805:7700']);
    assert.equal(alerts[1]?.summary, 'Code 7500 vu une fois, à confirmer, dans les approches de la France (moins de 40\u00a0km) ; pays du bloc OACI : Suisse.');
    const hijack = militaryEmergencyAlerts([{ ...e7500, firstSeen: '2026-10-04T14:46:24.501Z' }])[0];
    assert.equal(hijack?.severity, 'critical');
    assert.equal(hijack?.title, '7500 (intervention illicite) : SUI7500 (PC21)');
    assert.equal(hijack?.summary, 'Code 7500 affiché par le transpondeur sur deux relevés, non confirmé par les autorités, dans les approches de la France (moins de 40\u00a0km) ; pays du bloc OACI : Suisse.');
  });
  it('moniteur d’alertes (décision du 08/10/2026) : urgences d’un appareil français et d’un appareil marqué PIA nommées comme les autres, avec position', () => {
    const emergencies = MILITARY_FRENCH_EMERGENCY_FIXTURE().emergencies;
    const alerts = militaryEmergencyAlerts(emergencies);
    assert.deepEqual(alerts.map((a) => [a.id, a.severity, a.title]), [
      ['military-emergency-44f684-7500', 'medium', '7500 (intervention illicite) : GRZLY21 (A400)'],
      ['military-emergency-3bf004-7700', 'high', '7700 (urgence) : FICTIF04 (EC45, appareil français)'],
    ]);
    assert.equal(alerts[1]?.summary, 'Code 7700 affiché sur deux relevés, au-dessus de la métropole (Dépt\u00a069) ; pays du bloc OACI : France.');
    assert.deepEqual(alerts.map((a) => [a.entityId, a.lat, a.lon]), [['44f684:7500', 43.381472, -0.468554], ['3bf004:7700', 45.87, 4.64]]);
    // Sans indicatif : l'immatriculation, puis l'adresse.
    const [pia, french] = emergencies;
    assert.ok(pia && french);
    assert.equal(militaryEmergencyAlerts([{ ...french, callsign: null }])[0]?.title, '7700 (urgence) : F-ZFIC (EC45, appareil français)');
    assert.equal(militaryEmergencyAlerts([{ ...french, callsign: null, registration: null }])[0]?.title, '7700 (urgence) : adresse 3bf004 (EC45, appareil français)');
    assert.equal(militaryEmergencyAlerts([{ ...pia, callsign: null, type: null }])[0]?.title, '7500 (intervention illicite) : adresse 44f684');
  });
  it('moniteur d’alertes : navire lent confirmé sur un câble, à vérifier ; seule la préfecture maritime qualifie une infraction', () => {
    const cables = cableAlertSituations(CABLES_WATCH_ALERTS_FIXTURE().alerts.filter((a) => a.confirmed));
    assert.deepEqual(cables.map((c) => [c.id, c.type, c.severity, c.title]), [
      ['defense-alert-229000001', 'DEFENSE_ALERT', 'high', 'Navire lent sur un câble : CARGO ESSAI (AMITIE)'],
    ]);
    assert.equal(cables[0]?.summary, 'À 304\u00a0m du tracé, 1\u00a0nœud, confirmé sur deux relevés AIS : à vérifier ; seule la préfecture maritime qualifie une infraction.');
    assert.deepEqual(cables[0]?.sourceRefs, ['Câbles (Shom, OpenStreetMap) et AIS']);
    const first = CABLES_WATCH_ALERTS_FIXTURE().alerts[0];
    assert.ok(first);
    const shom = cableAlertSituations([{ ...first, cableId: 'shom/FR000008435600001', cableName: null }]);
    assert.equal(shom[0]?.title, 'Navire lent sur un câble : CARGO ESSAI (câble télécom du Shom)');
  });
  it('moniteur d’alertes (FX2) : une entrée par navire, ses câbles listés sans doublon ; position, distance et vitesse du câble le plus proche', () => {
    const first = CABLES_WATCH_ALERTS_FIXTURE().alerts[0];
    assert.ok(first);
    // Relevé du 05/10 : un même navire à 112 m de deux câbles du Shom sans nom, un autre près d'un câble nommé.
    const twinA = { ...first, id: '227000031:shom/FR000008471300001', mmsi: '227000031', name: 'DEUX CABLES ESSAI', cableId: 'shom/FR000008471300001', cableName: null, distanceM: 113, lastSeen: '2026-10-04T14:40:00Z' };
    const twinB = { ...twinA, id: '227000031:shom/FR000008471400001', cableId: 'shom/FR000008471400001', distanceM: 112, lastSeen: '2026-10-04T14:46:00Z' };
    const named = { ...twinA, id: '227000031:way/761201702', cableId: 'way/761201702', cableName: 'BARMAR', distanceM: 420 };
    const cables = cableAlertSituations([first, twinA, twinB, named]);
    assert.deepEqual(cables.map((c) => [c.id, c.title]), [
      ['defense-alert-229000001', 'Navire lent sur un câble : CARGO ESSAI (AMITIE)'],
      ['defense-alert-227000031', 'Navire lent près de 3\u00a0câbles : DEUX CABLES ESSAI (2\u00a0câbles télécom du Shom, BARMAR)'],
    ]);
    const twin = cables[1];
    assert.equal(twin?.summary, 'À 112\u00a0m du tracé le plus proche, 1\u00a0nœud, confirmé sur deux relevés AIS : à vérifier ; seule la préfecture maritime qualifie une infraction.');
    assert.deepEqual(twin?.affectedZones, ['2\u00a0câbles télécom du Shom', 'BARMAR']);
    assert.ok(twin?.drivers.includes('Câbles : 2\u00a0câbles télécom du Shom, BARMAR'));
    assert.equal(twin?.updatedAt.toISOString(), '2026-10-04T14:46:00.000Z');
    assert.deepEqual([twin?.lat, twin?.lon], [twinB.lat, twinB.lon]);
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
