import type maplibregl from 'maplibre-gl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mtgMocks = vi.hoisted(() => ({
  fetchMetadata: vi.fn(),
}));

vi.mock('../services/mtg-frp.ts', () => ({
  fetchMtgFrpMetadata: mtgMocks.fetchMetadata,
  getMtgFrpTileTemplate: () => '/api/fire-observations/mtg-frp?operation=map&bbox={bbox-epsg-3857}',
}));

import { DeckGLMap } from './DeckGLMap.ts';
import { MTG_FRP_LAYER_ID, MTG_FRP_SOURCE_ID } from './deckgl/format-utils.ts';
import { LYR_FIRES_GLOW } from './deckgl/constants.ts';

const FIRST_OBSERVATION = '2026-07-16T12:50:00Z';
const SECOND_OBSERVATION = '2026-07-16T13:00:00Z';

type LayerWithLayout = maplibregl.AddLayerObject & {
  layout?: Record<string, unknown>;
};

class AntiFlashMap {
  private readonly sources = new Map<string, maplibregl.SourceSpecification>();
  private readonly layers = new Map<string, LayerWithLayout>();
  readonly beforeIds = new Map<string, string | undefined>();
  private failNextMtgLayerAdd = false;

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
    const layerWithLayout = layer as LayerWithLayout;
    if (layerWithLayout.id === MTG_FRP_LAYER_ID && this.failNextMtgLayerAdd) {
      this.failNextMtgLayerAdd = false;
      throw new Error('simulated MapLibre addLayer failure');
    }
    this.beforeIds.set(layerWithLayout.id, beforeId);

    // Reproduit le wrapper anti-flash installé par DeckGLMap.init().
    layerWithLayout.layout = { ...layerWithLayout.layout, visibility: 'none' };
    this.layers.set(layerWithLayout.id, layerWithLayout);
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

  failNextAdd(): void {
    this.failNextMtgLayerAdd = true;
  }

  visibility(): unknown {
    return this.layers.get(MTG_FRP_LAYER_ID)?.layout?.visibility;
  }

  tileUrl(): string | undefined {
    const source = this.sources.get(MTG_FRP_SOURCE_ID);
    return source && 'tiles' in source ? source.tiles?.[0] : undefined;
  }

  tileSize(): number | undefined {
    const source = this.sources.get(MTG_FRP_SOURCE_ID);
    return source && 'tileSize' in source ? source.tileSize : undefined;
  }
}

function createDeckMap(map: AntiFlashMap): DeckGLMap {
  const deckMap = new DeckGLMap({} as HTMLElement);
  Reflect.set(deckMap, 'map', map);
  Reflect.set(deckMap, '_mtgFrpEnabled', true);
  return deckMap;
}

describe('DeckGLMap MTG-FRP lifecycle', () => {
  beforeEach(() => {
    mtgMocks.fetchMetadata.mockReset();
  });

  it('reapplies enabled visibility after anti-flash creation, replacement and rollback', async () => {
    mtgMocks.fetchMetadata
      .mockResolvedValueOnce({ observedAt: FIRST_OBSERVATION })
      .mockResolvedValueOnce({ observedAt: SECOND_OBSERVATION })
      .mockResolvedValueOnce({ observedAt: FIRST_OBSERVATION });
    const map = new AntiFlashMap();
    const deckMap = createDeckMap(map);

    await deckMap.ensureMtgFrpLayer();
    expect(map.visibility()).toBe('visible');

    await deckMap.ensureMtgFrpLayer(true);
    expect(map.visibility()).toBe('visible');
    expect(map.tileUrl()).toContain(encodeURIComponent(SECOND_OBSERVATION));

    map.failNextAdd();
    await expect(deckMap.ensureMtgFrpLayer(true)).rejects.toThrow('simulated MapLibre addLayer failure');
    expect(map.visibility()).toBe('visible');
    expect(map.tileUrl()).toContain(encodeURIComponent(SECOND_OBSERVATION));
  });
});

describe('DeckGLMap MTG-FRP lisibilité', () => {
  it('insère la couche au sommet de la pile, au-dessus des points FIRMS', async () => {
    mtgMocks.fetchMetadata.mockResolvedValueOnce({ observedAt: FIRST_OBSERVATION });
    const map = new AntiFlashMap();
    map.addLayer({ id: LYR_FIRES_GLOW, type: 'circle' } as maplibregl.AddLayerObject);
    const deckMap = createDeckMap(map);

    await deckMap.ensureMtgFrpLayer();

    expect(map.getLayer(MTG_FRP_LAYER_ID)).toBeDefined();
    expect(map.beforeIds.get(MTG_FRP_LAYER_ID)).toBeUndefined();
  });

  it('étire les tuiles WMS sur 512 px pour doubler la taille des symboles ADAGUC', async () => {
    mtgMocks.fetchMetadata.mockResolvedValueOnce({ observedAt: FIRST_OBSERVATION });
    const map = new AntiFlashMap();
    const deckMap = createDeckMap(map);

    await deckMap.ensureMtgFrpLayer();

    expect(map.tileSize()).toBe(512);
  });
});
