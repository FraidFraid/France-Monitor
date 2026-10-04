// src/services/sovereignty-services-b.test.ts : services clients de la phase B (spec 2026-10-04 souveraineté § 3 ; contrats § 3.3 ;
// amendement 7, O15 à O17, S6 à S8). Gardes de forme exacte par élément (un champ en trop ou absent refuse la réponse, nommé par son
// chemin), lecture qui ne rejette jamais, fusion à l'écriture, panneau des sources daté par la donnée (S1, S2), partie jamais lue en
// erreur ; fichier des zones drones lu une fois par session.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONNECTIVITY_FIXTURE, DRONE_ZONES_META_FIXTURE, GNSS_FIXTURE, GNSS_STORM_FIXTURE, SANCTIONS_FIXTURE, SOV_FIXTURE_NOW,
  connectivityStateFixture, gnssStateFixture, sanctionsStateFixture,
} from '../components/layer-panel/sovereignty.fixture.ts';
import { resetSovereigntySourceCache, SOVEREIGNTY_PROGRESS_NOTES, isSovereigntyProgressNote } from './sovereignty-source.ts';
import {
  GNSS_TTL_MS, GNSS_URL, fetchGnss, gnssResponseProblems, gnssStatus, isGnssResponse, mergeGnss,
} from './sovereignty-gnss.ts';
import {
  CONNECTIVITY_URL, connectivityResponseProblems, fetchConnectivity, isConnectivityResponse, mergeConnectivity, ripeStatus,
} from './sovereignty-connectivity.ts';
import {
  GELS_REGISTRY_URL, SANCTIONS_URL, fetchSanctions, gelsStatus, isSanctionsResponse, mergeSanctions, sanctionsResponseProblems,
} from './sovereignty-sanctions.ts';
import { DRONE_ZONES_URL, fetchDroneZones, isDroneZonesFile, resetDroneZonesCache } from './sovereignty-military.ts';

const NOW = SOV_FIXTURE_NOW;
const H = 3_600_000;
type Reply = { status: number; body?: unknown };
function stubFetch(bodies: Record<string, unknown>, over: Record<string, Reply> = {}) {
  const f = vi.fn(async (url: string) => {
    const o = over[url];
    if (o) return { ok: o.status >= 200 && o.status < 300, status: o.status, json: async () => o.body ?? {} };
    if (!(url in bodies)) throw new Error(`URL inattendue ${url}`);
    return { ok: true, status: 200, json: async () => bodies[url] };
  });
  vi.stubGlobal('fetch', f);
  return f;
}
const ZONES = (): unknown => ({
  ...DRONE_ZONES_META_FIXTURE(),
  zones: [{ id: '54999', remarque: "Altitude de référence de l'aérodrome : 112 m", polygons: [[[[5.4168, 43.457], [5.4181, 43.4584], [5.4196, 43.4585], [5.4168, 43.457]]]] }],
});

afterEach(() => { vi.unstubAllGlobals(); resetSovereigntySourceCache(); resetDroneZonesCache(); });

describe('gardes exactes', () => {
  it('jeux d’essai acceptés', () => {
    expect([isGnssResponse(GNSS_FIXTURE()), isGnssResponse(GNSS_STORM_FIXTURE()), isConnectivityResponse(CONNECTIVITY_FIXTURE()), isSanctionsResponse(SANCTIONS_FIXTURE())])
      .toEqual([true, true, true, true]);
  });
  it('GNSS : champ hors contrat, élément mal formé, `degraded` absent, part incohérente : refusés, chemin nommé', () => {
    const g = GNSS_FIXTURE();
    expect(isGnssResponse({ ...g, cells: [{ ...g.cells[0], level: 'rouge' }] })).toBe(false);
    expect(isGnssResponse({ ...g, spaceWeather: { ...g.spaceWeather, kp: [{ at: '2026-10-04T09:00:00.000Z', kp: '5' }] } })).toBe(false);
    expect(isGnssResponse({ ...g, days: { days: [], since: 3 } })).toBe(false);
    const { degraded: _degraded, ...withoutDegraded } = g;
    expect(gnssResponseProblems(withoutDegraded)).toEqual(['degraded (absent)']);
    expect(gnssResponseProblems({ ...g, jammedCells: 2 })).toEqual(['jammedCells (en trop)']);
    expect(gnssResponseProblems({ ...g, cells: [{ ...g.cells[0], hex: '3bf000' }] })).toEqual(['cells[0].hex (en trop)']);
    expect(gnssResponseProblems({ ...g, degraded: { rolling24h: 2, previousUtcDays: [2] } })).toEqual(['degraded.previousUtcDays']);
    expect(isGnssResponse({ ...g, cells: [{ ...g.cells[0], pct: null }] })).toBe(false);
    expect(isGnssResponse({ ...g, cellsDay: '03/10/2026' })).toBe(false);
  });
  it('connectivité : adresse hors des six, pourcentage hors de 0 à 100 ou non fini, point d’échange sans lien : refusés', () => {
    const c = CONNECTIVITY_FIXTURE();
    expect(isConnectivityResponse({ ...c, networks: [{ ...c.networks[0], asn: 64512 }] })).toBe(false);
    expect(isConnectivityResponse({ ...c, networks: [{ ...c.networks[0], visibilityPct: 120 }] })).toBe(false);
    expect(isConnectivityResponse({ ...c, networks: [{ ...c.networks[0], visibilityPct: Number.NaN }] })).toBe(false);
    expect(isConnectivityResponse({ ...c, networks: [{ ...c.networks[0], visibilityPct: Number.POSITIVE_INFINITY }] })).toBe(false);
    expect(isConnectivityResponse({ ...c, exchanges: { readAt: null, items: [{ id: 34, name: 'SFINX', city: 'Paris', updated: null }] } })).toBe(false);
    expect(connectivityResponseProblems({ ...c, exchanges: { readAt: null, items: [{ id: 34, name: 'SFINX', city: 'Paris', updated: null, url: 'https://x.test', email: 'a@b.test' }] } }))
      .toEqual(['exchanges.items[0].email (en trop)']);
  });
  it('connectivité : réseaux non lus nommés (`unread`) acceptés, jamais comptés à 0 ; `unread` et `prefixSamples` facultatifs', () => {
    const c = CONNECTIVITY_FIXTURE();
    const partial = {
      ...c, networks: c.networks.slice(1),
      unread: [{ asn: 3215 as const, name: 'Orange', error: 'RIPEstat, AS3215 : HTTP 503' }, { asn: 2200 as const, name: 'RENATER', error: null }],
    };
    expect(isConnectivityResponse(partial)).toBe(true);
    const { unread: _unread, ...old } = c;
    const { prefixSamples: _prefixes, ...history } = c.history;
    expect(isConnectivityResponse({ ...old, history })).toBe(true);
    expect(isConnectivityResponse({ ...c, unread: [{ asn: 3215, name: 'Orange' }] })).toBe(false);
    expect(isConnectivityResponse({ ...c, history: { ...c.history, prefixSamples: [{ at: '2026-10-04T08:00:00.000Z', prefixes: { x: 1 } }] } })).toBe(false);
  });
  it('gels : aucune donnée nominative acceptée, comptes et dates seulement', () => {
    const s = SANCTIONS_FIXTURE();
    expect(isSanctionsResponse({ ...s, current: { ...s.current, added: '2' } })).toBe(false);
    expect(isSanctionsResponse({ ...s, history: { publications: [{ publishedAt: '2026-10-02T10:36:17.126+02:00', total: 1 }], since: null } })).toBe(false);
    expect(sanctionsResponseProblems({ ...s, current: { ...s.current, nom: 'x' } })).toEqual(['current.nom (en trop)']);
    expect(sanctionsResponseProblems({ ...s, entries: [] })).toEqual(['entries (en trop)']);
    expect(isSanctionsResponse({ ...s, current: { ...s.current, added: null, removed: null } })).toBe(true);
  });
  it('fichier des zones drones : en-tête daté et sourcé, anneaux d’au moins 4 points, aucun champ en plus', () => {
    expect(isDroneZonesFile(ZONES())).toBe(true);
    expect(isDroneZonesFile({ ...(ZONES() as object), zones: [{ id: '1', remarque: null, polygons: [[[[5.4, 43.4], [5.5, 43.5], [5.4, 43.4]]]] }] })).toBe(false);
    expect(isDroneZonesFile({ ...(ZONES() as object), edition: undefined })).toBe(false);
    expect(isDroneZonesFile({ ...(ZONES() as object), extra: 1 })).toBe(false);
  });
});

describe('lectures', () => {
  it('grille GNSS : lue, gardée 8 min ; panne : dernières données gardées, panne portée', async () => {
    const f = stubFetch({ [GNSS_URL]: GNSS_FIXTURE() });
    const first = await fetchGnss(null, NOW);
    expect([first.gnss.data?.frenchCells, first.gnss.error]).toEqual([14, null]);
    await fetchGnss(first, NOW + GNSS_TTL_MS - 1);
    expect(f).toHaveBeenCalledTimes(1);
    stubFetch({}, { [GNSS_URL]: { status: 502 } });
    const failed = await fetchGnss(first, NOW + GNSS_TTL_MS + 1);
    expect([failed.gnss.data?.readAt, failed.gnss.error]).toEqual(['2026-10-04T14:45:24.000Z', 'HTTP 502']);
    expect(mergeGnss(first, failed).gnss.data?.readAt).toBe('2026-10-04T14:45:24.000Z');
  });
  it('502 du serveur de même forme : pannes nommées au lieu de « HTTP 502 »', async () => {
    const down = { ...GNSS_FIXTURE(), readAt: null, cells: [], cellsDay: null, errors: ['Grille GNSS, lecture 1 sur 5 : adsb.lol : HTTP 500', 'NOAA SWPC, échelles : HTTP 503'] };
    stubFetch({}, { [GNSS_URL]: { status: 502, body: down } });
    expect((await fetchGnss(null, NOW)).gnss.error).toBe('Grille GNSS, lecture 1 sur 5 : adsb.lol : HTTP 500 ; NOAA SWPC, échelles : HTTP 503');
  });
  it('connectivité et registre des gels : lus, réponse mal formée nommée', async () => {
    stubFetch({ [CONNECTIVITY_URL]: CONNECTIVITY_FIXTURE(), [SANCTIONS_URL]: { readAt: null } });
    const read = await fetchConnectivity(null, NOW);
    expect(read.connectivity.data?.networks).toHaveLength(6);
    expect(mergeConnectivity(read, { connectivity: { data: null, error: 'HTTP 502', fetchedAt: null } }).connectivity.data?.networks).toHaveLength(6);
    const gels = await fetchSanctions(null, NOW);
    expect(gels.sanctions.error).toMatch(/^réponse du registre des gels mal formée : /);
    expect(gels.sanctions.error).toContain('dateCheckedAt (absent)');
    expect(mergeSanctions(null, gels).sanctions.error).toBe(gels.sanctions.error);
  });
  it('zones drones : une lecture par session ; un échec n’est pas gardé ; jamais de rejet', async () => {
    const f = stubFetch({ [DRONE_ZONES_URL]: ZONES() });
    expect((await fetchDroneZones()).data?.counts.kept).toBe(5541);
    await fetchDroneZones();
    expect(f).toHaveBeenCalledTimes(1);
    resetDroneZonesCache();
    stubFetch({}, { [DRONE_ZONES_URL]: { status: 404 } });
    expect(await fetchDroneZones()).toEqual({ data: null, error: 'zones drones : HTTP 404' });
    const g = stubFetch({ [DRONE_ZONES_URL]: ZONES() });
    expect((await fetchDroneZones()).error).toBeNull();
    expect(g).toHaveBeenCalledTimes(1);
    resetDroneZonesCache();
    stubFetch({ [DRONE_ZONES_URL]: { ...(ZONES() as object), zones: [{ id: '1', remarque: null, polygons: [] }] } });
    expect((await fetchDroneZones()).error).toBe('zones drones : fichier mal formé : zones[1].polygons');
  });
});

describe('panneau des sources (S1, S2) et notes d’avancement', () => {
  it('« Grille GNSS » datée par la collecte complète, en retard après 40 min ; « NOAA SWPC » par l’heure des échelles', () => {
    const slot = gnssStateFixture();
    expect(gnssStatus(slot, 'adsb-gnss', NOW)).toMatchObject({ status: 'ok', lastUpdate: new Date('2026-10-04T14:45:24.000Z') });
    const late = Date.parse('2026-10-04T15:26:00Z');
    expect(gnssStatus(slot, 'adsb-gnss', late).status).toBe('stale');
    expect(gnssStatus(slot, 'adsb-gnss', late).period).toContain('(en retard)');
    expect(gnssStatus(slot, 'noaa', NOW)).toMatchObject({ status: 'ok', lastUpdate: new Date('2026-10-04T14:46:00.000Z') });
    expect(gnssStatus(slot, 'noaa', NOW + 4 * H).status).toBe('stale');
  });
  it('notes d’avancement : jamais des pannes, chacune sur sa ligne', () => {
    const g = GNSS_FIXTURE();
    const building = gnssStateFixture({ ...g, errors: ['Grille GNSS : référence en construction'] });
    expect(gnssStatus(building, 'adsb-gnss', NOW)).toMatchObject({ status: 'ok', error: undefined });
    expect(gnssStatus(building, 'adsb-gnss', NOW).period).toContain('Grille GNSS : référence en construction');
    expect(gnssStatus(building, 'noaa', NOW).period).not.toContain('référence');
    const firstPending = gnssStateFixture({ ...g, readAt: null, errors: ['adsb.lol : collecte en cours'] });
    expect(gnssStatus(firstPending, 'adsb-gnss', NOW)).toEqual({ status: 'loading', lastUpdate: null, error: undefined, period: 'n.d. · adsb.lol : collecte en cours' });
    const pending = gnssStateFixture({ ...g, errors: ['adsb.lol : collecte en cours'] });
    expect(gnssStatus(pending, 'adsb-gnss', NOW)).toMatchObject({ status: 'ok', error: undefined });
    expect(gnssStatus(pending, 'noaa', NOW).period).not.toContain('collecte');
  });
  it('une panne de NOAA ne touche pas la ligne de la grille, et inversement', () => {
    const g = GNSS_FIXTURE();
    const noaaDown = gnssStateFixture({ ...g, spaceWeather: { ...g.spaceWeather, scalesAt: null }, errors: ['NOAA SWPC, échelles : HTTP 503'] });
    expect(gnssStatus(noaaDown, 'adsb-gnss', NOW)).toMatchObject({ status: 'ok', error: undefined });
    expect(gnssStatus(noaaDown, 'noaa', NOW)).toMatchObject({ status: 'error', error: 'NOAA SWPC, échelles : HTTP 503', period: 'n.d.' });
    const gridDown = gnssStateFixture({ ...g, errors: ['Grille GNSS, lecture 3 sur 5 : adsb.lol : HTTP 429, nouvelle tentative après 16:58'] });
    expect(gnssStatus(gridDown, 'adsb-gnss', NOW)).toMatchObject({ status: 'stale', error: 'Grille GNSS, lecture 3 sur 5 : adsb.lol : HTTP 429, nouvelle tentative après 16:58' });
    expect(gnssStatus(gridDown, 'noaa', NOW)).toMatchObject({ status: 'ok', error: undefined });
  });
  it('partie jamais lue alors que la réponse est là : erreur nommée, jamais « en retard » sans date', () => {
    const g = GNSS_FIXTURE();
    const noGrid = gnssStateFixture({ ...g, readAt: null, errors: ['Grille GNSS, lecture 1 sur 5 : adsb.lol : clé requise'] });
    expect(gnssStatus(noGrid, 'adsb-gnss', NOW)).toEqual({ status: 'error', lastUpdate: null, error: 'Grille GNSS, lecture 1 sur 5 : adsb.lol : clé requise', period: 'n.d.' });
    const c = CONNECTIVITY_FIXTURE();
    expect(ripeStatus(connectivityStateFixture({ ...c, snapshotAt: null, networks: [], errors: [] }), NOW))
      .toMatchObject({ status: 'error', error: 'source jamais lue', period: 'n.d.' });
    expect(ripeStatus(connectivityStateFixture(), NOW)).toMatchObject({ status: 'ok', lastUpdate: new Date('2026-10-04T08:00:00.000Z') });
    expect(ripeStatus(connectivityStateFixture(), NOW + 11 * H).status).toBe('stale');
    expect(gelsStatus(sanctionsStateFixture(), NOW)).toMatchObject({ status: 'ok', lastUpdate: new Date('2026-10-04T14:48:30.000Z') });
    expect(gelsStatus(sanctionsStateFixture(), NOW + 27 * H).status).toBe('stale');
    expect(gelsStatus(sanctionsStateFixture({ ...SANCTIONS_FIXTURE(), dateCheckedAt: null, errors: ['Registre des gels, date : HTTP 503'] }), NOW))
      .toMatchObject({ status: 'error', error: 'Registre des gels, date : HTTP 503', period: 'n.d.' });
  });
  it('RIPEstat : PeeringDB en panne ne dégrade pas la ligne ; un réseau illisible oui ; la note « lecture en cours » est jointe à la période', () => {
    const c = CONNECTIVITY_FIXTURE();
    expect(ripeStatus(connectivityStateFixture({ ...c, exchanges: null, errors: ['PeeringDB : HTTP 503'] }), NOW)).toMatchObject({ status: 'ok', error: undefined });
    expect(ripeStatus(connectivityStateFixture({ ...c, errors: ['RIPEstat, AS15557 : HTTP 503'] }), NOW)).toMatchObject({ status: 'stale', error: 'RIPEstat, AS15557 : HTTP 503' });
    const pending = ripeStatus(connectivityStateFixture({ ...c, errors: ['RIPEstat : lecture en cours'] }), NOW);
    expect(pending).toMatchObject({ status: 'ok', error: undefined });
    expect(pending.period).toContain('RIPEstat : lecture en cours');
    expect(gelsStatus(sanctionsStateFixture({ ...SANCTIONS_FIXTURE(), errors: ['Registre des gels : lecture en cours'] }), NOW)).toMatchObject({ status: 'ok', error: undefined });
  });
  it('notes d’avancement de la phase B : jamais des pannes', () => {
    for (const n of ['RIPEstat : lecture en cours', 'Registre des gels : lecture en cours', 'adsb.lol : collecte en cours', 'Grille GNSS : référence en construction']) {
      expect(SOVEREIGNTY_PROGRESS_NOTES).toContain(n);
      expect(isSovereigntyProgressNote(n)).toBe(true);
    }
  });
  it('lien vers le registre officiel porté par le client (S7)', () => {
    expect(GELS_REGISTRY_URL).toBe('https://gels-avoirs.dgtresor.gouv.fr/');
  });
});
