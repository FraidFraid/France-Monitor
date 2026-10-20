// src/components/deckgl/france-fit.ts : recadrage « France métropolitaine et Corse » dans la partie visible de la carte
// (20/10/2026). Pur. La carte est en partie couverte (barre des pastilles en haut, panneau de couche à droite, mini-légendes,
// légende) : on mesure ce qui la recouvre et on en fait des marges, pour que l'Hexagone et la Corse tiennent dans ce qui reste.

/** Emprise de la métropole et de la Corse [ouest, sud, est, nord] : Ouessant, Bonifacio, cap Corse, Bray-Dunes. */
export const FRANCE_METRO_BOUNDS: [number, number, number, number] = [-5.2, 41.3, 9.6, 51.1];

export interface Rect { left: number; top: number; right: number; bottom: number }
export interface Padding { top: number; right: number; bottom: number; left: number }

/** Marge autour de la France une fois les recouvrements retirés (px). */
export const FIT_MARGIN_PX = 24;
/** Part minimale de la carte gardée pour la France, en largeur et en hauteur (un panneau très large ne l'écrase pas). */
const MIN_FREE_SHARE = 0.4;

/**
 * Marges dues aux éléments posés sur la carte. Chaque élément réserve le côté (haut, bas, gauche ou droite) qui retire le moins
 * de surface à la carte. Un élément hors de la carte ne compte pas. Les marges sont bornées pour laisser au moins 40 % de la carte en largeur et en hauteur.
 */
export function overlayPadding(map: Rect, overlays: readonly Rect[], margin = FIT_MARGIN_PX): Padding {
  const pad: Padding = { top: 0, right: 0, bottom: 0, left: 0 };
  const width = map.right - map.left;
  const height = map.bottom - map.top;
  const cx = (map.left + map.right) / 2;
  const cy = (map.top + map.bottom) / 2;
  for (const o of overlays) {
    const left = Math.max(o.left, map.left);
    const right = Math.min(o.right, map.right);
    const top = Math.max(o.top, map.top);
    const bottom = Math.min(o.bottom, map.bottom);
    if (right <= left || bottom <= top) continue;
    // Le côté qui coûte le moins de carte (20/10/2026) : une barre de pastilles courte en haut réservait sinon toute la moitié
    // gauche (Transports, barre à 43 % de la largeur), et le cadrage changeait d'un onglet à l'autre. À surface égale, la moitié
    // où se trouve l'élément.
    const options: Array<[keyof Padding, number]> = [
      ['top', (bottom - map.top) * width], ['bottom', (map.bottom - top) * width],
      ['left', (right - map.left) * height], ['right', (map.right - left) * height],
    ];
    const near = (side: keyof Padding): boolean => (side === 'top' ? (top + bottom) / 2 < cy : side === 'bottom' ? (top + bottom) / 2 >= cy
      : side === 'left' ? (left + right) / 2 < cx : (left + right) / 2 >= cx);
    options.sort((x, y) => x[1] - y[1] || Number(near(y[0])) - Number(near(x[0])));
    const side = options[0]?.[0] ?? 'top';
    const reserve = side === 'top' ? bottom - map.top : side === 'bottom' ? map.bottom - top : side === 'left' ? right - map.left : map.right - left;
    pad[side] = Math.max(pad[side], reserve);
  }
  const out: Padding = { top: pad.top + margin, right: pad.right + margin, bottom: pad.bottom + margin, left: pad.left + margin };
  const squeeze = (a: keyof Padding, b: keyof Padding, size: number): void => {
    const max = size * (1 - MIN_FREE_SHARE);
    const sum = out[a] + out[b];
    if (sum <= max || sum === 0) return;
    out[a] = Math.round((out[a] * max) / sum);
    out[b] = Math.round((out[b] * max) / sum);
  };
  squeeze('left', 'right', width);
  squeeze('top', 'bottom', height);
  return out;
}

/**
 * Marges de `fitBounds`, rapportées au conteneur de la carte, quand celui-ci déborde de la fenêtre (20/10/2026 : conteneur de
 * 1 257 px de haut pour 973 px visibles) : la France est cadrée dans la partie de la carte à l'écran, privée de ce qui la recouvre.
 */
export function visibleFitPadding(container: Rect, viewport: Rect, overlays: readonly Rect[], margin = FIT_MARGIN_PX): Padding {
  const visible: Rect = {
    left: Math.max(container.left, viewport.left), top: Math.max(container.top, viewport.top),
    right: Math.min(container.right, viewport.right), bottom: Math.min(container.bottom, viewport.bottom),
  };
  if (visible.right <= visible.left || visible.bottom <= visible.top) return overlayPadding(container, overlays, margin);
  const inner = overlayPadding(visible, overlays, margin);
  return {
    top: inner.top + (visible.top - container.top),
    right: inner.right + (container.right - visible.right),
    bottom: inner.bottom + (container.bottom - visible.bottom),
    left: inner.left + (visible.left - container.left),
  };
}
