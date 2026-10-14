// @vitest-environment happy-dom
// Pictos et étiquettes des alertes (spec 2026-10-14) : rouge et orange seulement, étiquettes sans chevauchement, rien si la couche est éteinte.
import type maplibregl from 'maplibre-gl';
import { describe, expect, it } from 'vitest';

import { DeckGLMap } from './DeckGLMap.ts';
import type { MapLayers } from '../types/index.ts';
import type { EventMapPoint } from '../services/v2-map.ts';

class ProjectMap {
  getSource(): unknown { return { setData: () => undefined }; }
  getLayer(): undefined { return undefined; }
  getZoom(): number { return 6; }
  getBounds(): { contains: () => boolean } { return { contains: () => true }; }
  project([lon, lat]: [number, number]): { x: number; y: number } { return { x: lon * 100, y: lat * 10 }; }
  triggerRepaint(): void { /* rien */ }
}

const pt = (id: number, level: EventMapPoint['level'], lon: number, lat: number, title = 'Incendie sur un site industriel'): EventMapPoint => ({
  id, title, lon, lat, level, radius: 8, hollow: false, color: [0, 0, 0], category: 'security',
  alert: level === 'rouge' || level === 'orange',
});

function setup(): { deck: DeckGLMap; overlay: HTMLElement } {
  const deck = new DeckGLMap({} as HTMLElement);
  const overlay = document.createElement('div');
  Reflect.set(deck, 'map', new ProjectMap() as unknown as maplibregl.Map);
  Reflect.set(deck, 'alertOverlay', overlay);
  deck.setLayerVisibility({ news: true, events: true } as MapLayers);
  return { deck, overlay };
}

describe('alertes de la carte', () => {
  it('un picto par alerte rouge ou orange, aucun pour le jaune', () => {
    const { deck, overlay } = setup();
    deck.setEventPoints([pt(1, 'rouge', 1, 49), pt(2, 'orange', 5, 43), pt(3, 'jaune', 2, 48)]);
    expect(overlay.querySelectorAll('.event-alert')).toHaveLength(2);
    expect(overlay.querySelectorAll('.event-alert svg')).toHaveLength(2);
  });

  it('deux étiquettes qui se chevauchent : seule la plus grave reste', () => {
    const { deck, overlay } = setup();
    deck.setEventPoints([pt(1, 'orange', 1, 49), pt(2, 'rouge', 1.01, 49.05)]);
    const labels = [...overlay.querySelectorAll('.event-alert__label')].map((l) => l.textContent);
    expect(labels).toEqual(['Incendie sur un site industriel']);
    expect(overlay.querySelector('.event-alert__label')?.closest('.event-alert')?.getAttribute('data-id')).toBe('2');
  });

  it('couche Événements éteinte : calque vide', () => {
    const { deck, overlay } = setup();
    deck.setEventPoints([pt(1, 'rouge', 1, 49)]);
    deck.setLayerVisibility({ news: true, events: false } as MapLayers);
    expect(overlay.children).toHaveLength(0);
  });

  it('le titre est échappé', () => {
    const { deck, overlay } = setup();
    deck.setEventPoints([pt(1, 'rouge', 1, 49, '<img src=x onerror=alert(1)>')]);
    expect(overlay.querySelector('img')).toBeNull();
  });
});
