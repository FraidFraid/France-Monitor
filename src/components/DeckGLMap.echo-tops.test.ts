import type maplibregl from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';

import { DeckGLMap } from './DeckGLMap.ts';
import { ECHO_TOPS_LAYER_ID, ECHO_TOPS_SOURCE_ID } from './deckgl/format-utils.ts';
import { LYR_FIRES_GLOW } from './deckgl/constants.ts';
import type { Radar2dManifest } from '../services/radar-2d.ts';

const MANIFEST: Radar2dManifest = {
  schemaVersion: 1,
  source: 'Météo-France DPRadar',
  observedAt: '2026-07-23T07:35:00Z',
  generatedAt: '2026-07-23T07:36:00Z',
  bounds: [-9.965, 39.46785, 14.564708, 53.67],
  imageUrl: 'https://radar.example.test/rasters/radar-x.webp',
  resolutionMeters: 1000,
  license: 'Licence Ouverte 2.0',
  echoTopImageUrl: 'https://radar.example.test/rasters/radar-echotops-x.webp',
};

type LayerWithLayout = maplibregl.AddLayerObject & {
  layout?: Record<string, unknown>;
};

class EchoMap {
  readonly sources = new Map<string, maplibregl.SourceSpecification>();
  readonly layers = new Map<string, LayerWithLayout>();
  readonly beforeIds = new Map<string, string | undefined>();
  readonly updateImage = vi.fn();

  addSource(id: string, source: maplibregl.SourceSpecification): void {
    this.sources.set(id, source);
  }

  getSource(id: string): unknown {
    return this.sources.has(id) ? { updateImage: this.updateImage } : undefined;
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

  setLayoutProperty(id: string, name: string, value: unknown): this {
    const layer = this.layers.get(id);
    if (layer) layer.layout = { ...layer.layout, [name]: value };
    return this;
  }

  visibility(): unknown {
    return this.layers.get(ECHO_TOPS_LAYER_ID)?.layout?.visibility;
  }
}

function createDeckMap(map: EchoMap): DeckGLMap {
  const deckMap = new DeckGLMap({} as HTMLElement);
  Reflect.set(deckMap, 'map', map);
  return deckMap;
}

describe('DeckGLMap sommets d’écho', () => {
  it('crée la source image sous le halo FIRMS avec la bonne emprise', () => {
    const map = new EchoMap();
    map.addLayer({ id: LYR_FIRES_GLOW, type: 'circle' } as maplibregl.AddLayerObject);
    const deckMap = createDeckMap(map);

    deckMap.setEchoTopsOverlay(MANIFEST, true);

    const source = map.sources.get(ECHO_TOPS_SOURCE_ID);
    expect(source).toEqual({
      type: 'image',
      url: MANIFEST.echoTopImageUrl,
      coordinates: [
        [-9.965, 53.67],
        [14.564708, 53.67],
        [14.564708, 39.46785],
        [-9.965, 39.46785],
      ],
    });
    expect(map.beforeIds.get(ECHO_TOPS_LAYER_ID)).toBe(LYR_FIRES_GLOW);
    expect(map.visibility()).toBe('visible');
  });

  it('masque la couche quand le toggle est coupé', () => {
    const map = new EchoMap();
    const deckMap = createDeckMap(map);

    deckMap.setEchoTopsOverlay(MANIFEST, true);
    deckMap.setEchoTopsOverlay(MANIFEST, false);

    expect(map.visibility()).toBe('none');
  });

  it('remplace l’image quand une nouvelle observation est publiée', () => {
    const map = new EchoMap();
    const deckMap = createDeckMap(map);

    deckMap.setEchoTopsOverlay(MANIFEST, true);
    const next = {
      ...MANIFEST,
      echoTopImageUrl: 'https://radar.example.test/rasters/radar-echotops-y.webp',
    };
    deckMap.setEchoTopsOverlay(next, true);

    expect(map.updateImage).toHaveBeenCalledWith({
      url: next.echoTopImageUrl,
      coordinates: [
        [-9.965, 53.67],
        [14.564708, 53.67],
        [14.564708, 39.46785],
        [-9.965, 39.46785],
      ],
    });
  });

  it('reste inerte sans manifeste, sans URL sommets d’écho ou sans carte', () => {
    const map = new EchoMap();
    const deckMap = createDeckMap(map);
    const { echoTopImageUrl: _omitted, ...withoutEcho } = MANIFEST;

    deckMap.setEchoTopsOverlay(null, true);
    deckMap.setEchoTopsOverlay(withoutEcho as Radar2dManifest, true);
    expect(map.sources.has(ECHO_TOPS_SOURCE_ID)).toBe(false);

    Reflect.set(deckMap, 'map', null);
    expect(() => deckMap.setEchoTopsOverlay(MANIFEST, true)).not.toThrow();
  });
});
