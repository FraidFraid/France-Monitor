// src/components/layer-panel/navy.test.ts
// Lignes de la Marine nationale partagées par les panneaux Trafic maritime et Défense (contrats § 3.7, arbitrage 7) : flux figé
// (T3), bâtiments vus en AIS d'abord, sous-marins retirés de la liste (O11), MMSI reconnus seulement vérifiés (O12).
import { describe, expect, it } from 'vitest';
import { INSTALLATIONS_BY_ID } from '../../config/military-bases-db.ts';
import { NAVY_MMSI_SET, getMilitaryShips, type MilitaryShip } from '../../services/military-ships.ts';
import { NBSP } from './format.ts';
import { RISK_LEVEL as MARITIME_RISK_LEVEL } from './maritime-tabs.ts';
import { RISK_LEVEL, flagName, frozenWord, homonymKeys, isSubmarine, navyLiveState, shipRow, splitNavy } from './navy.ts';

const NOW = Date.parse('2026-10-04T16:48:30+02:00');
const MIN = 60_000;
const ship = (over: Partial<MilitaryShip> & Pick<MilitaryShip, 'id' | 'name'>): MilitaryShip => ({
  type: 'FREMM', role: 'Frégate multi-missions', lat: 43.12, lon: 5.92, isLive: false, port: 'Toulon', speed: 0, ...over,
});
const LIVE = ship({ id: 'd651', name: 'Provence', mmsi: '227802000', isLive: true, lastSeen: NOW - MIN, speed: 14.2, lat: 42.9, lon: 6.1, country: 'FR|France' });
const HOME = ship({ id: 'd650', name: 'Aquitaine', mmsi: '227801000' });
const SNLE = ship({ id: 's616', name: 'Le Triomphant', type: 'SNLE', role: 'Dissuasion nucléaire', port: 'Île Longue', lat: 48.3253, lon: -4.5636 });
const SNA_LIVE = ship({ id: 's602', name: 'Perle', type: 'SNA', role: 'Attaque sous-marine', isLive: true, lastSeen: NOW - MIN });

describe('état du flux AIS (T3), même seuil que l’en-tête du Trafic maritime', () => {
  it('message de moins de 5 min : vivant ; plus de 5 min : figé ; aucun message : figé seulement liaison coupée ou périmée', () => {
    expect(navyLiveState({ status: 'connected', lastMessageAt: NOW - MIN }, false, NOW)).toEqual({ frozen: false, headDown: false });
    expect(navyLiveState({ status: 'connected', lastMessageAt: NOW - 6 * MIN }, true, NOW)).toEqual({ frozen: true, headDown: true });
    expect(navyLiveState({ status: 'connecting', lastMessageAt: null }, false, NOW).frozen).toBe(false);
    expect(navyLiveState({ status: 'disconnected', lastMessageAt: null }, false, NOW).frozen).toBe(true);
    expect(navyLiveState({ status: 'stale', lastMessageAt: null }, false, NOW).frozen).toBe(true);
  });
  it('mot du flux figé : « AIS indisponible » quand l’en-tête le dit, sinon la liaison directe', () => {
    expect(frozenWord({ frozen: true, headDown: true })).toBe('AIS indisponible');
    expect(frozenWord({ frozen: true, headDown: false })).toBe('Liaison directe interrompue');
  });
});

describe('bâtiments vus en AIS et positions de référence', () => {
  it('sous-marins (SNLE, SNA) : retirés de la liste, même marqués vivants ; observés d’abord, puis références, par nom', () => {
    expect([isSubmarine(SNLE), isSubmarine({ type: 'SNA' }), isSubmarine(HOME)]).toEqual([true, true, false]);
    const split = splitNavy([SNLE, HOME, SNA_LIVE, LIVE, ship({ id: 'd652', name: 'Languedoc' })]);
    expect(split.observed.map((s) => s.name)).toEqual(['Provence']);
    expect(split.reference.map((s) => s.name)).toEqual(['Aquitaine', 'Languedoc']);
  });
  it('ligne vue en AIS : vitesse, heure vue, pavillon ; clé de données du panneau Défense', () => {
    expect(shipRow(LIVE, new Set(), false, NOW, 'navy')).toBe(
      `<div class="lp-row is-link" tabindex="0" role="button" data-navy="227802000"><span class="fmk-dot fmk-dot--vert" aria-hidden="true"></span>`
      + `<span>Provence</span><span class="lp-val fmk-num">14,2${NBSP}nœuds</span><small>FREMM · Frégate multi-missions · pavillon France · vu à 16:47</small></div>`,
    );
    expect(shipRow(LIVE, new Set(), false, NOW)).toContain('data-mar-ship="227802000"');
  });
  it('ligne de référence : « port base » dans Défense (S2), « port d’attache » inchangé dans le Trafic maritime, jamais une vitesse ; puce grise', () => {
    const row = shipRow(HOME, new Set(), true, NOW, 'navy');
    expect(row).toBe(
      '<div class="lp-row is-link" tabindex="0" role="button" data-navy="227801000"><span class="fmk-dot" aria-hidden="true"></span>'
      + '<span>Aquitaine</span><span class="lp-val fmk-num">port base</span><small>FREMM · Frégate multi-missions · position de référence : Toulon</small></div>',
    );
    expect(row).not.toMatch(/stationn|nœuds/);
    expect(shipRow(HOME, new Set(), true, NOW)).toContain('port d’attache');
  });
  it('homonymes : les quatre derniers chiffres du MMSI les distinguent', () => {
    const twin = ship({ id: 'x', name: 'Provence', mmsi: '228000777', isLive: true, lastSeen: NOW - MIN, speed: 3 });
    const keys = homonymKeys([LIVE, twin, HOME]);
    expect([...keys]).toEqual(['provence']);
    expect(shipRow(twin, keys, false, NOW)).toContain('<span>Provence · MMSI …0777</span>');
  });
  it('risque et pavillon : mêmes règles que le Trafic maritime (réexport)', () => {
    expect(MARITIME_RISK_LEVEL).toBe(RISK_LEVEL);
    expect(RISK_LEVEL).toEqual({ none: 'vert', low: 'jaune', medium: 'orange', high: 'rouge', critical: 'rouge' });
    expect(flagName(LIVE)).toBe('France');
    expect(flagName(HOME)).toBe('');
  });
});

describe('base de la Marine nationale (military-ships.ts)', () => {
  it('aucun sous-marin dans la liste affichée (O11) ; l’Île Longue reste un site de défense', () => {
    const ships = getMilitaryShips();
    expect(ships.some(isSubmarine)).toBe(false);
    expect(INSTALLATIONS_BY_ID.get('BN-ILE-LONGUE')?.coordinates).toEqual([-4.5636, 48.3253]);
  });
  it('MMSI non vérifié sur une source officielle publique : non reconnu (O12), aucune ligne vue en AIS', () => {
    const ships = getMilitaryShips();
    expect(ships.length).toBeGreaterThan(0);
    expect(ships.every((s) => s.mmsi === undefined && s.isLive === false)).toBe(true);
    expect(NAVY_MMSI_SET.size).toBe(0);
  });
});
