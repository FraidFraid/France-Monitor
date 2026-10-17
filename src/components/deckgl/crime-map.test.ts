// src/components/deckgl/crime-map.test.ts : couleur par rapport à la France, ronds des villes et infobulles de la couche Criminalité.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CrimeDataset } from '../../types/index.ts';
import { isCrimeDataset } from '../../services/crime.ts';
import { levelHex } from '../../services/vigilance.ts';
import {
  CRIME_BAND_HEX, CRIME_CITY_LAYERS, CRIME_LABELLED_CITIES, CRIME_LAYERS, CRIME_LAYER_IDS, crimeCityFeatures, crimeCityRadius, crimeDeptFeatures,
} from './crime-map.ts';

const raw: unknown = JSON.parse(readFileSync(new URL('../../../public/data/crime.json', import.meta.url), 'utf8'));
const ds = (): CrimeDataset => {
  if (!isCrimeDataset(raw)) throw new Error('crime.json invalide');
  return raw;
};
const geo = JSON.parse(readFileSync(new URL('../../../public/data/departements.geojson', import.meta.url), 'utf8')) as GeoJSON.FeatureCollection;
const DASH = String.fromCharCode(0x2014);

describe('couleurs', () => {
  it('neutres sous la moyenne nationale, échelle L1 au-dessus', () => {
    expect(CRIME_BAND_HEX.jaune).toBe(levelHex('jaune'));
    expect(CRIME_BAND_HEX.orange).toBe(levelHex('orange'));
    expect(CRIME_BAND_HEX.rouge).toBe(levelHex('rouge'));
    expect(new Set([CRIME_BAND_HEX.bas, CRIME_BAND_HEX.moyen]).size).toBe(2);
  });
});

describe('départements', () => {
  it('un élément par contour, bande calculée sur le rapport du taux à la France', () => {
    const fc = crimeDeptFeatures(geo, ds(), 'cambriolages');
    expect(fc.features).toHaveLength(geo.features.length);
    const bands = new Set(fc.features.map((f) => f.properties?.['crimeBand']));
    expect(bands.has('rouge') || bands.has('orange') || bands.has('jaune')).toBe(true);
    const rouge = fc.features.find((f) => f.properties?.['crimeBand'] === 'rouge');
    if (rouge) expect(rouge.properties?.['crimeColor']).toBe(levelHex('rouge'));
  });
  it('homicides : Bouches-du-Rhône peint, infobulle avec nombre 56 et taux pour 100 000', () => {
    const fc = crimeDeptFeatures(geo, ds(), 'homicides');
    const f = fc.features.find((x) => x.properties?.['code'] === '13');
    expect(f).toBeDefined();
    const body = String(f?.properties?.['crimeBody']);
    expect(body).toContain('56');
    expect(body).toContain('pour 100 000 hab.');
    expect(body).not.toContain(DASH);
    // 2,7 pour 100 000 contre 1,43 en France : rapport de 1,9, orange.
    expect(f?.properties?.['crimeBand']).toBe('orange');
    expect(f?.properties?.['crimeColor']).toBe(levelHex('orange'));
  });
  it('sans fichier ou sans contours : aucune entité', () => {
    expect(crimeDeptFeatures(null, ds(), 'homicides').features).toEqual([]);
    expect(crimeDeptFeatures(geo, null, 'homicides').features).toEqual([]);
  });
});

describe('villes', () => {
  it('homicides : aucun rond, publié au département seulement', () => {
    expect(crimeCityFeatures(ds(), 'homicides').features).toEqual([]);
    expect(crimeCityFeatures(ds(), 'tentatives').features).toEqual([]);
    expect(crimeCityFeatures(null, 'cambriolages').features).toEqual([]);
  });
  it('indicateur communal : coordonnées [lng, lat], rayon 5 à 14, étiquette sur les 15 plus fortes seulement', () => {
    const fc = crimeCityFeatures(ds(), 'violencesPhysiques');
    expect(fc.features.length).toBeGreaterThan(100);
    const paris = fc.features.find((f) => f.properties?.['id'] === '75056');
    expect(paris?.geometry.coordinates[0]).toBeCloseTo(2.347, 3);
    expect(paris?.geometry.coordinates[1]).toBeCloseTo(48.8589, 3);
    expect(paris?.properties?.['radius']).toBeLessThanOrEqual(14);
    expect(String(paris?.properties?.['body'])).toContain('11');
    for (const f of fc.features) {
      expect(f.properties?.['radius']).toBeGreaterThanOrEqual(5);
      expect(f.properties?.['radius']).toBeLessThanOrEqual(14);
    }
    expect(fc.features.filter((f) => f.properties?.['label'] !== '')).toHaveLength(CRIME_LABELLED_CITIES);
  });
  it('rayon croissant avec la population, borné', () => {
    expect(crimeCityRadius(20_000)).toBe(5);
    expect(crimeCityRadius(200_000)).toBeGreaterThan(crimeCityRadius(50_000));
    expect(crimeCityRadius(10_000_000)).toBe(14);
  });
  it('valeur estimée : marquée, infobulle « estimé » sans nombre', () => {
    const d = ds();
    const key = d.indicators.find((i) => i.communal && d.cities.some((c) => c.values[i.key]?.[0] === null && c.values[i.key]?.[1] !== null))?.key;
    if (!key) return;
    const fc = crimeCityFeatures(d, key);
    const est = fc.features.find((f) => f.properties?.['estimated'] === true);
    expect(est).toBeDefined();
    expect(String(est?.properties?.['body'])).toContain('estimé');
  });
  it('texte du fichier échappé dans l’infobulle', () => {
    const base = ds();
    const evil: CrimeDataset = {
      ...base, cities: [{ ...base.cities[0], name: '<img src=x onerror=alert(1)>', code: 'x', values: { cambriolages: [10, 5, 9] } }],
    };
    const html = String(crimeCityFeatures(evil, 'cambriolages').features[0]?.properties?.['body']);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('couches MapLibre', () => {
  it('surfaces puis ronds et étiquettes, toutes masquées au départ', () => {
    expect(CRIME_LAYERS.map((l) => l.type)).toEqual(['fill', 'line']);
    expect(CRIME_CITY_LAYERS.map((l) => l.type)).toEqual(['circle', 'symbol']);
    expect([...CRIME_LAYERS, ...CRIME_CITY_LAYERS].every((l) => l.layout?.visibility === 'none')).toBe(true);
    expect(CRIME_LAYER_IDS).toHaveLength(4);
  });
});
