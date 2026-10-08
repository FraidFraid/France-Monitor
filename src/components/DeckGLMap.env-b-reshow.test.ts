// Réaffichage des couches de la phase B (spec 2026-10-04 environnement S2 ; tâche 30, repris à la tâche 31) : les clés `drought`,
// `airQuality` et `earthquakes` de MapLayers (et `environmental` pour les marégraphes) commandent le repeint. Une couche éteinte dont
// la donnée devient en retard pendant qu'elle est masquée, puis rallumée, est repeinte à l'heure courante : couleurs neutres.
import type maplibregl from 'maplibre-gl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeckGLMap } from './DeckGLMap.ts';
import { SRC_AIR_QUALITY, SRC_DROUGHT, SRC_QUAKES, SRC_TIDE_GAUGES } from './deckgl/constants.ts';
import { AIR_FIXTURE, DROUGHT_FIXTURE, ENV_FIXTURE_NOW, QUAKES_FIXTURE, SEA_LEVELS_FIXTURE } from './layer-panel/environment.fixture.ts';
import { ENV_NEUTRAL_HEX } from './layer-panel/environment-legend.ts';
import type { MapLayers } from '../types/index.ts';

const square = (x: number, y: number): GeoJSON.Polygon => ({ type: 'Polygon', coordinates: [[[x, y], [x + 0.5, y], [x + 0.5, y + 0.5], [x, y + 0.5], [x, y]]] });
const GEO: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: square(5.3, 46), properties: { code: '01', nom: 'Ain' } },
    { type: 'Feature', geometry: square(2.3, 48.8), properties: { code: '75', nom: 'Paris' } },
    { type: 'Feature', geometry: square(-4.2, 48.2), properties: { code: '29', nom: 'Finistère' } },
  ],
};
/** Plus de 36 h après les arrêtés VigiEau et l'indice ATMO, plus de 30 min après le relevé des séismes et la dernière mesure des marégraphes. */
const LATE = Date.parse('2026-10-06T10:00:00Z');

/** Carte factice : sources GeoJSON qui notent leur dernier `setData`, aucune couche (la visibilité ne s'applique à rien). */
class PaintMap {
  readonly painted = new Map<string, GeoJSON.FeatureCollection>();
  getSource(id: string): unknown {
    return { setData: (fc: GeoJSON.FeatureCollection) => { this.painted.set(id, fc); } };
  }
  getLayer(): undefined { return undefined; }
  getZoom(): number { return 5; }
  getBounds(): { contains: () => boolean } { return { contains: () => false }; }
  triggerRepaint(): void { /* rien à dessiner */ }
}

/** Couches telles qu'App.getEffectiveLayers les donne à la carte : le maître Environnement et les clés de la phase B. */
function layers(on: Partial<Record<'drought' | 'airQuality' | 'earthquakes' | 'environmental', boolean>>): MapLayers {
  const env = { environmental: false, drought: false, airQuality: false, earthquakes: false, ...on };
  return { environmentGroup: Object.values(env).some(Boolean), ...env } as MapLayers;
}

function colors(fc: GeoJSON.FeatureCollection | undefined): unknown[] {
  return (fc?.features ?? []).map((f) => f.properties?.['color']);
}

async function deckWithData(map: PaintMap): Promise<DeckGLMap> {
  const deck = new DeckGLMap({} as HTMLElement);
  Reflect.set(deck, 'map', map as unknown as maplibregl.Map);
  Reflect.set(deck, 'getDepartmentsGeojson', () => Promise.resolve(GEO));
  deck.setLayerVisibility(layers({ drought: true, airQuality: true, earthquakes: true, environmental: true }));
  await deck.updateDroughtLayer(structuredClone(DROUGHT_FIXTURE), ENV_FIXTURE_NOW);
  await deck.updateAirQualityLayer(structuredClone(AIR_FIXTURE), ENV_FIXTURE_NOW);
  deck.updateEarthquakesLayer(structuredClone(QUAKES_FIXTURE), ENV_FIXTURE_NOW);
  deck.updateSeaLevelsLayer(structuredClone(SEA_LEVELS_FIXTURE), null, ENV_FIXTURE_NOW);
  return deck;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DeckGLMap : couches de la phase B réaffichées à l’heure courante (S2)', () => {
  it('éteintes, donnée devenue en retard, rallumées : repeintes en teinte neutre avec l’horloge courante', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ENV_FIXTURE_NOW);
    const map = new PaintMap();
    const deck = await deckWithData(map);
    // Donnée fraîche : l'Ain en crise (rouge), séismes colorés par magnitude.
    expect(colors(map.painted.get(SRC_DROUGHT))[0]).toBe('#ff3b30');
    expect(colors(map.painted.get(SRC_QUAKES))).not.toContain(ENV_NEUTRAL_HEX);

    deck.setLayerVisibility(layers({}));
    vi.setSystemTime(LATE);
    map.painted.clear();
    deck.setLayerVisibility(layers({ drought: true, airQuality: true, earthquakes: true, environmental: true }));

    await vi.waitFor(() => expect(map.painted.has(SRC_DROUGHT)).toBe(true));
    expect(colors(map.painted.get(SRC_DROUGHT))).toEqual([ENV_NEUTRAL_HEX, ENV_NEUTRAL_HEX, ENV_NEUTRAL_HEX]);
    expect(colors(map.painted.get(SRC_AIR_QUALITY)).slice(0, 2)).toEqual([ENV_NEUTRAL_HEX, ENV_NEUTRAL_HEX]);
    expect(new Set(colors(map.painted.get(SRC_QUAKES)))).toEqual(new Set([ENV_NEUTRAL_HEX]));
    // Marégraphes : repeints avec la couche Vigilance météo.
    expect(new Set(colors(map.painted.get(SRC_TIDE_GAUGES)))).toEqual(new Set([ENV_NEUTRAL_HEX]));
  });

  it('seule la couche rallumée est repeinte ; une couche restée visible garde son dessin', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ENV_FIXTURE_NOW);
    const map = new PaintMap();
    const deck = await deckWithData(map);

    deck.setLayerVisibility(layers({ drought: true, airQuality: true, environmental: true }));
    vi.setSystemTime(LATE);
    map.painted.clear();
    deck.setLayerVisibility(layers({ drought: true, airQuality: true, earthquakes: true, environmental: true }));

    await vi.waitFor(() => expect(map.painted.has(SRC_QUAKES)).toBe(true));
    expect([...map.painted.keys()]).toEqual([SRC_QUAKES]);
    expect(new Set(colors(map.painted.get(SRC_QUAKES)))).toEqual(new Set([ENV_NEUTRAL_HEX]));
  });
});
