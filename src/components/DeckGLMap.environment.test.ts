// src/components/DeckGLMap.environment.test.ts : méthodes neuves de la carte pour l'environnement (contrats § 5), sur une carte simulée
// et les réponses réelles du 04/10/2026.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeckGLMap } from './DeckGLMap.ts';
import { ENV_FIXTURE_NOW, FIRES_FIXTURE, FLOODS_FIXTURE, VIGILANCE_FIXTURE } from './layer-panel/environment.fixture.ts';
import {
  LYR_FLOODS_HIGHLIGHT, LYR_FOREST_DANGER_FILL, LYR_RADAR_PICK, SRC_FIRES, SRC_FIRES_ABROAD, SRC_FIRES_HIGHLIGHT, SRC_FLOODS, SRC_FLOODS_HIGHLIGHT,
  SRC_FLOOD_STATIONS, SRC_FOREST_DANGER, SRC_RADAR_PICK, SRC_WEATHER, SRC_WEATHER_ICONS,
} from './deckgl/constants.ts';
import { resetDepartementsGeojsonCache } from '../services/departements-geojson.ts';
import { levelHex } from '../services/vigilance.ts';

const GEO_TEXT = readFileSync(new URL('../../public/data/departements.geojson', import.meta.url), 'utf8');
const NOW = ENV_FIXTURE_NOW;

class FakeMap {
  readonly data = new Map<string, GeoJSON.FeatureCollection>();
  readonly visibility = new Map<string, string>();
  readonly fitBounds = vi.fn();
  constructor(layers: readonly string[]) {
    for (const id of layers) this.visibility.set(id, 'none');
  }
  getSource(id: string): { setData(d: GeoJSON.FeatureCollection): void } {
    return { setData: (d) => { this.data.set(id, d); } };
  }
  getLayer(id: string): object | undefined {
    return this.visibility.has(id) ? { id } : undefined;
  }
  setLayoutProperty(id: string, _name: string, value: string): void {
    this.visibility.set(id, value);
  }
  setFeatureState(): void {}
  count(id: string): number {
    return this.data.get(id)?.features.length ?? -1;
  }
}

function deck(map: FakeMap, layers: Record<string, boolean>): DeckGLMap {
  const d = new DeckGLMap({} as HTMLElement);
  Reflect.set(d, 'map', map);
  Reflect.set(d, 'currentLayers', layers);
  return d;
}

afterEach(() => { vi.unstubAllGlobals(); resetDepartementsGeojsonCache(); });

describe('DeckGLMap : couches Environnement (méthodes neuves)', () => {
  it('vigilance : gardée tant que la couche est masquée, peinte à son affichage (départements et pictogrammes)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(GEO_TEXT, { status: 200 })));
    const map = new FakeMap([]);
    const d = deck(map, { environmental: false });
    await d.updateVigilanceLayer(VIGILANCE_FIXTURE(), 'J', NOW);
    expect(map.count(SRC_WEATHER)).toBe(-1);
    expect(Reflect.get(d, 'envVigilancePending')).toBe(true);
    Reflect.set(d, 'currentLayers', { environmental: true });
    await d.updateVigilanceLayer(VIGILANCE_FIXTURE(), 'J', NOW);
    const po = map.data.get(SRC_WEATHER)?.features.find((f) => f.properties?.['code'] === '66');
    expect(po?.properties?.['color']).toBe(levelHex('orange'));
    expect(map.count(SRC_WEATHER_ICONS)).toBe(7);
  });
  it('crues : tronçons et stations ; tronçon mis en avant et recentré', () => {
    const map = new FakeMap([LYR_FLOODS_HIGHLIGHT]);
    const d = deck(map, { environmental: true });
    d.updateFloodsLayer(FLOODS_FIXTURE(), NOW);
    expect([map.count(SRC_FLOODS), map.count(SRC_FLOOD_STATIONS)]).toEqual([4, 9]);
    d.focusFloodSection('MO12');
    expect(map.data.get(SRC_FLOODS_HIGHLIGHT)?.features[0].geometry.type).toBe('MultiLineString');
    expect(map.visibility.get(LYR_FLOODS_HIGHLIGHT)).toBe('visible');
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
    d.highlightFloodSection(null);
    expect([map.count(SRC_FLOODS_HIGHLIGHT), map.visibility.get(LYR_FLOODS_HIGHLIGHT)]).toEqual([0, 'none']);
  });
  it('feux : détections, étranger, météo des forêts éteinte par défaut ; foyer mis en avant', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(GEO_TEXT, { status: 200 })));
    const map = new FakeMap([LYR_FOREST_DANGER_FILL]);
    const d = deck(map, { fires: true });
    const f = FIRES_FIXTURE();
    d.updateFiresLayer(f, NOW, { forestDangerFill: false });
    expect([map.count(SRC_FIRES), map.count(SRC_FIRES_ABROAD), map.count(SRC_FOREST_DANGER)]).toEqual([f.detections.length, 8, 0]);
    expect(map.visibility.get(LYR_FOREST_DANGER_FILL)).toBe('none');
    const ille = f.foyers.find((x) => x.dept === '35');
    d.highlightFoyer(ille?.id ?? null);
    expect(map.count(SRC_FIRES_HIGHLIGHT)).toBe(3);
    d.highlightFoyer(null);
    expect(map.count(SRC_FIRES_HIGHLIGHT)).toBe(0);
    d.updateFiresLayer(f, NOW, { forestDangerFill: true });
    expect(map.visibility.get(LYR_FOREST_DANGER_FILL)).toBe('visible');
  });
  it('point du profil radar : dessiné couche Radar active seulement ; effacé', () => {
    const map = new FakeMap([LYR_RADAR_PICK]);
    const d = deck(map, { weatherRadar: true });
    d.setRadarPick({ lat: 43.6, lon: 3.9 });
    expect([map.count(SRC_RADAR_PICK), map.visibility.get(LYR_RADAR_PICK)]).toEqual([1, 'visible']);
    d.setRadarPick(null);
    expect([map.count(SRC_RADAR_PICK), map.visibility.get(LYR_RADAR_PICK)]).toEqual([0, 'none']);
  });
});
