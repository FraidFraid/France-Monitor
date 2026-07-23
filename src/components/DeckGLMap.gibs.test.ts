import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeckGLMap } from './DeckGLMap.ts';
import { LYR_MODIS, SRC_MODIS } from './deckgl/constants.ts';
import {
  buildGibsViirsTileUrl,
  listGibsViirsCandidateDates,
} from '../utils/gibs-imagery.ts';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

class GibsMap {
  readonly modisSource = { setTiles: vi.fn<(tiles: string[]) => void>() };
  readonly setLayoutProperty = vi.fn();

  getSource(id: string): unknown {
    return id === SRC_MODIS ? this.modisSource : undefined;
  }

  getLayer(id: string): { id: string } {
    return { id };
  }
}

function createDeckMap(map: GibsMap): DeckGLMap {
  const deckMap = new DeckGLMap({} as HTMLElement);
  Reflect.set(deckMap, 'map', map);
  return deckMap;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DeckGLMap imagerie GIBS (fumée / feux)', () => {
  it('affiche la couche et remplace les tuiles par la première date publiée', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const map = new GibsMap();
    const deckMap = createDeckMap(map);

    deckMap.setModisOverlayVisible(true);

    expect(map.setLayoutProperty).toHaveBeenCalledWith(LYR_MODIS, 'visibility', 'visible');
    await vi.waitFor(() => {
      expect(map.modisSource.setTiles).toHaveBeenCalledWith([
        buildGibsViirsTileUrl(listGibsViirsCandidateDates()[0]),
      ]);
    });
  });

  it('ne sonde GIBS qu’une seule fois malgré des toggles répétés', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const map = new GibsMap();
    const deckMap = createDeckMap(map);

    deckMap.setModisOverlayVisible(true);
    deckMap.setModisOverlayVisible(false);
    deckMap.setModisOverlayVisible(true);
    await vi.waitFor(() => {
      expect(map.modisSource.setTiles).toHaveBeenCalled();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('abandonne le remplacement si la carte est détruite pendant le sondage', async () => {
    const probe = deferred<{ ok: boolean }>();
    const fetchMock = vi.fn().mockReturnValue(probe.promise);
    vi.stubGlobal('fetch', fetchMock);
    const map = new GibsMap();
    const deckMap = createDeckMap(map);

    deckMap.setModisOverlayVisible(true);
    Reflect.set(deckMap, 'map', null);
    probe.resolve({ ok: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(map.modisSource.setTiles).not.toHaveBeenCalled();
  });
});
