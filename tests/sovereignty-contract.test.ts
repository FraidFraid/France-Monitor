// tests/sovereignty-contract.test.ts : contrat serveur / client de la Souveraineté, phase A (spec 2026-10-04 souveraineté § 5 ; contrats
// § 3.3 ; amendement 7). Chaque réponse construite par le code du serveur (gestionnaires et collectes des tâches A3, A5, A8) à partir
// des réponses réelles du 04/10/2026 (mêmes doublures que les tests des routes) passe la garde de forme exacte du client, réponses
// partielles, 502 et notes d'avancement comprises ; servie au client telle que le navigateur la reçoit (corps sérialisé, statut HTTP),
// elle donne la ligne du panneau des sources attendue : une panne est nommée par le serveur, jamais « réponse mal formée ». Les jeux
// d'essai des vues (sovereignty.fixture.ts) sont exactement ce que le serveur rend, et les pastilles du 04/10 en découlent : Défense
// verte, Connectivité verte, Vigilance cyber orange (ALE-011 en cours, exploitation signalée). Les fichiers publics réels
// (public/data/subsea-cables.json, public/data/defense-osm-works.json) passent aussi la garde.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { __resetKvForTests, __setKvClientForTests, kvSetJson } from '../api/_lib/kv-history.js';
import { departementAt, departementsNear } from '../api/_lib/geo-fr.js';
import { ADSB_LOL_BASE, __resetAdsbLolForTests } from '../api/_lib/adsb-lol.js';
import { MIL_PENDING_NOTE, MIL_TOO_OLD_ERROR, __resetMilitaryForTests, ensureMilitaryFresh } from '../api/_lib/military-collect.js';
import { __resetCablesFileForTests, overpassToCables } from '../api/_lib/subsea-cables.js';
import { osmComplement, shomToAnchorageZones, shomToCableZones, shomToCables } from '../api/_lib/shom-cables.js';
import { cablesFile } from '../scripts/fetch-subsea-cables.mjs';
import { __resetCablesWatchForTests, ensureCablesWatchFresh } from '../api/_lib/cable-watch.js';
import { CERTFR_ALERT_LIST_URL, CERTFR_CTI_FEED, CERTFR_FEEDS, parseCertFrFeed } from '../api/_lib/certfr.js';
import { KEV_URL } from '../api/_lib/cisa-kev.js';
import { RANSOM_KEY, VICTIMS_URL, __resetRansomwareForTests } from '../api/_lib/ransomware-live.js';
import { HIBP_BREACHES_URL } from '../api/_lib/hibp.js';
import { CYBERMALVEILLANCE_FEEDS } from '../api/_lib/cybermalveillance.js';
import { CYBER_PENDING_NOTE, __resetCyberForTests, ensureCyberFresh } from '../api/_lib/cyber-collect.js';
import { VIGIPIRATE_PAGE_URL, __resetVigipirateForTests, ensureVigipirateFresh } from '../api/_lib/vigipirate-page.js';
import militaryHandler, { loadMilitary } from '../api/_handlers/sovereignty/military.js';
import cablesHandler from '../api/_handlers/sovereignty/cables-watch.js';
import cyberHandler, { loadCyber } from '../api/_handlers/sovereignty/cyber.js';
import vigipirateHandler from '../api/_handlers/sovereignty/vigipirate.js';
import type { CablesWatchResponse, CyberResponse, MilitaryResponse, SubseaCablesFile, VigipiratePageCheck } from '../src/types/index.ts';
import { resetSovereigntySourceCache } from '../src/services/sovereignty-source.ts';
import { MILITARY_URL, fetchMilitary, isDefenseOsmWorksFile, isMilitaryResponse, militaryStatus } from '../src/services/sovereignty-military.ts';
import { CABLES_WATCH_URL, cablesStatus, fetchCables, isCablesWatchResponse, isSubseaCablesFile } from '../src/services/sovereignty-cables.ts';
import { CYBER_URL, type CyberPart, cyberStatus, fetchCyber, isCyberResponse } from '../src/services/sovereignty-cyber.ts';
import { VIGIPIRATE_CHECK_URL, fetchVigipirateCheck, isVigipiratePageCheck, vigipirateNotices } from '../src/services/sovereignty-vigipirate.ts';
import { cablesLevel, cyberLevel, defenseLevel, militaryCounts } from '../src/services/sovereignty-levels.ts';
import { VIGIPIRATE } from '../src/config/vigipirate.ts';
import {
  CABLES_FILE_FIXTURE, CABLES_WATCH_ALERTS_FIXTURE, CABLES_WATCH_FIXTURE, CABLES_WATCH_FROZEN_FIXTURE, CABLES_WATCH_ZONE_MUTED_FIXTURE,
  CYBER_FIXTURE, MILITARY_EMERGENCY_FIXTURE, MILITARY_FIXTURE, MILITARY_MASKED_EMERGENCY_FIXTURE, SOV_FIXTURE_NOW, VIGIPIRATE_CHECK_CHANGED_FIXTURE,
  VIGIPIRATE_CHECK_FIXTURE,
} from '../src/components/layer-panel/sovereignty.fixture.ts';
import { type FakeResponse, callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/sovereignty/${name}`, import.meta.url), 'utf8');
const publicFile = (name: string): unknown => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8'));
const NOW = SOV_FIXTURE_NOW;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NBSP = '\u00a0';
/** Ce que le navigateur reçoit : le corps après sérialisation JSON (champs `undefined` perdus). */
const wire = (body: unknown): unknown => JSON.parse(JSON.stringify(body)) as unknown;

/** Sert au client la réponse du gestionnaire telle que le navigateur la reçoit (statut HTTP, corps sérialisé). */
function serveToClient(routes: Record<string, { status: number; body: unknown }>): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const r = routes[url];
    if (!r) throw new Error(`URL inattendue ${url}`);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => wire(r.body) };
  }));
}

/** Collecte retenue au-delà de l'échéance de la route : `release` la laisse finir en arrière-plan. */
function gatedFetch(reply: () => FakeResponse): { release: () => void } {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  stubFetch(async () => { await gate; return reply(); });
  return { release };
}
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => { setTimeout(resolve, 0); });
}

beforeEach(() => {
  __resetSwrCacheForTests();
  __resetKvForTests();
  __setKvClientForTests({ get: async () => null, set: async () => undefined });
  resetSovereigntySourceCache();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { __setKvClientForTests(null); __resetCablesFileForTests(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

// ─── Défense ───

type Ac = Record<string, unknown> & { hex: string };
interface MilRead { ac: Ac[]; now: number }
const MIL = (): MilRead => JSON.parse(fx('adsb-lol-mil.json')) as MilRead;
function reading(sec: number, extra: Ac[] = []): MilRead {
  const base = MIL();
  const byHex = new Map(extra.map((a) => [a.hex, a]));
  const ac = base.ac.map((a) => byHex.get(a.hex) ?? a);
  for (const a of extra) if (!base.ac.some((b) => b.hex === a.hex)) ac.push(a);
  return { ...base, ac, now: base.now + sec * 1000 };
}
const fixtureAc = (hex: string): Ac => MIL().ac.find((a) => a.hex === hex) as Ac;
const RCH161_7700: Ac = { ...fixtureAc('ae0805'), lat: 48.2, lon: -4.1, squawk: '7700', emergency: 'general' };
const GENEVE_7500: Ac = {
  hex: '4b1a2c', type: 'adsb_icao', flight: 'SUI7500 ', t: 'PC21', dbFlags: 1, alt_baro: 9000, gs: 250, track: 270, squawk: '7500',
  emergency: 'unlawful', lat: 46.204, lon: 6.143, seen_pos: 0.4,
};
/** Hélicoptère d'État français en 7700 au-dessus du Rhône ; appareil d'une autre nation marqué PIA (dbFlags 4) en 7500. */
const DRAGO_7700: Ac = { ...fixtureAc('3bf004'), squawk: '7700', emergency: 'general' };
const GRIZZLY_PIA_7500: Ac = { ...fixtureAc('44f684'), dbFlags: 5, squawk: '7500', emergency: 'unlawful' };

/** Deux lectures adsb.lol à 16 h 46 et 16 h 48, réponse de 16 h 48. */
async function twoReadings(first: Ac[], second: Ac[]): Promise<MilitaryResponse> {
  stubFetch(() => respond(reading(-120, first)));
  vi.setSystemTime(NOW - 120_000);
  await ensureMilitaryFresh(NOW - 120_000);
  stubFetch(() => respond(reading(0, second)));
  vi.setSystemTime(NOW);
  return ensureMilitaryFresh(NOW);
}

describe('contrat Défense', () => {
  beforeEach(() => { __resetAdsbLolForTests(); __resetMilitaryForTests(); });
  it('relevé du 04/10 : réponse acceptée, identique au jeu d’essai des vues ; pastille verte, 4 français et 5 autres ; ligne « Vols militaires » à 16:48', async () => {
    stubFetch((url) => (url === `${ADSB_LOL_BASE}/v2/mil` ? respond(MIL()) : respond('introuvable', 404)));
    const { status, body } = await callHandler<MilitaryResponse>(militaryHandler);
    expect([status, isMilitaryResponse(wire(body))]).toEqual([200, true]);
    expect(wire(body)).toEqual(MILITARY_FIXTURE());
    expect(defenseLevel(body, NOW).level).toBe('vert');
    expect(militaryCounts(body)).toEqual({ francais: 4, autres: 5, total: 9 });
    serveToClient({ [MILITARY_URL]: { status, body } });
    expect(militaryStatus(await fetchMilitary(null, NOW), NOW)).toMatchObject({ status: 'ok', period: '16:48', error: undefined });
  });
  it('urgences sur deux lectures : identique au jeu d’essai ; 7700 confirmé orange, 7500 vu une fois à Genève sans couleur rouge', async () => {
    const body = await twoReadings([RCH161_7700], [RCH161_7700, GENEVE_7500]);
    expect(isMilitaryResponse(wire(body))).toBe(true);
    expect(wire(body)).toEqual(MILITARY_EMERGENCY_FIXTURE());
    expect(defenseLevel(body, NOW)).toEqual({ level: 'orange', reason: `7700${NBSP}(urgence) affiché sur deux relevés : RCH161` });
  });
  it('urgences masquées (O10) : identique au jeu d’essai, acceptées sans adresse, indicatif ni position ; « appareil d’État français · Dépt 69 »', async () => {
    const body = await twoReadings([DRAGO_7700], [DRAGO_7700, GRIZZLY_PIA_7500]);
    expect(isMilitaryResponse(wire(body))).toBe(true);
    expect(wire(body)).toEqual(MILITARY_MASKED_EMERGENCY_FIXTURE());
    expect(body.emergencies.every((e) => e.masked)).toBe(true);
    for (const hidden of ['"3bf004"', '"FICTIF04"', '"44f684"', '"GRZLY21"', '45.718826']) expect(JSON.stringify(body)).not.toContain(hidden);
    expect(defenseLevel(body, NOW)).toEqual({ level: 'orange', reason: `7700${NBSP}(urgence) affiché sur deux relevés : appareil d’État français · Dépt${NBSP}69` });
  });
  it('429 : 502 de même forme, accepté par la garde ; servi au client, la ligne des sources nomme la panne ; pastille n.d.', async () => {
    stubFetch(() => respond('Too Many Requests', 429));
    const { status, body } = await callHandler<MilitaryResponse>(militaryHandler);
    expect([status, isMilitaryResponse(wire(body))]).toEqual([502, true]);
    expect(defenseLevel(body, NOW).level).toBe('nd');
    serveToClient({ [MILITARY_URL]: { status, body } });
    expect(militaryStatus(await fetchMilitary(null, NOW), NOW))
      .toEqual({ status: 'error', lastUpdate: null, error: 'adsb.lol : HTTP 429, nouvelle tentative après 16:58', period: undefined });
  });
  it('dernière collecte de plus de 2 h : 502 de même forme, panne nommée ; données précédentes gardées par le client', async () => {
    stubFetch(() => respond(MIL()));
    const fresh = await callHandler<MilitaryResponse>(militaryHandler);
    serveToClient({ [MILITARY_URL]: fresh });
    const first = await fetchMilitary(null, NOW);
    const late = NOW + 2 * HOUR + 1000;
    vi.setSystemTime(late);
    stubFetch(() => respond('Too Many Requests', 429));
    const { status, body } = await callHandler<MilitaryResponse>(militaryHandler);
    expect([status, isMilitaryResponse(wire(body)), body.errors]).toEqual([502, true, ['adsb.lol : HTTP 429, nouvelle tentative après 18:58', MIL_TOO_OLD_ERROR]]);
    serveToClient({ [MILITARY_URL]: { status, body } });
    const kept = await fetchMilitary(first, late);
    expect([kept.military.data?.readAt, kept.military.error]).toEqual(['2026-10-04T14:48:30.000Z', body.errors.join(' ; ')]);
    expect(militaryStatus(kept, late)).toMatchObject({ status: 'stale', period: '16:48 (en retard)' });
  });
  it('collecte en cours au-delà de l’échéance : 502 de même forme avec la note ; ligne en chargement, jamais une panne', async () => {
    const { release } = gatedFetch(() => respond(MIL()));
    const body = await loadMilitary(NOW, { budgetMs: 20 });
    expect([body.readAt, body.errors, isMilitaryResponse(wire(body))]).toEqual([null, [MIL_PENDING_NOTE], true]);
    serveToClient({ [MILITARY_URL]: { status: 502, body } });
    expect(militaryStatus(await fetchMilitary(null, NOW), NOW)).toMatchObject({ status: 'loading', period: `n.d. · ${MIL_PENDING_NOTE}` });
    release();
    await settle();
  });
  it('fichier public des ouvrages de défense (OpenStreetMap) accepté par la garde', () => {
    expect(isDefenseOsmWorksFile(publicFile('defense-osm-works.json'))).toBe(true);
  });
});

// ─── Connectivité ───

const OSM = JSON.parse(fx('osm-subsea-cables.json')) as { osm3s: { timestamp_osm_base: string } };
const GEO = { departementAt, departementsNear };
const SHOM_CABLES = shomToCables(JSON.parse(fx('shom-cblsub-lv.json')), GEO);
const CABLE_ZONES = shomToCableZones(JSON.parse(fx('shom-cblare-polygon.json')));
/** Fichier assemblé comme le vrai par scripts/fetch-subsea-cables.mjs, daté de 16 h 48 (communes nommées par le script en production). */
const FILE = cablesFile({
  generatedAt: '2026-10-04T14:48:00.000Z', osmBase: OSM.osm3s.timestamp_osm_base,
  editions: { cables: '2019-01-07', cableZones: '2021-07', anchorageZones: '2021-07' },
  shomCables: SHOM_CABLES, osmCables: osmComplement(overpassToCables(OSM, GEO), SHOM_CABLES),
  cableZones: CABLE_ZONES, anchorageZones: shomToAnchorageZones(JSON.parse(fx('shom-achare-polygon.json')), CABLE_ZONES),
}) as SubseaCablesFile;
const W = Date.parse('2026-10-04T14:47:00Z');
const iso = (ms: number): string => new Date(ms).toISOString();
const cargo = (at: number) => ({ mmsi: '229000001', name: 'CARGO ESSAI', type: 'Cargo', typeCode: 70, status: 1, lat: 42.85, lon: 4.8558, sog: 1, lastAt: iso(at) });
const moored = (at: number) => ({ mmsi: '229000002', name: 'AMARRE ESSAI', type: 'Cargo', typeCode: 70, status: 5, lat: 42.85, lon: 4.853, sog: 0, lastAt: iso(at) });
const farAway = (at: number) => ({ mmsi: '229000006', name: 'AU LARGE', type: 'Pêche', typeCode: 30, status: 7, lat: 43.0, lon: 6.0, sog: 0.8, lastAt: iso(at) });
const foreignNavy = (at: number) => ({ mmsi: '235000004', name: 'WARSHIP TEST', type: 'Militaire', typeCode: 35, status: 0, lat: 42.85, lon: 4.8535, sog: 0.4, lastAt: iso(at) });
/** Boîtes réelles de l'abonnement du relais : golfe du Lion (lot 1) et Gironde (lot 2). */
const zones = (lionMuted: boolean) => [
  { label: 'golfe du Lion', box: [[41.0, 1.8], [44.8, 8.2]], muted: lionMuted }, { label: 'Gironde', box: [[44.5, -1.3], [45.4, -0.4]], muted: false },
];
const relay = (at: number, vessels: object[], last: number | null = at - 2000, errors: string[] = [], relayZones = zones(false)) => respond({
  at: iso(at), lastMessageAt: last === null ? null : iso(last), vessels, errors, zones: relayZones,
});
const LOT1 = '(Manche, Atlantique, golfe du Lion, Corse, Dunkerque-Calais)';
const SILENT = `flux AIS interrompu : lot 1 sur 3 muet depuis 6 min ${LOT1}`;
const PARTIAL = `flux AIS partiel : lot 1 sur 3 muet depuis 6 min ${LOT1}`;

async function watchAt(at: number, reply: FakeResponse): Promise<CablesWatchResponse> {
  stubFetch(() => reply);
  vi.setSystemTime(at);
  return ensureCablesWatchFresh(at);
}
const cableKey = (c: SubseaCablesFile['cables'][number]) => [c.id, c.name, c.operator, c.source, c.licence, c.outOfService, c.path.length, c.landings.map((l) => [l.dept, l.lat, l.lon])];
const zoneKey = (z: SubseaCablesFile['cableZones'][number] | SubseaCablesFile['anchorageZones'][number]) => ({ ...z, polygons: z.polygons.map((p) => p.length) });

describe('contrat Connectivité', () => {
  beforeEach(() => { __resetCablesWatchForTests(); __resetCablesFileForTests(FILE); vi.stubEnv('AIS_RELAY_INTERNAL_URL', 'http://relais.test'); });
  it('fichier des câbles : jeu d’essai des vues = sortie du script (mêmes câbles, sources, licences, atterrages, zones), éclairci, communes nommées ; accepté', () => {
    const fixture = CABLES_FILE_FIXTURE();
    expect([isSubseaCablesFile(fixture), isSubseaCablesFile(wire(FILE))]).toEqual([true, true]);
    expect([fixture.generatedAt, fixture.osmBase, fixture.sources]).toEqual([FILE.generatedAt, FILE.osmBase, FILE.sources]);
    expect(fixture.cables.map(cableKey)).toEqual(FILE.cables.map(cableKey));
    expect(fixture.cableZones.map(zoneKey)).toEqual(FILE.cableZones.map(zoneKey));
    expect(fixture.anchorageZones.map(zoneKey)).toEqual(FILE.anchorageZones.map(zoneKey));
    expect(fixture.cables.every((c) => c.landings.every((l) => l.commune.length > 0) && c.path.every((line) => line.length <= 12))).toBe(true);
    expect(fixture.cables.filter((c) => c.outOfService).map((c) => c.id)).toEqual(['shom/FR000008435100001']);
  });
  it('fichier public réel (Shom et OpenStreetMap, généré le 04/10) accepté par la garde', () => {
    expect(isSubseaCablesFile(publicFile('subsea-cables.json'))).toBe(true);
  });
  it('relevé sans alerte : identique au jeu d’essai ; pastille verte ; servi au client avec le fichier, ligne « Câbles et AIS » à 16:46', async () => {
    const body = await watchAt(W, relay(W, [moored(W - 10_000), farAway(W - 20_000)]));
    expect([isCablesWatchResponse(wire(body)), wire(body)]).toEqual([true, CABLES_WATCH_FIXTURE()]);
    expect(cablesLevel(body, NOW).level).toBe('vert');
    serveToClient({ [CABLES_WATCH_URL]: { status: 200, body }, '/data/subsea-cables.json': { status: 200, body: CABLES_FILE_FIXTURE() } });
    const state = await fetchCables(null, NOW);
    expect([state.fileError, state.file?.cables.length]).toEqual([null, FILE.cables.length]);
    expect(cablesStatus(state, NOW)).toMatchObject({ status: 'ok', period: '16:46' });
  });
  it('alerte confirmée et alerte vue une fois : identiques au jeu d’essai ; pastille orange', async () => {
    await watchAt(W - 360_000, relay(W - 360_000, [cargo(W - 370_000), moored(W - 370_000)]));
    const body = await watchAt(W, relay(W, [cargo(W - 10_000), moored(W - 10_000), foreignNavy(W - 5_000), farAway(W - 20_000)]));
    expect([isCablesWatchResponse(wire(body)), wire(body)]).toEqual([true, CABLES_WATCH_ALERTS_FIXTURE()]);
    expect(cablesLevel(body, NOW).level).toBe('orange');
  });
  it('AIS muet depuis 6 min : alerte gardée, non évaluée, aucun compte de navires, identique au jeu d’essai ; pastille n.d., jamais vert', async () => {
    await watchAt(W - 720_000, relay(W - 720_000, [cargo(W - 730_000)]));
    await watchAt(W - 360_000, relay(W - 360_000, [cargo(W - 370_000)]));
    const body = await watchAt(W, relay(W, [], W - 360_000, [SILENT]));
    expect([isCablesWatchResponse(wire(body)), wire(body)]).toEqual([true, CABLES_WATCH_FROZEN_FIXTURE()]);
    expect(body.slowVessels).toBeNull();
    expect(cablesLevel(body, NOW)).toEqual({ level: 'nd', reason: 'non évalué · AIS muet depuis 16:41' });
  });
  it('lot amont d’une zone muet : alerte gardée « non évaluée (flux de la zone muet) », identique au jeu d’essai, acceptée', async () => {
    await watchAt(W - 360_000, relay(W - 360_000, [cargo(W - 370_000)]));
    const body = await watchAt(W, relay(W, [], W - 2000, [PARTIAL], zones(true)));
    expect([isCablesWatchResponse(wire(body)), wire(body)]).toEqual([true, CABLES_WATCH_ZONE_MUTED_FIXTURE()]);
    expect(body.alerts.map((a) => a.zoneMuted)).toEqual([true]);
  });
  it('relais jamais joint : 502 de même forme, accepté ; servi au client, la ligne des sources nomme la panne', async () => {
    stubFetch(() => respond('erreur', 502));
    const { status, body } = await callHandler<CablesWatchResponse>(cablesHandler);
    expect([status, isCablesWatchResponse(wire(body))]).toEqual([502, true]);
    expect(cablesLevel(body, NOW).level).toBe('nd');
    serveToClient({ [CABLES_WATCH_URL]: { status, body }, '/data/subsea-cables.json': { status: 200, body: CABLES_FILE_FIXTURE() } });
    expect(cablesStatus(await fetchCables(null, NOW), NOW)).toMatchObject({ status: 'error', error: 'Relais AIS : HTTP 502' });
  });
});

// ─── Vigilance cyber ───

const FEED_ITEMS = [...parseCertFrFeed(fx('certfr-alerte-feed.xml'), 'alerte'), ...parseCertFrFeed(fx('certfr-avis-feed.xml'), 'avis')];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** Phrases d'exploitation des pages réelles d'ALE-009 et d'ALE-010, lues le 04/10/2026 (amendement 7, O3), recopiées telles quelles. */
const PAGE_EXPLOITATION: Readonly<Record<string, string>> = {
  'CERTFR-2026-ALE-009': 'L\'éditeur indique que ces deux vulnérabilités sont activement exploitées, sans préciser s\'il est possible pour un attaquant '
    + 'non authentifié de chaîner l\'exploitation de ces deux vulnérabilités pour prendre la main sur l\'équipement.',
  'CERTFR-2026-ALE-010': 'Le CERT-FR a connaissance de nombreuses compromissions de Metabase vulnérables.',
};
/**
 * Page construite pour un élément sans page enregistrée : dernière version = première version, CVE du résumé du flux ; pour ALE-009 et
 * ALE-010, la phrase d'exploitation de la page réelle.
 */
function constructedPage(ref: string): string {
  const item = FEED_ITEMS.find((i) => i.ref === ref);
  if (!item) return '<!doctype html><html><body>introuvable</body></html>';
  const [y, m, d] = item.firstVersion.split('-');
  const day = `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
  const exploitation = PAGE_EXPLOITATION[ref];
  return `<!doctype html><html><body><table><tr><td>Référence</td><td>${ref}</td></tr>`
    + `<tr><td>Date de la première version</td><td>${day}</td></tr><tr><td>Date de la dernière version</td><td>${day}</td></tr></table>`
    + (exploitation !== undefined ? `<p>${exploitation}</p>` : '')
    + `<ul>${item.feedCves.map((c: string) => `<li>Référence CVE ${c}</li>`).join('')}</ul></body></html>`;
}
/** Sources réelles ; `override` force une réponse pour une URL (panne, page HTML…). */
function cyberSources(override: (url: string) => FakeResponse | null = () => null) {
  return stubFetch((url) => {
    const forced = override(url);
    if (forced) return forced;
    if (url === CERTFR_FEEDS.alerte) return respond(fx('certfr-alerte-feed.xml'));
    if (url === CERTFR_FEEDS.avis) return respond(fx('certfr-avis-feed.xml'));
    if (url === CERTFR_ALERT_LIST_URL) return respond(fx('certfr-alerte-liste.html'));
    if (url === CERTFR_CTI_FEED) return respond(fx('certfr-cti-feed.xml'));
    if (url.endsWith('/alerte/CERTFR-2026-ALE-011/')) return respond(fx('certfr-alerte-CERTFR-2026-ALE-011.html'));
    if (url.endsWith('/alerte/CERTFR-2026-ALE-008/')) return respond(fx('certfr-alerte-CERTFR-2026-ALE-008.html'));
    if (url.endsWith('/avis/CERTFR-2026-AVI-1257/')) return respond(fx('certfr-avis-CERTFR-2026-AVI-1257.html'));
    const ref = /CERTFR-\d{4}-(?:ALE|AVI)-\d+/.exec(url)?.[0];
    if (ref) return respond(constructedPage(ref));
    if (url === KEV_URL) return respond(fx('cisa-kev-reduit.json'));
    if (url === VICTIMS_URL) return respond(fx('ransomware-live-victims-reduit.json'), 200, { 'Last-Modified': 'Sun, 04 Oct 2026 14:30:09 GMT' });
    if (url === HIBP_BREACHES_URL) return respond(fx('hibp-breaches-reduit.json'));
    if (url === CYBERMALVEILLANCE_FEEDS.alertes) return respond(fx('cybermalveillance-alertes.xml'));
    if (url === CYBERMALVEILLANCE_FEEDS.actualites) return respond(fx('cybermalveillance-actualites.xml'));
    return respond('introuvable', 404);
  });
}
const PARTS: readonly CyberPart[] = ['certfr', 'kev', 'ransomware', 'hibp', 'cybermalveillance'];
async function clientCyber(status: number, body: unknown) {
  serveToClient({ [CYBER_URL]: { status, body } });
  return fetchCyber(null, NOW);
}

describe('contrat Vigilance cyber', () => {
  beforeEach(() => { __resetRansomwareForTests(); __resetCyberForTests(); });
  it('réponse du 04/10 (les 44 pages lues en trois cycles) : identique au jeu d’essai ; pastille orange par ALE-011 ; cinq lignes datées par leur donnée', async () => {
    cyberSources();
    for (const t of [NOW - 2 * HOUR, NOW - HOUR]) {
      vi.setSystemTime(t);
      await ensureCyberFresh(t);
    }
    __resetSwrCacheForTests();
    await kvSetJson(RANSOM_KEY, null, 1, NOW - HOUR);
    vi.setSystemTime(NOW);
    const { status, body } = await callHandler<CyberResponse>(cyberHandler);
    expect([status, isCyberResponse(wire(body))]).toEqual([200, true]);
    expect(wire(body)).toEqual(CYBER_FIXTURE());
    expect(cyberLevel(body, NOW)).toEqual({ level: 'orange', reason: 'CERTFR-2026-ALE-011 en cours, publiée le 28/09 : exploitation signalée par le CERT-FR' });
    const state = await clientCyber(status, body);
    expect(PARTS.map((p) => [p, cyberStatus(state, p, NOW).status, cyberStatus(state, p, NOW).period])).toEqual([
      ['certfr', 'ok', '16:48'], ['kev', 'ok', '16:48'], ['ransomware', 'ok', '16:30'], ['hibp', 'ok', '16:48'], ['cybermalveillance', 'ok', '16:48'],
    ]);
  });
  it('réponse partielle (avis et KEV en panne, premier cycle) : acceptée, pannes nommées par leur ligne', async () => {
    cyberSources((url) => (url === CERTFR_FEEDS.avis || url === KEV_URL ? respond('indisponible', 503) : null));
    const { status, body } = await callHandler<CyberResponse>(cyberHandler);
    expect([status, isCyberResponse(wire(body))]).toEqual([200, true]);
    const state = await clientCyber(status, body);
    expect(cyberStatus(state, 'certfr', NOW)).toMatchObject({ status: 'stale', error: 'CERT-FR, avis : HTTP 503', period: '16:48' });
    expect(cyberStatus(state, 'kev', NOW)).toMatchObject({ status: 'error', error: 'CISA KEV : HTTP 503', period: 'n.d.' });
    expect(cyberStatus(state, 'hibp', NOW)).toMatchObject({ status: 'ok', error: undefined });
  });
  it('fuites .fr récentes (O5) : un compte, la date d’ajout et le lien, acceptés', async () => {
    const breaches = (JSON.parse(fx('hibp-breaches-reduit.json')) as Array<Record<string, unknown>>).map((b) => (
      b.Domain === 'organisation-03.fr' ? { ...b, AddedDate: '2026-09-28T17:12:00Z' } : b));
    cyberSources((url) => (url === HIBP_BREACHES_URL ? respond(breaches) : null));
    const { status, body } = await callHandler<CyberResponse>(cyberHandler);
    expect([status, isCyberResponse(wire(body)), body.hibp?.count]).toEqual([200, true, 1]);
  });
  it('rien n’a répondu : 502 de même forme, accepté ; servi au client, chaque ligne nomme sa panne ; pastille n.d.', async () => {
    stubFetch(() => respond('indisponible', 503));
    const { status, body } = await callHandler<CyberResponse>(cyberHandler);
    expect([status, isCyberResponse(wire(body))]).toEqual([502, true]);
    expect(cyberLevel(body, NOW).level).toBe('nd');
    const state = await clientCyber(status, body);
    expect(cyberStatus(state, 'certfr', NOW)).toEqual({
      status: 'error', lastUpdate: null, period: undefined,
      error: 'CERT-FR, alertes : HTTP 503 ; CERT-FR, avis : HTTP 503 ; CERT-FR, liste des alertes : HTTP 503 ; CERT-FR, rapports Menaces et incidents : HTTP 503',
    });
    expect(PARTS.slice(1).map((p) => cyberStatus(state, p, NOW).error)).toEqual([
      'CISA KEV : HTTP 503', 'Ransomware.live : HTTP 503', 'HIBP : HTTP 503', 'Cybermalveillance, alertes : HTTP 503 ; Cybermalveillance, actualités : HTTP 503',
    ]);
  });
  it('collecte en cours au-delà de l’échéance : 502 de même forme avec la note ; les cinq lignes en chargement', async () => {
    const { release } = gatedFetch(() => respond('indisponible', 503));
    const body = await loadCyber(NOW, { budgetMs: 20 });
    expect([body.readAt, body.errors, isCyberResponse(wire(body))]).toEqual([null, [CYBER_PENDING_NOTE], true]);
    const state = await clientCyber(502, body);
    expect(PARTS.map((p) => cyberStatus(state, p, NOW).status)).toEqual(['loading', 'loading', 'loading', 'loading', 'loading']);
    release();
    await settle();
  });
});

// ─── Vigipirate ───

const PAGE = fx('sgdsn-vigipirate.html');
const ALERTE_ATTENTAT = PAGE.replace('Positionnée au nouveau stade «&nbsp;vigilance renforcée&nbsp;»', 'Positionnée au nouveau stade «&nbsp;alerte attentat&nbsp;»');
const page = (html: string) => stubFetch((url) => (url === VIGIPIRATE_PAGE_URL ? respond(html) : respond('introuvable', 404)));

describe('contrat Vigipirate (O14)', () => {
  beforeEach(() => { __resetVigipirateForTests(); });
  it('page relue le 04/10 : identique au jeu d’essai, acceptée ; servie au client, aucune mention sur la saisie du jour', async () => {
    page(PAGE);
    const { status, body } = await callHandler<VigipiratePageCheck>(vigipirateHandler);
    expect([status, isVigipiratePageCheck(wire(body))]).toEqual([200, true]);
    expect(wire(body)).toEqual(VIGIPIRATE_CHECK_FIXTURE());
    serveToClient({ [VIGIPIRATE_CHECK_URL]: { status, body } });
    const { check } = await fetchVigipirateCheck(null, NOW);
    expect(vigipirateNotices(VIGIPIRATE, check, NOW)).toEqual({ alertEnd: null, recheck: null, reminder: null, checkFailure: null });
  });
  it('page passée au stade « alerte attentat » le lendemain : identique au jeu d’essai ; « niveau à revérifier sur sgdsn.gouv.fr (page modifiée le 05/10) »', async () => {
    page(PAGE);
    await ensureVigipirateFresh(NOW);
    page(ALERTE_ATTENTAT);
    vi.setSystemTime(NOW + DAY);
    const body = await ensureVigipirateFresh(NOW + DAY);
    expect([isVigipiratePageCheck(wire(body)), wire(body)]).toEqual([true, VIGIPIRATE_CHECK_CHANGED_FIXTURE()]);
    expect(vigipirateNotices(VIGIPIRATE, { data: body, error: null, fetchedAt: NOW + DAY }, NOW + DAY).recheck)
      .toBe('niveau à revérifier sur sgdsn.gouv.fr (page modifiée le 05/10)');
  });
  it('page jamais lue : 502 de même forme, accepté ; servi au client, la vérification en panne est dite', async () => {
    stubFetch(() => respond('indisponible', 503));
    const { status, body } = await callHandler<VigipiratePageCheck>(vigipirateHandler);
    expect([status, isVigipiratePageCheck(wire(body))]).toEqual([502, true]);
    serveToClient({ [VIGIPIRATE_CHECK_URL]: { status, body } });
    const { check } = await fetchVigipirateCheck(null, NOW);
    expect(vigipirateNotices(VIGIPIRATE, check, NOW).checkFailure).toBe('page officielle jamais relue : SGDSN, page Vigipirate : HTTP 503');
  });
});
