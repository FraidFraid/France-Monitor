// src/components/DefensePanel.test.ts
// @vitest-environment happy-dom
// Coquille du panneau Défense (spec 2026-10-04 souveraineté § 2.1 ; contrats § 4.2 ; amendement 7, O9, O14 ; décision du 08/10/2026 : aucun masquage) : cadre commun, clics
// vers la carte (tous les aéronefs et toutes les urgences), bouton des ouvrages OpenStreetMap, Marine nationale relue à
// chaque rendu, relecture de la page Vigipirate passée à la vue ; plus de modale déplaçable ni de « Situation normale ».
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VIGIPIRATE } from '../config/vigipirate.ts';
import type { MilitaryShip } from '../services/military-ships.ts';
import { MILITARY_FIGURE_LABEL } from '../services/sovereignty-levels.ts';
import type { MilitaryResponse } from '../types/index.ts';
import {
  CABLES_WATCH_FIXTURE, CABLES_WATCH_FROZEN_FIXTURE, MILITARY_EMERGENCY_FIXTURE, MILITARY_FIXTURE, MILITARY_FRENCH_EMERGENCY_FIXTURE,
  SOV_FIXTURE_NOW, VIGIPIRATE_CHECK_CHANGED_FIXTURE, VIGIPIRATE_CHECK_FIXTURE,
} from './layer-panel/sovereignty.fixture.ts';
import { vigipirateBadge, type DefenseSitesSummary } from './layer-panel/defense.ts';
import { CABLES_FILE_ERROR_TEXT } from './layer-panel/sovereignty-format.ts';
import { DefensePanel, type DefenseLiveSource, type DefensePanelState } from './DefensePanel.ts';

const NOW = SOV_FIXTURE_NOW;
const SITES: DefenseSitesSummary = {
  curated: { total: 112, byType: { air: 31, navy: 18, army: 34, joint: 29, fortification: 0, other: 0 }, overseas: 9, abroad: 4 },
  osm: { meta: null, error: null, shown: false },
};
const ship = (over: Partial<MilitaryShip> & Pick<MilitaryShip, 'id' | 'name'>): MilitaryShip => ({
  type: 'FREMM', role: 'Frégate multi-missions', lat: 43.12, lon: 5.92, isLive: false, port: 'Toulon', speed: 0, ...over,
});
const LIVE = ship({ id: 'd651', name: 'Provence', mmsi: '227802000', isLive: true, lastSeen: NOW - 60_000, speed: 14.2, lat: 42.9, lon: 6.1 });
/** Bâtiment sans MMSI vérifié (O12) : trouvé par son seul identifiant. */
const HOME = ship({ id: 'd650', name: 'Aquitaine' });

function state(military: MilitaryResponse = MILITARY_FIXTURE(), over: Partial<DefensePanelState> = {}): DefensePanelState {
  return {
    military: { military: { data: military, error: null, fetchedAt: NOW } },
    cables: { watch: { data: CABLES_WATCH_FIXTURE(), error: null, fetchedAt: NOW }, file: null, fileError: null },
    vigipirate: { check: { data: VIGIPIRATE_CHECK_FIXTURE(), error: null, fetchedAt: NOW } },
    sites: SITES, ...over,
  };
}

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('jeu d’essai incomplet');
  return v;
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; localStorage.clear(); });

function mount(ships: MilitaryShip[] = [LIVE, HOME], lastMessageAt = NOW - 60_000): { c: HTMLElement; p: DefensePanel; live: { ships: MilitaryShip[] } } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const live = { ships };
  const source: DefenseLiveSource = { navy: () => live.ships, connection: () => ({ status: 'connected', lastMessageAt }) };
  const p = new DefensePanel(c, source);
  p.mount();
  return { c, p, live };
}

describe('DefensePanel', () => {
  it('panneau .lp de classe defense-panel-modal, titre « Défense », 9 aéronefs du 04/10 (O9) ; insigne Vigipirate ; plus de modale ni de « Situation normale »', () => {
    const { c, p } = mount();
    expect(p.isVisible()).toBe(false);
    p.show(state());
    expect(c.querySelector('.lp.defense-panel-modal .lp-title')?.textContent).toBe('Défense');
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('9');
    expect(c.querySelector('.lp-figure b')?.classList.contains('lp-lvl--vert')).toBe(true);
    expect(c.querySelector('.lp-figure span')?.textContent).toContain(MILITARY_FIGURE_LABEL);
    expect(c.textContent).toContain(vigipirateBadge(VIGIPIRATE));
    expect(c.textContent).toContain('niveau d’alerte intermédiaire');
    expect(c.querySelector('.defense-panel-header, .defense-panel-content, [draggable]')).toBeNull();
    expect(c.textContent).not.toMatch(/Situation normale|Aucune activité suspecte|Aucun brouillage détecté|TEMPS RÉEL|temps réel/);
  });
  it('O14 : relecture de la page du SGDSN passée à la vue ; page modifiée : « niveau à revérifier », sans relecture : aucune mention', () => {
    const { c, p } = mount();
    p.show(state(MILITARY_FIXTURE(), { vigipirate: null }));
    expect(c.textContent).not.toMatch(/Niveau à revérifier sur sgdsn\.gouv\.fr|Page officielle\s*relue le/);
    p.update(state());
    expect(c.textContent).toMatch(/Page officielle\s*relue le 04\/10 à 16:48/);
    expect(c.textContent).not.toContain('Niveau à revérifier sur sgdsn.gouv.fr');
    vi.setSystemTime(NOW + 24 * 3_600_000);
    p.update(state(MILITARY_FIXTURE(), { vigipirate: { check: { data: VIGIPIRATE_CHECK_CHANGED_FIXTURE(), error: null, fetchedAt: NOW } } }));
    expect(c.textContent).toContain('Niveau à revérifier sur sgdsn.gouv.fr (page modifiée le 05/10).');
  });
  it('aéronef (français ou d’une autre nation), urgence et bâtiment cliqués : rappels avec l’objet ; sans gestionnaire de carte, aucun aéronef cliquable', () => {
    const { c, p } = mount();
    const onAircraft = vi.fn();
    const onEmergency = vi.fn();
    const onNavy = vi.fn();
    p.setOnFocusAircraft(onAircraft);
    p.setOnFocusEmergency(onEmergency);
    p.setOnFocusNavy(onNavy);
    p.show(state(MILITARY_EMERGENCY_FIXTURE()));
    // Décision du 08/10/2026 : chaque appareil, français compris, a sa ligne cliquable.
    expect(c.querySelectorAll('[data-aircraft]')).toHaveLength(MILITARY_EMERGENCY_FIXTURE().aircraft.length);
    const first = must(MILITARY_EMERGENCY_FIXTURE().aircraft[0]);
    expect(first.family).toBe('francais');
    (c.querySelector(`[data-aircraft="${first.hex}"]`) as HTMLElement).click();
    expect(onAircraft).toHaveBeenCalledWith(expect.objectContaining({ hex: first.hex, lat: first.lat, lon: first.lon, callsign: 'FICTIF01' }));
    const other = must(MILITARY_EMERGENCY_FIXTURE().aircraft.find((a) => a.family === 'autres'));
    (c.querySelector(`[data-aircraft="${other.hex}"]`) as HTMLElement).click();
    expect(onAircraft).toHaveBeenLastCalledWith(expect.objectContaining({ hex: other.hex, lat: other.lat, lon: other.lon }));
    (c.querySelector('[data-emergency="ae0805:7700"]') as HTMLElement).click();
    expect(onEmergency).toHaveBeenCalledWith(expect.objectContaining({ icao24: 'ae0805', squawk: '7700', callsign: 'RCH161' }));
    (c.querySelector('[data-navy="227802000"]') as HTMLElement).click();
    expect(onNavy).toHaveBeenCalledWith(LIVE);
    (c.querySelector('[data-navy="d650"]') as HTMLElement).click();
    expect(onNavy).toHaveBeenLastCalledWith(HOME);
    const noMap = mount();
    noMap.p.show(state());
    expect(noMap.c.querySelector('[data-aircraft]')).toBeNull();
  });
  it('urgences d’un appareil français et d’un appareil PIA : nommées, avec adresse, et cliquables', () => {
    const { c, p } = mount();
    const onEmergency = vi.fn();
    p.setOnFocusAircraft(vi.fn());
    p.setOnFocusEmergency(onEmergency);
    p.show(state(MILITARY_FRENCH_EMERGENCY_FIXTURE()));
    expect(c.textContent).toContain('FICTIF04');
    expect(c.textContent).toContain('GRZLY21');
    expect(c.textContent).not.toContain('appareil d’État français · Dépt');
    expect(c.querySelectorAll('[data-emergency]')).toHaveLength(MILITARY_FRENCH_EMERGENCY_FIXTURE().emergencies.length);
    (c.querySelector('[data-emergency="3bf004:7700"]') as HTMLElement).click();
    expect(onEmergency).toHaveBeenLastCalledWith(expect.objectContaining({ icao24: '3bf004', squawk: '7700', callsign: 'FICTIF04', registration: 'F-ZFIC', family: 'francais', lat: 45.87, lon: 4.64 }));
    (c.querySelector('[data-emergency="44f684:7500"]') as HTMLElement).click();
    expect(onEmergency).toHaveBeenLastCalledWith(expect.objectContaining({ icao24: '44f684', squawk: '7500', callsign: 'GRZLY21' }));
    expect(onEmergency).toHaveBeenCalledTimes(2);
  });
  it('Marine nationale relue à chaque rendu (refreshLive) ; panneau fermé : aucun rendu', () => {
    const { c, p, live } = mount([HOME]);
    p.show(state());
    expect(c.querySelectorAll('[data-navy]')).toHaveLength(1);
    live.ships = [HOME, LIVE];
    p.refreshLive();
    expect(c.querySelectorAll('[data-navy]')).toHaveLength(2);
    p.hide({ silent: true });
    live.ships = [];
    p.refreshLive();
    expect(c.querySelectorAll('[data-navy]')).toHaveLength(2);
  });
  it('liaison AIS figée depuis 6 min : « AIS indisponible » si le serveur le dit, jamais pour un simple fichier des câbles illisible', () => {
    const { c, p } = mount([LIVE, HOME], NOW - 6 * 60_000);
    p.show(state(MILITARY_FIXTURE(), { cables: { watch: { data: CABLES_WATCH_FROZEN_FIXTURE(), error: null, fetchedAt: NOW }, file: null, fileError: null } }));
    expect(c.textContent).toContain('AIS indisponible');
    const noFile = { ...CABLES_WATCH_FIXTURE(), evaluated: false, slowVessels: null, errors: [CABLES_FILE_ERROR_TEXT] };
    p.update(state(MILITARY_FIXTURE(), { cables: { watch: { data: noFile, error: null, fetchedAt: NOW }, file: null, fileError: null } }));
    expect(c.textContent).not.toContain('AIS indisponible');
    expect(c.textContent).toContain('Liaison directe interrompue');
  });
  it('bouton des ouvrages OpenStreetMap : bascule l’option selon l’état reçu', () => {
    const { c, p } = mount();
    const onOsm = vi.fn();
    p.setOnOsmWorks(onOsm);
    p.show(state());
    (c.querySelector('[data-osm-works]') as HTMLElement).click();
    expect(onOsm).toHaveBeenLastCalledWith(true);
    p.update(state(MILITARY_FIXTURE(), { sites: { ...SITES, osm: { meta: null, error: null, shown: true } } }));
    (c.querySelector('[data-osm-works]') as HTMLElement).click();
    expect(onOsm).toHaveBeenLastCalledWith(false);
  });
  it('mise à jour d’un panneau fermé sans le rouvrir ; fermer une seule fois ; silencieux sans rappel ; destroy retire', () => {
    const { c, p } = mount();
    const onClose = vi.fn();
    p.setOnClose(onClose);
    p.show(state());
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    p.update(state());
    expect(p.isVisible()).toBe(false);
    p.hide({ silent: true });
    expect(onClose).toHaveBeenCalledTimes(1);
    p.destroy();
    expect(c.querySelector('.lp')).toBeNull();
  });
});
