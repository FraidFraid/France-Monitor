// tests/sovereignty-contract-b.test.ts : contrat serveur / client de la phase B (spec 2026-10-04 souveraineté § 5 ; amendement 7, O15 à
// O17, S6 à S8). Chaque réponse construite par le code du serveur sur les réponses réelles du 04/10/2026 passe la garde de forme exacte
// du client, réponses partielles, notes d'avancement et 502 compris, et donne la ligne du panneau des sources attendue : une panne est
// nommée par le serveur, jamais « réponse mal formée ». Le fichier publié des zones drones passe la sienne, les textes S6 et le lien du
// registre officiel (S7) du client sont ceux du serveur, et aucune réponse ne porte un nom, un courriel ou un numéro de téléphone.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import { __resetAdsbLolForTests } from '../api/_lib/adsb-lol.js';
import { GNSS_PENDING_NOTE, __resetGnssForTests } from '../api/_lib/gnss-collect.js';
import { RIPE_PENDING_NOTE, __resetRipeForTests } from '../api/_lib/ripestat.js';
import { GELS_DATE_URL, GELS_FILE_URL, GELS_PENDING_NOTE, GELS_REGISTRY_URL as SERVER_GELS_REGISTRY_URL, __resetGelsForTests } from '../api/_lib/gels-avoirs.js';
import { NOAA_ALERTS_URL, NOAA_KP_URL, NOAA_SCALES_URL } from '../api/_lib/noaa-swpc.js';
import { PEERINGDB_IX_URL } from '../api/_lib/peeringdb.js';
import { DRONES_LEGEND, DRONES_POINTER, DRONES_POINTER_URL, DRONES_TITLE } from '../api/_lib/drone-zones.js';
import { loadGnss } from '../api/_handlers/sovereignty/gnss.js';
import { loadConnectivity } from '../api/_handlers/sovereignty/connectivity.js';
import { loadSanctions } from '../api/_handlers/sovereignty/sanctions.js';
import {
  GNSS_FIXTURE, GNSS_STORM_FIXTURE, SANCTIONS_FIXTURE, CONNECTIVITY_FIXTURE, SOV_FIXTURE_NOW,
} from '../src/components/layer-panel/sovereignty.fixture.ts';
import { resetSovereigntySourceCache } from '../src/services/sovereignty-source.ts';
import { GNSS_URL, fetchGnss, gnssStatus, isGnssResponse } from '../src/services/sovereignty-gnss.ts';
import { CONNECTIVITY_URL, fetchConnectivity, isConnectivityResponse, ripeStatus } from '../src/services/sovereignty-connectivity.ts';
import { GELS_REGISTRY_URL, SANCTIONS_URL, fetchSanctions, gelsStatus, isSanctionsResponse } from '../src/services/sovereignty-sanctions.ts';
import { DRONES_LEGEND as CLIENT_LEGEND, DRONES_POINTER as CLIENT_POINTER, DRONES_POINTER_URL as CLIENT_POINTER_URL, DRONES_TITLE as CLIENT_TITLE } from '../src/services/sovereignty-drones.ts';
import { isDroneZonesFile } from '../src/services/sovereignty-military.ts';
import { type FakeResponse, respond, stubFetch } from './helpers/traffic-fixtures.ts';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/sovereignty/${name}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-04T16:50:00+02:00');
/** Ce que le navigateur reçoit : le corps après sérialisation JSON. */
const wire = (body: unknown): unknown => JSON.parse(JSON.stringify(body)) as unknown;
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  let value: T | undefined;
  p.then((v) => { done = true; value = v; }, () => { done = true; });
  for (let i = 0; i < 300 && !done; i += 1) await vi.advanceTimersByTimeAsync(1_000);
  return value as T;
}
function sources(override: (url: string) => FakeResponse | Promise<FakeResponse> | null = () => null): void {
  let point = 0;
  stubFetch((url) => {
    const o = override(url);
    if (o) return o;
    if (url.startsWith('https://api.adsb.lol/')) { point += 1; return respond(fx(point % 2 === 1 ? 'adsb-lol-point-ouest.json' : 'adsb-lol-point-sud-est.json')); }
    if (url === NOAA_SCALES_URL) return respond(fx('noaa-scales.json'));
    if (url === NOAA_KP_URL) return respond(fx('noaa-planetary-k-index.json'));
    if (url === NOAA_ALERTS_URL) return respond(fx('noaa-alerts-reduit.json'));
    const m = /resource=AS(\d+)&sourceapp=francemonitor$/.exec(url);
    if (m) return respond(fx(`ripestat-routing-status-AS${m[1]}.json`));
    if (url === PEERINGDB_IX_URL) return respond(fx('peeringdb-ix-fr.json'));
    if (url === GELS_DATE_URL) return respond(fx('dgtresor-gels-derniere-date.txt'));
    if (url === GELS_FILE_URL) return respond(fx('dgtresor-gels-reduit.json'));
    return respond('introuvable', 404);
  });
}
/** Sert au client la réponse du serveur telle que le navigateur la reçoit (statut HTTP, corps sérialisé). */
function serveToClient(url: string, status: number, body: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    if (u !== url) throw new Error(`URL inattendue ${u}`);
    return { ok: status >= 200 && status < 300, status, json: async () => wire(body) };
  }));
}
const resetServer = (): void => {
  __resetSwrCacheForTests(); __resetKvForTests(); __resetAdsbLolForTests(); __resetGnssForTests(); __resetRipeForTests(); __resetGelsForTests();
};

beforeEach(() => {
  resetServer();
  resetSovereigntySourceCache();
  __setKvClientForTests({ get: async () => null, set: async () => undefined });
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { __setKvClientForTests(null); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('contrat GNSS', () => {
  it('grille complète et météo spatiale : acceptée, servie au client, deux lignes « ok » ; premier cycle : référence en construction, jamais une panne', async () => {
    sources();
    const body = await settle(loadGnss(NOW, { budgetMs: 120_000 }));
    expect(isGnssResponse(wire(body))).toBe(true);
    expect(body.cellsDay).toBeNull();
    expect(body.errors).toEqual(['Grille GNSS : référence en construction']);
    serveToClient(GNSS_URL, 200, body);
    const state = await fetchGnss(null, NOW);
    expect(state.gnss.error).toBeNull();
    const grid = gnssStatus(state, 'adsb-gnss', NOW);
    expect([grid.status, grid.error, gnssStatus(state, 'noaa', NOW).status]).toEqual(['ok', undefined, 'ok']);
    expect(grid.period).toContain('Grille GNSS : référence en construction');
  });
  it('NOAA en panne : réponse partielle acceptée, « NOAA SWPC » en erreur, la grille reste « ok » ; rien de lu : réponse de 502 acceptée, pannes nommées', async () => {
    sources((url) => (url.includes('swpc.noaa.gov') ? respond('indisponible', 503) : null));
    const partial = await settle(loadGnss(NOW, { budgetMs: 120_000 }));
    expect(isGnssResponse(wire(partial))).toBe(true);
    serveToClient(GNSS_URL, 200, partial);
    const state = await fetchGnss(null, NOW);
    expect(gnssStatus(state, 'noaa', NOW).status).toBe('error');
    expect(gnssStatus(state, 'adsb-gnss', NOW).status).toBe('ok');
    resetServer();
    resetSovereigntySourceCache();
    sources(() => respond('indisponible', 503));
    const down = await settle(loadGnss(NOW, { budgetMs: 120_000 }));
    expect([down.readAt, down.spaceWeather.readAt, down.cells]).toEqual([null, null, []]);
    expect(isGnssResponse(wire(down))).toBe(true);
    serveToClient(GNSS_URL, 502, down);
    const failed = await fetchGnss(null, NOW);
    expect(failed.gnss.error).toMatch(/^Grille GNSS, lecture 1 sur 5 : .*NOAA SWPC, échelles : HTTP 503/);
    expect(failed.gnss.error).not.toContain('mal formée');
  });
  it('cycle plus long que l’échéance : météo servie, note de collecte en cours, ligne de la grille « loading » et non une panne', async () => {
    sources((url) => (url.startsWith('https://api.adsb.lol/') ? new Promise<FakeResponse>(() => {}) : null));
    const body = await settle(loadGnss(NOW, { budgetMs: 2_000 }));
    expect(body.errors).toContain(GNSS_PENDING_NOTE);
    expect(isGnssResponse(wire(body))).toBe(true);
    serveToClient(GNSS_URL, 200, body);
    const state = await fetchGnss(null, NOW);
    expect(gnssStatus(state, 'adsb-gnss', NOW)).toMatchObject({ status: 'loading', error: undefined });
    expect(gnssStatus(state, 'noaa', NOW)).toMatchObject({ status: 'ok' });
  });
});

describe('contrat Connectivité', () => {
  it('complète, partielle (PeeringDB en panne), un réseau illisible, rien de lu : acceptées, lignes nommées', async () => {
    sources();
    const full = await loadConnectivity(NOW);
    expect(isConnectivityResponse(wire(full))).toBe(true);
    expect([full.networks.length, full.unread]).toEqual([6, []]);
    serveToClient(CONNECTIVITY_URL, 200, full);
    expect(ripeStatus(await fetchConnectivity(null, NOW), NOW).status).toBe('ok');

    resetServer();
    resetSovereigntySourceCache();
    sources((url) => (url === PEERINGDB_IX_URL ? respond('indisponible', 503) : null));
    const noIx = await loadConnectivity(NOW);
    expect(isConnectivityResponse(wire(noIx))).toBe(true);
    serveToClient(CONNECTIVITY_URL, 200, noIx);
    expect(ripeStatus(await fetchConnectivity(null, NOW), NOW)).toMatchObject({ status: 'ok', error: undefined });

    resetServer();
    resetSovereigntySourceCache();
    sources((url) => (url.includes('resource=AS15557') ? respond('indisponible', 503) : null));
    const oneDown = await loadConnectivity(NOW);
    expect(isConnectivityResponse(wire(oneDown))).toBe(true);
    expect([oneDown.networks.length, oneDown.unread]).toEqual([5, [{ asn: 15557, name: 'SFR', error: 'RIPEstat, AS15557 : HTTP 503' }]]);
    serveToClient(CONNECTIVITY_URL, 200, oneDown);
    expect(ripeStatus(await fetchConnectivity(null, NOW), NOW)).toMatchObject({ status: 'stale', error: 'RIPEstat, AS15557 : HTTP 503' });

    resetServer();
    resetSovereigntySourceCache();
    sources(() => respond('indisponible', 503));
    const down = await loadConnectivity(NOW);
    expect(isConnectivityResponse(wire(down))).toBe(true);
    expect([down.networks, down.unread.length, down.exchanges]).toEqual([[], 6, null]);
    serveToClient(CONNECTIVITY_URL, 502, down);
    const failed = await fetchConnectivity(null, NOW);
    expect(failed.connectivity.error).toContain('RIPEstat, AS3215 : HTTP 503');
    expect(failed.connectivity.error).not.toContain('mal formée');
  });
  it('lecture plus longue que l’échéance : note « RIPEstat : lecture en cours », ligne « loading »', async () => {
    sources((url) => (url.includes('stat.ripe.net') ? new Promise<FakeResponse>(() => {}) : null));
    const body = await settle(loadConnectivity(NOW, { budgetMs: 2_000 }));
    expect(body.errors).toContain(RIPE_PENDING_NOTE);
    expect(isConnectivityResponse(wire(body))).toBe(true);
    serveToClient(CONNECTIVITY_URL, 200, body);
    expect(ripeStatus(await fetchConnectivity(null, NOW), NOW)).toMatchObject({ status: 'loading', error: undefined });
  });
});

describe('contrat Registre des gels', () => {
  it('premier passage (différence n.d.), reprise, lecture en cours et 502 : acceptés, aucun nom dans la réponse', async () => {
    sources();
    const first = await loadSanctions(NOW);
    expect(isSanctionsResponse(wire(first))).toBe(true);
    expect([first.current?.added, first.current?.removed]).toEqual([null, null]);
    expect(JSON.stringify(first)).not.toMatch(/Personne fictive|"Nom"|"nom"/);
    serveToClient(SANCTIONS_URL, 200, first);
    expect(gelsStatus(await fetchSanctions(null, NOW), NOW).status).toBe('ok');

    resetServer();
    resetSovereigntySourceCache();
    sources((url) => (url === GELS_FILE_URL ? new Promise<FakeResponse>(() => {}) : null));
    const pending = await settle(loadSanctions(NOW, { budgetMs: 2_000 }));
    expect(pending.errors).toContain(GELS_PENDING_NOTE);
    expect(isSanctionsResponse(wire(pending))).toBe(true);
    serveToClient(SANCTIONS_URL, 200, pending);
    expect(gelsStatus(await fetchSanctions(null, NOW), NOW)).toMatchObject({ status: 'loading', error: undefined });

    resetServer();
    resetSovereigntySourceCache();
    sources(() => respond('erreur', 500));
    const down = await loadSanctions(NOW);
    expect(isSanctionsResponse(wire(down))).toBe(true);
    serveToClient(SANCTIONS_URL, 502, down);
    const failed = await fetchSanctions(null, NOW);
    expect(failed.sanctions.error).toMatch(/^Registre des gels, date : /);
    expect(gelsStatus({ sanctions: { data: down, error: null, fetchedAt: NOW } }, NOW).status).toBe('error');
  });
});

describe('jeux d’essai clients et fichiers publiés', () => {
  it('chaque jeu d’essai passe la garde du client, sans nom, courriel ni numéro de téléphone', () => {
    const all = JSON.stringify([GNSS_FIXTURE(), GNSS_STORM_FIXTURE(), CONNECTIVITY_FIXTURE(), SANCTIONS_FIXTURE()]);
    expect(isGnssResponse(wire(GNSS_FIXTURE())) && isGnssResponse(wire(GNSS_STORM_FIXTURE()))).toBe(true);
    expect(isConnectivityResponse(wire(CONNECTIVITY_FIXTURE())) && isSanctionsResponse(wire(SANCTIONS_FIXTURE()))).toBe(true);
    expect(all).not.toMatch(/@|mailto:|tel:|\+33|"hex"|"callsign"|"registration"/i);
    expect(all.includes(String.fromCharCode(0x2014))).toBe(false);
    expect(gnssStatus({ gnss: { data: GNSS_FIXTURE(), error: null, fetchedAt: SOV_FIXTURE_NOW } }, 'adsb-gnss', SOV_FIXTURE_NOW).status).toBe('ok');
  });
  it('public/data/drone-restrictions.json passe la garde du client', () => {
    const file: unknown = JSON.parse(readFileSync(new URL('../public/data/drone-restrictions.json', import.meta.url), 'utf8'));
    expect(isDroneZonesFile(file)).toBe(true);
  });
  it('titre, légende et renvoi des zones drones (S6) et lien du registre des gels (S7) : ceux du serveur', () => {
    expect([CLIENT_TITLE, CLIENT_LEGEND, CLIENT_POINTER, CLIENT_POINTER_URL]).toEqual([DRONES_TITLE, DRONES_LEGEND, DRONES_POINTER, DRONES_POINTER_URL]);
    expect(GELS_REGISTRY_URL).toBe(SERVER_GELS_REGISTRY_URL);
  });
});
