import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import { EMERGENCY_LOG_KEY, __airJobsForTests, __resetAirStateForTests, ensureAirFresh, statesUrl } from '../api/_shared/air-traffic.js';
import { airportActivity, loadAirOverview, sameHourValues } from '../api/_lib/air-overview.js';
import handler, { CACHE_CONTROL } from '../api/_handlers/traffic/air-overview.js';
import airHandler from '../api/_handlers/traffic/air.js';
import type { AirOverviewResponse } from '../src/types/index.ts';
import { callHandler, fakeRes, fixtureJson, fixtureText, respond, stubFetch } from './helpers/traffic-fixtures.ts';

// Panne imprévue du panneau simulée sur demande ; sinon la vraie fonction.
vi.mock('../api/_lib/air-overview.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown> & { loadAirOverview: (now?: number) => Promise<unknown> }>();
  return { ...actual, loadAirOverview: vi.fn(actual.loadAirOverview) };
});

const STATES = fixtureJson<{ time: number; states: unknown[][] }>('opensky-states.json');
const NOW = STATES.time * 1000 + 20_000;

function stubAll(statesResponse = respond(STATES, 200, { 'X-Rate-Limit-Remaining': '3619' })) {
  return stubFetch((url) => {
    if (url.includes('/openid-connect/token')) return respond({ access_token: 'jeton-de-test', expires_in: 1800 });
    if (url === statesUrl()) return statesResponse;
    if (url.includes('/flights/departure?airport=LFPG')) return respond(fixtureText('opensky-departures-lfpg.json'));
    if (url.includes('/flights/departure')) return respond('', 404);
    if (url.includes('aeroportparisbeauvais')) return respond(fixtureText('board-bva.html'));
    if (url.endsWith('?w=out')) return respond(fixtureText('board-bod-departures.html'));
    return respond(fixtureText('board-bod-arrivals.html'));
  });
}

beforeEach(() => {
  __resetAirStateForTests();
  __resetKvForTests();
  __setKvClientForTests({ get: async () => null, set: async () => {} });
  vi.stubEnv('OPENSKY_CLIENT_ID', 'client-de-test');
  vi.stubEnv('OPENSKY_CLIENT_SECRET', 'secret-de-test');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(async () => {
  await __airJobsForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  __setKvClientForTests(null);
  __resetKvForTests();
});

/** Première collecte et ses tâches de fond (annuaires, départs) terminées : le panneau sert ensuite sans relire. */
async function warmUp() {
  await ensureAirFresh(NOW);
  await __airJobsForTests();
}

describe('fonctions pures du panneau', () => {
  it('même heure les jours précédents : plus récent d’abord, jour manquant sauté', () => {
    const day = 86_400_000;
    const samples = [7, 5, 3, 1].map((k) => ({ at: new Date(NOW - k * day + 5 * 60_000).toISOString(), airborneZone: 1200 + k, airborneFrance: 800 }));
    expect(sameHourValues(samples, NOW)).toEqual([1201, 1203, 1205, 1207]);
    expect(sameHourValues([{ at: new Date(NOW - day + 20 * 60_000).toISOString(), airborneZone: 1, airborneFrance: 1 }], NOW)).toEqual([]);
  });
  it('activité d’aéroport : point de référence fixe ; départs absents tant qu’ils n’ont pas été lus', () => {
    const cdg = { iata: 'CDG', icao: 'LFPG', name: 'Paris Charles de Gaulle', city: 'Paris', lat: 49.0097, lon: 2.5479, expectedNearby: 0, expectedTerminal: 0 };
    expect(airportActivity(cdg, [], null, null)).toEqual({
      icao: 'LFPG', iata: 'CDG', name: 'Paris Charles de Gaulle', lat: 49.0097, lon: 2.5479, departures: null, departuresWindow: null, onGround: 0, approaching: 0, board: null,
    });
  });
});

describe('/api/traffic/air-overview (OpenSky réel de 15 h 09, annuaires réels)', () => {
  it('200, cache 1 min ; volumes, aéroports, départs datés, annuaires, crédits', async () => {
    stubAll();
    await warmUp();
    const { status, body, cache } = await callHandler<AirOverviewResponse>(handler);
    expect([status, cache]).toEqual([200, CACHE_CONTROL]);
    expect(body).toMatchObject({ at: '2026-10-03T13:09:39.000Z', airborneZone: 166, airborneFrance: 114, onGround: 37, credits: { remaining: 3619 }, errors: [] });
    const end = new Date(Math.floor(NOW / 1000) * 1000).toISOString();
    const begin = new Date((Math.floor(NOW / 1000) - 7200) * 1000).toISOString();
    expect(body.airports.map((a) => [a.iata, a.departures, a.onGround, a.approaching])).toEqual([
      ['CDG', 25, 1, 23], ['ORY', 0, 8, 22], ['NCE', 0, 3, 5], ['LYS', 0, 4, 4], ['MRS', 0, 0, 3], ['TLS', 0, 8, 3], ['BOD', 0, 3, 1], ['NTE', 0, 3, 2], ['BVA', null, 0, 5],
    ]);
    expect(body.airports.map((a) => [a.iata, a.lat, a.lon])).toEqual([
      ['CDG', 49.0097, 2.5479], ['ORY', 48.7262, 2.3652], ['NCE', 43.6653, 7.215], ['LYS', 45.7256, 5.0811], ['MRS', 43.4393, 5.2214],
      ['TLS', 43.6293, 1.3638], ['BOD', 44.8283, -0.7156], ['NTE', 47.1532, -1.6107], ['BVA', 49.4544, 2.1128],
    ]);
    expect(body.airports[0].departuresWindow).toEqual({ begin, end });
    expect(body.airports.find((a) => a.iata === 'BOD')?.board).toEqual({ delayed: 2, cancelled: 3, at: new Date(NOW).toISOString() });
    expect(body.airports.find((a) => a.iata === 'BVA')?.board).toEqual({ delayed: 3, cancelled: 0, at: new Date(NOW).toISOString() });
    expect(body.emergencies).toEqual([]);
    expect(body.volume.samples).toHaveLength(1);
    expect(body.volume.sameHourPrevDays).toEqual([]);
  });
  it('urgences : épisode repris du journal ; une lecture : vu une fois (première vue = dernière) ; deux lectures : confirmé', async () => {
    const withCode = (raw: typeof STATES, sec: number) => ({
      time: raw.time + sec,
      states: raw.states.map((s) => s.map((v, i) => (i === 14 && s[0] === '440202' ? '7700' : (i === 3 || i === 4) && typeof v === 'number' ? v + sec : v))),
    });
    stubAll(respond(withCode(STATES, 0), 200, { 'X-Rate-Limit-Remaining': '3619' }));
    await warmUp();
    const once = await loadAirOverview(NOW);
    expect(once.emergencies.map((e) => [e.icao24, e.firstSeen, e.lastSeen])).toEqual([['440202', '2026-10-03T13:09:39.000Z', '2026-10-03T13:09:39.000Z']]);
    stubAll(respond(withCode(STATES, 120), 200, { 'X-Rate-Limit-Remaining': '3619' }));
    vi.setSystemTime(NOW + 120_000);
    const twice = await loadAirOverview(NOW + 120_000);
    expect(twice.emergencies.map((e) => [e.icao24, e.firstSeen, e.lastSeen])).toEqual([['440202', '2026-10-03T13:09:39.000Z', '2026-10-03T13:11:39.000Z']]);
    expect(twice.emergencyLog.map((e) => [e.icao24, e.firstSeen, e.lastSeen])).toEqual([['440202', '2026-10-03T13:09:39.000Z', '2026-10-03T13:11:39.000Z']]);
  });
  it('réponse partielle (une partie en échec) : cache CDN de 1 min gardé, jamais 5 min (urgences servies fraîches)', async () => {
    __setKvClientForTests({ get: async (k: string) => (k === EMERGENCY_LOG_KEY ? '[null]' : null), set: async () => {} });
    stubAll();
    await warmUp();
    const { status, body, cache } = await callHandler<AirOverviewResponse>(handler);
    expect(status).toBe(200);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(cache).toBe(CACHE_CONTROL);
    expect(CACHE_CONTROL).toBe('s-maxage=60, stale-while-revalidate=120');
  });
  it('OpenSky en HTTP 500 sans collecte antérieure : 502 non mis en cache ; la carte aussi', async () => {
    stubAll(respond('erreur', 500));
    const { status, body, cache } = await callHandler<AirOverviewResponse>(handler);
    expect([status, cache, body.at, body.errors]).toEqual([502, 'no-store', null, ['OpenSky : HTTP 500']]);
    const map = await callHandler<{ error: string }>(airHandler);
    expect([map.status, map.body.error]).toEqual([502, 'OpenSky : HTTP 500']);
  });
  it('carte /api/traffic/air : même collecte, aucun appel de plus', async () => {
    const log = stubAll();
    await callHandler(handler);
    await __airJobsForTests();
    const before = log.urls.length;
    const map = await callHandler<{ flights: unknown[]; fetchedAt: number }>(airHandler);
    expect(map.status).toBe(200);
    expect(map.body.fetchedAt).toBe(STATES.time * 1000);
    expect(log.urls.length).toBe(before);
  });
  it('journal des urgences illisible (stockage clé-valeur) : panneau servi avec une erreur nommée, jamais le 500 du routeur', async () => {
    __setKvClientForTests({ get: async (k: string) => (k === EMERGENCY_LOG_KEY ? '[null]' : null), set: async () => {} });
    stubAll();
    await warmUp();
    const { status, body } = await callHandler<AirOverviewResponse>(handler);
    expect(status).toBe(200);
    expect(body.at).toBe('2026-10-03T13:09:39.000Z');
    expect(body.emergencyLog).toEqual([]);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatch(/^Journal des urgences : /);
  });
  it('panne imprévue du panneau : 502 non mis en cache, erreur nommée, journalisée', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(loadAirOverview).mockRejectedValueOnce(new TypeError('boum'));
    const { status, body, cache } = await callHandler<AirOverviewResponse>(handler);
    expect([status, cache, body.at, body.errors, body.airports]).toEqual([502, 'no-store', null, ['Panneau aérien : boum'], []]);
    expect(logged).toHaveBeenCalledWith('[air-overview]', expect.any(TypeError));
  });
  it('méthode autre que GET : 405', async () => {
    const res = fakeRes();
    await handler({ method: 'POST', query: {} }, res);
    expect(res.statusCode).toBe(405);
  });
});
