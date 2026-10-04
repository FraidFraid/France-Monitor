// src/services/environment-levels-b.test.ts
// Pastilles des panneaux Sécheresse, Qualité de l'air et Séismes (spec 2026-10-04 environnement § 3.1 à 3.3, contrats § 3.1,
// amendements 2 et 6) : fonctions pures, valeurs réelles du 04/10/2026.
import { describe, expect, it } from 'vitest';
import type { AirEpisode, AirQualityResponse, DroughtResponse, EarthquakesResponse, Quake } from '../types/index.ts';
import { airQualityLevel, droughtLevel, earthquakesLevel, isEnvironmentDataLate, magnitudeText, quakeInFrance, quakePlace } from './environment-levels.ts';

const NOW = Date.parse('2026-10-04T08:10:00Z');

function drought(counts: Partial<DroughtResponse['counts']>, departments = 101): DroughtResponse {
  return {
    asOf: '2026-10-04T00:43:59.771Z',
    departments: Array.from({ length: departments }, (_, i) => ({
      dept: String(i + 1).padStart(2, '0'), name: `Département ${i + 1}`, region: '', available: true, max: null, superficielle: null, souterraine: null, potable: null,
    })),
    counts: { vigilance: 0, alerte: 0, alerte_renforcee: 0, crise: 0, aucun: 0, ...counts },
    history: { days: [], since: null }, readAt: '2026-10-04T08:05:00.000Z', errors: [],
  };
}

function episode(over: Partial<AirEpisode>): AirEpisode {
  return {
    zoneCode: '13', zone: 'BOUCHES-DU-RHONE', pollutantCode: 'O3', pollutant: 'ozone', date: '2026-10-05', state: 'alerte',
    stateRaw: 'ALERTE SUR PERSISTANCE', updatedAt: '2026-10-04T13:20:00.000Z', ...over,
  };
}

function air(over: Partial<AirQualityResponse> = {}): AirQualityResponse {
  return {
    days: ['2026-10-04', '2026-10-05', '2026-10-06'], episodesUpdatedAt: '2026-10-03T18:05:06.763Z', zonesCovered: 101, episodes: [], perPollutant: [],
    index: {
      date: '2026-10-04', updatedAt: '2026-10-03T13:36:32.507Z', communes: 26_663,
      departments: [{ dept: '13', name: 'Bouches-du-Rhône', communes: 135, degrade: 135, mauvais: 0, tresMauvaisEtPlus: 0, maxIndex: 3 }],
    },
    readAt: '2026-10-04T08:05:00.000Z', errors: [], ...over,
  };
}

function quake(over: Partial<Quake>): Quake {
  return {
    id: 'fr2026usugeu', at: '2026-09-30T17:01:08.994Z', lat: 45.3457, lon: 6.3004, depthKm: 8.8, magnitude: 2.5, magType: 'MLv', type: 'earthquake',
    description: 'Tremblement de terre de magnitude 2.5, proche de Albertville', status: 'revu', url: 'https://renass.unistra.fr/fr/evenements/fr2026usugeu',
    dept: '73', distanceKm: 0, inFrance: true, source: 'BCSF-RéNaSS', ...over,
  };
}

function quakes(list: Quake[], readAt: string | null = '2026-10-04T08:05:00.000Z'): EarthquakesResponse {
  return { readAt, source: readAt === null ? null : 'BCSF-RéNaSS', quakes: list, nonSeismic: 0, errors: [] };
}

describe('droughtLevel (§ 3.1) : crise rouge, alerte renforcée orange, alerte jaune, vert sinon ; la vigilance ne colore pas', () => {
  it('04/10 : 79 départements en crise, rouge', () => {
    expect(droughtLevel(drought({ crise: 79, alerte_renforcee: 14, alerte: 3, vigilance: 3, aucun: 0 }))).toEqual({ level: 'rouge', reason: '79 départements en crise' });
  });
  it('sans crise : orange en alerte renforcée, puis jaune en alerte ; un seul département au singulier', () => {
    expect(droughtLevel(drought({ alerte_renforcee: 1, alerte: 3 }))).toEqual({ level: 'orange', reason: '1 département en alerte renforcée' });
    expect(droughtLevel(drought({ alerte: 3, vigilance: 40 }))).toEqual({ level: 'jaune', reason: '3 départements en alerte' });
  });
  it('vigilance seule : vert (la vigilance n’est pas une restriction)', () => {
    expect(droughtLevel(drought({ vigilance: 12, aucun: 89 }))).toEqual({ level: 'vert', reason: 'aucune restriction au-delà de la vigilance' });
  });
  it('aucune réponse lue : n.d.', () => {
    expect(droughtLevel(drought({}, 0))).toEqual({ level: 'nd', reason: 'arrêtés VigiEau indisponibles' });
  });
});

describe('airQualityLevel (§ 3.2) : alerte rouge, information orange, indice 4 ou pire jaune, vert sinon', () => {
  it('04/10 : aucun épisode, 4 920 communes en indice dégradé (3) : vert', () => {
    expect(airQualityLevel(air())).toEqual({ level: 'vert', reason: 'aucun épisode de pollution prévu' });
  });
  it('un épisode au seuil d’alerte : rouge, polluant et zone nommés ; les autres comptés', () => {
    const a = air({ episodes: [episode({}), episode({ zone: 'VAR', zoneCode: '83' })] });
    expect(airQualityLevel(a)).toEqual({ level: 'rouge', reason: 'seuil d’alerte : ozone, BOUCHES-DU-RHONE et 1 autre' });
  });
  it('information-recommandation seule : orange ; état non reconnu : ne colore pas', () => {
    expect(airQualityLevel(air({ episodes: [episode({ state: 'information', stateRaw: 'PROCEDURE D’INFORMATION-RECOMMANDATION' })] })))
      .toEqual({ level: 'orange', reason: 'information-recommandation : ozone, BOUCHES-DU-RHONE' });
    expect(airQualityLevel(air({ episodes: [episode({ state: 'inconnu', stateRaw: 'VIGILANCE' })] })).level).toBe('vert');
  });
  it('une commune en indice mauvais (4) : jaune', () => {
    const a = air();
    a.index.departments = [{ dept: '06', name: 'Alpes-Maritimes', communes: 163, degrade: 150, mauvais: 2, tresMauvaisEtPlus: 0, maxIndex: 4 }];
    expect(airQualityLevel(a)).toEqual({ level: 'jaune', reason: '2 communes en indice mauvais ou pire' });
  });
  it('épisodes illisibles mais indice lu : niveau de l’indice, panne dite ; les deux absents : n.d.', () => {
    expect(airQualityLevel(air({ episodesUpdatedAt: null })).reason).toBe('épisodes indisponibles ; aucune commune en indice mauvais');
    const none = air({ episodesUpdatedAt: null });
    none.index = { date: null, updatedAt: null, communes: 0, departments: [] };
    expect(airQualityLevel(none)).toEqual({ level: 'nd', reason: 'Atmo France indisponible' });
  });
});

describe('séismes (§ 3.3, amendements 2 et 6) : 72 h, en France seulement', () => {
  it('quakeInFrance lit le polygone (inFrance), jamais la distance seule', () => {
    expect(quakeInFrance(quake({}))).toBe(true);
    expect(quakeInFrance(quake({ inFrance: false, dept: null, distanceKm: 1.1 }))).toBe(false);
  });
  it('quakePlace : « proche de … » de la description, sinon la description', () => {
    expect(quakePlace(quake({}))).toBe('proche de Albertville');
    expect(quakePlace({ description: 'Évènement de magnitude 1.0, proche de Gap' })).toBe('proche de Gap');
    expect(quakePlace({ description: 'Pyrenees' })).toBe('Pyrenees');
    expect(magnitudeText(4.3)).toBe('4,3');
  });
  it('04/10 : plus forte magnitude en France sur 72 h 2,1 (Pau, 01/10 17:10) : vert ; Albertville (30/09) hors fenêtre', () => {
    const list = [
      quake({ id: 'fr2026uszeuk', at: '2026-10-01T17:10:02.149Z', magnitude: 2.1, dept: '65', description: 'Tremblement de terre de magnitude 2.1, proche de Pau' }),
      quake({}),
    ];
    expect(earthquakesLevel(quakes(list), NOW)).toEqual({ level: 'vert', reason: 'aucun séisme de magnitude 3 ou plus en France sur 72 h' });
  });
  it('seuils : jaune dès 3, orange dès 4, rouge dès 5 ; hors de France jamais ; plus de 72 h jamais', () => {
    const at = '2026-10-04T03:10:00.000Z';
    const gap = (magnitude: number): Quake => quake({ id: `m${magnitude}`, at, magnitude, dept: '05', description: `Tremblement de terre de magnitude ${magnitude}, proche de Gap` });
    expect(earthquakesLevel(quakes([gap(3)]), NOW)).toEqual({ level: 'jaune', reason: 'séisme de magnitude 3,0 proche de Gap' });
    expect(earthquakesLevel(quakes([gap(4.3)]), NOW)).toEqual({ level: 'orange', reason: 'séisme de magnitude 4,3 proche de Gap' });
    expect(earthquakesLevel(quakes([gap(4.3), gap(5.1)]), NOW).level).toBe('rouge');
    expect(earthquakesLevel(quakes([quake({ at, magnitude: 5.4, inFrance: false, dept: null, distanceKm: 3.2 })]), NOW).level).toBe('vert');
    expect(earthquakesLevel(quakes([quake({ at: '2026-10-01T08:09:00.000Z', magnitude: 5.4 })]), NOW).level).toBe('vert');
  });
  it('aucun relevé : n.d.', () => {
    expect(earthquakesLevel(quakes([], null), NOW)).toEqual({ level: 'nd', reason: 'BCSF-RéNaSS et EMSC indisponibles' });
  });
});

describe('retards de la phase B (S2) : VigiEau et Atmo 36 h, BCSF et SHOM 30 min', () => {
  it('seuils du tableau', () => {
    expect(isEnvironmentDataLate('vigieau', '2026-10-04T00:43:59.771Z', NOW)).toBe(false);
    expect(isEnvironmentDataLate('vigieau', '2026-10-04T00:43:59.771Z', Date.parse('2026-10-05T12:45:00Z'))).toBe(true);
    expect(isEnvironmentDataLate('atmo', '2026-10-03T18:05:06.763Z', NOW)).toBe(false);
    expect(isEnvironmentDataLate('bcsf', '2026-10-04T07:39:00.000Z', NOW)).toBe(true);
    expect(isEnvironmentDataLate('refmar', '2026-10-04T07:41:00.000Z', NOW)).toBe(false);
  });
});
