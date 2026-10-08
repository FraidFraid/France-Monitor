// tests/sovereignty-military-api.test.ts : route /api/sovereignty/military (spec 2026-10-04 souveraineté § 2.1, V1, V2 ; contrats
// § 2.2) sur la réponse réelle d'adsb.lol /v2/mil du 04/10/2026 à 16 h 48 (139 aéronefs militaires dans le monde, 12 dans la zone
// d'affichage, 9 au-dessus de la France dont 4 français) et sur une lecture suivante construite (même 7700 revu 2 min plus tard, 7500
// vu une fois au-dessus de Genève). Décision de l'utilisateur du 08/10/2026 (remplace la règle O10) : plus aucun masquage. Les
// appareils français, ceux marqués PIA ou LADD (`dbFlags` 4 et 8) et les adresses non OACI (« ~… ») sont montrés comme les autres, avec
// adresse, indicatif, immatriculation (champ `r`), type et position ; les français restent aussi comptés par département.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADSB_LOL_BASE, __resetAdsbLolForTests } from '../api/_lib/adsb-lol.js';
import { __resetKvForTests, __setKvClientForTests, kvSetJson, readLog } from '../api/_lib/kv-history.js';
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
/** Champs d'un appareil montré (MilitaryAircraft) : identité complète, immatriculation et famille comprises. */
const SHOWN_AIRCRAFT_KEYS = ['altitudeFt', 'callsign', 'country', 'dept', 'family', 'hex', 'lat', 'lon', 'registration', 'seenAt', 'speedKt', 'track', 'type'];
/** Champs d'un appareil hors de France (MilitaryAbroad). */
const SHOWN_ABROAD_KEYS = ['callsign', 'country', 'family', 'hex', 'lat', 'lon', 'registration', 'type'];
/** Champs d'une urgence (MilitaryEmergency) : identité complète, plus aucun champ `masked`. */
const SHOWN_EMERGENCY_KEYS = [
  'altitudeM', 'callsign', 'country', 'dept', 'emergency', 'family', 'firstSeen', 'icao24', 'inFrance', 'lastSeen', 'lat', 'lon', 'overFrance',
  'registration', 'squawk', 'type',
];
/** Champs de l'ancienne règle de masquage, qui ne doivent plus figurer dans aucune réponse. */
const REMOVED_KEYS = ['maskedOthers', 'others', 'masked', 'protectedIdentity', 'unknownNationality'];

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

/** Adresse non OACI au-dessus de la Saône-et-Loire (indicatif d'allure française, jamais une preuve de nationalité). */
const TILDE_FRANCE: Ac = {
  hex: '~3b0abc', type: 'tisb_other', flight: 'FAF1234 ', dbFlags: 1, alt_baro: 12000, gs: 300, track: 90, squawk: '2000', emergency: 'none',
  lat: 46.5, lon: 4.8, seen_pos: 0.5,
};
/** Adresse non OACI au-dessus de Bruxelles, dans la zone d'affichage, hors de France. */
const TILDE_ABROAD: Ac = { ...TILDE_FRANCE, hex: '~4b0def', flight: 'BAF0002 ', lat: 50.85, lon: 4.35 };

/** Lecture avec des appareils autrefois masqués : autre nation PIA au-dessus de la France, LADD hors de France, français LADD. */
const WITH_PROTECTED = (sec = 0): MilRead => reading(sec, [
  { ...fixtureAc('43c6f6'), dbFlags: 5 },
  { ...fixtureAc('ae1436'), dbFlags: 9 },
  { ...fixtureAc('3bf004'), dbFlags: 9 },
]);

/** Appareils comptés au-dessus de la France : français en compte par département, autres montrés un par un. */
function counted(body: MilitaryResponse): { francais: number; autres: number } {
  return { francais: body.frenchByDept.reduce((sum, d) => sum + d.count, 0), autres: body.aircraft.filter((a) => a.family === 'autres').length };
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
  it('FICTIF04 : hélicoptère de la Sécurité civile, bloc France, au-dessus du Rhône, position datée par seen_pos ; immatriculation lue (champ `r`)', () => {
    const got = normalizeMilAircraft(fixtureAc('3bf004'), SOURCE_NOW);
    expect(got).toEqual({
      hex: '3bf004', callsign: 'FICTIF04', registration: 'F-ZFIC', type: 'EC45', country: 'France', family: 'francais',
      // Position déplacée dans le même département (revue finale M10) : le jeu d'essai ne garde aucun point réel d'un appareil français.
      lat: 45.87, lon: 4.64, dept: '69', altitudeFt: 525, speedKt: 51.5, track: 352.18, seenAt: '2026-10-04T14:48:24.290Z',
    });
    expect(normalizeMilAircraft(fixtureAc('43c6f6'), SOURCE_NOW)?.registration).toBe('ZZ999');
    expect(normalizeMilAircraft(fixtureAc('3bf003'), SOURCE_NOW)?.registration).toBeNull();
    expect(normalizeMilAircraft({ ...fixtureAc('3bf004'), r: '  ' }, SOURCE_NOW)?.registration).toBeNull();
  });
  it('au sol, sans position, position de plus de 120 s ou hors de la zone d’affichage : écarté', () => {
    const ac = fixtureAc('3bf004');
    expect(normalizeMilAircraft({ ...ac, alt_baro: 'ground' }, SOURCE_NOW)).toBeNull();
    expect(normalizeMilAircraft({ ...ac, lat: undefined }, SOURCE_NOW)).toBeNull();
    expect(normalizeMilAircraft({ ...ac, seen_pos: 121 }, SOURCE_NOW)).toBeNull();
    expect(normalizeMilAircraft({ ...ac, lat: 52.5, lon: 13.4 }, SOURCE_NOW)).toBeNull();
    expect(normalizeMilAircraft({ ...ac, alt_baro: null }, SOURCE_NOW)?.altitudeFt).toBeNull();
  });
  it('adresse non OACI (« ~ ») : pays inconnu, famille « autres », appareil normalisé comme les autres avec son adresse et son immatriculation', () => {
    expect(normalizeMilAircraft({ ...fixtureAc('3bf004'), hex: '~3bf004' }, SOURCE_NOW))
      .toMatchObject({ hex: '~3bf004', callsign: 'FICTIF04', registration: 'F-ZFIC', country: null, family: 'autres', lat: 45.87, lon: 4.64 });
    expect(normalizeMilAircraft(fixtureAc('43c6f6'), SOURCE_NOW)).toMatchObject({ country: 'Royaume-Uni', family: 'autres' });
  });
  it('bits PIA (4) et LADD (8) de `dbFlags` : sans effet, l’appareil est normalisé avec son identité complète, quelle que soit la nation', () => {
    const ac = fixtureAc('43c6f6');
    const plain = normalizeMilAircraft(ac, SOURCE_NOW);
    for (const dbFlags of [5, 9, 13, '8', 1, 3, undefined, 'n.d.']) {
      const got = normalizeMilAircraft({ ...ac, dbFlags }, SOURCE_NOW);
      expect(got).toEqual(plain);
      expect(got).toMatchObject({ hex: '43c6f6', callsign: 'RRR2243', registration: 'ZZ999', type: 'A332', lat: 50.693059, lon: 1.625671 });
      for (const key of REMOVED_KEYS) expect(got).not.toHaveProperty(key);
    }
    expect(normalizeMilAircraft({ ...fixtureAc('3bf004'), dbFlags: 9 }, SOURCE_NOW)).toMatchObject({ hex: '3bf004', callsign: 'FICTIF04', registration: 'F-ZFIC', family: 'francais' });
  });
  it('heure UTC de l’historique', () => {
    expect(hourKey(SOURCE_NOW)).toBe('2026-10-04T14');
  });
});

describe('/api/sovereignty/military', () => {
  it('relevé réel du 04/10 : 9 aéronefs au-dessus de la France tous montrés (4 français d’abord, 5 autres) avec identité complète, 4 français aussi en compte par département, 3 hors de France, jamais 12', async () => {
    const log = stubReads(MIL());
    const { status, body, cache } = await callHandler<MilitaryResponse>(handler);
    expect([status, cache, body.errors]).toEqual([200, CACHE_CONTROL, []]);
    expect([body.readAt, body.sourceNow]).toEqual(['2026-10-04T14:48:30.000Z', '2026-10-04T14:48:24.501Z']);
    expect(body.frenchByDept).toEqual([{ dept: '13', count: 3 }, { dept: '69', count: 1 }]);
    expect(body.aircraft.map((a) => [a.hex, a.callsign, a.registration, a.type, a.country, a.family, a.dept])).toEqual([
      ['3bf001', 'FICTIF01', null, 'DH8D', 'France', 'francais', '13'], ['3bf002', 'FICTIF02', null, 'BE20', 'France', 'francais', '13'],
      ['3bf003', 'FICTIF03', null, 'A332', 'France', 'francais', '13'], ['3bf004', 'FICTIF04', 'F-ZFIC', 'EC45', 'France', 'francais', '69'],
      ['894081', 'BAH11', null, 'B738', 'Bahreïn', 'autres', '71'], ['c2b5b7', 'CFC2902', null, 'C30J', 'Canada', 'autres', '13'],
      ['44f684', 'GRZLY21', null, 'A400', 'Belgique', 'autres', '64'], ['43c6f6', 'RRR2243', 'ZZ999', 'A332', 'Royaume-Uni', 'autres', '62'],
      ['43c700', 'RRR2301', null, 'A332', 'Royaume-Uni', 'autres', '63'],
    ]);
    expect(body.aircraft.every((a) => Object.keys(a).sort().join() === SHOWN_AIRCRAFT_KEYS.join())).toBe(true);
    expect(counted(body)).toEqual({ francais: 4, autres: 5 });
    expect([body.abroadCount, body.abroad.map((a) => [a.hex, a.country, a.family])]).toEqual([3, [['c05325', 'Canada', 'autres'], ['ae1436', 'États-Unis', 'autres'], ['ae5719', 'États-Unis', 'autres']]]);
    expect(body.abroad.every((a) => Object.keys(a).sort().join() === SHOWN_ABROAD_KEYS.join())).toBe(true);
    expect([body.emergencies, body.emergencyLog]).toEqual([[], []]);
    expect(body.hourly).toEqual({ hours: [{ hour: '2026-10-04T14', francais: 4, autres: 5 }], since: '2026-10-04T14' });
    for (const key of REMOVED_KEYS) expect(body).not.toHaveProperty(key);
    expect(log.urls).toEqual([MIL_URL]);
    expect(sentHeader(log.inits[0], 'User-Agent')).toBe(SOURCE_USER_AGENT);
  });
  it('appareils français, PIA, LADD et adresses « ~ » montrés avec adresse, indicatif, immatriculation et position (décision du 08/10/2026), jamais masqués dans la réponse', async () => {
    const protectedRead = WITH_PROTECTED();
    const read: MilRead = { ...protectedRead, ac: [...protectedRead.ac, TILDE_FRANCE, TILDE_ABROAD] };
    stubReads(read);
    const { body } = await callHandler<MilitaryResponse>(handler);
    const text = JSON.stringify(body);
    const shown = [...body.aircraft, ...body.abroad];
    // Français du bloc OACI, autre nation PIA, français LADD et adresse « ~ » au-dessus de la France.
    for (const hex of ['3bf001', '3bf002', '3bf003', '3bf004', '43c6f6', '~3b0abc']) expect(body.aircraft.some((a) => a.hex === hex)).toBe(true);
    // LADD hors de France et adresse « ~ » hors de France : dessinés en gris avec leur identité.
    for (const hex of ['ae1436', '~4b0def']) expect(body.abroad.some((a) => a.hex === hex)).toBe(true);
    for (const [hex, callsign] of [['3bf004', 'FICTIF04'], ['43c6f6', 'RRR2243'], ['~3b0abc', 'FAF1234'], ['ae1436', 'FAZE37'], ['~4b0def', 'BAF0002']]) {
      expect(shown.find((a) => a.hex === hex)?.callsign).toBe(callsign);
    }
    expect(shown.find((a) => a.hex === '3bf004')).toMatchObject({ registration: 'F-ZFIC', family: 'francais', lat: 45.87, lon: 4.64 });
    expect(shown.find((a) => a.hex === '43c6f6')).toMatchObject({ registration: 'ZZ999', family: 'autres', lat: 50.693059, lon: 1.625671 });
    expect(shown.find((a) => a.hex === '~3b0abc')).toMatchObject({ country: null, family: 'autres', type: null, dept: '71' });
    // Immatriculation de chaque appareil lue dans le champ `r`, jamais inventée.
    for (const a of read.ac) {
      if (typeof a.r === 'string') expect(text).toContain(`"${a.r}"`);
      if (typeof a.flight === 'string' && a.flight.trim() && shown.some((s) => s.hex === a.hex)) expect(text).toContain(`"${a.flight.trim()}"`);
    }
    expect(shown.filter((a) => a.registration !== null).map((a) => [a.hex, a.registration])).toEqual([['3bf004', 'F-ZFIC'], ['43c6f6', 'ZZ999']]);
    for (const key of REMOVED_KEYS) expect(text).not.toContain(`"${key}"`);
  });
  it('PIA ou LADD : autre nation et français au-dessus de la France montrés comme les autres, hors de France dessinés avec leur identité ; les français restent comptés', async () => {
    stubReads(WITH_PROTECTED());
    const body = await ensureMilitaryFresh(T0);
    expect(body.aircraft.map((a) => a.hex)).toEqual(['3bf001', '3bf002', '3bf003', '3bf004', '894081', 'c2b5b7', '44f684', '43c6f6', '43c700']);
    expect(counted(body)).toEqual({ francais: 4, autres: 5 });
    expect(body.frenchByDept).toEqual([{ dept: '13', count: 3 }, { dept: '69', count: 1 }]);
    expect([body.abroadCount, body.abroad.map((a) => a.hex)]).toEqual([3, ['c05325', 'ae1436', 'ae5719']]);
    expect(body.abroad.find((a) => a.hex === 'ae1436')).toEqual({
      hex: 'ae1436', callsign: 'FAZE37', registration: null, type: 'GLF5', country: 'États-Unis', family: 'autres', lat: 51.372908, lon: -0.572662,
    });
    expect(body.hourly.hours).toEqual([{ hour: '2026-10-04T14', francais: 4, autres: 5 }]);
    const text = JSON.stringify(body);
    for (const shown of ['"43c6f6"', '"RRR2243"', '"ZZ999"', '"ae1436"', '"FAZE37"', '"3bf004"', '"F-ZFIC"']) expect(text).toContain(shown);
  });
  it('adresse non OACI (« ~ ») : nationalité inconnue, famille « autres » ; au-dessus de la France montrée avec son adresse et son indicatif, hors de France dessinée et comptée dans abroadCount', async () => {
    stubReads(reading(0, [TILDE_FRANCE, TILDE_ABROAD]));
    const body = await ensureMilitaryFresh(T0);
    expect(body.aircraft.map((a) => a.hex)).toEqual(['3bf001', '3bf002', '3bf003', '3bf004', '894081', 'c2b5b7', '~3b0abc', '44f684', '43c6f6', '43c700']);
    expect(body.aircraft.find((a) => a.hex === '~3b0abc')).toEqual({
      hex: '~3b0abc', callsign: 'FAF1234', registration: null, type: null, country: null, family: 'autres', lat: 46.5, lon: 4.8, dept: '71',
      altitudeFt: 12000, speedKt: 300, track: 90, seenAt: '2026-10-04T14:48:24.001Z',
    });
    expect(body.frenchByDept).toEqual([{ dept: '13', count: 3 }, { dept: '69', count: 1 }]);
    expect(counted(body)).toEqual({ francais: 4, autres: 6 });
    expect([body.abroadCount, body.abroad.map((a) => a.hex)]).toEqual([4, ['c05325', 'ae1436', 'ae5719', '~4b0def']]);
    expect(body.abroad.find((a) => a.hex === '~4b0def')).toEqual({
      hex: '~4b0def', callsign: 'BAF0002', registration: null, type: null, country: null, family: 'autres', lat: 50.85, lon: 4.35,
    });
    expect(body.hourly.hours).toEqual([{ hour: '2026-10-04T14', francais: 4, autres: 6 }]);
  });
  it('urgence d’une adresse non OACI : montrée comme celle de tout appareil (adresse, indicatif, position), épisode fusionné au journal avec son identité complète', async () => {
    const tilde7700: Ac = { ...TILDE_FRANCE, squawk: '7700', emergency: 'general' };
    stubReads(reading(0, [tilde7700]), reading(120, [tilde7700]));
    await ensureMilitaryFresh(T0);
    vi.setSystemTime(T0 + MIL_INTERVAL_MS);
    const body = await ensureMilitaryFresh(T0 + MIL_INTERVAL_MS);
    const expected = {
      icao24: '~3b0abc', callsign: 'FAF1234', registration: null, squawk: '7700', lat: 46.5, lon: 4.8, altitudeM: 3658,
      firstSeen: '2026-10-04T14:48:24.501Z', lastSeen: '2026-10-04T14:50:24.501Z', overFrance: true, family: 'autres', type: null,
      country: null, emergency: 'general', inFrance: true, dept: '71',
    };
    expect(body.emergencies).toEqual([expected]);
    expect(body.emergencyLog).toEqual([expected]);
    expect(Object.keys(body.emergencyLog[0]).sort()).toEqual(SHOWN_EMERGENCY_KEYS);
    expect(JSON.stringify(body)).toContain('"~3b0abc"');
    const stored = await readLog<Record<string, unknown>>(MIL_EMERGENCY_KEY, { dateOf: (e) => String(e.lastSeen), maxAgeMs: 7 * 86_400_000, now: T0 + MIL_INTERVAL_MS });
    expect(stored).toEqual([expected]);
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
  it('historique horaire : des comptes seulement dans le stockage clé-valeur, ni adresse ni immatriculation (appareils français, PIA et LADD compris), même si la réponse les montre', async () => {
    const writes: Array<[string, string]> = [];
    __setKvClientForTests({ get: async () => null, set: async (k: string, v: string) => { writes.push([k, v]); } });
    const read = WITH_PROTECTED();
    stubReads(read);
    const body = await ensureMilitaryFresh(T0);
    expect(body.hourly.hours).toEqual([{ hour: '2026-10-04T14', francais: 4, autres: 5 }]);
    const hourly = writes.filter(([k]) => k === MIL_HOURLY_KEY).map(([, v]) => v);
    expect(hourly).toEqual([JSON.stringify([{ hour: '2026-10-04T14', francais: 4, autres: 5 }])]);
    expect(JSON.stringify(body)).toContain('"3bf004"');
    for (const hidden of ['3bf004', '43c6f6', 'ae1436', 'F-ZFIC', 'ZZ999', 'FICTIF04']) expect(hourly.join()).not.toContain(hidden);
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
    expect(first.emergencies.map((e) => [e.icao24, e.squawk, e.firstSeen, e.lastSeen])).toEqual([['ae0805', '7700', '2026-10-04T14:48:24.501Z', '2026-10-04T14:48:24.501Z']]);
    vi.setSystemTime(T0 + MIL_INTERVAL_MS);
    const second = await ensureMilitaryFresh(T0 + MIL_INTERVAL_MS);
    expect(second.emergencies.map((e) => [e.icao24, e.callsign, e.squawk, e.firstSeen, e.lastSeen, e.overFrance, e.inFrance, e.dept, e.country]))
      .toEqual([
        ['ae0805', 'RCH161', '7700', '2026-10-04T14:48:24.501Z', '2026-10-04T14:50:24.501Z', true, true, '29', 'États-Unis'],
        ['4b1a2c', 'SUI7500', '7500', '2026-10-04T14:50:24.501Z', '2026-10-04T14:50:24.501Z', true, false, null, 'Suisse'],
      ]);
    expect(second.emergencies[1]).toEqual({
      icao24: '4b1a2c', callsign: 'SUI7500', registration: null, squawk: '7500', lat: 46.204, lon: 6.143, altitudeM: 2743,
      firstSeen: '2026-10-04T14:50:24.501Z', lastSeen: '2026-10-04T14:50:24.501Z', overFrance: true, family: 'autres', type: 'PC21',
      country: 'Suisse', emergency: 'unlawful', inFrance: false, dept: null,
    });
    // Le C-17 au-dessus du Finistère entre dans le compte V2 ; l'appareil au-dessus de Genève reste hors de France.
    expect([counted(second), second.abroadCount]).toEqual([{ francais: 4, autres: 6 }, 4]);
    expect(second.emergencyLog.map((e) => e.icao24)).toEqual(['ae0805', '4b1a2c']);
  });
  it('urgences d’un appareil français et d’une autre nation PIA (décision du 08/10/2026) : identité complète montrée (adresse, indicatif, immatriculation, type, position) ; épisode fusionné par l’adresse au journal du serveur', async () => {
    const drago7700: Ac = { ...fixtureAc('3bf004'), squawk: '7700', emergency: 'general' };
    const grizzlyPia7500: Ac = { ...fixtureAc('44f684'), dbFlags: 5, squawk: '7500', emergency: 'unlawful' };
    stubReads(reading(0, [drago7700]), reading(120, [drago7700, grizzlyPia7500]));
    await ensureMilitaryFresh(T0);
    vi.setSystemTime(T0 + MIL_INTERVAL_MS);
    const body = await ensureMilitaryFresh(T0 + MIL_INTERVAL_MS);
    const grizzly = {
      icao24: '44f684', callsign: 'GRZLY21', registration: null, squawk: '7500', lat: 43.381472, lon: -0.468554, altitudeM: 427,
      firstSeen: '2026-10-04T14:50:24.501Z', lastSeen: '2026-10-04T14:50:24.501Z', overFrance: true, family: 'autres', type: 'A400',
      country: 'Belgique', emergency: 'unlawful', inFrance: true, dept: '64',
    };
    const drago = {
      icao24: '3bf004', callsign: 'FICTIF04', registration: 'F-ZFIC', squawk: '7700', lat: 45.87, lon: 4.64, altitudeM: 160,
      firstSeen: '2026-10-04T14:48:24.501Z', lastSeen: '2026-10-04T14:50:24.501Z', overFrance: true, family: 'francais', type: 'EC45',
      country: 'France', emergency: 'general', inFrance: true, dept: '69',
    };
    expect(body.emergencies).toEqual([grizzly, drago]);
    expect(body.emergencyLog).toEqual([drago, grizzly]);
    expect([...body.emergencies, ...body.emergencyLog].every((e) => Object.keys(e).sort().join() === SHOWN_EMERGENCY_KEYS.join())).toBe(true);
    const text = JSON.stringify(body);
    for (const shown of ['"3bf004"', '"FICTIF04"', '"F-ZFIC"', '"44f684"', '"GRZLY21"', '"EC45"', '"A400"', '45.87']) expect(text).toContain(shown);
    // Journal du serveur : même identité complète que celle servie (première vue gardée par l'adresse).
    const stored = await readLog<Record<string, unknown>>(MIL_EMERGENCY_KEY, { dateOf: (e) => String(e.lastSeen), maxAgeMs: 7 * 86_400_000, now: T0 + MIL_INTERVAL_MS });
    expect(stored).toEqual([drago, grizzly]);
    expect(stored.every((e) => !('masked' in e))).toBe(true);
  });
  it('journal d’urgences d’un ancien format masqué (sans position, avec `masked`) : entrée plus servie, les entrées à identité complète le sont', async () => {
    const legacy = {
      icao24: '3bf004', squawk: '7700', firstSeen: '2026-10-03T10:00:00.000Z', lastSeen: '2026-10-03T10:02:00.000Z', overFrance: true, masked: true,
      family: 'francais', emergency: 'general', inFrance: true, dept: '69',
    };
    await kvSetJson(MIL_EMERGENCY_KEY, [legacy], 7 * 86_400, T0);
    stubReads(reading(0, [RCH161_7700]));
    const body = await ensureMilitaryFresh(T0);
    expect(body.emergencyLog.map((e) => e.icao24)).toEqual(['ae0805']);
    expect(body.emergencies.map((e) => e.icao24)).toEqual(['ae0805']);
    expect(JSON.stringify(body)).not.toContain('"masked"');
  });
  it('code des urgences : transpondeur d’abord, sinon champ `emergency` ramené à un code ; au sol jamais ; appareil français avec son identité', () => {
    const base = fixtureAc('3bf004');
    const list = [
      { ...base, hex: '3b0001', squawk: '1234', emergency: 'nordo' },
      { ...base, hex: '3b0002', squawk: '7700', emergency: 'none' },
      { ...base, hex: '3b0003', squawk: '7500', emergency: 'general' },
      { ...base, hex: '3b0004', squawk: '1234', emergency: 'minfuel' },
      { ...base, hex: '3b0005', squawk: '7700', alt_baro: 'ground' },
      { ...base, hex: '3b0006', squawk: '2000', emergency: 'none' },
    ];
    const got = militaryEmergenciesFrom(list, '2026-10-04T14:48:24.501Z');
    expect(got.map((e) => [e.icao24, e.squawk, e.emergency])).toEqual([
      ['3b0001', '7600', 'nordo'], ['3b0002', '7700', null], ['3b0003', '7500', 'general'], ['3b0004', '7700', 'minfuel'],
    ]);
    expect(got.every((e) => e.callsign === 'FICTIF04' && e.registration === 'F-ZFIC' && e.family === 'francais' && e.lat === 45.87 && e.lon === 4.64)).toBe(true);
    expect(got.some((e) => 'masked' in e)).toBe(false);
  });
  it('à la frontière : Genève et Solent hors de France, en mer à 7,7 km de Marseille en France (sans département, compté en dernier)', async () => {
    const marseille: Ac = { ...GENEVE_7500, hex: '3b0010', flight: 'FAF0001 ', squawk: '2000', emergency: 'none', lat: 43.2, lon: 5.25 };
    stubReads(reading(0, [{ ...GENEVE_7500, squawk: '2000', emergency: 'none' }, marseille]));
    const body = await ensureMilitaryFresh(T0);
    expect(body.frenchByDept).toEqual([{ dept: '13', count: 3 }, { dept: '69', count: 1 }, { dept: null, count: 1 }]);
    expect(body.abroad.map((a) => a.hex)).toEqual(['c05325', 'ae1436', 'ae5719', '4b1a2c']);
    expect([counted(body), body.abroadCount]).toEqual([{ francais: 5, autres: 5 }, 4]);
    // L'appareil du bloc France en mer est montré comme les autres, sans département.
    expect(body.aircraft.find((a) => a.hex === '3b0010')).toMatchObject({ callsign: 'FAF0001', family: 'francais', dept: null, lat: 43.2, lon: 5.25 });
  });
  it('en Italie à 1 km de la frontière (Clavière, au-dessus de Montgenèvre) : hors de France, dessiné en gris, jamais compté', async () => {
    const claviere: Ac = { ...GENEVE_7500, hex: '33ff01', flight: 'IAM0001 ', t: 'M346', squawk: '2000', emergency: 'none', lat: 44.94, lon: 6.77 };
    stubReads(reading(0, [claviere]));
    const body = await ensureMilitaryFresh(T0);
    expect(body.abroad.find((a) => a.hex === '33ff01')).toEqual({
      hex: '33ff01', callsign: 'IAM0001', registration: null, type: 'M346', country: 'Italie', family: 'autres', lat: 44.94, lon: 6.77,
    });
    expect(body.aircraft.some((a) => a.hex === '33ff01')).toBe(false);
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
    expect([status, cache, body.readAt, body.frenchByDept, body.aircraft, body.abroad]).toEqual([502, 'no-store', null, [], [], []]);
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
