// src/services/traffic-services.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TRAFFIC_NOW, airOverviewFixture, maritimeSnapshotFixture, railOverviewFixture, railSituationsFixture, roadNationalFixture, roadStateFixture,
  roadUrbanFixture,
} from '../components/layer-panel/traffic.fixture.ts';
import { resetHealthSurveillanceCache } from './health-surveillance.ts';
import { resetTrafficSourceCache } from './traffic-source.ts';
import {
  LEGACY_TOMTOM_KEYS, ROAD_NATIONAL_URL, ROAD_TTL_MS, ROAD_URBAN_URL, clearLegacyTomTomStorage, fetchRoadTraffic, fetchTrafficFlowSegment,
  isRoadNationalResponse, isRoadUrbanResponse, resetTrafficFlowCache, roadStatus,
} from './traffic-road.ts';
import { AIR_OVERVIEW_TTL_MS, AIR_OVERVIEW_URL, airDeparturesEnd, airDeparturesLate, airStatus, fetchAirOverview, isAirOverviewResponse } from './traffic-air.ts';
import {
  RAIL_OVERVIEW_URL, RAIL_SITUATIONS_URL, RAIL_TTL_MS, fetchRailTraffic, isRailOverviewResponse, isRailSituationsResponse, railStatus,
} from './traffic-rail.ts';
import { MARITIME_SNAPSHOT_TTL_MS, fetchMaritimeSnapshot, isMaritimeSnapshot, maritimeSnapshotUrl, maritimeStatus } from './traffic-maritime.ts';

const SNAPSHOT_URL = 'https://www.francemonitor.com/relay/snapshot';
const BODIES: Record<string, unknown> = {
  [ROAD_NATIONAL_URL]: roadNationalFixture(), [ROAD_URBAN_URL]: roadUrbanFixture(), [AIR_OVERVIEW_URL]: airOverviewFixture(),
  [RAIL_OVERVIEW_URL]: railOverviewFixture(), [RAIL_SITUATIONS_URL]: railSituationsFixture(), [SNAPSHOT_URL]: maritimeSnapshotFixture(),
};
type Reply = { status: number; body?: unknown; html?: boolean };

function stubFetch(over: Record<string, Reply> = {}) {
  const f = vi.fn(async (url: string) => {
    const o = over[url];
    if (o?.html) return { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } };
    if (o) return { ok: o.status >= 200 && o.status < 300, status: o.status, json: async () => o.body ?? {} };
    if (!(url in BODIES)) throw new Error(`URL inattendue ${url}`);
    return { ok: true, status: 200, json: async () => BODIES[url] };
  });
  vi.stubGlobal('fetch', f);
  return f;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetTrafficSourceCache();
  resetHealthSurveillanceCache();
  resetTrafficFlowCache();
});

describe('trafic routier : lecture client (spec trafics § 2.1, § 2.2, T4)', () => {
  it('lit les deux routes serveur, garde chaque réponse 4 min (sous la relève de 5 min), puis relit', async () => {
    const f = stubFetch();
    const s = await fetchRoadTraffic(null, TRAFFIC_NOW);
    expect(f.mock.calls.map((c) => c[0]).sort()).toEqual([ROAD_NATIONAL_URL, ROAD_URBAN_URL].sort());
    expect(s.national).toEqual({ data: roadNationalFixture(), error: null, fetchedAt: TRAFFIC_NOW });
    expect(s.urban.data?.agglos[0].jamKm).toBe(169.5);
    await fetchRoadTraffic(s, TRAFFIC_NOW + ROAD_TTL_MS - 1);
    expect(f).toHaveBeenCalledTimes(2);
    await fetchRoadTraffic(s, TRAFFIC_NOW + ROAD_TTL_MS);
    expect(f).toHaveBeenCalledTimes(4);
    expect(ROAD_TTL_MS).toBeLessThan(5 * 60_000);
  });
  it('HTTP en erreur, page HTML (défi anti-robot), forme inattendue : erreur portée, dernières données gardées, jamais de rejet', async () => {
    stubFetch({ [ROAD_NATIONAL_URL]: { status: 503 }, [ROAD_URBAN_URL]: { status: 200, html: true } });
    const s = await fetchRoadTraffic(roadStateFixture(), TRAFFIC_NOW + 1000);
    expect(s.national).toEqual({ data: roadNationalFixture(), error: 'HTTP 503', fetchedAt: TRAFFIC_NOW });
    expect(s.urban.error).toBe('réponse illisible');
    resetTrafficSourceCache();
    resetHealthSurveillanceCache();
    stubFetch({ [ROAD_NATIONAL_URL]: { status: 200, body: { events: 'x' } } });
    const none = await fetchRoadTraffic(null, TRAFFIC_NOW + 2000);
    expect(none.national).toEqual({ data: null, error: 'réponse inattendue', fetchedAt: null });
  });
  it('gardes de forme', () => {
    expect(isRoadNationalResponse(roadNationalFixture())).toBe(true);
    expect(isRoadUrbanResponse(roadUrbanFixture())).toBe(true);
    expect(isRoadNationalResponse({ ...roadNationalFixture(), events: [{ id: 1 }] })).toBe(false);
    expect(isRoadNationalResponse({ ...roadNationalFixture(), counts: {} })).toBe(false);
    expect(isRoadUrbanResponse({ ...roadUrbanFixture(), agglos: [{ name: 'Paris' }] })).toBe(false);
    expect(isRoadUrbanResponse(null)).toBe(false);
  });
  it('panneau des sources : date de la donnée et heure à la place de « temps réel » ; retard ; partie en échec ; sans donnée', () => {
    const s = roadStateFixture();
    expect(roadStatus(s, 'national', TRAFFIC_NOW)).toEqual({
      status: 'ok', lastUpdate: new Date('2026-10-03T14:57:44+02:00'), error: undefined, period: '14:57',
    });
    expect(roadStatus(s, 'urban', TRAFFIC_NOW).lastUpdate).toEqual(new Date('2026-10-03T15:00:00+02:00'));
    const late = roadStatus(s, 'national', Date.parse('2026-10-03T13:28:00Z'));
    expect([late.status, late.period]).toEqual(['stale', '14:57 (en retard)']);
    expect(roadStatus(s, 'national', Date.parse('2026-10-03T13:27:00Z')).status).toBe('ok');
    const partial = { ...s, national: { ...s.national, data: { ...roadNationalFixture(), errors: ['CNIR : HTTP 503'] } } };
    expect(roadStatus(partial, 'national', TRAFFIC_NOW)).toMatchObject({ status: 'stale', error: 'CNIR : HTTP 503' });
    expect(roadStatus({ ...s, urban: { data: null, error: 'HTTP 502', fetchedAt: null } }, 'urban', TRAFFIC_NOW))
      .toEqual({ status: 'error', lastUpdate: null, error: 'HTTP 502', period: undefined });
    expect(roadStatus({ ...s, urban: { data: null, error: null, fetchedAt: null } }, 'urban', TRAFFIC_NOW).status).toBe('loading');
  });
  it('flux TomTom d’un tronçon : lu par le serveur, gardé 15 min, sans budget dans le navigateur', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => ({ flowSegmentData: {
      currentSpeed: 16, freeFlowSpeed: 24, currentTravelTime: 161, freeFlowTravelTime: 107, confidence: 1, roadClosure: false, frc: 'FRC2' } }) }));
    vi.stubGlobal('fetch', f);
    const seg = await fetchTrafficFlowSegment(45.764, 4.8357, 10, TRAFFIC_NOW);
    expect(seg).toEqual({ currentSpeed: 16, freeFlowSpeed: 24, currentTravelTime: 161, freeFlowTravelTime: 107, confidence: 1, roadClosure: false, frc: 'FRC2' });
    expect(f.mock.calls[0]?.[0]).toBe('/api/traffic/flow?point=45.764,4.8357&zoom=10');
    await fetchTrafficFlowSegment(45.764, 4.8357, 10, TRAFFIC_NOW + 60_000);
    expect(f).toHaveBeenCalledTimes(1);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })));
    expect(await fetchTrafficFlowSegment(48.85, 2.35, 10, TRAFFIC_NOW)).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ detailedError: { code: 'X' } }) })));
    expect(await fetchTrafficFlowSegment(48.86, 2.35, 10, TRAFFIC_NOW)).toBeNull();
  });
  it('anciennes clés TomTom du navigateur effacées ; stockage refusé ou absent sans erreur', () => {
    const removed: string[] = [];
    clearLegacyTomTomStorage({ removeItem: (k: string) => { removed.push(k); } });
    expect(removed).toEqual([...LEGACY_TOMTOM_KEYS]);
    expect(() => clearLegacyTomTomStorage({ removeItem: () => { throw new Error('refusé'); } })).not.toThrow();
    expect(() => clearLegacyTomTomStorage(null)).not.toThrow();
  });
});

describe('trafic aérien : aperçu du panneau (spec § 2.3)', () => {
  it('une route, cache de 90 s sous la relève de 2 min, statut daté par l’état OpenSky', async () => {
    const f = stubFetch();
    const s = await fetchAirOverview(null, TRAFFIC_NOW);
    expect(f.mock.calls.map((c) => c[0])).toEqual([AIR_OVERVIEW_URL]);
    await fetchAirOverview(s, TRAFFIC_NOW + AIR_OVERVIEW_TTL_MS - 1);
    expect(f).toHaveBeenCalledTimes(1);
    expect(AIR_OVERVIEW_TTL_MS).toBeLessThan(2 * 60_000);
    expect(airStatus(s, TRAFFIC_NOW)).toEqual({ status: 'ok', lastUpdate: new Date('2026-10-03T15:09:39+02:00'), error: undefined, period: '15:09' });
    expect(airStatus(s, Date.parse('2026-10-03T13:20:00Z')).status).toBe('stale');
    expect(isAirOverviewResponse(airOverviewFixture())).toBe(true);
    expect(isAirOverviewResponse({ ...airOverviewFixture(), emergencies: null })).toBe(false);
  });
  it('départs absents (dernier relevé mémorisé, coupés en développement) : aperçu valide, « départs non relevés » et jamais en retard', () => {
    const none = { ...airOverviewFixture(), airports: airOverviewFixture().airports.map((a) => ({ ...a, departures: null, departuresWindow: null })) };
    expect(isAirOverviewResponse(none)).toBe(true);
    expect(airDeparturesEnd(none)).toBeNull();
    expect(airDeparturesLate(none, TRAFFIC_NOW)).toBe(false);
    expect(airDeparturesLate(null, TRAFFIC_NOW)).toBe(false);
    expect(airStatus({ overview: { data: none, error: null, fetchedAt: TRAFFIC_NOW } }, TRAFFIC_NOW).status).toBe('ok');
  });
  it('retard des départs : 300 min après la fin de la fenêtre', () => {
    const d = airOverviewFixture();
    expect(airDeparturesEnd(d)).toBe('2026-10-03T15:09:00+02:00');
    expect(airDeparturesLate(d, TRAFFIC_NOW)).toBe(false);
    expect(airDeparturesLate(d, Date.parse('2026-10-03T13:09:00Z') + 300 * 60_000 + 1)).toBe(true);
    expect(airDeparturesLate(d, Date.parse('2026-10-03T13:09:00Z') + 300 * 60_000)).toBe(false);
  });
});

describe('réseau ferroviaire : aperçu et situations (spec § 2.4)', () => {
  it('deux routes, cache de 4 min sous la relève de 5 min, statut par source', async () => {
    const f = stubFetch({ [RAIL_SITUATIONS_URL]: { status: 500 } });
    const s = await fetchRailTraffic(null, TRAFFIC_NOW);
    expect(f.mock.calls.map((c) => c[0]).sort()).toEqual([RAIL_OVERVIEW_URL, RAIL_SITUATIONS_URL].sort());
    expect(s.overview.data?.longDistance.active).toBe(37);
    expect(s.situations).toEqual({ data: null, error: 'HTTP 500', fetchedAt: null });
    expect(RAIL_TTL_MS).toBeLessThan(5 * 60_000);
    expect(railStatus(s, 'overview', TRAFFIC_NOW)).toMatchObject({ status: 'ok', period: '15:10' });
    expect(railStatus(s, 'situations', TRAFFIC_NOW)).toEqual({ status: 'error', lastUpdate: null, error: 'HTTP 500', period: undefined });
    expect(isRailOverviewResponse(railOverviewFixture())).toBe(true);
    expect(isRailSituationsResponse(railSituationsFixture())).toBe(true);
    expect(isRailOverviewResponse({ ...railOverviewFixture(), longDistance: null })).toBe(false);
  });
  it('sept axes ou huit avec « Non rattaché » : jamais exactement sept ; trains du jour absents sans panne', () => {
    const base = railOverviewFixture();
    const group = { key: 'non-rattache', label: 'Non rattaché', trains: 2, avgDelayMin: 3, maxDelayMin: 5, cancelled: 0, reduced: 0, detour: 0 };
    expect(isRailOverviewResponse({ ...base, axes: [...base.axes, group] })).toBe(true);
    expect(isRailOverviewResponse({ ...base, axes: base.axes.slice(0, 3) })).toBe(true);
    expect(isRailOverviewResponse({ ...base, axes: [{ key: 1 }] })).toBe(false);
    const empty = { ...base, trains: [], topDelays: [], errors: [] };
    expect(isRailOverviewResponse(empty)).toBe(true);
    expect(railStatus({ overview: { data: empty, error: null, fetchedAt: TRAFFIC_NOW }, situations: { data: null, error: null, fetchedAt: null } },
      'overview', TRAFFIC_NOW).status).toBe('ok');
  });
});

describe('trafic maritime : instantané du relais (spec § 2.5)', () => {
  it('adresse de l’instantané déduite du relais WebSocket', () => {
    expect(maritimeSnapshotUrl('wss://www.francemonitor.com/relay')).toBe(SNAPSHOT_URL);
    expect(maritimeSnapshotUrl('ws://localhost:8090')).toBe('http://localhost:8090/snapshot');
    expect(maritimeSnapshotUrl('wss://www.francemonitor.com/relay/')).toBe(SNAPSHOT_URL);
    expect(maritimeSnapshotUrl(null)).toBeNull();
    expect(maritimeSnapshotUrl('pas une adresse')).toBeNull();
    expect(maritimeSnapshotUrl('ftp://exemple.fr')).toBeNull();
  });
  it('lecture, cache de 90 s, relais non configuré dit, statut sur le dernier message AIS', async () => {
    const f = stubFetch();
    const s = await fetchMaritimeSnapshot(null, 'wss://www.francemonitor.com/relay', TRAFFIC_NOW);
    expect(f.mock.calls.map((c) => c[0])).toEqual([SNAPSHOT_URL]);
    expect(s.snapshot.data?.vessels).toBe(1196);
    expect(MARITIME_SNAPSHOT_TTL_MS).toBeLessThan(2 * 60_000);
    const none = await fetchMaritimeSnapshot(s, null, TRAFFIC_NOW);
    expect(none.snapshot).toEqual({ data: s.snapshot.data, error: 'relais AIS non configuré', fetchedAt: TRAFFIC_NOW });
    expect(maritimeStatus(s, TRAFFIC_NOW)).toMatchObject({ status: 'ok', period: '15:12' });
    expect(maritimeStatus(s, Date.parse('2026-10-03T13:18:00Z')).status).toBe('stale');
    expect(isMaritimeSnapshot(maritimeSnapshotFixture())).toBe(true);
    expect(isMaritimeSnapshot({ ...maritimeSnapshotFixture(), sensitive: { tankers: 1 } })).toBe(false);
    expect(isMaritimeSnapshot({ ...maritimeSnapshotFixture(), byType: { cargo: 'x' } })).toBe(false);
    expect(isMaritimeSnapshot({ ...maritimeSnapshotFixture(), byType: null })).toBe(false);
    const sum = Object.values(maritimeSnapshotFixture().byType).reduce((a, b) => a + b, 0);
    expect(Object.keys(maritimeSnapshotFixture().byType)).toHaveLength(11);
    expect(sum).toBe(maritimeSnapshotFixture().vessels);
  });
});
