/**
 * wildfire-dossier.ts — Sélection et assemblage des dossiers « grand feu ».
 *
 * Fonctions PURES uniquement : aucun accès réseau, aucun DOM.
 * L'effet de bord Ollama vit dans wildfire-enrich.ts.
 *
 * Voir docs/design-alertes-grands-feux-2026-07.md §4, §12.
 */

import type {
  Credibility, FireIncident, ImpactFact, ImpactFactKind, SituationSeverity, WildfireDossier,
} from '../types/index.ts';

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

/**
 * Retient les incidents franchissant la porte d'entrée.
 * Générique pour préserver le sous-type de l'appelant (ex: LocatedFireIncident) :
 * un filtre ne transforme rien, il n'y a donc aucune raison de perdre le type.
 */
export function selectMajorIncidents<T extends FireIncident>(incidents: T[]): T[] {
  return incidents.filter(
    incident =>
      incident.detectionsCount >= MAJOR_FIRE_GATE.minDetections &&
      incident.frpTotal >= MAJOR_FIRE_GATE.minFrpTotal,
  );
}

const FACT_KINDS: ImpactFactKind[] = [
  'area_ha', 'evacuated', 'dwellings_destroyed', 'injured',
  'evacuation_order', 'road_closed', 'rail_disrupted',
];

/** Un fait sans provenance complète n'est pas affichable (§3.3). */
function hasFullProvenance(fact: ImpactFact): boolean {
  return Boolean(fact.quote && fact.sourceUrl && fact.sourceName && fact.observedAt);
}

/**
 * Crédibilité de l'information, dérivée — jamais stockée (§12.1).
 * Deux reprises d'une même source ne font pas une corroboration (§12.3).
 */
export function gradeCredibility(fact: ImpactFact, corroboration: string[]): Credibility {
  const corroborated = new Set(corroboration).size >= 2;
  if (fact.sourceLevel === 'tertiary' && !corroborated) return 6;
  if (fact.hedged && !corroborated) return 5;
  if (corroborated) return fact.sourceLevel === 'primary' ? 1 : 2;
  return fact.sourceLevel === 'primary' ? 3 : 4;
}

/**
 * Assemble un dossier. Regroupe les faits en SÉRIES chronologiques :
 * aucune valeur n'est moyennée, choisie ou écrasée (§12.4).
 */
export function buildDossier(
  incident: FireIncident,
  facts: ImpactFact[],
  deptCodes: string[],
): WildfireDossier {
  const usable = facts.filter(hasFullProvenance);

  // Corroboration par (genre, valeur) : qui affirme le même fait ?
  const assertions = new Map<string, Set<string>>();
  for (const fact of usable) {
    const key = `${fact.kind}|${fact.value ?? 'null'}`;
    const sources = assertions.get(key) ?? new Set<string>();
    sources.add(fact.sourceName);
    assertions.set(key, sources);
  }

  const graded = usable
    .map(fact => {
      const corroboration = [...(assertions.get(`${fact.kind}|${fact.value ?? 'null'}`) ?? [])].sort();
      return { ...fact, corroboration, credibility: gradeCredibility(fact, corroboration) };
    })
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));

  const series = Object.fromEntries(
    FACT_KINDS.map(kind => [kind, graded.filter(f => f.kind === kind)]),
  ) as Record<ImpactFactKind, ImpactFact[]>;

  const communes = [...new Set(graded.flatMap(f => f.communes))].sort((a, b) =>
    a.localeCompare(b, 'fr'),
  );

  return {
    incident,
    severity: wildfireSeverity(incident),
    deptCodes: [...new Set(deptCodes)],
    communes,
    facts: graded,
    series,
  };
}
