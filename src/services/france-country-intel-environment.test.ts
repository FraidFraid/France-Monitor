// src/services/france-country-intel-environment.test.ts
// Entrées Environnement du score France et des situations (spec 2026-10-04 environnement § 2.7 ; contrats § 6) : formule, poids et
// seuils inchangés (aucune cible de france-country-intel.test.ts n'est touchée), seules les entrées changent. Jeux d'essai réels du
// 04/10 : vigilance (2 départements orange, 0 rouge), crues (4 tronçons jaunes), feux (3 foyers confirmés non récurrents, aciérie de
// Dunkerque et Fos-sur-Mer récurrentes).
import { describe, expect, it } from 'vitest';
import { ENV_FIXTURE_NOW, FIRES_FIXTURE, FLOODS_FIXTURE, VIGILANCE_FIXTURE } from '../components/layer-panel/environment.fixture.ts';
import type { LocatedFireIncident } from '../types/index.ts';
import { buildEnvironmentInputs } from './environment-inputs.ts';
import { clusterFireDetections } from './fire-clustering.ts';
import { buildFranceSignals, type FranceRawData } from './france-country-intel.ts';
import { detectWildfireIncidents } from './situation-engine.ts';
import { MAJOR_FIRE_GATE } from './wildfire-dossier.ts';

function raw(over: Partial<FranceRawData> = {}): FranceRawData {
  return {
    newsItems: [], isnrData: null, cyberData: null, meteoAlerts: [], floodSegments: [], railTrains: [], roadEvents: [], urbanJamCount: 0,
    powerOutages: [], telecomOutages: [], defenseAlerts: [], jammingSignals: [], militaryFlightsCount: 0, maritimeCount: 0, activeFires: [],
    marketData: [], ecowattResponse: null, gasState: null, nuclearState: null, eolienLive: null, aisAnomalies: [], timeline: { days: [], lanes: [] },
    briefLang: 'fr', oilDashboard: null, fuelTensionDashboard: null, ...over,
  };
}

const env = () => buildEnvironmentInputs(VIGILANCE_FIXTURE(), FLOODS_FIXTURE(), FIRES_FIXTURE(), [], ENV_FIXTURE_NOW);

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

describe('entrées Environnement (adaptateurs purs)', () => {
  it('vigilance du jour, tronçons en vigilance, détections en France non récurrentes, foyers du serveur', () => {
    const e = env();
    expect(e.meteoAlerts.map((a) => [a.departmentCode, a.level])).toEqual([
      ['11', 'orange'], ['66', 'orange'], ['13', 'yellow'], ['30', 'yellow'], ['65', 'yellow'], ['34', 'yellow'], ['64', 'yellow'],
    ]);
    expect(e.floodSegments.map((s) => [s.name, s.level])).toEqual([['Têt', 'yellow'], ['Agly', 'yellow'], ['Réart', 'yellow'], ['Tech', 'yellow']]);
    const fires = FIRES_FIXTURE();
    expect(e.activeFires).toHaveLength(fires.detections.filter((d) => !d.recurrent).length);
    expect(e.fireFoyers).toHaveLength(fires.foyers.length);
  });
  it('sources jamais lues : listes vides, jamais une valeur inventée', () => {
    expect(buildEnvironmentInputs(null, null, null, [], ENV_FIXTURE_NOW)).toEqual({ meteoAlerts: [], floodSegments: [], activeFires: [], fireIncidents: [], fireFoyers: [] });
  });
  it('les sources récurrentes (aciérie de Dunkerque, Fos-sur-Mer) n’entrent jamais dans le score', () => {
    const fires = FIRES_FIXTURE();
    const recurrentIds = new Set(fires.detections.filter((d) => d.recurrent).map((d) => d.id));
    expect(recurrentIds.size).toBeGreaterThan(0);
    expect(fires.detections.some((d) => d.recurrent && d.dept === '59')).toBe(true);
    expect(env().activeFires.some((f) => recurrentIds.has(f.id))).toBe(false);
  });
  it('collecte des feux lue il y a plus de 2 jours (gardée par le client après une erreur) : détections, foyers et incidents absents', () => {
    const incident = { id: 'gironde-front' } as LocatedFireIncident;
    const readAt = Date.parse(FIRES_FIXTURE().readAt ?? '');
    const old = buildEnvironmentInputs(VIGILANCE_FIXTURE(), FLOODS_FIXTURE(), FIRES_FIXTURE(), [incident], readAt + 2 * DAY_MS + MINUTE_MS);
    expect([old.activeFires, old.fireFoyers, old.fireIncidents]).toEqual([[], [], []]);
    // Seuls les feux sont écartés : vigilance et crues restent lues.
    expect([old.meteoAlerts.length, old.floodSegments.length]).toEqual([7, 4]);
    const recent = buildEnvironmentInputs(null, null, FIRES_FIXTURE(), [incident], readAt + 2 * DAY_MS - MINUTE_MS);
    expect([recent.activeFires.length > 0, recent.fireFoyers.length > 0, recent.fireIncidents]).toEqual([true, true, [incident]]);
    expect(buildEnvironmentInputs(null, null, { ...FIRES_FIXTURE(), readAt: null }, [incident], ENV_FIXTURE_NOW).fireIncidents).toEqual([]);
  });
});

describe('signaux du score France (formule inchangée)', () => {
  it('04/10 : 2 départements orange, 0 rouge ; 0 tronçon orange ou rouge ; détections nettoyées ; 3 foyers confirmés, aucun d’au moins 10 MW, aucun majeur', () => {
    const e = env();
    const s = buildFranceSignals(raw({ ...e }));
    expect([s.meteoAlerts, s.meteoRedAlerts, s.floodAlerts, s.floodRedAlerts]).toEqual([2, 0, 0, 0]);
    expect(s.fireDetections).toBe(e.activeFires.length);
    expect([s.fireFoyersConfirmed, s.fireFoyersOrange, s.fireFoyersMajor]).toEqual([3, 0, 0]);
  });
  it('foyer majeur : confirmé, non récurrent, au moins 100 MW, confiance non faible (même règle que la pastille Feux)', () => {
    const [first] = FIRES_FIXTURE().foyers.filter((f) => f.confirmed && !f.recurrent);
    const major = { ...first, frpTotalMw: 412.6, confidenceMax: 'haute' as const };
    const weak = { ...first, frpTotalMw: 412.6, confidenceMax: 'faible' as const };
    expect(buildFranceSignals(raw({ fireFoyers: [major, weak] })).fireFoyersMajor).toBe(1);
  });
  it('champs absents (anciennes entrées) : zéro, jamais une erreur', () => {
    const s = buildFranceSignals(raw());
    expect([s.meteoRedAlerts, s.floodRedAlerts, s.fireFoyersConfirmed, s.fireFoyersOrange, s.fireFoyersMajor]).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('situations : WILDFIRE_ESCALATION et FLOOD_CRISIS inchangées, entrée nettoyée', () => {
  it('04/10 : aucun incident DBSCAN sur les détections nettoyées ne franchit la porte du dossier (40 détections, 300 MW)', () => {
    const incidents = clusterFireDetections(env().activeFires, { epsKm: 3, minPoints: 2 });
    expect(incidents.every((i) => i.detectionsCount < MAJOR_FIRE_GATE.minDetections || i.frpTotal < MAJOR_FIRE_GATE.minFrpTotal)).toBe(true);
    const located = incidents.map((i) => ({ ...i, deptCodes: [], communes: [] }));
    expect(detectWildfireIncidents(raw({ fireIncidents: located }))).toEqual([]);
  });
});
