import { describe, it, expect } from 'vitest';
import { isStaleChunkError, shouldReloadForStaleChunk, STALE_CHUNK_RELOAD_COOLDOWN_MS } from './stale-chunk';

describe('shouldReloadForStaleChunk', () => {
  const now = 1_000_000_000;

  it('recharge si aucun rechargement précédent dans l’onglet', () => {
    expect(shouldReloadForStaleChunk(null, now)).toBe(true);
  });

  it('ne recharge pas en boucle juste après un rechargement', () => {
    expect(shouldReloadForStaleChunk(String(now - 2_000), now)).toBe(false);
  });

  it('recharge de nouveau lors d’un déploiement ultérieur dans le même onglet', () => {
    // 12/10/2026 : l'ancien drapeau « une fois par session » laissait l'écran noir au 2e déploiement.
    expect(shouldReloadForStaleChunk(String(now - STALE_CHUNK_RELOAD_COOLDOWN_MS - 1), now)).toBe(true);
  });

  it('accepte l’ancienne valeur « 1 » du drapeau comme un rechargement très ancien', () => {
    expect(shouldReloadForStaleChunk('1', now)).toBe(true);
  });
});

describe('isStaleChunkError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://www.francemonitor.com/assets/App-DCiDZVJj.js',
    'Importing a module script failed.',
    'error loading dynamically imported module',
    'Unable to preload CSS for /assets/App-x.css',
    "Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of \"text/html\"",
  ])('reconnaît « %s »', (msg) => {
    expect(isStaleChunkError(msg)).toBe(true);
  });

  it('ignore les autres erreurs', () => {
    expect(isStaleChunkError('TypeError: x is undefined')).toBe(false);
  });
});
