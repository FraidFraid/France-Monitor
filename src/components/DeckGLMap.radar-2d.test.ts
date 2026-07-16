import type maplibregl from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';

import { DeckGLMap } from './DeckGLMap.ts';
import { MapContainer } from './MapContainer.ts';
import { RADAR_2D_LAYER_ID, RADAR_2D_SOURCE_ID } from './deckgl/format-utils.ts';
import { getWeatherRadarLayerId, getWeatherRadarSourceId } from './deckgl/format-utils.ts';
import { LYR_FIRES_GLOW } from './deckgl/constants.ts';
import type { Radar2dManifest } from '../services/radar-2d.ts';

const FIRST: Radar2dManifest = {
  schemaVersion: 1,
  source: 'Météo-France DPRadar',
  observedAt: '2026-07-16T12:50:00Z',
  generatedAt: '2026-07-16T12:52:00Z',
  bounds: [-6.2, 40.8, 10.1, 52.3],
  imageUrl: 'https://radar.example.test/first.webp',
  resolutionMeters: 1000,
  license: 'Licence Ouverte 2.0',
};

const SECOND: Radar2dManifest = {
  ...FIRST,
  observedAt: '2026-07-16T13:00:00Z',
  generatedAt: '2026-07-16T13:02:00Z',
  imageUrl: 'https://radar.example.test/second.webp',
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

type LayerWithLayout = maplibregl.AddLayerObject & {
  layout?: Record<string, unknown>;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class RadarMap {
  readonly sources = new Map<string, maplibregl.SourceSpecification>();
  readonly layers = new Map<string, LayerWithLayout>();
  readonly loadImage = vi.fn<(url: string) => Promise<{ data: ImageBitmap }>>();
  readonly beforeIds = new Map<string, string | undefined>();

  addSource(id: string, source: maplibregl.SourceSpecification): void {
    this.sources.set(id, source);
  }

  getSource(id: string): maplibregl.Source | undefined {
    return this.sources.has(id) ? ({} as maplibregl.Source) : undefined;
  }

  removeSource(id: string): void {
    this.sources.delete(id);
  }

  addLayer(layer: maplibregl.AddLayerObject, beforeId?: string): this {
    this.layers.set(layer.id, layer as LayerWithLayout);
    this.beforeIds.set(layer.id, beforeId);
    return this;
  }

  getLayer(id: string): maplibregl.LayerSpecification | undefined {
    return this.layers.get(id) as maplibregl.LayerSpecification | undefined;
  }

  removeLayer(id: string): void {
    this.layers.delete(id);
  }

  setLayoutProperty(id: string, name: string, value: unknown): this {
    const layer = this.layers.get(id);
    if (layer) layer.layout = { ...layer.layout, [name]: value };
    return this;
  }

  imageUrl(): string | undefined {
    const source = this.sources.get(RADAR_2D_SOURCE_ID);
    return source && 'url' in source ? source.url : undefined;
  }
}

function createDeckMap(map: RadarMap): DeckGLMap {
  const deckMap = new DeckGLMap({} as HTMLElement);
  Reflect.set(deckMap, 'map', map);
  Reflect.set(deckMap, '_radar2dEnabled', true);
  return deckMap;
}

describe('DeckGLMap radar 2D atomic replacement', () => {
  it('keeps the previous layer until the replacement image is loaded', async () => {
    const nextImage = deferred<{ data: ImageBitmap }>();
    const map = new RadarMap();
    map.loadImage
      .mockResolvedValueOnce({ data: {} as ImageBitmap })
      .mockImplementationOnce(() => nextImage.promise);
    const deckMap = createDeckMap(map);

    await deckMap.setRadar2dOverlay(FIRST, true);
    const replacement = deckMap.setRadar2dOverlay(SECOND, true);
    await Promise.resolve();

    expect(map.imageUrl()).toBe(FIRST.imageUrl);
    nextImage.resolve({ data: {} as ImageBitmap });
    await replacement;
    expect(map.imageUrl()).toBe(SECOND.imageUrl);
    expect(map.getLayer(RADAR_2D_LAYER_ID)).toBeDefined();
  });

  it('keeps the previous layer when replacement image loading fails asynchronously', async () => {
    const nextImage = deferred<{ data: ImageBitmap }>();
    const map = new RadarMap();
    map.loadImage
      .mockResolvedValueOnce({ data: {} as ImageBitmap })
      .mockImplementationOnce(() => nextImage.promise);
    const deckMap = createDeckMap(map);

    await deckMap.setRadar2dOverlay(FIRST, true);
    const replacement = deckMap.setRadar2dOverlay(SECOND, true);
    nextImage.reject(new Error('simulated CORS failure'));

    await expect(replacement).rejects.toThrow('simulated CORS failure');
    expect(map.imageUrl()).toBe(FIRST.imageUrl);
    expect(Reflect.get(deckMap, 'radar2dManifest')).toEqual(FIRST);
  });

  it('starts hidden below FIRMS and leaves the RainViewer layer untouched', async () => {
    const map = new RadarMap();
    const rainSourceId = getWeatherRadarSourceId('france');
    const rainLayerId = getWeatherRadarLayerId('france');
    map.sources.set(rainSourceId, { type: 'raster', tiles: ['https://rain.example/{z}/{x}/{y}.png'] });
    map.layers.set(rainLayerId, { id: rainLayerId, type: 'raster', source: rainSourceId });
    map.layers.set(LYR_FIRES_GLOW, { id: LYR_FIRES_GLOW, type: 'circle', source: 'fires' });
    map.loadImage.mockResolvedValue({ data: {} as ImageBitmap });
    const deckMap = createDeckMap(map);

    await deckMap.setRadar2dOverlay(FIRST, false);

    expect(map.layers.get(RADAR_2D_LAYER_ID)?.layout?.visibility).toBe('none');
    expect(map.beforeIds.get(RADAR_2D_LAYER_ID)).toBe(LYR_FIRES_GLOW);
    expect(map.sources.get(rainSourceId)).toBeDefined();
    expect(map.layers.get(rainLayerId)).toBeDefined();
  });
});

describe('MapContainer radar 2D state', () => {
  it('commits the manifest only after DeckGLMap accepts it', async () => {
    const container = Object.create(MapContainer.prototype) as MapContainer;
    const install = deferred<void>();
    const deckMap = { setRadar2dOverlay: vi.fn(() => install.promise) };
    Reflect.set(container, 'deckMap', deckMap);
    Reflect.set(container, 'radar2dManifest', FIRST);
    Reflect.set(container, 'radar2dEnabled', true);

    const update = container.setRadar2dOverlay(SECOND, true);
    expect(Reflect.get(container, 'radar2dManifest')).toEqual(FIRST);

    install.reject(new Error('image unavailable'));
    await expect(update).rejects.toThrow('image unavailable');
    expect(Reflect.get(container, 'radar2dManifest')).toEqual(FIRST);
    expect(Reflect.get(container, 'radar2dEnabled')).toBe(true);
  });
});
