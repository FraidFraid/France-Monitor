// tests/environment-sea-levels-api.test.ts
// /api/environment/sea-levels (spec 2026-10-04 environnement § 3.4, contrats § 2.9, arbitrage 10) : marégraphes REFMAR du SHOM (une
// mesure par minute, sans clé), liste fixe versionnée de 19 ports ; aucune marée prédite (clé exigée, contrats § 9).
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { TIDE_GAUGES, change1h, downsampleTenMinutes, parseRefmar, refmarUrl } from '../api/_lib/tide-gauges.js';
import handler, { CACHE_CONTROL } from '../api/_handlers/environment/sea-levels.js';
import type { SeaLevelsResponse } from '../src/types/index.ts';
import { type FakeResponse, callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';

const env = (name: string): string => readFileSync(new URL(`./fixtures/environment/${name}`, import.meta.url), 'utf8');
const BREST_1H = env('shom-refmar-brest-1h-extrait.json');
const BREST_4 = env('shom-refmar-brest-extrait.json');
const MARSEILLE = env('shom-refmar-marseille-extrait.json');
const NOW = Date.parse('2026-10-04T08:14:30Z');
const HTML = { 'content-type': 'text/html; charset=utf-8' };

beforeEach(() => { __resetSwrCacheForTests(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function sources(over: (url: string) => FakeResponse | null = () => null) {
  return stubFetch((url) => {
    const forced = over(url);
    if (forced) return forced;
    if (url.includes('/observation/json/3?')) return respond(BREST_1H, 200, HTML);
    if (url.includes('/observation/json/524?')) return respond(MARSEILLE, 200, HTML);
    return respond(BREST_4, 200, HTML);
  });
}

describe('liste fixe versionnée des marégraphes', () => {
  it('19 ports, identifiants et coordonnées du référentiel SHOM du 04/10, état « OK » ; domaine littoral « XX10 » du département', () => {
    const ref = JSON.parse(env('shom-tidegauges-extrait.json')) as Array<{ shom_id: string; latitude: number; longitude: number; state: string }>;
    expect(TIDE_GAUGES).toHaveLength(19);
    for (const g of TIDE_GAUGES) {
      const r = ref.find((x) => Number(x.shom_id) === g.id);
      expect(r?.state).toBe('OK');
      expect(Math.abs((r?.latitude ?? 0) - g.lat)).toBeLessThan(1e-6);
      expect(Math.abs((r?.longitude ?? 0) - g.lon)).toBeLessThan(1e-6);
      expect(g.coastDomain).toBe(`${g.dept}10`);
    }
    expect(TIDE_GAUGES.map((g) => g.name)).toEqual([
      'Dunkerque', 'Calais', 'Le Havre', 'Cherbourg', 'Saint-Malo', 'Brest', 'Concarneau', 'Saint-Nazaire', 'Les Sables-d’Olonne', 'La Rochelle-Pallice',
      'Port-Bloc', 'Arcachon', 'Bayonne-Boucau', 'Port-Vendres', 'Sète', 'Marseille', 'Toulon', 'Nice', 'Ajaccio',
    ]);
  });
  it('URL d’observation : source 1 (temps différé brut), fenêtre de 24 h à la seconde', () => {
    expect(refmarUrl(3, Date.parse('2026-10-03T08:14:30Z'), NOW))
      .toBe('https://services.data.shom.fr/maregraphie/observation/json/3?sources=1&dtStart=2026-10-03T08:14:30Z&dtEnd=2026-10-04T08:14:30Z');
  });
});

describe('lecture des mesures', () => {
  it('horodatage UTC « AAAA/MM/JJ HH:MM:SS », ordre chronologique ; minutes rondes plus la dernière ; variation sur 1 h', () => {
    const points = parseRefmar(JSON.parse(BREST_1H));
    expect(points[0]).toEqual({ at: '2026-10-04T07:00:00.000Z', value: 4.639 });
    expect(points.at(-1)).toEqual({ at: '2026-10-04T08:14:00.000Z', value: 5.2016 });
    expect(downsampleTenMinutes(points).map((p) => [p.at.slice(11, 16), p.value])).toEqual([
      ['07:00', 4.639], ['07:10', 4.7205], ['07:20', 4.8147], ['07:30', 4.8855], ['07:40', 4.9741], ['07:50', 5.0413], ['08:00', 5.1147], ['08:10', 5.1772], ['08:14', 5.2016],
    ]);
    expect(change1h(points)).toBe(0.4383);
  });
  it('variation absente sans mesure à une heure (2 min de tolérance) ; corps sans tableau : erreur', () => {
    expect(change1h(parseRefmar(JSON.parse(BREST_4)))).toBeNull();
    expect(() => parseRefmar({ observations: [] })).toThrow('mesures illisibles');
    expect(parseRefmar({ data: [{ value: 'x', timestamp: '2026/10/04 08:00:00' }] })).toEqual([]);
  });
});

describe('/api/environment/sea-levels', () => {
  it('200, cache 5 min ; 19 marégraphes dans l’ordre de la liste ; Brest et Marseille : hauteur, variation, série ; jamais de marée prédite', async () => {
    const log = sources();
    const { status, body, cache } = await callHandler<SeaLevelsResponse>(handler);
    expect([status, cache, body.predictionAvailable, body.errors, body.readAt]).toEqual([200, CACHE_CONTROL, false, [], '2026-10-04T08:14:30.000Z']);
    expect(body.gauges.map((g) => g.id)).toEqual(TIDE_GAUGES.map((g) => g.id));
    const brest = body.gauges.find((g) => g.id === 3);
    expect(brest).toMatchObject({ name: 'Brest', coastDomain: '2910', dept: '29', lastAt: '2026-10-04T08:14:00.000Z', heightM: 5.2016, change1hM: 0.4383 });
    expect(brest?.series).toHaveLength(9);
    expect(body.gauges.find((g) => g.id === 524)).toMatchObject({ name: 'Marseille', heightM: 0.499, change1hM: 0.002 });
    expect(body.gauges.find((g) => g.id === 2)).toMatchObject({ heightM: 5.2016, change1hM: null });
    expect(log.urls).toHaveLength(19);
    expect(log.urls.every((u) => u.includes('sources=1&dtStart='))).toBe(true);
  });
  it('un marégraphe en panne : nommé, ses valeurs nulles, les autres servis (200, cache court)', async () => {
    sources((url) => (url.includes('/observation/json/3?') ? respond('Service Unavailable', 503) : null));
    const { status, body, cache } = await callHandler<SeaLevelsResponse>(handler);
    expect([status, cache, body.errors]).toEqual([200, 's-maxage=300, stale-while-revalidate=600', ['Marégraphe Brest : HTTP 503']]);
    expect(body.gauges.find((g) => g.id === 3)).toMatchObject({ lastAt: null, heightM: null, change1hM: null, series: [] });
  });
  it('aucune mesure sur 24 h ou page HTML : panne nommée ; tous en panne : 502 non mis en cache', async () => {
    sources((url) => (url.includes('/observation/json/3?') ? respond('{"data":[]}', 200, HTML)
      : url.includes('/observation/json/524?') ? respond('<!DOCTYPE html><html><body>maintenance</body></html>', 200, HTML) : null));
    const partial = await callHandler<SeaLevelsResponse>(handler);
    expect(partial.body.errors).toEqual(['Marégraphe Brest : aucune mesure sur 24 h', 'Marégraphe Marseille : page HTML reçue au lieu de données']);
    __resetSwrCacheForTests();
    sources(() => respond('Service Unavailable', 503));
    const down = await callHandler<SeaLevelsResponse>(handler);
    expect([down.status, down.cache, down.body.readAt, down.body.errors.length]).toEqual([502, 'no-store', null, 19]);
  });
});
