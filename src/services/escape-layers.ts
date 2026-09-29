// src/services/escape-layers.ts — Échap ne ferme que l'élément le plus intérieur : décision partagée
// entre la fiche (PosteSituation) et les panneaux de module (App).

const INNER_LAYERS = '[aria-modal="true"], [role="dialog"], [role="menu"]:not([hidden]), .maplibregl-popup';

/**
 * Fenêtre, menu ou bulle de carte affichés : ils reçoivent Échap avant la fiche et les panneaux.
 * `ignore` : sélecteur des éléments qui ne comptent pas comme couche (ex. le panneau de module lui-même).
 */
export function innerLayerOpen(root: ParentNode = document, ignore?: string): boolean {
  for (const el of root.querySelectorAll(INNER_LAYERS)) {
    if (el.getClientRects().length === 0) continue;
    // Fenêtre fermée mais laissée dans le DOM (ex. « À propos » : display:block, aria-hidden="true").
    if (el.closest('[aria-hidden="true"]')) continue;
    if (ignore && el.closest(ignore)) continue;
    return true;
  }
  return false;
}
