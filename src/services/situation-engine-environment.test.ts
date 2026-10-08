// Situations de la phase B (spec 2026-10-04 environnement § 3.2, § 3.3 ; contrats § 6 ; amendements 2 et 6) : séisme de magnitude 4 ou
// plus en France sur 72 h (medium, high dès 5, plafond 78) ; épisode au seuil d'alerte en J ou J+1 (medium, sans plafond). La
// sécheresse (stock, E2) n'entre nulle part. Formule et cibles du score inchangées (france-country-intel.test.ts n'est pas touché).
// Une source en retard ou en panne ne crée ni ne garde de situation (entrées servies par environment-inputs.ts).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AirEpisode, Quake } from '../types/index.ts';
import { AIR_FIXTURE, QUAKES_FIXTURE } from '../components/layer-panel/environment.fixture.ts';
import { servedAirEpisodes, servedQuakes } from './environment-inputs.ts';
import { scoreFromPillars, type FranceRawData } from './france-country-intel.ts';
import { detectAirPollution, detectSeismicEvents, detectSituations } from './situation-engine.ts';
import { situationTheme } from './themes.ts';

const NOW = Date.parse('2026-10-04T08:10:00Z');
const NBSP = ' ';

function baseRawData(overrides: Partial<FranceRawData> = {}): FranceRawData {
  return {
    newsItems: [], isnrData: null, cyber: null, meteoAlerts: [], floodSegments: [], railTrains: [], roadEvents: [], urbanJamCount: 0, powerOutages: [],
    telecomOutages: [], cableAlerts: [], gnssDegraded: null, militaryFlightsCount: 0, maritimeCount: 0, activeFires: [], marketData: [], ecowattResponse: null,
    gasState: null, nuclearState: null, eolienLive: null, aisAnomalies: [], timeline: { days: [], lanes: [] }, briefLang: 'fr', oilDashboard: null,
    fuelTensionDashboard: null, ...overrides,
  };
}

function quake(magnitude: number, over: Partial<Quake> = {}): Quake {
  return {
    id: `fort-${magnitude}`, at: '2026-10-04T03:10:00.000Z', lat: 44.56, lon: 6.08, depthKm: 7, magnitude, magType: 'MLv', type: 'earthquake',
    description: `Tremblement de terre de magnitude ${magnitude}, proche de Gap`, status: 'automatique', url: 'https://renass.unistra.fr/fr/evenements/test',
    dept: '05', distanceKm: 0, inFrance: true, source: 'BCSF-RéNaSS', ...over,
  };
}

function episode(over: Partial<AirEpisode>): AirEpisode {
  return {
    zoneCode: '13', zone: 'BOUCHES-DU-RHONE', pollutantCode: 'O3', pollutant: 'ozone', date: '2026-10-05', state: 'alerte',
    stateRaw: 'ALERTE SUR PERSISTANCE', updatedAt: '2026-10-03T13:20:00.000Z', ...over,
  };
}

const ZERO = { continuity: 0, security: 0, signal: 0, defense: 0, shock: 0 };

describe('SEISMIC_EVENT : magnitude 4 ou plus en France sur 72 h', () => {
  it('04/10 réel : aucun séisme de magnitude 4 ou plus, aucune situation', () => {
    expect(detectSeismicEvents(baseRawData({ quakes: structuredClone(QUAKES_FIXTURE.quakes) }), NOW)).toEqual([]);
  });
  it('M 4,3 près de Gap il y a 5 h : une situation moyenne, titre, zone, position, couche à ouvrir, source', () => {
    const [s] = detectSeismicEvents(baseRawData({ quakes: [...QUAKES_FIXTURE.quakes, quake(4.3)] }), NOW);
    expect(s).toMatchObject({
      id: 'seismic-fort-4.3', type: 'SEISMIC_EVENT', severity: 'medium', confidence: 0.75, title: 'Séisme de magnitude 4,3 proche de Gap',
      affectedZones: ['Dépt 05'], lat: 44.56, lon: 6.08, activateLayers: ['earthquakes'], sourceRefs: ['BCSF-RéNaSS'], linkUrl: 'https://renass.unistra.fr/fr/evenements/test',
    });
    expect(s?.summary).toBe(`Magnitude 4,3 (MLv), profondeur 7${NBSP}km, le 04/10 à 05:10 (heure de Paris), automatique, à confirmer.`);
  });
  it('M 5,1 revu : sévérité élevée, confiance 0,9 ; en mer dans les eaux françaises : distance aux côtes ; repli EMSC nommé', () => {
    const strong = detectSeismicEvents(baseRawData({ quakes: [quake(5.1, { status: 'revu' })] }), NOW);
    expect(strong[0]).toMatchObject({ severity: 'high', confidence: 0.9 });
    const sea = detectSeismicEvents(baseRawData({ quakes: [quake(4.5, { id: 'mer', dept: null, distanceKm: 40.4, description: 'Golfe du Lion', source: 'EMSC' })] }), NOW);
    expect(sea[0]).toMatchObject({ title: 'Séisme de magnitude 4,5 Golfe du Lion', affectedZones: [`en mer, à 40${NBSP}km des côtes`], sourceRefs: ['EMSC'] });
  });
  it('jamais : hors de France (Italie près de la frontière, M 4,8 à 1,1 km en repli EMSC), sous 4, plus de 72 h, dans le futur', () => {
    const quakes = [
      quake(4.8, { id: 'italie', inFrance: false, dept: null, distanceKm: 3.2 }),
      quake(4.8, { id: 'italie-emsc', inFrance: false, dept: null, distanceKm: 1.1, description: 'NORTHERN ITALY', source: 'EMSC' }),
      quake(3.9, { id: 'faible' }),
      quake(4.6, { id: 'ancien', at: '2026-10-01T08:09:00.000Z' }), quake(4.6, { id: 'futur', at: '2026-10-04T09:00:00.000Z' }),
    ];
    expect(detectSeismicEvents(baseRawData({ quakes }), NOW)).toEqual([]);
    expect(detectSituations(baseRawData({ quakes }), NOW).filter((s) => s.type === 'SEISMIC_EVENT')).toEqual([]);
  });
});

describe('AIR_POLLUTION_EPISODE : épisode au seuil d’alerte en J ou J+1', () => {
  it('04/10 réel : aucun épisode, aucune situation', () => {
    expect(detectAirPollution(baseRawData({ airEpisodes: structuredClone(AIR_FIXTURE.episodes) }), NOW)).toBeNull();
  });
  it('alerte à l’ozone demain dans les Bouches-du-Rhône : une situation moyenne, zone et polluant nommés', () => {
    const s = detectAirPollution(baseRawData({ airEpisodes: [episode({}), episode({ zone: 'VAR', zoneCode: '83', state: 'information', stateRaw: 'INFORMATION' })] }), NOW);
    expect(s).toMatchObject({
      id: 'air-pollution', type: 'AIR_POLLUTION_EPISODE', severity: 'medium', title: 'Épisode de pollution au seuil d’alerte : ozone',
      affectedZones: ['BOUCHES-DU-RHONE'], activateLayers: ['airQuality'], sourceRefs: ['Atmo France'],
    });
    expect(s?.summary).toBe('1 procédure d’alerte (ozone) demain ; niveaux publiés par les AASQA (Atmo France).');
  });
  it('jamais : information seule, alerte en J+2', () => {
    expect(detectAirPollution(baseRawData({ airEpisodes: [episode({ state: 'information', stateRaw: 'INFORMATION' })] }), NOW)).toBeNull();
    expect(detectAirPollution(baseRawData({ airEpisodes: [episode({ date: '2026-10-06' })] }), NOW)).toBeNull();
  });
});

describe('entrées : une source en retard ou en panne ne crée ni ne garde de situation', () => {
  const quakes = { ...structuredClone(QUAKES_FIXTURE), quakes: [...structuredClone(QUAKES_FIXTURE.quakes), quake(4.3)] };
  const air = { ...structuredClone(AIR_FIXTURE), episodes: [episode({})] };

  it('séismes : relevé du serveur de moins de 30 min servi ; au-delà, absent ou jamais lu : aucun séisme', () => {
    expect(detectSeismicEvents(baseRawData({ quakes: servedQuakes(quakes, NOW) }), NOW)).toHaveLength(1);
    const late = Date.parse('2026-10-04T08:36:00Z');   // relevé de 08:05 + 31 min ; le séisme de 03:10 est encore dans les 72 h
    expect(servedQuakes(quakes, late)).toEqual([]);
    expect(detectSeismicEvents(baseRawData({ quakes: servedQuakes(quakes, late) }), late)).toEqual([]);
    expect(servedQuakes({ ...quakes, readAt: null }, NOW)).toEqual([]);
    expect(servedQuakes(null, NOW)).toEqual([]);
  });
  it('épisodes : couche lue et à jour servie ; couche des épisodes en panne (indice seul lu) ou en retard : aucun épisode', () => {
    expect(detectAirPollution(baseRawData({ airEpisodes: servedAirEpisodes(air, NOW) }), NOW)).not.toBeNull();
    expect(servedAirEpisodes({ ...air, episodesUpdatedAt: null }, NOW)).toEqual([]);
    const late = Date.parse('2026-10-05T06:10:00Z');   // date_maj du 03/10 18:05 + 36 h dépassée ; le 05/10 serait « aujourd’hui »
    expect(servedAirEpisodes(air, late)).toEqual([]);
    expect(detectAirPollution(baseRawData({ airEpisodes: servedAirEpisodes(air, late) }), late)).toBeNull();
    expect(servedAirEpisodes(null, NOW)).toEqual([]);
  });
});

describe('moteur et score (formule et cibles inchangées)', () => {
  it('detectSituations : les deux règles branchées ; thème Environnement', () => {
    const types = detectSituations(baseRawData({ quakes: [quake(4.3)], airEpisodes: [episode({})] }), NOW).map((s) => s.type);
    expect(types).toEqual(expect.arrayContaining(['SEISMIC_EVENT', 'AIR_POLLUTION_EPISODE']));
    expect(situationTheme('SEISMIC_EVENT')).toBe('environment');
    expect(situationTheme('AIR_POLLUTION_EPISODE')).toBe('environment');
  });
  it('séisme de magnitude 5 ou plus : plafond 78 par CAP_ONE_HIGH ; magnitude 4 et épisode de pollution : aucun plafond', () => {
    const high = scoreFromPillars(ZERO, detectSituations(baseRawData({ quakes: [quake(5.1)] }), NOW));
    expect([high.score, high.situationCap]).toEqual([78, 78]);
    const medium = scoreFromPillars(ZERO, detectSituations(baseRawData({ quakes: [quake(4.3)], airEpisodes: [episode({})] }), NOW));
    expect([medium.score, medium.situationCap]).toEqual([95, null]);
  });
  it('E2 : la sécheresse n’entre ni dans le moteur ni dans le score', () => {
    for (const file of ['./situation-engine.ts', './france-country-intel.ts']) {
      expect(readFileSync(new URL(file, import.meta.url), 'utf8')).not.toMatch(/drought|Drought|vigieau|VigiEau/);
    }
  });
});
