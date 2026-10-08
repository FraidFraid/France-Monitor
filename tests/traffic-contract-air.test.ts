// Contrat serveur / client de l'aperçu aérien (tâche 11 des Trafics) : chaque réponse de /api/traffic/air-overview, construite par le code
// du serveur (états OpenSky et annuaires réels du 03/10/2026, mêmes doublures que air-overview-api.test.ts), doit passer la garde du
// client, y compris quand les départs ne sont pas encore relevés (tâche de fond) ou que des lectures ont échoué (errors[] non vide).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import { EMERGENCY_LOG_KEY, __airJobsForTests, __resetAirStateForTests, ensureAirFresh, statesUrl } from '../api/_shared/air-traffic.js';
import handler from '../api/_handlers/traffic/air-overview.js';
import type { AirOverviewResponse } from '../src/types/index.ts';
import { isAirOverviewResponse } from '../src/services/traffic-air.ts';
import { type FakeResponse, callHandler, fixtureJson, fixtureText, respond, stubFetch } from './helpers/traffic-fixtures.ts';

type Raw = { time: number; states: unknown[][] };
const STATES = fixtureJson<Raw>('opensky-states.json');
const NOW = STATES.time * 1000 + 20_000;

/** Ce que le navigateur reçoit : le corps après sérialisation JSON (champs `undefined` perdus). */
const wire = (body: unknown): unknown => JSON.parse(JSON.stringify(body)) as unknown;

/** États réels dont le premier avion émet le code donné (urgence simulée). */
function statesWithSquawk(squawk: string): Raw {
  return { time: STATES.time, states: STATES.states.map((s, i) => (i === 0 ? [...s.slice(0, 14), squawk, ...s.slice(15)] : s)) };
}

function sources(over: { states?: Raw; departures?: FakeResponse; boards?: FakeResponse } = {}): void {
  stubFetch((url) => {
    if (url.includes('/openid-connect/token')) return respond({ access_token: 'jeton-de-test', expires_in: 1800 });
    if (url === statesUrl()) return respond(over.states ?? STATES, 200, { 'X-Rate-Limit-Remaining': '3619' });
    if (url.includes('/flights/departure?airport=LFPG')) return over.departures ?? respond(fixtureText('opensky-departures-lfpg.json'));
    if (url.includes('/flights/departure')) return over.departures ?? respond('', 404);
    if (url.includes('aeroportparisbeauvais')) return over.boards ?? respond(fixtureText('board-bva.html'));
    if (url.endsWith('?w=out')) return over.boards ?? respond(fixtureText('board-bod-departures.html'));
    return over.boards ?? respond(fixtureText('board-bod-arrivals.html'));
  });
}

async function warmUp(): Promise<void> {
  await ensureAirFresh(NOW);
  await __airJobsForTests();
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

describe('contrat air-overview', () => {
  it('réponse complète (départs et annuaires relevés) acceptée', async () => {
    sources();
    await warmUp();
    const { status, body } = await callHandler<AirOverviewResponse>(handler);
    expect([status, body.errors]).toEqual([200, []]);
    expect(body.airports.some((a) => a.departures !== null && a.departuresWindow !== null)).toBe(true);
    expect(body.airports.some((a) => a.board !== null)).toBe(true);
    expect(isAirOverviewResponse(wire(body))).toBe(true);
  });
  it('urgence en cours : lignes d’urgence et journal acceptés', async () => {
    sources({ states: statesWithSquawk('7700') });
    await warmUp();
    const { body } = await callHandler<AirOverviewResponse>(handler);
    expect(body.emergencies.length + body.emergencyLog.length).toBeGreaterThan(0);
    expect(isAirOverviewResponse(wire(body))).toBe(true);
  });
  it('départs pas encore relevés (tâche de fond) : acceptée, départs null et sans erreur', async () => {
    sources();
    const { status, body } = await callHandler<AirOverviewResponse>(handler);
    expect(status).toBe(200);
    expect(body.errors).toEqual([]);
    expect(body.airports.length).toBeGreaterThan(0);
    expect(body.airports.every((a) => a.departures === null && a.departuresWindow === null)).toBe(true);
    expect(body.airports.filter((a) => a.board !== null).map((a) => a.iata).sort()).toEqual(['BOD', 'BVA']);
    expect(isAirOverviewResponse(wire(body))).toBe(true);
  });
  it('dégradée (départs en HTTP 429, annuaires en 500, journal illisible) : erreurs nommées, acceptée', async () => {
    __setKvClientForTests({ get: async (k: string) => (k === EMERGENCY_LOG_KEY ? '[null]' : null), set: async () => {} });
    sources({ departures: respond('quota', 429), boards: respond('erreur', 500) });
    await warmUp();
    const { status, body } = await callHandler<AirOverviewResponse>(handler);
    expect(status).toBe(200);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.airports.every((a) => a.departures === null)).toBe(true);
    expect(isAirOverviewResponse(wire(body))).toBe(true);
  });
});
