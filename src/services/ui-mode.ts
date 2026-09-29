// src/services/ui-mode.ts — bascule de la nouvelle interface « poste de situation » (refonte UI,
// spec §10) : `?ui=v2` active la disposition A1 pendant les étapes 2 et 3. Sans ce paramètre,
// l'interface actuelle reste celle par défaut. Module minuscule : main.ts et App.ts l'importent
// statiquement sans alourdir le chemin critique.

export function isUiV2(search: string): boolean {
  return new URLSearchParams(search).get('ui') === 'v2';
}

/**
 * Garde avant `recordStabilitySnapshot` / `pushHistorySnapshot` (correction post-relecture, tâche
 * 11) : en v2, tant que les couches critiques ne sont pas chargées (`v2IntelStarted` faux), les
 * caches consommés par l'instantané sont encore vides. Écrire un instantané vide dans l'historique
 * de situation — partagé par tous les visiteurs, le serveur ne garde que la première écriture de
 * chaque créneau de 6 h (SET NX) — fausserait l'historique de tout le monde, pas seulement du
 * visiteur v2. En v1, le tiroir décide seul de sa visibilité : cette garde n'y change rien (vrai).
 */
export function shouldRecordIntelSnapshot(uiV2: boolean, v2IntelStarted: boolean): boolean {
  return !uiV2 || v2IntelStarted;
}

/**
 * Options d'une activation de couche déclenchée depuis le poste (« Voir sur la carte »,
 * « Afficher la couche », « Voir l'aéronef ») — relecture finale I1 : en v2, les panneaux
 * flottants (position: fixed, à droite) recouvriraient la colonne fiche ; la couche s'active sans
 * ouvrir son panneau, qui reste accessible par le sélecteur de panneaux (§14). v1 : inchangé.
 */
export function layerActivationOptions(uiV2: boolean): { suppressPanel?: boolean } {
  return uiV2 ? { suppressPanel: true } : {};
}

/** Réouverture, au chargement, des panneaux des couches persistées : v1 seulement (relecture finale I1). */
export function reopensLayerPanelsOnLoad(uiV2: boolean): boolean {
  return !uiV2;
}

/**
 * v2 (spec 2026-09-29 § 4) : un panneau de module ne s'ouvre que sur une demande explicite de
 * l'analyste (sélecteur de panneaux, « Voir les indicateurs » d'une bulle de la carte), jamais au
 * chargement ni à l'activation d'une couche. Le déclencheur le dit par `detail.explicit === true`.
 * v1 : inchangé, tout déclencheur ouvre le panneau.
 */
export function opensModulePanel(uiV2: boolean, detail: unknown): boolean {
  if (!uiV2) return true;
  return typeof detail === 'object' && detail !== null && (detail as { explicit?: unknown }).explicit === true;
}

/**
 * Stockage de l'état des couches. v2 : la session — un rechargement le garde, une nouvelle visite
 * repart des couches de démarrage (spec 2026-09-29 § 5). v1 : localStorage, comme avant. null si
 * le stockage est inaccessible (navigation privée stricte) : rien n'est gardé.
 */
export function layerStateStorage(uiV2: boolean, win: Pick<Window, 'localStorage' | 'sessionStorage'>): Storage | null {
  try {
    return uiV2 ? win.sessionStorage : win.localStorage;
  } catch {
    return null;
  }
}

/** Libellé d'état d'une source dans la légende ; v2 : l'état de la récupération, jamais « temps réel ». */
export function legendStatusLabel(uiV2: boolean, status: 'ok' | 'stale' | 'error'): string {
  if (status === 'ok') return uiV2 ? 'À JOUR' : 'TEMPS RÉEL';
  if (status === 'stale') return uiV2 ? 'EN RETARD' : 'CACHE FIGÉ';
  return 'INDISPONIBLE';
}

export type PosteLayout = 'mobile' | 'tablet' | 'desktop';

/** Disposition selon la largeur (spec §9) : moins de 700 px mobile, 700 à 1 100 px tablette. */
export function layoutFor(width: number): PosteLayout {
  if (width < 700) return 'mobile';
  if (width <= 1100) return 'tablet';
  return 'desktop';
}

/** Panneaux de module de la v2 : à la place de l'État seulement en bureau (≥ 1101 px). */
export function moduleInColumn(uiV2: boolean, width: number): boolean {
  return uiV2 && layoutFor(width) === 'desktop';
}
