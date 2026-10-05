// src/services/situation-engine-sovereignty-b.test.ts : situations et signal du score de la phase B (contrats § 6 ; amendement 7, O7, O15,
// O17, S15). Situation GNSS seule « Précision GNSS dégradée » : moyenne à 3 mailles sur 24 h glissantes, élevée seulement si les deux
// derniers jours UTC complets en comptent chacun autant, jamais critique ; « Signaler à la DGAC et à l’ANFR » ; aucun lieu. Grille du
// 04/10 (2 mailles) : pastille jaune, pas de situation (seuil GNSS_SITUATION_CELLS). Le signal du score compte les mailles des 24 h ;
// Review Focus 3 : l'orage ne donne ni compte, ni situation, ni signal. Aucune cible de france-country-intel.test.ts ne change.
import { describe, expect, it } from 'vitest';
import type { GnssDegradedCounts, GnssResponse, MilitaryEmergency } from '../types/index.ts';
import {
  CABLES_WATCH_FIXTURE, CYBER_FIXTURE, GNSS_FIXTURE, GNSS_STORM_FIXTURE, MILITARY_EMERGENCY_FIXTURE, MILITARY_FIXTURE, SOV_FIXTURE_NOW,
} from '../components/layer-panel/sovereignty.fixture.ts';
import { buildFranceSignals, computeFranceScoreBreakdown, type FranceRawData } from './france-country-intel.ts';
import { detectSituations, militaryEmergencyAlerts } from './situation-engine.ts';
import { buildWorkQueue } from './work-queue.ts';
import { buildSovereigntyInputs } from './sovereignty-inputs.ts';
import { gnssJammingSituations } from './sovereignty-alerts.ts';
import { withGnssInputs } from './sovereignty-inputs-b.ts';
import { GNSS_SITUATION_CELLS, gnssDegradedCounts, isGnssDegradationSustained } from './sovereignty-levels.ts';

const NOW = SOV_FIXTURE_NOW;

function raw(gnssDegraded: GnssDegradedCounts | null, militaryEmergencies: MilitaryEmergency[] = []): FranceRawData {
  return {
    newsItems: [], isnrData: null, cyber: null, meteoAlerts: [], floodSegments: [], railTrains: [], roadEvents: [], urbanJamCount: 0,
    powerOutages: [], telecomOutages: [], cableAlerts: [], gnssDegraded, militaryFlightsCount: 9, militaryEmergencies, maritimeCount: 0,
    activeFires: [], marketData: [], ecowattResponse: null, gasState: null, nuclearState: null, eolienLive: null, aisAnomalies: [],
    timeline: { days: [], lanes: [] }, briefLang: 'fr', oilDashboard: null, fuelTensionDashboard: null,
  };
}
function counts(rolling24h: number, previousUtcDays: [number | null, number | null]): GnssResponse {
  return { ...GNSS_FIXTURE(), degraded: { rolling24h, previousUtcDays } };
}
const defenseSignal = (r: FranceRawData) => detectSituations(r, NOW).find((s) => s.type === 'DEFENSE_SIGNAL_ELEVATED');
/** 7500 affiché sur deux relevés au-dessus du Finistère (urgence confirmée du 04/10, code changé). */
function hijack(): MilitaryEmergency[] {
  return MILITARY_EMERGENCY_FIXTURE().emergencies.filter((e) => e.squawk === '7700').map((e) => ({ ...e, squawk: '7500' as const }));
}

describe('« Précision GNSS dégradée » et signal du score, phase B', () => {
  it('grille du 04/10 (2 mailles) : signal du score à 2, GNSS évalué ; pas de situation sous 3 mailles', () => {
    const cells = gnssDegradedCounts(GNSS_FIXTURE(), NOW);
    expect(cells).toEqual({ rolling24h: 2, previousUtcDays: [2, null] });
    expect(defenseSignal(raw(cells))).toBeUndefined();
    expect(buildFranceSignals(raw(cells), NOW)).toMatchObject({ jammingSignals: 2, gnssUnavailable: false });
  });
  it('3 mailles sur 24 h : « Précision GNSS dégradée » moyenne, sans lieu ; DGAC et ANFR (S15)', () => {
    const s = defenseSignal(raw(gnssDegradedCounts(counts(3, [3, null]), NOW)));
    expect([s?.title, s?.severity]).toEqual(['Précision GNSS dégradée', 'medium']);
    expect(s?.summary).toBe('3\u00a0mailles à précision GNSS dégradée sur 24\u00a0h, à vérifier.');
    expect(s?.recommendedActions.map((a) => a.label)).toEqual(['Signaler à la DGAC et à l’ANFR, seules à qualifier un brouillage']);
    expect(s?.sourceRefs).toEqual(['Grille GNSS (adsb.lol)', 'NOAA SWPC']);
    expect([s?.affectedZones, s?.lat, s?.lon, s?.activateLayers]).toEqual([['France'], undefined, undefined, ['military']]);
    expect(JSON.stringify(s)).not.toMatch(/brouillage mesuré|Brouillage|navigation dégradée|\u2014/);
  });
  it('O7 : élevée seulement sur deux jours UTC complets de suite à 3 mailles ou plus ; jamais critique', () => {
    expect(defenseSignal(raw(gnssDegradedCounts(counts(4, [3, 5]), NOW)))?.severity).toBe('high');
    expect(defenseSignal(raw(gnssDegradedCounts(counts(12, [12, 12]), NOW)))?.severity).toBe('high');
    expect(defenseSignal(raw(gnssDegradedCounts(counts(4, [3, 2]), NOW)))?.severity).toBe('medium');
    expect(defenseSignal(raw(gnssDegradedCounts(counts(4, [null, 5]), NOW)))?.severity).toBe('medium');
  });
  it('une seule règle « élevée » (arbitrage du contrôleur) : la situation et l’entrée du moniteur montent ensemble, par isGnssDegradationSustained', () => {
    const n = GNSS_SITUATION_CELLS;
    const cases: Array<[number, [number | null, number | null]]> = [
      [n, [n, n]], [12, [9, 12]], [1, [1, 1]], [n - 1, [n, n]], [n, [n, n - 1]], [n, [null, n]], [n, [n, null]], [n, [0, 0]],
    ];
    for (const [rolling, days] of cases) {
      const g = counts(rolling, days);
      const c = gnssDegradedCounts(g, NOW);
      expect(c).not.toBeNull();
      const sustained = c !== null && isGnssDegradationSustained(c);
      const situation = defenseSignal(raw(c))?.severity;
      const monitor = gnssJammingSituations(g, NOW)[0]?.severity;
      expect([situation === 'high', monitor === 'high'], `${rolling} ${String(days)}`).toEqual([sustained, sustained]);
      expect([situation, monitor]).not.toContain('critical');
    }
  });
  it('7500 confirmé et 3 mailles : « Signal défense », moyen (O7), les deux lignes et les deux actions', () => {
    const s = defenseSignal(raw(gnssDegradedCounts(counts(3, [1, null]), NOW), hijack()));
    expect([s?.title, s?.severity]).toEqual(['Signal défense', 'medium']);
    expect(s?.drivers).toHaveLength(2);
    expect(s?.recommendedActions.map((a) => a.label)).toContain('Signaler à la DGAC et à l’ANFR, seules à qualifier un brouillage');
  });
  it('liste « À traiter » (revue de B28, m2) : la situation masque l’entrée GNSS et l’urgence 7500 qu’elle dit déjà ; le moniteur les garde', () => {
    const g = counts(3, [1, null]);
    const emergencies = hijack();
    const situations = detectSituations(raw(gnssDegradedCounts(g, NOW), emergencies), NOW).filter((x) => x.type === 'DEFENSE_SIGNAL_ELEVATED');
    const alerts = [...gnssJammingSituations(g, NOW), ...militaryEmergencyAlerts(emergencies)];
    expect(alerts.map((a) => a.id)).toEqual(['gnss-degraded-24h', expect.stringMatching(/^military-emergency-.+-7500$/)]);
    expect(situations[0]?.coveredAlertIds).toEqual([alerts[1]?.id, 'gnss-degraded-24h']);
    const q = buildWorkQueue({
      situations, alerts, events: null, ecowatt: null, meteo: [], floods: [], markets: [], baseline: null, firstSeen: new Map(), lang: 'fr', now: NOW,
    });
    expect(q.items.map((i) => i.key)).toEqual(['situation:defense-signal-elevated']);
    // Sous le seuil de la situation (2 mailles) : rien ne masque l'entrée GNSS, elle reste dans la liste.
    const few = counts(2, [2, null]);
    const none = detectSituations(raw(gnssDegradedCounts(few, NOW)), NOW).filter((x) => x.type === 'DEFENSE_SIGNAL_ELEVATED');
    const q2 = buildWorkQueue({
      situations: none, alerts: gnssJammingSituations(few, NOW), events: null, ecowatt: null, meteo: [], floods: [], markets: [], baseline: null,
      firstSeen: new Map(), lang: 'fr', now: NOW,
    });
    expect(q2.items.map((i) => i.key)).toEqual(['alert:gnss-degraded-24h']);
  });
  it('Review Focus 3 : orage Kp 5+ : aucun compte (GNSS non évalué), aucune situation, signal du score à 0', () => {
    const cells = gnssDegradedCounts(GNSS_STORM_FIXTURE(), NOW);
    expect(cells).toBeNull();
    expect(defenseSignal(raw(cells))).toBeUndefined();
    expect(buildFranceSignals(raw(cells), NOW)).toMatchObject({ jammingSignals: 0, gnssUnavailable: true });
  });
  it('entrées du 04/10 complétées par withGnssInputs : le score lit les mailles, la pastille Défense passe au jaune', () => {
    const sov = withGnssInputs(buildSovereigntyInputs(MILITARY_FIXTURE(), CABLES_WATCH_FIXTURE(), CYBER_FIXTURE(), NOW), GNSS_FIXTURE(), MILITARY_FIXTURE(), NOW);
    const s = buildFranceSignals({ ...raw(null), ...sov }, NOW);
    expect(s).toMatchObject({ jammingSignals: 2, gnssUnavailable: false, defensePillLevel: 'jaune' });
  });
  it('fenêtre de moins de 23 h 50 (FX2, deuxième tour) : un compte positif entre au score, à la situation et au moniteur ; un compte nul n’entre nulle part', () => {
    const partial = (rolling24h: number): GnssResponse => ({
      ...counts(rolling24h, [3, 3]), windowStart: new Date(Date.parse(GNSS_FIXTURE().readAt ?? '') - 5 * 3_600_000).toISOString(),
    });
    const sovOf = (g: GnssResponse) => withGnssInputs(buildSovereigntyInputs(MILITARY_FIXTURE(), CABLES_WATCH_FIXTURE(), CYBER_FIXTURE(), NOW), g, MILITARY_FIXTURE(), NOW);
    const defensePillar = (r: FranceRawData): number | undefined => computeFranceScoreBreakdown(r, buildFranceSignals(r, NOW), null, [], null, NOW)
      .pillars.find((p) => p.key === 'defense')?.value;
    // Positif : 3 mailles sur 5 h de mesure.
    const three = { ...raw(null), ...sovOf(partial(3)) };
    expect(buildFranceSignals(three, NOW)).toMatchObject({ jammingSignals: 3, gnssUnavailable: false, defensePillLevel: 'orange', defensePillFromGnss: true });
    expect(defensePillar(three)).toBeGreaterThan(defensePillar({ ...raw(null), ...sovOf(partial(0)) }) ?? 0);
    expect(defenseSignal(three)?.severity).toBe('high');                 // 3 sur la fenêtre partielle et sur les deux jours UTC complets
    expect(gnssJammingSituations(partial(3), NOW).map((a) => [a.id, a.severity])).toEqual([['gnss-degraded-24h', 'high']]);
    // Nul : non évalué (jamais un calme), aucune situation, aucune entrée du moniteur, pilier sans GNSS.
    const zero = { ...raw(null), ...sovOf(partial(0)) };
    expect(zero.gnssDegraded).toBeNull();
    expect(buildFranceSignals(zero, NOW)).toMatchObject({ jammingSignals: 0, gnssUnavailable: true, defensePillLevel: 'vert' });
    expect(defenseSignal(zero)).toBeUndefined();
    expect(gnssJammingSituations(partial(0), NOW)).toEqual([]);
  });
});
