// src/services/energy-state.ts
/**
 * energy-state.ts : vocabulaire unique des états de l'énergie sur la carte (spec 2026-10-15, proposition B).
 * Couleur = état (palette de vigilance), forme et picto = filière. Le vert n'est donné qu'à un état mesuré ;
 * un objet sans mesure en direct est « sans état suivi » (gris clair).
 */
import type { FuelTensionLevel, HydraulicTrend, ReactorAvailabilityStatus } from '../types/index.ts';
import type { EolienParkStatus } from './eolien/types.ts';
import type { IconName } from '../components/shared/icons.ts';
import { levelHex, type VigilanceLevel } from './vigilance.ts';

export type EnergyState = 'arret' | 'tension' | 'reduit' | 'maintenance' | 'normal' | 'nonSuivi';

/** Du plus grave au moins grave : ordre des lignes de la légende. */
export const ENERGY_STATES: readonly EnergyState[] = ['arret', 'tension', 'reduit', 'maintenance', 'normal', 'nonSuivi'];

export const ENERGY_STATE_HEX: Readonly<Record<EnergyState, string>> = {
  arret: levelHex('rouge'),
  tension: levelHex('orange'),
  reduit: levelHex('jaune'),
  maintenance: '#6e6e80',
  normal: levelHex('vert'),
  nonSuivi: '#c7c7cc',
};

export const ENERGY_STATE_LABEL: Readonly<Record<EnergyState, string>> = {
  arret: 'À l’arrêt sans préavis',
  tension: 'Sous tension',
  reduit: 'Réduit',
  maintenance: 'Arrêt annoncé ou hors service',
  normal: 'Normal',
  nonSuivi: 'Sans état suivi',
};

export const ENERGY_STATE_PHRASE: Readonly<Record<EnergyState, string>> = {
  arret: 'arrêt imprévu',
  tension: 'stockage bas, retenue en stress',
  reduit: 'puissance réduite, stockage moyen',
  maintenance: 'maintenance, arrêt programmé, démantelé',
  normal: 'mesuré en direct',
  nonSuivi: 'inventaire, pas de mesure en direct',
};

/** Rang de gravité : le plus grave est dessiné en dernier (il prend le clic). */
export const ENERGY_STATE_RANK: Readonly<Record<EnergyState, number>> = {
  nonSuivi: 0, normal: 1, maintenance: 2, reduit: 3, tension: 4, arret: 5,
};

export function isEnergyAlert(state: EnergyState): boolean {
  return state === 'arret' || state === 'tension';
}

export type EnergySector = 'nucleaire' | 'electricite' | 'gaz' | 'petrole' | 'hydraulique' | 'eolien';

export const ENERGY_SECTOR_ICON: Readonly<Record<EnergySector, IconName>> = {
  nucleaire: 'atom', electricite: 'zap', gaz: 'flame', petrole: 'fuel', hydraulique: 'droplet', eolien: 'wind',
};

export const ENERGY_SECTOR_LABEL: Readonly<Record<EnergySector, string>> = {
  nucleaire: 'Nucléaire', electricite: 'Électricité', gaz: 'Gaz', petrole: 'Pétrole', hydraulique: 'Hydraulique', eolien: 'Éolien',
};

/** Teinte de chaque filière sur la carte (spec 2026-10-16) : disque coloré, picto blanc ou foncé. */
export const ENERGY_SECTOR_HEX: Readonly<Record<EnergySector, string>> = {
  nucleaire: '#8b5cf6', hydraulique: '#2f80ff', eolien: '#14c8d8', gaz: '#e64bb4', petrole: '#8fa3bf', electricite: '#eef2f7',
};

/** Disques clairs : le picto y est foncé pour rester lisible. */
export const ENERGY_SECTOR_GLYPH_DARK: ReadonlySet<EnergySector> = new Set<EnergySector>(['electricite', 'petrole', 'eolien']);

/** Disque d'un état anormal : l'état prime sur la teinte de la filière. */
export const ENERGY_DISC_STATE_HEX: Readonly<Record<'arret' | 'tension' | 'reduit' | 'maintenance', string>> = {
  arret: '#ff3b30', tension: '#ff9500', reduit: '#ffcc00', maintenance: '#5c5f6b',
};

export type EnergyFlowKind = 'elec' | 'gaz' | 'petrole';

/** Échanges avec l'étranger : une couleur par filière et par sens. */
export const ENERGY_FLOW_COLORS: Readonly<Record<EnergyFlowKind, { export: string; import: string }>> = {
  elec: { export: '#2ee59d', import: '#e9f542' },
  gaz: { export: '#4dc9ff', import: '#ff8a65' },
  petrole: { export: '#e2e8f0', import: '#e3c58f' },
};

export const ENERGY_FLOW_KIND_LABEL: Readonly<Record<EnergyFlowKind, string>> = { elec: 'électricité', gaz: 'gaz', petrole: 'pétrole' };

/** Détroits et points de passage obligés du pétrole. */
export const ENERGY_CHOKE_HEX = '#e3c58f';

/** Réseaux (gazoducs, oléoducs, lignes HTA) : inventaire, gris neutre. */
export const ENERGY_NETWORK_HEX = '#8e8e93';
/** Flux d'échange avec l'étranger : blanc cassé, le sens est porté par les chevrons. */
export const ENERGY_FLOW_HEX = '#e5e5ea';
export const ENERGY_FLOW_GLOW_HEX = '#8e8e93';

export function nuclearState(status: ReactorAvailabilityStatus): EnergyState {
  switch (status) {
    case 'OUTAGE_UNPLANNED': return 'arret';
    case 'REDUCED': return 'reduit';
    case 'OUTAGE_PLANNED': return 'maintenance';
    case 'AVAILABLE': return 'normal';
    default: return 'nonSuivi';
  }
}

/** Remplissage en % ; une valeur absente ou non finie ne donne aucun état. */
export function gasStorageState(fillPct: number | null): EnergyState {
  if (fillPct === null || !Number.isFinite(fillPct)) return 'nonSuivi';
  if (fillPct < 30) return 'tension';
  if (fillPct < 50) return 'reduit';
  return 'normal';
}

/** Même lecture que le panneau Hydraulique (`trendLevel`) : stress orange, haut jaune, sinon vert. */
export function hydroState(trend: HydraulicTrend): EnergyState {
  if (trend === 'stress') return 'tension';
  if (trend === 'high') return 'reduit';
  return 'normal';
}

/** `inactive` vient de `etat_mat = dm` (démantelé) : hors service, pas une panne. Pas de télémesure parc par parc. */
export function windState(status: EolienParkStatus): EnergyState {
  return status === 'inactive' ? 'maintenance' : 'nonSuivi';
}

/** Statut déclaré dans la configuration, pas mesuré : une raffinerie active n'a pas d'état suivi. */
export function refineryState(status: 'active' | 'maintenance' | 'offline'): EnergyState {
  return status === 'active' ? 'nonSuivi' : 'maintenance';
}

/** Donnée EDF en retard : plus aucune couleur d'état. */
export function powerOutageState(kind: 'imprevue' | 'planifiee', late: boolean): EnergyState {
  if (late) return 'nonSuivi';
  return kind === 'imprevue' ? 'arret' : 'maintenance';
}

export function fuelTensionVigilance(level: FuelTensionLevel): VigilanceLevel {
  switch (level) {
    case 'CRITICAL': return 'rouge';
    case 'HIGH': return 'orange';
    case 'MEDIUM': return 'jaune';
    default: return 'vert';
  }
}
