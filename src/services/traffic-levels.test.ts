import { describe, expect, it } from 'vitest';
import type {
  AirEmergency, AirOverviewResponse, MaritimeSignal, MaritimeSnapshot, RailGroupStats, RailOverviewResponse, RoadEvent, RoadNationalResponse,
} from '../types/index.ts';
import {
  airLevel, emergencyColoursPill, isEmergencyConfirmed, isParisDaytime, isTrafficDataLate, maritimeLevel, railLevel, roadLevel,
} from './traffic-levels.ts';

const T = (iso: string): number => Date.parse(iso);

function ev(over: Partial<RoadEvent>): RoadEvent {
  return {
    id: 'x', kind: 'accident', subtype: 'accident', label: 'Accident', road: 'N10', place: 'Vignolles', direction: 'vers Bordeaux',
    dir: 'DIR Atlantique', start: '2026-10-03T13:02:20+02:00', end: null, severity: 'medium', safety: true,
    planned: false, longTerm: false, lat: 45.52, lon: -0.1, detail: '', ...over,
  };
}

function road(events: RoadEvent[], publishedAt: string | null = '2026-10-03T14:57:44.192+02:00'): RoadNationalResponse {
  return {
    publishedAt, events, longTerm: [],
    counts: { incidents: 0, accidents: 0, closures: 0, obstructions: 0, weather: 0, works: 0 },
    byDir: [], sections: [], speeds: { at: null, stations: 0, under50: 0, median: null, slowest: [] }, agglos: [], conceded: { at: null, jams: [] }, errors: [],
  };
}

/** Urgence vue sur deux lectures des états (13 h 07 puis 13 h 09) ; `confirmed: false` : vue une seule fois. */
function emergency(squawk: AirEmergency['squawk'], overFrance: boolean, confirmed = true): AirEmergency {
  return {
    icao24: '39de4f', callsign: 'TVF89FS', squawk, lat: 45.66, lon: -2.27, altitudeM: 10972,
    firstSeen: confirmed ? '2026-10-03T13:07:39.000Z' : '2026-10-03T13:09:39.000Z', lastSeen: '2026-10-03T13:09:39.000Z', overFrance,
  };
}

function air(emergencies: AirEmergency[], at: string | null = '2026-10-03T13:09:39.000Z'): AirOverviewResponse {
  return {
    at, airborneZone: 1301, airborneFrance: 0, onGround: 148, emergencies, emergencyLog: emergencies, airports: [],
    volume: { samples: [], sameHourPrevDays: [] }, anomalies: [], credits: { remaining: 3619 }, errors: [],
  };
}

function group(label: string, trains: number, avgDelayMin: number | null, cancelled = 0): RailGroupStats {
  return { key: label, label, trains, avgDelayMin, maxDelayMin: avgDelayMin, cancelled, reduced: 0, detour: 0 };
}

function rail(axes: RailGroupStats[], regions: RailGroupStats[] = [], delayed15 = 0, updatedAt: string | null = '2026-10-03T15:10:29+02:00'): RailOverviewResponse {
  return { updatedAt, longDistance: { active: 37, delayed15 }, axes, regions, topDelays: [], trains: [], errors: [] };
}

function signal(over: Partial<MaritimeSignal>): MaritimeSignal {
  return { mmsi: '228403600', name: 'GAS VITALITY', type: 'Pétrolier', status: 2, statusLabel: 'Non maître de sa manœuvre', lat: 43.34, lon: 5.33, since: '2026-10-03T12:40:00.000Z', confirmed: true, sensitive: true, ...over };
}

function sea(signals: MaritimeSignal[], lastMessageAt: string | null = '2026-10-03T13:13:10.000Z'): MaritimeSnapshot {
  return {
    at: '2026-10-03T13:13:20.000Z', lastMessageAt, vessels: 1196, frenchFlag: 681, typedShare: 13,
    zones: [], ports: [], byType: { cargo: 0, petrolier: 0, passagers: 0, peche: 0, remorqueur: 0, plaisance: 0, 'grande-vitesse': 0, service: 0, militaire: 0, autre: 0, inconnu: 0 }, signals, info: { restricted: 41, draught: 3, fishing: 43 }, sensitive: { tankers: 21, passenger: 39, list: [] }, errors: [],
  };
}

describe('isTrafficDataLate (tableau S2)', () => {
  const now = T('2026-10-03T13:10:00Z'); // 15 h 10 à Paris
  it.each([
    ['dir', 30], ['qtv', 20], ['traficolor', 20], ['cnir', 120], ['opensky', 10], ['opensky-departures', 300], ['sncf', 20], ['siri-sx', 20], ['ais', 5],
  ] as const)('%s : en retard au-delà de %i min, pas à la limite', (source, minutes) => {
    expect(isTrafficDataLate(source, new Date(now - minutes * 60_000).toISOString(), now)).toBe(false);
    expect(isTrafficDataLate(source, new Date(now - minutes * 60_000 - 1000).toISOString(), now)).toBe(true);
  });
  it('TomTom : 45 min de jour, 75 min la nuit (heure de Paris)', () => {
    const day = T('2026-10-03T12:00:00Z'); // 14 h à Paris
    expect(isParisDaytime(day)).toBe(true);
    expect(isTrafficDataLate('tomtom', new Date(day - 44 * 60_000).toISOString(), day)).toBe(false);
    expect(isTrafficDataLate('tomtom', new Date(day - 46 * 60_000).toISOString(), day)).toBe(true);
    const night = T('2026-10-03T21:30:00Z'); // 23 h 30 à Paris
    expect(isParisDaytime(night)).toBe(false);
    expect(isTrafficDataLate('tomtom', new Date(night - 74 * 60_000).toISOString(), night)).toBe(false);
    expect(isTrafficDataLate('tomtom', new Date(night - 76 * 60_000).toISOString(), night)).toBe(true);
  });
  it('bascule jour et nuit à 7 h et 21 h, heure d’été de Paris', () => {
    expect(isParisDaytime(T('2026-10-03T04:59:00Z'))).toBe(false); // 6 h 59
    expect(isParisDaytime(T('2026-10-03T05:00:00Z'))).toBe(true); // 7 h
    expect(isParisDaytime(T('2026-10-03T18:59:00Z'))).toBe(true); // 20 h 59
    expect(isParisDaytime(T('2026-10-03T19:00:00Z'))).toBe(false); // 21 h
  });
  it('date absente ou illisible : en retard', () => {
    expect(isTrafficDataLate('dir', null, Date.now())).toBe(true);
    expect(isTrafficDataLate('sncf', '20261003T151029', Date.now())).toBe(true);
  });
});

describe('roadLevel (§ 3.1)', () => {
  it('vérification du 03/10 : 4 accidents et la coupure de l’A63 : jaune', () => {
    const events = [
      ev({ id: 'a1' }), ev({ id: 'a2', dir: 'DIR Île-de-France' }), ev({ id: 'a3' }), ev({ id: 'a4', dir: 'DIR Méditerranée' }),
      ev({ id: 'c1', kind: 'closure', subtype: 'roadClosed', label: 'Route coupée', road: 'A63' }),
      ev({ id: 'q1', kind: 'queue', subtype: 'queuingTraffic', label: 'Bouchon', road: 'A7' }),
    ];
    expect(roadLevel(road(events))).toEqual({ level: 'jaune', reason: '4 accidents et 1 coupure en cours' });
  });
  it('les accidents seuls ne dépassent jamais le jaune (décision du contrôleur) : 4 vert, 5 et 10 jaune', () => {
    const four = Array.from({ length: 4 }, (_, i) => ev({ id: `a${i}` }));
    expect(roadLevel(road(four))).toEqual({ level: 'vert', reason: '4 accidents en cours, aucune coupure' });
    const five = Array.from({ length: 5 }, (_, i) => ev({ id: `a${i}` }));
    expect(roadLevel(road(five))).toEqual({ level: 'jaune', reason: '5 accidents en cours' });
    const ten = Array.from({ length: 10 }, (_, i) => ev({ id: `a${i}` }));
    expect(roadLevel(road(ten))).toEqual({ level: 'jaune', reason: '10 accidents en cours' });
  });
  it('5 coupures non planifiées de moins de 24 h : rouge', () => {
    const c = (id: string) => ev({ id, kind: 'closure', subtype: 'roadClosed', label: 'Route coupée' });
    expect(roadLevel(road(['c1', 'c2', 'c3', 'c4', 'c5'].map(c)))).toEqual({ level: 'rouge', reason: '5 coupures non planifiées de moins de 24 h' });
  });
  it('2 coupures non planifiées : orange ; une coupure planifiée ne compte pas', () => {
    const c = (id: string, planned = false) => ev({ id, kind: 'closure', subtype: 'roadClosed', label: 'Route coupée', planned });
    expect(roadLevel(road([c('c1'), c('c2')]))).toEqual({ level: 'orange', reason: '2 coupures non planifiées de moins de 24 h' });
    expect(roadLevel(road([c('c1'), c('c2', true)]))).toEqual({ level: 'jaune', reason: '1 coupure en cours' });
  });
  it('événement météo : orange dans une DIR, rouge dans deux ; un éboulement récent compte comme météo', () => {
    const snow = ev({ id: 'w1', kind: 'weather', subtype: 'snowOnTheRoad', label: 'Neige sur la chaussée', dir: 'DIR Centre-Est' });
    expect(roadLevel(road([snow]))).toEqual({ level: 'orange', reason: 'Neige sur la chaussée en cours (DIR Centre-Est)' });
    const rock = ev({ id: 'r1', kind: 'obstruction', subtype: 'rockfalls', label: 'Éboulement', dir: 'DIR Sud-Ouest' });
    expect(roadLevel(road([snow, rock]))).toEqual({ level: 'rouge', reason: 'événements météo dans 2 DIR' });
  });
  it('aucun accident ni coupure : vert ; flux DIR absent : n.d.', () => {
    expect(roadLevel(road([ev({ kind: 'obstruction', subtype: 'brokenDownVehicle', label: 'Véhicule en panne' })]))).toEqual({ level: 'vert', reason: 'aucun accident ni coupure en cours' });
    expect(roadLevel(road([], null))).toEqual({ level: 'nd', reason: 'flux des DIR indisponible' });
  });
});

describe('airLevel (§ 3.2)', () => {
  it('au-dessus du territoire ou de ses approches et confirmé : rouge 7500, orange 7700, jaune 7600, vert sinon', () => {
    expect(airLevel(air([emergency('7500', true)]))).toEqual({ level: 'rouge', reason: '7500\u00a0intervention\u00a0illicite : TVF89FS' });
    expect(airLevel(air([emergency('7700', true)]))).toEqual({ level: 'orange', reason: '7700\u00a0urgence au-dessus du territoire : TVF89FS' });
    expect(airLevel(air([emergency('7600', true)]))).toEqual({ level: 'jaune', reason: '7600\u00a0panne\u00a0radio : TVF89FS' });
    expect(airLevel(air([]))).toEqual({ level: 'vert', reason: 'aucun aéronef en urgence' });
  });
  it('hors du territoire et de ses approches : aucun code ne colore (7500, 7600, 7700), la phrase le dit ; source absente : n.d.', () => {
    for (const squawk of ['7500', '7600', '7700'] as const) {
      expect(airLevel(air([emergency(squawk, false)]))).toEqual({ level: 'vert', reason: 'aucune urgence confirmée au-dessus du territoire ou de ses approches' });
    }
    expect(airLevel(air([emergency('7500', false), emergency('7600', true)])).level).toBe('jaune');
    expect(airLevel(air([], null))).toEqual({ level: 'nd', reason: 'OpenSky indisponible' });
  });
  it('T3 : un code vu sur une seule lecture des états ne colore pas, quel qu’il soit ; confirmé à la deuxième lecture', () => {
    for (const squawk of ['7500', '7600', '7700'] as const) {
      expect(airLevel(air([emergency(squawk, true, false)]))).toEqual({ level: 'vert', reason: 'aucune urgence confirmée au-dessus du territoire ou de ses approches' });
    }
    expect(isEmergencyConfirmed(emergency('7500', true, false))).toBe(false);
    expect(isEmergencyConfirmed(emergency('7500', true))).toBe(true);
    expect(isEmergencyConfirmed({ ...emergency('7500', true), firstSeen: 'n.d.' })).toBe(false);
    expect(emergencyColoursPill(emergency('7700', true))).toBe(true);
    expect(emergencyColoursPill(emergency('7700', false))).toBe(false);
    expect(emergencyColoursPill(emergency('7700', true, false))).toBe(false);
  });
});

describe('railLevel (§ 3.3)', () => {
  it('vérification du 03/10 : Sud-Est +56,7 min sur 6 trains : orange', () => {
    const r = rail([group('Sud-Est (Paris Gare de Lyon)', 6, 56.7), group('Atlantique (Paris Montparnasse)', 4, 15)], [group('Hauts-de-France', 8, 34.4)], 20);
    expect(railLevel(r)).toEqual({ level: 'orange', reason: 'retard moyen de 57 min : Sud-Est (Paris Gare de Lyon) (6 trains)' });
  });
  it('un groupe de moins de 3 trains ne compte pas ; 90 min de moyenne : rouge', () => {
    expect(railLevel(rail([group('Nord (Paris Nord)', 2, 120)])).level).toBe('vert');
    expect(railLevel(rail([], [group('Occitanie', 3, 90)])).level).toBe('rouge');
  });
  it('10 trains supprimés en cours : rouge ; 15 trains grandes lignes à 15 min : jaune', () => {
    expect(railLevel(rail([group('Province, transversales', 21, 23.6, 6)], [group('Grand Est', 8, 11.2, 4)]))).toEqual({ level: 'rouge', reason: '10 trains supprimés en cours' });
    expect(railLevel(rail([group('Province, transversales', 21, 23.6)], [], 15))).toEqual({ level: 'jaune', reason: '15 trains grandes lignes à 15 min ou plus' });
    expect(railLevel(rail([], [], 14)).level).toBe('vert');
  });
  it('API SNCF indisponible : n.d.', () => {
    expect(railLevel(rail([], [], 0, null))).toEqual({ level: 'nd', reason: 'API SNCF indisponible' });
  });
});

describe('maritimeLevel (§ 3.4)', () => {
  it('pétrolier ou passagers en difficulté confirmée : rouge ; autre navire : orange', () => {
    expect(maritimeLevel(sea([signal({})])).level).toBe('rouge');
    expect(maritimeLevel(sea([signal({ sensitive: false, name: 'PRYSMIAN MONNA LISA' })]))).toEqual({ level: 'orange', reason: 'Non maître de sa manœuvre : PRYSMIAN MONNA LISA' });
  });
  it('signal non confirmé : information, vert ; AIS jamais reçu : n.d.', () => {
    expect(maritimeLevel(sea([signal({ confirmed: false })]))).toEqual({ level: 'vert', reason: 'aucun navire en difficulté confirmée' });
    expect(maritimeLevel(sea([], null))).toEqual({ level: 'nd', reason: 'AIS indisponible' });
  });
});
