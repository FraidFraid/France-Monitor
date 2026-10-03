import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import {
  HEALTH_USER_AGENT, HealthFetchError, cachedSource, cleanText, fetchStrictHtml, fetchStrictJson, fetchStrictXml,
  handlePreflight, isChallengePage, sendHealthJson, sourceError,
} from '../api/_lib/health-http.js';
import { fakeRes, fixtureText, respond, stubFetch } from './helpers/health-fixtures.ts';

const URL_ODISSE = 'https://odisse.santepubliquefrance.fr/api/explore/v2.1/catalog/datasets/x/records?limit=100';

beforeEach(() => { __resetSwrCacheForTests(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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
  it('les pages réelles lues par les gestionnaires ne sont pas prises pour des défis', () => {
    for (const name of ['peps-actualites.html', 'spf-ocean-indien.html', 'spf-bulletin-reunion.html', 'ansm-disponibilites.html', 'sentiweb-rss.xml']) {
      expect(isChallengePage(fixtureText(name))).toBe(false);
    }
  });
  it('aucun repli curl', () => {
    const source = readFileSync(new URL('../api/_lib/health-http.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/child_process|execFile|spawn\(/);
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
});
