// tests/sovereignty-military-api.test.ts : route /api/sovereignty/military (spec 2026-10-04 souveraineté § 2.1, V1, V2 ; contrats
// § 2.2 ; amendement 7, O10) sur la réponse réelle d'adsb.lol /v2/mil du 04/10/2026 à 16 h 48 (139 aéronefs militaires dans le monde,
// 12 dans la zone d'affichage, 9 au-dessus de la France dont 4 français) et sur une lecture suivante construite (même 7700 revu 2 min
// plus tard, 7500 vu une fois au-dessus de Genève). O10 : les appareils français ne sont servis qu'en compte par département ; les
// appareils marqués PIA ou LADD (`dbFlags` 4 et 8) ne sont jamais montrés ; aucune immatriculation pour personne.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADSB_LOL_BASE, __resetAdsbLolForTests } from '../api/_lib/adsb-lol.js';
import { __resetKvForTests, __setKvClientForTests, kvSetJson, readLog } from '../api/_lib/kv-history.js';
import { aircraftFamily } from '../api/_lib/icao-country.js';
import {
  MIL_EMERGENCY_KEY, MIL_HOURLY_KEY, MIL_INTERVAL_MS, MIL_PENDING_NOTE, MIL_TOO_OLD_ERROR, __resetMilitaryForTests, ensureMilitaryFresh,
  hourKey, militaryEmergenciesFrom, normalizeMilAircraft,
} from '../api/_lib/military-collect.js';
import { EMERGENCY_LOG_KEY } from '../api/_shared/air-traffic.js';
import handler, { CACHE_CONTROL, loadMilitary } from '../api/_handlers/sovereignty/military.js';
import { SOURCE_USER_AGENT } from '../api/_lib/source-http.js';
import type { MilitaryResponse } from '../src/types/index.ts';
import { callHandler, respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

type Ac = Record<string, unknown> & { hex: string };
interface MilRead { ac: Ac[]; msg: string; now: number; total: number; ctime: number; ptime: number }
const MIL = (): MilRead => JSON.parse(readFileSync(new URL('./fixtures/sovereignty/adsb-lol-mil.json', import.meta.url), 'utf8')) as MilRead;
const MIL_URL = `${ADSB_LOL_BASE}/v2/mil`;
/** `now` d'adsb.lol du relevé enregistré : 16 h 48 min 24,501 s à Paris. */
const SOURCE_NOW = 1_791_125_304_501;
/** Horloge du serveur : 16 h 48 min 30 s à Paris. */
const T0 = Date.parse('2026-10-04T16:48:30+02:00');
/** Champs d'un appareil montré (MilitaryAircraft) : ni immatriculation ni famille. */
const SHOWN_AIRCRAFT_KEYS = ['altitudeFt', 'callsign', 'country', 'dept', 'hex', 'lat', 'lon', 'seenAt', 'speedKt', 'track', 'type'];
/** Champs d'une urgence masquée (MaskedMilitaryEmergency) : ni adresse, ni indicatif, ni position, ni type, ni pays. */
const MASKED_EMERGENCY_KEYS = ['dept', 'emergency', 'family', 'firstSeen', 'inFrance', 'lastSeen', 'masked', 'overFrance', 'squawk'];

/** Relevé réel, décalé de `sec` secondes, avec des aéronefs remplacés ou ajoutés (même hex : remplacé). */
function reading(sec = 0, extra: Ac[] = []): MilRead {
  const base = MIL();
  const byHex = new Map(extra.map((a) => [a.hex, a]));
  const ac = base.ac.map((a) => byHex.get(a.hex) ?? a);
  for (const a of extra) if (!base.ac.some((b) => b.hex === a.hex)) ac.push(a);
  return { ...base, ac, now: base.now + sec * 1000 };
}

const fixtureAc = (hex: string): Ac => MIL().ac.find((a) => a.hex === hex) as Ac;

/** RCH161 (C-17 américain) déplacé au-dessus du Finistère, transpondeur 7700. */
const RCH161_7700: Ac = { ...fixtureAc('ae0805'), lat: 48.2, lon: -4.1, squawk: '7700', emergency: 'general' };
/** Appareil suisse fictif au-dessus de Genève (4,4 km de la frontière), 7500. */
const GENEVE_7500: Ac = {
  hex: '4b1a2c', type: 'adsb_icao', flight: 'SUI7500 ', t: 'PC21', dbFlags: 1, alt_baro: 9000, gs: 250, track: 270, squawk: '7500',
  emergency: 'unlawful', lat: 46.204, lon: 6.143, seen_pos: 0.4,
};

function stubReads(...reads: Array<MilRead | ReturnType<typeof respond>>) {
  let i = 0;
  return stubFetch((url) => {
    if (url !== MIL_URL) return respond('introuvable', 404);
    const r = reads[Math.min(i, reads.length - 1)];
    i += 1;
    return 'ok' in r && 'status' in r ? r : respond(r);
  });
}

/**
 * Appareil que la réponse ne doit jamais nommer (O10) : famille calculée par le code (bloc OACI France), bit PIA (4) ou LADD (8), ou
 * adresse non OACI (« ~… », nationalité inconnue : peut-être française).
 */
function isMaskedAc(a: Ac): boolean {
  return aircraftFamily(a.hex) === 'francais' || (Number(a.dbFlags) & 12) !== 0 || !/^[0-9a-f]{6}$/.test(a.hex);
}

/** Adresse non OACI au-dessus de la Saône-et-Loire (indicatif d'allure française, jamais une preuve de nationalité). */
const TILDE_FRANCE: Ac = {
  hex: '~3b0abc', type: 'tisb_other', flight: 'FAF1234 ', dbFlags: 1, alt_baro: 12000, gs: 300, track: 90, squawk: '2000', emergency: 'none',
  lat: 46.5, lon: 4.8, seen_pos: 0.5,
};
/** Adresse non OACI au-dessus de Bruxelles, dans la zone d'affichage, hors de France. */
const TILDE_ABROAD: Ac = { ...TILDE_FRANCE, hex: '~4b0def', flight: 'BAF0002 ', lat: 50.85, lon: 4.35 };

/** Lecture avec des appareils masqués de toutes sortes : autre nation PIA au-dessus de la France, LADD hors de France, français LADD. */
const WITH_PROTECTED = (sec = 0): MilRead => reading(sec, [
  { ...fixtureAc('43c6f6'), dbFlags: 5 },
  { ...fixtureAc('ae1436'), dbFlags: 9 },
  { ...fixtureAc('3bf004'), dbFlags: 9 },
]);

/** Appareils comptés au-dessus de la France (français par département, autres montrés ou masqués). */
function counted(body: MilitaryResponse): { francais: number; autres: number } {
  return { francais: body.frenchByDept.reduce((sum, d) => sum + d.count, 0), autres: body.others.length + body.maskedOthers };
}

beforeEach(() => {
  __resetAdsbLolForTests();
  __resetMilitaryForTests();
  __resetKvForTests();
  __setKvClientForTests({ get: async () => null, set: async () => undefined });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => { __setKvClientForTests(null); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('normalisation et territoire (V2)', () => {
  it('FICTIF04 : hélicoptère de la Sécurité civile, bloc France, au-dessus du Rhône, position datée par seen_pos ; immatriculation jamais lue', () => {
    const got = normalizeMilAircraft(fixtureAc('3bf004'), SOURCE_NOW);
    expect(got).toEqual({
      hex: '3bf004', callsign: 'FICTIF04', type: 'EC45', country: 'France', family: 'francais', protectedIdentity: false, unknownNationality: false,
      // Position déplacée dans le même département (revue finale M10) : le jeu d'essai ne garde aucun point réel d'un appareil français.
      lat: 45.87, lon: 4.64, dept: '69', altitudeFt: 525, speedKt: 51.5, track: 352.18, seenAt: '2026-10-04T14:48:24.290Z',
    });
    expect(got).not.toHaveProperty('registration');
  });
  it('au sol, sans position, position de plus de 120 s ou hors de la zone d’affichage : écarté', () => {
    const ac = fixtureAc('3bf004');
    expect(normalizeMilAircraft({ ...ac, alt_baro: 'ground' }, SOURCE_NOW)).toBeNull();
    expect(normalizeMilAircraft({ ...ac, lat: undefined }, SOURCE_NOW)).toBeNull();
    expect(normalizeMilAircraft({ ...ac, seen_pos: 121 }, SOURCE_NOW)).toBeNull();
    expect(normalizeMilAircraft({ ...ac, lat: 52.5, lon: 13.4 }, SOURCE_NOW)).toBeNull();
    expect(normalizeMilAircraft({ ...ac, alt_baro: null }, SOURCE_NOW)?.altitudeFt).toBeNull();
  });
  it('adresse non OACI (« ~ ») : pays inconnu, famille « autres »', () => {
    expect(normalizeMilAircraft({ ...fixtureAc('3bf004'), hex: '~3bf004' }, SOURCE_NOW))
      .toMatchObject({ hex: '~3bf004', country: null, family: 'autres', unknownNationality: true });
    expect(normalizeMilAircraft(fixtureAc('43c6f6'), SOURCE_NOW)?.unknownNationality).toBe(false);
  });
  it('identité protégée : bit PIA (4) ou LADD (8) de `dbFlags`, quelle que soit la nation ; militaire (1) et « intéressant » (2) seuls ne masquent pas', () => {
    const ac = fixtureAc('43c6f6');
    const flag = (dbFlags: unknown) => normalizeMilAircraft({ ...ac, dbFlags }, SOURCE_NOW)?.protectedIdentity;
    expect([flag(5), flag(9), flag(13), flag('8'), flag(1), flag(3), flag(undefined), flag('n.d.')]).toEqual([true, true, true, true, false, false, false, false]);
  });
  it('heure UTC de l’historique', () => {
    expect(hourKey(SOURCE_NOW)).toBe('2026-10-04T14');
  });
});

describe('/api/sovereignty/military', () => {
  it('relevé réel du 04/10 : 9 aéronefs au-dessus de la France (4 français en compte par département, 5 autres montrés), 3 hors de France, jamais 12', async () => {
    const log = stubReads(MIL());
    const { status, body, cache } = await callHandler<MilitaryResponse>(handler);
    expect([status, cache, body.errors]).toEqual([200, CACHE_CONTROL, []]);
    expect([body.readAt, body.sourceNow]).toEqual(['2026-10-04T14:48:30.000Z', '2026-10-04T14:48:24.501Z']);
    expect(body.frenchByDept).toEqual([{ dept: '13', count: 3 }, { dept: '69', count: 1 }]);
    expect(body.others.map((a) => [a.hex, a.callsign, a.type, a.country, a.dept])).toEqual([
      ['894081', 'BAH11', 'B738', 'Bahreïn', '71'], ['c2b5b7', 'CFC2902', 'C30J', 'Canada', '13'],
      ['44f684', 'GRZLY21', 'A400', 'Belgique', '64'], ['43c6f6', 'RRR2243', 'A332', 'Royaume-Uni', '62'],
      ['43c700', 'RRR2301', 'A332', 'Royaume-Uni', '63'],
    ]);
    expect(body.others.every((a) => Object.keys(a).sort().join() === SHOWN_AIRCRAFT_KEYS.join())).toBe(true);
    expect([body.maskedOthers, counted(body)]).toEqual([0, { francais: 4, autres: 5 }]);
    expect([body.abroadCount, body.abroad.map((a) => [a.hex, a.country])]).toEqual([3, [['c05325', 'Canada'], ['ae1436', 'États-Unis'], ['ae5719', 'États-Unis']]]);
    expect(Object.keys(body.abroad[0]).sort()).toEqual(['callsign', 'country', 'hex', 'lat', 'lon', 'type']);
    expect([body.emergencies, body.emergencyLog]).toEqual([[], []]);
    expect(body.hourly).toEqual({ hours: [{ hour: '2026-10-04T14', francais: 4, autres: 5 }], since: '2026-10-04T14' });
    expect(log.urls).toEqual([MIL_URL]);
    expect(sentHeader(log.inits[0], 'User-Agent')).toBe(SOURCE_USER_AGENT);
  });
  it('O10 : ni adresse ni indicatif d’un appareil masqué (famille calculée par le code, PIA, LADD, adresse « ~ »), aucune immatriculation pour personne, dans toute la réponse', async () => {
    const protectedRead = WITH_PROTECTED();
    const read: MilRead = { ...protectedRead, ac: [...protectedRead.ac, TILDE_FRANCE, TILDE_ABROAD] };
    stubReads(read);
    const { body } = await callHandler<MilitaryResponse>(handler);
    const text = JSON.stringify(body);
    const masked = read.ac.filter(isMaskedAc);
    // Garde du test lui-même : les 4 français de la zone, l'appareil PIA, l'appareil LADD hors de France et les deux adresses « ~ »
    // sont bien parmi les masqués.
    expect(['3bf002', '3bf003', '3bf004', '3bf001', '43c6f6', 'ae1436', '~3b0abc', '~4b0def'].every((hex) => masked.some((a) => a.hex === hex))).toBe(true);
    for (const a of masked) {
      expect(text).not.toContain(`"${a.hex}"`);
      if (typeof a.flight === 'string' && a.flight.trim()) expect(text).not.toContain(`"${a.flight.trim()}"`);
    }
    for (const a of read.ac) if (typeof a.r === 'string') expect(text).not.toContain(`"${a.r}"`);
    expect(text).not.toContain('registration');
  });
  it('PIA ou LADD : autre nation au-dessus de la France comptée sans être montrée, hors de France jamais dessinée ; un français LADD reste compté', async () => {
    stubReads(WITH_PROTECTED());
    const body = await ensureMilitaryFresh(T0);
    expect(body.others.map((a) => a.hex)).toEqual(['894081', 'c2b5b7', '44f684', '43c700']);
    expect([body.maskedOthers, counted(body)]).toEqual([1, { francais: 4, autres: 5 }]);
    expect(body.frenchByDept).toEqual([{ dept: '13', count: 3 }, { dept: '69', count: 1 }]);
    expect([body.abroadCount, body.abroad.map((a) => a.hex)]).toEqual([3, ['c05325', 'ae5719']]);
    expect(body.hourly.hours).toEqual([{ hour: '2026-10-04T14', francais: 4, autres: 5 }]);
    const text = JSON.stringify(body);
    for (const hidden of ['"43c6f6"', '"RRR2243"', '"ae1436"', '"FAZE37"']) expect(text).not.toContain(hidden);
  });
  it('adresse non OACI (« ~ ») : nationalité inconnue, masquée par défaut ; au-dessus de la France comptée dans maskedOthers, hors de France dans abroadCount seul', async () => {
    stubReads(reading(0, [TILDE_FRANCE, TILDE_ABROAD]));
    const body = await ensureMilitaryFresh(T0);
    expect(body.others.map((a) => a.hex)).toEqual(['894081', 'c2b5b7', '44f684', '43c6f6', '43c700']);
    expect(body.frenchByDept).toEqual([{ dept: '13', count: 3 }, { dept: '69', count: 1 }]);
    expect([body.maskedOthers, counted(body)]).toEqual([1, { francais: 4, autres: 6 }]);
    expect([body.abroadCount, body.abroad.map((a) => a.hex)]).toEqual([4, ['c05325', 'ae1436', 'ae5719']]);
    expect(body.hourly.hours).toEqual([{ hour: '2026-10-04T14', francais: 4, autres: 6 }]);
    const text = JSON.stringify(body);
    for (const hidden of ['"~3b0abc"', '"FAF1234"', '"~4b0def"', '"BAF0002"']) expect(text).not.toContain(hidden);
  });
  it('urgence d’une adresse non OACI : masquée comme celle d’un appareil français (ni adresse, ni indicatif, ni position), épisode fusionné au journal', async () => {
    const tilde7700: Ac = { ...TILDE_FRANCE, squawk: '7700', emergency: 'general' };
    stubReads(reading(0, [tilde7700]), reading(120, [tilde7700]));
    await ensureMilitaryFresh(T0);
    vi.setSystemTime(T0 + MIL_INTERVAL_MS);
    const body = await ensureMilitaryFresh(T0 + MIL_INTERVAL_MS);
    expect(body.emergencies).toEqual([{
      masked: true, family: 'autres', squawk: '7700', firstSeen: '2026-10-04T14:48:24.501Z', lastSeen: '2026-10-04T14:50:24.501Z',
      overFrance: true, emergency: 'general', inFrance: true, dept: '71',
    }]);
    expect(Object.keys(body.emergencyLog[0]).sort()).toEqual(MASKED_EMERGENCY_KEYS);
    expect(JSON.stringify(body)).not.toContain('~3b0abc');
    const stored = await readLog<Record<string, unknown>>(MIL_EMERGENCY_KEY, { dateOf: (e) => String(e.lastSeen), maxAgeMs: 7 * 86_400_000, now: T0 + MIL_INTERVAL_MS });
    expect(stored.map((e) => [e.icao24, e.masked, 'callsign' in e, 'lat' in e])).toEqual([['~3b0abc', true, false, false]]);
  });
  it('historique horaire : aéronefs distincts par famille (aucun compte d’une lecture répétée), clé « sov: », une seule écriture', async () => {
    const writes: Array<[string, string]> = [];
    __setKvClientForTests({ get: async () => null, set: async (k: string, v: string) => { writes.push([k, v]); } });
    stubReads(MIL(), reading(120));
    await ensureMilitaryFresh(T0);
    vi.setSystemTime(T0 + MIL_INTERVAL_MS);
    const body = await ensureMilitaryFresh(T0 + MIL_INTERVAL_MS);
    expect(body.hourly.hours).toEqual([{ hour: '2026-10-04T14', francais: 4, autres: 5 }]);
    expect(await readLog(MIL_HOURLY_KEY, { dateOf: (e: { hour: string }) => `${e.hour}:00:00.000Z`, maxAgeMs: 7 * 86_400_000, now: T0 }))
      .toEqual([{ hour: '2026-10-04T14', francais: 4, autres: 5 }]);
    expect(writes.filter(([k]) => k === MIL_HOURLY_KEY)).toHaveLength(1);
    expect(MIL_HOURLY_KEY.startsWith('sov:')).toBe(true);
  });
  it('historique horaire (O10) : aucune adresse française, PIA ni LADD écrite dans le stockage clé-valeur, des comptes seulement', async () => {
    const writes: Array<[string, string]> = [];
    __setKvClientForTests({ get: async () => null, set: async (k: string, v: string) => { writes.push([k, v]); } });
    const read = WITH_PROTECTED();
    stubReads(read);
    const body = await ensureMilitaryFresh(T0);
    expect(body.hourly.hours).toEqual([{ hour: '2026-10-04T14', francais: 4, autres: 5 }]);
    const hourly = writes.filter(([k]) => k === MIL_HOURLY_KEY).map(([, v]) => v);
    expect(hourly).toEqual([JSON.stringify([{ hour: '2026-10-04T14', francais: 4, autres: 5 }])]);
    for (const a of read.ac.filter(isMaskedAc)) expect(hourly.join()).not.toContain(a.hex);
  });
  it('historique horaire après un redémarrage dans l’heure : ni double compte ni compte perdu (borne basse gardée), un nouvel aéronef s’ajoute', async () => {
    const newcomer: Ac = { ...GENEVE_7500, hex: '4b1a2d', flight: 'SUI0001 ', squawk: '2000', emergency: 'none', lat: 46.5, lon: 4.8 };
    const withoutDrago = (sec: number, extra: Ac[] = []): MilRead => {
      const r = reading(sec, extra);
      return { ...r, ac: r.ac.filter((a) => a.hex !== '3bf004') };
    };
    stubReads(MIL(), withoutDrago(120), withoutDrago(240, [newcomer]));
    await ensureMilitaryFresh(T0);
    __resetMilitaryForTests();
    vi.setSystemTime(T0 + MIL_INTERVAL_MS);
    expect((await ensureMilitaryFresh(T0 + MIL_INTERVAL_MS)).hourly.hours).toEqual([{ hour: '2026-10-04T14', francais: 4, autres: 5 }]);
    vi.setSystemTime(T0 + 2 * MIL_INTERVAL_MS);
    expect((await ensureMilitaryFresh(T0 + 2 * MIL_INTERVAL_MS)).hourly.hours).toEqual([{ hour: '2026-10-04T14', francais: 4, autres: 6 }]);
  });
  it('historique horaire : nouvelle heure UTC, nouveaux comptes (mémoire de l’heure précédente oubliée)', async () => {
    stubReads(MIL(), reading(3_600));
    await ensureMilitaryFresh(T0);
    vi.setSystemTime(T0 + 3_600_000);
    expect((await ensureMilitaryFresh(T0 + 3_600_000)).hourly.hours).toEqual([
      { hour: '2026-10-04T14', francais: 4, autres: 5 }, { hour: '2026-10-04T15', francais: 4, autres: 5 },
    ]);
  });
  it('historique horaire d’un ancien format (listes d’adresses) : réécrit en comptes dès la lecture suivante', async () => {
    await kvSetJson(MIL_HOURLY_KEY, [
      { hour: '2026-10-04T14', francais: ['3b0099'], autres: [] },
      { hour: '2026-10-04T13', francais: ['3bf002', '3bf003'], autres: ['43c6f6'] },
    ], 7 * 86_400, T0);
    stubReads(MIL());
    const body = await ensureMilitaryFresh(T0);
    expect(body.hourly.hours).toEqual([{ hour: '2026-10-04T13', francais: 2, autres: 1 }, { hour: '2026-10-04T14', francais: 4, autres: 5 }]);
    const stored = await readLog<Record<string, unknown>>(MIL_HOURLY_KEY, { dateOf: (e) => `${String(e.hour)}:00:00.000Z`, maxAgeMs: 7 * 86_400_000, now: T0 });
    expect(stored).toEqual([{ hour: '2026-10-04T14', francais: 4, autres: 5 }, { hour: '2026-10-04T13', francais: 2, autres: 1 }]);
  });
  it('cadence de 2 min : aucune nouvelle lecture avant, une après', async () => {
    const log = stubReads(MIL(), reading(120));
    await ensureMilitaryFresh(T0);
    vi.setSystemTime(T0 + 60_000);
    await ensureMilitaryFresh(T0 + 60_000);
    expect(log.urls).toHaveLength(1);
    vi.setSystemTime(T0 + MIL_INTERVAL_MS);
    expect((await ensureMilitaryFresh(T0 + MIL_INTERVAL_MS)).sourceNow).toBe('2026-10-04T14:50:24.501Z');
    expect(log.urls).toHaveLength(2);
  });
  it('urgences sur deux lectures : 7700 au-dessus du Finistère confirmé (première vue gardée), 7500 vu une fois à Genève', async () => {
    stubReads(reading(0, [RCH161_7700]), reading(120, [RCH161_7700, GENEVE_7500]));
    const first = await ensureMilitaryFresh(T0);
    expect(first.emergencies.map((e) => (e.masked ? null : [e.icao24, e.squawk, e.firstSeen, e.lastSeen]))).toEqual([['ae0805', '7700', '2026-10-04T14:48:24.501Z', '2026-10-04T14:48:24.501Z']]);
    vi.setSystemTime(T0 + MIL_INTERVAL_MS);
    const second = await ensureMilitaryFresh(T0 + MIL_INTERVAL_MS);
    expect(second.emergencies.map((e) => (e.masked ? null : [e.icao24, e.callsign, e.squawk, e.firstSeen, e.lastSeen, e.overFrance, e.inFrance, e.dept, e.country]))).toEqual([
      ['ae0805', 'RCH161', '7700', '2026-10-04T14:48:24.501Z', '2026-10-04T14:50:24.501Z', true, true, '29', 'États-Unis'],
      ['4b1a2c', 'SUI7500', '7500', '2026-10-04T14:50:24.501Z', '2026-10-04T14:50:24.501Z', true, false, null, 'Suisse'],
    ]);
    expect(second.emergencies[1]).toEqual({
      icao24: '4b1a2c', callsign: 'SUI7500', squawk: '7500', lat: 46.204, lon: 6.143, altitudeM: 2743, firstSeen: '2026-10-04T14:50:24.501Z',
      lastSeen: '2026-10-04T14:50:24.501Z', overFrance: true, masked: false, family: 'autres', type: 'PC21', country: 'Suisse',
      emergency: 'unlawful', inFrance: false, dept: null,
    });
    // Le C-17 au-dessus du Finistère entre dans le compte V2 ; l'appareil au-dessus de Genève reste hors de France.
    expect([counted(second), second.abroadCount]).toEqual([{ francais: 4, autres: 6 }, 4]);
    expect(second.emergencyLog.map((e) => (e.masked ? null : e.icao24))).toEqual(['ae0805', '4b1a2c']);
  });
  it('urgences masquées (O10) : appareil français et autre nation PIA, ni adresse, ni indicatif, ni position ; épisode fusionné par l’adresse gardée au journal du serveur', async () => {
    const drago7700: Ac = { ...fixtureAc('3bf004'), squawk: '7700', emergency: 'general' };
    const grizzlyPia7500: Ac = { ...fixtureAc('44f684'), dbFlags: 5, squawk: '7500', emergency: 'unlawful' };
    stubReads(reading(0, [drago7700]), reading(120, [drago7700, grizzlyPia7500]));
    await ensureMilitaryFresh(T0);
    vi.setSystemTime(T0 + MIL_INTERVAL_MS);
    const body = await ensureMilitaryFresh(T0 + MIL_INTERVAL_MS);
    expect(body.emergencies).toEqual([
      {
        masked: true, family: 'autres', squawk: '7500', firstSeen: '2026-10-04T14:50:24.501Z', lastSeen: '2026-10-04T14:50:24.501Z',
        overFrance: true, emergency: 'unlawful', inFrance: true, dept: '64',
      },
      {
        masked: true, family: 'francais', squawk: '7700', firstSeen: '2026-10-04T14:48:24.501Z', lastSeen: '2026-10-04T14:50:24.501Z',
        overFrance: true, emergency: 'general', inFrance: true, dept: '69',
      },
    ]);
    expect([...body.emergencies, ...body.emergencyLog].every((e) => Object.keys(e).sort().join() === MASKED_EMERGENCY_KEYS.join())).toBe(true);
    expect(body.emergencyLog.map((e) => [e.squawk, e.firstSeen])).toEqual([['7700', '2026-10-04T14:48:24.501Z'], ['7500', '2026-10-04T14:50:24.501Z']]);
    const text = JSON.stringify(body);
    for (const hidden of ['"3bf004"', '"FICTIF04"', '"44f684"', '"GRZLY21"', '"EC45"', '"A400"', '45.87']) expect(text).not.toContain(hidden);
    // Journal du serveur : l'adresse sert seulement à fusionner les deux lectures ; ni indicatif, ni position, ni type.
    const stored = await readLog<Record<string, unknown>>(MIL_EMERGENCY_KEY, { dateOf: (e) => String(e.lastSeen), maxAgeMs: 7 * 86_400_000, now: T0 + MIL_INTERVAL_MS });
    expect(stored.map((e) => [e.icao24, e.masked, e.firstSeen])).toEqual([['3bf004', true, '2026-10-04T14:48:24.501Z'], ['44f684', true, '2026-10-04T14:50:24.501Z']]);
    expect(stored.every((e) => !('callsign' in e) && !('lat' in e) && !('lon' in e) && !('type' in e) && !('country' in e) && !('altitudeM' in e))).toBe(true);
  });
  it('code des urgences : transpondeur d’abord, sinon champ `emergency` ramené à un code ; au sol jamais', () => {
    const base = fixtureAc('3bf004');
    const list = [
      { ...base, hex: '3b0001', squawk: '1234', emergency: 'nordo' },
      { ...base, hex: '3b0002', squawk: '7700', emergency: 'none' },
      { ...base, hex: '3b0003', squawk: '7500', emergency: 'general' },
      { ...base, hex: '3b0004', squawk: '1234', emergency: 'minfuel' },
      { ...base, hex: '3b0005', squawk: '7700', alt_baro: 'ground' },
      { ...base, hex: '3b0006', squawk: '2000', emergency: 'none' },
    ];
    expect(militaryEmergenciesFrom(list, '2026-10-04T14:48:24.501Z').map((e) => [e.icao24, e.squawk, e.emergency, e.masked])).toEqual([
      ['3b0001', '7600', 'nordo', true], ['3b0002', '7700', null, true], ['3b0003', '7500', 'general', true], ['3b0004', '7700', 'minfuel', true],
    ]);
  });
  it('à la frontière : Genève et Solent hors de France, en mer à 7,7 km de Marseille en France (sans département, compté en dernier)', async () => {
    const marseille: Ac = { ...GENEVE_7500, hex: '3b0010', flight: 'FAF0001 ', squawk: '2000', emergency: 'none', lat: 43.2, lon: 5.25 };
    stubReads(reading(0, [{ ...GENEVE_7500, squawk: '2000', emergency: 'none' }, marseille]));
    const body = await ensureMilitaryFresh(T0);
    expect(body.frenchByDept).toEqual([{ dept: '13', count: 3 }, { dept: '69', count: 1 }, { dept: null, count: 1 }]);
    expect(body.abroad.map((a) => a.hex)).toEqual(['c05325', 'ae1436', 'ae5719', '4b1a2c']);
    expect([counted(body), body.abroadCount]).toEqual([{ francais: 5, autres: 5 }, 4]);
  });
  it('en Italie à 1 km de la frontière (Clavière, au-dessus de Montgenèvre) : hors de France, dessiné en gris, jamais compté', async () => {
    const claviere: Ac = { ...GENEVE_7500, hex: '33ff01', flight: 'IAM0001 ', t: 'M346', squawk: '2000', emergency: 'none', lat: 44.94, lon: 6.77 };
    stubReads(reading(0, [claviere]));
    const body = await ensureMilitaryFresh(T0);
    expect(body.abroad.find((a) => a.hex === '33ff01')).toEqual({ hex: '33ff01', callsign: 'IAM0001', type: 'M346', country: 'Italie', lat: 44.94, lon: 6.77 });
    expect(body.others.some((a) => a.hex === '33ff01')).toBe(false);
    expect([counted(body), body.abroadCount]).toEqual([{ francais: 4, autres: 5 }, 4]);
  });
  it('readAt : instant de la collecte passé à ensureMilitaryFresh, pas l’horloge du processus', async () => {
    stubReads(MIL());
    expect((await ensureMilitaryFresh(T0 + 5_000)).readAt).toBe('2026-10-04T14:48:35.000Z');
  });
  it('les urgences militaires vont dans leur journal, jamais dans celui du Trafic aérien', async () => {
    stubReads(reading(0, [RCH161_7700]));
    await ensureMilitaryFresh(T0);
    expect(await readLog(EMERGENCY_LOG_KEY, { dateOf: (e: { lastSeen: string }) => e.lastSeen, maxAgeMs: 86_400_000, now: T0 })).toEqual([]);
  });
});

describe('pannes adsb.lol (V1 : une panne n’est jamais un calme)', () => {
  it('429 dès la première lecture : 502 non mis en cache, panne nommée avec l’heure de la nouvelle tentative', async () => {
    stubReads(respond('Too Many Requests', 429));
    const { status, body, cache } = await callHandler<MilitaryResponse>(handler);
    expect([status, cache, body.readAt, body.frenchByDept, body.others, body.maskedOthers]).toEqual([502, 'no-store', null, [], [], 0]);
    expect(body.errors).toEqual(['adsb.lol : HTTP 429, nouvelle tentative après 16:58']);
  });
  it('429 après une lecture réussie : dernière collecte servie avec sa date, aucun appel pendant 10 min ; au-delà de 2 h, 502', async () => {
    const log = stubReads(MIL(), respond('Too Many Requests', 429));
    await ensureMilitaryFresh(T0);
    vi.setSystemTime(T0 + MIL_INTERVAL_MS);
    const kept = await ensureMilitaryFresh(T0 + MIL_INTERVAL_MS);
    expect([kept.readAt, counted(kept)]).toEqual(['2026-10-04T14:48:30.000Z', { francais: 4, autres: 5 }]);
    expect(kept.errors).toEqual(['adsb.lol : HTTP 429, nouvelle tentative après 17:00']);
    vi.setSystemTime(T0 + 2 * MIL_INTERVAL_MS);
    await ensureMilitaryFresh(T0 + 2 * MIL_INTERVAL_MS);
    expect(log.urls).toHaveLength(2);
    const late = T0 + 2 * 3_600_000 + 1000;
    vi.setSystemTime(late);
    stubReads(respond('Too Many Requests', 429));
    const { status, body } = await callHandler<MilitaryResponse>(handler);
    expect([status, body.readAt, body.frenchByDept]).toEqual([502, null, []]);
    expect(body.errors).toContain(MIL_TOO_OLD_ERROR);
  });
  it('401 : « adsb.lol : clé requise »', async () => {
    stubReads(respond('{"error":"key"}', 401));
    const { status, body } = await callHandler<MilitaryResponse>(handler);
    expect([status, body.errors]).toEqual([502, ['adsb.lol : clé requise']]);
  });
  it('file adsb.lol occupée au-delà de l’échéance : collecte précédente servie, « collecte en cours » ; la collecte finit en arrière-plan', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    stubFetch(async () => { await gate; return respond(MIL()); });
    const pending = await loadMilitary(T0, { budgetMs: 20 });
    expect([pending.readAt, pending.errors]).toEqual([null, [MIL_PENDING_NOTE]]);
    release();
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => { setTimeout(resolve, 0); });
    const done = await loadMilitary(T0, { budgetMs: 20 });
    expect([done.readAt, counted(done), done.errors]).toEqual(['2026-10-04T14:48:30.000Z', { francais: 4, autres: 5 }, []]);
  });
});
