// tests/outages-internet.test.ts : collecteur Internet (spec 2026-10-08 § 3.1 ; faits § 5 à 7) sur les réponses du 08/10 : table des
// régions IODA, événements IODA, Cloudflare Radar, cadence par partie et échecs gardés (P12), lecture stricte (P32).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import { RIPE_LAST_KEY } from '../api/_lib/ripestat.js';
import { DEPT_NAMES } from '../api/_shared/departments.js';
import { IODA_REGION_DEPT, IODA_UNKNOWN_REGION, deptOfIodaRegion } from '../api/_lib/ioda-regions.js';
import {
  IODA_BASE, RADAR_ANOMALIES_URL, RADAR_LIMIT, RADAR_OUTAGES_URL, __resetInternetForTests, emptyInternet, ensureInternetFresh,
  normalizeIodaEvent, normalizeRadar, radarTokenSet, storedInternet,
} from '../api/_lib/outages-internet.js';
import { internetRoute as route, outagesFixture as fx } from './helpers/outages-b-fixtures.ts';
import { respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

const NOW = Date.parse('2026-10-08T20:30:00Z');
const UNTIL = 1791491192;
const MIN = 60_000;
const isIoda = (u: string): boolean => u.startsWith(IODA_BASE);
const isRadar = (u: string): boolean => u.startsWith('https://api.cloudflare.com');

let store: Map<string, string>;
beforeEach(() => {
  __resetKvForTests(); __resetInternetForTests();
  store = new Map<string, string>();
  __setKvClientForTests({ get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => { store.set(k, v); } });
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
});
afterEach(() => { __setKvClientForTests(null); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('table des régions IODA', () => {
  it('101 départements, chacun une fois ; la région inconnue n’en a pas ; codes du jeu d’essai', () => {
    const regions = (JSON.parse(fx('ioda-regions-fr.json')) as { data: Array<{ code: string }> }).data;
    expect(regions).toHaveLength(102);
    const depts = regions.map((r) => deptOfIodaRegion(r.code)).filter((d) => d !== null);
    expect(new Set(depts).size).toBe(101);
    expect(new Set(Object.values(IODA_REGION_DEPT))).toEqual(new Set(Object.keys(DEPT_NAMES)));
    expect(deptOfIodaRegion(IODA_UNKNOWN_REGION)).toBeNull();
    expect([deptOfIodaRegion('1157'), deptOfIodaRegion('1179'), deptOfIodaRegion('1196'), deptOfIodaRegion('1150')]).toEqual(['87', '54', '77', '68']);
  });
});

describe('événements IODA', () => {
  it('département : Haute-Vienne terminé (15 min), libellé du département et non celui d’IODA', () => {
    const raw = (JSON.parse(fx('ioda-events-regions-30j.json')) as { data: unknown[] }).data[0];
    expect(normalizeIodaEvent(raw, UNTIL)).toMatchObject({ scope: 'departement', dept: '87', label: 'Haute-Vienne', signal: 'bgp', ongoing: false, staleOpen: false, durationSec: 900, end: '2026-09-10T23:45:00.000Z' });
  });
  it('opérateur : Scaleway ouvert depuis le 01/10 (7,3 jours) : en cours mais « ouvert depuis plus de 7 jours »', () => {
    const raw = (JSON.parse(fx('ioda-events-as12876-30j.json')) as { data: unknown[] }).data[0];
    expect(normalizeIodaEvent(raw, UNTIL)).toMatchObject({ scope: 'operateur', asn: 12876, label: 'Scaleway (AS12876)', ongoing: true, staleOpen: true, end: null });
  });
  it('pays : national, libellé « France » ; région 4826 : inconnue, sans département ; événement illisible : null', () => {
    const base = { start: 1790000000, duration: 600, datasource: 'bgp', score: 3, overlaps_window: false };
    expect(normalizeIodaEvent({ ...base, location: 'country/FR', location_name: 'France' }, UNTIL)).toMatchObject({ scope: 'national', dept: null, label: 'France' });
    expect(normalizeIodaEvent({ ...base, location: 'region/4826', location_name: 'Unknown Region in France' }, UNTIL)).toMatchObject({ scope: 'inconnu', dept: null });
    expect(normalizeIodaEvent({ ...base, location: undefined }, UNTIL)).toBeNull();
    expect(normalizeIodaEvent(null, UNTIL)).toBeNull();
  });
  it('en cours : fin à moins de 20 min de la lecture ET fenêtre recouverte ; sinon terminé', () => {
    const raw = { location: 'region/1138', location_name: 'Creuse', datasource: 'bgp', score: 1, start: UNTIL - 3600, duration: 3600 - 19 * 60 };
    expect(normalizeIodaEvent({ ...raw, overlaps_window: true }, UNTIL)).toMatchObject({ ongoing: true, end: null });
    expect(normalizeIodaEvent({ ...raw, overlaps_window: false }, UNTIL)).toMatchObject({ ongoing: false });
    expect(normalizeIodaEvent({ ...raw, duration: 3600 - 21 * 60, overlaps_window: true }, UNTIL)).toMatchObject({ ongoing: false });
  });
});

describe('Cloudflare Radar', () => {
  it('anomalies et pannes de la France seulement ; un réseau allemand est écarté', () => {
    const items = normalizeRadar(JSON.parse(fx('radar-traffic-anomalies-fr.json')), JSON.parse(fx('radar-outages-fr.json')));
    expect(items.map((i) => [i.kind, i.label, i.end === null])).toEqual([
      ['anomalie', 'Free (AS12322)', true], ['panne', 'Corse', false], ['anomalie', 'France', false],
    ]);
    expect(items.find((i) => i.kind === 'panne')).toMatchObject({ cause: 'coupure d’électricité', outageType: 'régionale' });
  });
  const annotation = (over: Record<string, unknown>): unknown => ({
    id: 'x1', scope: null, startDate: '2026-10-08T10:00:00Z', endDate: null, asns: [], asnsDetails: [], locations: ['FR'],
    outage: { outageCause: 'TECHNICAL_PROBLEM', outageType: 'NETWORK' }, ...over,
  });
  const pannes = (...list: unknown[]) => normalizeRadar({ result: { trafficAnomalies: [] } }, { result: { annotations: list } });
  it('R40 : panne sans portée nommée : l’opérateur s’il y en a un, « non localisé » sinon, jamais « France » par défaut', () => {
    const [byAsn, orphan] = pannes(
      annotation({ id: 'a', asns: [3215], asnsDetails: [{ asn: '3215', name: 'ORANGE' }] }),
      annotation({ id: 'b', outage: { outageCause: 'UNKNOWN', outageType: 'REGIONAL' } }),
    );
    expect([byAsn.label, byAsn.asn]).toEqual(['Orange (AS3215)', 3215]);
    expect([orphan.label, orphan.asn, orphan.outageType]).toEqual(['non localisé', null, 'régionale']);
  });
  it('R40 : une portée nommée est gardée ; coupure nationale de la France seule : « France » et nationale', () => {
    const [named, national] = pannes(
      annotation({ id: 'a', scope: 'Corse', outage: { outageCause: 'POWER_OUTAGE', outageType: 'REGIONAL' } }),
      annotation({ id: 'b', outage: { outageCause: 'GOVERNMENT_DIRECTED', outageType: 'NATIONWIDE' } }),
    );
    expect(named.label).toBe('Corse');
    expect([national.label, national.outageType]).toEqual(['France', 'nationale']);
  });
  it('R40 : coupure « nationale » sur plusieurs pays : jamais nationale pour la France (P2), lieu propre non localisé', () => {
    const [multi] = pannes(annotation({ id: 'm', locations: ['ES', 'PT', 'FR'], outage: { outageCause: 'POWER_OUTAGE', outageType: 'NATIONWIDE' } }));
    expect(multi.outageType).not.toBe('nationale');
    expect(multi.label).toBe('non localisé');
  });
  it('une date illisible écarte l’élément sans faire échouer les autres', () => {
    const items = normalizeRadar(
      { result: { trafficAnomalies: [
        { uuid: 'a', status: 'VERIFIED', startDate: 'pas une date', endDate: null, locationDetails: { code: 'FR' }, asnDetails: null },
        { uuid: 'b', status: 'VERIFIED', startDate: '2026-10-08T10:00:00Z', endDate: null, locationDetails: { code: 'FR' }, asnDetails: null },
      ] } },
      { result: { annotations: [] } },
    );
    expect(items.map((i) => i.id)).toEqual(['b']);
  });
});

describe('collecte', () => {
  it('sans jeton : Radar « non configuré », aucune requête à Cloudflare, jamais une erreur', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', '');
    const log = stubFetch(route);
    const body = await ensureInternetFresh(NOW);
    expect(body.radar).toEqual({ configured: false, readAt: null, items: [] });
    expect(log.urls.some((u) => u.includes('api.cloudflare.com'))).toBe(false);
    expect(body.errors).toEqual([]);
    expect(body.events.filter((e) => e.scope === 'departement')).toHaveLength(6);
    expect(body.events[0]).toMatchObject({ asn: 12876, ongoing: true, staleOpen: true });
    expect(body.iodaReadAt).toBe('2026-10-08T20:30:00.000Z');
    expect(body.readAt).toBe('2026-10-08T20:30:00.000Z');
  });
  it('toutes les requêtes portent le User-Agent FranceMonitor', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', 'jeton-de-test');
    const log = stubFetch(route);
    await ensureInternetFresh(NOW);
    expect(log.urls.filter(isIoda)).toHaveLength(8);
    log.inits.forEach((init) => expect(sentHeader(init, 'User-Agent')).toMatch(/^FranceMonitor\/1\.0/));
  });
  it('avec jeton : en-tête Authorization Bearer, éléments Radar servis, jeton jamais dans la réponse ni les erreurs', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', 'jeton-de-test');
    const log = stubFetch(route);
    const body = await ensureInternetFresh(NOW);
    expect(body.radar.configured).toBe(true);
    expect(body.radar.items).toHaveLength(3);
    expect(body.radar.readAt).toBe('2026-10-08T20:30:00.000Z');
    const i = log.urls.findIndex((u) => u.startsWith(RADAR_ANOMALIES_URL));
    expect(sentHeader(log.inits[i], 'Authorization')).toBe('Bearer jeton-de-test');
    expect(JSON.stringify(body)).not.toContain('jeton-de-test');
    expect(JSON.stringify([...store.values()])).not.toContain('jeton-de-test');
  });
  it('IODA en panne : erreur nommée, iodaReadAt null, jamais « aucune anomalie »', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', '');
    stubFetch((url) => (url.startsWith(IODA_BASE) ? respond('panne', 503) : route(url)));
    const body = await ensureInternetFresh(NOW);
    expect(body.iodaReadAt).toBeNull();
    expect(body.readAt).toBeNull();
    expect(body.errors[0]).toMatch(/^IODA/);
  });
  it('IODA : réponse sans liste d’événements = erreur nommée, jamais « aucune panne » (S3)', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', '');
    stubFetch((url) => (url.startsWith(`${IODA_BASE}/outages/events?entityType=country`) ? respond({ error: 'x' }) : route(url)));
    const body = await ensureInternetFresh(NOW);
    expect(body.iodaReadAt).toBeNull();
    expect(body.events).toEqual([]);
    expect(body.errors[0]).toMatch(/^IODA : /);
  });
  it('P32 : une liste IODA de 200 événements est tronquée peut-être : erreur nommée, événements lus servis', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', '');
    const full = Array.from({ length: 200 }, (_, n) => ({
      location: 'region/1138', start: 1788900000 + n * 1000, duration: 600, datasource: 'bgp', score: 1, location_name: 'Creuse', overlaps_window: false,
    }));
    stubFetch((url) => (url.startsWith(`${IODA_BASE}/outages/events?entityType=region`) ? respond({ data: full }) : route(url)));
    const body = await ensureInternetFresh(NOW);
    expect(body.errors).toEqual(['IODA : plus de 200 événements, liste tronquée']);
    expect(body.iodaReadAt).not.toBeNull();
    expect(body.events.filter((e) => e.scope === 'departement')).toHaveLength(200);
  });
  it('199 événements : aucune alerte de troncature', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', '');
    const some = Array.from({ length: 199 }, (_, n) => ({
      location: 'region/1138', start: 1788900000 + n * 1000, duration: 600, datasource: 'bgp', score: 1, location_name: 'Creuse', overlaps_window: false,
    }));
    stubFetch((url) => (url.startsWith(`${IODA_BASE}/outages/events?entityType=region`) ? respond({ data: some }) : route(url)));
    expect((await ensureInternetFresh(NOW)).errors).toEqual([]);
  });
  it('Radar : réponse sans liste ou en échec = erreur nommée, IODA servi', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', 'jeton-de-test');
    stubFetch((url) => (url.startsWith(RADAR_OUTAGES_URL) ? respond({ success: false, errors: [{ code: 1 }], result: null }) : route(url)));
    const body = await ensureInternetFresh(NOW);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatch(/^Cloudflare Radar : /);
    expect(body.radar).toEqual({ configured: true, readAt: null, items: [] });
    expect(body.iodaReadAt).not.toBeNull();
  });
});

describe('R40 : Radar tronqué, RIPEstat, relevé gardé', () => {
  it('Radar : une liste de 50 éléments est peut-être tronquée : erreur nommée, éléments lus servis', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', 'jeton-de-test');
    const many = Array.from({ length: RADAR_LIMIT }, (_, n) => ({
      uuid: `u${n}`, status: 'VERIFIED', startDate: '2026-10-08T10:00:00Z', endDate: null, locationDetails: { code: 'FR' }, asnDetails: null,
    }));
    stubFetch((url) => (url.startsWith(RADAR_ANOMALIES_URL) ? respond({ success: true, result: { trafficAnomalies: many } }) : route(url)));
    const body = await ensureInternetFresh(NOW);
    expect(body.errors).toEqual([`Cloudflare Radar : plus de ${RADAR_LIMIT} éléments par liste, liste tronquée`]);
    expect(body.radar.readAt).not.toBeNull();
    expect(body.radar.items.filter((i) => i.kind === 'anomalie')).toHaveLength(RADAR_LIMIT);
  });
  it('Radar : 49 éléments, aucune alerte de troncature', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', 'jeton-de-test');
    const some = Array.from({ length: RADAR_LIMIT - 1 }, (_, n) => ({
      uuid: `u${n}`, status: 'VERIFIED', startDate: '2026-10-08T10:00:00Z', endDate: null, locationDetails: { code: 'FR' }, asnDetails: null,
    }));
    stubFetch((url) => (url.startsWith(RADAR_ANOMALIES_URL) ? respond({ success: true, result: { trafficAnomalies: some } }) : route(url)));
    expect((await ensureInternetFresh(NOW)).errors).toEqual([]);
  });
  it('Radar : réponse 200 sans liste (success vrai, result vide) = erreur nommée, jamais « aucune anomalie »', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', 'jeton-de-test');
    stubFetch((url) => (url.startsWith(RADAR_OUTAGES_URL) ? respond({ success: true, result: {} }) : route(url)));
    const body = await ensureInternetFresh(NOW);
    expect(body.errors).toEqual(['Cloudflare Radar : réponse sans liste']);
    expect(body.radar).toEqual({ configured: true, readAt: null, items: [] });
    expect(body.iodaReadAt).not.toBeNull();
  });
  it('storedInternet : jeton retiré depuis le relevé gardé = « non configuré » tout de suite, éléments Radar retirés', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', 'jeton-de-test');
    stubFetch(route);
    await ensureInternetFresh(NOW);
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', '');
    const kept = await storedInternet(NOW + MIN, 'Internet : collecte en cours');
    expect(kept.radar).toEqual({ configured: false, readAt: null, items: [] });
    expect(kept.iodaReadAt).not.toBeNull();
  });
  it('storedInternet : jeton posé depuis le relevé gardé = « configuré », pas encore lu', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', '');
    stubFetch(route);
    await ensureInternetFresh(NOW);
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', 'jeton-de-test');
    expect((await storedInternet(NOW + MIN, 'n')).radar).toEqual({ configured: true, readAt: null, items: [] });
  });
  it('storedInternet : relevé gardé de forme inconnue (sans « ripe ») = réponse vide avec la note', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', '');
    store.set('out:internet:last', JSON.stringify({ attemptedAt: '2026-10-08T20:00:00Z', parts: {}, body: { events: [{ id: 'x' }] } }));
    const kept = await storedInternet(NOW, 'Internet : collecte en cours');
    expect(kept).toMatchObject({ readAt: null, iodaReadAt: null, events: [], errors: ['Internet : collecte en cours'] });
  });
});

describe('cadence par partie et échecs gardés (P12)', () => {
  it('IODA toutes les 10 min, Radar toutes les 15 min, chacun relu seul', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', 'jeton-de-test');
    const log = stubFetch(route);
    await ensureInternetFresh(NOW);
    const count = (): [number, number] => [log.urls.filter(isIoda).length, log.urls.filter(isRadar).length];
    expect(count()).toEqual([8, 2]);
    await ensureInternetFresh(NOW + 5 * MIN);
    expect(count()).toEqual([8, 2]);                 // rien n'est dû
    await ensureInternetFresh(NOW + 10 * MIN);
    expect(count()).toEqual([16, 2]);                // IODA seul
    await ensureInternetFresh(NOW + 15 * MIN);
    expect(count()).toEqual([16, 4]);                // Radar seul (IODA lu 5 min plus tôt)
  });
  it('IODA en échec après une lecture réussie : événements et date gardés, erreur nommée, nouvel essai 5 min plus tard', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', '');
    let down = false;
    const log = stubFetch((url) => (down && isIoda(url) ? respond('panne', 503) : route(url)));
    const first = await ensureInternetFresh(NOW);
    down = true;
    const failed = await ensureInternetFresh(NOW + 10 * MIN);
    expect(failed.iodaReadAt).toBe(first.iodaReadAt);
    expect(failed.events).toEqual(first.events);
    expect(failed.errors).toHaveLength(1);
    expect(failed.errors[0]).toMatch(/^IODA : /);
    const calls = log.urls.length;
    await ensureInternetFresh(NOW + 14 * MIN);
    expect(log.urls.length).toBe(calls);             // 4 min après l'échec : pas encore
    down = false;
    const again = await ensureInternetFresh(NOW + 15 * MIN);
    expect(again.errors).toEqual([]);
    expect(again.iodaReadAt).toBe(new Date(NOW + 15 * MIN).toISOString());
  });
  it('Radar en échec après une lecture réussie : éléments et date gardés, erreur nommée, IODA non touché', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', 'jeton-de-test');
    let down = false;
    stubFetch((url) => (down && isRadar(url) ? respond('panne', 503) : route(url)));
    const first = await ensureInternetFresh(NOW);
    down = true;
    const failed = await ensureInternetFresh(NOW + 15 * MIN);
    expect(failed.radar).toEqual(first.radar);
    expect(failed.errors).toHaveLength(1);
    expect(failed.errors[0]).toMatch(/^Cloudflare Radar : /);
    expect(failed.iodaReadAt).toBe(new Date(NOW + 15 * MIN).toISOString());
  });
  it('jeton retiré après coup : Radar redevient « non configuré » sans attendre, éléments retirés', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', 'jeton-de-test');
    const log = stubFetch(route);
    await ensureInternetFresh(NOW);
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', '');
    const calls = log.urls.length;
    const body = await ensureInternetFresh(NOW + 2 * MIN);
    expect(body.radar).toEqual({ configured: false, readAt: null, items: [] });
    expect(log.urls.length).toBe(calls);
  });
  it('jeton posé après coup : Radar lu tout de suite', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', '');
    const log = stubFetch(route);
    await ensureInternetFresh(NOW);
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', 'jeton-de-test');
    const body = await ensureInternetFresh(NOW + 2 * MIN);
    expect(body.radar.configured).toBe(true);
    expect(body.radar.items).toHaveLength(3);
    expect(log.urls.filter(isIoda)).toHaveLength(8);   // IODA non relu
  });
  it('une collecte simultanée n’est lancée qu’une fois', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', '');
    const log = stubFetch(route);
    await Promise.all([ensureInternetFresh(NOW), ensureInternetFresh(NOW)]);
    expect(log.urls.filter(isIoda)).toHaveLength(8);
  });
  it('RIPEstat : rappel du dernier instantané du collecteur Connectivité, sans requête propre ; null sans relevé', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', '');
    const log = stubFetch(route);
    expect((await ensureInternetFresh(NOW)).ripe).toBeNull();
    store.set(RIPE_LAST_KEY, JSON.stringify({ readAt: '2026-10-08T20:00:00Z', snapshotAt: '2026-10-08T16:00:00', networks: [{ asn: 3215, name: 'Orange', visibilityPct: 99.5, v4Prefixes: 1 }], errors: [], attemptedAt: '2026-10-08T20:00:00Z' }));
    const body = await ensureInternetFresh(NOW + 10 * MIN);
    expect(log.urls.some((u) => u.includes('stat.ripe.net'))).toBe(false);
    expect(body.ripe).toEqual({ snapshotAt: '2026-10-08T16:00:00', networks: [{ asn: 3215, name: 'Orange', visibilityPct: 99.5 }] });
  });
});

describe('relevé gardé et réponse vide', () => {
  it('jeton lu à chaque appel : radarTokenSet', () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', '  ');
    expect(radarTokenSet()).toBe(false);
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', 'x');
    expect(radarTokenSet()).toBe(true);
  });
  it('emptyInternet : jamais lu, listes vides, dates null', () => {
    expect(emptyInternet(['IODA : HTTP 503'], true)).toEqual({
      readAt: null, iodaReadAt: null, radar: { configured: true, readAt: null, items: [] }, events: [], ripe: null, errors: ['IODA : HTTP 503'],
    });
  });
  it('storedInternet : rien en mémoire = réponse vide avec la note, « configuré » selon le jeton (P36)', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', 'jeton-de-test');
    const body = await storedInternet(NOW, 'Internet : collecte en cours');
    expect(body).toMatchObject({ readAt: null, iodaReadAt: null, events: [], errors: ['Internet : collecte en cours'] });
    expect(body.radar.configured).toBe(true);
  });
  it('storedInternet : sert le dernier relevé avec la note ajoutée', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', '');
    stubFetch(route);
    const fresh = await ensureInternetFresh(NOW);
    const kept = await storedInternet(NOW + MIN, 'Internet : collecte en cours');
    expect(kept.events).toEqual(fresh.events);
    expect(kept.errors).toEqual(['Internet : collecte en cours']);
  });
});
