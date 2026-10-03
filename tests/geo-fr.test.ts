import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { distanceToMetropoleKm, haversineKm, insideMetropole, metropoleRegions, regionAt } from '../api/_lib/geo-fr.js';

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
