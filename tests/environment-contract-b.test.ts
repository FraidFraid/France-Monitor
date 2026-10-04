// Contrat serveur / client de la phase B : chaque réponse construite par le code serveur (réponses réelles du 04/10, mêmes doublures que
// les tests des routes) passe la garde stricte du client, réponses dégradées comprises (errors[] non vide, 502).
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import { ATMO_EPISODES_BASE, ATMO_INDEX_BASE } from '../api/_lib/atmo.js';
import { BCSF_URL, EMSC_BASE } from '../api/_lib/seismes.js';
import droughtHandler from '../api/_handlers/environment/drought.js';
import airHandler from '../api/_handlers/environment/air.js';
import quakesHandler from '../api/_handlers/environment/earthquakes.js';
import seaHandler from '../api/_handlers/environment/sea-levels.js';
import { isDroughtResponse } from '../src/services/environment-drought.ts';
import { isAirQualityResponse } from '../src/services/environment-air.ts';
import { isEarthquakesResponse } from '../src/services/environment-earthquakes.ts';
import { isSeaLevelsResponse } from '../src/services/environment-sea-levels.ts';
import { callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';

const env = (name: string): string => readFileSync(new URL(`./fixtures/environment/${name}`, import.meta.url), 'utf8');
const wire = (body: unknown): unknown => JSON.parse(JSON.stringify(body)) as unknown;

beforeEach(() => {
  __resetSwrCacheForTests();
  __resetKvForTests();
  __setKvClientForTests({ get: async () => null, set: async () => {} });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-10-04T08:14:30Z'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __setKvClientForTests(null); __resetKvForTests(); });

describe('contrat sécheresse', () => {
  it('complète et 502', async () => {
    stubFetch(() => respond(env('vigieau-departements-extrait.json')));
    expect(isDroughtResponse(wire((await callHandler(droughtHandler)).body))).toBe(true);
    __resetSwrCacheForTests();
    stubFetch(() => respond('erreur', 503));
    const down = await callHandler(droughtHandler);
    expect([down.status, isDroughtResponse(wire(down.body))]).toEqual([502, true]);
  });
});

describe('contrat qualité de l’air', () => {
  it('complète, partielle (épisodes en panne) et 502', async () => {
    const index = { type: 'FeatureCollection', numberMatched: 1, features: [{ type: 'Feature', geometry: null, properties: { code_zone: '13055', code_qual: 3, date_maj: '2026-10-03T14:02:11.000Z', date_ech: '2026-10-04' } }] };
    stubFetch((url) => (url.startsWith(ATMO_EPISODES_BASE) ? respond(env('atmo-episodes-alrt3j-extrait.json')) : url.startsWith(ATMO_INDEX_BASE) ? respond(index) : respond('', 404)));
    expect(isAirQualityResponse(wire((await callHandler(airHandler)).body))).toBe(true);
    __resetSwrCacheForTests();
    stubFetch((url) => (url.startsWith(ATMO_INDEX_BASE) ? respond(index) : respond('erreur', 500)));
    const partial = await callHandler<{ errors: string[] }>(airHandler);
    expect([partial.status, partial.body.errors.length, isAirQualityResponse(wire(partial.body))]).toEqual([200, 1, true]);
    __resetSwrCacheForTests();
    stubFetch(() => respond('erreur', 500));
    const down = await callHandler(airHandler);
    expect([down.status, isAirQualityResponse(wire(down.body))]).toEqual([502, true]);
  });
});

describe('contrat séismes', () => {
  it('BCSF, repli EMSC (partielle) et 502', async () => {
    stubFetch((url) => (url === BCSF_URL ? respond(env('bcsf-renass-rayon-extrait.json')) : respond('', 404)));
    expect(isEarthquakesResponse(wire((await callHandler(quakesHandler)).body))).toBe(true);
    __resetSwrCacheForTests();
    stubFetch((url) => (url.startsWith(EMSC_BASE) ? respond(env('emsc-fdsn-france-extrait.json')) : respond('erreur', 500)));
    const partial = await callHandler(quakesHandler);
    expect([partial.status, isEarthquakesResponse(wire(partial.body))]).toEqual([200, true]);
    __resetSwrCacheForTests();
    stubFetch(() => respond('erreur', 500));
    const down = await callHandler(quakesHandler);
    expect([down.status, isEarthquakesResponse(wire(down.body))]).toEqual([502, true]);
  });
});

describe('contrat marégraphes', () => {
  it('complète, partielle (Brest en panne) et 502', async () => {
    const html = { 'content-type': 'text/html; charset=utf-8' };
    stubFetch(() => respond(env('shom-refmar-brest-1h-extrait.json'), 200, html));
    expect(isSeaLevelsResponse(wire((await callHandler(seaHandler)).body))).toBe(true);
    __resetSwrCacheForTests();
    stubFetch((url) => (url.includes('/observation/json/3?') ? respond('erreur', 503) : respond(env('shom-refmar-marseille-extrait.json'), 200, html)));
    const partial = await callHandler(seaHandler);
    expect([partial.status, isSeaLevelsResponse(wire(partial.body))]).toEqual([200, true]);
    __resetSwrCacheForTests();
    stubFetch(() => respond('erreur', 503));
    const down = await callHandler(seaHandler);
    expect([down.status, isSeaLevelsResponse(wire(down.body))]).toEqual([502, true]);
  });
});
