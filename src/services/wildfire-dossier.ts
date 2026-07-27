/**
 * wildfire-dossier.ts — Sélection et assemblage des dossiers « grand feu ».
 *
 * Fonctions PURES uniquement : aucun accès réseau, aucun DOM.
 * L'effet de bord Ollama vit dans wildfire-enrich.ts.
 *
 * Voir docs/design-alertes-grands-feux-2026-07.md §4, §12.
 */

import type { FireIncident, SituationSeverity } from '../types/index.ts';

/**
 * Porte d'entrée « grand feu », calibrée sur l'épisode Gironde du 2026-07-26 :
 * le front principal comptait 650 détections / 7 178 MW, le plus gros cluster
 * hors zone 22 détections. Voir §4.1 — et la réserve du §4.3 : la fixture est
 * une traîne, pas un pic, donc cette porte est volontairement conservatrice.
 */
export const MAJOR_FIRE_GATE = { minDetections: 40, minFrpTotal: 300 } as const;

/** Sévérité d'un incident. Ne dépend PAS du FRP moyen (mauvais discriminant, §4.1). */
export function wildfireSeverity(incident: FireIncident): SituationSeverity {
  const { detectionsCount, frpTotal, nearUrban } = incident;
  if (detectionsCount >= 300 || (frpTotal >= 3000 && nearUrban)) return 'critical';
  if (detectionsCount >= 100 || frpTotal >= 1500) return 'high';
  return 'medium';
}

/** Retient les incidents franchissant la porte d'entrée. */
export function selectMajorIncidents(incidents: FireIncident[]): FireIncident[] {
  return incidents.filter(
    incident =>
      incident.detectionsCount >= MAJOR_FIRE_GATE.minDetections &&
      incident.frpTotal >= MAJOR_FIRE_GATE.minFrpTotal,
  );
}
