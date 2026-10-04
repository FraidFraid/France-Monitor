import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { cableAlertSituations, detectSituations, militaryEmergencyAlerts } from './situation-engine.ts';
import {
  CABLES_WATCH_ALERTS_FIXTURE, CYBER_FIXTURE, MILITARY_EMERGENCY_FIXTURE, MILITARY_MASKED_EMERGENCY_FIXTURE, SOV_FIXTURE_NOW,
} from '../components/layer-panel/sovereignty.fixture.ts';
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
    cyber: null,
    meteoAlerts: [],
    floodSegments: [],
    railTrains: [],
    roadEvents: [],
    urbanJamCount: 0,
    powerOutages: [],
    telecomOutages: [],
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
    assert.deepEqual(s.affectedZones.slice(0, 2), ['Nord (59)', 'Hérault (34)']);
    assert.ok(!s.summary.includes('\u2014'));
  });

  it('telecom : départements accentués, Corse (2A, 2B), département absent dit « département non précisé », jamais « Inconnu »', () => {
    const corse = telecomSituation(telecomRaw([...telecomBatch('2A', 25, 3), ...telecomBatch('2B', 4, 3), ...telecomBatch('07', 2, 3)]));
    assert.ok(corse);
    assert.deepEqual(corse.affectedZones, ['Corse-du-Sud (2A)', 'Haute-Corse (2B)', 'Ardèche (07)']);
    assert.ok(corse.summary.includes('dont 25 dans le département Corse-du-Sud (2A)'), corse.summary);
    // ARCEP sans département : « Inconnu » côté adaptateur (outages.ts), ou vide.
    const unknown = telecomSituation(telecomRaw([...telecomBatch('Inconnu', 22, 2), ...telecomBatch('', 3, 2), ...telecomBatch('34', 4, 2)]));
    assert.ok(unknown);
    assert.ok(unknown.summary.includes('29\u00a0sites mobiles tombés en 24\u00a0h, dont 25 sans département précisé'), unknown.summary);
    assert.deepEqual(unknown.affectedZones, ['département non précisé', 'Hérault (34)']);
    assert.ok(!JSON.stringify(unknown).includes('Inconnu'));
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
  it('« Signal défense » (O10) : 7500 d’un appareil d’État français ; ni indicatif, ni adresse, ni position', () => {
    const masked = MILITARY_MASKED_EMERGENCY_FIXTURE().emergencies
      .filter((e) => e.family === 'francais')
      .map((e) => ({ ...e, squawk: '7500' as const }));
    const s = detectSituations(baseRawData({ militaryEmergencies: masked }), SOV_FIXTURE_NOW).find((x) => x.type === 'DEFENSE_SIGNAL_ELEVATED');
    assert.equal(s?.summary, 'Code 7500 affiché par le transpondeur, à confirmer par les autorités : appareil d’État français · Dépt\u00a069.');
    assert.equal(s?.lat, undefined);
    assert.equal(s?.lon, undefined);
  });
  it('« Signal défense » (O7, O15, S15) : 3 mailles GNSS sur 24 h, moyenne ; élevée sur deux jours UTC complets de suite ; DGAC et ANFR', () => {
    const now = detectSituations(baseRawData({ gnssDegraded: { rolling24h: 3, previousUtcDays: [3, null] } }), SOV_FIXTURE_NOW)
      .find((x) => x.type === 'DEFENSE_SIGNAL_ELEVATED');
    assert.equal(now?.severity, 'medium');
    assert.equal(now?.summary, '3\u00a0mailles à précision GNSS dégradée sur 24\u00a0h, à vérifier.');
    assert.deepEqual(now?.affectedZones, ['France']);
    assert.ok(now?.recommendedActions.some((a) => a.label === 'À vérifier auprès de la DGAC et de l’ANFR, seules à qualifier un brouillage'));
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
    assert.match(s?.summary ?? '', /avec 1 alerte\(s\) câbles corrélée\(s\)/);
    assert.doesNotMatch(JSON.stringify(s), /Subsea cable alerts|haute sévérité/);
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
  it('moniteur d’alertes (O10) : urgence masquée dite « appareil d’État français » et son département, sans adresse, indicatif ni position', () => {
    const alerts = militaryEmergencyAlerts(MILITARY_MASKED_EMERGENCY_FIXTURE().emergencies);
    assert.deepEqual(alerts.map((a) => [a.id, a.severity, a.title]), [
      ['military-emergency-masked-7500-2026-10-04T14:48:24.501Z-64', 'medium', '7500 (intervention illicite) : appareil à identité protégée ou de nationalité inconnue · Dépt\u00a064'],
      ['military-emergency-masked-7700-2026-10-04T14:46:24.501Z-69', 'high', '7700 (urgence) : appareil d’État français · Dépt\u00a069'],
    ]);
    assert.equal(alerts[1]?.summary, 'Code 7700 affiché sur deux relevés, au-dessus de la métropole (Dépt\u00a069).');
    for (const a of alerts) {
      assert.equal(a.lat, undefined);
      assert.equal(a.lon, undefined);
      assert.equal(a.entityId, undefined);
    }
  });
  it('moniteur d’alertes : navire lent confirmé sur un câble, à vérifier ; seule la préfecture maritime qualifie une infraction', () => {
    const cables = cableAlertSituations(CABLES_WATCH_ALERTS_FIXTURE().alerts.filter((a) => a.confirmed));
    assert.deepEqual(cables.map((c) => [c.id, c.type, c.severity, c.title]), [
      ['defense-alert-229000001:way/761201757', 'DEFENSE_ALERT', 'high', 'Navire lent sur un câble : CARGO ESSAI (AMITIE)'],
    ]);
    assert.equal(cables[0]?.summary, 'À 304\u00a0m du tracé, 1\u00a0nœud, confirmé sur deux relevés AIS : à vérifier ; seule la préfecture maritime qualifie une infraction.');
    assert.deepEqual(cables[0]?.sourceRefs, ['Câbles (Shom, OpenStreetMap) et AIS']);
    const first = CABLES_WATCH_ALERTS_FIXTURE().alerts[0];
    assert.ok(first);
    const shom = cableAlertSituations([{ ...first, cableId: 'shom/FR000008435600001', cableName: null }]);
    assert.equal(shom[0]?.title, 'Navire lent sur un câble : CARGO ESSAI (câble télécom du Shom)');
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
