// Route /api/fires/impacts (spec 2026-10-04 environnement § 2.4) : communes à moins de 10 km d'un foyer, lues sur
// geo.api.gouv.fr (réponse réelle réduite du 04/10/2026 : 22 communes de la Gironde), sans aucune estimation d'impact humain.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { PARTIAL_CACHE_CONTROL } from '../api/_lib/source-http.js';
import { communesUrl, georisquesReportUrl, parseCommunes, rankCommunes } from '../api/_lib/fire-impacts.js';
import handler from '../api/_handlers/fires/impacts.js';
import type { FireImpactsResponse } from '../src/types/index.ts';
import { callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/environment/${name}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-04T10:10:00+02:00');
/** Foyer en forêt au sud du Porge (Gironde). */
const PORGE = { lat: '44.88', lon: '-1.12' };

beforeEach(() => {
  __resetSwrCacheForTests();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('communes de geo.api.gouv.fr', () => {
  it('URL par département, champs utiles seulement', () => {
    expect(communesUrl('33')).toBe('https://geo.api.gouv.fr/communes?codeDepartement=33&fields=nom,code,population,centre,codeDepartement&format=json');
    expect(communesUrl('2A')).toContain('codeDepartement=2A&');
  });
  it('commune sans centre écartée, population absente gardée à null (jamais 0) ; aucune commune lisible : erreur', () => {
    const list = parseCommunes([
      { nom: 'Le Porge', code: '33333', population: 3465, centre: { type: 'Point', coordinates: [-1.1351, 44.8649] }, codeDepartement: '33' },
      { nom: 'Sans centre', code: '33999', population: 10, codeDepartement: '33' },
      { nom: 'Sans population', code: '33998', centre: { type: 'Point', coordinates: [-1.1, 44.9] } },
    ], '33');
    expect(list).toEqual([
      { code: '33333', name: 'Le Porge', dept: '33', population: 3465, lat: 44.8649, lon: -1.1351 },
      { code: '33998', name: 'Sans population', dept: '33', population: null, lat: 44.9, lon: -1.1 },
    ]);
    expect(() => parseCommunes({ error: 'x' }, '33')).toThrow('liste de communes attendue');
    expect(() => parseCommunes([{ nom: 'x' }], '33')).toThrow('aucune commune lisible');
  });
  it('classement par distance, arrondie à 0,1 km', () => {
    const ranked = rankCommunes(parseCommunes(JSON.parse(fx('geo-communes-dept-33.json')), '33'), 44.88, -1.12);
    expect(ranked.slice(0, 4).map((c) => [c.name, c.distanceKm])).toEqual([['Le Porge', 2.1], ['Arès', 9.4], ['Saumos', 9.9], ['Lacanau', 12.1]]);
  });
  it('rapport Géorisques de la commune par code INSEE', () => {
    expect(georisquesReportUrl('33333')).toBe('https://www.georisques.gouv.fr/api/v1/rapport_pdf?code_insee=33333');
  });
});

describe('GET /api/fires/impacts', () => {
  it('foyer du Porge : 3 communes à moins de 10 km, la plus proche et son rapport Géorisques, cache d’un jour', async () => {
    const log = stubFetch((url) => (url === communesUrl('33') ? respond(fx('geo-communes-dept-33.json')) : respond('introuvable', 404)));
    const { status, body, cache } = await callHandler<FireImpactsResponse>(handler, PORGE);
    expect(status).toBe(200);
    expect(cache).toBe('s-maxage=86400, stale-while-revalidate=604800');
    expect(log.urls).toEqual([communesUrl('33')]);
    expect(body.communes).toEqual([
      { code: '33333', name: 'Le Porge', dept: '33', population: 3465, distanceKm: 2.1 },
      { code: '33011', name: 'Arès', dept: '33', population: 6482, distanceKm: 9.4 },
      { code: '33503', name: 'Saumos', dept: '33', population: 550, distanceKm: 9.9 },
    ]);
    expect(body.nearest?.name).toBe('Le Porge');
    expect(body.georisquesUrl).toBe('https://www.georisques.gouv.fr/api/v1/rapport_pdf?code_insee=33333');
    expect([body.lat, body.lon, body.radiusKm, body.readAt, body.errors]).toEqual([44.88, -1.12, 10, '2026-10-04T08:10:00.000Z', []]);
    // Aucune estimation d'impact humain (spec § 2.4) : seuls les champs du contrat.
    expect(Object.keys(body).sort()).toEqual(['communes', 'errors', 'georisquesUrl', 'lat', 'lon', 'nearest', 'radiusKm', 'readAt']);
  });
  it('communes gardées en cache : un second foyer du même département ne relit pas geo.api', async () => {
    const log = stubFetch(() => respond(fx('geo-communes-dept-33.json')));
    await callHandler<FireImpactsResponse>(handler, PORGE);
    const second = await callHandler<FireImpactsResponse>(handler, { lat: '44.86', lon: '-1.10' });
    expect(second.status).toBe(200);
    expect(log.urls).toHaveLength(1);
  });
  it('deux départements voisins (Gironde, Landes), les Landes en panne : 200, panne nommée, cache court', async () => {
    const log = stubFetch((url) => (url === communesUrl('33') ? respond(fx('geo-communes-dept-33.json')) : respond('{"error":"x"}', 503)));
    const { status, body, cache } = await callHandler<FireImpactsResponse>(handler, { lat: '44.55', lon: '-1.05' });
    expect(log.urls.sort()).toEqual([communesUrl('33'), communesUrl('40')]);
    expect(status).toBe(200);
    expect(cache).toBe(PARTIAL_CACHE_CONTROL);
    expect(body.errors).toEqual(['geo.api.gouv.fr, département 40 : HTTP 503']);
    expect(body.communes).toEqual([]);
    expect(body.nearest?.name).toBe('Biganos');
  });
  it('aucun département lisible (HTTP 500 ou page HTML) : 502 non mis en cache, panne nommée', async () => {
    stubFetch(() => respond('{"message":"erreur"}', 500));
    const failed = await callHandler<FireImpactsResponse>(handler, PORGE);
    expect([failed.status, failed.cache, failed.body.errors]).toEqual([502, 'no-store', ['geo.api.gouv.fr, département 33 : HTTP 500']]);
    __resetSwrCacheForTests();
    stubFetch(() => respond('<!DOCTYPE html><html><body>Maintenance</body></html>'));
    const html = await callHandler<FireImpactsResponse>(handler, PORGE);
    expect([html.status, html.body.errors]).toEqual([502, ['geo.api.gouv.fr, département 33 : page HTML reçue au lieu de données']]);
  });
  it('point en mer à plus de 10 km des côtes : aucune commune, aucun appel, 200', async () => {
    const log = stubFetch(() => respond('[]'));
    const { status, body } = await callHandler<FireImpactsResponse>(handler, { lat: '45.5', lon: '-5' });
    expect([status, body.communes, body.nearest, body.georisquesUrl, log.urls]).toEqual([200, [], null, null, []]);
  });
  it.each([
    [{ lat: '60', lon: '2' }], [{ lat: 'abc', lon: '2' }], [{ lat: '44.88' }], [{ lat: '44.88', lon: '10.5' }], [{ lat: '', lon: '' }],
  ])('400 hors métropole ou coordonnées illisibles : %o', async (query) => {
    const log = stubFetch(() => respond('[]'));
    const { status, body, cache } = await callHandler<{ error: string }>(handler, query);
    expect([status, body, cache, log.urls]).toEqual([400, { error: 'lat/lon invalides ou hors métropole' }, 'no-store', []]);
  });
});
