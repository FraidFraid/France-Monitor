// src/components/deckgl/france-fit.test.ts : marges du recadrage « France et Corse ».
import { describe, expect, it } from 'vitest';
import { FIT_MARGIN_PX, FRANCE_METRO_BOUNDS, overlayPadding, visibleFitPadding } from './france-fit.ts';

const MAP = { left: 300, top: 100, right: 1300, bottom: 900 };
const M = FIT_MARGIN_PX;

describe('recadrage France et Corse', () => {
  it('emprise : Ouessant à l’ouest, Bonifacio au sud, cap Corse à l’est, Bray-Dunes au nord', () => {
    const [w, s, e, n] = FRANCE_METRO_BOUNDS;
    expect(w).toBeLessThan(-5.1);
    expect(s).toBeLessThan(41.37);
    expect(e).toBeGreaterThan(9.55);
    expect(n).toBeGreaterThan(51.08);
  });
  it('rien sur la carte : la marge seule', () => {
    expect(overlayPadding(MAP, [])).toEqual({ top: M, right: M, bottom: M, left: M });
  });
  it('barre des pastilles en haut (large) et panneau à droite (étroit)', () => {
    const p = overlayPadding(MAP, [
      { left: 310, top: 110, right: 1250, bottom: 190 },
      { left: 900, top: 100, right: 1300, bottom: 900 },
    ]);
    expect(p).toEqual({ top: 90 + M, right: 400 + M, bottom: M, left: M });
  });
  it('élément hors de la carte (colonne de gauche) : ignoré ; mini-légende à gauche : réserve la gauche', () => {
    const p = overlayPadding(MAP, [{ left: 0, top: 0, right: 290, bottom: 900 }, { left: 310, top: 200, right: 560, bottom: 420 }]);
    expect(p.left).toBe(260 + M);
  });
  it('panneau très large : la France garde au moins 40 % de la largeur', () => {
    const p = overlayPadding(MAP, [{ left: 520, top: 100, right: 1300, bottom: 900 }]);
    expect(p.left + p.right).toBeLessThanOrEqual(600);
  });
});

describe('carte qui déborde de la fenêtre', () => {
  it('conteneur de 1 257 px pour 973 visibles : la partie cachée s’ajoute à la marge du bas', () => {
    const p = visibleFitPadding({ left: 320, top: 101, right: 1224, bottom: 1257 }, { left: 0, top: 0, right: 1232, bottom: 973 }, []);
    expect(p).toEqual({ top: M, right: M, bottom: M + 284, left: M });
  });
});
