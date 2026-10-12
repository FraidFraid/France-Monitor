// src/services/disasters-format.test.ts : libellés français des alertes GDACS (gravité, nom) et alertes « contexte européen »
// (événement centré hors de France qui touche la métropole). Formats relevés sur l'API le 12/10/2026 (sept formats en tout).
import { describe, expect, it } from 'vitest';
import type { DisasterAlert } from '../types/index.ts';
import { METROPOLE_LABEL, frenchName, frenchSeverity, isEuropeanContext } from './disasters-format.ts';

const NB = ' ';
const a = (over: Partial<DisasterAlert>): DisasterAlert => ({
  id: 'X-1', type: 'cyclone', level: 'orange', name: '', countries: [], frenchTerritory: null,
  lat: 0, lon: 0, from: '2026-10-10T00:00:00.000Z', to: '2026-10-12T00:00:00.000Z', current: true, severity: null, url: null, ...over,
});
const sev = (type: DisasterAlert['type'], severity: string | null): string | null => frenchSeverity(a({ type, severity }));

describe('frenchSeverity', () => {
  it('cyclones : catégorie traduite, vent maximal en km/h (jamais en mph)', () => {
    expect(sev('cyclone', 'Hurricane/Typhoon > 74 mph (maximum wind speed of 250 km/h)')).toBe(`Ouragan ou typhon, vent maximal 250${NB}km/h`);
    expect(sev('cyclone', 'Tropical Storm (maximum wind speed of 102 km/h)')).toBe(`Tempête tropicale, vent maximal 102${NB}km/h`);
    expect(sev('cyclone', 'Moderate Tropical Storm (maximum wind speed of 201 km/h)')).toBe(`Tempête tropicale modérée, vent maximal 201${NB}km/h`);
    expect(sev('cyclone', 'Tropical Depression (maximum wind speed of 194 km/h)')).toBe(`Dépression tropicale, vent maximal 194${NB}km/h`);
  });
  it('séismes : magnitude et profondeur à la française', () => {
    expect(sev('seisme', 'Magnitude 4.7M, Depth:10km')).toBe(`Magnitude 4,7, profondeur 10${NB}km`);
    expect(sev('seisme', 'Magnitude 7.7M, Depth:12.647km')).toBe(`Magnitude 7,7, profondeur 13${NB}km`);
  });
  it('sécheresses : impact traduit, surface groupée en km²', () => {
    expect(sev('secheresse', 'Medium impact for agricultural drought in 1759971 km2')).toBe(`Sécheresse agricole, impact moyen, 1\u202f759\u202f971${NB}km²`);
    expect(sev('secheresse', 'Minor impact for agricultural drought in 270713 km2')).toBe(`Sécheresse agricole, impact faible, 270\u202f713${NB}km²`);
  });
  it('feux : surface brûlée en hectares', () => {
    expect(sev('feu', 'Green impact for forestfire in 1234 ha')).toBe(`1\u202f234${NB}ha touchés`);
  });
  it('inondation « Magnitude 0 », vide, absente : null ; format inconnu : texte d’origine gardé', () => {
    expect(sev('inondation', null)).toBeNull();
    expect(sev('volcan', '')).toBeNull();
    expect(sev('seisme', 'Something new')).toBe('Something new');
  });
});

describe('frenchName', () => {
  it('cyclone et volcan : nom propre gardé, type en français ; nom redondant (« Earthquake in Panama ») : null', () => {
    expect(frenchName(a({ type: 'cyclone', name: 'Tropical Cyclone SIMON-26' }))).toBe('Cyclone tropical SIMON-26');
    expect(frenchName(a({ type: 'volcan', name: 'Eruption Kanlaon' }))).toBe('Éruption du Kanlaon');
    expect(frenchName(a({ type: 'seisme', name: 'Earthquake in Panama', countries: ['PAN'] }))).toBeNull();
    expect(frenchName(a({ type: 'inondation', name: 'Flood in France', countries: ['FRA'] }))).toBeNull();
  });
  it('événement à plusieurs pays : nombre de pays touchés', () => {
    expect(frenchName(a({ type: 'secheresse', name: 'Drought in Austria, Belgium, France', countries: ['AUT', 'BEL', 'FRA'] }))).toBe('3 pays touchés');
  });
});

describe('isEuropeanContext', () => {
  it('métropole touchée par un événement centré ailleurs : contexte ; événement français, en mer ou outre-mer : non', () => {
    expect(isEuropeanContext(a({ frenchTerritory: METROPOLE_LABEL, countries: ['AUT', 'FRA'] }))).toBe(true);
    expect(isEuropeanContext(a({ frenchTerritory: METROPOLE_LABEL, countries: ['FRA'] }))).toBe(false);
    expect(isEuropeanContext(a({ frenchTerritory: METROPOLE_LABEL, countries: [] }))).toBe(false);
    expect(isEuropeanContext(a({ frenchTerritory: 'Mayotte', countries: ['MOZ', 'MYT'] }))).toBe(false);
    expect(isEuropeanContext(a({ frenchTerritory: null, countries: ['AUT'] }))).toBe(false);
  });
});
