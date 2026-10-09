// src/services/infra-continuity.ts — lignes du baromètre « Continuité infrastructure France »,
// en données pures : partagées entre l'infobulle v1 (BarometerWidget) et la section
// Infrastructures de la fiche France v2 (spec 2026-10-01 § 3.2). Mêmes seuils que le widget.

import type { NuclearState } from '../types/index.ts';
import type { EolienLive } from './eolien/types.ts';
import type { NetworkBarometerResult } from './network-barometer.ts';
import type { VigilanceLevel } from './vigilance.ts';
import { fleetLevel } from './nuclear-fleet.ts';

export interface InfraInput {
  result: NetworkBarometerResult | null;
  nuclear: NuclearState | null;
  eolien: EolienLive | null;
}

export type InfraKey = 'bgp' | 'elec' | 'nuclear' | 'wind' | 'telecom' | 'cloud' | 'space' | 'cyber';

export interface InfraRow {
  key: InfraKey;
  label: string;
  /** 0–100 ; null : source indisponible. */
  value: number | null;
  /** Précision (« écart REMIT », « sous tension », « maintenance programmée », « Indisponible »), sinon null. */
  note: string | null;
  /** Niveau imposé par la source (nucléaire : arrêts imprévus) ; null : niveau tiré de la valeur. */
  level: VigilanceLevel | null;
}

export const INFRA_NOTE: Record<'fr' | 'en', string> = {
  fr: "Score de continuité borné. La ligne cyber mesure la résilience infra, pas la pression cyber nationale.",
  en: 'Bounded continuity score. The cyber line measures infrastructure resilience, not national cyber pressure.',
};

/** Libellés des lignes de continuité : source unique (fiche France et infobulle du baromètre). */
export const INFRA_LABELS: Readonly<Record<InfraKey, Record<'fr' | 'en', string>>> = {
  bgp: { fr: 'BGP / Internet', en: 'BGP / Internet' },
  elec: { fr: 'Électricité (Écowatt)', en: 'Electricity (Ecowatt)' },
  nuclear: { fr: 'Nucléaire (RTE)', en: 'Nuclear (RTE)' },
  wind: { fr: 'Éolien (éCO2mix)', en: 'Wind (éCO2mix)' },
  telecom: { fr: 'Télécom (ARCEP)', en: 'Telecom (ARCEP)' },
  cloud: { fr: 'Cloud (zones France)', en: 'Cloud (France zones)' },
  space: { fr: 'Météo spatiale', en: 'Space weather' },
  cyber: { fr: 'Résilience cyber infra', en: 'Infra cyber resilience' },
};

/**
 * Disponible / installé (RTE), maintenance comprise ; null sans état ; score null si RTE est indisponible.
 * Le niveau suit les arrêts imprévus seuls, comme le panneau Parc nucléaire (décision du 08/10/2026) :
 * une disponibilité basse due à la maintenance programmée reste verte et le dit.
 */
export function nuclearInfraScore(state: NuclearState | null): { score: number | null; note: string | null; level: VigilanceLevel | null } | null {
  if (!state || !state.stress) return null;
  if (!state.rteAvailable) return { score: null, note: 'Indisponible', level: null };
  const installed = state.stress.installedCapacityMW;
  const available = state.stress.availableCapacityMW;
  const ratio = installed > 0 ? available / installed : 0;
  const score = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  const level = fleetLevel(state.stress.unplannedLostMW);
  const quietLevel = level === 'vert' || level === 'jaune';
  const note = state.unconfirmedSignals.length > 0 ? 'écart REMIT'
    : state.stress.gridTensionRisk ? 'sous tension'
    : quietLevel && score < 85 ? 'maintenance programmée'
    : null;
  return { score, note, level };
}

/** Éolien calculé sur l'alerte en direct (évite le retard du cache du baromètre), sinon valeur du baromètre. */
export function windInfraScore(live: EolienLive | null, fallback: number | null): number | null {
  if (live) return live.alertLevel === 'normal' ? 100 : live.alertLevel === 'watch' ? 70 : 40;
  return fallback;
}

/** Seuils du baromètre : ≥ 85 vert, ≥ 60 jaune, sinon rouge. */
export function infraValueLevel(value: number | null): VigilanceLevel | null {
  if (value === null) return null;
  if (value >= 85) return 'vert';
  if (value >= 60) return 'jaune';
  return 'rouge';
}

export function infraRows(input: InfraInput, lang: 'fr' | 'en'): InfraRow[] {
  if (!input.result) return [];
  const d = input.result.details;
  const nuclear = nuclearInfraScore(input.nuclear);
  const values: Array<[InfraKey, number | null, string | null, VigilanceLevel | null]> = [
    ['bgp', d.bgp ?? null, null, null],
    ['elec', d.elec ?? null, null, null],
    ['nuclear', nuclear?.score ?? null, nuclear?.note ?? null, nuclear?.level ?? null],
    ['wind', windInfraScore(input.eolien, d.wind ?? null), null, null],
    ['telecom', d.telecom ?? null, null, null],
    ['cloud', d.cloud ?? null, null, null],
    ['space', d.space ?? null, null, null],
    ['cyber', d.cyber ?? null, null, null],
  ];
  return values.map(([key, value, note, level]) => ({ key, label: INFRA_LABELS[key][lang], value, note, level }));
}
