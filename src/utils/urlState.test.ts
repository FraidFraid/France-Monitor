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
