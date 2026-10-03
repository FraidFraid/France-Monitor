import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import * as health from '../api/_lib/health-http.js';
import {
  SOURCE_USER_AGENT, SourceFetchError, cachedSource, fetchStrictHtml, fetchStrictJson, fetchStrictResponse, fetchStrictXml, isChallengePage, sendSourceJson, sourceError,
} from '../api/_lib/source-http.js';
import { fakeRes, fixtureText, respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

const TOMTOM = 'https://api.tomtom.com/traffic/services/5/incidentDetails?key=CLE-SECRETE&bbox=4.70,45.62,4.86,45.86';

beforeEach(() => { __resetSwrCacheForTests(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function failure(promise: Promise<unknown>): Promise<InstanceType<typeof SourceFetchError>> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(SourceFetchError);
    return err as InstanceType<typeof SourceFetchError>;
  }
  throw new Error('aucune erreur levée');
}

describe('source-http : simple réexportation de la lecture stricte du lot Santé', () => {
  it('mêmes fonctions, noms neutres', () => {
    expect(SOURCE_USER_AGENT).toBe(health.HEALTH_USER_AGENT);
    expect(SourceFetchError).toBe(health.HealthFetchError);
    expect(fetchStrictJson).toBe(health.fetchStrictJson);
    expect(sendSourceJson).toBe(health.sendHealthJson);
  });
});

describe('en-têtes, méthode et en-têtes de réponse (OpenSky, SNCF)', () => {
  it('en-têtes ajoutés (Authorization), User-Agent identifiant jamais remplacé', async () => {
    const log = stubFetch(() => respond({ ok: 1 }));
    await fetchStrictJson('https://api.sncf.com/v1/coverage/sncf/disruptions', { headers: { Authorization: 'Basic eDo=', 'User-Agent': 'Mozilla/5.0' } });
    expect(sentHeader(log.inits[0], 'Authorization')).toBe('Basic eDo=');
    expect(sentHeader(log.inits[0], 'User-Agent')).toBe(SOURCE_USER_AGENT);
    expect(SOURCE_USER_AGENT).toBe('FranceMonitor/1.0 (+https://www.francemonitor.com)');
  });
  it('POST de formulaire (jeton OpenSky) : méthode et corps transmis', async () => {
    const log = stubFetch(() => respond({ access_token: 'jeton', expires_in: 1800 }));
    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    await fetchStrictJson('https://auth.opensky-network.org/token', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    expect(log.inits[0]?.method).toBe('POST');
    expect(log.inits[0]?.body).toBe(body);
  });
  it('lecture d’un en-tête de réponse (X-Rate-Limit-Remaining) ; absent : null', async () => {
    stubFetch(() => respond({ time: 1, states: [] }, 200, { 'X-Rate-Limit-Remaining': '3619' }));
    const r = await fetchStrictResponse('https://opensky-network.org/api/states/all', { expect: 'json' });
    expect(r.header('x-rate-limit-remaining')).toBe('3619');
    expect(r.header('retry-after')).toBeNull();
    expect(r.status).toBe(200);
  });
});

describe('repère de contenu : vraie page qui intègre un formulaire reCAPTCHA (annuaire de Bordeaux, 03/10/2026)', () => {
  const MARKER = 'id="flights-list-table"';
  const BOD = 'https://www.bordeaux.aeroport.fr/vols-destinations/arrivees-departs-du-jour';
  // Extrait de la page réelle (108 Ko, HTTP 200) : script reCAPTCHA en tête, formulaire en pied de page ; valeurs remplacées.
  const PAGE = '<!DOCTYPE html><html><head><title>Arrivées et départs du jour - Bordeaux Aéroport</title>'
    + '<script src="https://www.google.com/recaptcha/api.js?hl=fr&amp;render=explicit" async defer></script></head><body>'
    + `<table ${MARKER}><tr><td>15:10</td><td>Lyon</td></tr></table>`
    + '<form><div data-drupal-selector="edit-captcha" class="captcha captcha-type-challenge--recaptcha"><input type="hidden" name="captcha_token" value="x" />'
    + '<div class="g-recaptcha" data-theme="light" data-type="image"></div></div></form></body></html>';

  it('sans repère : « captcha » seul fait un défi (règle inchangée) ; repère présent : page lue', async () => {
    expect(isChallengePage(PAGE)).toBe(true);
    expect(isChallengePage(PAGE, { contentMarker: MARKER })).toBe(false);
    stubFetch(() => respond(PAGE));
    expect(await fetchStrictHtml(BOD, { contentMarker: MARKER })).toBe(PAGE);
    expect((await failure(fetchStrictHtml(BOD))).kind).toBe('challenge');
  });
  it('repère absent, ou marque explicite de défi : toujours un défi', () => {
    expect(isChallengePage(PAGE.replace(MARKER, 'id="autre"'), { contentMarker: MARKER })).toBe(true);
    expect(isChallengePage(`${fixtureText('challenge-captcha.html')}<table ${MARKER}></table>`, { contentMarker: MARKER })).toBe(true);
  });
});

describe('pannes amont (S3)', () => {
  it('clé TomTom refusée (réponse réelle, HTTP 401) : erreur sans la clé dans le message', async () => {
    stubFetch(() => respond(fixtureText('tomtom-401.json'), 401));
    const err = await failure(fetchStrictJson(TOMTOM));
    expect(err).toMatchObject({ kind: 'http', status: 401, message: 'HTTP 401' });
    expect(sourceError('TomTom, Lyon', err)).toBe('TomTom, Lyon : HTTP 401');
    expect(sourceError('TomTom, Lyon', err)).not.toContain('CLE-SECRETE');
  });
  it.each([403, 429, 500])('HTTP %i : erreur', async (status) => {
    stubFetch(() => respond('{"error":"x"}', status));
    expect((await failure(fetchStrictJson(TOMTOM))).status).toBe(status);
  });
  it('page de défi servie en 200 ou en 403 à la place du XML ou du JSON : erreur « anti-robot »', async () => {
    stubFetch(() => respond(fixtureText('challenge-captcha.html')));
    expect((await failure(fetchStrictXml('https://tipi.bison-fute.gouv.fr/x.xml'))).kind).toBe('challenge');
    stubFetch(() => respond(fixtureText('challenge-captcha.html'), 403));
    expect((await failure(fetchStrictJson(TOMTOM))).message).toBe('page de contrôle anti-robot (HTTP 403)');
  });
  it('page HTML ordinaire à la place du XML DATEX : erreur', async () => {
    stubFetch(() => respond('<!DOCTYPE html><html><body>Maintenance</body></html>'));
    expect((await failure(fetchStrictXml('https://tipi.bison-fute.gouv.fr/x.xml'))).kind).toBe('html');
  });
});

describe('cache mémoire seul (shared: false)', () => {
  it('aucune écriture Redis, une seule lecture tant que frais', async () => {
    const producer = vi.fn(async () => ({ v: 1 }));
    expect(await cachedSource('trafic:test', { ttlSec: 300, shared: false }, producer)).toEqual({ v: 1 });
    expect(await cachedSource('trafic:test', { ttlSec: 300, shared: false }, producer)).toEqual({ v: 1 });
    expect(producer).toHaveBeenCalledTimes(1);
  });
  it('réponse partielle : cache CDN court ; aucune source : 502 non mis en cache', () => {
    const partial = fakeRes();
    sendSourceJson(partial, { errors: ['CNIR : HTTP 500'] }, { ok: true, cacheControl: 's-maxage=300, stale-while-revalidate=600' });
    expect(partial.headers['Cache-Control']).toBe(health.PARTIAL_CACHE_CONTROL);
    const none = fakeRes();
    sendSourceJson(none, { errors: ['DIR : HTTP 500'] }, { ok: false, cacheControl: 's-maxage=300' });
    expect([none.statusCode, none.headers['Cache-Control']]).toEqual([502, 'no-store']);
  });
});
