// src/services/ui-mode.ts — bascule de la nouvelle interface « poste de situation » (refonte UI,
// spec §10) : `?ui=v2` active la disposition A1 pendant les étapes 2 et 3. Sans ce paramètre,
// l'interface actuelle reste celle par défaut. Module minuscule : main.ts et App.ts l'importent
// statiquement sans alourdir le chemin critique.

export function isUiV2(search: string): boolean {
  return new URLSearchParams(search).get('ui') === 'v2';
}
