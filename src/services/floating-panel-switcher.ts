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
 * Barre de puces visible ? v1 : à partir de deux panneaux (cocher une couche ouvre déjà son panneau,
 * la barre ne sert qu'à passer de l'un à l'autre). v2 : dès un panneau — cocher une couche n'y ouvre
 * plus rien (spec 2026-09-29 § 4), la puce est le seul accès au panneau (sinon, au démarrage, le
 * panneau Météo/Crues de la seule couche à panneau allumée était inaccessible).
 */
export function showsSwitcher(uiV2: boolean, eligibleCount: number): boolean {
  return eligibleCount >= (uiV2 ? 1 : 2);
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

/** Largeur (px) du tiroir Couches en v2 (main.css, --v2-drawer-w). */
export const V2_DRAWER_PX = 300;
/** Place réservée au sélecteur Carte | Satellite, en haut à droite de la carte (main.css, 180 px). */
export const V2_MAP_CONTROLS_PX = 180;
/** Largeur libre minimale pour garder les libellés des puces. */
const V2_MIN_LABEL_ROOM_PX = 150;
/** Marges gauche et droite de la barre dans la carte (main.css, 12 px de chaque côté). */
const V2_SIDE_MARGINS_PX = 24;
/** Limite haute du placement mobile des puces (main.css, @media (max-width: 768px)). */
const V2_MOBILE_MAX_PX = 768;
/** Limite basse de l'ordinateur : le tiroir recouvre alors la carte (main.css, @media (min-width: 1101px)). */
const V2_DESKTOP_MIN_PX = 1101;

export interface V2SwitcherLayout {
  /** Icône seule (nom en infobulle) : faute de place réelle. */
  iconOnly: boolean;
  /** Les puces passent sous Carte | Satellite au lieu de se mettre à sa gauche. */
  belowControls: boolean;
}

/**
 * v2 : repli des puces selon la place réelle (aucun repli « par défaut » : le libellé reste visible).
 * - ordinateur (≥ 1101 px) : le tiroir ouvert recouvre le bord gauche de la carte et lui retire sa place ;
 * - tablette (769 à 1100 px) : le tiroir est une colonne à part, la largeur de la carte l'exclut déjà ;
 * - mobile (≤ 768 px) : en bas à droite ; icône seule seulement si la rangée avec libellés ne tient pas.
 * @param viewportWidth  largeur de la fenêtre
 * @param mapWidth       largeur de la zone carte (0 si masquée)
 * @param drawerOpen     tiroir Couches ouvert
 * @param oneRowWidth    largeur naturelle de la rangée avec libellés, sur une seule ligne
 */
export function v2SwitcherLayout(viewportWidth: number, mapWidth: number, drawerOpen: boolean, oneRowWidth: number): V2SwitcherLayout {
  if (viewportWidth <= V2_MOBILE_MAX_PX) {
    return { iconOnly: oneRowWidth > mapWidth - V2_SIDE_MARGINS_PX, belowControls: false };
  }
  const drawerOverMap = drawerOpen && viewportWidth >= V2_DESKTOP_MIN_PX;
  const room = mapWidth - (drawerOverMap ? V2_DRAWER_PX : 0) - V2_SIDE_MARGINS_PX;
  return {
    iconOnly: room < V2_MIN_LABEL_ROOM_PX,
    belowControls: oneRowWidth > room - V2_MAP_CONTROLS_PX,
  };
}

/** Haut par défaut des panneaux flottants de droite en tablette v2 (main.css : --header-height 56 px + 68 px). */
const V2_TABLET_PANEL_TOP_PX = 124;
/** Tablette v2 : de 769 à 1100 px, là où le panneau flotte au-dessus de la carte au lieu d'occuper la colonne État. */
const V2_TABLET_MIN_PX = 769;

/**
 * Tablette v2 (769 à 1100 px) : les panneaux de module flottent à droite, par-dessus la carte, et
 * recouvriraient les puces (dont la puce verte du panneau ouvert). Décalage à ajouter à leur haut
 * pour qu'ils commencent sous la rangée de puces. 0 hors de cette plage ou barre masquée.
 * @param chipsBottomPx  bas de la barre, en pixels de la fenêtre
 */
export function v2TabletPanelOffsetPx(chipsBottomPx: number, viewportWidth: number, barHidden: boolean): number {
  if (barHidden || viewportWidth < V2_TABLET_MIN_PX || viewportWidth >= V2_DESKTOP_MIN_PX) return 0;
  return Math.max(0, Math.round(chipsBottomPx + PANEL_GAP_PX - V2_TABLET_PANEL_TOP_PX));
}
