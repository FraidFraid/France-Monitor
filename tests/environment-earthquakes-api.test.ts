// tests/environment-earthquakes-api.test.ts
// /api/environment/earthquakes (spec 2026-10-04 environnement § 3.3, contrats § 2.8, amendement 2, arbitrages 1 à 4) : BCSF-RéNaSS
// filtré par rayon (la boîte est ignorée par l'API), tirs de carrière écartés, « en France » par polygone ou eaux françaises, repli EMSC.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { BCSF_URL, EMSC_BASE, emscUrl, parseBcsf, parseEmsc, quakeScope } from '../api/_lib/seismes.js';
import handler, { CACHE_CONTROL } from '../api/_handlers/environment/earthquakes.js';
import type { EarthquakesResponse } from '../src/types/index.ts';
import { type FakeResponse, callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';

const env = (name: string): string => readFileSync(new URL(`./fixtures/environment/${name}`, import.meta.url), 'utf8');
const BCSF = env('bcsf-renass-rayon-extrait.json');
const BCSF_SHORT = env('bcsf-renass-fdsn-extrait.json');
const EMSC = env('emsc-fdsn-france-extrait.json');
const NOW = Date.parse('2026-10-04T08:10:00Z');

beforeEach(() => { __resetSwrCacheForTests(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function feature(id: string, time: string, lat: number, lon: number, mag: number, type: string | null = 'earthquake') {
  return {
    id, type: 'Feature',
    properties: { type, time, description: { fr: `Tremblement de terre de magnitude ${mag}, proche de Test` }, depth: 5, url: { fr: `https://renass.unistra.fr/fr/evenements/${id}` },
      automatic: false, latitude: lat, longitude: lon, mag, magType: 'MLv' },
    geometry: { type: 'Point', coordinates: [lon, lat, -5] },
  };
}

function sources(over: { bcsf?: FakeResponse; emsc?: FakeResponse } = {}) {
  return stubFetch((url) => {
    if (url === BCSF_URL) return over.bcsf ?? respond(BCSF);
    if (url.startsWith(EMSC_BASE)) return over.emsc ?? respond(EMSC);
    return respond('introuvable', 404);
  });
}

describe('requêtes', () => {
  it('BCSF par rayon (boîte ignorée par l’API, vérifié le 04/10) ; ni date ni magnitude (500 chez BCSF)', () => {
    expect(BCSF_URL).toContain('latitude=46.5&longitude=2.5&maxradius=8');
    expect(BCSF_URL).not.toMatch(/minlat|starttime|minmagnitude/);
  });
  it('EMSC : boîte et début de fenêtre à la seconde, sans fuseau', () => {
    expect(emscUrl('2026-09-27T08:10:00.000Z'))
      .toBe('https://www.seismicportal.eu/fdsnws/event/1/query?format=json&minlat=40.8&maxlat=51.5&minlon=-5.8&maxlon=10.0&start=2026-09-27T08:10:00&orderby=time&limit=1000');
  });
});

describe('périmètre (amendement 2) : territoire ou eaux françaises ; 20 km autour, hors de France, gardés en gris', () => {
  it('Albertville sur le territoire ; Italie (Aoste) à 3,2 km gardée hors de France ; golfe du Lion en eaux françaises ; Gérone à 18,9 km ; Suisse écartée', () => {
    expect(quakeScope(45.34574509, 6.300428867)).toEqual({ inFrance: true, distanceKm: 0, keep: true });
    expect(quakeScope(45.83852768, 6.981859207)).toEqual({ inFrance: false, distanceKm: 3.2, keep: true });
    expect(quakeScope(43.0, 4.5)).toEqual({ inFrance: true, distanceKm: 40.4, keep: true });
    expect(quakeScope(42.2, 2.8)).toEqual({ inFrance: false, distanceKm: 18.9, keep: true });
    expect(quakeScope(46.5977, 8.3468)).toMatchObject({ inFrance: false, keep: false });
  });
});

describe('lecture BCSF-RéNaSS', () => {
  it('réponse réelle : sept séismes en France, un en Italie, un tir de carrière écarté ; plus récent d’abord ; fenêtre complète', () => {
    const parsed = parseBcsf(JSON.parse(BCSF), NOW);
    expect([parsed.nonSeismic, parsed.complete]).toEqual([1, true]);
    expect(parsed.quakes.map((q) => [q.id, q.magnitude, q.dept, q.inFrance])).toEqual([
      ['fr2026utlsew', 1, '05', true], ['fr2026utlizx', 1.2, '04', true], ['fr2026utlfhs', 1.5, null, false], ['fr2026utjaym', 2, '65', true],
      ['fr2026utfxwj', 1.8, '66', true], ['fr2026uszeuk', 2.1, '65', true], ['fr2026usugeu', 2.5, '73', true], ['fr2026usdzpp', 2.2, '64', true],
    ]);
    expect(parsed.quakes[0]).toEqual({
      id: 'fr2026utlsew', at: '2026-10-04T06:16:31.713Z', lat: 44.614, lon: 6.6427, depthKm: 5, magnitude: 1, magType: 'MLv', type: null,
      description: 'Évènement de magnitude 1.0, proche de Gap', status: 'automatique', url: 'https://renass.unistra.fr/fr/evenements/fr2026utlsew',
      dept: '05', distanceKm: 0, inFrance: true, source: 'BCSF-RéNaSS',
    });
    expect(parsed.quakes[6]).toMatchObject({ magnitude: 2.5, depthKm: 8.8, status: 'revu', type: 'earthquake', at: '2026-09-30T17:01:08.994Z' });
    expect(parsed.quakes[2]).toMatchObject({ dept: null, distanceKm: 3.2, inFrance: false });
  });
  it('extrait du contrat (deux événements des Alpes du Sud) lu de même', () => {
    expect(parseBcsf(JSON.parse(BCSF_SHORT), NOW).quakes.map((q) => [q.id, q.dept])).toEqual([['fr2026utlsew', '05'], ['fr2026utlizx', '04']]);
  });
  it('construits : plus de 7 jours écarté ; en mer dans les eaux françaises gardé (département null) ; Suisse écartée ; Gérone gardée hors de France', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        feature('mer', '2026-10-04T03:10:00Z', 43.0, 4.5, 4.3), feature('vieux', '2026-09-27T08:09:00Z', 45.3457, 6.3004, 3.1),
        feature('suisse', '2026-10-04T02:00:00Z', 46.5977, 8.3468, 3.4), feature('gerone', '2026-10-04T01:00:00Z', 42.2, 2.8, 2.0),
        feature('explosion', '2026-10-04T01:30:00Z', 45.3457, 6.3004, 1.0, 'explosion'),
      ],
    };
    const parsed = parseBcsf(fc, NOW);
    expect(parsed.quakes.map((q) => [q.id, q.inFrance, q.dept, q.distanceKm])).toEqual([['mer', true, null, 40.4], ['gerone', false, null, 18.9]]);
    expect(parsed.nonSeismic).toBe(1);
  });
  it('1 000 événements sans atteindre 7 jours : fenêtre incomplète', () => {
    const one = (JSON.parse(BCSF_SHORT) as { features: Array<{ properties: { time: string } }> }).features[0];
    const features = Array.from({ length: 1000 }, (_, i) => ({ ...one, id: `e${i}`, properties: { ...one.properties, time: new Date(NOW - i * 60_000).toISOString() } }));
    expect(parseBcsf({ type: 'FeatureCollection', features }, NOW).complete).toBe(false);
  });
  it('forme inattendue : erreur', () => {
    expect(() => parseBcsf({ events: [] }, NOW)).toThrow('FeatureCollection attendue');
  });
});

describe('repli EMSC', () => {
  it('région en clair, statut automatique (l’EMSC ne publie pas de révision), Italie hors de France à 1,1 km, Pyrénées en France (65)', () => {
    const parsed = parseEmsc(JSON.parse(EMSC), NOW);
    expect(parsed.nonSeismic).toBe(0);
    expect(parsed.quakes).toEqual([
      {
        id: '20261004_0000062', at: '2026-10-04T03:50:59.806Z', lat: 45.8674, lon: 7.0081, depthKm: 7.9, magnitude: 1.5, magType: 'ml', type: 'ke',
        description: 'Northern Italy', status: 'automatique', url: 'https://www.seismicportal.eu/eventdetails.html?unid=20261004_0000062',
        dept: null, distanceKm: 1.1, inFrance: false, source: 'EMSC',
      },
      {
        id: '20261004_0000059', at: '2026-10-04T03:17:08.470Z', lat: 43.0422, lon: -0.1992, depthKm: 4, magnitude: 1.6, magType: 'ml', type: 'ke',
        description: 'Pyrenees', status: 'automatique', url: 'https://www.seismicportal.eu/eventdetails.html?unid=20261004_0000059',
        dept: '65', distanceKm: 0, inFrance: true, source: 'EMSC',
      },
    ]);
  });
});

describe('repli EMSC : événements non sismiques', () => {
  it('types autres que ke et se comptés à part, séismes gardés', () => {
    const fc = JSON.parse(EMSC) as { features: Array<{ properties: Record<string, unknown> }> };
    const blast = structuredClone(fc.features[1]);
    blast.properties = { ...blast.properties, evtype: 'qb', unid: 'qb1' };
    const parsed = parseEmsc({ ...fc, features: [...fc.features, blast] }, NOW);
    expect([parsed.nonSeismic, parsed.quakes.length]).toEqual([1, 2]);
  });
});

describe('/api/environment/earthquakes', () => {
  it('200, cache 5 min ; BCSF-RéNaSS ; tirs de carrière comptés à part ; relevé du serveur', async () => {
    const log = sources();
    const { status, body, cache } = await callHandler<EarthquakesResponse>(handler);
    expect([status, cache]).toEqual([200, CACHE_CONTROL]);
    expect(body).toMatchObject({ readAt: '2026-10-04T08:10:00.000Z', source: 'BCSF-RéNaSS', nonSeismic: 1, errors: [] });
    expect(body.quakes).toHaveLength(8);
    expect(log.urls).toEqual([BCSF_URL]);
  });
  it('BCSF en panne : repli EMSC sur 7 jours, panne nommée', async () => {
    const log = sources({ bcsf: respond('Internal Server Error', 500) });
    const { status, body } = await callHandler<EarthquakesResponse>(handler);
    expect([status, body.source, body.errors, body.quakes.length]).toEqual([200, 'EMSC', ['BCSF-RéNaSS : HTTP 500'], 2]);
    expect(log.urls[1]).toBe(emscUrl('2026-09-27T08:10:00.000Z'));
  });
  it('BCSF incomplet (1 000 événements de moins de 7 jours) : repli EMSC, panne nommée', async () => {
    const one = (JSON.parse(BCSF_SHORT) as { features: Array<{ properties: { time: string } }> }).features[0];
    const features = Array.from({ length: 1000 }, (_, i) => ({ ...one, id: `e${i}`, properties: { ...one.properties, time: new Date(NOW - i * 60_000).toISOString() } }));
    sources({ bcsf: respond({ type: 'FeatureCollection', features }) });
    const { body } = await callHandler<EarthquakesResponse>(handler);
    expect([body.source, body.errors]).toEqual(['EMSC', ['BCSF-RéNaSS : fenêtre de 7 jours incomplète']]);
  });
  it('les deux en panne : 502 non mis en cache, deux erreurs nommées, aucune liste vide présentée comme « aucun séisme »', async () => {
    sources({ bcsf: respond('Internal Server Error', 500), emsc: respond('Service Unavailable', 503) });
    const { status, body, cache } = await callHandler<EarthquakesResponse>(handler);
    expect([status, cache]).toEqual([502, 'no-store']);
    expect(body).toEqual({ readAt: null, source: null, quakes: [], nonSeismic: 0, errors: ['BCSF-RéNaSS : HTTP 500', 'EMSC (repli) : HTTP 503'] });
  });
  it('BCSF en panne avec valeur périmée en cache : EMSC servi, panne nommée (jamais silencieuse)', async () => {
    sources();
    await callHandler<EarthquakesResponse>(handler);
    vi.setSystemTime(NOW + 20 * 60_000);
    sources({ bcsf: respond('Internal Server Error', 500) });
    const { status, body } = await callHandler<EarthquakesResponse>(handler);
    expect([status, body.source]).toEqual([200, 'EMSC']);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toContain('BCSF-RéNaSS');
  });
  it('BCSF et EMSC en panne avec valeur périmée : valeur BCSF servie avec sa date d’origine et deux pannes nommées', async () => {
    sources();
    await callHandler<EarthquakesResponse>(handler);
    vi.setSystemTime(NOW + 20 * 60_000);
    sources({ bcsf: respond('Internal Server Error', 500), emsc: respond('Service Unavailable', 503) });
    const { status, body } = await callHandler<EarthquakesResponse>(handler);
    expect([status, body.source, body.readAt, body.quakes.length]).toEqual([200, 'BCSF-RéNaSS', '2026-10-04T08:10:00.000Z', 8]);
    expect(body.errors).toHaveLength(2);
    expect(body.errors[1]).toBe('EMSC (repli) : HTTP 503');
  });
});
