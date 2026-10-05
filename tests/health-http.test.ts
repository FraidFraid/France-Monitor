import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import {
  HEALTH_USER_AGENT, HealthFetchError, cachedSource, cleanText, fetchStrictHtml, fetchStrictJson, fetchStrictXml, formatTimeoutMs,
  handlePreflight, isChallengePage, sendHealthJson, sourceError,
} from '../api/_lib/health-http.js';
import { fakeRes, fixtureText, respond, stubFetch } from './helpers/health-fixtures.ts';

const URL_ODISSE = 'https://odisse.santepubliquefrance.fr/api/explore/v2.1/catalog/datasets/x/records?limit=100';

beforeEach(() => { __resetSwrCacheForTests(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

async function failure(promise: Promise<unknown>): Promise<HealthFetchError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(HealthFetchError);
    return err as HealthFetchError;
  }
  throw new Error('aucune erreur levée');
}

describe('lecture stricte', () => {
  it('JSON 200 lu, User-Agent fixe envoyé', async () => {
    const { inits } = stubFetch(() => respond(fixtureText('odisse-meta-ira-france.json')));
    const json = (await fetchStrictJson(URL_ODISSE)) as { metas: { default: { data_processed: string } } };
    expect(json.metas.default.data_processed).toBe('2026-09-30T10:00:20+00:00');
    expect((inits[0]?.headers as Record<string, string>)['User-Agent']).toBe(HEALTH_USER_AGENT);
  });
  it.each([400, 429, 500])('HTTP %i : erreur, le corps d’erreur n’est jamais rendu comme un succès', async (status) => {
    stubFetch(() => respond(fixtureText('odisse-400.json'), status));
    const err = await failure(fetchStrictJson(URL_ODISSE));
    expect(err).toMatchObject({ kind: 'http', status, message: `HTTP ${status}` });
  });
  it('page de captcha servie en 200 à la place du JSON ou du HTML attendu : erreur « anti-robot »', async () => {
    stubFetch(() => respond(fixtureText('dgs-captcha.html')));
    expect((await failure(fetchStrictJson(URL_ODISSE))).kind).toBe('challenge');
    expect((await failure(fetchStrictHtml('https://sante.gouv.fr/x'))).kind).toBe('challenge');
    stubFetch(() => respond(fixtureText('request-rejected.html')));
    expect((await failure(fetchStrictHtml('https://sante.gouv.fr/x'))).kind).toBe('challenge');
  });
  it('page HTML ordinaire à la place de JSON ou de XML : erreur', async () => {
    stubFetch(() => respond(fixtureText('ansm-disponibilites.html')));
    expect((await failure(fetchStrictJson(URL_ODISSE))).kind).toBe('html');
    expect((await failure(fetchStrictXml('https://www.sentiweb.fr/rss/fr/fr'))).kind).toBe('html');
  });
  it('XML attendu mais JSON reçu, JSON illisible, corps vide : erreur', async () => {
    stubFetch(() => respond('{"a":1}'));
    expect((await failure(fetchStrictXml('https://www.sentiweb.fr/rss/fr/fr'))).kind).toBe('parse');
    stubFetch(() => respond('{"a":'));
    expect((await failure(fetchStrictJson(URL_ODISSE))).kind).toBe('parse');
    stubFetch(() => respond('   '));
    expect((await failure(fetchStrictJson(URL_ODISSE))).kind).toBe('empty');
  });
  it('délai dépassé et panne réseau : erreur typée', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('trop long', 'TimeoutError'); }));
    expect((await failure(fetchStrictJson(URL_ODISSE, { timeoutMs: 10 }))).kind).toBe('timeout');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect((await failure(fetchStrictJson(URL_ODISSE))).kind).toBe('network');
  });
  it('« captcha » seul : défi dans un corps HTML seulement (un JSON ou un flux qui cite le mot n’en est pas un)', async () => {
    expect(isChallengePage('{"value":[{"Summary":"A captcha-protected portal"}]}')).toBe(false);
    expect(isChallengePage('<?xml version="1.0"?><rss><channel><item><title>captcha</title></item></channel></rss>')).toBe(false);
    expect(isChallengePage('<!DOCTYPE html><html><body><div class="g-recaptcha"></div></body></html>')).toBe(true);
    stubFetch(() => respond('{"value":[{"Summary":"captcha"}]}'));
    expect(await fetchStrictJson(URL_ODISSE)).toEqual({ value: [{ Summary: 'captcha' }] });
  });
  it('page de défi servie en 403 ou 429 : erreur « anti-robot » ; 429 ordinaire : HTTP 429', async () => {
    stubFetch(() => respond(fixtureText('dgs-captcha.html'), 403));
    expect(await failure(fetchStrictHtml('https://sante.gouv.fr/x'))).toMatchObject({ kind: 'challenge', status: 403, message: 'page de contrôle anti-robot (HTTP 403)' });
    stubFetch(() => respond(fixtureText('request-rejected.html'), 429));
    expect((await failure(fetchStrictHtml('https://sante.gouv.fr/x'))).kind).toBe('challenge');
    stubFetch(() => respond('Too Many Requests', 429));
    expect(await failure(fetchStrictJson(URL_ODISSE))).toMatchObject({ kind: 'http', status: 429, message: 'HTTP 429' });
  });
  it('délai dépassé ou coupure pendant la lecture du corps : erreur typée, message en français', async () => {
    const body = (err: Error) => vi.fn(async () => ({ ok: true, status: 200, text: async () => { throw err; } }));
    vi.stubGlobal('fetch', body(new DOMException('The operation was aborted due to timeout', 'TimeoutError')));
    expect(await failure(fetchStrictJson(URL_ODISSE, { timeoutMs: 10 }))).toMatchObject({ kind: 'timeout', message: 'délai dépassé (10\u00a0ms)' });
    vi.stubGlobal('fetch', body(new TypeError('terminated')));
    expect(await failure(fetchStrictJson(URL_ODISSE))).toMatchObject({ kind: 'network', message: 'réseau : lecture de la réponse interrompue' });
  });
  it('délai dit « 30 000 ms », jamais « 30000 ms » : séparateur de milliers et unité insécables (revue finale M12)', async () => {
    expect([formatTimeoutMs(10), formatTimeoutMs(15_000), formatTimeoutMs(30_000)]).toEqual(['10\u00a0ms', '15\u202f000\u00a0ms', '30\u202f000\u00a0ms']);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); }));
    expect((await failure(fetchStrictJson(URL_ODISSE, { timeoutMs: 30_000 }))).message).toBe('délai dépassé (30\u202f000\u00a0ms)');
  });
  it('les pages réelles lues par les gestionnaires ne sont pas prises pour des défis', () => {
    for (const name of ['peps-actualites.html', 'spf-ocean-indien.html', 'spf-bulletin-reunion.html', 'ansm-disponibilites.html', 'sentiweb-rss.xml']) {
      expect(isChallengePage(fixtureText(name))).toBe(false);
    }
  });
  it('aucun repli curl', () => {
    const source = readFileSync(new URL('../api/_lib/health-http.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/child_process|execFile|spawn\(/);
    expect(source).not.toContain('\uFEFF');
  });
});

describe('textes, cache et réponses', () => {
  it('cleanText : balises, entités, espaces ; tiret cadratin remplacé', () => {
    expect(cleanText('<p>Tension d&#039;approvisionnement&nbsp;<b>x</b></p>')).toBe('Tension d\'approvisionnement x');
    expect(cleanText('Alerte \u2014 cluster')).toBe('Alerte : cluster');
    expect(cleanText('A&mdash;B &#8212; C')).toBe('A : B : C');
  });
  it('sourceError', () => {
    expect(sourceError('Odissé, IRA France', new HealthFetchError('HTTP 429'))).toBe('Odissé, IRA France : HTTP 429');
  });
  it('cachedSource : une seule lecture tant que frais ; valeur connue servie si la relecture échoue ; lève sans valeur connue', async () => {
    const producer = vi.fn(async () => ({ v: 1 }));
    expect(await cachedSource('t1', { ttlSec: 3600 }, producer)).toEqual({ v: 1 });
    expect(await cachedSource('t1', { ttlSec: 3600 }, producer)).toEqual({ v: 1 });
    expect(producer).toHaveBeenCalledTimes(1);
    await cachedSource('t2', { ttlSec: 0, staleSec: 3600 }, async () => ({ v: 2 }));
    expect(await cachedSource('t2', { ttlSec: 0, staleSec: 3600 }, async () => { throw new Error('HTTP 500'); })).toEqual({ v: 2 });
    await expect(cachedSource('t3', { ttlSec: 3600 }, async () => { throw new Error('HTTP 500'); })).rejects.toThrow('HTTP 500');
  });
  it('panne amont mémorisée 5 min par source : l’amont n’est pas relancé à chaque requête ; valeur connue servie entre-temps', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.parse('2026-10-03T08:00:00Z');
    vi.setSystemTime(t0);
    const failing = vi.fn(async () => { throw new HealthFetchError('HTTP 429', { kind: 'http', status: 429 }); });
    await expect(cachedSource('neg1', { ttlSec: 3600 }, failing)).rejects.toThrow('HTTP 429');
    vi.setSystemTime(t0 + 4 * 60_000);
    await expect(cachedSource('neg1', { ttlSec: 3600 }, failing)).rejects.toThrow('HTTP 429');
    expect(failing).toHaveBeenCalledTimes(1);
    vi.setSystemTime(t0 + 5 * 60_000 + 1_000);
    await expect(cachedSource('neg1', { ttlSec: 3600 }, failing)).rejects.toThrow('HTTP 429');
    expect(failing).toHaveBeenCalledTimes(2);

    vi.setSystemTime(t0);
    expect(await cachedSource('neg2', { ttlSec: 60 }, async () => ({ v: 1 }))).toEqual({ v: 1 });
    vi.setSystemTime(t0 + 2 * 60_000);
    const down = vi.fn(async () => { throw new HealthFetchError('HTTP 503', { kind: 'http', status: 503 }); });
    expect(await cachedSource('neg2', { ttlSec: 60 }, down)).toEqual({ v: 1 });
    vi.setSystemTime(t0 + 4 * 60_000);
    expect(await cachedSource('neg2', { ttlSec: 60 }, down)).toEqual({ v: 1 });
    expect(down).toHaveBeenCalledTimes(1);
  });
  it('OPTIONS : 204 ; POST : 405 ; GET : laisse passer', () => {
    const r1 = fakeRes();
    expect(handlePreflight({ method: 'OPTIONS' }, r1)).toBe(true);
    expect(r1.statusCode).toBe(204);
    const r2 = fakeRes();
    expect(handlePreflight({ method: 'POST' }, r2)).toBe(true);
    expect(r2.statusCode).toBe(405);
    expect(handlePreflight({ method: 'GET' }, fakeRes())).toBe(false);
  });
  it('sendHealthJson : 200 avec cache, ou 502 non mis en cache', () => {
    const ok = fakeRes();
    sendHealthJson(ok, { a: 1 }, { ok: true, cacheControl: 's-maxage=60' });
    expect([ok.statusCode, ok.headers['Cache-Control']]).toEqual([200, 's-maxage=60']);
    const ko = fakeRes();
    sendHealthJson(ko, { errors: ['x'] }, { ok: false, cacheControl: 's-maxage=60' });
    expect([ko.statusCode, ko.headers['Cache-Control'], ko.body]).toEqual([502, 'no-store', { errors: ['x'] }]);
  });
  it('réponse partielle (errors non vide) : cache CDN court, une source rétablie arrive vite', () => {
    const partial = fakeRes();
    sendHealthJson(partial, { a: 1, errors: ['OMS, Disease Outbreak News : HTTP 500'] }, { ok: true, cacheControl: 's-maxage=3600' });
    expect([partial.statusCode, partial.headers['Cache-Control']]).toEqual([200, 's-maxage=300, stale-while-revalidate=600']);
  });
  it('réponse partielle d’une route au cache déjà plus court (panneau aérien, 60 s) : son cache est gardé, jamais allongé à 5 min', () => {
    const air = fakeRes();
    sendHealthJson(air, { a: 1, errors: ['Annuaire Bordeaux Mérignac : HTTP 503'] }, { ok: true, cacheControl: 's-maxage=60, stale-while-revalidate=120' });
    expect(air.headers['Cache-Control']).toBe('s-maxage=60, stale-while-revalidate=120');
    // Routes Santé (1800 s et plus) : inchangées, la réponse partielle passe à 5 min.
    for (const cacheControl of ['s-maxage=1800, stale-while-revalidate=300', 's-maxage=21600, stale-while-revalidate=86400']) {
      const res = fakeRes();
      sendHealthJson(res, { errors: ['x'] }, { ok: true, cacheControl });
      expect(res.headers['Cache-Control']).toBe('s-maxage=300, stale-while-revalidate=600');
    }
    const complete = fakeRes();
    sendHealthJson(complete, { errors: [] }, { ok: true, cacheControl: 's-maxage=60, stale-while-revalidate=120' });
    expect(complete.headers['Cache-Control']).toBe('s-maxage=60, stale-while-revalidate=120');
  });
});
