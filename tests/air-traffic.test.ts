import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetKvForTests, __setKvClientForTests, readLog, readSeries } from '../api/_lib/kv-history.js';
import {
  CREDIT_FLOOR, DEPARTURES_KEY, DEPARTURE_AIRPORTS, EMERGENCY_LOG_KEY, VOLUME_KEY, __resetAirStateForTests, boardCounts, departuresUrl, emergenciesFrom,
  ensureAirFresh, fetchAirTrafficSnapshot, normalizeOpenSkyState, parseBeauvaisDirectory, parseBordeauxDirectory, statesUrl, toMapFlight, volumeSample,
} from '../api/_shared/air-traffic.js';
import { type FakeResponse, fixtureJson, fixtureText, respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

type Raw = { time: number; states: unknown[][] };
const STATES = fixtureJson<Raw>('opensky-states.json');
const T0 = STATES.time * 1000 + 20_000; // 13 h 09 min 59 s UTC, 15 h 09 à Paris
const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const BVA = 'https://www.aeroportparisbeauvais.com/en/flights/live-flight-information/find-your-flight';

/** États réels de 15 h 09 dont certains codes transpondeur sont remplacés pour simuler une urgence. */
function statesWith(squawks: Record<string, string> = {}): Raw {
  return { time: STATES.time, states: STATES.states.map((s) => (squawks[String(s[0])] ? [...s.slice(0, 14), squawks[String(s[0])], ...s.slice(15)] : s)) };
}

function stubOpenSky({ states = STATES, remaining = '3619', override = () => null }: { states?: Raw; remaining?: string; override?: (url: string) => FakeResponse | null } = {}) {
  return stubFetch((url) => {
    const forced = override(url);
    if (forced) return forced;
    if (url === TOKEN_URL) return respond({ access_token: 'jeton-de-test', expires_in: 1800 });
    if (url === statesUrl()) return respond(states, 200, { 'X-Rate-Limit-Remaining': remaining });
    if (url.startsWith('https://opensky-network.org/api/flights/departure?airport=LFPG')) return respond(fixtureText('opensky-departures-lfpg.json'));
    if (url.startsWith('https://opensky-network.org/api/flights/departure')) return respond('', 404);
    if (url === BVA) return respond(fixtureText('board-bva.html'));
    if (url.endsWith('?w=out')) return respond(fixtureText('board-bod-departures.html'));
    if (url.includes('bordeaux.aeroport.fr')) return respond(fixtureText('board-bod-arrivals.html'));
    return respond('introuvable', 404);
  });
}

beforeEach(() => {
  __resetAirStateForTests();
  __resetKvForTests();
  __setKvClientForTests({ get: async () => null, set: async () => {} });
  vi.stubEnv('OPENSKY_CLIENT_ID', 'client-de-test');
  vi.stubEnv('OPENSKY_CLIENT_SECRET', 'secret-de-test');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); __setKvClientForTests(null); __resetKvForTests(); });

describe('états OpenSky (réponse réelle de 15 h 09, extended=1)', () => {
  it('normalisation : position, altitudes, squawk et catégorie gardés ; état vu il y a plus de 5 min écarté', () => {
    expect(normalizeOpenSkyState(STATES.states[0], STATES.time)).toEqual({
      icao24: '51117e', callsign: 'ESZPI', originCountry: 'Estonia', lastContact: 1791032979, lat: 43.9501, lon: 6.9187, baroAltitudeM: 2628.9,
      onGround: false, velocityMs: 56.67, heading: 86.88, verticalRate: 0, geoAltitudeM: 2880.36, squawk: '7021', category: 0,
    });
    expect(STATES.states.map((s) => normalizeOpenSkyState(s, STATES.time)).filter(Boolean)).toHaveLength(203);
  });
  it('vol pour la carte : pieds, nœuds, squawk', () => {
    const state = normalizeOpenSkyState(STATES.states[0], STATES.time);
    expect(state && toMapFlight(state)).toMatchObject({ id: '51117e', altitude: 8625, speed: 110, heading: 87, squawk: '7021', category: '0', source: 'opensky' });
  });
  it('volume : en vol dans la zone suivie et au-dessus du territoire', () => {
    const states = STATES.states.map((s) => normalizeOpenSkyState(s, STATES.time)).filter((s): s is NonNullable<typeof s> => s !== null);
    expect(volumeSample(states, '2026-10-03T13:09:39.000Z')).toEqual({ at: '2026-10-03T13:09:39.000Z', airborneZone: 166, airborneFrance: 114 });
  });
  it('urgences : 7700 au-dessus de l’Aube compté, 7700 au-dessus de l’Allemagne non, 7600 à 24 km de la côte compté (approches)', () => {
    const raw = statesWith({ '440202': '7700', '3ffc67': '7700', '3c5ee2': '7600' });
    const states = raw.states.map((s) => normalizeOpenSkyState(s, raw.time)).filter((s): s is NonNullable<typeof s> => s !== null);
    expect(emergenciesFrom(states, '2026-10-03T13:09:39.000Z').map((e) => [e.icao24, e.callsign, e.squawk, e.overFrance])).toEqual([
      ['3c5ee2', 'EWG02JB', '7600', true], ['3ffc67', 'DMLJS', '7700', false], ['440202', 'TAY4RQ', '7700', true],
    ]);
  });
});

describe('annuaires officiels (pages réelles du 03/10/2026)', () => {
  it('Beauvais : 3 vols retardés ; Bordeaux : 2 retardés, 3 annulés', () => {
    expect(boardCounts(parseBeauvaisDirectory(fixtureText('board-bva.html'), '03/10/2026'))).toEqual({ delayed: 3, cancelled: 0 });
    const bod = [...parseBordeauxDirectory(fixtureText('board-bod-arrivals.html'), 'arrival'), ...parseBordeauxDirectory(fixtureText('board-bod-departures.html'), 'departure')];
    expect(boardCounts(bod)).toEqual({ delayed: 2, cancelled: 3 });
  });
  it('vols d’un autre jour écartés ; page sans tableau : erreur', () => {
    expect(parseBeauvaisDirectory(fixtureText('board-bva.html'), '04/10/2026')).toEqual([]);
    expect(() => parseBordeauxDirectory('<html><body>Maintenance</body></html>', 'arrival')).toThrow(SyntaxError);
  });
});

describe('collecte serveur unique (2 min)', () => {
  it('jeton, états identifiés et authentifiés, annuaires, départs des 8 aéroports ; aucune requête dans les 2 min', async () => {
    const log = stubOpenSky();
    const c = await ensureAirFresh(T0);
    expect(c.at).toBe('2026-10-03T13:09:39.000Z');
    expect(c.errors).toEqual([]);
    expect(c.credits).toBe(3619);
    const states = log.inits[log.urls.indexOf(statesUrl())];
    expect(sentHeader(states, 'Authorization')).toBe('Bearer jeton-de-test');
    expect(sentHeader(states, 'User-Agent')).toBe('FranceMonitor/1.0 (+https://www.francemonitor.com)');
    expect(log.urls.filter((u) => u.includes('/flights/departure'))).toHaveLength(DEPARTURE_AIRPORTS.length);
    expect(c.departures?.counts).toEqual({ LFPG: 25, LFPO: 0, LFMN: 0, LFLL: 0, LFML: 0, LFBO: 0, LFBD: 0, LFRS: 0 });
    expect(c.boards).toEqual({ BVA: { delayed: 3, cancelled: 0, at: new Date(T0).toISOString() }, BOD: { delayed: 2, cancelled: 3, at: new Date(T0).toISOString() } });
    const before = log.urls.length;
    await ensureAirFresh(T0 + 60_000);
    expect(log.urls.length).toBe(before);
    await ensureAirFresh(T0 + 120_000);
    expect(log.urls.slice(before)).toEqual([statesUrl()]);
  });
  it('fenêtre des départs : les 2 heures précédant la collecte', async () => {
    const log = stubOpenSky();
    await ensureAirFresh(T0);
    const end = Math.floor(T0 / 1000);
    expect(log.urls).toContain(departuresUrl('LFPG', end - 7200, end));
  });
  it('départs relus toutes les 4 h, pas avant', async () => {
    const departures = (log: { urls: string[] }) => log.urls.filter((u) => u.includes('/flights/departure')).length;
    let log = stubOpenSky();
    await ensureAirFresh(T0);
    expect(departures(log)).toBe(DEPARTURE_AIRPORTS.length);
    log = stubOpenSky();
    await ensureAirFresh(T0 + 4 * 3_600_000 - 60_000);
    expect(departures(log)).toBe(0);
    log = stubOpenSky();
    await ensureAirFresh(T0 + 4 * 3_600_000 + 60_000);
    expect(departures(log)).toBe(DEPARTURE_AIRPORTS.length);
  });
  it(`moins de ${CREDIT_FLOOR} crédits restants : départs suspendus avant les états, erreur nommée`, async () => {
    const log = stubOpenSky({ remaining: '420' });
    const c = await ensureAirFresh(T0);
    expect(log.urls.some((u) => u.includes('/flights/departure'))).toBe(false);
    expect(c.errors).toEqual(['OpenSky : départs suspendus (420 crédits restants, seuil 500)']);
    expect(c.at).toBe('2026-10-03T13:09:39.000Z');
  });
  it('HTTP 429 sur les états : erreur nommée, pause de 10 min sans relancer OpenSky', async () => {
    const log = stubOpenSky({ override: (url) => (url === statesUrl() ? respond('Too many requests', 429) : null) });
    const c = await ensureAirFresh(T0);
    expect([c.at, c.errors]).toEqual([null, ['OpenSky : HTTP 429']]);
    await ensureAirFresh(T0 + 2 * 60_000);
    expect(log.urls.filter((u) => u === statesUrl())).toHaveLength(1);
  });
  it('panne après une collecte réussie : dernière collecte gardée avec sa date, erreur nommée', async () => {
    stubOpenSky();
    await ensureAirFresh(T0);
    stubOpenSky({ override: (url) => (url === statesUrl() ? respond(fixtureText('challenge-captcha.html'), 403) : null) });
    const c = await ensureAirFresh(T0 + 2 * 60_000);
    expect(c.at).toBe('2026-10-03T13:09:39.000Z');
    expect(c.errors).toEqual(['OpenSky : page de contrôle anti-robot (HTTP 403)']);
  });
  it('annuaire de Bordeaux en HTTP 503 : erreur nommée, Beauvais gardé ; pas de nouvel essai avant 10 min', async () => {
    const log = stubOpenSky({ override: (url) => (url.includes('bordeaux.aeroport.fr') ? respond('indisponible', 503) : null) });
    const c = await ensureAirFresh(T0);
    expect(c.errors).toEqual(['Annuaire Bordeaux Mérignac : HTTP 503']);
    expect(c.boards).toMatchObject({ BOD: null, BVA: { delayed: 3, cancelled: 0 } });
    await ensureAirFresh(T0 + 2 * 60_000);
    expect(log.urls.filter((u) => u.includes('bordeaux.aeroport.fr'))).toHaveLength(1);
  });
  it('annuaire de Bordeaux réel avec son formulaire reCAPTCHA : lu, jamais pris pour une page anti-robot', async () => {
    // Pied de page de la vraie page (03/10/2026, 17 h 43), valeurs remplacées : les pages enregistrées étaient réduites.
    const form = '<script src="https://www.google.com/recaptcha/api.js?hl=fr&amp;render=explicit" async defer></script>'
      + '<form><div data-drupal-selector="edit-captcha" class="captcha captcha-type-challenge--recaptcha"><input type="hidden" name="captcha_token" value="x" />'
      + '<div class="g-recaptcha" data-theme="light" data-type="image"></div></div></form>';
    const page = (name: string) => respond(fixtureText(name).replace('</body>', `${form}</body>`));
    stubOpenSky({ override: (url) => (url.includes('bordeaux.aeroport.fr') ? page(url.endsWith('?w=out') ? 'board-bod-departures.html' : 'board-bod-arrivals.html') : null) });
    const c = await ensureAirFresh(T0);
    expect(c.errors).toEqual([]);
    expect(c.boards.BOD).toEqual({ delayed: 2, cancelled: 3, at: new Date(T0).toISOString() });
  });
  it('identifiants absents : aucune requête OpenSky, erreur nommée', async () => {
    vi.stubEnv('OPENSKY_CLIENT_ID', '');
    const log = stubOpenSky();
    const c = await ensureAirFresh(T0);
    expect(log.urls).toEqual([]);
    expect(c.errors).toEqual(['OpenSky : identifiants OpenSky absents (OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET)']);
  });
  it('journal des urgences : première vue gardée d’une collecte à l’autre', async () => {
    stubOpenSky({ states: statesWith({ '440202': '7700' }) });
    await ensureAirFresh(T0);
    stubOpenSky({ states: { ...statesWith({ '440202': '7700' }), time: STATES.time + 120 } });
    await ensureAirFresh(T0 + 120_000);
    const entries = await readLog<{ icao24: string; firstSeen: string; lastSeen: string }>(EMERGENCY_LOG_KEY, { dateOf: (e) => e.lastSeen, maxAgeMs: 7 * 86_400_000, now: T0 + 120_000 });
    expect(entries.map((e) => [e.icao24, e.firstSeen, e.lastSeen])).toEqual([['440202', '2026-10-03T13:09:39.000Z', '2026-10-03T13:11:39.000Z']]);
  });
  it('volume : un échantillon par 10 minutes au plus', async () => {
    stubOpenSky();
    await ensureAirFresh(T0);
    await ensureAirFresh(T0 + 2 * 60_000);
    expect(await readSeries(VOLUME_KEY, { maxAgeMs: 8 * 86_400_000, now: T0 + 2 * 60_000 })).toHaveLength(1);
    stubOpenSky({ states: { ...STATES, time: STATES.time + 600 } });
    await ensureAirFresh(T0 + 10 * 60_000);
    expect(await readSeries(VOLUME_KEY, { maxAgeMs: 8 * 86_400_000, now: T0 + 10 * 60_000 })).toHaveLength(2);
  });
  it('appels simultanés (relève, carte, panneau) : une seule collecte, un seul écrivain du journal, du volume et des départs', async () => {
    const writes: string[] = [];
    const store = new Map<string, string>();
    __setKvClientForTests({ get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => { writes.push(k); store.set(k, v); } });
    const log = stubOpenSky({ states: statesWith({ '440202': '7700', '3c5ee2': '7600' }) });
    const [a, b, snap] = await Promise.all([ensureAirFresh(T0), ensureAirFresh(T0 + 1_000), fetchAirTrafficSnapshot(T0 + 2_000)]);
    expect(b).toBe(a);
    expect(snap.fetchedAt).toBe(STATES.time * 1000);
    expect(log.urls.filter((u) => u === TOKEN_URL)).toHaveLength(1);
    expect(log.urls.filter((u) => u === statesUrl())).toHaveLength(1);
    expect(log.urls.filter((u) => u.includes('/flights/departure'))).toHaveLength(DEPARTURE_AIRPORTS.length);
    expect(writes.filter((k) => k === DEPARTURES_KEY)).toHaveLength(1);
    expect(writes.filter((k) => k === VOLUME_KEY)).toHaveLength(1);
    expect(writes.filter((k) => k === EMERGENCY_LOG_KEY)).toHaveLength(2);
    __resetKvForTests();
    const entries = await readLog<{ icao24: string; lastSeen: string }>(EMERGENCY_LOG_KEY, { dateOf: (e) => e.lastSeen, maxAgeMs: 86_400_000, now: T0 });
    expect(entries.map((e) => e.icao24).sort()).toEqual(['3c5ee2', '440202']);
    expect(await readSeries(VOLUME_KEY, { maxAgeMs: 86_400_000, now: T0 })).toHaveLength(1);
  });
  it('erreur imprévue pendant la collecte : tentative datée, pas de nouvel appel OpenSky avant 2 min', async () => {
    __setKvClientForTests({ get: async (k: string) => (k === EMERGENCY_LOG_KEY ? '[null]' : null), set: async () => {} });
    const log = stubOpenSky({ states: statesWith({ '440202': '7700' }) });
    const c = await ensureAirFresh(T0);
    expect(c.at).toBeNull();
    expect(c.errors).toHaveLength(1);
    expect(c.errors[0]).toMatch(/^Collecte aérienne interrompue : /);
    await ensureAirFresh(T0 + 60_000);
    expect(log.urls.filter((u) => u === statesUrl())).toHaveLength(1);
  });
  it('carte : instantané daté de la donnée, vols en vol seulement, erreurs au format historique', async () => {
    stubOpenSky();
    const snap = await fetchAirTrafficSnapshot(T0);
    expect(snap.fetchedAt).toBe(STATES.time * 1000);
    expect(snap.source).toBe('opensky');
    expect(snap.flights).toHaveLength(166);
    expect(snap.flights.every((f) => f.onGround === false)).toBe(true);
    expect(snap).not.toHaveProperty('topAirports');
  });
});
