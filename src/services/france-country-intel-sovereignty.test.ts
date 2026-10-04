// src/services/france-country-intel-sovereignty.test.ts
// Entrées Souveraineté du score France (spec 2026-10-04 souveraineté § 2.4 ; contrats § 6 ; amendement 7, O4, O6 à O9, S14) : formule,
// poids et plafonds inchangés (aucune cible de france-country-intel.test.ts n'est touchée), seules les entrées changent. Jeux d'essai du
// 04/10 (tâche A9).
import { describe, expect, it } from 'vitest';
import {
  CABLES_WATCH_ALERTS_FIXTURE, CABLES_WATCH_FIXTURE, CABLES_WATCH_FROZEN_FIXTURE, CYBER_FIXTURE, MILITARY_EMERGENCY_FIXTURE, MILITARY_FIXTURE,
  MILITARY_MASKED_EMERGENCY_FIXTURE, SOV_FIXTURE_NOW,
} from '../components/layer-panel/sovereignty.fixture.ts';
import type { MilitaryResponse } from '../types/index.ts';
import { buildFranceCountrySnapshot, buildFranceSignals, computeFranceScoreBreakdown, type FranceRawData } from './france-country-intel.ts';
import { briefSignalCounts, buildDeterministicBrief } from './france-intel-brief.ts';
import { buildSovereigntyInputs } from './sovereignty-inputs.ts';

const NOW = SOV_FIXTURE_NOW;

function raw(over: Partial<FranceRawData> = {}): FranceRawData {
  return {
    newsItems: [], isnrData: null, cyber: null, meteoAlerts: [], floodSegments: [], railTrains: [], roadEvents: [], urbanJamCount: 0,
    powerOutages: [], telecomOutages: [], cableAlerts: [], gnssDegraded: null, militaryFlightsCount: 0, maritimeCount: 0, activeFires: [],
    marketData: [], ecowattResponse: null, gasState: null, nuclearState: null, eolienLive: null, aisAnomalies: [], timeline: { days: [], lanes: [] },
    briefLang: 'fr', oilDashboard: null, fuelTensionDashboard: null, ...over,
  };
}

const sov04 = () => buildSovereigntyInputs(MILITARY_FIXTURE(), CABLES_WATCH_FIXTURE(), CYBER_FIXTURE(), NOW);

/** Relevé du 04/10 où l'urgence confirmée de RCH161 affiche 7500 au lieu de 7700 (deux relevés, Finistère). */
function hijackFixture(): MilitaryResponse {
  const m = MILITARY_EMERGENCY_FIXTURE();
  m.emergencies = m.emergencies.map((e) => (e.squawk === '7700' ? { ...e, squawk: '7500' as const } : e));
  return m;
}

describe('score France : entrées Souveraineté (formule inchangée)', () => {
  it('04/10 : 9 aéronefs dont 4 français, aucune alerte câble, 3 alertes CERT-FR en cours et 3 avis KEV récents, 7 vulnérabilités citées', () => {
    const s = buildFranceSignals(raw(sov04()), NOW);
    expect(s).toMatchObject({
      militaryFlights: 9, militaryFrench: 4, defenseAlerts: 0, defenseHigh: 0, jammingSignals: 0, cyberAlerts: 6, cyberCritical: 7,
      cyberOpenAlerts: 3, militaryUnavailable: false, cablesUnavailable: false, cyberUnavailable: false, defensePillLevel: 'vert',
      cyberPillLevel: 'orange',
    });
  });
  it('04/10 : aucun « Signal défense », « Vigilance cyber » moyenne (une alerte seule, S14), aucun plafond ; pression cyber 28', () => {
    const snap = buildFranceCountrySnapshot(raw(sov04()), { now: NOW });
    expect(snap.situations.some((x) => x.type === 'DEFENSE_SIGNAL_ELEVATED')).toBe(false);
    const cyber = snap.situations.find((x) => x.type === 'CYBER_PRESSURE');
    expect([cyber?.title, cyber?.severity]).toEqual(['Vigilance cyber', 'medium']);
    expect(snap.scoreBreakdown.situationCap).toBeNull();
    expect(snap.cyberScore).toBe(28);
    expect(snap.briefContext.cyberScore).toBe(28);
    expect(snap.axes.defense).toBe(0);
  });
  it('9 aéronefs ne pèsent rien ; au-delà de 10, la composante des aéronefs (O9) ; mailles GNSS : « précision GNSS dégradée »', () => {
    const data = raw({ militaryFlightsCount: 25, gnssDegraded: { rolling24h: 2, previousUtcDays: [null, null] } });
    const b = computeFranceScoreBreakdown(data, buildFranceSignals(data, NOW), null, [], null, NOW);
    const labels = b.pillars.find((p) => p.key === 'defense')?.components.map((c) => c.label) ?? [];
    expect(labels).toEqual(expect.arrayContaining([
      'Précision GNSS dégradée (mailles)', 'Aéronefs militaires ou d’État visibles en ADS-B au-dessus de la métropole',
    ]));
    expect(JSON.stringify(b)).not.toMatch(/Vols militaires|Brouillage|brouillage mesuré|au-dessus de la France/);
    const nine = raw({ militaryFlightsCount: 9 });
    expect(computeFranceScoreBreakdown(nine, buildFranceSignals(nine, NOW), null, [], null, NOW).pillars.find((p) => p.key === 'defense')?.value).toBe(0);
  });
  it('AIS muet pendant une alerte câble (Review Focus 2) : aucune alerte au score, câbles indisponibles ; AIS frais : l’alerte confirmée compte', () => {
    const frozen = buildFranceSignals(raw(buildSovereigntyInputs(MILITARY_FIXTURE(), CABLES_WATCH_FROZEN_FIXTURE(), CYBER_FIXTURE(), NOW)), NOW);
    expect(frozen).toMatchObject({ defenseAlerts: 0, defenseHigh: 0, cablesUnavailable: true });
    const fresh = buildFranceSignals(raw(buildSovereigntyInputs(MILITARY_FIXTURE(), CABLES_WATCH_ALERTS_FIXTURE(), CYBER_FIXTURE(), NOW)), NOW);
    expect(fresh).toMatchObject({ defenseAlerts: 1, defenseHigh: 1, cablesUnavailable: false });
  });
  it('O7 : 7700 affiché sur deux relevés au-dessus du Finistère : aucune situation (urgence aérienne, panneau et moniteur seulement)', () => {
    const snap = buildFranceCountrySnapshot(raw(buildSovereigntyInputs(MILITARY_EMERGENCY_FIXTURE(), CABLES_WATCH_FIXTURE(), CYBER_FIXTURE(), NOW)), { now: NOW });
    expect(snap.situations.some((x) => x.type === 'DEFENSE_SIGNAL_ELEVATED')).toBe(false);
    expect(snap.signals.militaryFlights).toBe(10);
  });
  it('O7 : 7500 affiché sur deux relevés : « Signal défense » moyen, à confirmer par les autorités ; le 7500 vu une fois à Genève n’entre pas', () => {
    const snap = buildFranceCountrySnapshot(raw(buildSovereigntyInputs(hijackFixture(), CABLES_WATCH_FIXTURE(), CYBER_FIXTURE(), NOW)), { now: NOW });
    const d = snap.situations.filter((x) => x.type === 'DEFENSE_SIGNAL_ELEVATED');
    expect(d).toHaveLength(1);
    expect(d[0]?.severity).toBe('medium');
    expect(d[0]?.summary).toBe('Code 7500 affiché par le transpondeur, à confirmer par les autorités : RCH161 (C17) · Dépt\u00a029.');
    expect(snap.scoreBreakdown.situationCap).toBeNull();
  });
  it('O10 : 7500 d’un appareil d’État français : ni indicatif ni position, le département seul', () => {
    const m = MILITARY_MASKED_EMERGENCY_FIXTURE();
    m.emergencies = m.emergencies.map((e) => (e.family === 'francais' ? { ...e, squawk: '7500' as const } : e));
    const d = buildFranceCountrySnapshot(raw(buildSovereigntyInputs(m, null, null, NOW)), { now: NOW })
      .situations.find((x) => x.type === 'DEFENSE_SIGNAL_ELEVATED');
    expect(d?.summary).toBe('Code 7500 affiché par le transpondeur, à confirmer par les autorités : appareil d’État français · Dépt\u00a069.');
    expect([d?.lat, d?.lon]).toEqual([undefined, undefined]);
  });
  it('sources indisponibles : listes vides au score, « n.d. » aux tuiles, jamais une valeur inventée', () => {
    const s = buildFranceSignals(raw(buildSovereigntyInputs(null, null, null, NOW)), NOW);
    expect(s).toMatchObject({
      militaryFlights: 0, cyberAlerts: 0, cyberCritical: 0, militaryUnavailable: true, cablesUnavailable: true, cyberUnavailable: true,
      defensePillLevel: 'nd', cyberPillLevel: 'nd',
    });
    const down = buildFranceCountrySnapshot(raw(buildSovereigntyInputs(null, null, null, NOW)), { now: NOW });
    expect([down.cyberScore, down.briefContext.cyberScore]).toEqual([null, null]);
  });
  it('S3 : comptes envoyés au modèle avec les drapeaux des sources non lues ; alertes en cours et avis KEV à part (m1)', () => {
    const day = briefSignalCounts(buildFranceSignals(raw(sov04()), NOW));
    expect(day).toMatchObject({
      cyberAlerts: 6, cyberOpenAlerts: 3, cyberKevAdvisories: 3, militaryFlights: 9, defenseAlerts: 0, jammingSignals: 0,
      militaryUnavailable: false, cablesUnavailable: false, cyberUnavailable: false, kevUnavailable: false,
      // Phase A : aucune grille GNSS mesurée.
      gnssUnavailable: true,
    });
    const down = briefSignalCounts(buildFranceSignals(raw(buildSovereigntyInputs(
      { ...MILITARY_FIXTURE(), readAt: '2026-10-04T14:30:00.000Z' }, CABLES_WATCH_FROZEN_FIXTURE(), null, NOW,
    )), NOW));
    expect(down).toMatchObject({ militaryUnavailable: true, cablesUnavailable: true, gnssUnavailable: true, cyberUnavailable: true, kevUnavailable: true });
    const kevLate = CYBER_FIXTURE();
    kevLate.kev.readAt = new Date(NOW - 27 * 3_600_000).toISOString();
    expect(briefSignalCounts(buildFranceSignals(raw(buildSovereigntyInputs(null, null, kevLate, NOW)), NOW)))
      .toMatchObject({ cyberUnavailable: false, kevUnavailable: true, cyberOpenAlerts: 3, cyberKevAdvisories: 0 });
  });
  it('O8 : le brief de repli déterministe ne cite jamais un compte d’aéronefs militaires', () => {
    const data = raw({ ...buildSovereigntyInputs(hijackFixture(), CABLES_WATCH_ALERTS_FIXTURE(), CYBER_FIXTURE(), NOW), militaryFlightsCount: 30 });
    for (const lang of ['fr', 'en'] as const) {
      const text = JSON.stringify(buildDeterministicBrief(buildFranceCountrySnapshot(data, { now: NOW }), lang));
      expect(text).not.toMatch(/\d+\s*(?:aéronefs?|vols?) militaires|\d+\s*military (?:aircraft|flights?)/);
    }
  });
});
