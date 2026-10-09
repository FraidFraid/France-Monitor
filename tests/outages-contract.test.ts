import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { ARCEP_DATASET_URL, __resetTelecomForTests, arcepFileUrl } from '../api/_lib/outages-telecom.js';
import { IIP_PRODUCTION_URL, IIP_TRANSMISSION_URL, __resetPowerForTests } from '../api/_lib/outages-power.js';
import telecomHandler from '../api/_handlers/outages/telecom.js';
import powerHandler from '../api/_handlers/outages/power.js';
import internetHandler from '../api/_handlers/outages/internet.js';
import cloudHandler from '../api/_handlers/outages/cloud.js';
import { __resetInternetForTests } from '../api/_lib/outages-internet.js';
import { CLOUD_PENDING_NOTE as SERVER_CLOUD_PENDING_NOTE, __resetCloudForTests } from '../api/_lib/outages-cloud.js';
import { resetSovereigntySourceCache } from '../src/services/sovereignty-source.ts';
import { TELECOM_URL, arcepStatus, fetchTelecom, isTelecomOutagesResponse, telecomResponseProblems } from '../src/services/outages-telecom.ts';
import { POWER_URL, edfStatus, fetchPower, iipStatus, isPowerOutagesResponse, powerResponseProblems } from '../src/services/outages-power.ts';
import {
  INTERNET_PENDING_NOTE, INTERNET_URL, RADAR_NOT_CONFIGURED_PERIOD, fetchInternet, internetResponseProblems, iodaStatus, isInternetOutagesResponse, mergeInternet,
  radarStatus,
} from '../src/services/outages-internet.ts';
import { CLOUD_PENDING_NOTE, CLOUD_URL, cloudResponseProblems, cloudStatus, fetchCloud, isCloudOutagesResponse, mergeCloud } from '../src/services/outages-cloud.ts';
import { INTERNET_PENDING_NOTE as SERVER_INTERNET_PENDING_NOTE } from '../api/_lib/outages-internet.js';
import { cloudRoute, internetRoute } from './helpers/outages-b-fixtures.ts';
import { callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';
import type { CloudOutagesResponse, InternetOutagesResponse, PowerOutagesResponse, TelecomOutagesResponse } from '../src/types/index.ts';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/outages/${name}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-08T20:00:00Z');
const wire = (b: unknown): unknown => JSON.parse(JSON.stringify(b)) as unknown;
function upstream(url: string) {
  if (url === ARCEP_DATASET_URL) return respond({ resources: [
    { title: '2026-10-08.geojson', format: 'geojson', url: arcepFileUrl('2026-10-08'), last_modified: '2026-10-08T09:02:20+00:00' },
    { title: '2026-10-07.geojson', format: 'geojson', url: arcepFileUrl('2026-10-07'), last_modified: '2026-10-07T09:02:12+00:00' },
  ] });
  if (url === arcepFileUrl('2026-10-08')) return respond(fx('arcep-2026-10-08.geojson'), 200, { 'last-modified': 'Thu, 08 Oct 2026 09:02:20 GMT' });
  if (url === arcepFileUrl('2026-10-07')) return respond(fx('arcep-2026-10-07.geojson'), 200, { 'last-modified': 'Wed, 07 Oct 2026 09:02:12 GMT' });
  if (url.startsWith('https://opendata.edf.fr/data-fair/api/v1/datasets/indisponibilites-des-moyens-de-production-edf-sa/lines')) return respond(fx('edf-indispo-2026-10-08.json'));
  if (url === 'https://opendata.edf.fr/data-fair/api/v1/datasets/indisponibilites-des-moyens-de-production-edf-sa') return respond({ dataUpdatedAt: '2026-10-08T10:00:17.798Z' });
  if (url === IIP_PRODUCTION_URL) return respond(fx('iip-production-2026-10-08.xml'), 200, { 'content-type': 'application/xml' });
  if (url === IIP_TRANSMISSION_URL) return respond(fx('iip-transmission-2026-10-08.xml'), 200, { 'content-type': 'application/xml' });
  if (url.includes('/datasets/meteo-reseau-reunion/lines')) return respond(fx('sei-meteo-reseau-reunion-2026-10-08.json'));
  if (url.includes('/datasets/ecorsicawatt/lines')) return respond(fx('sei-ecorsicawatt-2026-10-08.json'));
  return respond('introuvable', 404);
}
function serveToClient(routes: Record<string, { status: number; body: unknown }>): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const r = routes[url];
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => wire(r.body) };
  }));
}
beforeEach(() => {
  __resetSwrCacheForTests(); __resetKvForTests(); __resetTelecomForTests(); __resetPowerForTests(); __resetInternetForTests(); __resetCloudForTests(); resetSovereigntySourceCache();
  const store = new Map<string, string>();
  __setKvClientForTests({ get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => { store.set(k, v); } });
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
});
afterEach(() => { __setKvClientForTests(null); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('contrat Télécoms', () => {
  it('réponse du serveur acceptée telle quelle ; ligne « ARCEP sites mobiles » datée par la publication', async () => {
    stubFetch(upstream);
    const { status, body } = await callHandler<TelecomOutagesResponse>(telecomHandler);
    expect(isTelecomOutagesResponse(wire(body))).toBe(true);
    serveToClient({ [TELECOM_URL]: { status, body } });
    const st = arcepStatus(await fetchTelecom(null, NOW), NOW);
    expect(st.status).toBe('ok');
    expect(st.lastUpdate?.toISOString()).toBe('2026-10-08T09:02:20.000Z');
  });
  it('retard ARCEP par isArcepFileLate (R30) : fichier du jour jamais en retard, fichier de la veille en retard après 15 h seulement', async () => {
    stubFetch(upstream);
    const { status, body } = await callHandler<TelecomOutagesResponse>(telecomHandler);
    serveToClient({ [TELECOM_URL]: { status, body } });
    const state = await fetchTelecom(null, NOW);
    expect(arcepStatus(state, NOW).period).not.toMatch(/\(en retard\)/);
    expect(arcepStatus(state, Date.parse('2026-10-09T09:00:00Z')).status).toBe('ok');      // 11 h à Paris, fichier de la veille
    const late = arcepStatus(state, Date.parse('2026-10-09T14:00:00Z'));                   // 16 h à Paris, fichier du jour manquant
    expect(late.status).toBe('stale');
    expect(late.period).toMatch(/\(en retard\)$/);
  });
  it('un champ en trop ou manquant est refusé et nommé par son chemin', async () => {
    stubFetch(upstream);
    const { body } = await callHandler<TelecomOutagesResponse>(telecomHandler);
    const bad = wire(body) as Record<string, unknown> & { sites: Array<Record<string, unknown>> };
    bad.sites[0] = { ...bad.sites[0], station: 'x' };
    expect(telecomResponseProblems(bad)[0]).toMatch(/^sites\[0\]\.station/);
  });
  it('502 du serveur : panne nommée « ARCEP : … », jamais « HTTP 502 » ni « aucune panne »', async () => {
    stubFetch(() => respond('panne', 503));
    const { status, body } = await callHandler<TelecomOutagesResponse>(telecomHandler);
    serveToClient({ [TELECOM_URL]: { status, body } });
    const state = await fetchTelecom(null, NOW);
    expect(state.telecom.data).toBeNull();
    expect(state.telecom.error).toMatch(/^ARCEP/);
  });
});

describe('contrat Électricité', () => {
  it('réponse acceptée ; lignes EDF et IIP datées par leurs sources, retard EDF mesuré sur la dernière lecture (R20)', async () => {
    stubFetch(upstream);
    const { status, body } = await callHandler<PowerOutagesResponse>(powerHandler);
    expect(isPowerOutagesResponse(wire(body))).toBe(true);
    expect(body.edfReadAt).toBe('2026-10-08T20:00:00.000Z');
    serveToClient({ [POWER_URL]: { status, body } });
    const state = await fetchPower(null, NOW);
    expect(edfStatus(state, NOW).lastUpdate?.toISOString()).toBe('2026-10-08T10:00:17.798Z');
    // Le jeu date de 10:00 UTC mais le serveur l'a lu à 20:00 : la donnée n'est pas en retard, elle est simplement ancienne.
    expect(edfStatus(state, NOW).period).not.toMatch(/\(en retard\)/);
    expect(edfStatus(state, NOW + 2 * 3_600_000 + 60_000).period).toMatch(/\(en retard\)$/);   // lecture vieille de plus de 2 h
    expect(iipStatus(state, NOW).status).toBe('ok');
  });
  it('I1 : contrat iipReadAt, retard IIP mesuré sur la dernière lecture réussie, date du flux affichée', async () => {
    stubFetch(upstream);
    const { status, body } = await callHandler<PowerOutagesResponse>(powerHandler);
    expect(body.iipReadAt).toBe('2026-10-08T20:00:00.000Z');
    expect(body.iipPublishedAt).toMatch(/^2026-10-08T19:24:37/);
    serveToClient({ [POWER_URL]: { status, body } });
    const state = await fetchPower(null, NOW);
    expect(iipStatus(state, NOW).lastUpdate?.toISOString()).toBe(body.iipPublishedAt);
    // Le flux est publié depuis plus d'une heure, mais le serveur l'a lu il y a 30 min : pas en retard.
    expect(iipStatus(state, NOW + 30 * 60_000).period).not.toMatch(/\(en retard\)/);
    expect(iipStatus(state, NOW + 61 * 60_000).period).toMatch(/\(en retard\)$/);
  });
  it('un champ en trop ou manquant est refusé et nommé par son chemin', async () => {
    stubFetch(upstream);
    const { body } = await callHandler<PowerOutagesResponse>(powerHandler);
    const bad = wire(body) as Record<string, unknown> & { unplanned: Array<Record<string, unknown>> };
    bad.unplanned[0] = { ...bad.unplanned[0], operator: 'x' };
    expect(powerResponseProblems(bad)[0]).toMatch(/^unplanned\[.*\]\.operator \(en trop\)/);
    const { edfReadAt: _omitted, ...missing } = wire(body) as Record<string, unknown>;
    expect(powerResponseProblems(missing)).toEqual(['edfReadAt (absent)']);
    const { iipReadAt: _omittedIip, ...missingIip } = wire(body) as Record<string, unknown>;
    expect(powerResponseProblems(missingIip)).toEqual(['iipReadAt (absent)']);
  });
  it('502 du serveur : panne nommée par le serveur, jamais « HTTP 502 » ni « aucun arrêt »', async () => {
    stubFetch(() => respond('panne', 503));
    const { status, body } = await callHandler<PowerOutagesResponse>(powerHandler);
    expect(status).toBe(502);
    serveToClient({ [POWER_URL]: { status, body } });
    const state = await fetchPower(null, NOW);
    expect(state.power.data).toBeNull();
    expect(state.power.error).toMatch(/^(EDF OpenData|RTE IIP)/);
  });
});

describe('contrat Internet', () => {
  const HOUR = 3_600_000;
  async function served(token: string): Promise<{ status: number; body: InternetOutagesResponse }> {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', token);
    stubFetch(internetRoute);
    return callHandler<InternetOutagesResponse>(internetHandler);
  }
  it('réponse du serveur acceptée telle quelle, sans jeton puis avec jeton (éléments Radar compris) ; les notes de collecte en cours sont celles du serveur', async () => {
    const without = await served('');
    expect(isInternetOutagesResponse(wire(without.body))).toBe(true);
    expect(internetResponseProblems(wire(without.body))).toEqual([]);
    __resetInternetForTests(); __resetKvForTests();
    const store = new Map<string, string>();
    __setKvClientForTests({ get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => { store.set(k, v); } });
    const withToken = await served('jeton-de-test');
    expect(withToken.body.radar.configured).toBe(true);
    expect(withToken.body.radar.items.length).toBeGreaterThan(0);
    expect(internetResponseProblems(wire(withToken.body))).toEqual([]);
    expect(INTERNET_PENDING_NOTE).toBe(SERVER_INTERNET_PENDING_NOTE);
  });
  it('iodaStatus daté par iodaReadAt, jamais par l’heure de lecture du navigateur ; en retard au-delà de 60 min', async () => {
    const { status, body } = await served('');
    expect(body.iodaReadAt).toBe('2026-10-08T20:00:00.000Z');
    serveToClient({ [INTERNET_URL]: { status, body } });
    const state = await fetchInternet(null, NOW);
    const st = iodaStatus(state, NOW);
    expect(st.status).toBe('ok');
    expect(st.lastUpdate?.toISOString()).toBe('2026-10-08T20:00:00.000Z');
    expect(st.period).not.toMatch(/\(en retard\)/);
    const late = iodaStatus(state, NOW + HOUR + 60_000);
    expect(late.status).toBe('stale');
    expect(late.period).toMatch(/\(en retard\)$/);
  });
  it('radarStatus sans jeton : période « non configuré », statut ok, jamais une erreur ni un retard', async () => {
    const { status, body } = await served('');
    expect(body.radar.configured).toBe(false);
    serveToClient({ [INTERNET_URL]: { status, body } });
    const state = await fetchInternet(null, NOW);
    expect(radarStatus(state, NOW)).toEqual({ status: 'ok', lastUpdate: null, error: undefined, period: 'non configuré' });
    expect(RADAR_NOT_CONFIGURED_PERIOD).toBe('non configuré');
    expect(radarStatus(state, NOW + 30 * HOUR)).toEqual({ status: 'ok', lastUpdate: null, error: undefined, period: 'non configuré' });
  });
  it('radarStatus avec jeton : daté par radar.readAt, en retard au-delà de 60 min', async () => {
    const { status, body } = await served('jeton-de-test');
    serveToClient({ [INTERNET_URL]: { status, body } });
    const state = await fetchInternet(null, NOW);
    const st = radarStatus(state, NOW);
    expect(st.status).toBe('ok');
    expect(st.lastUpdate?.toISOString()).toBe(body.radar.readAt);
    expect(radarStatus(state, NOW + HOUR + 60_000).period).toMatch(/\(en retard\)$/);
  });
  it('une panne Radar ne met pas IODA en « stale » et inversement ; RIPEstat n’est la panne d’aucune des deux', async () => {
    const { status, body } = await served('jeton-de-test');
    const withErrors = { ...wire(body) as Record<string, unknown>, errors: ['Cloudflare Radar : HTTP 503', 'RIPEstat : délai dépassé'] };
    serveToClient({ [INTERNET_URL]: { status, body: withErrors } });
    const radarDown = await fetchInternet(null, NOW);
    expect(iodaStatus(radarDown, NOW).status).toBe('ok');
    expect(iodaStatus(radarDown, NOW).error).toBeUndefined();
    expect(radarStatus(radarDown, NOW)).toMatchObject({ status: 'stale', error: 'Cloudflare Radar : HTTP 503' });
    resetSovereigntySourceCache();
    serveToClient({ [INTERNET_URL]: { status, body: { ...withErrors, errors: ['IODA : plus de 200 événements, liste tronquée'] } } });
    const iodaWarn = await fetchInternet(null, NOW);
    expect(iodaStatus(iodaWarn, NOW)).toMatchObject({ status: 'stale', error: 'IODA : plus de 200 événements, liste tronquée' });
    expect(radarStatus(iodaWarn, NOW).status).toBe('ok');
  });
  it('note « collecte en cours » : ni erreur ni retard sur la ligne IODA', async () => {
    const { status, body } = await served('');
    serveToClient({ [INTERNET_URL]: { status, body: { ...(wire(body) as Record<string, unknown>), errors: [INTERNET_PENDING_NOTE] } } });
    const st = iodaStatus(await fetchInternet(null, NOW), NOW);
    expect(st.status).toBe('ok');
    expect(st.error).toBeUndefined();
  });
  it('un champ en trop ou manquant est refusé et nommé par son chemin (événement, élément Radar, RIPEstat)', async () => {
    const { body } = await served('jeton-de-test');
    type Wire = { events: Array<Record<string, unknown>>; radar: { items: Array<Record<string, unknown>> } } & Record<string, unknown>;
    const extra = wire(body) as Wire;
    extra.events[0] = { ...extra.events[0], station: 'x' };
    expect(internetResponseProblems(extra)[0]).toBe('events[0].station (en trop)');
    const noNational = wire(body) as Wire;
    const { national: _omitted, ...rest } = noNational.radar.items[0];
    noNational.radar.items[0] = rest;
    expect(internetResponseProblems(noNational)).toEqual(['radar.items[0].national (absent)']);
    const badRipe = { ...wire(body) as Record<string, unknown>, ripe: { snapshotAt: null, networks: [{ asn: 3215, name: 'Orange' }] } };
    expect(internetResponseProblems(badRipe)).toEqual(['ripe.networks[0].visibilityPct (absent)']);
    const noIoda = wire(body) as Record<string, unknown>;
    delete noIoda.iodaReadAt;
    expect(internetResponseProblems(noIoda)).toEqual(['iodaReadAt (absent)']);
  });
  it('502 du serveur (IODA muet) : panne nommée « IODA : … », ligne en erreur, Radar jamais en erreur à lui seul', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', '');
    stubFetch(() => respond('panne', 503));
    const { status, body } = await callHandler<InternetOutagesResponse>(internetHandler);
    expect(status).toBe(502);
    serveToClient({ [INTERNET_URL]: { status, body } });
    const state = await fetchInternet(null, NOW);
    expect(state.internet.data).toBeNull();
    expect(state.internet.error).toMatch(/^IODA/);
    expect(iodaStatus(state, NOW)).toMatchObject({ status: 'error', lastUpdate: null });
  });
  it('réponse mal formée : jamais acceptée, l’écart est nommé, les dernières données sont gardées', async () => {
    const { status, body } = await served('');
    serveToClient({ [INTERNET_URL]: { status, body } });
    const first = await fetchInternet(null, NOW);
    resetSovereigntySourceCache();
    serveToClient({ [INTERNET_URL]: { status: 200, body: { ...(wire(body) as Record<string, unknown>), events: 'x' } } });
    const second = mergeInternet(first, await fetchInternet(first, NOW + 10 * 60_000));
    expect(second.internet.data).toEqual(first.internet.data);
    expect(second.internet.error).toMatch(/^réponse des pannes Internet mal formée : events/);
  });
});

describe('contrat Cloud', () => {
  async function served(): Promise<{ status: number; body: CloudOutagesResponse }> {
    stubFetch(cloudRoute);
    return callHandler<CloudOutagesResponse>(cloudHandler);
  }
  it('réponse du serveur acceptée telle quelle (référentiel compris) ; la note de collecte en cours est celle du serveur', async () => {
    const { body } = await served();
    expect(body.reference.datacenters.length).toBeGreaterThan(0);
    expect(isCloudOutagesResponse(wire(body))).toBe(true);
    expect(cloudResponseProblems(wire(body))).toEqual([]);
    expect(CLOUD_PENDING_NOTE).toBe(SERVER_CLOUD_PENDING_NOTE);
  });
  it('cloudStatus daté par le readAt le plus récent des fournisseurs lus, en retard au-delà de 2 h', async () => {
    const { status, body } = await served();
    const reads = body.providers.map((p) => p.readAt).filter((d): d is string => d !== null);
    expect(reads.length).toBe(6);
    const edited = wire(body) as CloudOutagesResponse;
    edited.providers[0] = { ...edited.providers[0], readAt: '2026-10-08T18:30:00.000Z' };
    serveToClient({ [CLOUD_URL]: { status, body: edited } });
    const state = await fetchCloud(null, NOW);
    const st = cloudStatus(state, NOW);
    expect(st.status).toBe('ok');
    expect(st.lastUpdate?.toISOString()).toBe('2026-10-08T20:00:00.000Z');
    expect(st.period).not.toMatch(/\(en retard\)/);
    const late = cloudStatus(state, NOW + 2 * 3_600_000 + 60_000);
    expect(late.status).toBe('stale');
    expect(late.period).toMatch(/\(en retard\)$/);
  });
  it('la panne d’une page d’état est nommée et dégrade la ligne sans la masquer ; la note « collecte en cours » n’est pas une panne', async () => {
    const { status, body } = await served();
    serveToClient({ [CLOUD_URL]: { status, body: { ...(wire(body) as Record<string, unknown>), errors: ['Scaleway : HTTP 503', CLOUD_PENDING_NOTE] } } });
    const st = cloudStatus(await fetchCloud(null, NOW), NOW);
    expect(st).toMatchObject({ status: 'stale', error: 'Scaleway : HTTP 503' });
    resetSovereigntySourceCache();
    serveToClient({ [CLOUD_URL]: { status, body: { ...(wire(body) as Record<string, unknown>), errors: [CLOUD_PENDING_NOTE] } } });
    expect(cloudStatus(await fetchCloud(null, NOW), NOW)).toMatchObject({ status: 'ok', error: undefined });
  });
  it('un incident avec un champ en trop est refusé et nommé (incidents[0].…) ; zone, maintenance, référentiel et point d’échange sont exacts', async () => {
    const { body } = await served();
    type Wire = Record<string, unknown> & {
      incidents: Array<Record<string, unknown>>; providers: Array<{ zones: Array<Record<string, unknown>> } & Record<string, unknown>>;
      maintenances: Array<Record<string, unknown>>; reference: { datacenters: Array<Record<string, unknown>>; exchanges: Array<Record<string, unknown>> };
    };
    const fixture = wire(body) as Wire;
    expect(fixture.incidents.length).toBeGreaterThan(0);
    const extra = wire(body) as Wire;
    extra.incidents[0] = { ...extra.incidents[0], description: 'x' };
    expect(cloudResponseProblems(extra)).toEqual(['incidents[0].description (en trop)']);
    const zone = wire(body) as Wire;
    const provider = zone.providers.find((p) => p.zones.length > 0);
    if (!provider) throw new Error('jeu d’essai sans zone');
    provider.zones[0] = { ...provider.zones[0], status: 'on-fire' };
    expect(cloudResponseProblems(zone)[0]).toMatch(/^providers\[\d+\]\.zones\[0\]\.status$/);
    const site = wire(body) as Wire;
    const { stage: _stage, ...siteRest } = site.reference.datacenters[0];
    site.reference.datacenters[0] = siteRest;
    expect(cloudResponseProblems(site)).toEqual(['reference.datacenters[0].stage (absent)']);
    const exch = wire(body) as Wire;
    exch.reference.exchanges[0] = { ...exch.reference.exchanges[0], lat: 48 };
    expect(cloudResponseProblems(exch)).toEqual(['reference.exchanges[0].lat (en trop)']);
  });
  it('502 du serveur (aucun fournisseur lu) : pannes nommées par fournisseur, ligne en erreur, jamais « aucun incident »', async () => {
    stubFetch((url) => (/status-ovhcloud\.com|status\.scaleway\.com|status\.outscale\.com|cloudflarestatus\.com|status\.cloud\.google\.com|status\.aws\.amazon\.com/.test(url) ? respond('panne', 503) : cloudRoute(url)));
    const { status, body } = await callHandler<CloudOutagesResponse>(cloudHandler);
    expect(status).toBe(502);
    serveToClient({ [CLOUD_URL]: { status, body } });
    const state = await fetchCloud(null, NOW);
    expect(state.cloud.data).toBeNull();
    expect(state.cloud.error).toMatch(/OVHcloud/);
    expect(cloudStatus(state, NOW)).toMatchObject({ status: 'error', lastUpdate: null });
  });
  it('lecture qui ne rejette jamais : réseau coupé, dernières données gardées, fusion à l’écriture', async () => {
    const { status, body } = await served();
    serveToClient({ [CLOUD_URL]: { status, body } });
    const first = await fetchCloud(null, NOW);
    resetSovereigntySourceCache();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const second = mergeCloud(first, await fetchCloud(first, NOW + 25 * 60_000));
    expect(second.cloud.data).toEqual(first.cloud.data);
    expect(second.cloud.error).toBe('source injoignable');
  });
});
