import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MapLayers } from '@/types';
import { readUrlState, writeUrlState } from './urlState.ts';

function stubWindow(search: string) {
  const loc = { search, pathname: '/' };
  vi.stubGlobal('window', {
    location: loc,
    history: {
      replaceState: (_s: unknown, _t: string, url: string) => {
        loc.search = url.includes('?') ? url.slice(url.indexOf('?')) : '';
      },
    },
  });
  return loc;
}

describe('urlState — couche Événements (spec 2026-09-29 § 5)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('events fait l’aller-retour écriture/lecture de l’URL (un rechargement la garde)', () => {
    stubWindow('');
    writeUrlState({ layers: { events: true, environmental: true } as Partial<MapLayers> });
    const layers = readUrlState().layers;
    expect(layers?.events).toBe(true);
    expect(layers?.environmental).toBe(true);
    expect(layers?.news).toBe(false);
  });
});

describe('urlState : ui=v1 conservé (la v2 est l’interface par défaut)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('les réécritures d’URL (couches, vue, zoom) gardent ?ui=v1 et view=app', () => {
    const loc = stubWindow('?view=app&ui=v1');
    writeUrlState({ lng: 2.35, lat: 48.85, zoom: 5, layers: { events: true } as Partial<MapLayers> });
    const params = new URLSearchParams(loc.search);
    expect(params.get('ui')).toBe('v1');
    expect(params.get('view')).toBe('app');
    expect(params.get('z')).toBe('5.0');
    // Une deuxième réécriture (autre couche) ne le perd pas non plus.
    writeUrlState({ layers: { news: true } as Partial<MapLayers> });
    expect(new URLSearchParams(loc.search).get('ui')).toBe('v1');
  });
});
