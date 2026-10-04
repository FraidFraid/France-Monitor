// tests/environment-air-api.test.ts
// /api/environment/air (spec 2026-10-04 environnement § 3.2, contrats § 2.7, arbitrages 6 à 9) : WFS Atmo France TOUJOURS filtré en
// CQL (une requête sans filtre a renvoyé 285 Mo) ; garde « réponse WFS non filtrée » ; épisodes J à J+2, indice agrégé par département.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import {
  ATMO_EPISODES_BASE, ATMO_INDEX_BASE, MAX_BODY_CHARS, addDays, aggregateIndex, airQualityTtlSec, episodeState, episodesUrl, indexUrl, normalizePollutant,
  parseEpisodes,
} from '../api/_lib/atmo.js';
import handler, { CACHE_CONTROL } from '../api/_handlers/environment/air.js';
import type { AirQualityResponse } from '../src/types/index.ts';
import { type FakeResponse, callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';

const env = (name: string): string => readFileSync(new URL(`./fixtures/environment/${name}`, import.meta.url), 'utf8');
const EPISODES = env('atmo-episodes-alrt3j-extrait.json');
const PARIS = JSON.parse(env('atmo-indice-paris.json')) as { features: Array<{ properties: Record<string, unknown> }> };
const NOW = Date.parse('2026-10-04T08:10:00Z');
const DAYS = ['2026-10-04', '2026-10-05', '2026-10-06'];

beforeEach(() => { __resetSwrCacheForTests(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function indexFeature(code_zone: string, code_qual: number, date_maj = '2026-10-03T14:02:11.000Z', date_ech = '2026-10-04') {
  return { type: 'Feature', geometry: null, properties: { code_zone, code_qual, date_maj, date_ech } };
}

/** Indice de J : Paris réel (75056), puis Marseille (avec un doublon), Nice, Ajaccio, Les Abymes, une zone intercommunale (SIREN). */
function indexFc(): object {
  const paris = PARIS.features.find((f) => f.properties['date_ech'] === '2026-10-04');
  return {
    type: 'FeatureCollection', numberMatched: 7, numberReturned: 7,
    features: [
      paris, indexFeature('13055', 3), indexFeature('13055', 3), indexFeature('06088', 4), indexFeature('2A004', 2, '2026-10-03T15:10:00.000Z'),
      indexFeature('97105', 1, '2026-10-03T17:05:31.097Z'), indexFeature('249730045', 1, '2026-10-03T17:05:31.097Z'),
    ],
  };
}

function episodeFeature(p: Record<string, string>) {
  return { type: 'Feature', geometry: null, properties: { date_maj: '2026-10-03T13:20:00.000Z', date_dif: '2026-10-04T00:00:00Z', ...p } };
}

const ALERTS = {
  type: 'FeatureCollection', numberMatched: 4,
  features: [
    episodeFeature({ etat: 'ALERTE SUR PERSISTANCE', lib_zone: 'BOUCHES-DU-RHONE', code_zone: '13', lib_pol: 'Ozone', code_pol: '7', date_ech: '2026-10-05' }),
    episodeFeature({ etat: 'PROCEDURE D\'INFORMATION-RECOMMANDATION', lib_zone: 'VAR', code_zone: '83', lib_pol: 'O3', code_pol: '7', date_ech: '2026-10-04' }),
    episodeFeature({ etat: 'PAS DE DEPASSEMENT', lib_zone: 'VAR', code_zone: '83', lib_pol: 'Particules PM10', code_pol: '5', date_ech: '2026-10-04' }),
    episodeFeature({ etat: 'VIGILANCE', lib_zone: 'ALPES-MARITIMES', code_zone: '06', lib_pol: 'Dioxyde d\'azote', code_pol: '8', date_ech: '2026-10-06' }),
  ],
};

function sources(over: { episodes?: FakeResponse; index?: FakeResponse } = {}) {
  return stubFetch((url) => {
    if (url.startsWith(ATMO_EPISODES_BASE)) return over.episodes ?? respond(EPISODES);
    if (url.startsWith(ATMO_INDEX_BASE)) return over.index ?? respond(indexFc());
    return respond('introuvable', 404);
  });
}

describe('requêtes WFS : toujours filtrées par date (CQL) et réduites (propertyName)', () => {
  it('épisodes J à J+2, indice de J', () => {
    const e = new URL(episodesUrl('2026-10-04', '2026-10-06')).searchParams;
    expect(Object.fromEntries(e)).toEqual({
      service: 'WFS', version: '2.0.0', request: 'GetFeature', typeName: 'alrt:alrt3j', outputFormat: 'application/json',
      propertyName: 'date_maj,etat,lib_zone,code_zone,lib_pol,code_pol,date_ech', cql_filter: 'date_ech>=\'2026-10-04\' AND date_ech<=\'2026-10-06\'',
    });
    const i = new URL(indexUrl('2026-10-04')).searchParams;
    expect([i.get('typeName'), i.get('propertyName'), i.get('cql_filter')]).toEqual(['ind:ind_atmo_2021', 'code_zone,code_qual,date_maj,date_ech', 'date_ech=\'2026-10-04\'']);
  });
  it('jours civils sans fuseau (changement d’heure du 25/10) ; relève horaire de 13 h à 19 h (Paris), 6 h sinon', () => {
    expect([addDays('2026-10-24', 1), addDays('2026-10-24', 2), addDays('2026-12-31', 1)]).toEqual(['2026-10-25', '2026-10-26', '2027-01-01']);
    expect(airQualityTtlSec(Date.parse('2026-10-04T11:00:00Z'))).toBe(3_600);
    expect(airQualityTtlSec(Date.parse('2026-10-04T12:00:00Z'))).toBe(3_600);
    expect(airQualityTtlSec(NOW)).toBe(21_600);
    expect(airQualityTtlSec(Date.parse('2026-10-04T17:00:00Z'))).toBe(21_600);
  });
});

describe('épisodes', () => {
  it('états : « PAS DE DEPASSEMENT » n’est pas un épisode ; alerte, information-recommandation, sinon inconnu', () => {
    expect(['PAS DE DEPASSEMENT', 'ALERTE SUR PERSISTANCE', 'PROCEDURE D\'INFORMATION-RECOMMANDATION', 'RECOMMANDATION', 'VIGILANCE', ''].map(episodeState))
      .toEqual([null, 'alerte', 'information', 'information', 'inconnu', 'inconnu']);
  });
  it('polluants regroupés par nom (libellés réels du 04/10, codes hétérogènes selon les AASQA)', () => {
    const real: Array<[string, string, string]> = [
      ['5', 'Particules PM10', 'PM10'], ['24', 'Particules PM10', 'PM10'], ['5', 'PARTICULES PM10', 'PM10'], ['5', 'PM10', 'PM10'],
      ['5', 'Particules fines inférieur à 10 um', 'PM10'], ['5', 'Particules, diamètre < 10 µm', 'PM10'], ['5', 'Particules fines PM10', 'PM10'],
      ['6001', 'Particules fines PM2.5', 'PM2.5'], ['7', 'Ozone', 'O3'], ['08', 'Ozone', 'O3'], ['7', 'OZONE', 'O3'], ['7', 'O3', 'O3'], ['null', 'Ozone', 'O3'],
      ['8', 'Dioxyde d\'azote', 'NO2'], ['03', 'Dioxyde d\'azote', 'NO2'], ['8', 'Dioxydes d azote', 'NO2'], ['8', 'NO2', 'NO2'], ['1', 'Dioxyde de soufre', 'SO2'],
    ];
    for (const [code, label, expected] of real) expect(normalizePollutant(code, label).code).toBe(expected);
    expect(normalizePollutant('7', 'Ozone').label).toBe('ozone');
    expect(normalizePollutant('99', 'Benzène')).toEqual({ code: '99', label: 'Benzène' });
  });
  it('fixture réelle (J, aucun dépassement) : aucun épisode, barres à zéro pour les polluants publiés, date de mise à jour', () => {
    expect(parseEpisodes(JSON.parse(EPISODES), DAYS)).toEqual({
      updatedAt: '2026-10-03T13:29:04.796Z', zonesCovered: 1, episodes: [],
      perPollutant: [
        { pollutantCode: 'O3', pollutant: 'ozone', days: [{ date: '2026-10-04', information: 0, alerte: 0 }] },
        { pollutantCode: 'NO2', pollutant: 'dioxyde d’azote', days: [{ date: '2026-10-04', information: 0, alerte: 0 }] },
      ],
    });
  });
  it('épisodes construits : tri par jour puis état ; état publié gardé ; barres par polluant et par jour publié', () => {
    const parsed = parseEpisodes(ALERTS, DAYS);
    expect(parsed.episodes.map((e) => [e.date, e.zone, e.pollutantCode, e.state, e.stateRaw])).toEqual([
      ['2026-10-04', 'VAR', 'O3', 'information', 'PROCEDURE D\'INFORMATION-RECOMMANDATION'],
      ['2026-10-05', 'BOUCHES-DU-RHONE', 'O3', 'alerte', 'ALERTE SUR PERSISTANCE'],
      ['2026-10-06', 'ALPES-MARITIMES', 'NO2', 'inconnu', 'VIGILANCE'],
    ]);
    expect(parsed.episodes[0]).toMatchObject({ zoneCode: '83', pollutant: 'ozone', updatedAt: '2026-10-03T13:20:00.000Z' });
    expect(parsed.perPollutant).toEqual([
      { pollutantCode: 'PM10', pollutant: 'particules PM10', days: [{ date: '2026-10-04', information: 0, alerte: 0 }] },
      { pollutantCode: 'O3', pollutant: 'ozone', days: [{ date: '2026-10-04', information: 1, alerte: 0 }, { date: '2026-10-05', information: 0, alerte: 1 }] },
      { pollutantCode: 'NO2', pollutant: 'dioxyde d’azote', days: [{ date: '2026-10-06', information: 0, alerte: 0 }] },
    ]);
    expect(parsed.zonesCovered).toBe(3);
  });
});

describe('indice ATMO agrégé par département (arbitrage 7)', () => {
  it('communes INSEE seulement (zone intercommunale écartée), doublon gardé au plus haut, DROM sur trois caractères, Corse 2A', () => {
    expect(aggregateIndex(indexFc(), '2026-10-04')).toEqual({
      date: '2026-10-04', updatedAt: '2026-10-03T17:05:31.097Z', communes: 5,
      departments: [
        { dept: '06', name: 'Alpes-Maritimes', communes: 1, degrade: 0, mauvais: 1, tresMauvaisEtPlus: 0, maxIndex: 4 },
        { dept: '13', name: 'Bouches-du-Rhône', communes: 1, degrade: 1, mauvais: 0, tresMauvaisEtPlus: 0, maxIndex: 3 },
        { dept: '2A', name: 'Corse-du-Sud', communes: 1, degrade: 0, mauvais: 0, tresMauvaisEtPlus: 0, maxIndex: 2 },
        { dept: '75', name: 'Paris', communes: 1, degrade: 0, mauvais: 0, tresMauvaisEtPlus: 0, maxIndex: 2 },
        { dept: '971', name: 'Guadeloupe', communes: 1, degrade: 0, mauvais: 0, tresMauvaisEtPlus: 0, maxIndex: 1 },
      ],
    });
  });
  it('aucune commune : date null (indice non encore publié)', () => {
    expect(aggregateIndex({ type: 'FeatureCollection', features: [] }, '2026-10-04')).toEqual({ date: null, updatedAt: null, communes: 0, departments: [] });
  });
});

describe('/api/environment/air', () => {
  it('200, cache 30 min ; épisodes et indice ; chaque URL appelée porte un filtre CQL et un propertyName', async () => {
    const log = sources();
    const { status, body, cache } = await callHandler<AirQualityResponse>(handler);
    expect([status, cache]).toEqual([200, CACHE_CONTROL]);
    expect(body).toEqual({
      days: DAYS, episodesUpdatedAt: '2026-10-03T13:29:04.796Z', zonesCovered: 1, episodes: [],
      perPollutant: [
        { pollutantCode: 'O3', pollutant: 'ozone', days: [{ date: '2026-10-04', information: 0, alerte: 0 }] },
        { pollutantCode: 'NO2', pollutant: 'dioxyde d’azote', days: [{ date: '2026-10-04', information: 0, alerte: 0 }] },
      ],
      index: aggregateIndex(indexFc(), '2026-10-04'),
      readAt: '2026-10-04T08:10:00.000Z', errors: [],
    });
    expect(log.urls).toHaveLength(2);
    for (const u of log.urls) {
      const q = new URL(u).searchParams;
      expect(q.get('cql_filter')).toMatch(/^date_ech/);
      expect(q.get('propertyName')).not.toBeNull();
    }
  });
  it('garde « réponse WFS non filtrée » : trop d’entités annoncées ; une date hors du filtre ; corps de plus de 30 Mo', async () => {
    sources({ index: respond({ type: 'FeatureCollection', numberMatched: 285_000, features: [] }) });
    const many = await callHandler<AirQualityResponse>(handler);
    expect([many.status, many.body.errors, many.body.index.communes]).toEqual([200, ['Atmo France, indice : réponse WFS non filtrée (285000 entités)'], 0]);
    __resetSwrCacheForTests();
    sources({ index: respond(env('atmo-indice-paris.json')) });
    expect((await callHandler<AirQualityResponse>(handler)).body.errors).toEqual(['Atmo France, indice : réponse WFS non filtrée (date 2026-10-03 hors du filtre)']);
    __resetSwrCacheForTests();
    sources({ index: respond(`${' '.repeat(MAX_BODY_CHARS)}{"type":"FeatureCollection","features":[]}`) });
    expect((await callHandler<AirQualityResponse>(handler)).body.errors).toEqual(['Atmo France, indice : réponse WFS non filtrée (corps de plus de 30 Mo)']);
  });
  it('panne partielle : épisodes en 500, indice servi ; jamais « aucun épisode » dans la réponse (episodesUpdatedAt null)', async () => {
    sources({ episodes: respond('erreur', 500) });
    const { status, body, cache } = await callHandler<AirQualityResponse>(handler);
    expect([status, body.errors, body.episodesUpdatedAt, body.index.communes]).toEqual([200, ['Atmo France, épisodes : HTTP 500'], null, 5]);
    expect(cache).toBe('s-maxage=300, stale-while-revalidate=600');
  });
  it('rien de lu : 502 non mis en cache, deux erreurs nommées ; page HTML nommée', async () => {
    sources({ episodes: respond('erreur', 500), index: respond('<!DOCTYPE html><html><body>GeoServer</body></html>') });
    const { status, body, cache } = await callHandler<AirQualityResponse>(handler);
    expect([status, cache]).toEqual([502, 'no-store']);
    expect(body.errors).toEqual(['Atmo France, épisodes : HTTP 500', 'Atmo France, indice : page HTML reçue au lieu de données']);
    expect(body.readAt).toBeNull();
  });
});
