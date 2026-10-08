// src/services/sovereignty-levels-b.test.ts : niveaux de la phase B (spec 2026-10-04 souveraineté § 3.1, § 3.3 ; contrats § 3.1,
// arbitrages 31 et 34) : couleur d'un grand réseau, pastille Connectivité (le plus haut des câbles et des réseaux, n.d. seulement si
// les deux manquent), comptes de mailles GNSS dégradées du score (lus dans la réponse, sans lieu), pastille Défense avec le brouillage mesuré.
import { describe, expect, it } from 'vitest';
import type {
  CableAlert, CablesWatchResponse, ConnectivityResponse, GnssCell, GnssResponse, MajorNetworkAsn, MilitaryResponse, NetworkVisibility,
} from '../types/index.ts';
import {
  FULL_VISIBILITY_PCT, cablesLevel, connectivityLevel, defenseLevel, gnssDegradedCount, gnssDegradedCounts, networkVisibilityLevel, visibilityPctLevel,
} from './sovereignty-levels.ts';

const NOW = Date.parse('2026-10-04T16:48:30+02:00');
const NBSP = '\u00A0';

function network(asn: MajorNetworkAsn, name: string, v4Seeing: number, v6Seeing = 314): NetworkVisibility {
  const pct = Math.min(v4Seeing / 325, v6Seeing / 314) * 100;
  return {
    asn, name, v4Seeing, v4Total: 325, v6Seeing, v6Total: 314, v4Prefixes: 100, v6Prefixes: 10, visibilityPct: Math.round(pct * 100) / 100,
  };
}
const SIX = (): NetworkVisibility[] => [
  network(3215, 'Orange', 325), network(15557, 'SFR', 325), network(5410, 'Bouygues Telecom', 325), network(12322, 'Free', 323),
  network(2200, 'RENATER', 324), network(16276, 'OVHcloud', 325),
];
function connectivity(networks: NetworkVisibility[] = SIX(), snapshotAt: string | null = '2026-10-04T08:00:00.000Z'): ConnectivityResponse {
  return {
    readAt: '2026-10-04T14:47:54.000Z', snapshotAt, networks, history: { samples: [], since: null }, exchanges: null, errors: [],
  };
}
function watch(over: Partial<CablesWatchResponse> = {}): CablesWatchResponse {
  return {
    readAt: '2026-10-04T14:45:00.000Z', aisLastMessageAt: '2026-10-04T14:47:00.000Z', evaluated: true,
    cablesFile: { generatedAt: '2026-10-04T15:00:00.000Z', osmBase: '2026-10-04T14:47:16Z', cables: 39, landings: 41 }, slowVessels: 12,
    alerts: [], errors: [], ...over,
  };
}
const CONFIRMED: CableAlert = {
  id: '227000001:way/761201757', mmsi: '227000001', name: null, vesselType: 'Cargo', cableId: 'way/761201757', cableName: 'Apollo South',
  lat: 48.7, lon: -3.5, distanceM: 300, speedKn: 1, navStatus: 1, firstSeen: '2026-10-04T14:30:00.000Z', lastSeen: '2026-10-04T14:45:00.000Z',
  confirmed: true,
};
function cell(lat: number, lon: number, level: GnssCell['level'], inFrance: boolean, pct: number | null = 0): GnssCell {
  return { lat, lon, good: 20, degraded: level === 'orange' ? 4 : level === 'jaune' ? 2 : 0, unknown: 0, pct, level, inFrance };
}
function gnss(cells: GnssCell[], over: Partial<GnssResponse> = {}): GnssResponse {
  return {
    readAt: '2026-10-04T14:40:00.000Z', windowStart: '2026-10-03T14:40:00.000Z', reads: 720, aircraft: 1180, cells, cellsDay: '2026-10-03',
    frenchCells: 14, generalDegradation: false,
    degraded: { rolling24h: cells.filter((c) => c.inFrance && c.level === 'orange').length, previousUtcDays: [2, null] },
    days: { days: [], since: null },
    spaceWeather: { readAt: null, scalesAt: null, today: null, forecast: [], kp: [], lastAlert: null }, errors: [], ...over,
  };
}
const MILITARY: MilitaryResponse = {
  readAt: '2026-10-04T14:48:24.000Z', sourceNow: '2026-10-04T14:48:24.501Z', frenchByDept: [], aircraft: [], abroadCount: 0, abroad: [], emergencies: [],
  emergencyLog: [], hourly: { hours: [], since: null }, errors: [],
};

describe('couleur d’un grand réseau (arbitrage 31)', () => {
  it('« pleinement visible » à 99 % ; orange sous 90 %, rouge sous 50 %', () => {
    expect(FULL_VISIBILITY_PCT).toBe(99);
    const at = (pct: number): NetworkVisibility => ({ ...network(3215, 'Orange', 325), visibilityPct: pct });
    expect([100, 99.38, 90, 89.99, 50, 49.99].map((p) => networkVisibilityLevel(at(p))))
      .toEqual(['vert', 'vert', 'vert', 'orange', 'orange', 'rouge']);
    expect([99.08, 89.99, 49.99].map(visibilityPctLevel)).toEqual(['vert', 'orange', 'rouge']);
  });
});

describe('pastille Connectivité (spec § 3.3) : le plus haut des câbles et des grands réseaux', () => {
  it('04/10 : six réseaux visibles (Free 323 sur 325 : écart habituel), aucun navire lent : vert, raison des réseaux d’abord', () => {
    const v = connectivityLevel(watch(), connectivity(), NOW);
    expect(v.level).toBe('vert');
    expect(v.reason.startsWith(`6${NBSP}/${NBSP}6 grands réseaux vus par au moins 99${NBSP}% des routeurs témoins RIPE · `)).toBe(true);
    expect(v.reason).not.toContain('pleinement');
    expect(v.reason).toContain(cablesLevel(watch(), NOW).reason);
  });
  it('Free sous 90 % : orange ; RENATER sous 50 % : rouge', () => {
    const free = SIX().map((n) => (n.asn === 12322 ? network(12322, 'Free', 276) : n));
    expect(connectivityLevel(watch(), connectivity(free), NOW)).toMatchObject({ level: 'orange' });
    expect(connectivityLevel(watch(), connectivity(free), NOW).reason).toContain(`Free sous 90${NBSP}% de visibilité (84,9${NBSP}%)`);
    const renater = SIX().map((n) => (n.asn === 2200 ? network(2200, 'RENATER', 130) : n));
    expect(connectivityLevel(watch(), connectivity(renater), NOW).level).toBe('rouge');
  });
  it('navire lent confirmé sur un câble et réseaux visibles : orange (câbles)', () => {
    expect(connectivityLevel(watch({ alerts: [CONFIRMED] }), connectivity(), NOW).level).toBe(cablesLevel(watch({ alerts: [CONFIRMED] }), NOW).level);
    expect(connectivityLevel(watch({ alerts: [CONFIRMED] }), connectivity(), NOW).level).toBe('orange');
  });
  it('RIPEstat jamais lu : la pastille suit les câbles et le dit ; instantané de plus de 10 h : en retard, même effet', () => {
    expect(connectivityLevel(watch(), null, NOW)).toMatchObject({ level: 'vert' });
    expect(connectivityLevel(watch(), null, NOW).reason).toContain('RIPEstat indisponible');
    const late = connectivityLevel(watch(), connectivity(SIX(), '2026-10-04T04:00:00.000Z'), NOW);
    expect(late.level).toBe('vert');
    expect(late.reason).toContain('instantané RIPEstat en retard');
  });
  it('AIS muet : les réseaux portent la pastille, la raison dit la veille non évaluée ; les deux manquent : n.d.', () => {
    const muted = watch({ evaluated: false, aisLastMessageAt: '2026-10-04T14:30:00.000Z' });
    const v = connectivityLevel(muted, connectivity(), NOW);
    expect(v.level).toBe('vert');
    expect(v.reason).toContain(cablesLevel(muted, NOW).reason);
    expect(connectivityLevel(muted, null, NOW).level).toBe('nd');
    expect(connectivityLevel(null, null, NOW).level).toBe('nd');
  });
});

describe('mailles GNSS dégradées du score : comptes sans lieu, lus dans la réponse (O15 à O17, arbitrage 34)', () => {
  const cells = [
    cell(50.5, -1.5, 'orange', false, 33.3), cell(48, -4, 'orange', true, 10.5), cell(48, -3.5, 'orange', true, 12.5), cell(48, -3, 'jaune', true, 3.1),
    cell(48.5, 2, 'vert', true), cell(44, 4, 'peu', true, null),
  ];
  it('comptes du serveur repris tels quels, sans lieu : glissant de 24 h et deux derniers jours UTC (veille d’abord)', () => {
    const g = gnss(cells, { degraded: { rolling24h: 2, previousUtcDays: [3, null] } });
    expect(gnssDegradedCounts(g, NOW)).toEqual({ rolling24h: 2, previousUtcDays: [3, null] });
    expect(gnssDegradedCount(g, NOW)).toBe(2);
    expect(Object.keys(gnssDegradedCounts(g, NOW) ?? {}).sort()).toEqual(['previousUtcDays', 'rolling24h']);
  });
  it('dégradation générale, grille jamais lue, grille de plus de 40 min : aucun compte (S2), jamais zéro lu comme calme', () => {
    expect(gnssDegradedCounts(gnss(cells, { generalDegradation: true }), NOW)).toBeNull();
    expect(gnssDegradedCounts(gnss(cells, { readAt: null }), NOW)).toBeNull();
    expect(gnssDegradedCounts(gnss(cells, { readAt: '2026-10-04T14:05:00.000Z' }), NOW)).toBeNull();
    expect(gnssDegradedCounts(null, NOW)).toBeNull();
    expect(gnssDegradedCount(gnss(cells, { generalDegradation: true }), NOW)).toBe(0);
    expect(gnssDegradedCount(null, NOW)).toBe(0);
  });
});

describe('pastille Défense avec la précision GNSS dégradée (contrats § 3.1, tâche A1, O15)', () => {
  it('aucune urgence : 0 maille vert, 1 ou 2 jaune, 3 orange ; la raison dit « dégradée », jamais « brouillage »', () => {
    expect([0, 1, 2, 3, 5].map((n) => defenseLevel(MILITARY, NOW, n).level)).toEqual(['vert', 'jaune', 'jaune', 'orange', 'orange']);
    expect(defenseLevel(MILITARY, NOW, 3).reason).toContain('précision GNSS dégradée');
    expect(defenseLevel(MILITARY, NOW, 3).reason.toLowerCase()).not.toContain('brouillage');
  });
});
