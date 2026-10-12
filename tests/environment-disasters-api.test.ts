// tests/environment-disasters-api.test.ts
// /api/environment/disasters (spec 2026-10-12 GDACS) : requête Monde (orange, rouge) et une requête par territoire français (tous
// niveaux) ; 204 = aucun événement ; territoire déduit de la requête ; fusion par événement ; fenêtre de 7 jours.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import {
  DISASTER_WINDOW_MS, FRENCH_TERRITORIES, GDACS_SEARCH, gdacsTime, gdacsUrl, loadDisasters, mergeAlerts, parseGdacs,
} from '../api/_lib/gdacs.js';
import type { DisasterAlert, DisastersResponse } from '../src/types/index.ts';
import handler, { CACHE_CONTROL } from '../api/_handlers/environment/disasters.js';
import { callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';

const env = (name: string): string => readFileSync(new URL(`./fixtures/environment/${name}`, import.meta.url), 'utf8');
const MONDE = env('gdacs-monde-orange-rouge-extrait.json');
const FRANCE = env('gdacs-france-extrait.json');
const REUNION = env('gdacs-reunion-historique-extrait.json');
const NOW = Date.parse('2026-10-12T08:00:00Z');

beforeEach(() => { __resetSwrCacheForTests(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function feature(over: Record<string, unknown> = {}, coords: [number, number] = [-61.5, 16.2]) {
  return {
    type: 'Feature', geometry: { type: 'Point', coordinates: coords },
    properties: {
      eventtype: 'TC', eventid: 1, name: 'Tropical Cyclone TEST-26', alertlevel: 'Red', iso3: 'GLP',
      affectedcountries: [{ iso3: 'GLP' }], fromdate: '2026-10-10T00:00:00', todate: '2026-10-12T06:00:00', iscurrent: 'true',
      severitydata: { severitytext: 'Hurricane/Typhoon > 74 mph' }, url: { report: 'https://www.gdacs.org/report.aspx?eventid=1' },
      ...over,
    },
  };
}
const fcOf = (...features: unknown[]) => ({ type: 'FeatureCollection', features });
const countryOf = (url: string): string | null => new URL(url).searchParams.get('country');

describe('requêtes', () => {
  it('Monde : orange et rouge, 7 jours, six types ; Territoire : tous niveaux et pays ; page 2 seulement si demandée', () => {
    expect(gdacsUrl(NOW)).toBe(`${GDACS_SEARCH}?eventlist=EQ;TC;FL;VO;DR;WF&fromDate=2026-10-05&toDate=2026-10-12&alertlevel=orange;red`);
    expect(gdacsUrl(NOW, { country: 'French Guiana', page: 2 }))
      .toBe(`${GDACS_SEARCH}?eventlist=EQ;TC;FL;VO;DR;WF&fromDate=2026-10-05&toDate=2026-10-12&alertlevel=green;orange;red&country=French%20Guiana&pagenumber=2`);
  });
  it('douze territoires, clé GDACS vérifiée (FRA en ISO3, noms anglais ailleurs) ; TAAF écartées', () => {
    expect(FRENCH_TERRITORIES.map((t) => t.key)).toEqual([
      'FRA', 'Guadeloupe', 'Martinique', 'French Guiana', 'Reunion', 'Mayotte', 'Saint Pierre and Miquelon', 'Saint Barthelemy',
      'Saint Martin', 'Wallis and Futuna', 'French Polynesia', 'New Caledonia',
    ]);
    expect(FRENCH_TERRITORIES.map((t) => t.iso3)).not.toContain('ATF');
  });
  it('dates GDACS sans fuseau lues en UTC ; illisible : null', () => {
    expect(gdacsTime('2026-10-07T15:00:00')).toBe(Date.parse('2026-10-07T15:00:00Z'));
    expect(gdacsTime('2026-10-07T15:00:00Z')).toBe(Date.parse('2026-10-07T15:00:00Z'));
    expect(gdacsTime('n/a')).toBeNull();
  });
});

describe('lecture d’une page', () => {
  it('Monde réel (12/10) : 11 alertes orange ; sécheresse d’Europe centrale rattachée à la France par affectedcountries', () => {
    const alerts = parseGdacs(JSON.parse(MONDE), NOW, null);
    expect(alerts).toHaveLength(11);
    expect(alerts.every((a) => a.level === 'orange')).toBe(true);
    expect(alerts.find((a) => a.id === 'DR-1018332')).toMatchObject({ type: 'secheresse', frenchTerritory: 'France (Hexagone et Corse)' });
    expect(alerts.find((a) => a.id === 'TC-1001335')).toMatchObject({
      type: 'cyclone', name: 'Tropical Cyclone SIMON-26', countries: ['MEX'], frenchTerritory: null, lat: 19.8, lon: -106, current: true,
      from: '2026-10-07T15:00:00.000Z', severity: 'Hurricane/Typhoon > 74 mph (maximum wind speed of 250 km/h)',
      url: 'https://www.gdacs.org/report.aspx?eventid=1001335&episodeid=19&eventtype=TC',
    });
    expect(alerts.find((a) => a.id === 'VO-1000152')?.name).toBe('Eruption Kanlaon');
    expect(alerts.find((a) => a.id === 'DR-1027465')?.name).toBe('Drought in Democratic Republic of Congo, Kenya, Tanzania, Uganda');
    expect(alerts.find((a) => a.id === 'FL-1104121')?.severity).toBeNull();
  });
  it('France réelle : inondation verte gardée (requête Territoire), territoire imposé par la requête', () => {
    const alerts = parseGdacs(JSON.parse(FRANCE), NOW, 'France (Hexagone et Corse)');
    expect(alerts.map((a) => [a.id, a.level, a.frenchTerritory])).toEqual([
      ['DR-1018332', 'orange', 'France (Hexagone et Corse)'], ['FL-1104202', 'vert', 'France (Hexagone et Corse)'],
    ]);
  });
  it('La Réunion réelle au 01/03/2025 : cyclone rouge GARANCE-25 ; séismes de 2026 (dans le futur) écartés', () => {
    const alerts = parseGdacs(JSON.parse(REUNION), Date.parse('2025-03-01T00:00:00Z'), 'La Réunion');
    expect(alerts.map((a) => [a.id, a.type, a.level, a.frenchTerritory])).toEqual([['TC-1001151', 'cyclone', 'rouge', 'La Réunion']]);
  });
  it('séisme en mer à iso3 vide et sans pays touché : gardé pour le territoire interrogé', () => {
    const [a] = parseGdacs(fcOf(feature({ eventtype: 'EQ', alertlevel: 'Green', iso3: '', affectedcountries: [] })), NOW, 'La Réunion');
    expect(a).toMatchObject({ type: 'seisme', level: 'vert', countries: [], frenchTerritory: 'La Réunion' });
  });
  it('Monde : alerte verte écartée même si l’API la renvoie ; terminée depuis plus de 7 jours écartée ; en cours gardée', () => {
    const old = new Date(NOW - DISASTER_WINDOW_MS - 3_600_000).toISOString().slice(0, 19);
    const alerts = parseGdacs(fcOf(
      feature({ eventid: 1, alertlevel: 'Green' }),
      feature({ eventid: 2, iscurrent: 'false', todate: old }),
      feature({ eventid: 3, iscurrent: 'true', todate: old }),
    ), NOW, null);
    expect(alerts.map((a) => a.id)).toEqual(['TC-3']);
  });
  it('forme inattendue : erreur ; objet sans point ni type connu : ignoré', () => {
    expect(() => parseGdacs({ nope: true }, NOW, null)).toThrow('FeatureCollection attendue');
    expect(parseGdacs(fcOf(feature({ eventtype: 'XX' }), { type: 'Feature', geometry: null, properties: {} }), NOW, null)).toEqual([]);
  });
});

describe('fusion', () => {
  it('même événement Monde et Territoire : une ligne, la version au territoire français ; tri France puis niveau puis date', () => {
    const base = parseGdacs(fcOf(feature({ eventid: 7, iso3: 'MEX', affectedcountries: [] })), NOW, null)[0] as DisasterAlert;
    const local = { ...base, frenchTerritory: 'Guadeloupe' };
    const world = { ...base, id: 'EQ-9', type: 'seisme' as const, level: 'rouge' as const, frenchTerritory: null };
    const green = { ...base, id: 'FL-3', level: 'vert' as const, frenchTerritory: 'Martinique' };
    expect(mergeAlerts([[base, world], [local], [green]]).map((a) => [a.id, a.frenchTerritory])).toEqual([
      ['TC-7', 'Guadeloupe'], ['FL-3', 'Martinique'], ['EQ-9', null],
    ]);
  });
});

describe('loadDisasters', () => {
  function sources(over: Record<string, ReturnType<typeof respond>> = {}) {
    return stubFetch((url) => {
      const c = countryOf(url);
      if (c === null) return over['monde'] ?? respond(MONDE);
      if (c in over) return over[c] as ReturnType<typeof respond>;
      if (c === 'FRA') return respond(FRANCE);
      return respond('', 204);
    });
  }
  it('13 requêtes ; 204 = aucun événement (jamais une panne) ; fusion ; relevé daté', async () => {
    const log = sources();
    const body = await loadDisasters(NOW);
    expect(log.urls).toHaveLength(13);
    expect(body.errors).toEqual([]);
    expect(body.readAt).toBe('2026-10-12T08:00:00.000Z');
    expect(body.alerts).toHaveLength(12);
    expect(body.alerts.slice(0, 2).map((a) => [a.id, a.frenchTerritory])).toEqual([
      ['DR-1018332', 'France (Hexagone et Corse)'], ['FL-1104202', 'France (Hexagone et Corse)'],
    ]);
  });
  it('page pleine (100) : page 2 lue ; page incomplète : arrêt', async () => {
    const full = fcOf(...Array.from({ length: 100 }, (_, i) => feature({ eventid: 1000 + i, alertlevel: 'Orange', iso3: 'MEX', affectedcountries: [] })));
    const log = stubFetch((url) => {
      const u = new URL(url);
      if (u.searchParams.get('country') !== null) return respond('', 204);
      return u.searchParams.get('pagenumber') === '2' ? respond(fcOf(feature({ eventid: 5000, alertlevel: 'Orange' }))) : respond(full);
    });
    const body = await loadDisasters(NOW);
    expect(body.alerts).toHaveLength(101);
    expect(log.urls.filter((u) => countryOf(u) === null)).toHaveLength(2);
  });
  it('un territoire en panne : les autres servis, panne nommée par territoire', async () => {
    sources({ Guadeloupe: respond('Internal Server Error', 500) });
    const body = await loadDisasters(NOW);
    expect(body.errors).toEqual(['GDACS Guadeloupe : HTTP 500']);
    expect(body.alerts.length).toBeGreaterThan(0);
  });
  it('tout en panne sans relevé connu : réponse vide datée null, pannes nommées', async () => {
    stubFetch(() => respond('Bad Gateway', 502));
    const body = await loadDisasters(NOW);
    expect(body.readAt).toBeNull();
    expect(body.alerts).toEqual([]);
    expect(body.errors[0]).toMatch(/^GDACS : /);
  });
});

describe('/api/environment/disasters', () => {
  const ok = () => stubFetch((url) => (countryOf(url) === null ? respond(MONDE) : countryOf(url) === 'FRA' ? respond(FRANCE) : respond('', 204)));
  it('200, cache 10 min ; alertes et relevé', async () => {
    ok();
    const { status, body, cache } = await callHandler<DisastersResponse>(handler);
    expect([status, cache]).toEqual([200, CACHE_CONTROL]);
    expect(CACHE_CONTROL).toBe('s-maxage=600, stale-while-revalidate=1200');
    expect(body.alerts).toHaveLength(12);
    expect(body.errors).toEqual([]);
  });
  it('tout en panne sans relevé : 502 non mis en cache, panne nommée', async () => {
    stubFetch(() => respond('Bad Gateway', 502));
    const { status, body, cache } = await callHandler<DisastersResponse>(handler);
    expect([status, cache, body.readAt]).toEqual([502, 'no-store', null]);
    expect(body.errors[0]).toMatch(/^GDACS : /);
  });
  it('tout en panne avec un relevé de plus de 10 min en cache : relevé servi avec sa date, panne nommée (jamais « aucune alerte » muet)', async () => {
    ok();
    await callHandler<DisastersResponse>(handler);
    vi.setSystemTime(NOW + 11 * 60_000);
    stubFetch(() => respond('Bad Gateway', 502));
    const { status, body } = await callHandler<DisastersResponse>(handler);
    expect(status).toBe(200);
    expect(body.readAt).toBe('2026-10-12T08:00:00.000Z');
    expect(body.errors[0]).toBe('GDACS : source indisponible, relevé précédent servi');
    expect(body.alerts.length).toBeGreaterThan(0);
  });
});
