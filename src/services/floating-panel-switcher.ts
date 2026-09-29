// src/services/floating-panel-switcher.ts — décisions pures de la barre « Panneaux ouverts » de la
// carte (App.ts, refreshFloatingPanelSwitcher / restoreActiveLayerPanelsAfterRefresh).

/**
 * Haut de la barre, sous le sélecteur Carte | Satellite de MapLibre (coin haut droit : marge 10 px
 * + contrôle 40 px) : les deux ne se chevauchent plus. Doit rester égal au `top` de
 * `.floating-panel-switcher` dans main.css.
 */
export const SWITCHER_TOP_PX = 56;
/** Haut par défaut des panneaux flottants de droite sous l'en-tête (`--right-panel-top`). */
const PANEL_BASE_TOP_PX = 68;
const PANEL_GAP_PX = 8;

/**
 * Décalage à ajouter au haut des panneaux flottants de droite pour qu'ils commencent sous la barre.
 * v2 : les panneaux s'ouvrent au-dessus de la colonne fiche, la barre est dans la colonne carte.
 * @param switcherHeightPx  hauteur rendue de la barre, 0 si masquée
 */
export function switcherPanelOffsetPx(switcherHeightPx: number, uiV2: boolean): number {
  if (uiV2 || switcherHeightPx <= 0) return 0;
  return Math.max(0, SWITCHER_TOP_PX + switcherHeightPx + PANEL_GAP_PX - PANEL_BASE_TOP_PX);
}

/**
 * v2 : géométrie de la colonne de droite (`.fm-v2-fiche`) sous forme de variables CSS ; les panneaux
 * de module s'y posent pile (spec 2026-09-29 § 4 : « à la place de l'État »).
 */
export function v2ColumnVars(rect: { top: number; left: number; width: number; height: number }): Record<string, string> {
  return {
    '--v2-col-top': `${Math.round(rect.top)}px`,
    '--v2-col-left': `${Math.round(rect.left)}px`,
    '--v2-col-width': `${Math.round(rect.width)}px`,
    '--v2-col-height': `${Math.round(rect.height)}px`,
  };
}

/**
 * Restauration des couches persistées au chargement (v1) : un seul panneau flottant se rouvre
 * (règle « un seul panneau à la fois », audit UI 2026-09 §5.3.3), celui de la première couche dans
 * l'ordre de restauration. Les couches qui partagent ce panneau le chargent aussi ; une couche sans
 * panneau se charge normalement ; les autres restent actives sur la carte, panneau fermé, et
 * restent accessibles par la barre de boutons.
 */
export function restorePanelPlan<K extends string>(
  activeKeys: readonly K[],
  panelOf: (key: K) => string | null,
): { open: K[]; silent: K[] } {
  const open: K[] = [];
  const silent: K[] = [];
  let opened: string | null = null;
  for (const key of activeKeys) {
    const panel = panelOf(key);
    if (panel === null) {
      open.push(key);
    } else if (opened === null || panel === opened) {
      opened = panel;
      open.push(key);
    } else {
      silent.push(key);
    }
  }
  return { open, silent };
}
