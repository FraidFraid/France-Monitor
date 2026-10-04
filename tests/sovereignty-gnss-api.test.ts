// tests/sovereignty-gnss-api.test.ts : collecte de la grille GNSS et route /api/sovereignty/gnss (spec 2026-10-04 souveraineté § 3.1 ;
// contrats § 2.5, arbitrages 2, 33, 34 ; amendement 7, O16 et O17). Les lectures adsb.lol passent par la vraie file unique de la tâche
// A2 (6 s d'écart, recul de 10 min sur 429) : horloge simulée. Un 429 au troisième appel arrête le cycle, la dernière
// grille complète reste servie avec sa date, aucun appel pendant le recul. O17 : les mailles localisées servies sont celles du jour UTC
// précédent seulement, et seulement s'il est couvert ; en direct, un compte glissant de 24 h sans lieu.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { __resetKvForTests, __setKvClientForTests, kvGetJson, kvSetJson } from '../api/_lib/kv-history.js';
import { __resetAdsbLolForTests, adsbLolBlockedUntil } from '../api/_lib/adsb-lol.js';
import {
  GNSS_CONSTRUCTION_NOTE, GNSS_DAYS_KEY, GNSS_LAST_KEY, GNSS_PENDING_NOTE, GNSS_POINTS, GNSS_TOO_OLD_ERROR, __resetGnssForTests,
  emptyGnssBody, ensureGnssFresh, isGnssDue, pointPath, storedGnss,
} from '../api/_lib/gnss-collect.js';
import { NOAA_ALERTS_URL, NOAA_KP_URL, NOAA_SCALES_URL } from '../api/_lib/noaa-swpc.js';
import handler, { CACHE_CONTROL, PENDING_CACHE_CONTROL } from '../api/_handlers/sovereignty/gnss.js';
import type { GnssResponse } from '../src/types/index.ts';
import { type FakeResponse, callHandler, fakeRes, respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/sovereignty/${name}`, import.meta.url), 'utf8');
const UA = 'FranceMonitor/1.0 (+https://www.francemonitor.com)';
const T0 = Date.parse('2026-10-04T14:50:00Z');
const MIN = 60_000;
type GnssBody = Omit<GnssResponse, 'spaceWeather'>;
/** Champs de GnssResponse, ni plus ni moins (la garde du client refuse un champ en trop). */
const RESPONSE_KEYS = [
  'aircraft', 'cells', 'cellsDay', 'days', 'degraded', 'errors', 'frenchCells', 'generalDegradation', 'readAt', 'reads', 'spaceWeather', 'windowStart',
];

/** Avance l'horloge simulée seconde par seconde jusqu'à ce que la promesse se règle (attentes de la file adsb.lol, échéance de la route). */
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  let value: T | undefined;
  let failure: unknown;
  let failed = false;
  p.then((v) => { done = true; value = v; }, (e: unknown) => { done = true; failed = true; failure = e; });
  for (let i = 0; i < 300 && !done; i += 1) await vi.advanceTimersByTimeAsync(1_000);
  if (!done) throw new Error('promesse non réglée après 300 s simulées');
  if (failed) throw failure;
  return value as T;
}

interface Calls { adsb: Array<{ url: string; at: number; ua: string | undefined }> }
/**
 * Sources simulées : lectures /v2/point alternées (ouest, sud-est), NOAA réel ; `point(n, url)` peut remplacer la n-ième lecture
 * adsb.lol (adresse lue fournie).
 */
function sources(point: (n: number, url: string) => FakeResponse | null = () => null, noaa: (url: string) => FakeResponse | null = () => null): Calls {
  const calls: Calls = { adsb: [] };
  stubFetch((url, init) => {
    if (url.startsWith('https://api.adsb.lol/')) {
      calls.adsb.push({ url, at: Date.now(), ua: sentHeader(init, 'User-Agent') });
      return point(calls.adsb.length, url) ?? respond(fx(calls.adsb.length % 2 === 1 ? 'adsb-lol-point-ouest.json' : 'adsb-lol-point-sud-est.json'));
    }
    const n = noaa(url);
    if (n) return n;
    if (url === NOAA_SCALES_URL) return respond(fx('noaa-scales.json'));
    if (url === NOAA_KP_URL) return respond(fx('noaa-planetary-k-index.json'));
    if (url === NOAA_ALERTS_URL) return respond(fx('noaa-alerts-reduit.json'));
    return respond('introuvable', 404);
  });
  return calls;
}

/** n aéronefs distincts en vol dans la maille de coin sud-ouest (lat, lon), même précision déclarée. */
function fill(prefix: string, lat: number, lon: number, n: number, nacP: number): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_v, i) => ({ hex: `${prefix}${String(i).padStart(3, '0')}`, lat: lat + 0.2, lon: lon + 0.2, alt_baro: 30_000, seen_pos: 1, nac_p: nacP }));
}
/**
 * Lecture construite, la même à chaque appel, datée par l'horloge simulée : une maille bretonne à 15 % (16 bons, 4 dégradés : orange)
 * et quatre mailles françaises vertes (20 bons) ; 1 maille orange sur 5 mesurées : pas de dégradation générale, même avec Kp 5.
 */
const BRETAGNE = [...fill('bz', 48, -3.5, 16, 9), ...fill('dz', 48, -3.5, 4, 5)];
const GREEN = [[48, 2], [47.5, 1.5], [46, 3], [45, 5]].flatMap(([lat, lon], i) => fill(`v${i}-`, lat, lon, 20, 10));
const builtRead = (): FakeResponse => respond({ ac: [...BRETAGNE, ...GREEN], msg: 'No error', now: Date.now(), total: BRETAGNE.length + GREEN.length });
const BUILT_CELLS = [
  { lat: 48, lon: -3.5, good: 16, degraded: 4, unknown: 0, pct: 15, level: 'orange', inFrance: true },
  { lat: 48, lon: 2, good: 20, degraded: 0, unknown: 0, pct: 0, level: 'vert', inFrance: true },
  { lat: 47.5, lon: 1.5, good: 20, degraded: 0, unknown: 0, pct: 0, level: 'vert', inFrance: true },
  { lat: 46, lon: 3, good: 20, degraded: 0, unknown: 0, pct: 0, level: 'vert', inFrance: true },
  { lat: 45, lon: 5, good: 20, degraded: 0, unknown: 0, pct: 0, level: 'vert', inFrance: true },
];

/** Cycles toutes les 10 min de `from` à `to` compris (lecture construite) ; rend le corps de chaque cycle par instant. */
async function runCycles(from: number, to: number): Promise<Map<number, GnssBody>> {
  const out = new Map<number, GnssBody>();
  for (let t = from; t <= to; t += 10 * MIN) {
    vi.setSystemTime(t);
    out.set(t, await settle(ensureGnssFresh(t)));
  }
  return out;
}

beforeEach(() => {
  __resetSwrCacheForTests();
  __resetKvForTests();
  __resetAdsbLolForTests();
  __resetGnssForTests();
  __setKvClientForTests({ get: async () => null, set: async () => undefined });
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(T0);
});
afterEach(() => { __setKvClientForTests(null); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('cycle de collecte', () => {
  it('cinq lectures /v2/point, toujours à 6 s au moins l’une de l’autre, en-tête FranceMonitor ; grille complète datée, aucune maille du jour en cours', async () => {
    const calls = sources();
    const body = await settle(ensureGnssFresh(T0));
    expect(calls.adsb.map((c) => c.url)).toEqual(GNSS_POINTS.map((p) => `https://api.adsb.lol${pointPath(p)}`));
    expect(pointPath(GNSS_POINTS[1])).toBe('/v2/point/49.0/4.5/200');
    for (let i = 1; i < calls.adsb.length; i += 1) expect(calls.adsb[i].at - calls.adsb[i - 1].at).toBeGreaterThanOrEqual(6_000);
    expect(calls.adsb.every((c) => c.ua === UA)).toBe(true);
    expect([body.readAt, body.reads, body.aircraft, body.cells, body.cellsDay, body.frenchCells, body.generalDegradation, body.degraded])
      .toEqual(['2026-10-04T14:50:00.000Z', 5, 379, [], null, 0, false, { rolling24h: 0, previousUtcDays: [null, null] }]);
    expect(body.windowStart).toBe('2026-10-04T14:48:34.000Z');
    expect(body.errors).toEqual([GNSS_CONSTRUCTION_NOTE]);
    expect(body.days).toEqual({ days: [{ date: '2026-10-04', jaune: 0, orange: 0, general: false }], since: '2026-10-04' });
    expect(Object.keys(body).sort()).toEqual(RESPONSE_KEYS.filter((k) => k !== 'spaceWeather'));
  });
  it('cycle pas encore dû (moins de 9 min) : aucune lecture, grille gardée servie', async () => {
    sources();
    await settle(ensureGnssFresh(T0));
    const calls = sources();
    vi.setSystemTime(T0 + 8 * MIN);
    const body = await settle(ensureGnssFresh(T0 + 8 * MIN));
    expect([calls.adsb.length, body.readAt]).toEqual([0, '2026-10-04T14:50:00.000Z']);
    expect([isGnssDue(null, T0), isGnssDue(new Date(T0).toISOString(), T0 + 9 * MIN), isGnssDue(new Date(T0).toISOString(), T0 + 8 * MIN)])
      .toEqual([true, true, false]);
  });
  it('429 au troisième appel : cycle arrêté, dernière grille complète servie avec sa date, aucun appel pendant le recul', async () => {
    sources();
    await settle(ensureGnssFresh(T0));
    const T1 = T0 + 11 * MIN;
    vi.setSystemTime(T1);
    const calls = sources((n) => (n === 3 ? respond('<html><body>429 Too Many Requests</body></html>', 429) : null));
    const body = await settle(ensureGnssFresh(T1));
    expect(calls.adsb).toHaveLength(3);
    expect(body.readAt).toBe('2026-10-04T14:50:00.000Z');
    expect(body.errors[0]).toMatch(/^Grille GNSS, lecture 3 sur 5 : adsb\.lol : HTTP 429, nouvelle tentative après \d\d:\d\d$/);
    expect(Object.keys(body).sort()).toEqual(RESPONSE_KEYS.filter((k) => k !== 'spaceWeather'));
    const until = adsbLolBlockedUntil();
    expect(until).not.toBeNull();
    expect(until ?? 0).toBeGreaterThan(T1 + 9 * MIN);
    const stored = await kvGetJson(GNSS_LAST_KEY, Date.now()) as { readAt: string; attemptedAt: string };
    expect([stored.readAt, stored.attemptedAt]).toEqual(['2026-10-04T14:50:00.000Z', new Date(T1).toISOString()]);
    // Cycle de nouveau dû 9 min 50 s plus tard, mais adsb.lol est encore en recul : aucun appel, la panne dit jusqu'à quand.
    const T2 = T1 + 9 * MIN + 50_000;
    vi.setSystemTime(T2);
    const later = sources();
    const again = await settle(ensureGnssFresh(T2));
    const clock = new Date(until ?? 0).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
    expect(later.adsb).toHaveLength(0);
    expect(again.readAt).toBe('2026-10-04T14:50:00.000Z');
    expect(again.errors).toEqual([`Grille GNSS : adsb.lol en recul jusqu'à ${clock}, aucune lecture`]);
  });
  it('les lectures d’un cycle interrompu restent dans la fenêtre : le cycle complet suivant les compte', async () => {
    sources((n) => (n === 3 ? respond('erreur', 500) : null));
    const first = await settle(ensureGnssFresh(T0));
    expect([first.readAt, first.reads, first.errors]).toEqual([null, 0, ['Grille GNSS, lecture 3 sur 5 : adsb.lol : HTTP 500']]);
    vi.setSystemTime(T0 + 11 * MIN);
    sources();
    const body = await settle(ensureGnssFresh(T0 + 11 * MIN));
    expect([body.readAt, body.reads]).toEqual([new Date(T0 + 11 * MIN).toISOString(), 7]);
  });
  it('dernière grille complète de plus de 2 jours : plus servie, panne nommée (la note de construction d’une grille non servie disparaît)', async () => {
    sources();
    await settle(ensureGnssFresh(T0));
    // Enregistrement gardé plus longtemps que sa durée de vie normale, pour lire la règle des 2 jours elle-même.
    const record = await kvGetJson(GNSS_LAST_KEY, T0);
    await kvSetJson(GNSS_LAST_KEY, record, 7 * 86_400, T0);
    const body = await storedGnss(T0 + 2 * 86_400_000 + MIN, GNSS_PENDING_NOTE);
    expect([body.readAt, body.cells, body.errors]).toEqual([null, [], [GNSS_PENDING_NOTE, GNSS_TOO_OLD_ERROR]]);
    expect(emptyGnssBody()).toEqual({
      readAt: null, windowStart: null, reads: 0, aircraft: 0, cells: [], cellsDay: null, frenchCells: 0, generalDegradation: false,
      degraded: { rolling24h: 0, previousUtcDays: [null, null] }, days: { days: [], since: null }, errors: [],
    });
  });
});

describe('jour UTC précédent : mailles localisées et comptes sans lieu (O17)', () => {
  it('journée couverte : en direct, compte glissant sans lieu et jamais de maille du jour ; après minuit UTC, mailles de la veille et comptes des deux jours', async () => {
    sources(() => builtRead());
    // Avant-veille écrite par un processus précédent : couverte, 3 mailles orange, sans dégradation générale.
    const D = Date.parse('2026-10-04T00:05:00Z');
    await kvSetJson(GNSS_DAYS_KEY, [{ date: '2026-10-03', jaune: 2, orange: 3, general: false, covered: true }], 14 * 86_400, D);
    const bodies = await runCycles(D, D + 24 * 60 * MIN);
    const noon = bodies.get(D + 12 * 60 * MIN) as GnssBody;
    expect([noon.cells, noon.cellsDay, noon.frenchCells, noon.generalDegradation, noon.degraded])
      .toEqual([[], null, 0, false, { rolling24h: 1, previousUtcDays: [3, null] }]);
    expect(noon.days.days.at(-1)).toEqual({ date: '2026-10-04', jaune: 0, orange: 1, general: false });
    const next = bodies.get(D + 24 * 60 * MIN) as GnssBody;
    expect([next.cellsDay, next.frenchCells, next.generalDegradation, next.degraded, next.errors])
      .toEqual(['2026-10-04', 5, false, { rolling24h: 1, previousUtcDays: [1, 3] }, []]);
    expect(next.cells).toEqual(BUILT_CELLS);
    expect(next.days).toEqual({
      days: [
        { date: '2026-10-03', jaune: 2, orange: 3, general: false }, { date: '2026-10-04', jaune: 0, orange: 1, general: false },
        { date: '2026-10-05', jaune: 0, orange: 1, general: false },
      ],
      since: '2026-10-03',
    });
    // Redémarrage du processus : la fenêtre recommence, la veille reste servie depuis le stockage clé-valeur.
    __resetGnssForTests();
    const restart = D + 24 * 60 * MIN + 10 * MIN;
    vi.setSystemTime(restart);
    const after = await settle(ensureGnssFresh(restart));
    expect([after.cellsDay, after.cells, after.degraded, after.reads, after.errors])
      .toEqual(['2026-10-04', BUILT_CELLS, { rolling24h: 1, previousUtcDays: [1, 3] }, 5, [GNSS_CONSTRUCTION_NOTE]]);
  }, 60_000);
  it('jour non couvert (collecte commencée à midi) : ni mailles ni compte pour la veille ; le journal le garde, servi sans champ interne', async () => {
    sources(() => builtRead());
    const D = Date.parse('2026-10-04T12:05:00Z');
    const bodies = await runCycles(D, D + 12 * 60 * MIN);
    const next = bodies.get(D + 12 * 60 * MIN) as GnssBody;
    expect([next.cells, next.cellsDay, next.frenchCells, next.degraded])
      .toEqual([[], null, 0, { rolling24h: 1, previousUtcDays: [null, null] }]);
    expect(next.days.days.map((d) => Object.keys(d).sort())).toEqual([['date', 'general', 'jaune', 'orange'], ['date', 'general', 'jaune', 'orange']]);
    const log = await kvGetJson(GNSS_DAYS_KEY, Date.now()) as Array<{ date: string; covered: boolean }>;
    expect(log.map((e) => `${e.date}:${e.covered}`)).toEqual(['2026-10-05:false', '2026-10-04:false']);
  }, 60_000);
  it('cycle arrêté à la troisième lecture toute la journée : Sud-Ouest, Sud-Est et Corse jamais lus, jour non couvert, ni mailles ni compte pour la veille', async () => {
    const third = `https://api.adsb.lol${pointPath(GNSS_POINTS[2])}`;
    sources((_n, url) => (url === third ? respond('erreur', 500) : builtRead()));
    const D = Date.parse('2026-10-04T00:05:00Z');
    const failing = await runCycles(D, D + 23 * 60 * MIN + 50 * MIN);
    expect([...failing.values()].every((b) => b.readAt === null && b.errors[0] === 'Grille GNSS, lecture 3 sur 5 : adsb.lol : HTTP 500')).toBe(true);
    sources(() => builtRead());
    const midnight = D + 24 * 60 * MIN;
    const next = (await runCycles(midnight, midnight)).get(midnight) as GnssBody;
    expect([next.readAt === null, next.cells, next.cellsDay, next.frenchCells, next.degraded.previousUtcDays])
      .toEqual([false, [], null, 0, [null, null]]);
    const log = await kvGetJson(GNSS_DAYS_KEY, Date.now()) as Array<{ date: string; covered: boolean }>;
    expect(log.map((e) => `${e.date}:${e.covered}`)).toEqual(['2026-10-05:false', '2026-10-04:false']);
  }, 60_000);
});

describe('route GET /api/sovereignty/gnss', () => {
  it('premier appel : cycle plus long que l’échéance (24 s d’attente) : grille non encore lue, météo spatiale servie, note et cache court ; puis grille datée', async () => {
    sources();
    const first = await settle(callHandler<GnssResponse>(handler));
    expect([first.status, first.cache, first.body.readAt]).toEqual([200, PENDING_CACHE_CONTROL, null]);
    expect(first.body.errors).toContain(GNSS_PENDING_NOTE);
    expect(first.body.spaceWeather.scalesAt).toBe('2026-10-04T14:46:00.000Z');
    expect(Object.keys(first.body).sort()).toEqual(RESPONSE_KEYS);
    await settle(ensureGnssFresh(Date.now()));
    const second = await settle(callHandler<GnssResponse>(handler));
    expect([second.status, second.cache, second.body.readAt, second.body.spaceWeather.lastAlert?.productId])
      .toEqual([200, CACHE_CONTROL, '2026-10-04T14:50:00.000Z', 'K05A']);
    expect(second.body.errors).toEqual([GNSS_CONSTRUCTION_NOTE]);
    expect(Object.keys(second.body).sort()).toEqual(RESPONSE_KEYS);
  });
  it('rien n’a répondu (adsb.lol 500, NOAA 503) : 502 non mis en cache, même forme, pannes nommées', async () => {
    sources(() => respond('erreur', 500), () => respond('indisponible', 503));
    const res = await settle(callHandler<GnssResponse>(handler));
    expect([res.status, res.cache, res.body.readAt, res.body.spaceWeather.readAt, res.body.cells]).toEqual([502, 'no-store', null, null, []]);
    expect(res.body.errors.some((e) => /^Grille GNSS, lecture 1 sur 5 : /.test(e))).toBe(true);
    expect(res.body.errors).toContain('NOAA SWPC, échelles : HTTP 503');
    expect(Object.keys(res.body).sort()).toEqual(RESPONSE_KEYS);
  });
  it('méthode GET seulement ; aucun fetch direct dans les modules du lot', async () => {
    const res = fakeRes();
    await handler({ method: 'POST', query: {} }, res);
    expect(res.statusCode).toBe(405);
    for (const file of ['_lib/gnss-grid.js', '_lib/gnss-collect.js', '_lib/noaa-swpc.js', '_handlers/sovereignty/gnss.js']) {
      expect(readFileSync(new URL(`../api/${file}`, import.meta.url), 'utf8')).not.toMatch(/\bfetch\s*\(|['"]user-agent['"]/i);
    }
  });
});
