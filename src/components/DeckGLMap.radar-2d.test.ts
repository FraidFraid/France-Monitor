import type maplibregl from 'maplibre-gl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  failNextRadarLayerAdd = false;
  failNextRadarRemove = false;

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
    if (layer.id === RADAR_2D_LAYER_ID && this.failNextRadarLayerAdd) {
      this.failNextRadarLayerAdd = false;
      throw new Error('simulated addLayer failure');
    }
    this.layers.set(layer.id, layer as LayerWithLayout);
    this.beforeIds.set(layer.id, beforeId);
    return this;
  }

  getLayer(id: string): maplibregl.LayerSpecification | undefined {
    return this.layers.get(id) as maplibregl.LayerSpecification | undefined;
  }

  removeLayer(id: string): void {
    if (id === RADAR_2D_LAYER_ID && this.failNextRadarRemove) {
      this.failNextRadarRemove = false;
      throw new Error('simulated removeLayer failure');
    }
    this.layers.delete(id);
  }

  remove(): void {}

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
  let fetchMock: ReturnType<typeof vi.fn>;
  let createObjectUrl = vi.fn<(obj: Blob | MediaSource) => string>();
  let revokeObjectUrl = vi.fn<(url: string) => void>();
  let nextObjectUrl: number;

  beforeEach(() => {
    nextObjectUrl = 1;
    fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'image/webp' },
      }),
    ));
    createObjectUrl = vi.fn((_obj: Blob | MediaSource) => `blob:radar-${nextObjectUrl++}`);
    revokeObjectUrl = vi.fn((_url: string) => undefined);
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectUrl);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectUrl);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

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

    expect(map.imageUrl()).toBe('blob:radar-1');
    nextImage.resolve({ data: {} as ImageBitmap });
    await replacement;
    expect(map.imageUrl()).toBe('blob:radar-2');
    expect(map.getLayer(RADAR_2D_LAYER_ID)).toBeDefined();
  });

  it('fetches each remote image once and gives MapLibre only a local Blob URL', async () => {
    const close = vi.fn();
    const map = new RadarMap();
    map.loadImage.mockResolvedValue({ data: { close } as unknown as ImageBitmap });
    const deckMap = createDeckMap(map);

    await deckMap.setRadar2dOverlay(FIRST, true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(FIRST.imageUrl, expect.objectContaining({
      mode: 'cors',
      redirect: 'error',
    }));
    expect(map.loadImage).toHaveBeenCalledWith('blob:radar-1');
    expect(map.imageUrl()).toBe('blob:radar-1');
    expect(close).toHaveBeenCalledOnce();
  });

  it('uses a MapLibre-valid image source without unsupported metadata', async () => {
    const map = new RadarMap();
    map.loadImage.mockResolvedValue({ data: {} as ImageBitmap });
    const deckMap = createDeckMap(map);

    await deckMap.setRadar2dOverlay(FIRST, true);

    expect(map.sources.get(RADAR_2D_SOURCE_ID)).toEqual({
      type: 'image',
      url: 'blob:radar-1',
      coordinates: [
        [FIRST.bounds[0], FIRST.bounds[3]],
        [FIRST.bounds[2], FIRST.bounds[3]],
        [FIRST.bounds[2], FIRST.bounds[1]],
        [FIRST.bounds[0], FIRST.bounds[1]],
      ],
    });
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
    await vi.waitFor(() => expect(map.loadImage).toHaveBeenCalledTimes(2));
    nextImage.reject(new Error('simulated CORS failure'));

    await expect(replacement).rejects.toThrow('simulated CORS failure');
    expect(map.imageUrl()).toBe('blob:radar-1');
    expect(Reflect.get(deckMap, 'radar2dManifest')).toEqual(FIRST);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:radar-2');
    expect(revokeObjectUrl).not.toHaveBeenCalledWith('blob:radar-1');
    expect(Reflect.get(deckMap, '_radar2dEnabled')).toBe(true);
  });

  it('does not mutate the layer or enabled state when the remote fetch fails', async () => {
    const map = new RadarMap();
    map.loadImage.mockResolvedValue({ data: {} as ImageBitmap });
    const deckMap = createDeckMap(map);
    await deckMap.setRadar2dOverlay(FIRST, true);
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    await expect(deckMap.setRadar2dOverlay(SECOND, false)).rejects.toThrow('offline');

    expect(map.imageUrl()).toBe('blob:radar-1');
    expect(Reflect.get(deckMap, '_radar2dEnabled')).toBe(true);
    expect(revokeObjectUrl).not.toHaveBeenCalledWith('blob:radar-1');
  });

  it('cancels an oversized streamed image without Content-Length before creating a Blob URL', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(16 * 1024 * 1024 + 1));
      },
      cancel,
    });
    fetchMock.mockResolvedValueOnce(new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'image/webp' },
    }));
    const map = new RadarMap();
    map.loadImage.mockResolvedValue({ data: {} as ImageBitmap });
    const deckMap = createDeckMap(map);

    await expect(deckMap.setRadar2dOverlay(FIRST, true)).rejects.toThrow(/16 MiB/);

    expect(cancel).toHaveBeenCalledOnce();
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(map.getSource(RADAR_2D_SOURCE_ID)).toBeUndefined();
  });

  it('aborts a timed-out fetch before mutating the active layer', async () => {
    vi.useFakeTimers();
    const map = new RadarMap();
    map.loadImage.mockResolvedValue({ data: {} as ImageBitmap });
    const deckMap = createDeckMap(map);
    await deckMap.setRadar2dOverlay(FIRST, true);
    fetchMock.mockImplementationOnce((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    }));

    const replacement = deckMap.setRadar2dOverlay(SECOND, false);
    const rejection = expect(replacement).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(10_000);

    await rejection;
    expect(map.imageUrl()).toBe('blob:radar-1');
    expect(Reflect.get(deckMap, '_radar2dEnabled')).toBe(true);
  });

  it('closes a decoded image that arrives after the decode timeout', async () => {
    vi.useFakeTimers();
    const lateImage = deferred<{ data: ImageBitmap }>();
    const close = vi.fn();
    const map = new RadarMap();
    map.loadImage.mockImplementation(() => lateImage.promise);
    const deckMap = createDeckMap(map);

    const update = deckMap.setRadar2dOverlay(FIRST, true);
    const rejection = expect(update).rejects.toThrow(/decode timed out/i);
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
    lateImage.resolve({ data: { close } as unknown as ImageBitmap });
    await Promise.resolve();

    expect(close).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:radar-1');
  });

  it('does not commit a pending decoded image after destroy', async () => {
    const pendingImage = deferred<{ data: ImageBitmap }>();
    const close = vi.fn();
    const map = new RadarMap();
    map.loadImage.mockImplementation(() => pendingImage.promise);
    const deckMap = createDeckMap(map);

    const update = deckMap.setRadar2dOverlay(FIRST, true);
    await vi.waitFor(() => expect(map.loadImage).toHaveBeenCalledWith('blob:radar-1'));
    deckMap.destroy();
    pendingImage.resolve({ data: { close } as unknown as ImageBitmap });

    await expect(update).rejects.toThrow(/cancelled|superseded|destroyed/i);
    expect(close).toHaveBeenCalledOnce();
    expect(Reflect.get(deckMap, 'radar2dManifest')).toBeNull();
    expect(Reflect.get(deckMap, 'radar2dObjectUrl')).toBeNull();
    expect(Reflect.get(deckMap, '_radar2dEnabled')).toBe(false);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:radar-1');
  });

  it('revokes Blob URLs only after successful replacement, removal and destroy', async () => {
    const map = new RadarMap();
    map.loadImage.mockResolvedValue({ data: {} as ImageBitmap });
    const deckMap = createDeckMap(map);

    await deckMap.setRadar2dOverlay(FIRST, true);
    expect(revokeObjectUrl).not.toHaveBeenCalled();
    await deckMap.setRadar2dOverlay(SECOND, true);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:radar-1');
    expect(revokeObjectUrl).not.toHaveBeenCalledWith('blob:radar-2');

    await deckMap.setRadar2dOverlay(null, false);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:radar-2');

    await deckMap.setRadar2dOverlay(FIRST, true);
    deckMap.destroy();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:radar-3');
  });

  it('restores the old Blob and enabled state when the MapLibre swap throws', async () => {
    const map = new RadarMap();
    map.loadImage.mockResolvedValue({ data: {} as ImageBitmap });
    const deckMap = createDeckMap(map);
    await deckMap.setRadar2dOverlay(FIRST, true);
    map.failNextRadarLayerAdd = true;

    await expect(deckMap.setRadar2dOverlay(SECOND, false)).rejects.toThrow('simulated addLayer failure');

    expect(map.imageUrl()).toBe('blob:radar-1');
    expect(Reflect.get(deckMap, '_radar2dEnabled')).toBe(true);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:radar-2');
    expect(revokeObjectUrl).not.toHaveBeenCalledWith('blob:radar-1');
  });

  it('revokes the candidate and rolls back when removal throws', async () => {
    const map = new RadarMap();
    map.loadImage.mockResolvedValue({ data: {} as ImageBitmap });
    const deckMap = createDeckMap(map);
    await deckMap.setRadar2dOverlay(FIRST, true);
    map.failNextRadarRemove = true;

    await expect(deckMap.setRadar2dOverlay(SECOND, false)).rejects.toThrow('simulated removeLayer failure');

    expect(map.imageUrl()).toBe('blob:radar-1');
    expect(Reflect.get(deckMap, 'radar2dManifest')).toEqual(FIRST);
    expect(Reflect.get(deckMap, '_radar2dEnabled')).toBe(true);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:radar-2');
    expect(revokeObjectUrl).not.toHaveBeenCalledWith('blob:radar-1');
  });

  it.each([
    ['an invalid MIME type', new Response(new Uint8Array([1]), {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    }), /image type/],
    ['an oversized Content-Length', new Response(new Uint8Array([1]), {
      status: 200,
      headers: { 'Content-Type': 'image/webp', 'Content-Length': String(16 * 1024 * 1024 + 1) },
    }), /16 MiB/],
  ])('rejects %s before creating a Blob URL', async (_case, response, expectedError) => {
    fetchMock.mockResolvedValueOnce(response);
    const map = new RadarMap();
    const deckMap = createDeckMap(map);

    await expect(deckMap.setRadar2dOverlay(FIRST, true)).rejects.toThrow(expectedError);

    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(map.loadImage).not.toHaveBeenCalled();
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
