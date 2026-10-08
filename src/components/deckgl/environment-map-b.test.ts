// src/components/deckgl/environment-map-b.test.ts
// Carte de la phase B (contrats § 5) : couleurs portées par chaque objet (palette L1, catégories en hex), donnée en retard en teinte
// neutre, infobulles .hm-tip échappées ; légendes datées (S1) ; jeton de la vigilance sécheresse égal à main.css.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DroughtResponse, Quake, VigilanceResponse } from '../../types/index.ts';
import { AIR_FIXTURE, DROUGHT_FIXTURE, ENV_FIXTURE_NOW, QUAKES_FIXTURE, SEA_LEVELS_FIXTURE } from '../layer-panel/environment.fixture.ts';
import {
  CAT_SECHERESSE_VIGILANCE_HEX, DROUGHT_UNAVAILABLE_HEX, QUAKE_ABROAD_HEX, QUAKE_WEAK_HEX, airQualityLegend, droughtLegend, earthquakesLegend,
  withTideGauges,
} from '../layer-panel/environment-legend.ts';
import { NBSP } from '../layer-panel/format.ts';
import {
  ENV_B_FILL_LAYERS, ENV_B_HOVERABLE, ENV_B_LAYER_KEYS, ENV_B_POINT_LAYERS, ENV_B_SOURCE_IDS, airDeptFeatures, droughtDeptFeatures, quakeFeatures, quakeRadius,
  tideGaugeFeatures, envBReshowPaints, placeEnvBPoints, type EnvBData,
} from './environment-map-b.ts';
import { ENV_HOVER_LAYERS, ENV_LAYERS, ENV_LAYER_BEFORE, ENV_LAYER_KEYS, ENV_SOURCE_IDS, envTooltipHtml } from './environment-map.ts';
import {
  LYR_AIR_FILL, LYR_DROUGHT_FILL, LYR_FIRES_POINTS, LYR_QUAKES, LYR_QUAKE_LABEL, LYR_TIDE_GAUGES, LYR_WEATHER_FILL, SRC_DROUGHT, SRC_QUAKES, SRC_TIDE_GAUGES,
} from './constants.ts';

const NOW = ENV_FIXTURE_NOW;
const square = (x: number, y: number): GeoJSON.Polygon => ({ type: 'Polygon', coordinates: [[[x, y], [x + 0.5, y], [x + 0.5, y + 0.5], [x, y + 0.5], [x, y]]] });
const GEO: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: square(5.3, 46), properties: { code: '01', nom: 'Ain' } },
    { type: 'Feature', geometry: square(2.3, 48.8), properties: { code: '75', nom: 'Paris' } },
    { type: 'Feature', geometry: square(-4.2, 48.2), properties: { code: '29', nom: 'Finistère' } },
    { type: 'Feature', geometry: square(1.6, 44.2), properties: { code: '46', nom: 'Lot' } },
  ],
};
const props = (fc: GeoJSON.FeatureCollection, i: number): Record<string, unknown> => fc.features[i].properties ?? {};

describe('sécheresse : niveau le plus haut par département', () => {
  it('crise rouge, vigilance en teinte de catégorie, aucun arrêté non rempli ; infobulle par usage, datée', () => {
    const d: DroughtResponse = structuredClone(DROUGHT_FIXTURE);
    const lot = d.departments.find((x) => x.dept === '46');
    if (lot) lot.max = null;
    const fc = droughtDeptFeatures(GEO, d, NOW);
    expect(fc.features.map((f) => f.properties?.['color'])).toEqual(['#ff3b30', CAT_SECHERESSE_VIGILANCE_HEX, '#ff3b30', 'rgba(0, 0, 0, 0)']);
    const body = String(props(fc, 0)['body']);
    for (const part of ['Ain (01)', 'niveau le plus haut : crise', 'Eaux superficielles', 'Eau potable', 'Arrêtés en vigueur au 4 octobre 02:43.']) expect(body).toContain(part);
  });
  it('amendement 15 : département « unavailable » en gris, « donnée indisponible », jamais « aucun arrêté »', () => {
    const d: DroughtResponse = structuredClone(DROUGHT_FIXTURE);
    const ain = d.departments.find((x) => x.dept === '01');
    if (ain) Object.assign(ain, { available: false, max: null, superficielle: null, souterraine: null, potable: null });
    const fc = droughtDeptFeatures(GEO, d, NOW);
    expect(props(fc, 0)['color']).toBe(DROUGHT_UNAVAILABLE_HEX);
    expect(String(props(fc, 0)['body'])).toContain('donnée indisponible');
    expect(String(props(fc, 0)['body'])).not.toContain('aucun arrêté');
    expect(droughtLegend(DROUGHT_FIXTURE, NOW).items.find((i) => i.id === 'drought-unavailable')?.color).toBe(DROUGHT_UNAVAILABLE_HEX);
  });
  it('en retard : teinte neutre ; texte hostile échappé ; sans réponse : aucun objet', () => {
    const late = droughtDeptFeatures(GEO, DROUGHT_FIXTURE, Date.parse('2026-10-05T13:00:00Z'));
    expect(late.features.slice(0, 3).map((f) => f.properties?.['color'])).toEqual(['#c7c7cc', '#c7c7cc', '#c7c7cc']);
    const d = structuredClone(DROUGHT_FIXTURE);
    d.departments[0].name = '<img src=x onerror=1>';
    expect(String(props(droughtDeptFeatures(GEO, d, NOW), 0)['body'])).not.toContain('<img');
    expect(droughtDeptFeatures(GEO, null, NOW).features).toHaveLength(0);
  });
});

describe('qualité de l’air : indice ATMO par département (palette L1, amendement 5)', () => {
  it('indice 3 jaune, 2 vert ; département sans indice non rempli, dit dans l’infobulle', () => {
    const fc = airDeptFeatures(GEO, AIR_FIXTURE, NOW);
    expect(fc.features.map((f) => f.properties?.['color'])).toEqual(['#ffcc00', '#34c759', 'rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
    expect(String(props(fc, 0)['body'])).toContain('indice le plus haut : dégradé');
    expect(String(props(fc, 0)['body'])).toContain('Communes couvertes');
    expect(String(props(fc, 2)['body'])).toContain('pas d’indice ATMO publié ce jour');
    expect(String(props(fc, 0)['body'])).toContain('pas la palette officielle ATMO');
  });
});

describe('séismes : cercles proportionnels à la magnitude, couleur par seuil, hors de France en gris', () => {
  it('jeu d’essai du 04/10', () => {
    const fc = quakeFeatures(QUAKES_FIXTURE, NOW);
    expect(fc.features).toHaveLength(8);
    expect(props(fc, 6)).toMatchObject({ id: 'fr2026usugeu', color: '#34c759', radius: 8.5, sortKey: 25, label: '' });
    expect(props(fc, 0)).toMatchObject({ color: QUAKE_WEAK_HEX, radius: 5.2 });
    expect(props(fc, 2)).toMatchObject({ color: QUAKE_ABROAD_HEX });
    expect(String(props(fc, 2)['body'])).toContain(`hors de France, à 3${NBSP}km de la frontière`);
    expect(quakeRadius(5)).toBe(14);
  });
  it('magnitude 4,3 en France : orange, étiquetée ; en retard : neutre', () => {
    const q = structuredClone(QUAKES_FIXTURE);
    const strong: Quake = { ...q.quakes[0], id: 'fort', magnitude: 4.3, description: 'Tremblement de terre de magnitude 4.3, proche de Gap' };
    q.quakes.unshift(strong);
    expect(props(quakeFeatures(q, NOW), 0)).toMatchObject({ color: '#ff9500', label: `M${NBSP}4,3`, radius: 12.5 });
    expect(props(quakeFeatures(q, Date.parse('2026-10-04T08:40:00Z')), 0)['color']).toBe('#c7c7cc');
  });
});

describe('marégraphes (avec la couche Vigilance météo)', () => {
  const vigilance = (color: 1 | 2): VigilanceResponse => ({
    updateTime: '2026-10-04T08:00:12Z', textsUpdateTime: null,
    periods: [{
      echeance: 'J', begin: '2026-10-04T08:00:00Z', end: '2026-10-04T22:00:00Z', maxColor: color, comment: null, departments: [], greenDepartments: 96,
      coast: [{ code: '2910', departement: '29', name: 'Finistère, littoral', color, slots: [] }], counts: [], perPhenomenon: [],
    }],
    bulletins: [], history: { days: [], since: null }, readAt: '2026-10-04T08:05:00Z', errors: [],
  });
  it('disque en teinte de port, anneau de la couleur du domaine quand il est en vigilance ; en retard : neutre', () => {
    const fc = tideGaugeFeatures(SEA_LEVELS_FIXTURE, null, NOW);
    expect(fc.features.map((f) => [f.properties?.['color'], f.properties?.['ring']])).toEqual([['#30b0c7', '#111111'], ['#30b0c7', '#111111']]);
    expect(props(tideGaugeFeatures(SEA_LEVELS_FIXTURE, vigilance(2), NOW), 0)['ring']).toBe('#ffcc00');
    expect(String(props(fc, 0)['body'])).toContain(`Variation sur 1${NBSP}h`);
    expect(props(tideGaugeFeatures(SEA_LEVELS_FIXTURE, vigilance(2), Date.parse('2026-10-04T08:45:00Z')), 0)).toMatchObject({ color: '#c7c7cc', ring: '#111111' });
  });
});

describe('sources, couches, survol', () => {
  it('ajoutées aux constantes de la tâche 15 ; masquées jusqu’à la visibilité ; survol avec infobulle', () => {
    for (const id of ENV_B_SOURCE_IDS) expect(ENV_SOURCE_IDS).toContain(id);
    expect(ENV_B_SOURCE_IDS).toEqual([SRC_DROUGHT, 'air-quality-src', SRC_QUAKES, SRC_TIDE_GAUGES]);
    const ids = ENV_LAYERS.map((l) => l.id);
    for (const l of [...ENV_B_FILL_LAYERS, ...ENV_B_POINT_LAYERS]) {
      expect(ids).toContain(l.id);
      expect(JSON.stringify(l.layout)).toContain('"visibility":"none"');
    }
    expect(ids.indexOf(LYR_DROUGHT_FILL)).toBeLessThan(ids.indexOf(LYR_QUAKES));
    // Remplissages départementaux sous la vigilance (jamais au-dessus des feux ni des crues) ; points au-dessus.
    for (const l of ENV_B_FILL_LAYERS) expect(ENV_LAYER_BEFORE[l.id]).toBe(LYR_WEATHER_FILL);
    for (const id of ENV_B_HOVERABLE) expect(ENV_HOVER_LAYERS).toContain(id);
    expect(ENV_HOVER_LAYERS.slice(0, 2)).toEqual([LYR_QUAKES, LYR_TIDE_GAUGES]);
    expect(ENV_HOVER_LAYERS.indexOf(LYR_FIRES_POINTS)).toBeLessThan(ENV_HOVER_LAYERS.indexOf(LYR_AIR_FILL));
    expect(ENV_HOVER_LAYERS.indexOf(LYR_WEATHER_FILL)).toBeLessThan(ENV_HOVER_LAYERS.indexOf(LYR_DROUGHT_FILL));
    expect(ENV_LAYER_KEYS.environmental).toContain(LYR_TIDE_GAUGES);
    expect(ENV_B_LAYER_KEYS).toEqual({ drought: [LYR_DROUGHT_FILL, 'drought-line'], airQuality: [LYR_AIR_FILL, 'air-quality-line'], earthquakes: [LYR_QUAKES, LYR_QUAKE_LABEL] });
    expect(envTooltipHtml(LYR_QUAKES, { body: '<b>M 4,3</b>' })).toContain('<b>M 4,3</b>');
  });
});

describe('légendes datées (S1, S2)', () => {
  it('sécheresse : date des arrêtés ; en retard dit ; sans réponse : indisponible', () => {
    const l = droughtLegend(DROUGHT_FIXTURE, NOW);
    expect([l.id, l.title]).toEqual(['drought', 'Sécheresse']);
    expect(l.items.map((i) => i.color)).toContain(CAT_SECHERESSE_VIGILANCE_HEX);
    expect(l.notes?.[0]).toBe('Données : arrêtés en vigueur au 4 octobre 02:43.');
    expect(droughtLegend(DROUGHT_FIXTURE, Date.parse('2026-10-05T13:00:00Z')).notes?.slice(0, 2))
      .toEqual(['Données : arrêtés en vigueur au 4 octobre 02:43 (en retard).', 'En retard : couleurs de niveau retirées de la carte.']);
    expect(droughtLegend(null, NOW).notes?.[0]).toBe('Données : VigiEau indisponible.');
  });
  it('qualité de l’air : « indice ATMO du 04/10, mis à jour le 03/10 15:36 » ; palette FranceMonitor dite', () => {
    const l = airQualityLegend(AIR_FIXTURE, NOW);
    expect(l.id).toBe('airQuality');
    expect(l.notes?.[0]).toBe('Données : indice ATMO du 04/10, mis à jour le 03/10 15:36.');
    expect(l.notes?.join(' ')).toContain('pas la palette officielle ATMO');
  });
  it('séismes : relevé BCSF-RéNaSS 10:05, repli EMSC nommé', () => {
    expect(earthquakesLegend(QUAKES_FIXTURE, NOW).notes?.[0]).toBe('Données : relevé BCSF-RéNaSS 10:05.');
    expect(earthquakesLegend({ ...QUAKES_FIXTURE, source: 'EMSC' }, NOW).notes?.[0]).toBe('Données : relevé EMSC (repli) 10:05.');
    expect(earthquakesLegend(QUAKES_FIXTURE, NOW).items.map((i) => i.color)).toEqual(expect.arrayContaining([QUAKE_WEAK_HEX, QUAKE_ABROAD_HEX]));
  });
  it('marégraphes dans la légende de la vigilance : élément et date de la dernière mesure', () => {
    const base = { id: 'environmental', title: 'Vigilance météo', items: [], notes: ['Données : carte du 04/10 à 10:00.'] };
    const l = withTideGauges(base, SEA_LEVELS_FIXTURE, NOW);
    expect(l.items.at(-1)).toEqual({ id: 'vig-tide-gauge', label: 'Marégraphe SHOM (hauteur d’eau)', color: '#30b0c7', shape: 'circle' });
    expect(l.notes).toEqual(['Données : carte du 04/10 à 10:00.', 'Marégraphes SHOM : dernière mesure 10:10.']);
    expect(withTideGauges(base, null, NOW).notes?.at(-1)).toBe('Marégraphes SHOM : non lus.');
    expect(base.items).toHaveLength(0);
  });
  it('jeton de la vigilance sécheresse : même valeur que main.css', () => {
    const css = readFileSync(new URL('../../styles/main.css', import.meta.url), 'utf8');
    expect(css).toContain(`--cat-secheresse-vigilance: ${CAT_SECHERESSE_VIGILANCE_HEX};`);
  });
});

describe('département indisponible et en retard (m4)', () => {
  it('reste gris « donnée indisponible », jamais coloré ni neutre', () => {
    const d: DroughtResponse = structuredClone(DROUGHT_FIXTURE);
    const ain = d.departments.find((x) => x.dept === '01');
    if (ain) Object.assign(ain, { available: false, max: null, superficielle: null, souterraine: null, potable: null });
    const fc = droughtDeptFeatures(GEO, d, Date.parse('2026-10-05T13:00:00Z'));
    expect(props(fc, 0)['color']).toBe(DROUGHT_UNAVAILABLE_HEX);
    expect(String(props(fc, 0)['body'])).toContain('donnée indisponible');
  });
});

describe('réaffichage à l’heure courante (S2)', () => {
  const data: EnvBData = {
    drought: DROUGHT_FIXTURE, air: AIR_FIXTURE, quakes: QUAKES_FIXTURE, seaLevels: SEA_LEVELS_FIXTURE, vigilance: null,
  };
  const LATE = Date.parse('2026-10-06T10:00:00Z');
  const colors = (fc: GeoJSON.FeatureCollection): unknown[] => fc.features.map((f) => f.properties?.['color']);
  it('sécheresse, air, séismes : masqué puis visible, couleurs neutres si la donnée est devenue en retard', () => {
    const fresh = envBReshowPaints({}, { drought: true, airQuality: true, earthquakes: true }, data, GEO, NOW);
    expect(fresh.map((p) => p.source)).toEqual([SRC_DROUGHT, 'air-quality-src', SRC_QUAKES]);
    expect(colors(fresh[0].data)[0]).toBe('#ff3b30');
    const late = envBReshowPaints({}, { drought: true, airQuality: true, earthquakes: true }, data, GEO, LATE);
    expect(colors(late[0].data).slice(0, 3)).toEqual(['#c7c7cc', '#c7c7cc', '#c7c7cc']);
    expect(colors(late[1].data).slice(0, 2)).toEqual(['#c7c7cc', '#c7c7cc']);
    expect(new Set(colors(late[2].data))).toEqual(new Set(['#c7c7cc']));
  });
  it('marégraphes : repeints avec la couche Vigilance météo, neutres en retard', () => {
    const late = envBReshowPaints({}, { environmental: true }, data, GEO, LATE);
    expect(late.map((p) => p.source)).toEqual([SRC_TIDE_GAUGES]);
    expect(new Set(colors(late[0].data))).toEqual(new Set(['#c7c7cc']));
  });
  it('couche déjà visible, ou donnée jamais reçue : rien à repeindre', () => {
    expect(envBReshowPaints({ drought: true, earthquakes: true, environmental: true }, { drought: true, earthquakes: true, environmental: true }, data, GEO, LATE)).toEqual([]);
    expect(envBReshowPaints({}, { drought: true, earthquakes: true, environmental: true },
      { drought: null, air: null, quakes: null, seaLevels: null, vigilance: null }, GEO, LATE)).toEqual([]);
  });
});

describe('ordre des couches : points au-dessus de toutes les surfaces (risque 7)', () => {
  it('séismes et marégraphes placés sous la première couche de points qui suit la dernière surface', () => {
    const order = ['weather-fill', 'quakes', 'quakes-label', 'tide-gauges', 'fuel-tension-fill', 'military-zones-fill', 'citizen-fill', 'power-fill', 'telecom-pts'];
    const map = {
      getLayer: (id: string): unknown => (order.includes(id) ? {} : undefined),
      moveLayer: (id: string, before?: string): void => {
        order.splice(order.indexOf(id), 1);
        order.splice(before ? order.indexOf(before) : order.length, 0, id);
      },
    };
    placeEnvBPoints(map);
    const at = (id: string): number => order.indexOf(id);
    for (const surface of ['fuel-tension-fill', 'military-zones-fill', 'citizen-fill', 'power-fill']) {
      for (const point of ['quakes', 'quakes-label', 'tide-gauges']) expect(at(point)).toBeGreaterThan(at(surface));
    }
    expect(at('tide-gauges')).toBeLessThan(at('telecom-pts'));
  });
});
