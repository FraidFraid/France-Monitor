// tests/cable-watch.test.ts : veille des câbles sous-marins (spec 2026-10-04 souveraineté § 2.2, V1 ; contrats § 2.3, arbitrage 8 ;
// amendement 7, O18 et S9) sur un fichier des câbles assemblé comme le vrai (cablesFile de scripts/fetch-subsea-cables.mjs) à partir
// des relevés réels du 04/10/2026 : câbles télécom, zones de câbles et zones de mouillage du Shom (approches de Marseille),
// compléments OpenStreetMap ; relevés du relais construits : navire à 304 m d'AMITIE et à 1 nœud revu 6 min plus tard (confirmé)
// ou 3 min plus tard (non), même message relu (jamais confirmé), vitesse absente, amarré et bâtiment militaire français (écartés),
// navire dans une zone de mouillage du Shom qui ne recoupe aucune zone de câbles (écarté, S9), tronçon du Shom au large sans
// atterrage (retenu, sans nom), câble du Shom hors service (jamais une alerte), relais muet depuis 6 min (non évalué, rien n'est
// confirmé ni retiré, aucun compte de navires publié), lot amont d'une zone muet pendant que les autres parlent (alertes de la
// zone gardées « non évalué (flux de la zone muet) », retirées quand le lot reparle). Arbitrage FX2 (relevé du 05/10 : navires au
// port) : bâtiment de MID 226 à 228 nommé « FRENCH WARSHIP » sans type AIS (écarté), approches d'atterrage et ports (moins de 2 km
// d'un atterrage : seul un navire déclaré au mouillage dans une zone de câbles du Shom est signalé), testés de part et d'autre des 2 km.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { departementAt, departementsNear } from '../api/_lib/geo-fr.js';
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import { osmComplement, shomToAnchorageZones, shomToCableZones, shomToCables } from '../api/_lib/shom-cables.js';
import {
  CABLES_FILE_PATH, __resetCablesFileForTests, anchorageClearOfCablesAt, cableZoneAt, landingWithinKm, loadCablesFile, overpassToCables,
} from '../api/_lib/subsea-cables.js';
import {
  CABLES_FILE_ERROR, CABLE_ALERT_M, CONFIRM_GAP_MS, LANDING_APPROACH_KM, WATCH_INTERVAL_MS, __resetCablesWatchForTests, cableHits,
  confirmAlerts, ensureCablesWatchFresh, isFrenchWarship, quietLandingApproach, relayBaseUrl,
} from '../api/_lib/cable-watch.js';
import { CABLE_APPROACH_KM } from '../src/components/layer-panel/connectivite.ts';
import handler, { CACHE_CONTROL } from '../api/_handlers/sovereignty/cables-watch.js';
import { SOURCE_USER_AGENT } from '../api/_lib/source-http.js';
import { cablesFile } from '../scripts/fetch-subsea-cables.mjs';
import { CABLES_FILE_ERROR_TEXT } from '../src/components/layer-panel/sovereignty-format.ts';
import type { CablesWatchResponse, SubseaCablesFile } from '../src/types/index.ts';
import { callHandler, respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/sovereignty/${name}`, import.meta.url), 'utf8'));
const GEO = { departementAt, departementsNear };
const OSM = fixture('osm-subsea-cables.json') as { osm3s: { timestamp_osm_base: string } };
const SHOM_CABLES = shomToCables(fixture('shom-cblsub-lv.json'), GEO);
const CABLE_ZONES = shomToCableZones(fixture('shom-cblare-polygon.json'));
const FILE = cablesFile({
  generatedAt: '2026-10-04T19:48:00.000Z', osmBase: OSM.osm3s.timestamp_osm_base,
  editions: { cables: '2019-01-07', cableZones: '2021-07', anchorageZones: '2021-07' },
  shomCables: SHOM_CABLES, osmCables: osmComplement(overpassToCables(OSM, GEO), SHOM_CABLES),
  cableZones: CABLE_ZONES, anchorageZones: shomToAnchorageZones(fixture('shom-achare-polygon.json'), CABLE_ZONES),
}) as SubseaCablesFile;
/** Câbles du fichier sans leurs atterrages : la règle des approches (FX2) n'y joue plus, pour tester les autres règles seules. */
const withoutLandings = (f: SubseaCablesFile): SubseaCablesFile['cables'] => f.cables.map((c) => ({ ...c, landings: [] }));
const RELAY = 'http://relais.test';
const T0 = Date.parse('2026-10-04T16:36:00+02:00');
const iso = (ms: number): string => new Date(ms).toISOString();

interface Vessel { mmsi: string; name: string | null; type: string | null; typeCode: number | null; status: number | null; lat: number; lon: number; sog: number | null; lastAt: string }
/** Cargo au mouillage à 304 m du tracé d'AMITIE (complément OpenStreetMap), 1 nœud. */
const cargo = (lastAt: number): Vessel => ({ mmsi: '229000001', name: 'CARGO ESSAI', type: 'Cargo', typeCode: 70, status: 1, lat: 42.85, lon: 4.8558, sog: 1, lastAt: iso(lastAt) });
const moored: Vessel = { mmsi: '229000002', name: 'AMARRE ESSAI', type: 'Cargo', typeCode: 70, status: 5, lat: 42.85, lon: 4.853, sog: 0, lastAt: iso(T0 - 10_000) };
const frenchNavy: Vessel = { mmsi: '227000003', name: 'BATIMENT ESSAI', type: 'Militaire', typeCode: 35, status: 0, lat: 42.85, lon: 4.852, sog: 0.5, lastAt: iso(T0 - 10_000) };
const foreignNavy: Vessel = { mmsi: '235000004', name: 'WARSHIP TEST', type: 'Militaire', typeCode: 35, status: 0, lat: 42.85, lon: 4.8535, sog: 0.4, lastAt: iso(T0 - 10_000) };
const noSpeed: Vessel = { mmsi: '229000005', name: 'SANS VITESSE', type: 'Cargo', typeCode: 70, status: null, lat: 42.85, lon: 4.8521, sog: null, lastAt: iso(T0 - 10_000) };
const farAway: Vessel = { mmsi: '229000006', name: 'AU LARGE', type: 'Pêche', typeCode: 30, status: 7, lat: 43.0, lon: 6.0, sog: 0.8, lastAt: iso(T0 - 10_000) };
/** Au mouillage dans la zone shom/FR000051219500003 (rade de Marseille, mouillage permis, aucune zone de câbles recoupée). */
const anchoredClear: Vessel = { mmsi: '229000007', name: 'MOUILLAGE ESSAI', type: 'Cargo', typeCode: 70, status: 1, lat: 43.2475, lon: 5.369, sog: 0.2, lastAt: iso(T0 - 10_000) };
/** Au mouillage dans la zone « Sainte-Marie », qui recoupe une zone de câbles : à 110 m d'un câble télécom du Shom. */
const anchoredOnCables: Vessel = { mmsi: '229000008', name: 'SAINTE MARIE ESSAI', type: 'Cargo', typeCode: 70, status: 1, lat: 43.2944, lon: 5.3409, sog: 0.3, lastAt: iso(T0 - 10_000) };
/** À 115 m du tronçon du Shom au large shom/FR000013709500001 (aucun atterrage), 0,6 nœud. */
const offshore: Vessel = { mmsi: '229000009', name: 'LARGE ESSAI', type: 'Cargo', typeCode: 70, status: 0, lat: 42.115, lon: 6.893, sog: 0.6, lastAt: iso(T0 - 10_000) };

interface Zone { label: string; box: [[number, number], [number, number]]; muted: boolean }
/** Boîtes réelles de l'abonnement du relais (ais-relay.js) : golfe du Lion (lot 1) et Gironde (lot 2). */
const LION: [[number, number], [number, number]] = [[41.0, 1.8], [44.8, 8.2]];
const GIRONDE: [[number, number], [number, number]] = [[44.5, -1.3], [45.4, -0.4]];
const zones = (lionMuted: boolean): Zone[] => [{ label: 'golfe du Lion', box: LION, muted: lionMuted }, { label: 'Gironde', box: GIRONDE, muted: false }];
const LOT1_MUTED = 'flux AIS partiel : lot 1 sur 3 muet depuis 6 min (Manche, Atlantique, golfe du Lion, Corse, Dunkerque-Calais)';

function relayBody(at: number, vessels: Vessel[], lastMessageAt: number | null = at - 2_000, errors: string[] = [], relayZones: Zone[] = []) {
  return { at: iso(at), lastMessageAt: lastMessageAt === null ? null : iso(lastMessageAt), vessels, errors, zones: relayZones };
}
function stubRelay(...bodies: Array<ReturnType<typeof relayBody> | ReturnType<typeof respond>>) {
  let i = 0;
  return stubFetch((url) => {
    if (url !== `${RELAY}/slow-vessels`) return respond('introuvable', 404);
    const b = bodies[Math.min(i, bodies.length - 1)];
    i += 1;
    return 'ok' in b && 'status' in b ? b : respond(b);
  });
}

beforeEach(() => {
  __resetKvForTests();
  __setKvClientForTests({ get: async () => null, set: async () => undefined });
  __resetCablesWatchForTests();
  __resetCablesFileForTests(FILE);
  vi.stubEnv('AIS_RELAY_INTERNAL_URL', RELAY);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => { __setKvClientForTests(null); __resetCablesFileForTests(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('cableHits (exclusions de l’arbitrage 8 et S9)', () => {
  it('navire lent à 304 m d’AMITIE retenu ; amarré, militaire français, vitesse absente et navire loin des tracés écartés', () => {
    const hits = cableHits([cargo(T0 - 10_000), moored, frenchNavy, noSpeed, farAway, foreignNavy], FILE);
    expect(hits.map((h) => [h.id, h.cableName, h.distanceM, h.speedKn, h.navStatus])).toEqual([
      ['235000004:way/761201757', 'AMITIE', 117, 0.4, 0],
      ['229000001:way/761201757', 'AMITIE', 304, 1, 1],
    ]);
    expect(hits[1]).toMatchObject({ mmsi: '229000001', name: 'CARGO ESSAI', vesselType: 'Cargo', cableId: 'way/761201757', lat: 42.85, lon: 4.8558 });
    expect(CABLE_ALERT_M).toBe(500);
  });
  it('2 nœuds et plus : écarté ; à plus de 500 m : écarté ; message sans heure lisible : écarté (aucune confirmation sûre)', () => {
    expect(cableHits([{ ...cargo(T0), sog: 2 }], FILE)).toEqual([]);
    expect(cableHits([{ ...cargo(T0), lon: 4.865 }], FILE)).toEqual([]);
    expect(cableHits([{ ...cargo(T0), lastAt: 'inconnue' }], FILE)).toEqual([]);
  });
  it('S9 : au mouillage dans une zone du Shom qui ne recoupe aucune zone de câbles, non signalé ; sans cette zone, il le serait', () => {
    expect(anchorageClearOfCablesAt(anchoredClear.lat, anchoredClear.lon, FILE)?.id).toBe('shom/FR000051219500003');
    expect(cableHits([anchoredClear], FILE)).toEqual([]);
    // Sans la zone de mouillage, et hors approche d'atterrage (il est à 310 m d'un atterrage de la rade : atterrages retirés ici).
    expect(cableHits([anchoredClear], { ...FILE, anchorageZones: [], cables: withoutLandings(FILE) }).map((h) => [h.cableId, h.distanceM])).toEqual([
      ['shom/FR000019846200003', 194],                         // shom/FR000008435100001 à 359 m : hors service, jamais compté
    ]);
  });
  it('câble du Shom hors service (STATUS S-57 4) : jamais une alerte ; il reste dans le fichier (dessiné en gris)', () => {
    const onDeadCable: Vessel = { mmsi: '229000010', name: 'CABLE MORT ESSAI', type: 'Cargo', typeCode: 70, status: 1, lat: 43.0048, lon: 5.4081, sog: 0.4, lastAt: iso(T0 - 10_000) };
    expect(FILE.cables.find((c) => c.id === 'shom/FR000008435100001')?.outOfService).toBe(true);
    expect(cableHits([onDeadCable], FILE)).toEqual([]);
    const inService = { ...FILE, cables: FILE.cables.map((c) => (c.id === 'shom/FR000008435100001' ? { ...c, outOfService: false } : c)) };
    expect(cableHits([onDeadCable], inService).map((h) => [h.cableId, h.distanceM])).toEqual([['shom/FR000008435100001', 2]]);
  });
  it('S9 : zone de mouillage qui recoupe une zone de câbles (Sainte-Marie) : S9 ne l’écarte pas ; câble du Shom sans nom', () => {
    expect(anchorageClearOfCablesAt(anchoredOnCables.lat, anchoredOnCables.lon, FILE)).toBeNull();
    // Hors approche d'atterrage (atterrages retirés), il serait signalé.
    expect(cableHits([anchoredOnCables], { ...FILE, cables: withoutLandings(FILE) }).map((h) => [h.id, h.cableName, h.distanceM])).toEqual([
      ['229000008:shom/FR000008474500001', null, 110],
    ]);
  });
  it('FX2 : Sainte-Marie est à 1,07 km d’un atterrage, au mouillage mais hors zone de câbles du Shom : port, non signalé', () => {
    expect(landingWithinKm(anchoredOnCables.lat, anchoredOnCables.lon, FILE, LANDING_APPROACH_KM)).not.toBeNull();
    expect(cableZoneAt(anchoredOnCables.lat, anchoredOnCables.lon, FILE)).toBeNull();
    expect(quietLandingApproach(anchoredOnCables, FILE)).toBe(true);
    expect(cableHits([anchoredOnCables], FILE)).toEqual([]);
  });
  it('FX2 : au mouillage dans la zone de câbles du Prado (Shom), à 1 km d’un atterrage : signalé, une alerte par câble proche', () => {
    const prado: Vessel = { mmsi: '229000011', name: 'PRADO ESSAI', type: 'Cargo', typeCode: 70, status: 1, lat: 43.25, lon: 5.3575, sog: 0.2, lastAt: iso(T0 - 10_000) };
    expect(cableZoneAt(prado.lat, prado.lon, FILE)?.id).toBe('shom/FR000009979300003');
    expect(landingWithinKm(prado.lat, prado.lon, FILE, LANDING_APPROACH_KM)).not.toBeNull();
    const hits = cableHits([prado], FILE);
    expect(hits.length).toBeGreaterThan(1);
    expect(hits[0]).toMatchObject({ mmsi: '229000011', cableId: 'shom/FR000019846100003', distanceM: 63, navStatus: 1 });
    // Même place, statut absent ou en route : port, non signalé (un statut absent n'est pas un mouillage).
    expect(cableHits([{ ...prado, status: null }], FILE)).toEqual([]);
    expect(cableHits([{ ...prado, status: 0 }], FILE)).toEqual([]);
  });
  it('tronçon du Shom au large, sans atterrage : retenu sans erreur, câble sans nom', () => {
    expect(FILE.cables.find((c) => c.id === 'shom/FR000013709500001')?.landings).toEqual([]);
    expect(cableHits([offshore], FILE).map((h) => [h.id, h.cableName, h.distanceM, h.speedKn])).toEqual([
      ['229000009:shom/FR000013709500001', null, 115, 0.6],
    ]);
  });
  it('FX2 : « FRENCH WARSHIP » sous pavillon français, métropole ou outre-mer, sans type AIS (base navale de Toulon, 05/10) : écarté', () => {
    const at = { lat: 42.85, lon: 4.853, sog: 0, status: 0, type: null, typeCode: null, lastAt: iso(T0 - 10_000) };
    const warship: Vessel = { ...at, mmsi: '228000012', name: 'FRENCH WARSHIP' };
    const spaced: Vessel = { ...at, mmsi: '226000013', name: '  french warship 12' };
    const foreign: Vessel = { ...at, mmsi: '235000014', name: 'FRENCH WARSHIP' };
    const guadeloupe: Vessel = { ...at, mmsi: '329000015', name: 'FRENCH WARSHIP' };          // MID 329 : Guadeloupe
    const reunion: Vessel = { ...at, mmsi: '660000017', name: 'French Warship' };             // MID 660 : La Réunion
    const other: Vessel = { ...at, mmsi: '227000016', name: 'EX FRENCH WARSHIP' };
    expect([warship, spaced, foreign, guadeloupe, reunion, other].map(isFrenchWarship)).toEqual([true, true, false, true, true, false]);
    expect(isFrenchWarship(frenchNavy)).toBe(true);                    // type AIS 35 sous pavillon français, inchangé
    expect(isFrenchWarship({ ...frenchNavy, mmsi: '540000018' })).toBe(true);   // type 35 sous MID 540 (Nouvelle-Calédonie)
    expect(isFrenchWarship(foreignNavy)).toBe(false);                  // type 35 étranger : retenu, comme avant
    expect(cableHits([warship, spaced, foreign, guadeloupe, reunion, other], FILE).map((h) => h.mmsi).sort()).toEqual(['227000016', '235000014']);
  });
});

/**
 * Fichier construit pour la règle des approches (FX2) : un câble du Shom sur le méridien 6° E, de son atterrage (43,1° N) vers le sud ;
 * une zone de câbles du Shom de 43,0805° à 43,0835° N. Un navire posé sur le tracé à `km` de l'atterrage est à 0 m du câble.
 */
const APPROACH_FILE = {
  generatedAt: '2026-10-05T00:00:00.000Z', osmBase: '2026-10-04T20:19:21Z', sources: [],
  cables: [{
    id: 'shom/FR000000000000099', name: null, operator: null, path: [[[6, 43.1], [6, 42.9]]],
    landings: [{ commune: 'Essai', dept: '83', lat: 43.1, lon: 6 }], source: 'Shom', licence: 'CC BY-SA', outOfService: false,
  }],
  cableZones: [{
    id: 'shom/FR000000000000098', name: null, info: null, cableCategory: 'telecom', source: 'Shom', licence: 'Licence ouverte 2.0',
    polygons: [[[[5.99, 43.0805], [6.01, 43.0805], [6.01, 43.0835], [5.99, 43.0835], [5.99, 43.0805]]]],
  }],
  anchorageZones: [],
} as unknown as SubseaCablesFile;
const KM_PER_DEG = (6371 * Math.PI) / 180;
const onTrack = (km: number, status: number | null, mmsi = '229000020'): Vessel => ({
  mmsi, name: 'APPROCHE ESSAI', type: 'Pêche', typeCode: 30, status, lat: 43.1 - km / KM_PER_DEG, lon: 6, sog: 0.3, lastAt: iso(T0 - 10_000),
});

describe('approches d’atterrage et ports (FX2, moins de 2 km d’un atterrage)', () => {
  it('constante unique de 2 km, même valeur côté panneau', () => {
    expect(LANDING_APPROACH_KM).toBe(2);
    expect(CABLE_APPROACH_KM).toBe(LANDING_APPROACH_KM);
  });
  it('en route ou statut absent : à 1,99 km de l’atterrage, non signalé ; à 2,01 km, signalé', () => {
    for (const status of [0, null, 7]) {
      expect(cableHits([onTrack(1.99, status)], APPROACH_FILE), `statut ${status}`).toEqual([]);
      expect(cableHits([onTrack(2.01, status)], APPROACH_FILE).map((h) => [h.cableId, h.distanceM]), `statut ${status}`).toEqual([['shom/FR000000000000099', 0]]);
    }
  });
  it('au mouillage (statut 1) dans la zone de câbles du Shom, à 1,99 km : signalé ; au mouillage hors zone de câbles, à 1 km : non signalé', () => {
    expect(cableZoneAt(onTrack(1.99, 1).lat, 6, APPROACH_FILE)?.id).toBe('shom/FR000000000000098');
    expect(cableHits([onTrack(1.99, 1)], APPROACH_FILE).map((h) => [h.id, h.navStatus])).toEqual([['229000020:shom/FR000000000000099', 1]]);
    expect(cableZoneAt(onTrack(1, 1).lat, 6, APPROACH_FILE)).toBeNull();
    expect(cableHits([onTrack(1, 1)], APPROACH_FILE)).toEqual([]);
    expect(cableHits([onTrack(2.01, 1)], APPROACH_FILE)).toHaveLength(1);
  });
  it('landingWithinKm : distance strictement sous 2 km ; quietLandingApproach suit', () => {
    expect(landingWithinKm(onTrack(1.99, 0).lat, 6, APPROACH_FILE, LANDING_APPROACH_KM)?.commune).toBe('Essai');
    expect(landingWithinKm(onTrack(2.01, 0).lat, 6, APPROACH_FILE, LANDING_APPROACH_KM)).toBeNull();
    expect([quietLandingApproach(onTrack(1.99, 0), APPROACH_FILE), quietLandingApproach(onTrack(2.01, 0), APPROACH_FILE)]).toEqual([true, false]);
  });
  it('atterrage d’un câble hors service : l’approche reste une approche (un port reste un port)', () => {
    const [live] = APPROACH_FILE.cables;
    const deadLanding = {
      ...APPROACH_FILE,
      cables: [
        { ...live, landings: [] },
        { ...live, id: 'shom/FR000000000000097', outOfService: true, path: [[[6, 43.1], [6.2, 43.1]]] },
      ],
    } as SubseaCablesFile;
    expect(cableHits([onTrack(1.99, 0)], deadLanding)).toEqual([]);
    expect(cableHits([onTrack(2.01, 0)], deadLanding).map((h) => h.cableId)).toEqual(['shom/FR000000000000099']);
  });
});

describe('confirmAlerts', () => {
  const hit = (lastAt: number) => cableHits([cargo(lastAt)], FILE);
  it('revu sur un message 6 min plus tard : confirmé, première vue gardée ; 3 min : vu une fois seulement', () => {
    const first = confirmAlerts([], hit(T0 - 10_000), iso(T0));
    expect(first.map((a) => [a.id, a.firstSeen, a.lastSeen, a.confirmed])).toEqual([['229000001:way/761201757', iso(T0 - 10_000), iso(T0 - 10_000), false]]);
    const soon = confirmAlerts(first, hit(T0 - 10_000 + 3 * 60_000), iso(T0 + 3 * 60_000));
    expect(soon[0].confirmed).toBe(false);
    const later = confirmAlerts(soon, hit(T0 - 10_000 + 6 * 60_000), iso(T0 + 6 * 60_000));
    expect([later[0].firstSeen, later[0].lastSeen, later[0].confirmed]).toEqual([iso(T0 - 10_000), iso(T0 + 350_000), true]);
    expect(CONFIRM_GAP_MS).toBe(5 * 60_000);
  });
  it('même message relu par deux relevés : jamais confirmé (deux messages AIS, pas deux lectures)', () => {
    const first = confirmAlerts([], hit(T0 - 10_000), iso(T0));
    expect(confirmAlerts(first, hit(T0 - 10_000), iso(T0 + 6 * 60_000))[0].confirmed).toBe(false);
  });
  it('absent du relevé : retiré ; identifiant stable (navire et câble), jamais l’horloge', () => {
    const first = confirmAlerts([], hit(T0 - 10_000), iso(T0));
    expect(confirmAlerts(first, [], iso(T0 + 6 * 60_000))).toEqual([]);
    expect(first[0].id).toBe('229000001:way/761201757');
  });
  it('absent du relevé, mais dans une zone dont le flux est muet : gardé tel quel, « non évalué (flux de la zone muet) »', () => {
    const first = confirmAlerts([], hit(T0 - 10_000), iso(T0));
    expect(first[0].zoneMuted).toBe(false);
    expect(confirmAlerts(first, [], iso(T0 + 6 * 60_000), () => true)).toEqual([{ ...first[0], zoneMuted: true }]);
    expect(confirmAlerts(first, [], iso(T0 + 6 * 60_000), () => false)).toEqual([]);
  });
});

describe('/api/sovereignty/cables-watch', () => {
  it('relevé lu : alerte vue une fois, AIS à jour, fichier daté ; appel du relais interne avec l’en-tête FranceMonitor', async () => {
    const log = stubRelay(relayBody(T0, [cargo(T0 - 10_000), moored, frenchNavy, noSpeed, farAway, anchoredClear]));
    const { status, body, cache } = await callHandler<CablesWatchResponse>(handler);
    expect([status, cache, body.errors]).toEqual([200, CACHE_CONTROL, []]);
    expect([body.readAt, body.aisLastMessageAt, body.evaluated, body.slowVessels]).toEqual([iso(T0), iso(T0 - 2_000), true, 6]);
    // Liaisons électriques Normandie 1 et 2 écartées des compléments OpenStreetMap (revue finale M5) : 53 câbles, 67 atterrages.
    expect(body.cablesFile).toEqual({ generatedAt: '2026-10-04T19:48:00.000Z', osmBase: '2026-10-04T14:47:16Z', cables: 53, landings: 67 });
    expect(body.alerts.map((a) => [a.id, a.distanceM, a.confirmed])).toEqual([['229000001:way/761201757', 304, false]]);
    expect(log.urls).toEqual([`${RELAY}/slow-vessels`]);
    expect(sentHeader(log.inits[0], 'User-Agent')).toBe(SOURCE_USER_AGENT);
  });
  it('relevé suivant 6 min plus tard : alerte confirmée ; avant 5 min, aucun nouvel appel au relais', async () => {
    const log = stubRelay(relayBody(T0, [cargo(T0 - 10_000)]), relayBody(T0 + 6 * 60_000, [cargo(T0 + 350_000)]));
    await ensureCablesWatchFresh(T0);
    vi.setSystemTime(T0 + 3 * 60_000);
    await ensureCablesWatchFresh(T0 + 3 * 60_000);
    expect(log.urls).toHaveLength(1);
    vi.setSystemTime(T0 + 6 * 60_000);
    const body = await ensureCablesWatchFresh(T0 + 6 * 60_000);
    expect(body.alerts.map((a) => [a.firstSeen, a.lastSeen, a.confirmed])).toEqual([[iso(T0 - 10_000), iso(T0 + 350_000), true]]);
    expect(WATCH_INTERVAL_MS).toBe(5 * 60_000);
  });
  it('relevé suivant qui relit le même message AIS (navire gardé 10 min par le relais) : vu une fois, jamais confirmé', async () => {
    stubRelay(relayBody(T0, [cargo(T0 - 10_000)]), relayBody(T0 + 6 * 60_000, [cargo(T0 - 10_000)]));
    await ensureCablesWatchFresh(T0);
    vi.setSystemTime(T0 + 6 * 60_000);
    const body = await ensureCablesWatchFresh(T0 + 6 * 60_000);
    expect(body.alerts.map((a) => [a.firstSeen, a.lastSeen, a.confirmed])).toEqual([[iso(T0 - 10_000), iso(T0 - 10_000), false]]);
  });
  it('AIS muet depuis 6 min : non évalué, alerte confirmée gardée telle quelle, ni retirée ni reconfirmée', async () => {
    stubRelay(relayBody(T0, [cargo(T0 - 10_000)]), relayBody(T0 + 6 * 60_000, [cargo(T0 + 350_000)]),
      relayBody(T0 + 12 * 60_000, [], T0 + 6 * 60_000, ['flux AIS interrompu : lot 1 sur 3 muet depuis 6 min (Manche, Atlantique, golfe du Lion, Corse, Dunkerque-Calais)']));
    await ensureCablesWatchFresh(T0);
    vi.setSystemTime(T0 + 6 * 60_000);
    const confirmed = await ensureCablesWatchFresh(T0 + 6 * 60_000);
    vi.setSystemTime(T0 + 12 * 60_000);
    const frozen = await ensureCablesWatchFresh(T0 + 12 * 60_000);
    expect([frozen.evaluated, frozen.readAt, frozen.aisLastMessageAt, frozen.slowVessels]).toEqual([false, iso(T0 + 12 * 60_000), iso(T0 + 6 * 60_000), null]);
    expect(confirmed.slowVessels).toBe(1);
    expect(frozen.alerts).toEqual(confirmed.alerts);
    expect(frozen.errors).toEqual(['flux AIS interrompu : lot 1 sur 3 muet depuis 6 min (Manche, Atlantique, golfe du Lion, Corse, Dunkerque-Calais)']);
  });
  it('relais muet depuis toujours (aucun message) : 200, non évalué, aucune alerte, aucun compte de navires', async () => {
    stubRelay(relayBody(T0, [], null, ['AIS : clé aisstream absente (AISSTREAM_API_KEY)']));
    const { status, body } = await callHandler<CablesWatchResponse>(handler);
    expect([status, body.evaluated, body.alerts, body.slowVessels, body.errors]).toEqual([200, false, [], null, ['AIS : clé aisstream absente (AISSTREAM_API_KEY)']]);
  });
  it('relais jamais joint : 502 non mis en cache, panne nommée, aucun compte de navires', async () => {
    stubRelay(respond('erreur', 502));
    const { status, body, cache } = await callHandler<CablesWatchResponse>(handler);
    expect([status, cache, body.readAt, body.evaluated, body.slowVessels, body.errors]).toEqual([502, 'no-store', null, false, null, ['Relais AIS : HTTP 502']]);
  });
  it('relais injoignable après un relevé : alertes gardées avec leur date, non évaluées, compte périmé jamais publié', async () => {
    stubRelay(relayBody(T0, [cargo(T0 - 10_000)]), respond('erreur', 502));
    expect((await ensureCablesWatchFresh(T0)).slowVessels).toBe(1);
    vi.setSystemTime(T0 + 6 * 60_000);
    const { status, body } = await callHandler<CablesWatchResponse>(handler);
    expect([status, body.readAt, body.evaluated, body.alerts.length, body.slowVessels, body.errors]).toEqual([200, iso(T0), false, 1, null, ['Relais AIS : HTTP 502']]);
  });
  it('lot du golfe du Lion muet, Gironde parle : alerte de la zone gardée « flux de la zone muet », retirée quand le lot reparle sans le navire', async () => {
    stubRelay(
      relayBody(T0, [cargo(T0 - 10_000)], T0 - 2_000, [], zones(false)),
      relayBody(T0 + 6 * 60_000, [], T0 + 6 * 60_000 - 2_000, [LOT1_MUTED], zones(true)),
      relayBody(T0 + 12 * 60_000, [], T0 + 12 * 60_000 - 2_000, [], zones(false)),
    );
    const first = await ensureCablesWatchFresh(T0);
    expect(first.alerts.map((a) => [a.id, a.zoneMuted])).toEqual([['229000001:way/761201757', false]]);
    vi.setSystemTime(T0 + 6 * 60_000);
    const muted = await ensureCablesWatchFresh(T0 + 6 * 60_000);
    expect([muted.evaluated, muted.slowVessels, muted.errors]).toEqual([true, 0, [LOT1_MUTED]]);
    expect(muted.alerts).toEqual([{ ...first.alerts[0], zoneMuted: true }]);
    vi.setSystemTime(T0 + 12 * 60_000);
    const back = await ensureCablesWatchFresh(T0 + 12 * 60_000);
    expect([back.evaluated, back.alerts]).toEqual([true, []]);
  });
  it('zone muette recouverte par une boîte d’un lot qui parle : l’absence est vue, alerte retirée', async () => {
    const talking: Zone = { label: 'boîte d’essai d’un autre lot', box: [[42.0, 4.0], [43.5, 6.0]], muted: false };
    stubRelay(
      relayBody(T0, [cargo(T0 - 10_000)], T0 - 2_000, [], [...zones(false), talking]),
      relayBody(T0 + 6 * 60_000, [], T0 + 6 * 60_000 - 2_000, [LOT1_MUTED], [...zones(true), talking]),
    );
    await ensureCablesWatchFresh(T0);
    vi.setSystemTime(T0 + 6 * 60_000);
    expect((await ensureCablesWatchFresh(T0 + 6 * 60_000)).alerts).toEqual([]);
  });
  it('fichier des câbles illisible : non évalué, panne nommée « Câbles (Shom, OpenStreetMap) », jamais « aucun navire »', async () => {
    __resetCablesFileForTests(null);
    const spy = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => { throw new SyntaxError('fichier tronqué'); });
    stubRelay(relayBody(T0, [cargo(T0 - 10_000)]));
    const body = await ensureCablesWatchFresh(T0);
    spy.mockRestore();
    expect([body.evaluated, body.cablesFile, body.alerts, body.slowVessels, body.errors]).toEqual([false, null, [], null, [CABLES_FILE_ERROR]]);
    expect(CABLES_FILE_ERROR).toBe('Câbles (Shom, OpenStreetMap) : fichier illisible');
  });
  it('libellé de panne du fichier identique côté serveur et côté panneau (cablesUnevaluatedWhy le reconnaît)', () => {
    expect(CABLES_FILE_ERROR_TEXT).toBe(CABLES_FILE_ERROR);
  });
  it('adresse du relais : variable AIS_RELAY_INTERNAL_URL, sinon 127.0.0.1 et RELAY_PORT (8090)', () => {
    expect(relayBaseUrl()).toBe(RELAY);
    vi.stubEnv('AIS_RELAY_INTERNAL_URL', '');
    vi.stubEnv('RELAY_PORT', '');
    expect(relayBaseUrl()).toBe('http://127.0.0.1:8090');
  });
});

describe('fichier public des câbles (public/data/subsea-cables.json)', () => {
  it('tronçons du Shom au large sans atterrage : un navire lent sur chacun est retenu sans erreur, câble sans nom', () => {
    __resetCablesFileForTests();
    const file = loadCablesFile() as SubseaCablesFile;
    const offshoreCables = file.cables.filter((c) => c.landings.length === 0);
    expect(offshoreCables.length).toBeGreaterThan(0);
    for (const c of offshoreCables) expect([c.source, c.name]).toEqual(['Shom', null]);
    const vessels: Vessel[] = offshoreCables.map((c, i) => {
      const [lon, lat] = c.path[0][Math.floor(c.path[0].length / 2)];
      return { mmsi: String(229100000 + i), name: null, type: null, typeCode: null, status: 1, lat, lon, sog: 0.5, lastAt: iso(T0) };
    });
    const hits = cableHits(vessels, file);
    offshoreCables.forEach((c, i) => {
      const v = vessels[i];
      const own = hits.find((h) => h.id === `${v.mmsi}:${c.id}`);
      if (anchorageClearOfCablesAt(v.lat, v.lon, file) || quietLandingApproach(v, file)) expect(own).toBeUndefined();
      else expect([own?.cableName, own?.distanceM]).toEqual([null, 0]);
    });
  });
});

describe('déploiement', () => {
  it('le fichier des câbles est livré avec l’API sur la VM (lu par le serveur, pas seulement servi par Caddy), sous son nouveau nom', () => {
    const yml = readFileSync(new URL('../.github/workflows/deploy-vm.yml', import.meta.url), 'utf8');
    expect(yml).toContain('public/data/subsea-cables.json');
    expect(yml).not.toContain('subsea-cables-osm');
    expect(CABLES_FILE_PATH.pathname.endsWith('/public/data/subsea-cables.json')).toBe(true);
  });
});
