// src/components/deckgl/pollen-map.test.ts : couche Pollens de la carte, parties pures (couleurs, infobulles, spécification des couches).
import { describe, expect, it } from 'vitest';
import { ENV_NEUTRAL_HEX } from '../layer-panel/environment-legend.ts';
import { POLLEN_HEX } from '../layer-panel/pollens-legend.ts';
import { POLLEN_FIXTURE_NOW as NOW, pollenFixture } from '../layer-panel/pollens.fixture.ts';
import { LYR_POLLEN_FILL, LYR_POLLEN_LINE, POLLEN_LAYERS, POLLEN_LAYER_IDS, SRC_POLLEN, pollenDeptFeatures } from './pollen-map.ts';

const square = (x: number, y: number): GeoJSON.Polygon => ({ type: 'Polygon', coordinates: [[[x, y], [x + 0.5, y], [x + 0.5, y + 0.5], [x, y + 0.5], [x, y]]] });
const GEO: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: square(4.5, 45.7), properties: { code: '69', nom: 'Rhône' } },
    { type: 'Feature', geometry: square(5.0, 43.3), properties: { code: '13', nom: 'Bouches-du-Rhône' } },
    { type: 'Feature', geometry: square(2.3, 48.8), properties: { code: '75', nom: 'Paris' } },
    { type: 'Feature', geometry: square(-4.2, 48.2), properties: { code: '29', nom: 'Finistère' } },
  ],
};
const props = (fc: GeoJSON.FeatureCollection, i: number): Record<string, unknown> => fc.features[i].properties ?? {};

describe('pollens : départements remplis par le plus haut code du jour choisi', () => {
  it('J : palette officielle Atmo ; département non publié non rempli', () => {
    const fc = pollenDeptFeatures(GEO, pollenFixture(), 'J', NOW);
    expect(fc.features).toHaveLength(4);
    expect(fc.features.map((f) => f.properties?.['color'])).toEqual([POLLEN_HEX[5], POLLEN_HEX[4], POLLEN_HEX[1], 'rgba(0, 0, 0, 0)']);
    expect(fc.features.map((f) => f.properties?.['code'])).toEqual(['69', '13', '75', '29']);
  });
  it('J+1 et J+2 suivent le jour', () => {
    expect(pollenDeptFeatures(GEO, pollenFixture(), 'J1', NOW).features.map((f) => f.properties?.['color'])).toEqual([POLLEN_HEX[6], POLLEN_HEX[3], POLLEN_HEX[1], 'rgba(0, 0, 0, 0)']);
    expect(props(pollenDeptFeatures(GEO, pollenFixture(), 'J2', NOW), 0)['color']).toBe(POLLEN_HEX[3]);
  });
  it('infobulle .hm-tip échappée : département, niveau, pollens responsables, date, palette', () => {
    const fc = pollenDeptFeatures(GEO, pollenFixture(), 'J', NOW);
    const body = String(props(fc, 0)['body']);
    expect(body).toContain('<b>');
    expect(body).toContain('class="hm-sub"');
    expect(body).toContain('Rhône (69)');
    expect(body).toContain('pollens très élevé aujourd’hui');
    expect(body).toContain('ambroisie très élevée, graminées élevées');
    expect(body).toContain('Pollens du 20/10');
    expect(String(props(fc, 1)['body'])).toContain('Alerte publiée');
    expect(String(props(fc, 3)['body'])).toContain('pas de pollens publiés aujourd’hui');
    expect(String(props(fc, 3)['body'])).toContain('absence de publication, pas absence de pollens');
    expect(body).not.toContain('—');
  });
  it('sans pollens responsables élevés : pollens dominants', () => {
    expect(String(props(pollenDeptFeatures(GEO, pollenFixture(), 'J', NOW), 2)['body'])).toContain('Pollens dominants');
  });
  it('échappe le HTML du nom de département', () => {
    const p = pollenFixture();
    const geo: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: square(0, 0), properties: { code: '<x>' } }] };
    p.departments = [{ code: '<x>', name: '<img>', days: p.departments[0].days }];
    expect(String(props(pollenDeptFeatures(geo, p, 'J', NOW), 0)['body'])).not.toContain('<x>');
  });
  it('en retard : gris neutre, couleur de niveau retirée, dit dans l’infobulle ; sans donnée : vide', () => {
    const late = pollenDeptFeatures(GEO, pollenFixture(), 'J', NOW + 40 * 3_600_000);
    expect(late.features.map((f) => f.properties?.['color'])).toEqual([ENV_NEUTRAL_HEX, ENV_NEUTRAL_HEX, ENV_NEUTRAL_HEX, 'rgba(0, 0, 0, 0)']);
    expect(String(props(late, 0)['body'])).toContain('(en retard) : couleur retirée');
    expect(pollenDeptFeatures(GEO, null, 'J', NOW).features).toEqual([]);
  });
});

describe('couches', () => {
  it('identifiants propres, masquées au départ, remplissage à 0,45 comme la qualité de l’air', () => {
    expect([SRC_POLLEN, LYR_POLLEN_FILL, LYR_POLLEN_LINE]).toEqual(['pollen-src', 'pollen-fill', 'pollen-line']);
    expect(POLLEN_LAYER_IDS).toEqual([LYR_POLLEN_FILL, LYR_POLLEN_LINE]);
    expect(POLLEN_LAYERS.map((l) => [l.id, l.type, l.layout?.visibility])).toEqual([['pollen-fill', 'fill', 'none'], ['pollen-line', 'line', 'none']]);
    expect(POLLEN_LAYERS[0].paint).toMatchObject({ 'fill-opacity': 0.45 });
  });
});
