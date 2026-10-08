import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  departementAt, departementsNear, distanceToDepartementKm, distanceToMetropoleKm, haversineKm, insideMetropole, metropoleDepartements,
  metropoleRegions, regionAt,
} from '../api/_lib/geo-fr.js';

describe('géographie de la métropole (public/data/regions.geojson)', () => {
  it('13 régions métropolitaines, DROM écartés', () => {
    expect(metropoleRegions()).toHaveLength(13);
    expect(metropoleRegions().map((r) => r.name)).not.toContain('La Réunion');
  });
  it('région d’un point ; mer et étranger : null', () => {
    expect(regionAt(48.8566, 2.3522)).toBe('Île-de-France');
    expect(regionAt(41.9192, 8.7386)).toBe('Corse');
    expect(regionAt(50.6292, 3.0573)).toBe('Hauts-de-France');
    expect(regionAt(43.2965, 5.3698)).toBe("Provence-Alpes-Côte d'Azur");
    expect(regionAt(51.5072, -0.1276)).toBeNull();
    expect(regionAt(42.8, 5.0)).toBeNull();
    expect(insideMetropole(Number.NaN, 2)).toBe(false);
  });
  it('distance au territoire : 0 sur terre, mer au large de Marseille, Genève à quelques km de la frontière', () => {
    expect(distanceToMetropoleKm(45.764, 4.8357)).toBe(0);
    expect(distanceToMetropoleKm(42.8, 5.0)).toBeGreaterThan(40);
    expect(distanceToMetropoleKm(42.8, 5.0)).toBeLessThan(70);
    expect(distanceToMetropoleKm(46.2044, 6.1432)).toBeLessThan(10);
    expect(Math.round(haversineKm(48.8566, 2.3522, 45.764, 4.8357))).toBe(391);
  });
  it('le fichier des régions est livré sur la VM (archive de déploiement)', () => {
    const yml = readFileSync(new URL('../.github/workflows/deploy-vm.yml', import.meta.url), 'utf8');
    expect(yml).toMatch(/tar -czf[\s\S]*public\/data\/regions\.geojson/);
  });
});

describe('départements de la métropole (public/data/departements.geojson)', () => {
  it('96 départements, Corse en deux (2A, 2B), noms officiels', () => {
    const all = metropoleDepartements();
    expect(all).toHaveLength(96);
    expect(all.map((d) => d.code)).toEqual(expect.arrayContaining(['01', '13', '2A', '2B', '33', '57', '95']));
    expect(all.find((d) => d.code === '66')?.name).toBe('Pyrénées-Orientales');
  });
  it('département d’un point (feux et séismes) : la France seulement', () => {
    expect(departementAt(43.44, 4.89)).toBe('13'); // Fos-sur-Mer, zone pétrochimique
    expect(departementAt(49.3579, 6.1683)).toBe('57'); // Thionville
    expect(departementAt(51.04, 2.29)).toBe('59'); // Dunkerque
    expect(departementAt(41.9192, 8.7386)).toBe('2A'); // Ajaccio
    expect(departementAt(42.6973, 9.4503)).toBe('2B'); // Bastia
    expect(departementAt(44.88, -1.12)).toBe('33'); // forêt du Porge
    // Points de l'audit du 04/10 donnés pour français : aciérie de Dillingen (Sarre) et Belval (Luxembourg), Gand.
    expect(departementAt(49.35, 6.75)).toBeNull();
    expect(departementAt(49.5, 5.96)).toBeNull();
    expect(departementAt(51.17, 3.81)).toBeNull();
    expect(departementAt(42.8, 5.0)).toBeNull(); // mer au large de Marseille
    expect(departementAt(Number.NaN, 2)).toBeNull();
  });
  it('distance à un département : 0 dedans, distance au bord sinon, Infinity pour un code inconnu', () => {
    expect(distanceToDepartementKm('33', 44.88, -1.12)).toBe(0);
    expect(distanceToDepartementKm('57', 49.35, 6.75)).toBeGreaterThan(0);
    expect(distanceToDepartementKm('57', 49.35, 6.75)).toBeLessThan(10);
    expect(Math.round(distanceToDepartementKm('40', 44.88, -1.12))).toBe(39);
    expect(distanceToDepartementKm('99', 44.88, -1.12)).toBe(Number.POSITIVE_INFINITY);
  });
  it('départements à moins de 10 km : celui du point d’abord, puis les voisins du plus proche au plus lointain', () => {
    expect(departementsNear(44.88, -1.12, 10)).toEqual(['33']);
    expect(departementsNear(44.55, -1.05, 10)).toEqual(['33', '40']);
    expect(departementsNear(45.55, -0.95, 10)).toEqual(['17', '33']);
    expect(departementsNear(48.8566, 2.3522, 10)).toEqual(['75', '94', '92', '93']);
    expect(departementsNear(49.35, 6.75, 10)).toEqual(['57']); // Sarre : la Moselle est à moins de 10 km
    expect(departementsNear(42.8, 5.0, 10)).toEqual([]);
    expect(departementsNear(Number.NaN, 2, 10)).toEqual([]);
  });
  it('le fichier des départements est livré sur la VM (archive de déploiement)', () => {
    const yml = readFileSync(new URL('../.github/workflows/deploy-vm.yml', import.meta.url), 'utf8');
    expect(yml).toMatch(/tar -czf[\s\S]*public\/data\/departements\.geojson/);
  });
});
