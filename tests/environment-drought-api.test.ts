// tests/environment-drought-api.test.ts
// /api/environment/drought (spec 2026-10-04 environnement § 3.1, contrats § 2.6) : VigiEau réel du 04/10/2026, série quotidienne
// (référence en construction), lecture stricte (S3), relève serveur de 6 h. Un stock (E2) : aucune entrée du score ici.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import { VIGIEAU_URL, droughtCounts, ensureDroughtFresh, latestAsOf, parseVigieauDepartements } from '../api/_lib/vigieau.js';
import handler, { CACHE_CONTROL } from '../api/_handlers/environment/drought.js';
import { ENVIRONMENT_COLLECTORS } from '../server/prod/environment-collectors.mjs';
import type { DroughtResponse } from '../src/types/index.ts';
import { callHandler, fakeRes, respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

const env = (name: string): string => readFileSync(new URL(`./fixtures/environment/${name}`, import.meta.url), 'utf8');
const VIGIEAU = env('vigieau-departements-extrait.json');
const NOW = Date.parse('2026-10-04T08:10:00Z');
const DAY = 86_400_000;

function at(ms: number): void {
  vi.setSystemTime(ms);
}

beforeEach(() => {
  __resetSwrCacheForTests();
  __resetKvForTests();
  __setKvClientForTests({ get: async () => null, set: async () => {} });
  vi.useFakeTimers({ toFake: ['Date'] });
  at(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  __setKvClientForTests(null);
  __resetKvForTests();
});

/** Réponse VigiEau du lendemain : nouvelle date d'arrêtés, Ain passé en alerte renforcée. */
function nextDay(): string {
  const list = JSON.parse(VIGIEAU) as Array<Record<string, unknown> & { availability: { AEP: { asOf: string } } }>;
  for (const d of list) d.availability.AEP.asOf = '2026-10-05T00:41:12.000Z';
  Object.assign(list[0], { niveauGraviteMax: 'alerte_renforcee', niveauGraviteSupMax: 'alerte_renforcee', niveauGraviteSouMax: 'alerte_renforcee', niveauGraviteAepMax: 'alerte_renforcee' });
  return JSON.stringify(list);
}

describe('lecture VigiEau (fonctions pures)', () => {
  it('départements, niveaux par usage, région ; date des arrêtés ; comptes', () => {
    const json: unknown = JSON.parse(VIGIEAU);
    const depts = parseVigieauDepartements(json);
    expect(depts).toEqual([
      { dept: '01', name: 'Ain', region: 'Auvergne-Rhône-Alpes', available: true, max: 'crise', superficielle: 'crise', souterraine: 'crise', potable: 'crise' },
      { dept: '02', name: 'Aisne', region: 'Hauts-de-France', available: true, max: 'alerte_renforcee', superficielle: 'alerte_renforcee', souterraine: 'alerte_renforcee', potable: 'alerte_renforcee' },
      { dept: '03', name: 'Allier', region: 'Auvergne-Rhône-Alpes', available: true, max: 'crise', superficielle: 'crise', souterraine: 'crise', potable: 'crise' },
    ]);
    expect(latestAsOf(json)).toBe('2026-10-04T00:43:59.771Z');
    expect(droughtCounts(depts)).toEqual({ vigilance: 0, alerte: 0, alerte_renforcee: 1, crise: 2, aucun: 0 });
  });
  it('amendement 15 : « unavailable » (Guyane, Mayotte) = donnée indisponible, hors des comptes ; niveau null d’un département publié = « aucun » ; asOf absent ignoré', () => {
    const json = [
      { code: '973', nom: 'Guyane', region: 'Guyane', niveauGraviteMax: null, niveauGraviteSupMax: null, niveauGraviteSouMax: null, niveauGraviteAepMax: null,
        availability: { AEP: { status: 'unavailable', asOf: null } } },
      { code: '75', nom: 'Paris', region: 'Île-de-France', niveauGraviteMax: null, niveauGraviteSupMax: null, niveauGraviteSouMax: null, niveauGraviteAepMax: null,
        availability: { AEP: { status: 'available', asOf: null } } },
    ];
    const depts = parseVigieauDepartements(json);
    expect(depts.map((d) => [d.dept, d.available, d.max])).toEqual([['973', false, null], ['75', true, null]]);
    expect(droughtCounts(depts)).toEqual({ vigilance: 0, alerte: 0, alerte_renforcee: 0, crise: 0, aucun: 1 });
    expect(latestAsOf(json)).toBeNull();
  });
  it('forme inattendue ou niveau inconnu : erreur nommée (jamais mise en cache)', () => {
    expect(() => parseVigieauDepartements({ departements: [] })).toThrow('liste des départements vide ou illisible');
    expect(() => parseVigieauDepartements([])).toThrow('liste des départements vide ou illisible');
    expect(() => parseVigieauDepartements([{ code: '01', nom: 'Ain', niveauGraviteMax: 'renforcee' }])).toThrow('niveau inconnu « renforcee » (01)');
  });
});

describe('/api/environment/drought', () => {
  it('200, cache 1 h ; départements, comptes, date des arrêtés, série amorcée (référence en construction) ; User-Agent du projet', async () => {
    const log = stubFetch(() => respond(VIGIEAU));
    const { status, body, cache } = await callHandler<DroughtResponse>(handler);
    expect([status, cache]).toEqual([200, CACHE_CONTROL]);
    expect(body).toMatchObject({
      asOf: '2026-10-04T00:43:59.771Z', counts: { vigilance: 0, alerte: 0, alerte_renforcee: 1, crise: 2, aucun: 0 },
      history: { days: [{ date: '2026-10-04', vigilance: 0, alerte: 0, alerte_renforcee: 1, crise: 2 }], since: '2026-10-04' },
      readAt: '2026-10-04T08:10:00.000Z', errors: [],
    });
    expect(body.departments.map((d) => d.dept)).toEqual(['01', '02', '03']);
    expect(log.urls).toEqual([VIGIEAU_URL]);
    expect(sentHeader(log.inits[0], 'User-Agent')).toMatch(/^FranceMonitor\//);
  });
  it('cache partagé de 6 h : une seconde lecture dans l’heure ne rappelle pas VigiEau', async () => {
    const log = stubFetch(() => respond(VIGIEAU));
    await callHandler<DroughtResponse>(handler);
    at(NOW + 3_600_000);
    await callHandler<DroughtResponse>(handler);
    expect(log.urls).toHaveLength(1);
  });
  it('série quotidienne : un échantillon par date d’arrêtés ; même date le lendemain : rien d’ajouté ; nouvelle date : un jour de plus', async () => {
    stubFetch(() => respond(VIGIEAU));
    await callHandler<DroughtResponse>(handler);
    at(NOW + DAY);
    const same = await callHandler<DroughtResponse>(handler);
    expect(same.body.history.days).toHaveLength(1);
    stubFetch(() => respond(nextDay()));
    __resetSwrCacheForTests();
    at(NOW + 2 * DAY);
    const next = await callHandler<DroughtResponse>(handler);
    expect(next.body.history).toEqual({
      days: [
        { date: '2026-10-04', vigilance: 0, alerte: 0, alerte_renforcee: 1, crise: 2 },
        { date: '2026-10-05', vigilance: 0, alerte: 0, alerte_renforcee: 2, crise: 1 },
      ],
      since: '2026-10-04',
    });
  });
  it('relève de production : collecteur « vigieau » (ensureDroughtFresh), sans réponse HTTP', async () => {
    expect(ENVIRONMENT_COLLECTORS.find((c) => c.name === 'vigieau')?.run).toBe(ensureDroughtFresh);
    stubFetch(() => respond(VIGIEAU));
    const v = await ensureDroughtFresh(NOW);
    expect([v.asOf, v.departments.length]).toEqual(['2026-10-04T00:43:59.771Z', 3]);
  });
  it('panne : HTTP 503, page HTML, défi anti-robot ; 502 non mis en cache, erreur nommée, jamais « aucun arrêté »', async () => {
    stubFetch(() => respond('Service Unavailable', 503));
    const down = await callHandler<DroughtResponse>(handler);
    expect([down.status, down.cache]).toEqual([502, 'no-store']);
    expect(down.body).toMatchObject({ asOf: null, departments: [], readAt: null, errors: ['VigiEau : HTTP 503'] });
    __resetSwrCacheForTests();
    stubFetch(() => respond('<!doctype html><html><body>maintenance</body></html>'));
    expect((await callHandler<DroughtResponse>(handler)).body.errors).toEqual(['VigiEau : page HTML reçue au lieu de données']);
    __resetSwrCacheForTests();
    stubFetch(() => respond('<html><head><title>Just a moment...</title></head></html>', 403));
    expect((await callHandler<DroughtResponse>(handler)).body.errors).toEqual(['VigiEau : page de contrôle anti-robot (HTTP 403)']);
  });
  it('panne après une lecture réussie : la dernière valeur est servie avec sa propre date (S1)', async () => {
    stubFetch(() => respond(VIGIEAU));
    await callHandler<DroughtResponse>(handler);
    stubFetch(() => respond('Service Unavailable', 503));
    at(NOW + 7 * 3_600_000);
    const { status, body } = await callHandler<DroughtResponse>(handler);
    expect([status, body.asOf, body.readAt]).toEqual([200, '2026-10-04T00:43:59.771Z', '2026-10-04T08:10:00.000Z']);
    // Vague finale, point 6 : la relecture en échec est nommée (S3), jamais un « ok » silencieux jusqu'au délai S2.
    expect(body.errors).toEqual(['VigiEau : HTTP 503']);
    // Relecture réussie ensuite : plus de panne nommée.
    stubFetch(() => respond(VIGIEAU));
    at(NOW + 14 * 3_600_000);
    const back = await callHandler<DroughtResponse>(handler);
    expect([back.body.errors, back.body.readAt]).toEqual([[], new Date(NOW + 14 * 3_600_000).toISOString()]);
  });
  it('OPTIONS 204, POST 405', async () => {
    const options = fakeRes();
    await handler({ method: 'OPTIONS', query: {} }, options);
    expect(options.statusCode).toBe(204);
    const post = fakeRes();
    await handler({ method: 'POST', query: {} }, post);
    expect(post.statusCode).toBe(405);
  });
});
