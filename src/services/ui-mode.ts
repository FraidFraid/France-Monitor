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
