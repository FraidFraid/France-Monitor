// src/services/exposure-assets.test.ts : enjeux lus pour l'onglet Environnement.
import { describe, expect, it } from 'vitest';
import { ehpadAssets, hospitalAssets, nuclearAssets, sevesoAssets } from './exposure-assets.ts';

describe('enjeux', () => {
  it('centrales : toutes en service avec leur département, Fessenheim écartée', () => {
    const n = nuclearAssets();
    expect(n).toHaveLength(18);
    expect(n.find((a) => a.id === 'nuc-tricastin')).toMatchObject({ dept: '26', kind: 'nucleaire', name: 'Centrale de Tricastin' });
    expect(n.some((a) => a.id === 'nuc-fessenheim')).toBe(false);
  });
  it('Seveso : seuil haut et bas, enregistrements invalides écartés', () => {
    const a = sevesoAssets({ sites: [
      { id: '1', name: 'Raffinerie', commune: 'Fos', dept: '13', seuil: 'haut', lon: 4.9, lat: 43.4, url: 'https://x' },
      { id: '2', name: 'Dépôt', commune: 'Arles', dept: '13', seuil: 'bas', lon: 4.6, lat: 43.7 },
      { id: '3', name: 'Sans coordonnées', dept: '13', seuil: 'haut' },
      { id: '4', name: 'Non Seveso', dept: '13', seuil: 'non', lon: 1, lat: 1 },
    ] });
    expect(a.map((x) => [x.id, x.kind])).toEqual([['seveso-1', 'seveso-haut'], ['seveso-2', 'seveso-bas']]);
  });
  it('hôpitaux : antennes saisonnières écartées, type d’urgences dit', () => {
    const a = hospitalAssets({ sites: [
      { finess: '1', name: 'CHU', commune: 'Nîmes', dept: '30', lon: 4.3, lat: 43.8, general: true, pediatric: true, seasonal: false },
      { finess: '2', name: 'Antenne', commune: 'Plage', dept: '30', lon: 4.1, lat: 43.5, general: true, pediatric: false, seasonal: true },
    ] });
    expect(a).toHaveLength(1);
    expect(a[0].detail).toBe('urgences adultes et pédiatriques');
  });
  it('EHPAD : places dites, valeur et unité sur une ligne', () => {
    expect(ehpadAssets({ sites: [{ finess: '9', name: 'Les Tilleuls', commune: 'Alès', dept: '30', lon: 4.08, lat: 44.12, places: 80 }] })[0].detail)
      .toBe('80\u00a0places');
  });
  it('fichier au mauvais format : erreur (le panneau dit l’enjeu manquant)', () => {
    expect(() => sevesoAssets([])).toThrow();
  });
});
