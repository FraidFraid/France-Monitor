// src/services/france-country-intel-environment.test.ts
// Entrées Environnement du score France et des situations (spec 2026-10-04 environnement § 2.7 ; contrats § 6) : formule, poids et
// seuils inchangés (aucune cible de france-country-intel.test.ts n'est touchée), seules les entrées changent. Jeux d'essai réels du
// 04/10 : vigilance (2 départements orange, 0 rouge), crues (4 tronçons jaunes), feux (3 foyers confirmés non récurrents, aciérie de
// Dunkerque et Fos-sur-Mer récurrentes).
import { describe, expect, it } from 'vitest';
import { domainTiles } from '../components/france-intel-blocks.ts';
import { buildCruesView } from '../components/layer-panel/crues.ts';
import { ENV_FIXTURE_NOW, FIRES_FIXTURE, FLOODS_FIXTURE, VIGILANCE_FIXTURE } from '../components/layer-panel/environment.fixture.ts';
import { buildVigilanceView } from '../components/layer-panel/vigilance.ts';
import type { LocatedFireIncident } from '../types/index.ts';
import { buildEnvironmentInputs } from './environment-inputs.ts';
import { firesLevel } from './environment-levels.ts';
import { clusterFireDetections } from './fire-clustering.ts';
import { buildFranceCountrySnapshot, buildFranceSignals, type FranceRawData } from './france-country-intel.ts';
import { detectWildfireIncidents } from './situation-engine.ts';
import { MAJOR_FIRE_GATE } from './wildfire-dossier.ts';

function raw(over: Partial<FranceRawData> = {}): FranceRawData {
  return {
    newsItems: [], isnrData: null, cyber: null, meteoAlerts: [], floodSegments: [], railTrains: [], roadEvents: [], urbanJamCount: 0,
    powerOutages: [], telecomOutages: [], cableAlerts: [], gnssDegraded: null, militaryFlightsCount: 0, maritimeCount: 0, activeFires: [],
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
    expect(e.environmentAvailable).toEqual({ vigilance: true, floods: true, fires: true });
    // Pastille Feux du panneau, même fonction (arbitrage 14) : 10 départements au niveau 2 et trois petits foyers confirmés, jaune.
    expect(e.firesPillLevel).toBe(firesLevel(FIRES_FIXTURE(), ENV_FIXTURE_NOW).level);
    expect(e.firesPillLevel).toBe('jaune');
  });
  it('sources jamais lues (ou en échec sans donnée) : listes vides et sources dites indisponibles, jamais une valeur inventée', () => {
    expect(buildEnvironmentInputs(null, null, null, [], ENV_FIXTURE_NOW)).toEqual({
      meteoAlerts: [], floodSegments: [], activeFires: [], fireIncidents: [], fireFoyers: [],
      environmentAvailable: { vigilance: false, floods: false, fires: false }, firesPillLevel: 'nd',
    });
  });
  it('carte de vigilance sans date ou sans échéance du jour, relevé Vigicrues absent : indisponibles, comme leurs pastilles', () => {
    const noMap = buildEnvironmentInputs({ ...VIGILANCE_FIXTURE(), updateTime: null }, { ...FLOODS_FIXTURE(), readAt: null }, FIRES_FIXTURE(), [], ENV_FIXTURE_NOW);
    expect(noMap.environmentAvailable).toEqual({ vigilance: false, floods: false, fires: true });
    const noToday = { ...VIGILANCE_FIXTURE(), periods: VIGILANCE_FIXTURE().periods.filter((p) => p.echeance !== 'J') };
    expect(buildEnvironmentInputs(noToday, null, null, [], ENV_FIXTURE_NOW).environmentAvailable.vigilance).toBe(false);
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
    // Sans acquisition datée, seule la règle des 2 jours écarte la collecte ; avec une acquisition datée, son retard de 14 h
    // l'écarte bien avant (retard S2, vague finale, point 1 : voir plus bas).
    const undated = { ...FIRES_FIXTURE(), lastAcquisitionAt: null };
    const old = buildEnvironmentInputs(null, null, undated, [incident], readAt + 2 * DAY_MS + MINUTE_MS);
    expect([old.activeFires, old.fireFoyers, old.fireIncidents]).toEqual([[], [], []]);
    expect(old.environmentAvailable).toEqual({ vigilance: false, floods: false, fires: false });
    // Collecte écartée = FIRMS en panne pour la pastille ; la météo des forêts du 04/10 est échue le 06/10 : n.d.
    expect(old.firesPillLevel).toBe('nd');
    const recent = buildEnvironmentInputs(null, null, undated, [incident], readAt + 2 * DAY_MS - MINUTE_MS);
    expect([recent.activeFires.length > 0, recent.fireFoyers.length > 0, recent.fireIncidents]).toEqual([true, true, [incident]]);
    expect(recent.environmentAvailable.fires).toBe(true);
    const unread = buildEnvironmentInputs(null, null, { ...FIRES_FIXTURE(), readAt: null }, [incident], ENV_FIXTURE_NOW);
    expect([unread.fireIncidents, unread.environmentAvailable.fires]).toEqual([[], false]);
  });
});

describe('signaux du score France (formule inchangée)', () => {
  it('04/10 : 2 départements orange, 0 rouge ; 0 tronçon orange ou rouge ; détections nettoyées ; 3 foyers confirmés, aucun d’au moins 10 MW, aucun majeur', () => {
    const e = env();
    const s = buildFranceSignals(raw({ ...e }));
    expect([s.meteoAlerts, s.meteoRedAlerts, s.floodAlerts, s.floodRedAlerts]).toEqual([2, 0, 0, 0]);
    expect(s.fireDetections).toBe(e.activeFires.length);
    expect([s.fireFoyersConfirmed, s.fireFoyersOrange, s.fireFoyersMajor, s.fireFoyersIsolated]).toEqual([3, 0, 0, 5]);
    expect([s.vigilanceUnavailable, s.floodsUnavailable, s.firesUnavailable]).toEqual([false, false, false]);
  });
  it('détections isolées : foyers non confirmés et non récurrents en France (pastille Feux jaune), jamais comptés au score', () => {
    const [isolated] = FIRES_FIXTURE().foyers.filter((f) => !f.confirmed && !f.recurrent);
    const [recurrent] = FIRES_FIXTURE().foyers.filter((f) => f.recurrent);
    const s = buildFranceSignals(raw({ fireFoyers: [isolated, { ...isolated, recurrent: true }, recurrent] }));
    expect([s.fireFoyersIsolated, s.fireFoyersConfirmed, s.fireDetections]).toEqual([1, 0, 0]);
  });
  it('sources indisponibles (jamais lues, en échec, collecte de plus de 2 jours) : dites au signal, le score voit des listes vides, sans recalibrage', () => {
    const readAt = Date.parse(FIRES_FIXTURE().readAt ?? '');
    const now = readAt + 2 * DAY_MS + MINUTE_MS;
    const down = buildEnvironmentInputs(null, null, FIRES_FIXTURE(), [], now);
    const s = buildFranceSignals(raw({ ...down }));
    expect([s.vigilanceUnavailable, s.floodsUnavailable, s.firesUnavailable, s.firesPillLevel]).toEqual([true, true, true, 'nd']);
    const strip = ({ vigilanceUnavailable: _v, floodsUnavailable: _f, firesUnavailable: _x, firesPillLevel: _p, ...rest }: typeof s) => rest;
    expect(strip(s)).toEqual(strip(buildFranceSignals(raw())));
    const opts = { previousScore: null, now };
    const unavailable = buildFranceCountrySnapshot(raw({ ...down }), opts);
    const empty = buildFranceCountrySnapshot(raw(), opts);
    expect([unavailable.score, unavailable.scoreBreakdown]).toEqual([empty.score, empty.scoreBreakdown]);
  });
  it('foyer majeur : confirmé, non récurrent, au moins 100 MW, confiance non faible (même règle que la pastille Feux)', () => {
    const [first] = FIRES_FIXTURE().foyers.filter((f) => f.confirmed && !f.recurrent);
    const major = { ...first, frpTotalMw: 412.6, confidenceMax: 'haute' as const };
    const weak = { ...first, frpTotalMw: 412.6, confidenceMax: 'faible' as const };
    expect(buildFranceSignals(raw({ fireFoyers: [major, weak] })).fireFoyersMajor).toBe(1);
  });
  it('champs absents (anciennes entrées) : zéro et sources lues, jamais une erreur', () => {
    const s = buildFranceSignals(raw());
    expect([s.meteoRedAlerts, s.floodRedAlerts, s.fireFoyersConfirmed, s.fireFoyersOrange, s.fireFoyersMajor, s.fireFoyersIsolated]).toEqual([0, 0, 0, 0, 0, 0]);
    expect([s.vigilanceUnavailable, s.floodsUnavailable, s.firesUnavailable]).toEqual([false, false, false]);
    expect(s.firesPillLevel).toBeUndefined();
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

describe('retard (S2) : une source en retard compte comme indisponible, comme pour les panneaux (vague finale, point 1)', () => {
  const HOUR_MS = 3_600_000;
  const OPEN = (_: string, d: boolean): boolean => d;
  /** Tuile « Météo » de bout en bout : entrées Environnement, signaux du score, tuiles. */
  const meteoTile = (e: ReturnType<typeof buildEnvironmentInputs>) => domainTiles(buildFranceSignals(raw({ ...e })), 'fr').find((x) => x.label === 'Météo');

  it('carte de vigilance de 20 h : panneau n.d., vigilance indisponible, aucune alerte (moniteur, score), tuile « Vigilance n.d. » gris', () => {
    const now = Date.parse(VIGILANCE_FIXTURE().updateTime ?? '') + 20 * HOUR_MS;
    const panel = buildVigilanceView({
      vigilance: VIGILANCE_FIXTURE(), vigilanceError: null, seaLevels: null, seaLevelsError: null, echeance: 'J', selectedDept: null, canFocus: true, now, open: OPEN,
    });
    expect(panel.head.level).toBe('nd');
    const e = buildEnvironmentInputs(VIGILANCE_FIXTURE(), null, null, [], now);
    expect([e.environmentAvailable.vigilance, e.meteoAlerts]).toEqual([false, []]);
    expect(meteoTile(e)?.parts?.[0]).toEqual({ label: 'Vigilance', value: null, level: null });
    // 14 h après la carte : encore à l'heure, les 7 départements comptent.
    const onTime = buildEnvironmentInputs(VIGILANCE_FIXTURE(), null, null, [], now - 6 * HOUR_MS);
    expect([onTime.environmentAvailable.vigilance, onTime.meteoAlerts.length]).toEqual([true, 7]);
  });

  it('relevé Vigicrues de 40 min : panneau n.d., crues indisponibles, aucun tronçon au score, tuile « Crues n.d. » gris', () => {
    const now = Date.parse(FLOODS_FIXTURE().readAt ?? '') + 40 * MINUTE_MS;
    const panel = buildCruesView({ floods: FLOODS_FIXTURE(), floodsError: null, canFocus: true, now, open: OPEN });
    expect(panel.head.level).toBe('nd');
    const e = buildEnvironmentInputs(null, FLOODS_FIXTURE(), null, [], now);
    expect([e.environmentAvailable.floods, e.floodSegments]).toEqual([false, []]);
    expect(meteoTile(e)?.parts?.[1]).toEqual({ label: 'Crues', value: null, level: null });
    const onTime = buildEnvironmentInputs(null, FLOODS_FIXTURE(), null, [], now - 20 * MINUTE_MS);
    expect([onTime.environmentAvailable.floods, onTime.floodSegments.length]).toEqual([true, 4]);
  });

  it('FIRMS de 15 h : détections, foyers et incidents absents, feux indisponibles ; la météo des forêts du jour colore seule la part « Feux »', () => {
    const now = Date.parse(FIRES_FIXTURE().lastAcquisitionAt ?? '') + 15 * HOUR_MS;
    const incident = { id: 'gironde-front' } as LocatedFireIncident;
    const e = buildEnvironmentInputs(null, null, FIRES_FIXTURE(), [incident], now);
    expect([e.activeFires, e.fireFoyers, e.fireIncidents, e.environmentAvailable.fires]).toEqual([[], [], [], false]);
    // Même pastille que le panneau (firesLevel) : 10 départements au niveau 2, retard FIRMS nommé.
    expect(firesLevel(FIRES_FIXTURE(), now)).toEqual({ level: 'jaune', reason: 'danger modéré aujourd’hui : 10 départements ; détections FIRMS en retard' });
    expect(e.firesPillLevel).toBe('jaune');
    expect(meteoTile(e)?.parts?.[2]).toEqual({ label: 'Feux', value: null, level: 'medium' });
  });

  it('les trois en retard : le score voit des listes vides, sans recalibrage', () => {
    const now = Date.parse('2026-10-05T04:30:00Z');
    const late = buildEnvironmentInputs(VIGILANCE_FIXTURE(), FLOODS_FIXTURE(), FIRES_FIXTURE(), [], now);
    expect(late.environmentAvailable).toEqual({ vigilance: false, floods: false, fires: false });
    const opts = { previousScore: null, now };
    const withLate = buildFranceCountrySnapshot(raw({ ...late }), opts);
    const empty = buildFranceCountrySnapshot(raw(), opts);
    expect([withLate.score, withLate.scoreBreakdown]).toEqual([empty.score, empty.scoreBreakdown]);
  });
});
