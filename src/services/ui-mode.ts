// src/services/ui-mode.ts : bascule de l'interface « poste de situation » (refonte UI, spec §10).
// Depuis la validation de la refonte, la v2 « carte d'abord » (disposition A1) est l'interface par
// défaut ; `?ui=v1` redonne l'ancienne interface. Module minuscule : main.ts et App.ts l'importent
// statiquement sans alourdir le chemin critique.

/** v2 par défaut depuis la validation de la refonte (spec 2026-09-29 § 10) ; ?ui=v1 garde l'ancienne interface. */
export function isUiV2(search: string): boolean {
  return new URLSearchParams(search).get('ui') !== 'v1';
}

/**
 * Page d'accueil ou tableau de bord ? La page d'accueil ne s'affiche que sur « / » sans paramètre
 * ni ancre. `?view=app` et un `?ui=v2` explicite mènent au tableau de bord. Comme la v2 est
 * désormais la valeur par défaut de `isUiV2`, il ne faut surtout pas s'en servir ici : « / » seul
 * est « v2 » par défaut et masquerait la page d'accueil pour tout le monde.
 */
export function shouldRenderLanding(pathname: string, search: string, hash: string): boolean {
  const params = new URLSearchParams(search);
  if (params.get('view') === 'app' || params.get('ui') === 'v2') return false;
  return pathname === '/' && hash === '';
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
