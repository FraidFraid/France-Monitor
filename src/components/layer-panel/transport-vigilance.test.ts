import { describe, expect, it } from 'vitest';
import type { AirOverviewResponse, MaritimeSnapshot, RailOverviewResponse, RailSituation, RailTrain, RoadEvent, RoadNationalResponse } from '../../types/index.ts';
import { airNormalGap, railCause, stationName, transportVigilancePoints, type TransportVigilanceInput } from './transport-vigilance.ts';

const NOW = Date.parse('2026-10-24T19:30:00Z');
const stop = (name: string, lon: number, lat: number): RailTrain['stops'][number] => ({ name, lon, lat, delayMin: null });
const BREST = stop('Brest', -4.48, 48.39);
const RENNES = stop('Rennes', -1.67, 48.1);
const MONTPARNASSE = stop('Paris - Montparnasse - Hall 1 & 2', 2.32, 48.84);

function train(id: string, delayMin: number | null, over: Partial<RailTrain> = {}): RailTrain {
  return {
    id, number: id, kind: 'grandes-lignes', axis: 'atlantique', region: null, origin: 'Brest', destination: 'Paris - Montparnasse - Hall 1 & 2',
    effect: 'retard', delayMin, status: 'en-cours', updatedAt: '2026-10-24T19:20:00Z', stops: [BREST, RENNES, MONTPARNASSE], ...over,
  };
}

function rail(trains: RailTrain[]): RailOverviewResponse {
  return { updatedAt: '2026-10-24T19:25:00Z', longDistance: { active: 60, delayed15: 10 }, axes: [], regions: [], topDelays: [], trains, errors: [] };
}

function situation(over: Partial<RailSituation>): RailSituation {
  return { id: 's', title: 'Trafic perturbé', cause: 'dérangement affectant la voie à RENNES', causeKind: 'panne-installation', scope: 'Axe Atlantique', start: '2026-10-24T19:00:00+02:00', end: null, trains: 3, ...over };
}

function input(over: Partial<TransportVigilanceInput>): TransportVigilanceInput {
  return { rail: null, situations: null, road: null, air: null, maritime: null, now: NOW, ...over };
}

function roadEvent(over: Partial<RoadEvent>): RoadEvent {
  return {
    id: 'e1', kind: 'weather', subtype: 'flooding', label: 'Inondation', road: 'A86', place: 'Antony', direction: 'vers Rueil-Malmaison', dir: 'DIR Île-de-France',
    start: '2026-10-24T19:11:00Z', end: null, severity: null, safety: false, planned: false, longTerm: false, lat: 48.76, lon: 2.31, detail: '', ...over,
  };
}

describe('points de vigilance Transports (lots 1 et 2, 25/10/2026)', () => {
  it('rail : 2 trains très retardés ou supprimés d’un axe font un point orange (25/10/2026), 5 un point rouge ; hors de Paris si la gare le permet', () => {
    const three = transportVigilancePoints(input({ rail: rail([train('8626', 390), train('8630', 200), train('8636', 95), train('8640', 40)]) }));
    expect(three).toHaveLength(1);
    expect(three[0]).toMatchObject({ n: 1, mode: 'trafficRail', level: 'orange', title: 'Axe Atlantique', short: '3 trains · jusqu’à 390\u00a0min', causeTag: 'à vérifier' });
    // Brest, Rennes et Montparnasse desservies par les 3 trains : la première gare hors de Paris.
    expect([three[0].lon, three[0].lat]).toEqual([BREST.lon, BREST.lat]);
    const five = transportVigilancePoints(input({ rail: rail(['1', '2', '3', '4'].map((n) => train(n, 120)).concat(train('5', null, { effect: 'supprime' }))) }));
    expect(five[0]).toMatchObject({ level: 'rouge', short: '5 trains · jusqu’à 120\u00a0min · 1 supprimé' });
    // Un seul train, ou trains à venir : pas de point ; deux trains : un point orange.
    expect(transportVigilancePoints(input({ rail: rail([train('1', 300), train('3', 300, { status: 'a-venir' })]) }))).toEqual([]);
    expect(transportVigilancePoints(input({ rail: rail([train('1', 300), train('2', 300)]) }))[0]).toMatchObject({ level: 'orange', short: '2 trains · jusqu’à 300\u00a0min' });
  });

  it('cause SIRI SX : même portée = « annoncée » ; gare citée seulement = « Possible », à vérifier ; travaux et situations anciennes ignorés', () => {
    const trains = [train('1', 100), train('2', 100), train('3', 100)];
    const same = transportVigilancePoints(input({ rail: rail(trains), situations: { at: null, errors: [], situations: [situation({})] } }));
    expect(same[0].causeTag).toBe('annoncée');
    expect(same[0].cause).toMatch(/^Dérangement affectant la voie à RENNES \(SIRI SX, /);
    const cited = railCause([situation({ scope: 'Bretagne' })], { axis: 'atlantique', region: null }, ['Rennes'], NOW);
    expect(cited?.sameScope).toBe(false);
    expect(railCause([situation({ causeKind: 'travaux' })], { axis: 'atlantique', region: null }, [], NOW)).toBeNull();
    expect(railCause([situation({ start: '2026-10-24T08:00:00+02:00' })], { axis: 'atlantique', region: null }, [], NOW)).toBeNull();
  });

  it('route : météo et coupures non planifiées en cours, orange ; accidents et événements planifiés non', () => {
    const road = {
      publishedAt: '2026-10-24T19:25:00Z', events: [roadEvent({}), roadEvent({ id: 'a', kind: 'accident', label: 'Accident' }), roadEvent({ id: 'p', kind: 'closure', planned: true }),
        roadEvent({ id: 'e2', start: '2026-10-24T19:13:00Z', direction: 'vers Créteil' })],
    } as unknown as RoadNationalResponse;
    const points = transportVigilancePoints(input({ road }));
    expect(points.map((p) => [p.mode, p.level, p.title])).toEqual([['trafficRoad', 'orange', 'Inondation · A86']]);
    expect(points[0].causeTag).toBe('annoncée');
  });

  it('aérien et maritime : 7500 rouge, 7700 orange (confirmés au-dessus du territoire) ; navire sensible en difficulté rouge ; rouge en tête', () => {
    const air = {
      at: '2026-10-24T19:29:00Z', emergencies: [
        { icao24: 'abc', callsign: 'AFR12', squawk: '7700', lat: 45, lon: 4, altitudeM: 9000, firstSeen: '2026-10-24T19:20:00Z', lastSeen: '2026-10-24T19:29:00Z', overFrance: true },
        { icao24: 'def', callsign: 'TVF1', squawk: '7600', lat: 45, lon: 4, altitudeM: 9000, firstSeen: '2026-10-24T19:20:00Z', lastSeen: '2026-10-24T19:29:00Z', overFrance: true },
      ],
    } as unknown as AirOverviewResponse;
    const maritime = {
      at: '2026-10-24T19:29:00Z', signals: [{ mmsi: '1', name: 'PONT-AVEN', type: 'passagers', status: 2, statusLabel: 'échoué', lat: 48.5, lon: -4, since: '2026-10-24T18:00:00Z', confirmed: true, sensitive: true }],
    } as unknown as MaritimeSnapshot;
    const points = transportVigilancePoints(input({ air, maritime }));
    expect(points.map((p) => [p.n, p.mode, p.level])).toEqual([[1, 'trafficMaritime', 'rouge'], [2, 'trafficAir', 'orange']]);
    expect(points[1].title).toBe('7700\u00a0urgence');
  });

  it('écart à la normale de l’aérien : moyenne des 7 jours précédents à la même heure ; moins de 7 jours : rien', () => {
    const air = { at: '2026-10-24T19:29:00Z', airborneZone: 760, volume: { samples: [], sameHourPrevDays: [800, 800, 800, 800, 800, 800, 800, 1] } } as unknown as AirOverviewResponse;
    expect(airNormalGap(air)).toMatchObject({ now: 760, normal: 800 });
    expect(airNormalGap(air)?.pct).toBeCloseTo(-5, 6);
    expect(airNormalGap({ ...air, volume: { samples: [], sameHourPrevDays: [800] } })).toBeNull();
  });

  it('nom de gare lisible', () => {
    expect(stationName('Paris - Montparnasse - Hall 1 & 2')).toBe('Paris Montparnasse');
  });
});
