// Plus de doublon (spec 2026-10-14) : un article rattaché à un événement dessiné n'est pas redessiné ; couche Événements éteinte, il revient.
import type maplibregl from 'maplibre-gl';
import { describe, expect, it } from 'vitest';

import { DeckGLMap } from './DeckGLMap.ts';
import { SRC, SRC_CRITICAL } from './deckgl/constants.ts';
import type { MapLayers, NewsItem } from '../types/index.ts';
import type { EventMapPoint } from '../services/v2-map.ts';

class PaintMap {
  readonly painted = new Map<string, GeoJSON.FeatureCollection>();
  getSource(id: string): unknown {
    return { setData: (fc: GeoJSON.FeatureCollection) => { this.painted.set(id, fc); } };
  }
  getLayer(): undefined { return undefined; }
  getZoom(): number { return 5; }
  getBounds(): { contains: () => boolean } { return { contains: () => false }; }
  project(): { x: number; y: number } { return { x: 0, y: 0 }; }
  triggerRepaint(): void { /* rien à dessiner */ }
}

const item = (id: string, eventId?: number): NewsItem => ({
  id, source: 'Le Monde', title: id, link: 'https://x.fr', pubDate: new Date(0), isAlert: false,
  lat: 48.8, lon: 2.3, eventId, threat: { level: 'medium', category: 'social', confidence: 0.8, source: 'keyword' },
});
const point = (id: number): EventMapPoint => ({
  id, title: 'Grève', lon: 2.3, lat: 48.8, level: 'jaune', radius: 8, hollow: false, color: [255, 204, 0], category: 'social', alert: false,
});
const layers = (events: boolean): MapLayers => ({ news: true, events } as MapLayers);
const ids = (map: PaintMap): string[] => [...(map.painted.get(SRC)?.features ?? []), ...(map.painted.get(SRC_CRITICAL)?.features ?? [])]
  .map((f) => String(f.properties?.['itemId']));

describe('articles sans doublon', () => {
  it('masque les articles d’un événement dessiné, les rend quand la couche Événements s’éteint', () => {
    const map = new PaintMap();
    const deck = new DeckGLMap({} as HTMLElement);
    Reflect.set(deck, 'map', map as unknown as maplibregl.Map);
    deck.setLayerVisibility(layers(true));
    deck.updateNews([item('a', 1), item('b', 2), item('c')]);
    deck.setEventPoints([point(1)]);
    expect(ids(map)).toEqual(['b', 'c']);

    deck.setLayerVisibility(layers(false));
    expect(ids(map).sort()).toEqual(['a', 'b', 'c']);
  });
});
